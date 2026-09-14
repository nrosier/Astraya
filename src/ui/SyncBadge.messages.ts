/**
 * Message catalogue for `SyncBadge.tsx` (#158).
 */
const en = {
  loggedInAs: (username: string) => `(logged in as: ${username})`,
  syncNow: 'Sync now',
};

const nl: typeof en = {
  loggedInAs: (username: string) => `(ingelogd als: ${username})`,
  syncNow: 'Nu synchroniseren',
};

export const syncBadgeMessages = { en, nl };
