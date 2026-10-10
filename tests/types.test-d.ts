// Type-level regression test: an async action must be typed with its awaited
// result, so `.then`/`await` consumers see `number`, not `Promise<number>`.
// Run with `npx vitest run --typecheck.only` (plain `vitest run` skips it).
import { expectTypeOf } from 'vitest'
import RateKeeper, { CancelablePromise } from '../src/index';

const asyncKeeper = RateKeeper(async (value: number) => value + 1, 100);
expectTypeOf(asyncKeeper).returns.toEqualTypeOf<CancelablePromise<number>>();
