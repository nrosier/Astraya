import { describe, expect, it } from 'vitest';
import { isTheme, nextTheme, THEME_CYCLE, THEME_LABELS } from '../src/ui/theme.js';

describe('isTheme', () => {
  it('accepts every value in the cycle', () => {
    for (const theme of THEME_CYCLE) expect(isTheme(theme)).toBe(true);
  });

  it('rejects anything else', () => {
    expect(isTheme('dim')).toBe(false);
    expect(isTheme(undefined)).toBe(false);
    expect(isTheme(null)).toBe(false);
    expect(isTheme(3)).toBe(false);
  });
});

describe('nextTheme', () => {
  it('cycles system -> light -> dark -> system', () => {
    expect(nextTheme('system')).toBe('light');
    expect(nextTheme('light')).toBe('dark');
    expect(nextTheme('dark')).toBe('system');
  });
});

describe('THEME_LABELS', () => {
  it('has a label for every theme in the cycle', () => {
    for (const theme of THEME_CYCLE) expect(THEME_LABELS[theme]).toBeTruthy();
  });
});
