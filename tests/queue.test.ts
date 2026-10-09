import { afterEach, expect, test, vi } from 'vitest'
import RateKeeper, { CancelablePromise, DropPolicy } from "../src/index";

let log: string[] = [];

function ResetLog() {
  log = [];
}

function logMessage(newLog: string) {
  log.push(newLog);
  return newLog;
}

const loggerIndependant = RateKeeper(logMessage, 500); // 500ms
const logger1Queue1 = RateKeeper(logMessage, 200, { id: 1 }); // 200ms
const logger2Queue2 = RateKeeper(logMessage, 100, { id: 2 }); // 100ms
const logger3Queue2 = RateKeeper(logMessage, 100, { id: 2 }); // 100ms
const logger4Queue3Reject = RateKeeper(logMessage, 10, {
  id: 3,
  dropPolicy: DropPolicy.Reject,
  maxQueueSize: 4
}); // 10ms
const logger5Queue4Oldest = RateKeeper(logMessage, 10, {
  id: 4,
  dropPolicy: DropPolicy.DropOldest,
  maxQueueSize: 5
}); // 10ms
const logger6Queue5 = RateKeeper(logMessage, 100, { id: 5 }); // 100ms
const logger7Queue6 = RateKeeper(logMessage, 100, { id: 6 }); // 100ms
const logger8Queue7 = RateKeeper(logMessage, 100, { id: 7 }); // 100ms

afterEach(() => {
  ResetLog();
});

test('Basic Usage', async () => {

  const actions: Promise<string>[] = [];

  actions.push(loggerIndependant("[OQ-500ms-1]"));
  actions.push(loggerIndependant("[OQ-500ms-2]"));
  actions.push(loggerIndependant("[OQ-500ms-3]"));

  logMessage("[US-1]");
  logMessage("[US-2]");
  logMessage("[US-3]");

  actions.push(logger1Queue1("[Q1-200ms-1]"));
  actions.push(logger1Queue1("[Q1-200ms-2]"));
  actions.push(logger1Queue1("[Q1-200ms-3]"));

  actions.push(logger2Queue2("[Q2-100ms-1]").then(x => logMessage(x + " promise")));
  actions.push(logger2Queue2("[Q2-100ms-2]"));
  actions.push(logger2Queue2("[Q2-100ms-3]"));

  actions.push(logger3Queue2("[Q2-100ms-4]").then(x => logMessage(x + " promise")));
  actions.push(logger3Queue2("[Q2-100ms-5]"));
  actions.push(logger3Queue2("[Q2-100ms-6]"));

  await Promise.all(actions);
  expect(log).toStrictEqual([
    "[OQ-500ms-1]",         //0ms
    "[US-1]",               //0ms
    "[US-2]",               //0ms
    "[US-3]",               //0ms
    "[Q1-200ms-1]",         //0ms
    "[Q2-100ms-1]",         //0ms
    "[Q2-100ms-1] promise", //0ms
    "[Q2-100ms-2]",         //100ms
    "[Q1-200ms-2]",         //200ms
    "[Q2-100ms-3]",         //200ms
    "[Q2-100ms-4]",         //300ms
    "[Q2-100ms-4] promise", //300ms
    "[Q1-200ms-3]",         //400ms
    "[Q2-100ms-5]",         //400ms
    "[OQ-500ms-2]",         //500ms
    "[Q2-100ms-6]",         //500ms
    "[OQ-500ms-3]",         //1000ms
  ]);
});

test('Drop Policy Reject', async () => {
  const actions: Promise<string>[] = [];

  for (let i = 0; i < 10; i++) {
    actions.push(logger4Queue3Reject(`[R] Message ${i}`));
  }

  await Promise.allSettled(actions);
  expect(log).toStrictEqual([
    "[R] Message 0",
    "[R] Message 1",
    "[R] Message 2",
    "[R] Message 3",
    "[R] Message 4",
  ]);

  for (let i = 10; i < 20; i++) {
    actions.push(logger4Queue3Reject(`[R] Message ${i}`));
  }

  await Promise.allSettled(actions);
  expect(log).toStrictEqual([
    "[R] Message 0",
    "[R] Message 1",
    "[R] Message 2",
    "[R] Message 3",
    "[R] Message 4",

    "[R] Message 10",
    "[R] Message 11",
    "[R] Message 12",
    "[R] Message 13",
    "[R] Message 14",
  ]);
});

test('Drop Policy Oldest', async () => {
  const actions: Promise<string>[] = [];

  for (let i = 0; i < 10; i++) {
    actions.push(logger5Queue4Oldest(`[DO] Message ${i}`));
  }

  await Promise.allSettled(actions);
  expect(log).toStrictEqual([
    "[DO] Message 0",
    "[DO] Message 5",
    "[DO] Message 6",
    "[DO] Message 7",
    "[DO] Message 8",
    "[DO] Message 9",
  ]);

  for (let i = 10; i < 20; i++) {
    actions.push(logger5Queue4Oldest(`[DO] Message ${i}`));
  }

  await Promise.allSettled(actions);
  expect(log).toStrictEqual([
    "[DO] Message 0",
    "[DO] Message 5",
    "[DO] Message 6",
    "[DO] Message 7",
    "[DO] Message 8",
    "[DO] Message 9",

    "[DO] Message 10",
    "[DO] Message 15",
    "[DO] Message 16",
    "[DO] Message 17",
    "[DO] Message 18",
    "[DO] Message 19",
  ]);
});

test('Simple Cancel Actions', async () => {
  const actions: CancelablePromise<string>[] = [];
  const actionsToCancel: CancelablePromise<string>[] = [];

  actionsToCancel.push(loggerIndependant("Message 0"));  //<-- Cancelled but executed 
  actionsToCancel.push(loggerIndependant("Message 1"));  //<-- Cancelled
  actions.push(loggerIndependant("Message 2"));

  actionsToCancel.forEach(action => action?.cancel());

  await Promise.allSettled([...actions, ...actionsToCancel]);
  expect(log).toStrictEqual([
    "Message 0",
    "Message 2",
  ]);
});

test('Complex Cancel Actions', async () => {
  const actions: CancelablePromise<string>[] = [];
  const actionsToCancel: CancelablePromise<string>[] = [];

  logMessage("[US-1]");
  logMessage("[US-2]");
  logMessage("[US-3]");

  actionsToCancel.push(loggerIndependant("[OQ-500ms-1]"));  //<-- Cancelled but executed 
  actionsToCancel.push(loggerIndependant("[OQ-500ms-2]"));  //<-- Cancelled
  actions.push(loggerIndependant("[OQ-500ms-3]"));

  actionsToCancel.push(logger2Queue2("[Q2-100ms-1]"));      //<-- Cancelled but executed 
  actions.push(logger2Queue2("[Q2-100ms-2]"));
  actions.push(logger2Queue2("[Q2-100ms-3]"));

  const customLogger = logger3Queue2("[Q2-100ms-4]");
  customLogger
    .then(x => logMessage(x + "This should not be executed!"))
    .catch((error) => logMessage(error.message));
  customLogger.cancel(new Error("Expected Error"));

  actionsToCancel.push(customLogger);                         //<-- Cancelled 
  actions.push(logger3Queue2("[Q2-100ms-5]"));
  actionsToCancel.push(logger3Queue2("[Q2-100ms-6]"));        //<-- Cancelled

  actionsToCancel.forEach(action => action?.cancel());

  await Promise.allSettled([...actions, ...actionsToCancel]);
  expect(log).toStrictEqual([
    "[US-1]",
    "[US-2]",
    "[US-3]",
    "[OQ-500ms-1]",
    "[Q2-100ms-1]",
    "Expected Error",
    "[Q2-100ms-2]",
    "[Q2-100ms-3]",
    "[Q2-100ms-5]",
    "[OQ-500ms-3]",
  ]);
});

test('Runtime Cancelled Timer Recovery', async () => {
  const realSetTimeout = globalThis.setTimeout;
  const realSetInterval = globalThis.setInterval;
  const handles: Array<{ kind: 'timeout' | 'interval'; handle: unknown }> = [];

  const captureTimeout = ((callback: (...args: unknown[]) => void, delay?: number, ...args: unknown[]) => {
    const handle = (realSetTimeout as (...a: unknown[]) => unknown)(callback, delay, ...args);
    handles.push({ kind: 'timeout', handle });
    return handle;
  }) as unknown as typeof setTimeout;

  const captureInterval = ((callback: (...args: unknown[]) => void, delay?: number, ...args: unknown[]) => {
    const handle = (realSetInterval as (...a: unknown[]) => unknown)(callback, delay, ...args);
    handles.push({ kind: 'interval', handle });
    return handle;
  }) as unknown as typeof setInterval;

  globalThis.setTimeout = captureTimeout;
  globalThis.setInterval = captureInterval;

  const actions: CancelablePromise<string>[] = [];

  actions.push(logger6Queue5("[Q5-100ms-1]")); // First action of a burst runs synchronously.
  expect(log).toStrictEqual(["[Q5-100ms-1]"]);

  actions.push(logger6Queue5("[Q5-100ms-2]")); // Schedules the timer for the next slot.

  // Restore the globals: only the pending handle was needed.
  globalThis.setTimeout = realSetTimeout;
  globalThis.setInterval = realSetInterval;

  // The runtime cancels the timer without telling the library (workerd does it
  // when the request's I/O context ends).
  const last = handles[handles.length - 1];
  if (last.kind === 'interval') clearInterval(last.handle as ReturnType<typeof setInterval>);
  else clearTimeout(last.handle as ReturnType<typeof setTimeout>);

  actions.push(logger6Queue5("[Q5-100ms-3]")); // The next call must re-arm the timer.

  await Promise.all(actions);
  expect(log).toStrictEqual(["[Q5-100ms-1]", "[Q5-100ms-2]", "[Q5-100ms-3]"]);

  globalThis.setTimeout = realSetTimeout;
  globalThis.setInterval = realSetInterval;
});

test('Cancel Keeps Queue Schedule', async () => {
  vi.useFakeTimers();

  const actions: CancelablePromise<string>[] = [];
  const actionsToCancel: CancelablePromise<string>[] = [];

  actions.push(logger7Queue6("[Q6-100ms-1]")); // Runs synchronously and reserves the next slot.

  const customLogger = logger7Queue6("[Q6-100ms-2]"); // Queued for the next slot.
  customLogger.catch(() => { /* expected rejection */ });
  customLogger.cancel();
  actionsToCancel.push(customLogger);

  await vi.advanceTimersByTimeAsync(20); // Still before the reserved slot.
  expect(log).toStrictEqual(["[Q6-100ms-1]"]);

  actions.push(logger7Queue6("[Q6-100ms-3]")); // Must reuse the reserved slot, not add a full one.

  await vi.advanceTimersByTimeAsync(80); // Reaches the reserved slot.
  expect(log).toStrictEqual(["[Q6-100ms-1]", "[Q6-100ms-3]"]);

  await Promise.allSettled([...actions, ...actionsToCancel]);
  vi.useRealTimers();
});

test('Cancel All Keeps Queue Schedule', async () => {
  vi.useFakeTimers();

  const actions: CancelablePromise<string>[] = [];
  const actionsToCancel: CancelablePromise<string>[] = [];

  actions.push(logger8Queue7("[Q7-100ms-1]")); // Runs synchronously.

  // A large cancelled batch proves cancelled slots are not consumed;
  // otherwise the relaunch would wait 5000 intervals.
  for (let i = 2; i <= 5_000; i++) {
    const customLogger = logger8Queue7(`[Q7-100ms-${i}]`); // Queued.
    customLogger.catch(() => { /* expected rejection */ });
    actionsToCancel.push(customLogger);
  }

  actionsToCancel.forEach(action => action?.cancel()); // Cancel the whole pending batch.

  await vi.advanceTimersByTimeAsync(20); // Still before the pending slot.
  expect(log).toStrictEqual(["[Q7-100ms-1]"]);

  for (let i = 5001; i <= 5005; i++) {
    actions.push(logger8Queue7(`[Q7-100ms-${i}]`)); // Relaunch immediately.
  }

  await vi.advanceTimersByTimeAsync(80); // Reaches the pending slot, not after the 5000 cancelled slots.
  expect(log).toStrictEqual(["[Q7-100ms-1]", "[Q7-100ms-5001]"]);

  await vi.advanceTimersByTimeAsync(100); // One per interval, not a burst.
  expect(log).toStrictEqual(["[Q7-100ms-1]", "[Q7-100ms-5001]", "[Q7-100ms-5002]"]);

  await vi.advanceTimersByTimeAsync(300); // Drains the rest.
  expect(log).toStrictEqual([
    "[Q7-100ms-1]",
    "[Q7-100ms-5001]",
    "[Q7-100ms-5002]",
    "[Q7-100ms-5003]",
    "[Q7-100ms-5004]",
    "[Q7-100ms-5005]",
  ]);

  await Promise.allSettled([...actions, ...actionsToCancel]);
  vi.useRealTimers();
});