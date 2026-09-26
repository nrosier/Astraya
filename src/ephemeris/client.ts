/**
 * UI-thread client for the ephemeris worker.
 *
 * `WorkerEphemerisProvider` implements the same `EphemerisProvider` interface as
 * `SwissEphemerisEngine`, so `src/astrology/**` and the UI cannot tell which one
 * they hold. That is why every method on the interface is async: the worker is
 * invisible rather than special-cased, and tests can swap in the direct engine.
 */

import {
  deserializeError,
  type EphemerisMethod,
  type EphemerisRequest,
  type EphemerisResponse,
  type EphemerisResult,
} from './protocol.js';
import type {
  AzimuthAltitudeOptions,
  BodyId,
  BodyPosition,
  CalendarSystem,
  Degrees,
  EphemerisProvider,
  FixedStarMagnitude,
  FixedStarPosition,
  GeoPosition,
  HorizontalPosition,
  HousePositions,
  HouseSystem,
  JulianDayUT,
  PositionOptions,
  Zodiac,
} from './types.js';

/**
 * The transport the client talks over.
 *
 * An interface rather than a hard dependency on `Worker` so the protocol can be
 * tested end to end in Node — including error round-tripping — without pulling in
 * a Worker polyfill. The production implementation is `workerTransport`.
 */
export interface EphemerisTransport {
  send(request: EphemerisRequest): void;
  onMessage(handler: (response: EphemerisResponse) => void): void;
  /** Reports transport-level failure: the worker died or failed to load. */
  onError(handler: (error: Error) => void): void;
  close(): void;
}

/** Wrap a real `Worker` as a transport. */
export function workerTransport(worker: Worker): EphemerisTransport {
  return {
    send: (request) => {
      worker.postMessage(request);
    },
    onMessage: (handler) => {
      worker.addEventListener('message', (event: MessageEvent<EphemerisResponse>) => {
        handler(event.data);
      });
    },
    onError: (handler) => {
      worker.addEventListener('error', (event: ErrorEvent) => {
        handler(new Error(`Ephemeris worker failed: ${event.message || 'unknown error'}`));
      });
    },
    close: () => {
      worker.terminate();
    },
  };
}

/** Spawn the bundled ephemeris worker. Vite rewrites this URL at build time. */
export function spawnEphemerisWorker(): EphemerisTransport {
  return workerTransport(new Worker(new URL('./worker.js', import.meta.url), { type: 'module' }));
}

interface Pending {
  resolve(value: unknown): void;
  reject(error: Error): void;
  readonly timer: ReturnType<typeof setTimeout>;
}

/**
 * How long a single worker call may take before it is failed.
 *
 * Sized against `initialize`, which fetches the WASM engine and the ephemeris data files
 * over the network on a cold cache and is by far the slowest legitimate call — every
 * calculation after it is milliseconds. The bound exists for the case `#fail` cannot
 * cover: `nextSunCrossing`/`nextMoonCrossing` search iteratively, and a non-converging
 * search leaves the worker neither replying nor erroring, so without a timeout the
 * promise never settles and the UI shows the spinner-forever state this class exists to
 * prevent (#332).
 */
const DEFAULT_REQUEST_TIMEOUT_MS = 60_000;

export interface WorkerEphemerisOptions {
  /** Overridable so a test can assert the timeout without waiting a minute for it. */
  readonly requestTimeoutMs?: number;
}

export class WorkerEphemerisProvider implements EphemerisProvider {
  readonly #transport: EphemerisTransport;
  readonly #pending = new Map<number, Pending>();
  readonly #requestTimeoutMs: number;
  #nextId = 1;
  #fatal: Error | undefined;

  constructor(transport: EphemerisTransport = spawnEphemerisWorker(), options: WorkerEphemerisOptions = {}) {
    this.#transport = transport;
    this.#requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
    transport.onMessage((response) => {
      this.#settle(response);
    });
    transport.onError((error) => {
      this.#fail(error);
    });
  }

  #settle(response: EphemerisResponse): void {
    const pending = this.#pending.get(response.id);
    // An unknown id means a reply arrived for a call we already failed or a
    // duplicate response. Dropping it is correct; throwing would be unhandled.
    if (pending === undefined) return;
    this.#pending.delete(response.id);
    clearTimeout(pending.timer);
    if (response.ok) pending.resolve(response.value);
    else pending.reject(deserializeError(response.error));
  }

  /**
   * A dead worker is unrecoverable, so every in-flight call is rejected and the
   * failure is latched. Without this, calls would hang forever and the UI would
   * show a spinner instead of an error — the failure mode this project exists to
   * avoid.
   */
  #fail(error: Error): void {
    this.#fatal ??= error;
    for (const pending of this.#pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.#pending.clear();
  }

  /**
   * A timed-out call fails only itself, unlike `#fail`: the worker is unresponsive for
   * this request, which is not the same as dead, and latching the whole provider fatal
   * would turn one stuck search into a permanently broken ephemeris. A real transport
   * failure still latches, via `onError`.
   */
  #expire(id: number, method: EphemerisMethod): void {
    const pending = this.#pending.get(id);
    if (pending === undefined) return;
    this.#pending.delete(id);
    pending.reject(new Error(`Ephemeris worker did not answer ${method} within ${String(this.#requestTimeoutMs)}ms.`));
  }

  #call<M extends EphemerisMethod>(method: M, args: Parameters<EphemerisProvider[M]>): Promise<EphemerisResult<M>> {
    if (this.#fatal !== undefined) return Promise.reject(this.#fatal);
    const id = this.#nextId++;
    return new Promise<EphemerisResult<M>>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#expire(id, method);
      }, this.#requestTimeoutMs);
      this.#pending.set(id, { resolve, reject, timer });
      try {
        this.#transport.send({ id, method, args } as EphemerisRequest);
      } catch (error) {
        this.#pending.delete(id);
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  initialize(): Promise<void> {
    return this.#call('initialize', []);
  }

  julianDay(year: number, month: number, day: number, hour: number, calendar?: CalendarSystem): Promise<JulianDayUT> {
    return this.#call('julianDay', [year, month, day, hour, calendar]);
  }

  julianDayFromUtc(
    year: number,
    month: number,
    day: number,
    hour: number,
    minute: number,
    second: number,
  ): Promise<JulianDayUT> {
    return this.#call('julianDayFromUtc', [year, month, day, hour, minute, second]);
  }

  position(jd: JulianDayUT, body: BodyId, options?: PositionOptions): Promise<BodyPosition> {
    return this.#call('position', [jd, body, options]);
  }

  positions(jd: JulianDayUT, bodies: readonly BodyId[], options?: PositionOptions): Promise<readonly BodyPosition[]> {
    return this.#call('positions', [jd, bodies, options]);
  }

  houses(jd: JulianDayUT, place: GeoPosition, system: HouseSystem, zodiac?: Zodiac): Promise<HousePositions> {
    return this.#call('houses', [jd, place, system, zodiac]);
  }

  houseSystemName(system: HouseSystem): Promise<string> {
    return this.#call('houseSystemName', [system]);
  }

  ayanamsa(jd: JulianDayUT, mode: number): Promise<Degrees> {
    return this.#call('ayanamsa', [jd, mode]);
  }

  ayanamsaName(mode: number): Promise<string> {
    return this.#call('ayanamsaName', [mode]);
  }

  obliquity(jd: JulianDayUT): Promise<Degrees> {
    return this.#call('obliquity', [jd]);
  }

  fixedStar(jd: JulianDayUT, name: string, options?: PositionOptions): Promise<FixedStarPosition> {
    return this.#call('fixedStar', [jd, name, options]);
  }

  fixedStarMagnitude(name: string): Promise<FixedStarMagnitude> {
    return this.#call('fixedStarMagnitude', [name]);
  }

  nextSunCrossing(fromJd: JulianDayUT, longitude: Degrees, zodiac?: Zodiac): Promise<JulianDayUT> {
    return this.#call('nextSunCrossing', [fromJd, longitude, zodiac]);
  }

  nextMoonCrossing(fromJd: JulianDayUT, longitude: Degrees, zodiac?: Zodiac): Promise<JulianDayUT> {
    return this.#call('nextMoonCrossing', [fromJd, longitude, zodiac]);
  }

  azimuthAltitude(
    jd: JulianDayUT,
    point: { readonly longitude: Degrees; readonly latitude: Degrees },
    place: GeoPosition,
    options?: AzimuthAltitudeOptions,
  ): Promise<HorizontalPosition> {
    return this.#call('azimuthAltitude', [jd, point, place, options]);
  }

  version(): Promise<string> {
    return this.#call('version', []);
  }

  async dispose(): Promise<void> {
    if (this.#fatal !== undefined) return;
    try {
      await this.#call('dispose', []);
    } finally {
      this.#fail(new Error('Ephemeris worker has been disposed.'));
      this.#transport.close();
    }
  }
}
