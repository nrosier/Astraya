/**
 * Renders one `Report` (#61) as a list of named sections, each a list of
 * paragraphs — the "Report" tab `ChartView.tsx` wires in. A "Show provenance"
 * toggle exposes, per paragraph, where its text came from (a corpus entry,
 * the mechanical fallback, or a chart-derived sentence) and, when the rule
 * engine ranked it, the factors behind that ranking — #62's "why this text?"
 * requirement.
 *
 * Thin wiring only: every string shown here is pre-formatted by
 * `report-provenance.ts`, which is plain and Vitest-testable, following the
 * same "thin `.tsx`, tested `.ts`" split `SortableTable.tsx`/`table-sort.ts`
 * already use.
 *
 * Advisor is user-selectable here: `assembleReport` and `loadRuntimeCorpus`
 * already take a `Locale`/`PersonaId` (the corpus is fully generated for
 * both `en` and `nl`, all five personas), this component exposes the
 * persona choice and remembers it per device, the same
 * `localStorage`-persisted-preference pattern `session-context.tsx` uses for
 * the last signed-in user. Persona is optional — "neutral" (no persona
 * selected) falls back to the same voice every report used before this
 * picker existed. Language is a shared, app-wide setting (`locale.ts`), not
 * this component's own state — this view only consumes it.
 *
 * The picker itself is a deployment-time toggle, `VITE_ENABLE_REPORT_PERSONAS`
 * (.env.example), off by default: personas are a newer, less-reviewed part of
 * the corpus than the neutral voice, so a deployer opts in rather than every
 * build getting them for free. Off, the control is hidden and any persona a
 * device already had saved in `localStorage` from before the toggle existed
 * (or from a deployment where it's since been turned back off) is ignored —
 * the report always renders in the neutral voice.
 *
 * Fetches its corpus chunk at runtime via `loadRuntimeCorpus` rather than
 * importing `CORPUS` from `../interpretation/index.js` — that export is the
 * full, synchronous, every-locale-every-persona corpus the test suite needs,
 * and importing it here would inline all of it into this app's JS bundle.
 * See corpus-client.ts for why.
 */
import { useEffect, useState } from 'react';
import { assembleReport, reportPlacementKeys, type Report, type ReportParagraph } from '../interpretation/report.js';
import { loadRuntimeCorpus } from '../interpretation/corpus-client.js';
import { PERSONA_IDS, type CorpusEntry, type Locale, type PersonaId } from '../interpretation/schema.js';
import { checkCustomPrompt, type GuardrailIssue } from '../interpretation/prompt-guardrail.js';
import { describeParagraphProvenance } from './report-provenance.js';
import { useLocale } from './locale.js';
import { useMessages } from './messages.js';
import { useSessionUserOrUndefined } from './session-context.js';
import { reportViewMessages } from './ReportView.messages.js';
import {
  generateTier2Interpretation,
  toTier2ChartPayload,
  Tier2Error,
  type Tier2Section,
} from '../interpretation/tier2-client.js';
import type { ChartData } from '../domain/chart-compute.js';

type InterpretationTabKey = 'standard' | 'ai';
const TAB_ORDER: readonly InterpretationTabKey[] = ['standard', 'ai'];

function tabLabels(t: typeof reportViewMessages.en): Record<InterpretationTabKey, string> {
  return { standard: t.standardTabLabel, ai: t.aiTabLabel };
}

/** One localized sentence per guardrail rule — never `issue.message` itself, which is English-only diagnostic text shared with the server's 400 response, not a user-facing string. */
function guardrailIssueMessage(t: typeof reportViewMessages.en, issue: GuardrailIssue): string {
  switch (issue.rule) {
    case 'length':
      return t.guardrailIssueLength;
    case 'prompt-injection':
      return t.guardrailIssuePromptInjection;
    case 'fatalistic-phrasing':
      return t.guardrailIssueFatalisticPhrasing;
    case 'medical-legal-financial-claim':
      return t.guardrailIssueMedicalLegalFinancialClaim;
    case 'pii-shape':
      return t.guardrailIssuePiiShape;
  }
}

const PERSONA_KEY = 'astraya:reportPersona';

// Off by default: unset, empty, or anything other than 'true' disables the picker. Not the
// string-presence pattern `geocode-provider.ts`'s env vars use — those are "which value", this
// is "on or off", so it's a literal truthy-string check instead.
// Read inside a function rather than hoisted to a module-level constant, the same reason
// `!import.meta.env.PROD` below is checked inline rather than hoisted: it keeps this test-visible
// per render/mount rather than frozen at whatever value happened to hold at first import.
function reportPersonasEnabled(): boolean {
  const raw: unknown = import.meta.env.VITE_ENABLE_REPORT_PERSONAS;
  return raw === 'true';
}

/**
 * Mirrors `tools/corpus-gen/personas.json`'s `title` field — kept as a plain
 * literal here, the same reasoning `schema.ts`'s own `PERSONA_IDS` comment
 * gives for not reading that file at runtime: this stays a pure client
 * module with no filesystem access. `test/ui-report-view.test.tsx` asserts
 * these titles stay in sync with that file, the same way
 * `test/interpretation-schema.test.ts` already does for the id list itself.
 */
export const PERSONA_LABELS: Readonly<Record<PersonaId, Readonly<Record<Locale, string>>>> = {
  traditionalist: { en: 'The Strict Traditionalist', nl: 'De Strenge Traditionalist' },
  big_sister: { en: 'The Cozy Cosmic Big Sister', nl: 'De Warme Kosmische Zus' },
  cynic: { en: 'The Irreverent Cynic', nl: 'De Cynische Realist' },
  mystic: { en: 'The Evolutionary Mystic', nl: 'De Esoterische Mysticus' },
  pragmatist: { en: 'The Pragmatic No-Nonsense Coach', nl: 'De Praktische No-Nonsense Coach' },
};

function isPersonaId(value: string): value is PersonaId {
  return (PERSONA_IDS as readonly string[]).includes(value);
}

function initialPersona(): PersonaId | undefined {
  if (!reportPersonasEnabled()) return undefined;
  const stored = localStorage.getItem(PERSONA_KEY);
  return stored !== null && isPersonaId(stored) ? stored : undefined;
}

function Paragraph({
  paragraph,
  showProvenance,
}: {
  readonly paragraph: ReportParagraph;
  readonly showProvenance: boolean;
}): React.JSX.Element {
  const provenance = describeParagraphProvenance(paragraph);
  return (
    <li className="report-paragraph">
      <p>{paragraph.text}</p>
      {showProvenance && (
        <p className="report-provenance hint">
          {provenance.placement !== undefined && <>{provenance.placement} &middot; </>}
          {provenance.source}
          {provenance.factors !== undefined && <> &mdash; {provenance.factors}</>}
        </p>
      )}
    </li>
  );
}

/**
 * Tier 2 (#360): opt-in, authenticated, per-request-consented LLM-customized
 * interpretation — the "AI-Customized" sub-tab alongside the Tier-1
 * "Standard" one below. Consent is a plain checkbox, unchecked every
 * render — never persisted — since it authorizes one specific request, not
 * a standing preference.
 *
 * The one free-text field (style/tone/focus instructions) is run through
 * `checkCustomPrompt` on every keystroke so a rejected prompt is visible
 * before Generate is even clickable — a UX nicety only. The server runs the
 * same check authoritatively and does not trust this client-side pass.
 */
function AiCustomizedPanel({
  report,
  locale,
  chart,
}: {
  readonly report: Report;
  readonly locale: Locale;
  readonly chart: ChartData;
}): React.JSX.Element {
  const t = useMessages(reportViewMessages);
  const user = useSessionUserOrUndefined();
  const [consent, setConsent] = useState(false);
  const [mode, setMode] = useState<'grounded' | 'freeform' | 'synthesis'>('grounded');
  const [customPrompt, setCustomPrompt] = useState('');
  const [generating, setGenerating] = useState(false);
  const [result, setResult] = useState<readonly Tier2Section[] | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);

  if (user === undefined) {
    return (
      <section className="report-section ai-customized-panel">
        <h3>{t.tier2Heading}</h3>
        <p className="hint">{t.tier2SignInPrompt}</p>
      </section>
    );
  }

  const placementKeys = reportPlacementKeys(report);
  // Synthesis mode has no free-text instruction, so it has nothing to guard.
  const guardrailIssues = mode === 'synthesis' ? [] : checkCustomPrompt(customPrompt);
  // Only shown once the user has typed something — otherwise the empty-prompt "length"
  // issue would announce itself on mount and re-announce on every keystroke, before the
  // user has had a chance to write anything.
  const visibleGuardrailIssues = mode === 'synthesis' || customPrompt === '' ? [] : guardrailIssues;
  const disabledReason = !consent
    ? t.tier2GenerateDisabledConsent
    : mode !== 'synthesis' && customPrompt === ''
      ? t.tier2GenerateDisabledEmpty
      : guardrailIssues.length > 0
        ? t.tier2GenerateDisabledGuardrail
        : undefined;

  function handleGenerate(): void {
    setGenerating(true);
    setError(undefined);
    // Consent authorizes one specific request, not a standing preference (ADR 0003) — spent the
    // moment this request is dispatched, so a second "Generate" click (or a mode switch
    // afterward sending a broader payload) requires a fresh tick, not a leftover one (#391).
    setConsent(false);
    const request =
      mode === 'grounded'
        ? { mode: 'grounded' as const, placementKeys, customPrompt, locale }
        : mode === 'freeform'
          ? { mode: 'freeform' as const, chartData: toTier2ChartPayload(chart), customPrompt, locale }
          : { mode: 'synthesis' as const, chartData: toTier2ChartPayload(chart), locale };
    generateTier2Interpretation(request)
      .then((sections) => {
        setResult(sections);
      })
      .catch((caught: unknown) => {
        setError(caught instanceof Tier2Error ? caught.message : String(caught));
      })
      .finally(() => {
        setGenerating(false);
      });
  }

  return (
    <section className="report-section ai-customized-panel">
      <h3>{t.tier2Heading}</h3>
      <fieldset className="field-group">
        <legend>{t.tier2ModeLabel}</legend>
        <div role="radiogroup" aria-label={t.tier2ModeLabel}>
          <label>
            <input
              type="radio"
              name="tier2-mode"
              checked={mode === 'grounded'}
              onChange={() => {
                setMode('grounded');
                // The consent statement's wording depends on mode (what it discloses sending
                // differs) — switching mode re-requires a tick rather than carrying over consent
                // given under a different, narrower claim (#391).
                setConsent(false);
              }}
            />{' '}
            {t.tier2ModeGrounded}
          </label>{' '}
          <label>
            <input
              type="radio"
              name="tier2-mode"
              checked={mode === 'freeform'}
              onChange={() => {
                setMode('freeform');
                setConsent(false);
              }}
            />{' '}
            {t.tier2ModeFreeform}
          </label>{' '}
          <label>
            <input
              type="radio"
              name="tier2-mode"
              checked={mode === 'synthesis'}
              onChange={() => {
                setMode('synthesis');
                setConsent(false);
              }}
            />{' '}
            {t.tier2ModeSynthesis}
          </label>
        </div>
      </fieldset>
      <label>
        <input
          type="checkbox"
          checked={consent}
          onChange={(event) => {
            setConsent(event.target.checked);
          }}
        />{' '}
        {t.tier2ConsentLabel(mode)}
      </label>
      {mode !== 'synthesis' && (
        <label className="stacked">
          {t.customPromptLabel}
          <textarea
            value={customPrompt}
            placeholder={t.customPromptPlaceholder}
            onChange={(event) => {
              setCustomPrompt(event.target.value);
            }}
          />
        </label>
      )}
      {visibleGuardrailIssues.length > 0 && (
        <div className="ai-customized-guardrail-issues warning" aria-live="polite">
          <ul>
            {visibleGuardrailIssues.map((issue) => (
              <li key={issue.rule}>{guardrailIssueMessage(t, issue)}</li>
            ))}
          </ul>
        </div>
      )}
      <button
        type="button"
        disabled={!consent || (mode !== 'synthesis' && customPrompt === '') || guardrailIssues.length > 0 || generating}
        aria-label={disabledReason === undefined ? undefined : `${t.tier2Generate} — ${disabledReason}`}
        onClick={handleGenerate}
      >
        {generating ? t.tier2Generating : t.tier2Generate}
      </button>
      {error !== undefined && <p role="alert">{t.tier2Error(error)}</p>}
      {result !== undefined && (
        <div className="tier2-result">
          {result.map((section) => (
            <article key={section.heading}>
              <h4>{section.heading}</h4>
              <p>{section.body}</p>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

export function ReportView({ chart }: { readonly chart: ChartData }): React.JSX.Element {
  const t = useMessages(reportViewMessages);
  const [activeTab, setActiveTab] = useState<InterpretationTabKey>('standard');
  const [showProvenance, setShowProvenance] = useState(false);
  const [locale] = useLocale();
  const [persona, setPersona] = useState<PersonaId | undefined>(initialPersona);
  const [corpus, setCorpus] = useState<readonly CorpusEntry[] | undefined>(undefined);
  const [loadError, setLoadError] = useState<string | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    setCorpus(undefined);
    setLoadError(undefined);
    loadRuntimeCorpus(locale, persona)
      .then((loaded) => {
        if (!cancelled) setCorpus(loaded);
      })
      .catch((error: unknown) => {
        if (!cancelled) setLoadError(error instanceof Error ? error.message : String(error));
      });
    return () => {
      cancelled = true;
    };
  }, [locale, persona]);

  const onTabKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    const currentIndex = TAB_ORDER.indexOf(activeTab);
    let nextIndex: number | undefined;
    if (event.key === 'ArrowRight') nextIndex = (currentIndex + 1) % TAB_ORDER.length;
    else if (event.key === 'ArrowLeft') nextIndex = (currentIndex - 1 + TAB_ORDER.length) % TAB_ORDER.length;
    else if (event.key === 'Home') nextIndex = 0;
    else if (event.key === 'End') nextIndex = TAB_ORDER.length - 1;
    if (nextIndex === undefined) return;
    event.preventDefault();
    const next = TAB_ORDER[nextIndex];
    if (next === undefined) return;
    setActiveTab(next);
    document.getElementById(`interpretation-tab-${next}`)?.focus();
  };

  if (loadError !== undefined) {
    return (
      <div className="report">
        <p role="alert">{t.couldNotLoad(loadError)}</p>
      </div>
    );
  }
  if (corpus === undefined) {
    return (
      <div className="report">
        <p>{t.loadingInterpretation}</p>
      </div>
    );
  }

  const report: Report = assembleReport(chart, locale, corpus, persona);

  const controls = (
    <div className="report-controls">
      {reportPersonasEnabled() && (
        <label>
          {t.advisor}
          <select
            value={persona ?? ''}
            onChange={(event) => {
              const next = event.target.value;
              if (next === '') {
                localStorage.removeItem(PERSONA_KEY);
                setPersona(undefined);
                return;
              }
              if (!isPersonaId(next)) return;
              localStorage.setItem(PERSONA_KEY, next);
              setPersona(next);
            }}
          >
            <option value="">{t.neutral}</option>
            {PERSONA_IDS.map((option) => (
              <option key={option} value={option}>
                {PERSONA_LABELS[option][locale]}
              </option>
            ))}
          </select>
        </label>
      )}
      {!import.meta.env.PROD && (
        <label>
          <input
            type="checkbox"
            checked={showProvenance}
            onChange={(event) => {
              setShowProvenance(event.target.checked);
            }}
          />{' '}
          {t.showProvenance}
        </label>
      )}
    </div>
  );

  return (
    <div className="report">
      <div className="tabs" role="tablist" aria-label={t.interpretationTablist} onKeyDown={onTabKeyDown}>
        {TAB_ORDER.map((tab) => (
          <button
            key={tab}
            type="button"
            id={`interpretation-tab-${tab}`}
            role="tab"
            aria-selected={activeTab === tab}
            aria-controls={`interpretation-tabpanel-${tab}`}
            tabIndex={activeTab === tab ? 0 : -1}
            className={activeTab === tab ? 'tab active' : 'tab'}
            onClick={() => {
              setActiveTab(tab);
            }}
          >
            {tabLabels(t)[tab]}
          </button>
        ))}
      </div>

      <div
        role="tabpanel"
        id={`interpretation-tabpanel-${activeTab}`}
        aria-labelledby={`interpretation-tab-${activeTab}`}
        tabIndex={0}
      >
        {activeTab === 'standard' ? (
          <>
            {controls}
            <nav className="report-toc" aria-label={t.tocAriaLabel}>
              <h3>{t.tocHeading}</h3>
              <ul>
                {report.sections.map((section) => (
                  <li key={section.id}>
                    {/* Not a plain in-page `<a href="#...">`: the app's own hash-based router
                        (`route.ts`) treats every `hashchange` as a navigation, and a bare
                        anchor click here would match no known route and bounce to the people
                        list instead of scrolling (#373). Scroll and focus the target directly,
                        without touching `window.location.hash`. */}
                    <a
                      href={`#report-section-${section.id}`}
                      onClick={(event) => {
                        event.preventDefault();
                        document.getElementById(`report-section-${section.id}`)?.focus();
                      }}
                    >
                      {section.title}
                    </a>
                  </li>
                ))}
              </ul>
            </nav>
            {report.sections.map((section) => (
              <section key={section.id} id={`report-section-${section.id}`} className="report-section" tabIndex={-1}>
                <h3>{section.title}</h3>
                <ul>
                  {section.paragraphs.map((paragraph, index) => (
                    <Paragraph
                      key={`${section.id}-${String(index)}`}
                      paragraph={paragraph}
                      showProvenance={showProvenance}
                    />
                  ))}
                </ul>
              </section>
            ))}
          </>
        ) : (
          <AiCustomizedPanel report={report} locale={locale} chart={chart} />
        )}
      </div>
    </div>
  );
}
