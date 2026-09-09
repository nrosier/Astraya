/**
 * Renders a chart entirely from a #65 share link's query — no local store, no saved
 * person, no account. Everything the wheel and tables need is recomputed in this browser
 * from what the link carries, the same offline/no-server principle `TimePlace.tsx`
 * established for a bare birth moment, extended here to a whole chart.
 */
import { useEffect, useMemo, useState } from 'react';
import { ChartDataView } from './ChartView.js';
import { computeChartData, type ChartData } from '../domain/chart-compute.js';
import { decodeChartShareLink, type ChartShareData } from '../domain/chart-share.js';
import { WorkerEphemerisProvider } from '../ephemeris/client.js';

type Load =
  | { readonly kind: 'loading' }
  | { readonly kind: 'ready'; readonly data: ChartData }
  | { readonly kind: 'error'; readonly message: string };

/** Reads the shared chart from the URL query, once, at mount. */
function fromLocation(): { data?: ChartShareData; error?: string } {
  const query = window.location.hash.split('?')[1] ?? '';
  try {
    return { data: decodeChartShareLink(new URLSearchParams(query)) };
  } catch (error) {
    // A bad or truncated link must say so, not silently show nothing or a wrong chart.
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

export function SharedChartView(): React.JSX.Element {
  const initial = useMemo(fromLocation, []);
  const [load, setLoad] = useState<Load>({ kind: 'loading' });

  useEffect(() => {
    if (initial.data === undefined) return undefined;
    const { moment } = initial.data;
    const provider = new WorkerEphemerisProvider();
    const effect = { cancelled: false };

    void (async () => {
      try {
        await provider.initialize();
        const data = await computeChartData(moment, provider);
        if (!effect.cancelled) setLoad({ kind: 'ready', data });
      } catch (error) {
        if (!effect.cancelled)
          setLoad({ kind: 'error', message: error instanceof Error ? error.message : String(error) });
      }
    })();

    return () => {
      effect.cancelled = true;
      void provider.dispose();
    };
  }, [initial.data]);

  return (
    <main className="shell">
      <p className="back">
        <a href="#/">&larr; Back</a>
      </p>
      <h1>Shared chart</h1>
      <p className="hint">
        This chart is calculated entirely in your browser from the link itself &mdash; nothing was sent to us to open
        it, and nothing you do here is either.
      </p>

      {initial.error !== undefined && (
        <p className="warning" role="alert">
          That link could not be read. {initial.error}
        </p>
      )}

      {initial.data !== undefined && (
        <ChartDataView load={load} displayName="Shared chart" showHouses={initial.data.housesKnown} />
      )}
    </main>
  );
}
