import { describe, expect, it } from 'vitest';
import { isTheme, nextTheme, THEME_CYCLE, themeLabel } from '../src/ui/theme.js';
import { themeToggleMessages } from '../src/ui/ThemeToggle.messages.js';

const T = themeToggleMessages.en;

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

describe('themeLabel', () => {
  it('has a label for every theme in the cycle', () => {
    for (const theme of THEME_CYCLE) expect(themeLabel(theme, T)).toBeTruthy();
  });
});
