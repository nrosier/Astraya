/**
 * Message catalogue for `status.ts` (#158). `ago()`, `changes()` and `describeStatus()`
 * are pure functions with no locale access of their own, so each now takes a `t` of this
 * shape — the same pattern `AccountPanel.tsx`'s `changes()` uses.
 */
const en = {
  justNow: 'just now',
  minutesAgo: (n: string) => `${n} minutes ago`,
  anHourAgo: 'an hour ago',
  hoursAgo: (n: string) => `${n} hours ago`,
  yesterday: 'yesterday',
  daysAgo: (n: string) => `${n} days ago`,

  oneChange: '1 change',
  changesCount: (n: string) => `${n} changes`,

  syncFailing: 'Sync failing',
  syncRetrying: 'Sync retrying',
  syncFailingDetail: (since: string, message: string) =>
    `Syncing has been failing since ${since}. Nothing has been lost — every change is saved on this device and will be sent when syncing recovers. ${message}`,
  exportACopy: 'Export a copy',

  quarantinedLabel: (n: string) => `${n} won't sync`,
  quarantinedDetail: (changes: string) =>
    `${changes} could not sync because this device's clock was off when they were made. They are still saved here, but will not be retried — export a copy to keep them.`,

  localOnly: 'Local only',
  localOnlyEvictableDetail:
    'This device holds the only copy of your data, and the browser has not promised to keep it. Export a copy, or sign in to sync.',
  localOnlyPersistedDetail:
    'This device holds the only copy of your data. The browser has agreed to keep it, but a lost device is a lost copy — export a copy, or sign in to sync.',
  howToKeepACopy: 'How to keep a copy',

  syncingLabel: 'Syncing…',
  sendingDetail: (changes: string) => `Sending ${changes} to your server.`,

  offline: 'Offline',
  offlineWaitingLabel: (changes: string) => `Offline — ${changes} waiting`,
  offlineNoneWaitingDetail: 'No network. Everything works offline; nothing is waiting to be sent.',
  offlineWaitingDetail: (changes: string) =>
    `No network. ${changes} are saved on this device and will be sent when you are back online.`,

  toSendLabel: (changes: string) => `${changes} to send`,
  waitingToSync: 'Waiting to sync.',

  synced: 'Synced',
  syncedDetail: (ago: string) => `Everything reached your server ${ago}.`,
};

const nl: typeof en = {
  justNow: 'zojuist',
  minutesAgo: (n: string) => `${n} minuten geleden`,
  anHourAgo: 'een uur geleden',
  hoursAgo: (n: string) => `${n} uur geleden`,
  yesterday: 'gisteren',
  daysAgo: (n: string) => `${n} dagen geleden`,

  oneChange: '1 wijziging',
  changesCount: (n: string) => `${n} wijzigingen`,

  syncFailing: 'Synchronisatie mislukt',
  syncRetrying: 'Synchronisatie opnieuw proberen',
  syncFailingDetail: (since: string, message: string) =>
    `Synchronisatie mislukt sinds ${since}. Er is niets verloren gegaan — elke wijziging is opgeslagen op dit apparaat en wordt verzonden zodra synchronisatie herstelt. ${message}`,
  exportACopy: 'Kopie exporteren',

  quarantinedLabel: (n: string) => `${n} synchroniseert niet`,
  quarantinedDetail: (changes: string) =>
    `${changes} konden niet synchroniseren omdat de klok van dit apparaat verkeerd stond toen ze werden gemaakt. Ze zijn hier nog wel opgeslagen, maar worden niet opnieuw geprobeerd — exporteer een kopie om ze te behouden.`,

  localOnly: 'Alleen lokaal',
  localOnlyEvictableDetail:
    'Dit apparaat bevat de enige kopie van je gegevens, en de browser heeft niet toegezegd deze te bewaren. Exporteer een kopie, of log in om te synchroniseren.',
  localOnlyPersistedDetail:
    'Dit apparaat bevat de enige kopie van je gegevens. De browser heeft toegezegd deze te bewaren, maar een verloren apparaat is een verloren kopie — exporteer een kopie, of log in om te synchroniseren.',
  howToKeepACopy: 'Hoe bewaar je een kopie',

  syncingLabel: 'Synchroniseren…',
  sendingDetail: (changes: string) => `${changes} worden naar je server verzonden.`,

  offline: 'Offline',
  offlineWaitingLabel: (changes: string) => `Offline — ${changes} in wachtrij`,
  offlineNoneWaitingDetail: 'Geen netwerk. Alles werkt offline; er staat niets in de wachtrij.',
  offlineWaitingDetail: (changes: string) =>
    `Geen netwerk. ${changes} zijn opgeslagen op dit apparaat en worden verzonden zodra je weer online bent.`,

  toSendLabel: (changes: string) => `${changes} te verzenden`,
  waitingToSync: 'Wachten op synchronisatie.',

  synced: 'Gesynchroniseerd',
  syncedDetail: (ago: string) => `Alles is ${ago} bij je server aangekomen.`,
};

export const statusMessages = { en, nl };
