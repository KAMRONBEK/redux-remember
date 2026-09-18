---
title: rememberEnhancer
---

A Redux enhancer that handles automatic state persistence and rehydration.

## Signature

```ts
rememberEnhancer(
  driver: Driver,
  rememberedKeys: string[],
  options?: Options
): StoreEnhancer
```

See [Driver](./types.md#driver) and [Options](./types.md#options) type definitions.

## Parameters

### 1. driver *(required)*

- Type: [`Driver`](./types.md#driver)
- Description: Storage driver instance that implements `setItem(key, value)` and `getItem(key)`

**Built-in Options:**
- `window.localStorage` - Persistent storage (web)
- `window.sessionStorage` - Session storage (web)
- `AsyncStorage` - Async storage (React Native)
- Custom driver - Any object implementing the Driver interface

**Driver Interface:**
```ts
interface Driver {
  setItem(key: string, value: any): void | Promise<void>;
  getItem(key: string): any | Promise<any>;
}
```

### 2. rememberedKeys *(required)*

- Type: `string[]`
- Description: Array of state keys to persist
- Note: If an empty array is provided, nothing will be persisted

### 3. options *(optional)*

- Type: [`Options`](./types.md#options)
- Description: Configuration object for customizing behavior

**Options Interface:** (see [Options](./types.md#options))
```ts
interface Options {
  prefix?: string;
  serialize?: (state: any, key: string) => string;
  unserialize?: (state: string, key: string) => any;
  migrate?: (state: any) => any;
  persistThrottle?: number;
  persistDebounce?: number;
  persistWholeStore?: boolean;
  errorHandler?: (error: PersistError | RehydrateError | MigrateError) => void;
  initActionType?: string;
}
```

## Options Details

### prefix

- **Type:** `string`
- **Default:** `'@@remember-'`
- **Description:** Prefix for storage keys

### serialize

- **Type:** `(state: any, key: string) => string`
- **Default:** `JSON.stringify`
- **Description:** Function to serialize state before persisting
- **Error Handling:** If `serialize` throws an error, it's caught and passed to `errorHandler`

### unserialize

- **Type:** `(state: string, key: string) => any`
- **Default:** `JSON.parse`
- **Description:** Function to deserialize persisted state
- **Error Handling:** If `unserialize` throws an error, it's caught and passed to `errorHandler`

### migrate

- **Type:** `(state: any) => any`
- **Default:** `(state) => state` (identity function - returns state unchanged)
- **Description:** Function to transform persisted state during rehydration
- **Use Cases:**
  - Migrating state when your app's data schema changes between versions
  - Adding new required fields with default values
  - Removing deprecated fields from old persisted state
  - Changing fields names or even the whole data format
- **Timing:** Called after successful rehydration, before dispatching `REMEMBER_REHYDRATED`. Migration is skipped if rehydration fails.
- **Error Handling:** If `migrate` throws an error, it's caught and passed to `errorHandler` as a [`MigrateError`](./types.md#migrateerror), and the default store state (from reducer initial values) is used to prevent the app from crashing
- **Tip:** It is highly recommended that you use use [Redux Remigrate](../usage/migrations.md) for type-safe migrations with auto-generated version types and CLI tooling.

**Example - using Redux Remigrate (recommended):**

- See [Migrations with Redux Remigrate](../usage/migrations.md)

**Example - using manual migration (alternative):**
```ts
// Migrate state when schema changes between versions
rememberEnhancer(window.localStorage, rememberedKeys, {
  migrate: (state) => {
    // Add version tracking if not present
    if (!state._version) {
      return { ...state, _version: 1 };
    }

    // Migrate from v1 to v2: rename 'userName' to 'displayName'
    if (state._version === 1) {
      const { userName, ...rest } = state.user || {};
      return {
        ...state,
        _version: 2,
        user: { ...rest, displayName: userName }
      };
    }

    return state;
  }
})
```

### persistThrottle

- **Type:** `number` (milliseconds)
- **Default:** `100`
- **Description:** Throttle persistence to limit write frequency
- **Note:** Ignored if `persistDebounce` is provided
- **Best for:** Most apps/websites, guarantees your store is persisted on regular intervals

### persistDebounce

- **Type:** `number` (milliseconds)
- **Default:** `undefined`
- **Description:** Debounce persistence (trailing-edge only)
- **Note:** If provided, `persistThrottle` is ignored
- **Best for:** Apps/websites where you can guarantee there is some time between store writes and you could tollerate some data loss

**Example:**
```ts
// Debounce for form input
rememberEnhancer(window.localStorage, rememberedKeys, {
  persistDebounce: 500 // Wait 500ms after user stops typing
})

// Throttle for real-time updates
rememberEnhancer(window.localStorage, rememberedKeys, {
  persistThrottle: 200 // Save at most once every 200ms
})
```

### persistWholeStore

- **Type:** `boolean`
- **Default:** `false`
- **Description:** Whether to persist the entire store as a single item
- **Storage Limits:**
  - `localStorage`: ~5-10MB (varies by browser)
  - `sessionStorage`: ~5-10MB (varies by browser)
  - `AsyncStorage`: ~6MB on Android, larger on iOS
- **Warnings:**
  - Only use with storage drivers that have large enough limits for your use-case
  - When persisting large states, consider using individual key persistence (default behavior) to avoid quota errors
  - Always implement error handling to catch quota exceeded errors
- **Note:** When `true`, the `key` parameter is not passed to `serialize`/`unserialize` functions

### errorHandler

- **Type:** `(error: `[`PersistError`](./types.md#persisterror)` | `[`RehydrateError`](./types.md#rehydrateerror)` | `[`MigrateError`](./types.md#migrateerror)`) => void`
- **Default:** `console.warn`
- **Description:** Hook function to handle persistence, rehydration, and migration errors
- **Note:** Error objects include full stack traces
- **See:** [Error Handling Guide](../usage/error-handling.md) for complete examples

### initActionType

- **Type:** `string`
- **Default:** `undefined`
- **Description:** Action type to wait for before initializing
- **Use Case:** When you need to do something before state rehydration (e.g., SSR preloading)
- **Note:** Redux Remember will be completely disabled until an action with this type is dispatched

## Returns

- Type: `StoreEnhancer`
- Description: A Redux enhancer to be used with your store

## Store Methods

### store.unsafeRehydrate

- **Type:** `(keys?: string[]) => Promise<void>`
- **Description:** Reads the given keys from storage, rehydrates them into the store, and adds them to the remembered set so they are persisted from then on. Called with no arguments, it re-reads every currently remembered key.
- **Use Case:** Rehydrating a [lazy-loaded (injected) reducer](../usage/lazy-loaded-reducers.md) whose key was not known when the store was created
- **Why "unsafe":** It dispatches [`REMEMBER_REHYDRATED`](./actions.md#remember_rehydrated) again, which the rest of the documentation describes as happening exactly once, and it overlays whatever is in storage on top of live state. Both are fine when you call it deliberately, right after injecting a reducer; neither is safe on a timer or in response to arbitrary events.
- **Notes:**
  - [`migrate`](#migrate) is **not** applied. It is a whole-state, run-once function, and re-running it over already-migrated state would corrupt it. If the lazy slice's stored data needs migrating, migrate it inside its own `unserialize`.
  - If the read fails, the error goes to [`errorHandler`](#errorhandler), no action is dispatched, and the keys are **not** added to the remembered set — so a transient storage failure cannot cause the slice's initial state to be written over good stored data.
  - The returned promise resolves once the state has been rehydrated, so you can `await` it before rendering the lazy route.
  - With [`initActionType`](#initactiontype) set, call it only after that action has been dispatched. Before then Redux Remember is disabled, and the initial rehydration would later overwrite what you loaded.

**Example:**
```ts
rootReducer.inject(lazyPersistedSlice);
await store.unsafeRehydrate(['lazyPersisted']);
```

See [Lazy-loaded Reducers](../usage/lazy-loaded-reducers.md) for the full walkthrough.

## See Also

- [rememberReducer](./remember-reducer.md) - Wrap your reducers
- [Types](./types.md) - TypeScript type definitions
- [Migrations with Redux Remigrate](../usage/migrations.md) - Use Redux Remigrate for migrations with auto-generated types and CLI tooling
- [Error Handling](../usage/error-handling.md)
- [Custom Storage Driver](../usage/custom-storage-driver.md)
- [Quick Start](../quick-start.md)
