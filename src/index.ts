const globalRateData = new Map<number, LimitData>();

/** @internal Queues with a pending slot, in registration order. */
const pendingQueues = new Set<LimitData>();

/** @internal Single shared timer for the earliest pending slot. */
let schedulerTimer: ReturnType<typeof setTimeout> | null = null;

/** @internal Error messages used throughout the library. */
const ERRORS = {
    CANCELLED: "Cancelled by user.",
    QUEUE_FULL: "Queue is at max capacity."
} as const;

/**
 * @enum {DropPolicy} Defines the behavior of the queue when the maximum size has been reached.
 */
export enum DropPolicy {
    Reject,
    DropOldest
}

/**
 * @internal Represents a queued action with its execution and rejection handlers.
 * @property {number} id - The queue identifier this action belongs to.
 * @property {Function} action - The function to execute when the action is processed.
 * @property {Function} reject - The function to call when the action is cancelled or dropped.
 */
type Action = {
    id: number;
    action: () => void;
    reject: (reason: Error) => void;
};

/**
 * @param {number} id A queue identifier; actions in the same queue are rate-limited and executed sequentially, 0 is a reserved value.
 * @param {number} maxQueueSize Optional. Max size of the queue.
 * @param {DropPolicy} dropPolicy Optional. Policy when max size is reached: 'Reject' or 'DropOldest'.
 */
export interface QueueSettings {
    id: number;
    maxQueueSize?: number;
    dropPolicy?: DropPolicy;
}

/**
 * @internal
 * Efficient O(1) amortized queue implementation.
 * Avoids O(n) shift() operations on standard arrays.
 * @template T - The type of elements in the queue.
 */
class Deque<T> {
    #items: T[] = [];
    #head = 0;

    /**
     * Adds an item to the end of the queue.
     * @param {T} item - The item to add.
     */
    push(item: T): void {
        this.#items.push(item);
    }

    /**
     * Removes and returns the first item from the queue.
     * @returns {T | undefined} The first item, or undefined if empty.
     */
    shift(): T | undefined {
        if (this.#head >= this.#items.length) {
            return undefined;
        }
        const item = this.#items[this.#head];
        this.#items[this.#head++] = undefined!; // Allow GC
        // Compact when over half empty and reasonably sized
        if (this.#head > 64 && this.#head > this.#items.length / 2) {
            this.#items = this.#items.slice(this.#head);
            this.#head = 0;
        }
        return item;
    }

    /**
     * Removes a specific item from the queue.
     * @param {T} item - The item to remove.
     * @returns {boolean} True if the item was found and removed, false otherwise.
     */
    remove(item: T): boolean {
        const index = this.#items.indexOf(item, this.#head);
        if (index !== -1) {
            this.#items.splice(index, 1);
            return true;
        }
        return false;
    }

    /**
     * The number of items currently in the queue.
     * @returns {number} The queue length.
     */
    get length(): number {
        return this.#items.length - this.#head;
    }
}

/**
 * @internal
 * Holds the state for a rate-limited queue.
 * @property {Deque<Action>} queue - The queue of pending actions.
 * @property {number} rateLimit - The interval in ms for the active burst.
 * @property {number} nextAllowedAt - Epoch ms at which the next action may run, 0 when idle.
 * @property {QueueSettings} settings - The configuration for this queue.
 */
class LimitData {
    readonly queue = new Deque<Action>();
    rateLimit = 0;
    nextAllowedAt = 0;
    settings: QueueSettings;

    constructor(settings: QueueSettings) {
        this.settings = settings;
    }
}

/**
 * @internal
 * Retrieves or creates the LimitData for a given queue ID.
 * @param {QueueSettings} settings - The queue settings containing the ID.
 * @returns {LimitData} The existing or newly created LimitData instance.
 */
function getRateData(settings: QueueSettings): LimitData {
    const { id } = settings;
    if (globalRateData.has(id)) {
        return globalRateData.get(id)!;
    }
    const newLimitData = new LimitData(settings);
    globalRateData.set(id, newLimitData);
    return newLimitData;
}

/**
 * @internal
 * Runs the next action of the given queue.
 * @param {LimitData} limitData - The queue to advance.
 */
function runNext(limitData: LimitData): void {
    const next = limitData.queue.shift();
    if (next) {
        next.action();
    }
}

/**
 * @internal
 * (Re-)arms the single shared timer for the earliest pending slot. Re-arming on
 * every call also recovers from runtimes that cancel timers when a request's
 * I/O context ends (Cloudflare Workers): `clearTimeout` is harmless on a
 * cancelled handle, so a fresh timer is created.
 */
function scheduleNextSlot(): void {
    let earliest = Infinity;
    for (const limitData of pendingQueues) {
        if (limitData.nextAllowedAt < earliest) {
            earliest = limitData.nextAllowedAt;
        }
    }
    if (schedulerTimer !== null) clearTimeout(schedulerTimer);
    schedulerTimer = earliest === Infinity
        ? null
        : setTimeout(processPendingQueues, Math.max(0, earliest - Date.now()));
}

/**
 * @internal
 * Runs every queue that reached its slot. Queues are processed in registration
 * order, so queues sharing the same slot keep a deterministic order, like the
 * original per-queue intervals created during the same tick did.
 */
function processPendingQueues(): void {
    schedulerTimer = null;
    const now = Date.now();
    for (const limitData of [...pendingQueues]) {
        if (limitData.nextAllowedAt > now) {
            continue;
        }
        if (limitData.queue.length === 0) {
            limitData.nextAllowedAt = 0;
            pendingQueues.delete(limitData);
            continue;
        }
        runNext(limitData);
        if (limitData.queue.length === 0) {
            limitData.nextAllowedAt = 0;
            pendingQueues.delete(limitData);
            continue;
        }
        // Keep the original tick grid so queues stay in phase; re-anchor only
        // when the grid fell more than one interval behind (e.g. after the
        // runtime cancelled the timer and the queue sat idle for a while).
        limitData.nextAllowedAt += limitData.rateLimit;
        if (limitData.nextAllowedAt <= Date.now()) {
            limitData.nextAllowedAt = Date.now() + limitData.rateLimit;
        }
    }
    scheduleNextSlot();
}

/**
 * A Promise that can be cancelled before it resolves.
 * @template T - The type of the resolved value.
 * @extends {Promise<T>}
 */
export interface CancelablePromise<T> extends Promise<T> {
    /**
     * Cancels the pending action if it hasn't been executed yet.
     * @param {Error} [reason] - Optional error to reject the promise with. Defaults to "Cancelled by user."
     */
    cancel: (reason?: Error) => void;
}

/**
 * @param {(...args: Args) => Result} action The action to be rate-limited.
 * @param {number} rateLimit The minimum interval in milliseconds between each execution.
 * @param {QueueSettings} settings Optional. Queue settings for rate limiting and execution.
 * @returns {(...args: Args) => CancelablePromise<Result>} An asynchronous function that executes the action and returns a promise with the result and a cancel method.
 */
export default function RateKeeper<Args extends unknown[], Result>(
    action: (...args: Args) => Result,
    rateLimit: number,
    settings: QueueSettings = { id: 0 }
): (...args: Args) => CancelablePromise<Result> {
    const limitData = settings.id === 0 ? new LimitData(settings) : getRateData(settings);

    function publicFunc(...args: Args): CancelablePromise<Result> {
        const { maxQueueSize, dropPolicy } = limitData.settings;
        let resolve: (res: Result) => void;
        let reject: (reason?: Error) => void;

        const promise = new Promise<Result>((res, rej) => {
            resolve = res;
            reject = rej;
        }) as CancelablePromise<Result>;

        const actionEntry: Action = {
            action: () => resolve(action(...args)),
            reject: (reason) => { reject(reason); },
            id: settings.id
        };

        promise.cancel = (reason?: Error) => {
            if (limitData.queue.remove(actionEntry)) {
                actionEntry.reject(reason || new Error(ERRORS.CANCELLED));
            }
        };

        if (maxQueueSize !== undefined && limitData.queue.length >= maxQueueSize) {
            if (dropPolicy === DropPolicy.Reject) {
                return Promise.reject(new Error(ERRORS.QUEUE_FULL)) as CancelablePromise<Result>;
            } else if (dropPolicy === DropPolicy.DropOldest) {
                limitData.queue.shift()?.reject(new Error(ERRORS.QUEUE_FULL));
            }
        }

        limitData.queue.push(actionEntry);

        if (limitData.nextAllowedAt === 0) {
            runNext(limitData); // First action of a burst runs synchronously.
            limitData.rateLimit = rateLimit;
            limitData.nextAllowedAt = Date.now() + rateLimit;
            pendingQueues.add(limitData);
        }
        scheduleNextSlot(); // Also recovers timers cancelled by the runtime.

        return promise;
    }

    return publicFunc;
}
