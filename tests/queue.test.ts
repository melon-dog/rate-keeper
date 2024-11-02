import { afterEach, expect, test, vi } from 'vitest'
import RateKeeper, { DropPolicy } from "../src/index";

let log: string[] = [];

function ResetLog() {
  log = [];
}

function unsafeLogger(newLog: string) {
  log.push(newLog);
  return newLog;
}

const loggerIndependant = RateKeeper(unsafeLogger, 500); // 500ms
const logger1Queue1 = RateKeeper(unsafeLogger, 200, { id: 1 }); // 200ms
const logger2Queue2 = RateKeeper(unsafeLogger, 100, { id: 2 }); // 100ms
const logger3Queue2 = RateKeeper(unsafeLogger, 100, { id: 2 }); // 100ms
const logger4Queue3Reject = RateKeeper(unsafeLogger, 10, {
  id: 3,
  dropPolicy: DropPolicy.Reject,
  maxQueueSize: 4
}); // 10ms
const logger5Queue4Oldest = RateKeeper(unsafeLogger, 10, {
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

  unsafeLogger("[US-1]");
  unsafeLogger("[US-2]");
  unsafeLogger("[US-3]");

  actions.push(logger1Queue1("[Q1-200ms-1]"));
  actions.push(logger1Queue1("[Q1-200ms-2]"));
  actions.push(logger1Queue1("[Q1-200ms-3]"));

  actions.push(logger2Queue2("[Q2-100ms-1]"));
  actions.push(logger2Queue2("[Q2-100ms-2]"));
  actions.push(logger2Queue2("[Q2-100ms-3]"));

  actions.push(logger3Queue2("[Q2-100ms-4]"));
  actions.push(logger3Queue2("[Q2-100ms-5]"));
  actions.push(logger3Queue2("[Q2-100ms-6]"));

  await Promise.all(actions);
  expect(log).toStrictEqual([
    "[OQ-500ms-1]", //0ms
    "[US-1]",       //0ms
    "[US-2]",       //0ms
    "[US-3]",       //0ms
    "[Q1-200ms-1]", //0ms
    "[Q2-100ms-1]", //0ms
    "[Q2-100ms-2]", //100ms
    "[Q1-200ms-2]", //200ms
    "[Q2-100ms-3]", //200ms
    "[Q2-100ms-4]", //300ms
    "[Q1-200ms-3]", //400ms
    "[Q2-100ms-5]", //400ms
    "[OQ-500ms-2]", //500ms
    "[Q2-100ms-6]", //500ms
    "[OQ-500ms-3]", //1000ms
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
});

test('Drop Policy Oldest', async () => {
  const actions: Promise<string>[] = [];

  for (let i = 0; i < 10; i++) {
    actions.push(logger5Queue4Oldest(`[DO] Message ${i}`));
  }

  await Promise.allSettled(actions);
  expect(log).toStrictEqual([
    "[DO] Message 0",
    "[DO] Message 1",
    "[DO] Message 2",
    "[DO] Message 3",
    "[DO] Message 4",
  ]);
});