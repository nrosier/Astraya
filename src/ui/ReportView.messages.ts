/**
 * Message catalogue for `ReportView.tsx` (#158).
 */
const en = {
  advisor: 'Advisor',
  neutral: 'Neutral',
  showProvenance: 'Show provenance (rule and corpus entry) for each paragraph',
  couldNotLoad: (message: string) => `Could not load the interpretation text: ${message}`,
  loadingInterpretation: 'Loading interpretation…',
  tocHeading: 'Contents',
  tocAriaLabel: 'Interpretation sections',
  interpretationTablist: 'Interpretation mode',
  standardTabLabel: 'Standard',
  aiTabLabel: 'AI-Customized',
  tier2Heading: 'AI-customized interpretation',
  tier2SignInPrompt: 'Sign in to generate an AI-customized interpretation in your own style and tone.',
  tier2ConsentLabel:
    'Send the placements above (no name or birth data) to a third-party AI model for this one request.',
  tier2ModeLabel: 'Interpretation mode',
  tier2ModeGrounded: 'Restyle reviewed text — sends only the placements above',
  tier2ModeFreeform: 'AI-written from your full chart — sends your exact positions, houses, and aspects',
  tier2ModeSynthesis:
    'AI-written synthesis — reasons across your whole chart at once, not placement by placement; sends your exact positions, houses, and aspects',
  customPromptLabel: 'Style, tone, and focus instructions',
  customPromptPlaceholder: 'e.g. warm and encouraging, focused on career growth',
  guardrailIssueLength: 'Keep this between 1 and 500 characters.',
  guardrailIssuePromptInjection:
    'This looks like it is trying to redirect the model rather than describe a style — please rephrase.',
  guardrailIssueFatalisticPhrasing: 'Avoid absolute, no-way-out phrasing (e.g. "you will never...").',
  guardrailIssueMedicalLegalFinancialClaim: 'Avoid asking for medical, legal, or financial advice.',
  guardrailIssuePiiShape: 'This looks like it contains a date or coordinate — describe style, tone, and focus only.',
  tier2Generate: 'Generate',
  tier2Generating: 'Generating…',
  tier2GenerateDisabledConsent: 'check the consent box first',
  tier2GenerateDisabledEmpty: 'enter style, tone, and focus instructions first',
  tier2GenerateDisabledGuardrail: 'fix the issues above first',
  tier2Error: (message: string) => `Could not generate: ${message}`,
};

const nl: typeof en = {
  advisor: 'Adviseur',
  neutral: 'Neutraal',
  showProvenance: 'Herkomst (regel en corpustekst) tonen voor elke paragraaf',
  couldNotLoad: (message: string) => `Kon de interpretatietekst niet laden: ${message}`,
  loadingInterpretation: 'Interpretatie wordt geladen…',
  tocHeading: 'Inhoud',
  tocAriaLabel: 'Onderdelen van de interpretatie',
  interpretationTablist: 'Interpretatiemodus',
  standardTabLabel: 'Standaard',
  aiTabLabel: 'AI-gepersonaliseerd',
  tier2Heading: 'AI-gepersonaliseerde interpretatie',
  tier2SignInPrompt: 'Log in om een AI-gepersonaliseerde interpretatie in je eigen stijl en toon te genereren.',
  tier2ConsentLabel:
    'Verstuur de bovenstaande plaatsingen (geen naam of geboortegegevens) naar een AI-model van derden voor dit ene verzoek.',
  tier2ModeLabel: 'Interpretatiemodus',
  tier2ModeGrounded: 'Herschrijf beoordeelde tekst — verstuurt alleen de bovenstaande plaatsingen',
  tier2ModeFreeform:
    'Door AI geschreven vanuit je volledige horoscoop — verstuurt je exacte posities, huizen en aspecten',
  tier2ModeSynthesis:
    'Door AI geschreven synthese — redeneert tegelijk over je volledige horoscoop, niet per plaatsing; verstuurt je exacte posities, huizen en aspecten',
  customPromptLabel: 'Instructies voor stijl, toon en focus',
  customPromptPlaceholder: 'bijv. warm en aanmoedigend, gericht op carrièregroei',
  guardrailIssueLength: 'Houd dit tussen 1 en 500 tekens.',
  guardrailIssuePromptInjection:
    'Dit lijkt te proberen het model om te leiden in plaats van een stijl te beschrijven — formuleer het anders.',
  guardrailIssueFatalisticPhrasing: 'Vermijd absolute, uitzichtloze bewoordingen (bijv. "je zult nooit...").',
  guardrailIssueMedicalLegalFinancialClaim: 'Vraag niet om medisch, juridisch of financieel advies.',
  guardrailIssuePiiShape: 'Dit lijkt een datum of coördinaat te bevatten — beschrijf alleen stijl, toon en focus.',
  tier2Generate: 'Genereren',
  tier2Generating: 'Genereren…',
  tier2GenerateDisabledConsent: 'vink eerst het toestemmingsvakje aan',
  tier2GenerateDisabledEmpty: 'voer eerst stijl-, toon- en focusinstructies in',
  tier2GenerateDisabledGuardrail: 'los eerst de bovenstaande problemen op',
  tier2Error: (message: string) => `Genereren mislukt: ${message}`,
};

export const reportViewMessages = { en, nl };
