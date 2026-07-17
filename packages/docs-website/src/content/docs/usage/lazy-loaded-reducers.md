---
title: Lazy-loaded (injected) reducers
---

Redux Remember supports lazy-loaded / injected reducers — reducers you add to the store after it's been created, for example a code-split slice that loads when the user navigates to a route. There are two cases, depending on whether the injected slice is persisted.

## Non-persisted injected slices

If an injected slice is not persisted (its key isn't in `rememberedKeys`), there's nothing special to do. Pass a dynamic root reducer — for example Redux Toolkit's [`combineSlices`](https://redux-toolkit.js.org/api/combineSlices) — to `rememberReducer`, and inject whenever you like:

```ts
import { configureStore, combineSlices } from '@reduxjs/toolkit';
import { rememberReducer, rememberEnhancer } from 'redux-remember';

const rootReducer = combineSlices(baseSlice);

const store = configureStore({
  reducer: rememberReducer(rootReducer),
  enhancers: (getDefaultEnhancers) => getDefaultEnhancers().concat(
    // the lazy slice's key is deliberately NOT listed here
    rememberEnhancer(window.localStorage, ['base'])
  ),
});

// later, on demand:
rootReducer.inject(lazySlice);
```

Redux Remember only ever touches the keys listed in `rememberedKeys`, so an injected slice that isn't listed is invisible to it — no rehydrate, no persist.

## Persisted injected slices

For a slice you *do* want persisted, timing matters. Redux Remember reads storage and dispatches [`REMEMBER_REHYDRATED`](../api/actions.md#remember_rehydrated) once, when it initializes. A reducer injected after that point has already missed its rehydration, so its stored value would be dropped and it would start from its initial state.

Call [`store.rehydrate(keys)`](../api/remember-enhancer.md) after injecting the reducer. It reads those keys from storage, rehydrates them into the store, and adds them to the remembered set so they're persisted from then on:

```ts
const rootReducer = combineSlices(baseSlice);

const store = configureStore({
  reducer: rememberReducer(rootReducer),
  enhancers: (getDefaultEnhancers) => getDefaultEnhancers().concat(
    rememberEnhancer(window.localStorage, ['base'])
  ),
});

// when the lazy slice loads:
rootReducer.inject(lazyPersistedSlice);   // 1. add the reducer to the tree
await store.rehydrate(['lazyPersisted']); // 2. load its persisted state
```

After this, `lazyPersisted` holds its stored value and is persisted on every change like any statically-defined key. Called with no arguments, `store.rehydrate()` re-reads every currently remembered key.

## See Also

- [`rememberEnhancer`](../api/remember-enhancer.md) — the `rememberedKeys` option and the `store.rehydrate` method
- [`REMEMBER_REHYDRATED`](../api/actions.md#remember_rehydrated)
- [Using in Reducers](./using-in-reducers.md)
