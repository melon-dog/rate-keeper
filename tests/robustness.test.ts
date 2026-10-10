// Regression tests for the robustness findings from the code review.
// They encode the EXPECTED behavior, so against the reviewed revision (1.2.6)
// each one fails exposing a real failure mode. They must not be "fixed" by
// relaxing the assertions; the library code has to change instead.
import { afterEach, expect, test, vi } from 'vitest'
import RateKeeper, { CancelablePromise, DropPolicy } from "../src/index";

afterEach(() => {
  vi.useRealTimers();
});

test('An action that throws on the first (synchronous) call returns a rejected promise', async () => {
  const keeper = RateKeeper(() => {
    throw new Error('boom');
  }, 100);

  let pending: CancelablePromise<never> | undefined;
  expect(() => {
    pending = keeper();
  }).not.toThrow();

  expect(pending).toBeDefined();
  await expect(pending!).rejects.toThrow('boom');
});

test('An action that throws when its queued slot arrives settles its promise instead of escaping the scheduler', async () => {
  vi.useFakeTimers();

  let calls = 0;
  const keeper = RateKeeper((value: number) => {
    calls += 1;
    if (calls > 1) throw new Error('boom');
    return value;
  }, 100);

  void keeper(1).catch(() => { /* First call of the burst runs synchronously and succeeds. */ });

  let outcome: string | undefined;
  const queued = keeper(2);
  void queued.then(
    () => { outcome = 'resolved'; },
    (error: Error) => { outcome = `rejected:${error.message}`; }
  );

  let escaped: unknown;
  try {
    await vi.advanceTimersByTimeAsync(150);
  } catch (error) {
    escaped = error;
  }

  expect(escaped).toBeUndefined();
  expect(outcome).toBe('rejected:boom');
});

test('A throwing action does not stall other queues on the shared scheduler', async () => {
  vi.useFakeTimers();

  const log: string[] = [];
  let calls = 0;

  const throwing = RateKeeper((value: string) => {
    calls += 1;
    if (calls > 1) throw new Error('boom');
    return value;
  }, 100);

  const healthy = RateKeeper((value: string) => {
    log.push(value);
    return value;
  }, 100);

  void throwing('A1');      // Runs synchronously and arms queue A's slot.
  void throwing('A2').catch(() => { /* Expected to reject once the fix lands. */ });
  void healthy('B1');       // Runs synchronously and arms queue B's slot.
  void healthy('B2');
  void healthy('B3');

  let escaped: unknown;
  try {
    await vi.advanceTimersByTimeAsync(250);
  } catch (error) {
    escaped = error;
  }

  expect(escaped).toBeUndefined();        // Fails today: the exception escapes processPendingQueues.
  expect(log).toStrictEqual(['B1', 'B2', 'B3']); // Fails today: the shared loop aborts before reaching B.
});

test('A queue-full rejection (DropPolicy.Reject) still returns a cancelable promise', async () => {
  // `id: 0` keeps the queue private to this keeper, so tests never share state.
  const keeper = RateKeeper((value: number) => value, 50, {
    id: 0,
    maxQueueSize: 1,
    dropPolicy: DropPolicy.Reject
  });

  void keeper(0);           // Runs synchronously; the queue stays empty.
  const queued = keeper(1); // Occupies the only queue slot.
  const overflow = keeper(2); // Rejected: the queue is full.
  void overflow.catch(() => { /* Keep the rejection handled if an assertion below fails first. */ });

  expect(typeof overflow.cancel).toBe('function');
  await expect(overflow).rejects.toThrow();
  expect(await queued).toBe(1);
});

test('maxQueueSize without dropPolicy is not silently ignored (safe default: Reject)', async () => {
  // Alternative acceptable fix: reject the configuration at creation time.
  // Either way, the third call must not be silently queued past the bound.
  const keeper = RateKeeper((value: number) => value, 50, { id: 0, maxQueueSize: 1 });

  void keeper(0);           // Runs synchronously.
  const queued = keeper(1); // Occupies the only queue slot.
  const overflow = keeper(2); // Must not be queued: the bound has been reached.
  void overflow.catch(() => { /* Keep the rejection handled if an assertion below fails first. */ });

  await expect(overflow).rejects.toThrow();
  expect(await queued).toBe(1);
});

test('Invalid rateLimit values are rejected at creation time', () => {
  const action = (value: number) => value;

  expect(() => RateKeeper(action, Number.NaN)).toThrow();
  expect(() => RateKeeper(action, -1)).toThrow();
  expect(() => RateKeeper(action, Number.POSITIVE_INFINITY)).toThrow();
  expect(() => RateKeeper(action, Number.NEGATIVE_INFINITY)).toThrow();

  // Zero stays valid: it drains as fast as the event loop allows.
  expect(() => RateKeeper(action, 0)).not.toThrow();
});
