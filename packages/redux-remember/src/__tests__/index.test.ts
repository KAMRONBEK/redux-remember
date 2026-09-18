import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from 'vitest';
import type * as indexModule from '../index.ts';
import * as actionTypes from '../action-types.ts';
import type { Reducer, ReducersMapObject, StoreCreator } from 'redux';
import type { Options } from '../types.ts';

describe('index.ts', () => {
  const mockRehydrate = {
    loadKeys: vi.fn(),
    rehydrateReducer: vi.fn(() => 'REHYDRATE_REDUCER')
  };

  let mockInit: Mock;
  let mockCombineReducers: Mock;
  let index: typeof indexModule;

  beforeEach(async () => {
    mockRehydrate.loadKeys = vi.fn(async () => ({}));
    mockRehydrate.rehydrateReducer = vi.fn(() => 'REHYDRATE_REDUCER');
    mockInit = vi.fn(() => {});
    mockCombineReducers = vi.fn(() => {});

    vi.doMock('../rehydrate.ts', () => mockRehydrate);
    vi.doMock('../init.ts', () => ({ default: mockInit }));
    vi.doMock('redux', async () => {
      return {
        ...(await vi.importActual('redux')),
        combineReducers: mockCombineReducers
      };
    });

    index = await import('../index.ts');
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it('exports proper items', () => {
    expect(index.REMEMBER_REHYDRATED).toEqual(
      actionTypes.REMEMBER_REHYDRATED
    );

    expect(index.REMEMBER_PERSISTED).toEqual(
      actionTypes.REMEMBER_PERSISTED
    );

    expect(typeof index.rememberReducer).toBe(
      'function'
    );

    expect(typeof index.rememberEnhancer).toBe(
      'function'
    );
  });

  describe('rememberReducer()', () => {
    let mockReducer: Reducer;

    const exec = (state: any, action: any) => (
      index.rememberReducer(mockReducer)(state, action)
    );

    beforeEach(() => {
      mockReducer = vi.fn((state: any) => state);
    });

    it('call combineReducers()', () => {
      const reducersObj: ReducersMapObject<any, any> = {
        dummy: () => 'test123'
      };

      const mockState = { dummy: 'test' };
      mockCombineReducers.mockReturnValue(() => mockState);

      expect(index.rememberReducer(reducersObj)(undefined, { type: 'TEST' })).toEqual(
        mockState
      );

      expect(mockCombineReducers).toHaveBeenCalledWith(reducersObj);
    });

    it('does not break when state and action are empty', () => {
      expect(exec(undefined, {})).toEqual(
        {}
      );
    });

    it('returns preloaded state', () => {
      const state = { cool: 'state' };

      expect(exec(state, { type: '@@INIT' })).toEqual(
        state
      );

      expect(exec(state, { type: '@@redux/INIT.12345' })).toEqual(
        state
      );
    });

    it('returns rehydrated state', () => {
      const payload = {
        wow: 'beep',
        nah: 'lol'
      };

      expect(exec(
        null,
        {
          type: actionTypes.REMEMBER_REHYDRATED,
          payload
        }
      )).toEqual(payload);
    });

    it('does not fail if there is missing payload', () => {
      expect(exec(
        null,
        { type: actionTypes.REMEMBER_REHYDRATED }
      )).toEqual({});
    });
  });

  describe('rememberEnhancer()', () => {
    const mockDriver = {
      getItem() {},
      setItem() {}
    };

    let mockCreateStore: StoreCreator;
    let mockStore: any;
    const rememberedKeys = ['zz', 'bb', 'kk'];
    const rootReducer = (state = {}) => state;
    let rootReducerWrapper: Reducer;
    const initialState = { myReducer: 'bla' };
    const enhancer: any = 'dummy enhancer';

    beforeEach(() => {
      mockStore = {
        name: 'my-mocked-store',
        getState: vi.fn(() => ({})),
        dispatch: vi.fn()
      };

      mockCreateStore = vi.fn((wrapper) => {
        rootReducerWrapper = wrapper;
        return mockStore;
      }) as StoreCreator;
    });

    it('calls createStore function and returns its result', () => {
      const enhancerInstance = index.rememberEnhancer(
        mockDriver,
        []
      );

      const storeMaker: StoreCreator = enhancerInstance(mockCreateStore);
      const res = storeMaker(
        rootReducer, initialState, enhancer
      );

      expect(mockCreateStore).toHaveBeenCalledWith(
        expect.any(Function), initialState, enhancer
      );

      expect(res).toEqual(mockStore);
    });

    it('calls init()', () => {
      const opts: Options = {
        prefix: '@@yay!',
        persistThrottle: 432,
        persistWholeStore: true,
        serialize: (o) => o,
        unserialize: (o) => o,
        migrate: (s) => s,
        errorHandler() {}
      };

      const storeMaker: StoreCreator = index.rememberEnhancer(
        mockDriver, rememberedKeys, opts
      )((() => mockStore) as StoreCreator);

      storeMaker(
        rootReducer, initialState, enhancer
      );

      expect(mockInit).toHaveBeenCalledWith(
        mockStore,
        rememberedKeys,
        { driver: mockDriver, ...opts }
      );
    });

    it('calls init() with default options', () => {
      let optionDefaults: any;
      mockInit.mockImplementationOnce((_store, _rememberedKeys, opts) => {
        optionDefaults = opts;
      });

      const storeMaker: StoreCreator = index.rememberEnhancer(
        mockDriver, rememberedKeys
      )((() => mockStore) as StoreCreator);

      storeMaker(
        rootReducer, initialState, enhancer
      );

      expect(mockInit).toHaveBeenCalledWith(
        mockStore,
        rememberedKeys,
        { driver: mockDriver, ...optionDefaults }
      );

      const stringifySpy = vi.spyOn(JSON, 'stringify');
      const parseSpy = vi.spyOn(JSON, 'parse');

      expect(optionDefaults).toMatchObject({
        prefix: '@@remember-',
        persistThrottle: 100,
        persistWholeStore: false
      });
      expect(optionDefaults.serialize('hello', 'auth')).toEqual('"hello"');
      expect(stringifySpy).toHaveBeenCalledWith('hello');
      expect(optionDefaults.unserialize('"bye"', 'auth')).toEqual('bye');
      expect(parseSpy).toHaveBeenCalledWith('"bye"');
      expect(optionDefaults.migrate('unchanged')).toBe('unchanged');
    });

    it('calls init() only once after the init action is dispatched', () => {
      vi.useFakeTimers();

      const initActionType = 'WAIT_FOR_ME_BEFORE_INIT';
      const opts: Options = {
        prefix: '@@very-cool-prefix!',
        persistThrottle: 42,
        persistWholeStore: true,
        serialize: (o) => o,
        unserialize: (o) => o,
        migrate: (s) => s,
        errorHandler() {}
      };

      const storeMaker: StoreCreator = index.rememberEnhancer(
        mockDriver, rememberedKeys, { ...opts, initActionType }
      )(mockCreateStore);

      storeMaker(
        rootReducer, initialState, enhancer
      );

      expect(mockInit).not.toHaveBeenCalled();
      rootReducerWrapper({}, { type: initActionType });
      vi.advanceTimersByTime(1);

      expect(mockInit).toHaveBeenCalledWith(
        mockStore,
        rememberedKeys,
        { driver: mockDriver, ...opts }
      );

      rootReducerWrapper({}, { type: initActionType });
      expect(mockInit).toHaveBeenCalledTimes(1);

      vi.clearAllTimers();
      vi.useRealTimers();
    });

    it('exposes store.unsafeRehydrate() and reads the requested keys', async () => {
      const storeMaker: StoreCreator = index.rememberEnhancer(
        mockDriver, [...rememberedKeys]
      )((() => mockStore) as StoreCreator);

      const store: any = storeMaker(rootReducer, initialState, enhancer);

      expect(typeof store.unsafeRehydrate).toBe('function');

      await store.unsafeRehydrate(['newKey']);

      expect(mockRehydrate.loadKeys).toHaveBeenCalledWith(
        ['newKey'],
        expect.objectContaining({
          driver: mockDriver,
          prefix: '@@remember-'
        })
      );
    });

    it('store.unsafeRehydrate() does not apply migrate()', async () => {
      const storeMaker: StoreCreator = index.rememberEnhancer(
        mockDriver, [...rememberedKeys], { migrate: (state) => state }
      )((() => mockStore) as StoreCreator);

      const store: any = storeMaker(rootReducer, initialState, enhancer);

      await store.unsafeRehydrate(['newKey']);

      // migrate() is a whole-state, run-once function - re-running it over
      // already-migrated state would be unsound
      const [, loadOptions] = mockRehydrate.loadKeys.mock.calls[0];
      expect(loadOptions).not.toHaveProperty('migrate');
    });

    it('store.unsafeRehydrate() remembers new keys without mutating the caller array', async () => {
      const callerKeys = ['aa', 'bb'];

      const storeMaker: StoreCreator = index.rememberEnhancer(
        mockDriver, callerKeys
      )((() => mockStore) as StoreCreator);

      const store: any = storeMaker(rootReducer, initialState, enhancer);

      await store.unsafeRehydrate(['aa', 'cc']);

      // the array the caller passed in is left alone
      expect(callerKeys).toEqual(['aa', 'bb']);

      // the store's own copy - shared with init() - gained 'cc' and did not
      // duplicate 'aa', so 'cc' is persisted from now on
      const [, storeKeys] = mockInit.mock.calls[0];
      expect(storeKeys).toEqual(['aa', 'bb', 'cc']);
    });

    it('store.unsafeRehydrate() with no arguments re-reads every remembered key', async () => {
      const storeMaker: StoreCreator = index.rememberEnhancer(
        mockDriver, ['aa', 'bb']
      )((() => mockStore) as StoreCreator);

      const store: any = storeMaker(rootReducer, initialState, enhancer);

      await store.unsafeRehydrate();

      expect(mockRehydrate.loadKeys).toHaveBeenCalledWith(
        ['aa', 'bb'],
        expect.objectContaining({ driver: mockDriver })
      );
    });

    it('store.unsafeRehydrate() dispatches the state as of after the read', async () => {
      mockStore.getState = vi.fn(() => ({ counter: 1 }));

      // state moves on while storage is being read
      mockRehydrate.loadKeys = vi.fn(async () => {
        mockStore.getState = vi.fn(() => ({ counter: 2 }));
        return { lazy: 'loaded' };
      });

      const storeMaker: StoreCreator = index.rememberEnhancer(
        mockDriver, ['counter']
      )((() => mockStore) as StoreCreator);

      const store: any = storeMaker(rootReducer, initialState, enhancer);

      await store.unsafeRehydrate(['lazy']);

      // the payload must carry the post-read state, otherwise anything
      // dispatched during the read is rolled back
      expect(mockStore.dispatch).toHaveBeenCalledWith({
        type: actionTypes.REMEMBER_REHYDRATED,
        payload: { counter: 2, lazy: 'loaded' }
      });
    });

    it('store.unsafeRehydrate() does nothing when the read fails', async () => {
      mockRehydrate.loadKeys = vi.fn(async () => undefined);

      const storeMaker: StoreCreator = index.rememberEnhancer(
        mockDriver, ['aa']
      )((() => mockStore) as StoreCreator);

      const store: any = storeMaker(rootReducer, initialState, enhancer);

      await store.unsafeRehydrate(['bb']);

      expect(mockStore.dispatch).not.toHaveBeenCalled();

      // 'bb' must not start being persisted - the next persist would write the
      // slice's initial state over whatever is already in storage
      const [, storeKeys] = mockInit.mock.calls[0];
      expect(storeKeys).toEqual(['aa']);
    });

    it('store.unsafeRehydrate() waits for the initial rehydration', async () => {
      let finishInit = () => {};
      mockInit.mockImplementationOnce(() => new Promise<void>((resolve) => {
        finishInit = resolve;
      }));

      const storeMaker: StoreCreator = index.rememberEnhancer(
        mockDriver, ['aa']
      )((() => mockStore) as StoreCreator);

      const store: any = storeMaker(rootReducer, initialState, enhancer);

      const pending = store.unsafeRehydrate(['bb']);
      await Promise.resolve();

      // init() is still loading - reading now would let its dispatch roll us back
      expect(mockRehydrate.loadKeys).not.toHaveBeenCalled();

      finishInit();
      await pending;

      expect(mockRehydrate.loadKeys).toHaveBeenCalledWith(
        ['bb'],
        expect.objectContaining({ driver: mockDriver })
      );
    });
  });
});
