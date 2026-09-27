/**
 * Message catalogue for `CorpusOverridesPanel.tsx` (#292).
 */
const en = {
  heading: 'Corpus corrections',
  intro:
    'Browse the interpretation corpus and correct individual entries. A correction replaces the committed text everywhere it would otherwise be shown, until it is reset.',

  corpusLocaleLabel: 'Corpus language',
  scopeLabel: 'Advisor scope',
  neutral: 'Neutral',

  searchLabel: 'Search',
  categoryLabel: 'Category',
  allCategories: 'All categories',
  tierLabel: 'Tier',
  allTiers: 'All tiers',
  tagLabel: 'Tag',
  allTags: 'All tags',
  overriddenOnlyLabel: 'Overridden only',

  loadingCorpus: 'Loading corpus…',
  couldNotLoad: (message: string) => `Could not load the corpus: ${message}`,
  noResults: 'No entries match these filters.',
  resultCount: (shown: string, total: string) => `Showing ${shown} of ${total}`,
  loadMoreButton: 'Load more',
  exportButton: 'Export corrections',

  keyColumn: 'Key',
  categoryColumn: 'Category',
  tierColumn: 'Tier',
  tagsColumn: 'Tags',
  textColumn: 'Text',
  statusColumn: 'Status',
  actionsColumn: 'Actions',
  overriddenStatus: 'Overridden',
  defaultStatus: 'Corpus default',
  editButton: 'Edit',

  textLabel: 'Text',
  tierFieldLabel: 'Tier',
  tagsFieldLabel: 'Tags (comma-separated)',
  saveButton: 'Save',
  savingLabel: 'Saving…',
  cancelButton: 'Cancel',
  resetButton: 'Reset to corpus default',
  resetWarning: (key: string) => `Reset "${key}" back to its corpus default? This cannot be undone.`,
  resetPermanentlyButton: 'Reset',

  saveFailed: (message: string) => `Could not save this correction. ${message}`,
};

const nl: typeof en = {
  heading: 'Corpuscorrecties',
  intro:
    'Doorzoek het interpretatiecorpus en corrigeer afzonderlijke items. Een correctie vervangt de vastgelegde tekst overal waar deze anders zou worden getoond, totdat ze wordt teruggezet.',

  corpusLocaleLabel: 'Corpustaal',
  scopeLabel: 'Adviseursbereik',
  neutral: 'Neutraal',

  searchLabel: 'Zoeken',
  categoryLabel: 'Categorie',
  allCategories: 'Alle categorieën',
  tierLabel: 'Niveau',
  allTiers: 'Alle niveaus',
  tagLabel: 'Label',
  allTags: 'Alle labels',
  overriddenOnlyLabel: 'Alleen gecorrigeerd',

  loadingCorpus: 'Corpus laden…',
  couldNotLoad: (message: string) => `Kan het corpus niet laden: ${message}`,
  noResults: 'Geen items voldoen aan deze filters.',
  resultCount: (shown: string, total: string) => `${shown} van ${total} getoond`,
  loadMoreButton: 'Meer laden',
  exportButton: 'Correcties exporteren',

  keyColumn: 'Sleutel',
  categoryColumn: 'Categorie',
  tierColumn: 'Niveau',
  tagsColumn: 'Labels',
  textColumn: 'Tekst',
  statusColumn: 'Status',
  actionsColumn: 'Acties',
  overriddenStatus: 'Gecorrigeerd',
  defaultStatus: 'Corpusstandaard',
  editButton: 'Bewerken',

  textLabel: 'Tekst',
  tierFieldLabel: 'Niveau',
  tagsFieldLabel: 'Labels (kommagescheiden)',
  saveButton: 'Opslaan',
  savingLabel: 'Opslaan…',
  cancelButton: 'Annuleren',
  resetButton: 'Terugzetten naar corpusstandaard',
  resetWarning: (key: string) => `"${key}" terugzetten naar de corpusstandaard? Dit kan niet ongedaan worden gemaakt.`,
  resetPermanentlyButton: 'Terugzetten',

  saveFailed: (message: string) => `Deze correctie kon niet worden opgeslagen. ${message}`,
};

export const corpusOverridesPanelMessages = { en, nl };
