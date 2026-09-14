/**
 * Message catalogue for `LanguageToggle.tsx` (#158). `LOCALE_LABELS` in `locale.ts` stays
 * untranslated — those are endonyms (English, Nederlands), not chrome text.
 */
const en = {
  languageLabel: (label: string) => `Language: ${label} — activate to change`,
};

const nl: typeof en = {
  languageLabel: (label: string) => `Taal: ${label} — klik om te wijzigen`,
};

export const languageToggleMessages = { en, nl };
