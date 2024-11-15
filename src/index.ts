const globalRateData = new Map<number, LimitData>();

/**
 * @enum {DropPolicy} Defines the behavior of the queue when the maximum size has been reached.
 */
export enum DropPolicy {
    Reject,
    DropOldest
}

type Action = {
    action: (() => void)
    reject: (reason: Error) => void
}

/**
 * @param {number} id A queue identifier; actions in the same queue are rate-limited and executed sequentially, 0 is a reserved value.
 * @param {number} maxQueueSize Optional. Max size of the queue.
 * @param {DropPolicy} dropPolicy Optional. Policy when max size is reached: 'Reject' or 'DropOldest'.
 */
interface QueueSettings {
    id: number;
    maxQueueSize?: number;
    dropPolicy?: DropPolicy;
}

class LimitData {
    readonly queue: Action[] = [];
    timer: ReturnType<typeof setInterval> | null = null;
    settings: QueueSettings;

    constructor(settings: QueueSettings) {
        this.settings = settings;
    }
}

function getRateData(settings: QueueSettings): LimitData {
    const { id } = settings;
    if (globalRateData.has(id)) {
        return globalRateData.get(id) as LimitData;
    } else {
        const newLimitData = new LimitData(settings);
        globalRateData.set(id, newLimitData);
        return newLimitData;
    }
}

/**
 * @param {(...args: Args) => Result} action The action to be rate-limited.
 * @param {number} rateLimit The minimum interval in milliseconds between each execution.
 * @param {QueueSettings} settings Optional. Queue settings for rate limiting and execution.
 * @returns {(...args: Args) => Promise<Result>} An asynchronous function that executes the action and returns a promise with the result.
 */
export default function RateKeeper<Args extends unknown[], Result>(
    action: (...args: Args) => Result,
    rateLimit: number,
    settings: QueueSettings = { id: 0 }
): (...args: Args) => Promise<Result> {
    const limitData = settings.id === 0 ? new LimitData(settings) : getRateData(settings);

    function processQueue(): void {
        limitData.queue.shift()?.action?.();

        if (limitData.queue.length === 0 && limitData.timer !== null) {
            clearInterval(limitData.timer);
            limitData.timer = null;
        }
    }

    function publicFunc(...args: Args): Promise<Result> {
        const { maxQueueSize, dropPolicy } = limitData.settings;
        let resolve: (res: Result) => void;
        let reject: (reason?: Error) => void;

        const promise = new Promise<Result>((res, rej) => {
            resolve = res;
            reject = rej;
        });

        // Handle queue size limit
        if (maxQueueSize !== undefined && limitData.queue.length >= maxQueueSize) {
            if (dropPolicy === DropPolicy.Reject) {
                // Reject new task by immediately resolving with a rejection
                return Promise.reject(new Error("Queue is at max capacity."));
            } else if (dropPolicy === DropPolicy.DropOldest) {
                // Drop the oldest task in the queue
                limitData.queue.shift()?.reject(new Error("Queue is at max capacity."));
            }
        }

        // Add the new task to the queue
        limitData.queue.push({
            action: () => resolve(action(...args)),
            reject: (reason) => { reject(reason) }
        });

        // Start the timer if it isn’t already running
        if (limitData.timer === null) {
            processQueue();
            limitData.timer = setInterval(processQueue, rateLimit);
        }

        return promise;
    }

    return publicFunc;
}
