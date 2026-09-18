import init from './init.ts';
import { loadKeys } from './rehydrate.ts';
import { REMEMBER_REHYDRATED, REMEMBER_PERSISTED } from './action-types.ts';
import type { Driver, Options, RememberEnhancerStoreExt } from './types.ts';
import type {
  Action,
  StoreEnhancer,
  Reducer,
  Store,
  StoreCreator,
  ReducersMapObject,
  UnknownAction
} from 'redux';
import { combineReducers } from 'redux';

export * from './errors.ts';
export * from './types.ts';

const rememberReducer = <S = any, A extends Action = UnknownAction, PreloadedState = S>(
  reducer: Reducer<S, A, PreloadedState> | ReducersMapObject<S, A, PreloadedState>
): Reducer<S, A, PreloadedState> => {
  const data: any = {
    state: {}
  };

  return (state: any = data.state, action: any) => {
    if (action.type && (
      action?.type === '@@INIT'
      || action?.type?.startsWith('@@redux/INIT')
    )) {
      data.state = { ...state };
    }

    const rootReducer = typeof reducer === 'function'
      ? reducer
      : combineReducers(reducer);

    switch (action.type) {
      case REMEMBER_REHYDRATED: {
        const rehydratedState = {
          ...data.state,
          ...(action?.payload || {})
        };

        data.state = rootReducer(
          rehydratedState,
          {
            type: REMEMBER_REHYDRATED,
            payload: rehydratedState
          } as any
        );

        return data.state;
      }
      default:
        return rootReducer(
          state,
          action
        );
    }
  };
};

const rememberEnhancer = <Ext extends {} = RememberEnhancerStoreExt, StateExt extends {} = {}>(
  driver: Driver,
  rememberedKeys: string[],
  {
    prefix = '@@remember-',
    serialize = (data) => JSON.stringify(data),
    unserialize = (data) => JSON.parse(data),
    migrate = (state) => state,
    persistThrottle = 100,
    persistDebounce,
    persistWholeStore = false,
    initActionType,
    errorHandler = console.warn
  }: Partial<Options> = {}
): StoreEnhancer<Ext, StateExt> => {
  const storeCreator = (createStore: StoreCreator): StoreCreator => (
    rootReducer: Reducer<any>,
    preloadedState?: any,
    enhancer?: StoreEnhancer
  ): Store => {
    // Owned by this store. store.unsafeRehydrate() appends to it and init()
    // holds the same reference, so keys added later start being persisted.
    // The caller's own array is never mutated.
    const keys = [...rememberedKeys];

    let isInitialized = false;
    let initialized: Promise<void> | undefined;

    const initialize = (store: Store) => {
      initialized = init(
        store,
        keys,
        {
          driver,
          prefix,
          serialize,
          unserialize,
          migrate,
          persistThrottle,
          persistDebounce,
          persistWholeStore,
          errorHandler
        }
      );

      return initialized;
    };

    const store: Store = createStore(
      (state, action) => {
        if (!isInitialized
          && initActionType
          && action.type === initActionType
        ) {
          isInitialized = true;
          setTimeout(() => initialize(store), 0);
        }

        return rootReducer(state, action);
      },
      preloadedState,
      enhancer
    );

    // Rehydrate (and start remembering) additional keys after the store exists.
    // This is what makes lazy-loaded / injected reducers work: inject the
    // reducer, then `await store.unsafeRehydrate([key])` to load its persisted
    // value and keep persisting it from then on. With no arguments it re-reads
    // every currently remembered key.
    //
    // Deliberately named "unsafe": it re-dispatches REMEMBER_REHYDRATED, which
    // consumers are otherwise documented to see exactly once, and it overlays
    // stored data on top of live state. See the docs for the full caveats.
    const unsafeRehydrate = async (keysToLoad: string[] = [...keys]): Promise<void> => {
      // Never race the initial rehydration - its payload would roll this back.
      await initialized;

      const loaded = await loadKeys(
        keysToLoad,
        { prefix, driver, unserialize, persistWholeStore, errorHandler }
      );

      // A failed read must not add the keys to the remembered set: the next
      // persist would write the slice's initial state over good stored data.
      if (!loaded) {
        return;
      }

      keysToLoad.forEach((key) => {
        if (!keys.includes(key)) {
          keys.push(key);
        }
      });

      // getState() is read here - after the await, in the same tick as the
      // dispatch - so anything dispatched while storage was being read is kept
      // rather than rolled back to a pre-read snapshot.
      //
      // `migrate` is intentionally not applied: it is a whole-state, run-once
      // function, and re-running it over already-migrated state is unsound.
      store.dispatch({
        type: REMEMBER_REHYDRATED,
        payload: {
          ...store.getState(),
          ...loaded
        }
      });
    };

    if (!initActionType) {
      isInitialized = true;
      void initialize(store);
    }

    return Object.assign(store, { unsafeRehydrate });
  };

  return storeCreator;
};

export {
  rememberReducer,
  rememberEnhancer,
  REMEMBER_REHYDRATED,
  REMEMBER_PERSISTED
};
