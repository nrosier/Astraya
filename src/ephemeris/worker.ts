/**
 * Worker host for the Swiss Ephemeris engine.
 *
 * This is the only place in a running Astraya where WebAssembly executes. It sits
 * off the UI thread because a full chart is hundreds of ephemeris calls, and
 * because `swe_set_sid_mode` and `swe_set_topo` mutate global state on the WASM
 * instance: confining that state to one thread with one serialised request queue
 * is what makes it safe to reason about.
 */

import { SwissEphemerisEngine, type EngineConfig } from './engine.js';
import { serializeError, type EphemerisRequest, type EphemerisResponse } from './protocol.js';
import type { EphemerisProvider } from './types.js';

/**
 * Execute one request against an engine.
 *
 * Deliberately an explicit switch rather than `engine[request.method](...)`. A
 * dynamic lookup would let any incoming string reach any property on the engine
 * or its prototype, and would type the arguments as `unknown[]`. Here each call
 * is checked against the real signature, and the `never` default means adding a
 * method to `EphemerisProvider` breaks the build until it is handled.
 */
export async function dispatch(engine: EphemerisProvider, request: EphemerisRequest): Promise<unknown> {
  switch (request.method) {
    case 'initialize':
      return engine.initialize(...request.args);
    case 'julianDay':
      return engine.julianDay(...request.args);
    case 'julianDayFromUtc':
      return engine.julianDayFromUtc(...request.args);
    case 'position':
      return engine.position(...request.args);
    case 'positions':
      return engine.positions(...request.args);
    case 'houses':
      return engine.houses(...request.args);
    case 'houseSystemName':
      return engine.houseSystemName(...request.args);
    case 'ayanamsa':
      return engine.ayanamsa(...request.args);
    case 'ayanamsaName':
      return engine.ayanamsaName(...request.args);
    case 'obliquity':
      return engine.obliquity(...request.args);
    case 'fixedStar':
      return engine.fixedStar(...request.args);
    case 'fixedStarMagnitude':
      return engine.fixedStarMagnitude(...request.args);
    case 'nextSunCrossing':
      return engine.nextSunCrossing(...request.args);
    case 'nextMoonCrossing':
      return engine.nextMoonCrossing(...request.args);
    case 'version':
      return engine.version(...request.args);
    case 'dispose':
      return engine.dispose(...request.args);
    default: {
      const unreachable: never = request;
      throw new Error(`Unknown ephemeris method: ${JSON.stringify(unreachable)}`);
    }
  }
}

/** The slice of `DedicatedWorkerGlobalScope` this module actually uses. */
export interface WorkerScope {
  addEventListener(type: 'message', listener: (event: MessageEvent<EphemerisRequest>) => void): void;
  postMessage(message: EphemerisResponse): void;
  close?(): void;
}

/**
 * Wire a scope up to an engine.
 *
 * Requests are queued rather than run concurrently, because the WASM instance
 * carries mutable sidereal-mode and observer state that two interleaved calls
 * could read from each other.
 *
 * Today the engine happens not to need this: every method sets that state and
 * reads it back in one synchronous block, so nothing can interleave. Verified by
 * removing the queue, at which point the concurrency tests still passed. The
 * queue is kept as defence in depth for the moment a method gains an internal
 * `await` — lazily loading an asteroid file mid-call, say — since that would
 * reintroduce the hazard silently and produce charts wrong by a whole ayanamsa.
 * `serialises calls` in the bridge tests pins the guarantee independently of
 * whether the engine currently relies on it.
 */
export function serveEphemeris(scope: WorkerScope, engine: EphemerisProvider): void {
  let queue: Promise<void> = Promise.resolve();

  scope.addEventListener('message', (event) => {
    const request = event.data;
    queue = queue.then(async () => {
      let response: EphemerisResponse;
      try {
        response = { id: request.id, ok: true, value: await dispatch(engine, request) };
      } catch (error) {
        response = { id: request.id, ok: false, error: serializeError(error) };
      }
      scope.postMessage(response);
      if (request.method === 'dispose' && response.ok) scope.close?.();
    });
  });
}

/** Overrides for asset URLs, injected by the client so paths live in one place. */
export type WorkerConfig = EngineConfig;

// Self-start only when genuinely running as a dedicated worker. The guard keeps
// the module importable from tests, which exercise `dispatch` and `serveEphemeris`
// directly without a Worker.
if (typeof DedicatedWorkerGlobalScope !== 'undefined' && globalThis instanceof DedicatedWorkerGlobalScope) {
  serveEphemeris(globalThis, new SwissEphemerisEngine());
}
