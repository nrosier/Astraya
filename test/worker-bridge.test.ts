/**
 * Tests for the worker bridge (protocol + host + client).
 *
 * These run the real engine behind a loopback transport rather than a real
 * Worker. That is a deliberate choice, not a shortcut: it exercises the actual
 * protocol, dispatch and error paths in Node with no polyfill, and every payload
 * is passed through `structuredClone` exactly as `postMessage` would. Anything
 * that is not genuinely cloneable — a class instance, a function, a getter —
 * fails here instead of only in a browser.
 */
import { describe, expect, it } from 'vitest';
import { SE } from '../src/ephemeris/generated-constants.js';
import { WorkerEphemerisProvider, type EphemerisTransport } from '../src/ephemeris/client.js';
import { serveEphemeris, type WorkerScope } from '../src/ephemeris/worker.js';
import type { EphemerisRequest, EphemerisResponse } from '../src/ephemeris/protocol.js';
import { EphemerisError, type EphemerisProvider } from '../src/ephemeris/types.js';
import { getEngine, localEpheBaseUrl, localWasmUrl } from './engine-harness.js';

/** An in-process transport that clones both directions, as postMessage does. */
function loopback(engine: EphemerisProvider): { transport: EphemerisTransport; closed: () => boolean } {
  let deliverToWorker: ((event: MessageEvent<EphemerisRequest>) => void) | undefined;
  let deliverToClient: (response: EphemerisResponse) => void = () => {};
  let closed = false;

  const scope: WorkerScope = {
    addEventListener: (_type, listener) => {
      deliverToWorker = listener;
    },
    postMessage: (message) => {
      const cloned = structuredClone(message);
      queueMicrotask(() => {
        deliverToClient(cloned);
      });
    },
    close: () => {
      closed = true;
    },
  };
  serveEphemeris(scope, engine);

  return {
    closed: () => closed,
    transport: {
      send: (request) => {
        const cloned = structuredClone(request);
        queueMicrotask(() => deliverToWorker?.({ data: cloned } as MessageEvent<EphemerisRequest>));
      },
      onMessage: (handler) => {
        deliverToClient = handler;
      },
      onError: () => {},
      close: () => {},
    },
  };
}

async function bridged(): Promise<WorkerEphemerisProvider> {
  const { transport } = loopback(await getEngine());
  return new WorkerEphemerisProvider(transport);
}

const JD_2024 = 2_460_310.5; // 2024-01-01 00:00 UT

describe('worker bridge', () => {
  it('returns positions identical to the direct engine', async () => {
    const direct = await getEngine();
    const client = await bridged();
    const jd = await client.julianDayFromUtc(1969, 7, 20, 20, 17, 40);

    expect(jd).toBe(await direct.julianDayFromUtc(1969, 7, 20, 20, 17, 40));

    for (const body of [SE.SE_SUN, SE.SE_MOON, SE.SE_PLUTO, SE.SE_CHIRON]) {
      // Exact equality, not a tolerance: the bridge must not alter numbers at all.
      expect(await client.position(jd, body)).toEqual(await direct.position(jd, body));
    }
  });

  it('round-trips houses, including the 1-based cusp array', async () => {
    const place = { latitude: 52.370216, longitude: 4.895168, altitude: 0 };
    const client = await bridged();
    const houses = await client.houses(JD_2024, place, 'P');

    expect(houses).toEqual(await (await getEngine()).houses(JD_2024, place, 'P'));
    // Index 0 is unused padding; cloning must preserve that shape or every chart
    // rotates by one house.
    expect(houses.cusps).toHaveLength(13);
    expect(houses.cusps[1]).toBeCloseTo(houses.ascendant, 10);
    expect(houses.cusps[10]).toBeCloseTo(houses.midheaven, 10);
  });

  it('preserves EphemerisError identity and context across the boundary', async () => {
    const client = await bridged();
    // Year 1500 is outside the shipped 1800-2399 data range, so the engine refuses.
    const jd = await client.julianDay(1500, 1, 1, 0);

    const thrown = await client.position(jd, SE.SE_SUN).then(
      () => undefined,
      (error: unknown) => error,
    );

    expect(thrown).toBeInstanceOf(EphemerisError);
    expect((thrown as EphemerisError).context.jd).toBeCloseTo(jd, 6);
    expect((thrown as EphemerisError).message).toMatch(/range/i);
  });

  it('serialises calls, so global WASM state cannot be observed mid-call', async () => {
    // The hazard is that swe_set_sid_mode is global mutable state: an engine that
    // yields between setting the mode and reading a position could have its mode
    // changed underneath it and return a chart wrong by a whole ayanamsa.
    //
    // The stub yields exactly there, which the real engine currently never does.
    // That is the point: this test pins the host's serialisation guarantee rather
    // than the engine's present-day synchronicity, and it does fail if the queue
    // in serveEphemeris is removed.
    const order: string[] = [];
    let mode = 'tropical';
    const stub = {
      async position(_jd: number, body: number) {
        const requested = body === SE.SE_MOON ? 'sidereal' : 'tropical';
        mode = requested;
        await Promise.resolve(); // the dangerous yield
        order.push(`${requested}:${mode}`);
        return {
          body,
          longitude: 0,
          latitude: 0,
          distance: 1,
          longitudeSpeed: 1,
          latitudeSpeed: 0,
          distanceSpeed: 0,
          retrograde: false,
        };
      },
    } as unknown as EphemerisProvider;

    const client = new WorkerEphemerisProvider(loopback(stub).transport);
    await Promise.all([client.position(JD_2024, SE.SE_SUN), client.position(JD_2024, SE.SE_MOON)]);

    // Each call must read back the mode it set. Interleaved, the first would
    // observe the second's mode.
    expect(order).toEqual(['tropical:tropical', 'sidereal:sidereal']);
  });

  it('keeps tropical and sidereal answers consistent through the bridge', async () => {
    // Not a concurrency test (see above): this checks that the zodiac option and
    // the ayanamsa call survive serialisation and still agree with each other.
    const client = await bridged();
    const sidereal = { kind: 'sidereal', ayanamsa: SE.SE_SIDM_LAHIRI } as const;

    const [tropical, lahiri, ayanamsa] = await Promise.all([
      client.position(JD_2024, SE.SE_SUN),
      client.position(JD_2024, SE.SE_SUN, { zodiac: sidereal }),
      client.ayanamsa(JD_2024, SE.SE_SIDM_LAHIRI),
    ]);

    const delta = ((tropical.longitude - lahiri.longitude + 540) % 360) - 180;
    expect(delta).toBeCloseTo(ayanamsa, 6);
    expect(ayanamsa).toBeGreaterThan(23);
    expect(ayanamsa).toBeLessThan(25);
  });

  it('rejects in-flight calls when the worker dies rather than hanging', async () => {
    let failWorker: ((error: Error) => void) | undefined;
    const client = new WorkerEphemerisProvider({
      send: () => {},
      onMessage: () => {},
      onError: (handler) => {
        failWorker = handler;
      },
      close: () => {},
    });

    const inFlight = client.position(JD_2024, SE.SE_SUN);
    failWorker?.(new Error('worker exploded'));

    await expect(inFlight).rejects.toThrow('worker exploded');
    // Latched: later calls fail fast instead of queueing against a dead worker.
    await expect(client.position(JD_2024, SE.SE_MOON)).rejects.toThrow('worker exploded');
  });

  it('closes the worker scope on dispose and refuses further calls', async () => {
    // A private engine, so disposing does not tear down the shared one.
    const { transport, closed } = loopback(
      new (await import('../src/ephemeris/engine.js')).SwissEphemerisEngine({
        epheBaseUrl: localEpheBaseUrl,
        wasmUrl: localWasmUrl,
      }),
    );
    const client = new WorkerEphemerisProvider(transport);
    await client.initialize();
    await client.dispose();

    expect(closed()).toBe(true);
    await expect(client.position(JD_2024, SE.SE_SUN)).rejects.toThrow(/disposed/i);
  });

  it('reports the Swiss Ephemeris version through the bridge', async () => {
    // The About page needs this; it only reaches it via the worker.
    expect(await (await bridged()).version()).toMatch(/^\d+\.\d+/);
  });

  it('resolves a house system display name through the bridge', async () => {
    const client = await bridged();
    expect(await client.houseSystemName('P')).toBe(await (await getEngine()).houseSystemName('P'));
  });
});
