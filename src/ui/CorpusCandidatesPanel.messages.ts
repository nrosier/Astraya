/**
 * Message catalogue for `CorpusCandidatesPanel.tsx` (#370).
 */
const en = {
  heading: 'Corpus candidate review',
  intro:
    'Bulk-generated candidate text awaiting review, sorted worst triage score first. Accepting turns a candidate into a live correction (see Corpus corrections); rejecting discards it. Neither can be undone from here.',

  corpusLocaleLabel: 'Corpus language',
  statusLabel: 'Status',

  loadingCandidates: 'Loading candidates…',
  couldNotLoad: (message: string) => `Could not load candidates: ${message}`,
  noResults: 'No candidates match these filters.',

  selectAllLabel: 'Select all shown',
  selectedCount: (count: string) => `${count} selected`,
  acceptSelectedButton: 'Accept selected',
  rejectSelectedButton: 'Reject selected',
  deciding: 'Working…',
  decideFailed: (message: string) => `Could not decide on the selected candidates. ${message}`,
  missingWarning: (count: string) =>
    `${count} of the selected candidates were already decided elsewhere and were skipped.`,

  keyColumn: 'Key',
  sourceColumn: 'Source',
  triageColumn: 'Triage',
  tagsColumn: 'Tags',
  textColumn: 'Text',
  actionsColumn: 'Actions',
  acceptButton: 'Accept',
  rejectButton: 'Reject',

  sourceClassicalSeed: 'Classical seed',
  sourceLlmFill: 'LLM fill',
  triageMatch: 'Matches tradition',
  triageMismatch: 'Diverges from tradition',
  triageNoBaseline: 'No classical baseline',
  triageUnchecked: 'Not yet checked',

  duplicateKeyHint: 'Another candidate for this same placement is also pending — compare before deciding either.',
};

const nl: typeof en = {
  heading: 'Beoordeling kandidaat-corpusteksten',
  intro:
    'In bulk gegenereerde kandidaatteksten die op beoordeling wachten, gesorteerd op slechtste triagescore eerst. Goedkeuren maakt een kandidaat tot een actieve correctie (zie Corpuscorrecties); afwijzen verwijdert de kandidaat. Beide zijn hier niet ongedaan te maken.',

  corpusLocaleLabel: 'Corpustaal',
  statusLabel: 'Status',

  loadingCandidates: 'Kandidaten laden…',
  couldNotLoad: (message: string) => `Kan kandidaten niet laden: ${message}`,
  noResults: 'Geen kandidaten voldoen aan deze filters.',

  selectAllLabel: 'Alles selecteren',
  selectedCount: (count: string) => `${count} geselecteerd`,
  acceptSelectedButton: 'Selectie goedkeuren',
  rejectSelectedButton: 'Selectie afwijzen',
  deciding: 'Bezig…',
  decideFailed: (message: string) => `Kon niet beslissen over de geselecteerde kandidaten. ${message}`,
  missingWarning: (count: string) =>
    `${count} van de geselecteerde kandidaten waren elders al besloten en zijn overgeslagen.`,

  keyColumn: 'Sleutel',
  sourceColumn: 'Bron',
  triageColumn: 'Triage',
  tagsColumn: 'Labels',
  textColumn: 'Tekst',
  actionsColumn: 'Acties',
  acceptButton: 'Goedkeuren',
  rejectButton: 'Afwijzen',

  sourceClassicalSeed: 'Klassieke bronseed',
  sourceLlmFill: 'LLM-aanvulling',
  triageMatch: 'Sluit aan bij traditie',
  triageMismatch: 'Wijkt af van traditie',
  triageNoBaseline: 'Geen klassieke basis',
  triageUnchecked: 'Nog niet gecontroleerd',

  duplicateKeyHint:
    'Er is ook een andere kandidaat voor dezelfde plaatsing in behandeling — vergelijk voor je beslist.',
};

export const corpusCandidatesPanelMessages = { en, nl };
