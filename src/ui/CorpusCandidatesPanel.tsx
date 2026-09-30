/**
 * Admin review of bulk-generated corpus candidates (#370): the pending-candidate queue
 * upstream of `CorpusOverridesPanel.tsx` (#292) — accepting a candidate here turns it into a
 * live correction there; nothing here is visible to a reader until that happens. Its own
 * screen for the same reason `CorpusOverridesPanel.tsx` is: a distinct dataset and filter/
 * selection state large enough to warrant separation from `AdminPanel.tsx`.
 *
 * Sorted worst-triage-score-first by the server (`listCorpusCandidates`'s own `ORDER BY`) —
 * per #359/#370's own framing, "scrutinize the flagged mismatches closely, spot-check the
 * ones that passed" — so no client-side sort control is offered; re-sorting by anything else
 * would undercut the one prioritization this queue exists to give a reviewer.
 *
 * Importing new candidates into the queue is not part of this screen — it happens via
 * `POST /api/admin/corpus-candidates/import`, called by generation tooling
 * (`tools/corpus-gen/`), not by a human through this UI.
 */
import { useEffect, useMemo, useState } from 'react';
import { decideCorpusCandidates, listCorpusCandidates } from '../sync/admin-client.js';
import { CORPUS_LOCALES } from '../interpretation/schema.js';
import { LOCALE_LABELS, isLocale } from './locale.js';
import { useMessages } from './messages.js';
import { PERSONA_LABELS } from './ReportView.js';
import { corpusCandidatesPanelMessages } from './CorpusCandidatesPanel.messages.js';
import { sharedMessages } from './shared.messages.js';
import type { CorpusCandidate } from '../sync/admin-client.js';
import type { Locale } from '../interpretation/schema.js';

function truncate(text: string): string {
  const maxLength = 90;
  return text.length <= maxLength ? text : `${text.slice(0, maxLength - 1)}…`;
}

function identityKeyOf(candidate: CorpusCandidate): string {
  return `${candidate.key}::${candidate.persona ?? ''}`;
}

export function CorpusCandidatesPanel(): React.JSX.Element {
  const t = useMessages(corpusCandidatesPanelMessages);
  const shared = useMessages(sharedMessages);

  const [corpusLocale, setCorpusLocale] = useState<Locale>('en');
  const [candidates, setCandidates] = useState<readonly CorpusCandidate[]>();
  const [loadError, setLoadError] = useState<string>();

  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [deciding, setDeciding] = useState(false);
  const [decideError, setDecideError] = useState<string>();
  const [missingCount, setMissingCount] = useState<number>();

  const load = (): Promise<void> =>
    listCorpusCandidates(corpusLocale).then((loaded) => {
      setCandidates(loaded);
      setSelected(new Set());
    });

  useEffect(() => {
    let cancelled = false;
    setCandidates(undefined);
    setLoadError(undefined);
    void load().catch((error: unknown) => {
      if (!cancelled) setLoadError(error instanceof Error ? error.message : String(error));
    });
    return () => {
      cancelled = true;
    };
  }, [corpusLocale]);

  // Which `(key, persona)` pairs have more than one still-pending candidate — the collision
  // #370's own "Dedup" requirement asks a reviewer be able to see, e.g. a classical-seed and
  // an llm-fill candidate both proposing text for the same placement.
  const duplicateIdentities = useMemo(() => {
    const counts = new Map<string, number>();
    for (const candidate of candidates ?? []) {
      const identity = identityKeyOf(candidate);
      counts.set(identity, (counts.get(identity) ?? 0) + 1);
    }
    return new Set(
      Array.from(counts.entries())
        .filter(([, count]) => count > 1)
        .map(([identity]) => identity),
    );
  }, [candidates]);

  const toggleSelected = (id: string, checked: boolean): void => {
    setSelected((current) => {
      const next = new Set(current);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  const toggleSelectAll = (checked: boolean): void => {
    setSelected(checked ? new Set((candidates ?? []).map((candidate) => candidate.id)) : new Set());
  };

  const decide = (ids: readonly string[], decision: 'accept' | 'reject'): void => {
    if (ids.length === 0) return;
    setDeciding(true);
    setDecideError(undefined);
    setMissingCount(undefined);
    void decideCorpusCandidates(ids, decision)
      .then((result) => {
        if (result.missing.length > 0) setMissingCount(result.missing.length);
        return load();
      })
      .catch((cause: unknown) => {
        setDecideError(cause instanceof Error ? cause.message : String(cause));
      })
      .finally(() => {
        setDeciding(false);
      });
  };

  return (
    <main className="shell">
      <p className="back">
        <a href="#/admin">&larr; {shared.back}</a>
      </p>
      <h1>{t.heading}</h1>
      <p>{t.intro}</p>

      {loadError !== undefined && (
        <p className="warning" role="alert">
          {t.couldNotLoad(loadError)}
        </p>
      )}

      <div className="field-grid">
        <label>
          {t.corpusLocaleLabel}
          <select
            value={corpusLocale}
            onChange={(event) => {
              const next = event.target.value;
              if (isLocale(next)) setCorpusLocale(next);
            }}
          >
            {CORPUS_LOCALES.map((locale) => (
              <option key={locale} value={locale}>
                {LOCALE_LABELS[locale]}
              </option>
            ))}
          </select>
        </label>
      </div>

      {decideError !== undefined && (
        <p className="warning" role="alert">
          {t.decideFailed(decideError)}
        </p>
      )}
      {missingCount !== undefined && missingCount > 0 && (
        <p className="warning" role="alert">
          {t.missingWarning(String(missingCount))}
        </p>
      )}

      {candidates === undefined ? (
        <p className="status">{t.loadingCandidates}</p>
      ) : candidates.length === 0 ? (
        <p className="empty">{t.noResults}</p>
      ) : (
        <>
          <p className="actions">
            <label>
              <input
                type="checkbox"
                checked={selected.size > 0 && selected.size === candidates.length}
                onChange={(event) => {
                  toggleSelectAll(event.target.checked);
                }}
              />{' '}
              {t.selectAllLabel}
            </label>{' '}
            {t.selectedCount(String(selected.size))}{' '}
            <button
              type="button"
              disabled={selected.size === 0 || deciding}
              onClick={() => {
                decide(Array.from(selected), 'accept');
              }}
            >
              {deciding ? t.deciding : t.acceptSelectedButton}
            </button>{' '}
            <button
              type="button"
              className="danger"
              disabled={selected.size === 0 || deciding}
              onClick={() => {
                decide(Array.from(selected), 'reject');
              }}
            >
              {deciding ? t.deciding : t.rejectSelectedButton}
            </button>
          </p>

          <div className="data-table">
            <div className="data-table-scroll">
              <table>
                <thead>
                  <tr>
                    <th aria-hidden="true" />
                    <th>{t.keyColumn}</th>
                    <th>{t.sourceColumn}</th>
                    <th>{t.triageColumn}</th>
                    <th>{t.tagsColumn}</th>
                    <th>{t.textColumn}</th>
                    <th>{t.actionsColumn}</th>
                  </tr>
                </thead>
                <tbody>
                  {candidates.map((candidate) => {
                    const isDuplicate = duplicateIdentities.has(identityKeyOf(candidate));
                    return (
                      <tr key={candidate.id}>
                        <td>
                          <input
                            type="checkbox"
                            checked={selected.has(candidate.id)}
                            onChange={(event) => {
                              toggleSelected(candidate.id, event.target.checked);
                            }}
                            aria-label={candidate.key}
                          />
                        </td>
                        <td>
                          {candidate.key}
                          {candidate.persona !== undefined && ` · ${PERSONA_LABELS[candidate.persona][corpusLocale]}`}
                          {isDuplicate && (
                            <>
                              {' '}
                              <span
                                className="hint"
                                role="img"
                                aria-label={t.duplicateKeyHint}
                                title={t.duplicateKeyHint}
                              >
                                ⚠
                              </span>
                            </>
                          )}
                        </td>
                        <td>{candidate.source === 'classical-seed' ? t.sourceClassicalSeed : t.sourceLlmFill}</td>
                        <td>
                          {candidate.triageSignal === 'match'
                            ? t.triageMatch
                            : candidate.triageSignal === 'mismatch'
                              ? t.triageMismatch
                              : candidate.triageSignal === 'no-baseline'
                                ? t.triageNoBaseline
                                : t.triageUnchecked}
                          {candidate.triageScore !== undefined && ` (${candidate.triageScore.toFixed(2)})`}
                        </td>
                        <td>{candidate.tags.join(', ')}</td>
                        <td>{truncate(candidate.text)}</td>
                        <td className="actions">
                          <button
                            type="button"
                            className="quiet"
                            disabled={deciding}
                            onClick={() => {
                              decide([candidate.id], 'accept');
                            }}
                          >
                            {t.acceptButton}
                          </button>{' '}
                          <button
                            type="button"
                            className="quiet danger"
                            disabled={deciding}
                            onClick={() => {
                              decide([candidate.id], 'reject');
                            }}
                          >
                            {t.rejectButton}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </main>
  );
}
