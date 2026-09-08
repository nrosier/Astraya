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
  BodyId,
  BodyPosition,
  CalendarSystem,
  Degrees,
  EphemerisProvider,
  GeoPosition,
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
}

export class WorkerEphemerisProvider implements EphemerisProvider {
  readonly #transport: EphemerisTransport;
  readonly #pending = new Map<number, Pending>();
  #nextId = 1;
  #fatal: Error | undefined;

  constructor(transport: EphemerisTransport = spawnEphemerisWorker()) {
    this.#transport = transport;
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
    for (const pending of this.#pending.values()) pending.reject(error);
    this.#pending.clear();
  }

  #call<M extends EphemerisMethod>(method: M, args: Parameters<EphemerisProvider[M]>): Promise<EphemerisResult<M>> {
    if (this.#fatal !== undefined) return Promise.reject(this.#fatal);
    const id = this.#nextId++;
    return new Promise<EphemerisResult<M>>((resolve, reject) => {
      this.#pending.set(id, { resolve, reject });
      try {
        this.#transport.send({ id, method, args } as EphemerisRequest);
      } catch (error) {
        this.#pending.delete(id);
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
