const globalRateData: { [id: number]: LimitData } = {};

class LimitData {
    readonly queue: (() => void)[] = [];
    timer: ReturnType<typeof setInterval> | null = null;

    constructor() {
        this.queue = [];
        this.timer = null;
    }
}

function GetRateData(queueID: number) {
    if (queueID in globalRateData) {
        return globalRateData[queueID];
    } else {
        globalRateData[queueID] = new LimitData();
        return globalRateData[queueID]
    }
}

/**
 * @param {(...args: Args) => Result} action The action to be rate limited.
 * @param {number} rateLimit The minimum interval in milliseconds between each execution.
 * @param {number} queueID Optional. A queue identifier; actions in the same queue are rate-limited and executed sequentially. Defaults to 0 for a dedicated queue for this action.
 * @returns {(...args: Args) => Promise<Result>} An asynchronous function that executes the action and returns a promise with the result.
 */
export default function RateKeeper<Args extends unknown[], Result>(action: (...args: Args) => Result, rateLimit: number, queueID: number = 0): (...args: Args) => Promise<Result> {

    const limitData = queueID === 0 ? new LimitData() : GetRateData(queueID);

    function ProcessQueue(): void {
        limitData.queue.shift()?.();

        if (limitData.queue.length === 0 && limitData.timer !== null) {
            clearInterval(limitData.timer)
            limitData.timer = null
        }
    }

    function PublicFunc(...arg: Args): Promise<Result> {
        let resolve: ((res: Result) => void);
        const promise = new Promise<Result>(res => { resolve = res; });

        limitData.queue.push(() => resolve(action(...arg)));

        if (limitData.timer === null) {
            ProcessQueue();
            limitData.timer = setInterval(ProcessQueue, rateLimit);
        }

        return promise;
    }

    return PublicFunc;
}