/**
 * #368 — generates a static, self-contained HTML dashboard from
 * `benchmark-batch.mjs`'s accumulated results (`lib/benchmark-db.mjs`), so
 * the accumulated history can be reviewed without re-running anything: no
 * network call, no API key, safe and free to regenerate any time.
 *
 * Shows every judge side by side — Laya, `all-minilm`, and `gemma4` — for
 * both `similarity` and `grounded` (per side), since no single one of them
 * has been validated as calibrated for astrology prose (see
 * docs/LAYA_INTERPRETATION_COMPARISON.md's own flagged, unresolved risk).
 * Clicking a row expands a detail panel with both Astraya's and
 * astrologyapi.com's actual text side by side, pulled from the temporary
 * `thirdparty_cache` table — a deliberate, scoped exception to #368's
 * "never shown" constraint, made on the user's own explicit request so
 * they can read and compare the two directly rather than only trust a
 * score. See `lib/benchmark-db.mjs`'s own doc comment for the exact scope
 * of that exception (this is still a local, gitignored file, never
 * committed, never reachable by an actual Astraya end user).
 *
 * Palette (categorical blue/orange for the Astraya-vs-third-party series,
 * the fixed status palette for the good/warning/critical tags, and a
 * 5-stop red -> orange -> yellow -> green -> bright-green magnitude ramp
 * for every colorized score dot) validated with the dataviz skill's
 * `validate_palette.js` against both the light and dark chart surfaces
 * before use — see the inline CSS custom properties below for the exact
 * hex values and their role.
 *
 *   npx tsx tools/corpus-gen/benchmark-dashboard.mjs [--out=FILE]
 */
import { writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openBenchmarkDb, allResults, allCachedThirdPartyText } from './lib/benchmark-db.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const DB_PATH = join(root, 'tools', 'corpus-gen', '.data', 'benchmark.sqlite');

const rawArgs = process.argv.slice(2);
function flag(name, fallback) {
  const found = rawArgs.find((arg) => arg.startsWith(`--${name}=`));
  return found ? found.slice(name.length + 3) : fallback;
}
const outPath = resolve(flag('out', join(root, 'tools', 'corpus-gen', '.data', 'benchmark-dashboard.html')));

const IN_SCOPE_CATEGORIES = ['planet-in-sign', 'planet-in-house', 'sign-on-cusp', 'aspect-pair'];
/** Column count the detail row's colspan must match — kept as one constant read by both the
 * header array below and the row renderer, so the two can never silently drift apart. */
const COLUMNS = [
  { key: 'status', label: 'status' },
  { key: 'placement_key', label: 'placement', mono: true },
  { key: 'category', label: 'category' },
  { key: 'similarity_score', label: 'sim (Laya)' },
  { key: 'embedding_similarity', label: 'sim (all-minilm)' },
  { key: 'similarity_score_llm', label: 'sim (gemma4)' },
  { key: 'grounded_astraya', label: 'grnd astraya (Laya)' },
  { key: 'grounded_astraya_embedding', label: 'grnd astraya (all-minilm)' },
  { key: 'grounded_astraya_llm', label: 'grnd astraya (gemma4)' },
  { key: 'grounded_thirdparty', label: 'grnd 3rd-party (Laya)' },
  { key: 'grounded_thirdparty_embedding', label: 'grnd 3rd-party (all-minilm)' },
  { key: 'grounded_thirdparty_llm', label: 'grnd 3rd-party (gemma4)' },
  { key: 'preference', label: 'preference' },
  { key: 'astraya_model', label: 'astraya model' },
  { key: 'checked_at', label: 'checked' },
];

/** Similarity is the whole question, per the user's own framing: similar to the third-party text
 * is good, not similar is bad. Averages whichever similarity judges actually ran (Laya always
 * does; `all-minilm`/`gemma4` are each optional) into one 0..1 score to decide the tag, and flags
 * `warning` when the judges that did run disagree sharply (max pairwise spread > 0.4) — worth a
 * second look regardless of where the average lands. */
function statusOf(row) {
  if (row.skipped) return { tag: 'needs review', reason: row.skip_reason ?? 'skipped' };

  const normalized = [];
  if (row.similarity_score !== null) normalized.push(row.similarity_score / 3);
  if (row.embedding_similarity !== null) normalized.push(Math.max(0, row.embedding_similarity));
  if (row.similarity_score_llm !== null) normalized.push(row.similarity_score_llm / 3);

  const spread = normalized.length > 1 ? Math.max(...normalized) - Math.min(...normalized) : 0;
  if (spread > 0.4)
    return { tag: 'warning', reason: `the similarity judges disagree sharply (spread ${spread.toFixed(2)})` };

  const avg = normalized.reduce((a, b) => a + b, 0) / normalized.length;
  return avg >= 0.5
    ? {
        tag: 'good',
        reason: `mean normalized similarity ${avg.toFixed(2)} across ${String(normalized.length)} judge(s)`,
      }
    : {
        tag: 'bad',
        reason: `mean normalized similarity ${avg.toFixed(2)} across ${String(normalized.length)} judge(s)`,
      };
}

function escapeHtml(value) {
  return String(value).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
}

function mean(values) {
  return values.length === 0 ? undefined : values.reduce((a, b) => a + b, 0) / values.length;
}

/** Pearson correlation, `undefined` (not 0) below 3 pairs — a coefficient over 1-2 points is
 * noise dressed as a signal. Used for every judge-vs-judge agreement stat. */
function pearson(xs, ys) {
  if (xs.length < 3) return undefined;
  const n = xs.length;
  const meanX = xs.reduce((a, b) => a + b, 0) / n;
  const meanY = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let denX = 0;
  let denY = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - meanX;
    const dy = ys[i] - meanY;
    num += dx * dy;
    denX += dx * dx;
    denY += dy * dy;
  }
  return num / Math.sqrt(denX * denY);
}

function fmt(value) {
  return value === undefined || value === null ? '—' : value.toFixed(3);
}

function statTile(label, value) {
  return `<div class="tile"><div class="tile-value">${escapeHtml(value)}</div><div class="tile-label">${escapeHtml(label)}</div></div>`;
}

/** Red (not similar/ungrounded) -> orange -> yellow -> green -> bright green (very similar/well
 * grounded), the user's own requested 5-step scale. Four validated status-palette-adjacent stops
 * rather than a raw 2-color RGB lerp (which passes through a muddy off-hue at the midpoint).
 * Colors the *dot*, never the text itself — text stays in normal ink, since the yellow stop's own
 * documented light-surface contrast is sub-3:1 and unsafe to put text directly on top of. */
function mixHex(hexA, hexB, t) {
  const [ar, ag, ab] = hexA.match(/../g).map((h) => parseInt(h, 16));
  const [br, bg, bb] = hexB.match(/../g).map((h) => parseInt(h, 16));
  const lerp = (a, b) => Math.round(a + (b - a) * t);
  return `rgb(${lerp(ar, br)}, ${lerp(ag, bg)}, ${lerp(ab, bb)})`;
}

const MAGNITUDE_STOPS = ['#d03b3b', '#e8763a', '#fab219', '#0ca30c', '#3ddc4a'];
function magnitudeColor(t) {
  const clamped = Math.max(0, Math.min(1, t));
  const segment = clamped * (MAGNITUDE_STOPS.length - 1);
  const index = Math.min(MAGNITUDE_STOPS.length - 2, Math.floor(segment));
  return mixHex(MAGNITUDE_STOPS[index], MAGNITUDE_STOPS[index + 1], segment - index);
}

/** A colored dot plus the raw value — `normalized` must already be on a 0..1 scale (callers
 * divide Laya's/gemma4's 0..3 similarity score by 3 before calling this). */
function magnitudeDot(normalized, rawLabel) {
  if (normalized === undefined || normalized === null) return '<span class="muted">—</span>';
  const color = magnitudeColor(normalized);
  return `<span class="magnitude-dot" style="background:${color}" title="normalized ${normalized.toFixed(2)}"></span>${escapeHtml(rawLabel)}`;
}

/** One grouped-bar row per category: Astraya's mean grounded score (Laya) above third-party's,
 * both on a shared 0..1 scale — a single axis, categorical color by entity (never by rank), per
 * the dataviz skill's own rules. Laya's own grounded score specifically, since it's the one every
 * scored row always has (the other two judges are optional per-row). */
function categoryBarsHtml(rows) {
  const bars = IN_SCOPE_CATEGORIES.map((category) => {
    const scored = rows.filter((r) => r.category === category && !r.skipped);
    const astraya = mean(scored.map((r) => r.grounded_astraya));
    const thirdparty = mean(scored.map((r) => r.grounded_thirdparty));
    const bar = (value, seriesClass) =>
      value === undefined
        ? '<div class="bar-track empty">no scored results yet</div>'
        : `<div class="bar-track"><div class="bar ${seriesClass}" style="width:${String(Math.max(value * 100, 2))}%"></div><span class="bar-value">${fmt(value)}</span></div>`;
    return `
      <div class="category-row">
        <div class="category-label">${escapeHtml(category)} <span class="muted">(${String(scored.length)} scored)</span></div>
        ${bar(astraya, 'series-astraya')}
        ${bar(thirdparty, 'series-thirdparty')}
      </div>`;
  });
  return bars.join('\n');
}

function tableRowHtml(row) {
  const status = statusOf(row);
  const skipped = row.skipped === 1;
  const cell = (html) => (skipped ? '<td class="num">—</td>' : `<td class="num">${html}</td>`);
  return `
    <tr class="main-row" data-key="${escapeHtml(row.placement_key)}" data-status="${escapeHtml(status.tag)}" data-category="${escapeHtml(row.category)}">
      <td><span class="tag tag-${escapeHtml(status.tag.replace(' ', '-'))}" title="${escapeHtml(status.reason)}">${escapeHtml(status.tag)}</span></td>
      <td class="mono">${escapeHtml(row.placement_key)}</td>
      <td>${escapeHtml(row.category)}</td>
      ${cell(magnitudeDot(row.similarity_score === null ? null : row.similarity_score / 3, fmt(row.similarity_score)))}
      ${cell(magnitudeDot(row.embedding_similarity, fmt(row.embedding_similarity)))}
      ${cell(magnitudeDot(row.similarity_score_llm === null ? null : row.similarity_score_llm / 3, fmt(row.similarity_score_llm)))}
      ${cell(magnitudeDot(row.grounded_astraya, fmt(row.grounded_astraya)))}
      ${cell(magnitudeDot(row.grounded_astraya_embedding, fmt(row.grounded_astraya_embedding)))}
      ${cell(magnitudeDot(row.grounded_astraya_llm, fmt(row.grounded_astraya_llm)))}
      ${cell(magnitudeDot(row.grounded_thirdparty, fmt(row.grounded_thirdparty)))}
      ${cell(magnitudeDot(row.grounded_thirdparty_embedding, fmt(row.grounded_thirdparty_embedding)))}
      ${cell(magnitudeDot(row.grounded_thirdparty_llm, fmt(row.grounded_thirdparty_llm)))}
      <td class="muted">${skipped ? '—' : escapeHtml(row.preference)}</td>
      <td class="muted">${row.astraya_model ? escapeHtml(row.astraya_model) : '<span class="muted">—</span>'} <span class="muted">(${escapeHtml(row.astraya_source)})</span></td>
      <td class="muted mono">${escapeHtml(row.checked_at)}</td>
    </tr>`;
}

/** The click-to-expand comparison panel — see this file's own doc comment for the deliberate,
 * scoped exception that makes showing the cached third-party text here acceptable. Hidden by
 * default; toggled by the page's own script. */
function detailRowHtml(row, thirdPartyText) {
  return `
    <tr class="detail-row" data-key="${escapeHtml(row.placement_key)}" style="display:none">
      <td class="detail-cell">
        <div class="detail-grid">
          <div>
            <h3>Astraya${row.astraya_model ? ` <span class="muted">(${escapeHtml(row.astraya_model)}, ${escapeHtml(row.astraya_source)})</span>` : ''}</h3>
            <p>${escapeHtml(row.astraya_text)}</p>
          </div>
          <div>
            <h3>astrologyapi.com</h3>
            <p>${thirdPartyText ? escapeHtml(thirdPartyText) : '<span class="muted">not available — cache purged, or this placement was skipped before a report was fetched.</span>'}</p>
          </div>
        </div>
      </td>
    </tr>`;
}

function buildHtml(rows, cachedThirdParty) {
  const scored = rows.filter((r) => !r.skipped);
  const meanAstraya = mean(scored.map((r) => r.grounded_astraya));
  const meanThirdParty = mean(scored.map((r) => r.grounded_thirdparty));
  const astrayaWins = scored.filter((r) => r.preference === 'astraya').length;
  const winRate = scored.length > 0 ? astrayaWins / scored.length : undefined;

  const layaSim = scored.map((r) => r.similarity_score).filter((v) => v !== null);
  const embedSim = scored.map((r) => r.embedding_similarity).filter((v) => v !== null);
  const llmSim = scored.map((r) => r.similarity_score_llm).filter((v) => v !== null);
  const pairedLayaEmbed = scored.filter((r) => r.similarity_score !== null && r.embedding_similarity !== null);
  const pairedLayaLlm = scored.filter((r) => r.similarity_score !== null && r.similarity_score_llm !== null);
  const pairedEmbedLlm = scored.filter((r) => r.embedding_similarity !== null && r.similarity_score_llm !== null);

  const goodCount = rows.filter((r) => statusOf(r).tag === 'good').length;
  const badCount = rows.filter((r) => statusOf(r).tag === 'bad').length;

  const cachedCount = rows.filter((r) => cachedThirdParty.has(r.placement_key)).length;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>#368 benchmark dashboard — Astraya vs. astrologyapi.com</title>
<style>
  /* Variables live on :root, not .viz-root — .viz-root is a child of body, and a CSS custom
     property is only visible to the element it is declared on and that element's descendants.
     Declaring these on .viz-root left body's own background/color rules unable to see them at
     all (body is .viz-root's ancestor, not its descendant), so body silently fell back to the
     browser's plain default colors regardless of theme — the dark-mode-unreadable-text bug. */
  :root {
    color-scheme: light;
    --surface-1: #fcfcfb;
    --page: #f9f9f7;
    --text-primary: #0b0b0b;
    --text-secondary: #52514e;
    --muted: #898781;
    --gridline: #e1e0d9;
    --series-astraya: #2a78d6;
    --series-thirdparty: #eb6834;
    --status-good: #0ca30c;
    --status-warning: #fab219;
    --status-critical: #d03b3b;
  }
  @media (prefers-color-scheme: dark) {
    :root:where(:not([data-theme="light"])) {
      color-scheme: dark;
      --surface-1: #1a1a19;
      --page: #0d0d0d;
      --text-primary: #ffffff;
      --text-secondary: #c3c2b7;
      --muted: #898781;
      --gridline: #2c2c2a;
      --series-astraya: #3987e5;
      --series-thirdparty: #d95926;
      --status-good: #0ca30c;
      --status-warning: #fab219;
      --status-critical: #d03b3b;
    }
  }
  :root[data-theme="dark"] {
    color-scheme: dark;
    --surface-1: #1a1a19;
    --page: #0d0d0d;
    --text-primary: #ffffff;
    --text-secondary: #c3c2b7;
    --muted: #898781;
    --gridline: #2c2c2a;
    --series-astraya: #3987e5;
    --series-thirdparty: #d95926;
    --status-good: #0ca30c;
    --status-warning: #fab219;
    --status-critical: #d03b3b;
  }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--page); font-family: system-ui, -apple-system, "Segoe UI", sans-serif; color: var(--text-primary); }
  .viz-root { padding: 24px; max-width: 1200px; margin: 0 auto; }
  h1 { font-size: 20px; margin: 0 0 4px; }
  .subtitle { color: var(--text-secondary); font-size: 13px; margin: 0 0 24px; }
  .tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 12px; margin-bottom: 28px; }
  .tile { background: var(--surface-1); border: 1px solid var(--gridline); border-radius: 8px; padding: 14px 16px; }
  .tile-value { font-size: 22px; font-weight: 600; font-variant-numeric: tabular-nums; }
  .tile-label { font-size: 12px; color: var(--text-secondary); margin-top: 2px; }
  section { background: var(--surface-1); border: 1px solid var(--gridline); border-radius: 8px; padding: 18px; margin-bottom: 24px; }
  section h2 { font-size: 14px; margin: 0 0 14px; color: var(--text-secondary); text-transform: uppercase; letter-spacing: 0.04em; }
  .legend { display: flex; gap: 16px; margin-bottom: 12px; font-size: 12px; color: var(--text-secondary); }
  .legend span { display: inline-flex; align-items: center; gap: 6px; }
  .swatch { width: 10px; height: 10px; border-radius: 2px; display: inline-block; }
  .magnitude-dot { width: 8px; height: 8px; border-radius: 50%; display: inline-block; margin-right: 5px; vertical-align: middle; }
  .category-row { margin-bottom: 12px; }
  .category-label { font-size: 13px; margin-bottom: 4px; }
  .bar-track { position: relative; height: 16px; background: var(--gridline); border-radius: 4px; margin-bottom: 3px; overflow: hidden; }
  .bar-track.empty { display: flex; align-items: center; padding-left: 8px; font-size: 11px; color: var(--muted); background: none; border: 1px dashed var(--gridline); }
  .bar { height: 100%; border-radius: 4px; }
  .bar.series-astraya { background: var(--series-astraya); }
  .bar.series-thirdparty { background: var(--series-thirdparty); }
  .bar-value { position: absolute; right: 6px; top: 0; font-size: 11px; line-height: 16px; color: var(--text-primary); font-variant-numeric: tabular-nums; }
  .table-scroll { overflow-x: auto; }
  table { width: 100%; min-width: 1400px; border-collapse: collapse; font-size: 12px; }
  th, td { text-align: left; padding: 6px 8px; border-bottom: 1px solid var(--gridline); white-space: nowrap; }
  th { color: var(--text-secondary); cursor: pointer; user-select: none; white-space: nowrap; }
  th:hover { color: var(--text-primary); }
  td.num { font-variant-numeric: tabular-nums; text-align: right; }
  td.mono, th.mono { font-family: ui-monospace, monospace; font-size: 11px; }
  .muted { color: var(--muted); }
  .tag { font-size: 11px; padding: 2px 7px; border-radius: 10px; color: #fff; white-space: nowrap; }
  .tag-good { background: var(--status-good); }
  .tag-warning { background: var(--status-warning); color: #2a2200; }
  .tag-bad { background: var(--status-critical); }
  .tag-needs-review { background: var(--muted); }
  .filters { margin-bottom: 12px; font-size: 12px; }
  .filters button { border: 1px solid var(--gridline); background: var(--surface-1); color: var(--text-primary); border-radius: 6px; padding: 4px 10px; margin-right: 6px; cursor: pointer; font-size: 12px; }
  .filters button.active { background: var(--text-primary); color: var(--surface-1); }
  tr.main-row { cursor: pointer; }
  tr.main-row:hover { background: var(--page); }
  .detail-cell { background: var(--page); white-space: normal; padding: 16px !important; }
  .detail-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }
  .detail-grid h3 { font-size: 12px; margin: 0 0 6px; color: var(--text-secondary); }
  .detail-grid p { font-size: 13px; line-height: 1.5; margin: 0; white-space: normal; }
</style>
</head>
<body>
<div class="viz-root">
  <h1>#368 benchmark: Astraya vs. astrologyapi.com</h1>
  <p class="subtitle">Judged by Laya, all-minilm, and gemma4. Generated ${escapeHtml(new Date().toISOString())} from ${escapeHtml(rows.length)} accumulated result(s), ${escapeHtml(cachedCount)} with a cached third-party text available to read (click a row to compare). No third-party prose appears anywhere on this page except inside that per-row detail panel — see this file's own doc comment for the deliberate, scoped exception.</p>

  <div class="tiles">
    ${statTile('checked', rows.length)}
    ${statTile('scored', scored.length)}
    ${statTile('skipped', rows.length - scored.length)}
    ${statTile('good (similar)', goodCount)}
    ${statTile('bad (not similar)', badCount)}
    ${statTile('mean sim (Laya)', layaSim.length ? `${fmt(mean(layaSim))} / 3` : '—')}
    ${statTile('mean sim (all-minilm)', fmt(mean(embedSim)))}
    ${statTile('mean sim (gemma4)', llmSim.length ? `${fmt(mean(llmSim))} / 3` : '—')}
    ${statTile(
      'agreement Laya/all-minilm (r)',
      fmt(
        pearson(
          pairedLayaEmbed.map((r) => r.similarity_score / 3),
          pairedLayaEmbed.map((r) => r.embedding_similarity),
        ),
      ),
    )}
    ${statTile(
      'agreement Laya/gemma4 (r)',
      fmt(
        pearson(
          pairedLayaLlm.map((r) => r.similarity_score / 3),
          pairedLayaLlm.map((r) => r.similarity_score_llm / 3),
        ),
      ),
    )}
    ${statTile(
      'agreement all-minilm/gemma4 (r)',
      fmt(
        pearson(
          pairedEmbedLlm.map((r) => r.embedding_similarity),
          pairedEmbedLlm.map((r) => r.similarity_score_llm / 3),
        ),
      ),
    )}
    ${statTile('mean grounded (Laya) — Astraya', fmt(meanAstraya))}
    ${statTile('mean grounded (Laya) — 3rd-party', fmt(meanThirdParty))}
    ${statTile('preference win rate — Astraya', winRate === undefined ? '—' : `${(winRate * 100).toFixed(0)}%`)}
  </div>

  <section>
    <h2>Mean grounded score by category (Laya)</h2>
    <div class="legend">
      <span><span class="swatch" style="background:var(--series-astraya)"></span>Astraya</span>
      <span><span class="swatch" style="background:var(--series-thirdparty)"></span>astrologyapi.com</span>
    </div>
    ${categoryBarsHtml(rows)}
  </section>

  <section>
    <h2>All results — click a row to read and compare both texts</h2>
    <div class="filters" id="filters">
      <button data-filter="all" class="active">all</button>
      <button data-filter="bad">bad</button>
      <button data-filter="warning">warning</button>
      <button data-filter="good">good</button>
      <button data-filter="needs review">needs review</button>
    </div>
    <div class="table-scroll">
      <table id="results-table">
        <thead>
          <tr>
            ${COLUMNS.map((c) => `<th data-sort="${c.key}"${c.mono ? ' class="mono"' : ''}>${escapeHtml(c.label)}</th>`).join('\n            ')}
          </tr>
        </thead>
        <tbody>
          ${rows.map((row) => tableRowHtml(row) + detailRowHtml(row, cachedThirdParty.get(row.placement_key))).join('\n')}
        </tbody>
      </table>
    </div>
  </section>
</div>
<script>
  const COLUMN_COUNT = ${String(COLUMNS.length)};
  const table = document.getElementById('results-table');
  const tbody = table.querySelector('tbody');
  tbody.querySelectorAll('.detail-cell').forEach((td) => { td.colSpan = COLUMN_COUNT; });

  tbody.addEventListener('click', (e) => {
    const tr = e.target.closest('tr.main-row');
    if (!tr) return;
    const detail = tbody.querySelector('tr.detail-row[data-key="' + tr.dataset.key.replace(/"/g, '') + '"]');
    if (detail) detail.style.display = detail.style.display === 'none' ? '' : 'none';
  });

  function detailFor(mainRow) {
    return tbody.querySelector('tr.detail-row[data-key="' + mainRow.dataset.key.replace(/"/g, '') + '"]');
  }

  document.getElementById('filters').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-filter]');
    if (!btn) return;
    document.querySelectorAll('#filters button').forEach((b) => b.classList.toggle('active', b === btn));
    const filter = btn.dataset.filter;
    tbody.querySelectorAll('tr.main-row').forEach((tr) => {
      const show = filter === 'all' || tr.dataset.status === filter;
      tr.style.display = show ? '' : 'none';
      const detail = detailFor(tr);
      if (detail && !show) detail.style.display = 'none';
    });
  });

  let sortState = {};
  table.querySelectorAll('th[data-sort]').forEach((th) => {
    th.addEventListener('click', () => {
      const key = th.dataset.sort;
      const asc = sortState[key] = !sortState[key];
      const cellIndex = Array.from(th.parentElement.children).indexOf(th);
      const mainRows = Array.from(tbody.querySelectorAll('tr.main-row'));
      mainRows.sort((a, b) => {
        const av = a.children[cellIndex].textContent.trim();
        const bv = b.children[cellIndex].textContent.trim();
        const an = Number(av), bn = Number(bv);
        const cmp = !Number.isNaN(an) && !Number.isNaN(bn) ? an - bn : av.localeCompare(bv);
        return asc ? cmp : -cmp;
      });
      mainRows.forEach((tr) => {
        tbody.appendChild(tr);
        const detail = detailFor(tr);
        if (detail) tbody.appendChild(detail);
      });
    });
  });
</script>
</body>
</html>
`;
}

const db = openBenchmarkDb(DB_PATH);
const rows = allResults(db);
const cachedThirdParty = allCachedThirdPartyText(db);
db.close();

console.log(
  `read ${String(rows.length)} result(s) from ${DB_PATH}, ${String(cachedThirdParty.size)} with a cached third-party text`,
);
await writeFile(outPath, buildHtml(rows, cachedThirdParty));
console.log(`wrote dashboard to ${outPath}`);
