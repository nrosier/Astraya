/**
 * Message catalogue for `validateDraft`'s error text (#158).
 *
 * Lives next to `person-form.ts` rather than under `src/ui/`, even though every other
 * catalogue is colocated with a component: this is domain logic, and a domain module
 * importing a UI module's messages would run the dependency the wrong way. `PersonForm.tsx`
 * imports this file just like any other catalogue and passes the resolved `t` in.
 */
const en = {
  nameRequired: 'A name is needed, even a placeholder — it is how you will find this person again.',

  dateRequired: 'A birth date is required.',
  dateFormat: 'Give the date as YYYY-MM-DD.',
  noYearZero: 'There is no year 0. Use 1 BC as -1 if you mean the year before 1 AD.',
  monthRange: 'The month must be between 1 and 12.',
  daysInMonth: (yearMonth: string, days: number) => `${yearMonth} has ${days} days.`,

  timeRequired: 'A birth time is required. Choose “Time unknown” if there is none on record.',
  timeFormat: 'Give the time as HH:MM, on a 24-hour clock.',
  hourRange: 'The hour must be between 0 and 23.',
  minuteRange: 'The minute must be between 0 and 59.',
  secondRange: 'The second must be between 0 and 60.',

  latitudeRequired: 'A latitude is required, in decimal degrees.',
  latitudeRange: 'Latitude runs from -90 (south) to 90 (north).',
  longitudeRequired: 'A longitude is required, in decimal degrees.',
  longitudeRange: 'Longitude runs from -180 (west) to 180 (east).',

  offsetFormat: 'Give the offset in minutes east of UTC, such as -300.',
  offsetRange: 'An offset must be within ±18 hours of UTC.',
};

const nl: typeof en = {
  nameRequired: 'Een naam is nodig, ook een tijdelijke — zo vind je deze persoon later terug.',

  dateRequired: 'Een geboortedatum is vereist.',
  dateFormat: 'Geef de datum op als JJJJ-MM-DD.',
  noYearZero: 'Er is geen jaar 0. Gebruik -1 voor 1 v.Chr. als je het jaar vóór 1 n.Chr. bedoelt.',
  monthRange: 'De maand moet tussen 1 en 12 liggen.',
  daysInMonth: (yearMonth, days) => `${yearMonth} heeft ${days} dagen.`,

  timeRequired: 'Een geboortetijd is vereist. Kies “Tijd onbekend” als er geen tijd bekend is.',
  timeFormat: 'Geef de tijd op als UU:MM, in 24-uursnotatie.',
  hourRange: 'Het uur moet tussen 0 en 23 liggen.',
  minuteRange: 'De minuut moet tussen 0 en 59 liggen.',
  secondRange: 'De seconde moet tussen 0 en 60 liggen.',

  latitudeRequired: 'Een breedtegraad is vereist, in decimale graden.',
  latitudeRange: 'Breedtegraad loopt van -90 (zuid) tot 90 (noord).',
  longitudeRequired: 'Een lengtegraad is vereist, in decimale graden.',
  longitudeRange: 'Lengtegraad loopt van -180 (west) tot 180 (oost).',

  offsetFormat: 'Geef de afwijking op in minuten oost van UTC, zoals -300.',
  offsetRange: 'Een afwijking moet binnen ±18 uur van UTC liggen.',
};

export const personFormValidationMessages = { en, nl };
