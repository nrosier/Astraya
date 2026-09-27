/**
 * Admin corpus-correction browsing and editing (#292): search/filter the interpretation
 * corpus and replace an entry's text without touching the committed JSON. Its own screen
 * rather than a tab inside `AdminPanel.tsx` — this dataset (~16k rows for `en.json` alone)
 * and its filter state are large enough to warrant that separation.
 *
 * The corpus-language selector below is deliberately **local state**, not the shared,
 * app-wide `useLocale()` store (`locale.ts`) that also drives this app's own UI language —
 * switching which corpus locale an admin is browsing must not silently change the language
 * the rest of the app speaks to them. `useMessages` (this panel's own labels) still reads
 * the shared store, same as every other screen.
 *
 * Reuses `loadRuntimeCorpus` (`corpus-client.ts`) for browsing — the exact function
 * `ReportView.tsx` calls to render a report — so the corpus admins see here is already
 * merged with any existing corrections. `listCorpusOverrides` supplies the metadata
 * (override id, "is this actually overridden") that merged `CorpusEntry` values alone don't
 * carry.
 */
import { useEffect, useMemo, useState } from 'react';
import {
  deleteCorpusOverride,
  exportCorpusOverrides,
  listCorpusOverrides,
  upsertCorpusOverride,
} from '../sync/admin-client.js';
import { loadRuntimeCorpus } from '../interpretation/corpus-client.js';
import {
  CORPUS_CATEGORIES,
  CORPUS_LOCALES,
  CORPUS_TIERS,
  PERSONA_IDS,
  categoryOfKey,
} from '../interpretation/schema.js';
import { downloadBlob } from './download.js';
import { LOCALE_LABELS, isLocale } from './locale.js';
import { useMessages } from './messages.js';
import { PERSONA_LABELS } from './ReportView.js';
import { corpusOverridesPanelMessages } from './CorpusOverridesPanel.messages.js';
import { sharedMessages } from './shared.messages.js';
import type { CorpusOverride } from '../sync/admin-client.js';
import type { CorpusCategory, CorpusEntry, CorpusTier, Locale, PersonaId } from '../interpretation/schema.js';

const PAGE_SIZE = 50;

function identityKeyOf(key: string, persona: PersonaId | undefined): string {
  return `${key}::${persona ?? ''}`;
}

function truncate(text: string): string {
  const maxLength = 90;
  return text.length <= maxLength ? text : `${text.slice(0, maxLength - 1)}…`;
}

function isPersonaIdValue(value: string): value is PersonaId {
  return (PERSONA_IDS as readonly string[]).includes(value);
}

function isCorpusCategory(value: string): value is CorpusCategory {
  return (CORPUS_CATEGORIES as readonly string[]).includes(value);
}

function isCorpusTier(value: string): value is CorpusTier {
  return (CORPUS_TIERS as readonly string[]).includes(value);
}

interface LoadedData {
  readonly corpus: readonly CorpusEntry[];
  readonly overrides: readonly CorpusOverride[];
}

interface EditState {
  readonly key: string;
  readonly persona: PersonaId | undefined;
  readonly text: string;
  readonly tier: CorpusTier;
  readonly tags: string;
}

interface PendingReset {
  readonly key: string;
  readonly persona: PersonaId | undefined;
  readonly overrideId: string;
}

export function CorpusOverridesPanel(): React.JSX.Element {
  const t = useMessages(corpusOverridesPanelMessages);
  const shared = useMessages(sharedMessages);

  const [corpusLocale, setCorpusLocale] = useState<Locale>('en');
  const [scope, setScope] = useState<PersonaId>();

  const [data, setData] = useState<LoadedData>();
  const [loadError, setLoadError] = useState<string>();

  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<CorpusCategory | ''>('');
  const [tierFilter, setTierFilter] = useState<CorpusTier | ''>('');
  const [tagFilter, setTagFilter] = useState('');
  const [overriddenOnly, setOverriddenOnly] = useState(false);
  const [page, setPage] = useState(1);

  const [editing, setEditing] = useState<EditState>();
  const [pendingReset, setPendingReset] = useState<PendingReset>();
  const [busyKey, setBusyKey] = useState<string>();
  const [saveError, setSaveError] = useState<string>();

  const load = (): Promise<void> =>
    Promise.all([loadRuntimeCorpus(corpusLocale, scope), listCorpusOverrides(corpusLocale)]).then(
      ([corpus, overrides]) => {
        setData({ corpus, overrides });
      },
    );

  useEffect(() => {
    let cancelled = false;
    setData(undefined);
    setLoadError(undefined);
    void load().catch((error: unknown) => {
      if (!cancelled) setLoadError(error instanceof Error ? error.message : String(error));
    });
    return () => {
      cancelled = true;
    };
  }, [corpusLocale, scope]);

  useEffect(() => {
    setPage(1);
  }, [corpusLocale, scope, categoryFilter, tierFilter, tagFilter, overriddenOnly, search]);

  const overrideMap = useMemo(() => {
    const map = new Map<string, CorpusOverride>();
    for (const override of data?.overrides ?? []) map.set(identityKeyOf(override.key, override.persona), override);
    return map;
  }, [data]);

  const availableTags = useMemo(() => {
    const tags = new Set<string>();
    for (const entry of data?.corpus ?? []) for (const tag of entry.tags) tags.add(tag);
    return Array.from(tags).sort();
  }, [data]);

  const filtered = useMemo(() => {
    if (data === undefined) return [];
    const query = search.trim().toLowerCase();
    return data.corpus.filter((entry) => {
      if (categoryFilter !== '' && categoryOfKey(entry.key) !== categoryFilter) return false;
      if (tierFilter !== '' && entry.tier !== tierFilter) return false;
      if (tagFilter !== '' && !entry.tags.includes(tagFilter)) return false;
      if (overriddenOnly && !overrideMap.has(identityKeyOf(entry.key, entry.persona))) return false;
      if (query !== '' && !entry.key.toLowerCase().includes(query) && !entry.text.toLowerCase().includes(query)) {
        return false;
      }
      return true;
    });
  }, [data, categoryFilter, tierFilter, tagFilter, overriddenOnly, search, overrideMap]);

  const visible = filtered.slice(0, page * PAGE_SIZE);

  const startEdit = (entry: CorpusEntry): void => {
    setEditing({
      key: entry.key,
      persona: entry.persona,
      text: entry.text,
      tier: entry.tier,
      tags: entry.tags.join(', '),
    });
    setSaveError(undefined);
  };

  const cancelEdit = (): void => {
    setEditing(undefined);
    setSaveError(undefined);
  };

  const save = (): void => {
    if (editing === undefined) return;
    const identity = identityKeyOf(editing.key, editing.persona);
    setBusyKey(identity);
    setSaveError(undefined);
    const tags = editing.tags
      .split(',')
      .map((tag) => tag.trim())
      .filter((tag) => tag !== '');
    void upsertCorpusOverride({
      key: editing.key,
      locale: corpusLocale,
      ...(editing.persona !== undefined ? { persona: editing.persona } : {}),
      text: editing.text,
      tier: editing.tier,
      tags,
    })
      .then(() => {
        setEditing(undefined);
        return load();
      })
      .catch((cause: unknown) => {
        setSaveError(cause instanceof Error ? cause.message : String(cause));
      })
      .finally(() => {
        setBusyKey(undefined);
      });
  };

  const requestReset = (): void => {
    if (editing === undefined) return;
    const override = overrideMap.get(identityKeyOf(editing.key, editing.persona));
    if (override === undefined) return;
    setPendingReset({ key: editing.key, persona: editing.persona, overrideId: override.id });
  };

  const confirmReset = (): void => {
    const target = pendingReset;
    if (target === undefined) return;
    setPendingReset(undefined);
    setBusyKey(identityKeyOf(target.key, target.persona));
    setSaveError(undefined);
    void deleteCorpusOverride(target.overrideId)
      .then(() => {
        setEditing(undefined);
        return load();
      })
      .catch((cause: unknown) => {
        setSaveError(cause instanceof Error ? cause.message : String(cause));
      })
      .finally(() => {
        setBusyKey(undefined);
      });
  };

  const exportCorrections = (): void => {
    setLoadError(undefined);
    void exportCorpusOverrides(corpusLocale)
      .then((blob) => {
        downloadBlob(`astraya-corpus-overrides-${corpusLocale}.json`, blob);
      })
      .catch((cause: unknown) => {
        setLoadError(cause instanceof Error ? cause.message : String(cause));
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
        <label>
          {t.scopeLabel}
          <select
            value={scope ?? ''}
            onChange={(event) => {
              const next = event.target.value;
              setScope(next !== '' && isPersonaIdValue(next) ? next : undefined);
            }}
          >
            <option value="">{t.neutral}</option>
            {PERSONA_IDS.map((persona) => (
              <option key={persona} value={persona}>
                {PERSONA_LABELS[persona][corpusLocale]}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t.searchLabel}
          <input
            type="text"
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
            }}
          />
        </label>
        <label>
          {t.categoryLabel}
          <select
            value={categoryFilter}
            onChange={(event) => {
              const next = event.target.value;
              setCategoryFilter(isCorpusCategory(next) ? next : '');
            }}
          >
            <option value="">{t.allCategories}</option>
            {CORPUS_CATEGORIES.map((category) => (
              <option key={category} value={category}>
                {category}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t.tierLabel}
          <select
            value={tierFilter}
            onChange={(event) => {
              const next = event.target.value;
              setTierFilter(isCorpusTier(next) ? next : '');
            }}
          >
            <option value="">{t.allTiers}</option>
            {CORPUS_TIERS.map((tier) => (
              <option key={tier} value={tier}>
                {tier}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t.tagLabel}
          <select
            value={tagFilter}
            onChange={(event) => {
              setTagFilter(event.target.value);
            }}
          >
            <option value="">{t.allTags}</option>
            {availableTags.map((tag) => (
              <option key={tag} value={tag}>
                {tag}
              </option>
            ))}
          </select>
        </label>
        <label>
          <input
            type="checkbox"
            checked={overriddenOnly}
            onChange={(event) => {
              setOverriddenOnly(event.target.checked);
            }}
          />
          {t.overriddenOnlyLabel}
        </label>
      </div>

      <p className="actions">
        <button type="button" className="quiet" onClick={exportCorrections}>
          {t.exportButton}
        </button>
      </p>

      {saveError !== undefined && (
        <p className="warning" role="alert">
          {saveError}
        </p>
      )}

      {pendingReset !== undefined && (
        <p className="warning" role="alert">
          {t.resetWarning(pendingReset.key)}{' '}
          <button type="button" className="danger" onClick={confirmReset}>
            {t.resetPermanentlyButton}
          </button>{' '}
          <button
            type="button"
            className="quiet"
            onClick={() => {
              setPendingReset(undefined);
            }}
          >
            {t.cancelButton}
          </button>
        </p>
      )}

      {editing !== undefined && (
        <form
          className="field-grid"
          onSubmit={(event) => {
            event.preventDefault();
            save();
          }}
        >
          <p>
            <strong>{editing.key}</strong>
            {editing.persona !== undefined && ` · ${PERSONA_LABELS[editing.persona][corpusLocale]}`}
          </p>
          <label>
            {t.textLabel}
            <textarea
              rows={4}
              value={editing.text}
              onChange={(event) => {
                setEditing({ ...editing, text: event.target.value });
              }}
            />
          </label>
          <label>
            {t.tierFieldLabel}
            <select
              value={editing.tier}
              onChange={(event) => {
                const next = event.target.value;
                if (isCorpusTier(next)) setEditing({ ...editing, tier: next });
              }}
            >
              {CORPUS_TIERS.map((tier) => (
                <option key={tier} value={tier}>
                  {tier}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t.tagsFieldLabel}
            <input
              type="text"
              value={editing.tags}
              onChange={(event) => {
                setEditing({ ...editing, tags: event.target.value });
              }}
            />
          </label>
          <p className="actions">
            <button type="submit" disabled={busyKey === identityKeyOf(editing.key, editing.persona)}>
              {t.saveButton}
            </button>
            <button type="button" className="quiet" onClick={cancelEdit}>
              {t.cancelButton}
            </button>
            {overrideMap.has(identityKeyOf(editing.key, editing.persona)) && (
              <button type="button" className="danger" onClick={requestReset}>
                {t.resetButton}
              </button>
            )}
          </p>
        </form>
      )}

      {data === undefined ? (
        <p className="status">{t.loadingCorpus}</p>
      ) : (
        <>
          {filtered.length === 0 ? (
            <p className="empty">{t.noResults}</p>
          ) : (
            <div className="data-table">
              <div className="data-table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>{t.keyColumn}</th>
                      <th>{t.categoryColumn}</th>
                      <th>{t.tierColumn}</th>
                      <th>{t.tagsColumn}</th>
                      <th>{t.textColumn}</th>
                      <th>{t.statusColumn}</th>
                      <th>{t.actionsColumn}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visible.map((entry) => {
                      const identity = identityKeyOf(entry.key, entry.persona);
                      const overridden = overrideMap.has(identity);
                      return (
                        <tr key={identity}>
                          <td>{entry.key}</td>
                          <td>{categoryOfKey(entry.key) ?? '—'}</td>
                          <td>{entry.tier}</td>
                          <td>{entry.tags.join(', ')}</td>
                          <td>{truncate(entry.text)}</td>
                          <td>{overridden ? t.overriddenStatus : t.defaultStatus}</td>
                          <td className="actions">
                            <button
                              type="button"
                              className="quiet"
                              disabled={busyKey === identity}
                              onClick={() => {
                                startEdit(entry);
                              }}
                            >
                              {t.editButton}
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <p className="hint">{t.resultCount(String(visible.length), String(filtered.length))}</p>
          {visible.length < filtered.length && (
            <p className="actions">
              <button
                type="button"
                className="quiet"
                onClick={() => {
                  setPage((current) => current + 1);
                }}
              >
                {t.loadMoreButton}
              </button>
            </p>
          )}
        </>
      )}
    </main>
  );
}
