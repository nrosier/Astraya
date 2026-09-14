/**
 * Message catalogue for `theme.ts`/`ThemeToggle.tsx` (#158). `themeLabel()` in `theme.ts`
 * is a pure function with no locale access of its own, so it takes a `t` of this shape —
 * the same pattern `status.ts`'s `describeStatus()` uses.
 */
const en = {
  system: 'Theme: System',
  light: 'Theme: Light',
  dark: 'Theme: Dark',
  activateToChange: (label: string) => `${label} — activate to change`,
};

const nl: typeof en = {
  system: 'Thema: Systeem',
  light: 'Thema: Licht',
  dark: 'Thema: Donker',
  activateToChange: (label: string) => `${label} — klik om te wijzigen`,
};

export const themeToggleMessages = { en, nl };
