// Web storage that can never crash the app.
//
// localStorage / sessionStorage are not always reachable. When a browser is
// set to block site data - Chrome's "Block all cookies", some incognito
// configurations, sandboxed iframes, certain in-app browsers - the *property
// access itself* throws:
//
//   SecurityError: Failed to read the 'localStorage' property from 'Window':
//   Access is denied for this document.
//
// Note the failure mode carefully: `typeof localStorage !== 'undefined'` is
// NOT a valid guard. localStorage is a declared getter on Window, so the
// typeof check invokes that getter and throws exactly like a direct read.
// Only try/catch works. A throw inside a useState initializer takes down the
// whole app at boot, which is what these helpers exist to prevent.
//
// When real storage is unavailable everything falls back to an in-memory map:
// preferences still behave correctly for the rest of the visit, they just
// don't survive a reload. That is the right trade - a user who blocks storage
// is asking for exactly that, and it beats a blank error screen.

const memory = new Map<string, string>()

const memKey = (session: boolean, key: string) => (session ? 's:' : 'l:') + key

function backing(session: boolean): Storage | null {
  try {
    return session ? window.sessionStorage : window.localStorage
  } catch {
    return null
  }
}

/** Read a key. Returns null when absent, and never throws. */
export function storageGet(key: string, session = false): string | null {
  try {
    const value = backing(session)?.getItem(key)
    if (value != null) return value
  } catch {
    /* fall through to the in-memory copy */
  }
  return memory.get(memKey(session, key)) ?? null
}

/** Write a key. Falls back to memory on blocked storage or a full quota. */
export function storageSet(key: string, value: string, session = false): void {
  memory.set(memKey(session, key), value)
  try {
    backing(session)?.setItem(key, value)
  } catch {
    /* memory copy above is the fallback */
  }
}

/** Remove a key from both real storage and the in-memory fallback. */
export function storageRemove(key: string, session = false): void {
  memory.delete(memKey(session, key))
  try {
    backing(session)?.removeItem(key)
  } catch {
    /* nothing to do - the value is already gone from memory */
  }
}
