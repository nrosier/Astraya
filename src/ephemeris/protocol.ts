/**
 * The wire protocol between the UI thread and the ephemeris worker.
 *
 * The request and response types are *derived* from `EphemerisProvider` rather
 * than written out by hand. Adding a method to the interface therefore extends
 * the protocol automatically and makes the worker's dispatch switch fail to
 * compile until it handles the new case — the protocol cannot drift out of step
 * with the engine.
 */

import type { EphemerisProvider } from './types.js';
import { EphemerisError, type EphemerisErrorContext } from './types.js';

/** Every callable method on the provider. */
export type EphemerisMethod = keyof EphemerisProvider;

/** The resolved result of a provider method, with the promise unwrapped. */
export type EphemerisResult<M extends EphemerisMethod> = Awaited<ReturnType<EphemerisProvider[M]>>;

/**
 * A call in flight. Discriminated on `method`, so narrowing a request also
 * narrows `args` to that method's exact parameter tuple.
 */
export type EphemerisRequest = {
  [M in EphemerisMethod]: {
    readonly id: number;
    readonly method: M;
    readonly args: Parameters<EphemerisProvider[M]>;
  };
}[EphemerisMethod];

export type EphemerisResponse =
  | { readonly id: number; readonly ok: true; readonly value: unknown }
  | { readonly id: number; readonly ok: false; readonly error: SerializedError };

/**
 * An error flattened for `postMessage`.
 *
 * Necessary because structured cloning preserves only the standard Error fields:
 * a cloned `EphemerisError` arrives as a plain `Error` with its `context` gone.
 * That context — which Swiss Ephemeris call failed, at which Julian day, for
 * which body — is the whole diagnostic value, so it is carried explicitly and
 * rebuilt on the far side.
 */
export interface SerializedError {
  readonly name: string;
  readonly message: string;
  readonly stack?: string;
  /** Present only for `EphemerisError`. */
  readonly context?: EphemerisErrorContext;
}

export function serializeError(error: unknown): SerializedError {
  if (error instanceof EphemerisError) {
    return {
      name: error.name,
      message: error.message,
      context: error.context,
      ...(error.stack === undefined ? {} : { stack: error.stack }),
    };
  }
  if (error instanceof Error) {
    return { name: error.name, message: error.message, ...(error.stack === undefined ? {} : { stack: error.stack }) };
  }
  // A thrown non-Error. Keep something readable rather than "[object Object]".
  return { name: 'Error', message: typeof error === 'string' ? error : JSON.stringify(error) };
}

/**
 * Rebuild a thrown value from the worker.
 *
 * The stack is stitched so it names the failing Swiss Ephemeris call *and* the UI
 * code that asked for it; a bare worker stack tells you nothing about the caller.
 */
export function deserializeError(error: SerializedError): Error {
  const rebuilt =
    error.context === undefined ? new Error(error.message) : new EphemerisError(error.message, error.context);
  if (error.context === undefined) rebuilt.name = error.name;
  if (error.stack !== undefined) {
    rebuilt.stack = `${error.stack}\n    --- via ephemeris worker ---\n${rebuilt.stack ?? ''}`;
  }
  return rebuilt;
}
