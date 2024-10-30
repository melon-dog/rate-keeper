class LimitData {
    readonly queue: (() => void)[] = [];
    timer: ReturnType<typeof setInterval> | null = null;

    constructor() {
        this.queue = [];
        this.timer = null;
    }
}

const globalData: { [id: number]: LimitData } = {};

function GetData(id: number) {
    if (id in globalData) {
        return globalData[id];
    } else {
        globalData[id] = new LimitData();
        return globalData[id]
    }
}

export default function RateKeeper<Args extends unknown[], Result>(action: (...args: Args) => Result, rateLimit: number, id: number = 0): (...args: Args) => Promise<Result> {

    const limitData = id === 0 ? new LimitData() : GetData(id);

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