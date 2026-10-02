/**
 * Message catalogue for `DraconicView.tsx` (#398).
 */
const en = {
  personFallback: 'Person',
  thisPerson: 'This person',
  draconicChartFallback: 'Draconic chart',
  needsCompleteRecord: (name: string) =>
    `A draconic chart measures every body from the natal North Node, so it needs a complete birth record with a known time to compute that node position from. ${name}’s does not have one yet. Fill in or correct it on the`,
  personPageLink: 'person page',

  heading: (name: string) => `${name}’s draconic chart`,
  headingFallback: 'Draconic chart',
  hint: 'Every longitude re-measured from the natal North Node rather than from zero Aries, with the natal houses and Ascendant unchanged — only body positions move onto the draconic zodiac.',
  housesUndefined:
    'The underlying natal chart’s houses have no valid solution — this person’s birth place falls at a latitude the chosen house system can’t resolve. Try a different house system in Extended settings on their chart page, or a location further from the poles.',
};

const nl: typeof en = {
  personFallback: 'Persoon',
  thisPerson: 'Deze persoon',
  draconicChartFallback: 'Draconische horoscoop',
  needsCompleteRecord: (name: string) =>
    `Een draconische horoscoop meet elk hemellichaam vanaf de natale Noordelijke Maansknoop, dus is een volledig geboorterecord met een bekende tijd vereist om die knooppositie uit te berekenen. Dat van ${name} is nog niet compleet. Vul het aan of corrigeer het op de`,
  personPageLink: 'persoonspagina',

  heading: (name: string) => `Draconische horoscoop van ${name}`,
  headingFallback: 'Draconische horoscoop',
  hint: 'Elke lengtegraad opnieuw gemeten vanaf de natale Noordelijke Maansknoop in plaats van vanaf nul graden Ram, met de natale huizen en Ascendant ongewijzigd — alleen de posities van de hemellichamen verschuiven naar de draconische dierenriem.',
  housesUndefined:
    'De huizen van de onderliggende natale horoscoop hebben geen geldige oplossing — de geboorteplaats van deze persoon valt op een breedtegraad die het gekozen huizensysteem niet kan oplossen. Probeer een ander huizensysteem bij Uitgebreide instellingen op de horoscooppagina, of een locatie verder van de polen.',
};

export const draconicViewMessages = { en, nl };
