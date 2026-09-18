// End-to-end tests for store.unsafeRehydrate() against a real redux store and
// a real asynchronous driver. The guarantees below are all about *timing*
// between the storage read, the persist subscriber and unrelated dispatches, so
// they cannot be expressed with a mocked driver.
import { describe, it, expect, vi } from 'vitest';
import { legacy_createStore as createStore, combineReducers } from 'redux';
import type { Reducer } from 'redux';
import { rememberReducer, rememberEnhancer } from '../index.ts';

const delay = (msecs: number) => new Promise((resolve) => setTimeout(resolve, msecs));

type TestDriver = {
  data: Record<string, string>,
  delayMsecs: number,
  failingKeys: string[],
  getItem: (key: string) => Promise<string | null>,
  setItem: (key: string, value: string) => Promise<void>
};

const createDriver = (data: Record<string, string> = {}): TestDriver => {
  const driver: TestDriver = {
    data,
    delayMsecs: 0,
    failingKeys: [],

    getItem: async (key) => {
      await delay(driver.delayMsecs);

      if (driver.failingKeys.some((failing) => key.endsWith(failing))) {
        throw new Error(`cannot read ${key}`);
      }

      return driver.data[key] ?? null;
    },

    setItem: async (key, value) => {
      await delay(0);
      driver.data[key] = value;
    }
  };

  return driver;
};

const counter: Reducer<number> = (state = 0, action: any) => (
  action.type === 'increment' ? state + 1 : state
);

// stand-ins for lazily injected slices
const lazy: Reducer<{ value: string }> = (state = { value: 'initial' }) => state;
const otherLazy: Reducer<{ value: string }> = (state = { value: 'otherInitial' }) => state;

const rootReducer = combineReducers({ counter, lazy, otherLazy });

const createTestStore = (
  driver: TestDriver,
  rememberedKeys: string[],
  options: Record<string, any> = {}
) => createStore(
  rememberReducer(rootReducer) as Reducer,
  undefined,
  rememberEnhancer(driver, rememberedKeys, {
    errorHandler: vi.fn(),
    persistThrottle: 10,
    ...options
  })
) as any;

// the initial rehydration plus one throttle window
const settle = () => delay(30);

describe('store.unsafeRehydrate()', () => {
  it('loads the persisted value of a key that was not remembered at startup', async () => {
    const driver = createDriver({
      '@@remember-lazy': JSON.stringify({ value: 'persisted' })
    });

    const store = createTestStore(driver, ['counter']);
    await settle();

    expect(store.getState().lazy).toEqual({ value: 'initial' });

    await store.unsafeRehydrate(['lazy']);

    expect(store.getState().lazy).toEqual({ value: 'persisted' });
  });

  it('persists the newly remembered key from then on', async () => {
    const driver = createDriver();

    const store = createTestStore(driver, ['counter']);
    await settle();

    await store.unsafeRehydrate(['lazy']);

    store.dispatch({ type: 'increment' });
    await delay(40);

    expect(driver.data['@@remember-lazy']).toBe(
      JSON.stringify({ value: 'initial' })
    );
  });

  it('keeps actions dispatched while storage is being read', async () => {
    const driver = createDriver({
      '@@remember-lazy': JSON.stringify({ value: 'persisted' })
    });

    const store = createTestStore(driver, ['counter']);
    await settle();

    driver.delayMsecs = 50;
    const pending = store.unsafeRehydrate(['lazy']);

    await delay(10);
    store.dispatch({ type: 'increment' });

    await pending;

    // the rehydration must not roll the store back to a pre-read snapshot
    expect(store.getState().counter).toBe(1);
    expect(store.getState().lazy).toEqual({ value: 'persisted' });
  });

  it('does not overwrite stored data while the read is still in flight', async () => {
    const driver = createDriver({
      '@@remember-lazy': JSON.stringify({ value: 'persisted' })
    });

    const store = createTestStore(driver, ['counter']);
    await settle();

    driver.delayMsecs = 50;
    const pending = store.unsafeRehydrate(['lazy']);

    // an unrelated action runs the persist subscriber mid-read; the key must not
    // be persisted before its stored value has been loaded, or the slice's
    // initial state would be written over it
    await delay(10);
    store.dispatch({ type: 'increment' });
    await delay(25);

    expect(driver.data['@@remember-lazy']).toBe(
      JSON.stringify({ value: 'persisted' })
    );

    await pending;

    expect(store.getState().lazy).toEqual({ value: 'persisted' });
  });

  it('handles concurrent calls without reverting each other', async () => {
    const driver = createDriver({
      '@@remember-lazy': JSON.stringify({ value: 'persisted' }),
      '@@remember-otherLazy': JSON.stringify({ value: 'otherPersisted' })
    });

    const store = createTestStore(driver, ['counter']);
    await settle();

    driver.delayMsecs = 50;
    const first = store.unsafeRehydrate(['lazy']);
    await delay(10);
    const second = store.unsafeRehydrate(['otherLazy']);

    await Promise.all([first, second]);

    expect(store.getState().lazy).toEqual({ value: 'persisted' });
    expect(store.getState().otherLazy).toEqual({ value: 'otherPersisted' });
  });

  it('does not re-run migrate()', async () => {
    const driver = createDriver({
      '@@remember-lazy': JSON.stringify({ value: 'persisted' })
    });

    const migrate = vi.fn((state) => state);
    const store = createTestStore(driver, ['counter'], { migrate });
    await settle();

    expect(migrate).toHaveBeenCalledTimes(1);

    await store.unsafeRehydrate(['lazy']);

    // migrate() is a whole-state, run-once function
    expect(migrate).toHaveBeenCalledTimes(1);
  });

  it('leaves the callers rememberedKeys array untouched', async () => {
    const driver = createDriver();
    const rememberedKeys = ['counter'];

    const store = createTestStore(driver, rememberedKeys);
    await settle();

    await store.unsafeRehydrate(['lazy']);

    expect(rememberedKeys).toEqual(['counter']);
  });

  it('does not start persisting a key whose read failed', async () => {
    const driver = createDriver({
      '@@remember-lazy': JSON.stringify({ value: 'persisted' })
    });

    const errorHandler = vi.fn();
    const store = createTestStore(driver, ['counter'], { errorHandler });
    await settle();

    driver.failingKeys = ['lazy'];
    await store.unsafeRehydrate(['lazy']);

    expect(errorHandler).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'RehydrateError' })
    );

    driver.failingKeys = [];
    store.dispatch({ type: 'increment' });
    await delay(40);

    // stored data must survive a failed rehydration
    expect(driver.data['@@remember-lazy']).toBe(
      JSON.stringify({ value: 'persisted' })
    );
  });

  it('re-reads every remembered key when called with no arguments', async () => {
    const driver = createDriver({
      '@@remember-counter': JSON.stringify(7)
    });

    const store = createTestStore(driver, ['counter']);
    await settle();

    expect(store.getState().counter).toBe(7);

    // simulates another tab writing to storage
    driver.data['@@remember-counter'] = JSON.stringify(42);
    await store.unsafeRehydrate();

    expect(store.getState().counter).toBe(42);
  });
});
