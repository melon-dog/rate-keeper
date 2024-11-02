const globalRateData: { [id: number]: LimitData } = {};

/**
 * @enum {DropPolicy} DropPolicy The minimum interval in milliseconds between each execution.
 */
export enum DropPolicy {
    Reject,
    DropOldest
};

/**
 * @param {id} id A queue identifier; actions in the same queue are rate-limited and executed sequentially, 0 is a reserved value.
 * @param {maxQueueSize} maxQueueSize Optional. Max size of the queue.
 * @param {dropPolicy} dropPolicy Optional. Policy when max size is reached: 'reject' or 'dropOldest'.
 */
interface QueueSettings {
    id: number;
    maxQueueSize?: number;
    dropPolicy?: DropPolicy;
}

class LimitData {
    readonly queue: (() => void)[] = [];
    timer: ReturnType<typeof setInterval> | null = null;
    settings: QueueSettings;

    constructor(settings: QueueSettings) {
        this.settings = settings;
    }
}

function getRateData(settings: QueueSettings): LimitData {
    const { id } = settings;
    if (id in globalRateData) {
        return globalRateData[id];
    } else {
        globalRateData[id] = new LimitData(settings);
        return globalRateData[id];
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
        limitData.queue.shift()?.();

        if (limitData.queue.length === 0 && limitData.timer !== null) {
            clearInterval(limitData.timer);
            limitData.timer = null;
        }
    }

    function publicFunc(...args: Args): Promise<Result> {
        const { maxQueueSize, dropPolicy } = limitData.settings;
        let resolve: (res: Result) => void;

        const promise = new Promise<Result>((res) => {
            resolve = res;
        });

        // Handle queue size limit
        if (maxQueueSize !== undefined && limitData.queue.length >= maxQueueSize) {
            if (dropPolicy === DropPolicy.Reject) {
                // Reject new task by immediately resolving with a rejection
                return Promise.reject(new Error("Queue is at max capacity."));
            } else if (dropPolicy === DropPolicy.DropOldest) {
                // Drop the oldest task in the queue
                limitData.queue.shift();
            }
        }

        // Add the new task to the queue
        limitData.queue.push(() => resolve(action(...args)));

        // Start the timer if it isn’t already running
        if (limitData.timer === null) {
            processQueue();
            limitData.timer = setInterval(processQueue, rateLimit);
        }

        return promise;
    }

    return publicFunc;
}
