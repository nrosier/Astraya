/**
 * #70's third checkbox — "chart wheel legible in both [themes], verified rather than
 * assumed" — checked here by computing real WCAG contrast ratios from the palette
 * tokens in `app.css` itself, rather than by eyeballing a screenshot.
 *
 * The wheel's aspect lines are drawn at reduced opacity (`app.css`'s
 * `.chart-aspect-*` rules), so their color alone understates what a viewer actually
 * sees: this blends each aspect stroke against the aspect-web's background (the
 * `--surface` token, per `.wheel-ring-aspect`'s fill) at its real opacity before
 * measuring contrast, per WCAG 1.4.11's treatment of translucent graphical objects.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(join(import.meta.dirname, '../src/ui/app.css'), 'utf-8');

function tokenBlock(selector: string): Record<string, string> {
  const start = css.indexOf(selector);
  if (start === -1) throw new Error(`token block not found: ${selector}`);
  const open = css.indexOf('{', start);
  const close = css.indexOf('}', open);
  const body = css.slice(open + 1, close);
  const tokens: Record<string, string> = {};
  const re = /--([a-z-]+):\s*(#[0-9a-fA-F]{6});/g;
  for (const [, name, hex] of body.matchAll(re)) {
    if (name !== undefined && hex !== undefined) tokens[name] = hex;
  }
  return tokens;
}

type Rgb = readonly [number, number, number];

function hexToRgb(hex: string): Rgb {
  const n = Number.parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function relativeLuminance([r, g, b]: Rgb): number {
  const [rs, gs, bs] = [r, g, b].map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
}

function contrastRatio(a: Rgb, b: Rgb): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** The color actually rendered where a translucent stroke sits over an opaque background. */
function blendOver([fr, fgc, fb]: Rgb, [br, bgc, bb]: Rgb, alpha: number): Rgb {
  return [fr * alpha + br * (1 - alpha), fgc * alpha + bgc * (1 - alpha), fb * alpha + bb * (1 - alpha)];
}

const THEMES = {
  dark: tokenBlock(":root[data-theme='dark']"),
  light: tokenBlock(":root[data-theme='light']"),
};

// From `.chart-aspect-*` in app.css: stroke color paired with the opacity that rule applies.
const ASPECT_LINES = [
  { name: 'hard', token: 'aspect-hard', opacity: 0.75 },
  { name: 'soft', token: 'aspect-soft', opacity: 0.7 },
  { name: 'minor', token: 'aspect-minor', opacity: 0.6 },
] as const;

// WCAG 1.4.11: non-text graphical objects need 3:1 against their background.
const GRAPHICAL_MIN_CONTRAST = 3;
// WCAG AA for normal-size text (the wheel's ring labels render at ~11px, not "large text").
const TEXT_MIN_CONTRAST = 4.5;

describe.each(Object.entries(THEMES))('wheel palette in %s mode', (_themeName, tokens) => {
  const surface = hexToRgb(tokens.surface ?? '');
  const bg = hexToRgb(tokens.bg ?? '');

  it.each(ASPECT_LINES)('$name aspect lines (opacity $opacity) read against the aspect web', ({ token, opacity }) => {
    const stroke = hexToRgb(tokens[token] ?? '');
    const blended = blendOver(stroke, surface, opacity);
    expect(contrastRatio(blended, surface)).toBeGreaterThanOrEqual(GRAPHICAL_MIN_CONTRAST);
  });

  it('ring labels and tick marks (var(--muted), full opacity) read against the aspect web', () => {
    const muted = hexToRgb(tokens.muted ?? '');
    expect(contrastRatio(muted, surface)).toBeGreaterThanOrEqual(TEXT_MIN_CONTRAST);
  });

  it('body glyphs (var(--fg)) read against both the wheel background and the aspect web', () => {
    const fg = hexToRgb(tokens.fg ?? '');
    expect(contrastRatio(fg, surface)).toBeGreaterThanOrEqual(GRAPHICAL_MIN_CONTRAST);
    expect(contrastRatio(fg, bg)).toBeGreaterThanOrEqual(GRAPHICAL_MIN_CONTRAST);
  });

  it('sign glyphs (var(--accent)) read against both the wheel background and the aspect web', () => {
    const accent = hexToRgb(tokens.accent ?? '');
    expect(contrastRatio(accent, surface)).toBeGreaterThanOrEqual(GRAPHICAL_MIN_CONTRAST);
    expect(contrastRatio(accent, bg)).toBeGreaterThanOrEqual(GRAPHICAL_MIN_CONTRAST);
  });
});
