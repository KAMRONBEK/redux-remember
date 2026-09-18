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

Call [`store.unsafeRehydrate(keys)`](../api/remember-enhancer.md#storeunsaferehydrate) after injecting the reducer. It reads those keys from storage, rehydrates them into the store, and adds them to the remembered set so they're persisted from then on:

```ts
const rootReducer = combineSlices(baseSlice);

const store = configureStore({
  reducer: rememberReducer(rootReducer),
  enhancers: (getDefaultEnhancers) => getDefaultEnhancers().concat(
    rememberEnhancer(window.localStorage, ['base'])
  ),
});

// when the lazy slice loads:
rootReducer.inject(lazyPersistedSlice);         // 1. add the reducer to the tree
await store.unsafeRehydrate(['lazyPersisted']); // 2. load its persisted state
```

After this, `lazyPersisted` holds its stored value and is persisted on every change like any statically-defined key. Called with no arguments, `store.unsafeRehydrate()` re-reads every currently remembered key.

## Why "unsafe"?

The method is named `unsafeRehydrate` because it does two things the rest of Redux Remember does not:

- It dispatches [`REMEMBER_REHYDRATED`](../api/actions.md#remember_rehydrated) again, which is otherwise documented as happening exactly once per store. Reducers that flip a one-way flag (such as a [Rehydration Gate](./rehydration-gate.md)) will see it a second time.
- It overlays whatever is in storage on top of live state. That is exactly what you want immediately after injecting a reducer, and it is not what you want in response to arbitrary events.

Within those bounds it is safe by construction:

- Actions dispatched while storage is being read are **not** rolled back — the state is re-read after the load, immediately before dispatching.
- Concurrent calls do not revert each other, so you can inject several lazy slices at once.
- A key only starts being persisted **after** its stored value has been loaded, so a slow driver or a failed read can never cause the slice's initial state to overwrite good stored data.
- [`migrate`](../api/remember-enhancer.md#migrate) is not re-run. It is a whole-state, run-once function; if a lazy slice's stored data needs migrating, do it in that slice's `unserialize`.

Two things to keep in mind:

- Await the returned promise before rendering the lazy route, otherwise it renders with initial state and then jumps to the stored value.
- If you use [`initActionType`](../api/remember-enhancer.md#initactiontype), call `unsafeRehydrate` only after that action has been dispatched — before then Redux Remember is disabled, and the initial rehydration would later overwrite what you loaded.

## See Also

- [`rememberEnhancer`](../api/remember-enhancer.md) — the `rememberedKeys` option and the [`store.unsafeRehydrate`](../api/remember-enhancer.md#storeunsaferehydrate) method
- [`REMEMBER_REHYDRATED`](../api/actions.md#remember_rehydrated)
- [Using in Reducers](./using-in-reducers.md)
