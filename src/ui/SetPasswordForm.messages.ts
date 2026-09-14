/**
 * Message catalogue for `SetPasswordForm.tsx` (#158).
 */
const en = {
  heading: 'Set your password',
  missingToken: 'This link is missing its token, so it cannot be used. Ask whoever sent it for a fresh one.',

  passwordSetHeading: 'Password set',
  passwordSetBody: 'Your password is set. You can sign in now from the home screen.',
  goToSignIn: 'Go to sign-in',

  newPasswordLabel: 'New password',
  submitButton: 'Set password',
};

const nl: typeof en = {
  heading: 'Stel je wachtwoord in',
  missingToken:
    'Deze link mist zijn token en kan daarom niet worden gebruikt. Vraag degene die hem stuurde om een nieuwe.',

  passwordSetHeading: 'Wachtwoord ingesteld',
  passwordSetBody: 'Je wachtwoord is ingesteld. Je kunt nu inloggen vanaf het startscherm.',
  goToSignIn: 'Ga naar inloggen',

  newPasswordLabel: 'Nieuw wachtwoord',
  submitButton: 'Wachtwoord instellen',
};

export const setPasswordFormMessages = { en, nl };
