/**
 * Message catalogue for `SharedChartView.tsx` (#158).
 */
const en = {
  sharedChart: 'Shared chart',
  hint: 'This chart is calculated entirely in your browser from the link itself — nothing was sent to us to open it, and nothing you do here is either.',
  linkCouldNotBeRead: (message: string) => `That link could not be read. ${message}`,
};

const nl: typeof en = {
  sharedChart: 'Gedeelde horoscoop',
  hint: 'Deze horoscoop wordt volledig in je browser berekend vanuit de link zelf — er is niets naar ons verzonden om dit te openen, en dat geldt ook voor wat je hier doet.',
  linkCouldNotBeRead: (message: string) => `Die link kon niet worden gelezen. ${message}`,
};

export const sharedChartViewMessages = { en, nl };
