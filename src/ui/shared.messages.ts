/**
 * Message-catalogue entries duplicated verbatim across many components (#158) — one shared
 * source instead of a copy pasted into each component's own catalogue file.
 */
const en = {
  back: 'Back',
};

const nl: typeof en = {
  back: 'Terug',
};

export const sharedMessages = { en, nl };
