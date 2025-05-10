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