---
title: Lazy-loaded (injected) reducers
---

Redux Remember doesn't add lazy-loaded / injected reducers as a first-class feature. Injecting a reducer that is *also* persisted introduces an ordering (race) condition between when the reducer becomes available and when Redux Remember reads storage, so it's left as an opt-in pattern rather than something built in. This page covers the two cases that come up and how each behaves.

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

Redux Remember only ever touches the keys listed in `rememberedKeys`, so an injected slice that isn't listed is invisible to it — no rehydrate, no persist, no race.

## Persisted injected slices

If you want an injected slice to be persisted, ordering matters. Redux Remember reads storage and dispatches [`REMEMBER_REHYDRATED`](../api/actions.md#remember_rehydrated) once, when it initializes. A reducer injected *after* that point has already missed its rehydration, so its stored value is dropped and it starts from its initial state instead.

The `initActionType` option lines the two up. When it's set, Redux Remember holds off on initializing (reading storage and starting to persist) until you dispatch that action. So inject the reducer first, then dispatch the init action:

```ts
const rootReducer = combineSlices(baseSlice);

const store = configureStore({
  reducer: rememberReducer(rootReducer),
  enhancers: (getDefaultEnhancers) => getDefaultEnhancers().concat(
    rememberEnhancer(window.localStorage, ['base', 'lazyPersisted'], {
      initActionType: 'REMEMBER_INIT',
    })
  ),
});

// 1. inject the reducer so it exists in the state tree...
rootReducer.inject(lazyPersistedSlice);

// 2. ...then let Redux Remember read storage, with the slice already present
store.dispatch({ type: 'REMEMBER_INIT' });
```

Storage is now read after `lazyPersisted` is in the tree, so it rehydrates like any statically-defined key. Without `initActionType`, Redux Remember auto-initializes as soon as the store is created — before a later `inject()` runs — which is exactly the race that drops the stored value.

## See Also

- [`rememberEnhancer`](../api/remember-enhancer.md) — the `initActionType` and `rememberedKeys` options
- [`REMEMBER_REHYDRATED`](../api/actions.md#remember_rehydrated)
- [Using in Reducers](./using-in-reducers.md)
