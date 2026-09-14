/**
 * Message catalogue for `ReportView.tsx` (#158).
 */
const en = {
  advisor: 'Advisor',
  neutral: 'Neutral',
  showProvenance: 'Show provenance (rule and corpus entry) for each paragraph',
  couldNotLoad: (message: string) => `Could not load the interpretation text: ${message}`,
  loadingReport: 'Loading report…',
};

const nl: typeof en = {
  advisor: 'Adviseur',
  neutral: 'Neutraal',
  showProvenance: 'Herkomst (regel en corpustekst) tonen voor elke paragraaf',
  couldNotLoad: (message: string) => `Kon de interpretatietekst niet laden: ${message}`,
  loadingReport: 'Rapport wordt geladen…',
};

export const reportViewMessages = { en, nl };
