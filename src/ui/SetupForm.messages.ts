/**
 * Message catalogue for `SetupForm.tsx` (#158).
 */
const en = {
  heading: 'Create the admin account',
  missingToken:
    'This link is missing its token, so it cannot be used. Check the server log for the current one — it expires 15 minutes after the server starts.',

  passwordLabel: 'Password',
  submitButton: 'Create admin account',
};

const nl: typeof en = {
  heading: 'Maak het beheerdersaccount aan',
  missingToken:
    'Deze link mist zijn token en kan daarom niet worden gebruikt. Bekijk het serverlog voor de huidige — die verloopt 15 minuten na het starten van de server.',

  passwordLabel: 'Wachtwoord',
  submitButton: 'Beheerdersaccount aanmaken',
};

export const setupFormMessages = { en, nl };
