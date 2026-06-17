// Tiny error helper shared by the state stores (pure, no DOM/IPC).
//
// Backend calls cross the IPC seam and reject with either a real `Error` or a
// stringified Rust error (`Result<T, String>`); the stores capture a
// user-facing message from whichever shape arrives.

/** The message of an `Error`, or the stringified value for anything else. */
export function errMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
