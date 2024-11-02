import { expect, test, vi } from 'vitest'
import RateKeeper from "../src/index";

let log: string[] = [];

function ResetLog() {
  log = [];
}

function UnsafeLogger(newLog: string) {
  log.push(newLog);
}

const SafeLoggerOwnQueue = RateKeeper(UnsafeLogger, 500); // 500ms
const SafeLoggerQueue1 = RateKeeper(UnsafeLogger, 200, { id: 1 }); // 200ms

const SafeLoggerQueue2 = RateKeeper(UnsafeLogger, 100, { id: 2 }); // 100ms

const AnotherSafeLoggerQueue2 = RateKeeper(UnsafeLogger, 100, { id: 2 }); // 100ms

test('RateKeeper Queue', async () => {

  const actions: Promise<void>[] = [];
  ResetLog();

  actions.push(SafeLoggerOwnQueue("[OQ-500ms-1]"));
  actions.push(SafeLoggerOwnQueue("[OQ-500ms-2]"));
  actions.push(SafeLoggerOwnQueue("[OQ-500ms-3]"));

  UnsafeLogger("[US-1]");
  UnsafeLogger("[US-2]");
  UnsafeLogger("[US-3]");

  actions.push(SafeLoggerQueue1("[Q1-200ms-1]"));
  actions.push(SafeLoggerQueue1("[Q1-200ms-2]"));
  actions.push(SafeLoggerQueue1("[Q1-200ms-3]"));

  actions.push(SafeLoggerQueue2("[Q2-100ms-1]"));
  actions.push(SafeLoggerQueue2("[Q2-100ms-2]"));
  actions.push(SafeLoggerQueue2("[Q2-100ms-3]"));

  actions.push(AnotherSafeLoggerQueue2("[Q2-100ms-4]"));
  actions.push(AnotherSafeLoggerQueue2("[Q2-100ms-5]"));
  actions.push(AnotherSafeLoggerQueue2("[Q2-100ms-6]"));

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
})