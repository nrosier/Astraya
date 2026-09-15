/**
 * The written report for one person (#271), as its own route (`#/report/:id`) rather than a
 * `?tab=report` query on the chart route — matching every other person-scoped view
 * (`#/profections/:id`, `#/transit/:id`, ...). Loads the same natal `ChartData` `ChartView`
 * does, but shows nothing else from that page: no wheel, no export controls, no share link,
 * no positions/houses/aspects/dignities/derived-points sub-tabs. A report is text, not a
 * chart reading, and belongs on a page of its own.
 */
import { useEffect, useState } from 'react';
import { computeChartData, type ChartData } from '../domain/chart-compute.js';
import { WorkerEphemerisProvider } from '../ephemeris/client.js';
import { PersonNotFound } from './PersonNotFound.js';
import { reportScreenMessages } from './ReportScreen.messages.js';
import { ReportView } from './ReportView.js';
import { useMessages } from './messages.js';
import { useStoreState } from './store-context.js';
import type { EphemerisProvider } from '../ephemeris/types.js';

type Load =
  | { readonly kind: 'loading' }
  | { readonly kind: 'ready'; readonly data: ChartData }
  | { readonly kind: 'error'; readonly message: string };

export function ReportScreen({ personId }: { personId: string }): React.JSX.Element {
  const state = useStoreState();
  const person = state.people.get(personId);
  const t = useMessages(reportScreenMessages);
  const [provider, setProvider] = useState<EphemerisProvider | undefined>(undefined);
  const [load, setLoad] = useState<Load>({ kind: 'loading' });

  useEffect(() => {
    const worker = new WorkerEphemerisProvider();
    const effect = { cancelled: false };
    void worker.initialize().then(() => {
      if (!effect.cancelled) setProvider(worker);
    });
    return () => {
      effect.cancelled = true;
      void worker.dispose();
    };
  }, []);

  useEffect(() => {
    if (person?.moment === undefined || provider === undefined) return undefined;
    const moment = person.moment;
    const effect = { cancelled: false };
    setLoad({ kind: 'loading' });

    void (async () => {
      try {
        const data = await computeChartData(moment, provider);
        if (!effect.cancelled) setLoad({ kind: 'ready', data });
      } catch (error) {
        if (!effect.cancelled)
          setLoad({ kind: 'error', message: error instanceof Error ? error.message : String(error) });
      }
    })();

    return () => {
      effect.cancelled = true;
    };
  }, [person, provider]);

  if (person === undefined) {
    return <PersonNotFound />;
  }

  if (person.moment === undefined) {
    return (
      <main className="shell">
        <p className="back">
          <a href={`#/person/${personId}`}>&larr; {person.displayName || t.personFallback}</a>
        </p>
        <h1>{t.reportFallback}</h1>
        <p>
          {t.notCompleteReport(person.displayName || t.thisPerson)}{' '}
          <a href={`#/person/${personId}`}>{t.personPageLink}</a>.
        </p>
      </main>
    );
  }

  // The report leans on houses/angles (the Ascendant-based sections `ChartView`'s own
  // `showHouses` gate covers) same as those tables do, so an unknown birth time means the
  // same "not meaningful" answer, not an approximation.
  if (person.timeAccuracy === 'unknown') {
    return (
      <main className="shell">
        <p className="back">
          <a href={`#/person/${personId}`}>&larr; {person.displayName || t.personFallback}</a>
        </p>
        <h1>{t.reportFallback}</h1>
        <p>{t.needsKnownTime(person.displayName || t.thisPerson)}</p>
      </main>
    );
  }

  return (
    <main className="shell">
      <p className="back">
        <a href={`#/person/${personId}`}>&larr; {person.displayName || t.personFallback}</a>
      </p>
      <h1>{person.displayName ? t.heading(person.displayName) : t.reportFallback}</h1>

      {load.kind === 'loading' && <p className="status">{t.calculating}</p>}
      {load.kind === 'error' && (
        <p className="warning" role="alert">
          {t.error(load.message)}
        </p>
      )}
      {load.kind === 'ready' && <ReportView chart={load.data} />}
    </main>
  );
}
