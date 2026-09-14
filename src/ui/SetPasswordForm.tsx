/**
 * The unauthenticated end of an admin-issued one-time link (#135) — a brand new account's
 * first password, or a reset. Outside `Stored`: nothing here needs the local store, and
 * rendering it without one means a mistyped or expired link never has to open IndexedDB
 * first to say so.
 */
import { useState } from 'react';
import { setPassword } from '../sync/auth-client.js';
import { useMessages } from './messages.js';
import { setPasswordToken } from './route.js';
import { setPasswordFormMessages } from './SetPasswordForm.messages.js';
import { sharedMessages } from './shared.messages.js';

export function SetPasswordForm(): React.JSX.Element {
  const [token] = useState(() => setPasswordToken(window.location.hash));
  const [password, setPasswordInput] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [done, setDone] = useState(false);
  const t = useMessages(setPasswordFormMessages);
  const shared = useMessages(sharedMessages);

  if (token === null) {
    return (
      <main className="shell">
        <p className="back">
          <a href="#/">&larr; {shared.back}</a>
        </p>
        <h1>{t.heading}</h1>
        <p className="warning" role="alert">
          {t.missingToken}
        </p>
      </main>
    );
  }

  if (done) {
    return (
      <main className="shell">
        <h1>{t.passwordSetHeading}</h1>
        <p>{t.passwordSetBody}</p>
        <p>
          <a href="#/">{t.goToSignIn}</a>
        </p>
      </main>
    );
  }

  const submit = (event: React.SubmitEvent<HTMLFormElement>): void => {
    event.preventDefault();
    if (password !== confirm) {
      setError(shared.passwordMismatch);
      return;
    }
    setBusy(true);
    setError(undefined);
    void setPassword(token, password)
      .then(() => {
        setDone(true);
      })
      .catch((cause: unknown) => {
        setError(cause instanceof Error ? cause.message : String(cause));
      })
      .finally(() => {
        setBusy(false);
      });
  };

  return (
    <main className="shell">
      <p className="back">
        <a href="#/">&larr; {shared.back}</a>
      </p>
      <h1>{t.heading}</h1>
      {error !== undefined && (
        <p className="warning" role="alert">
          {error}
        </p>
      )}
      <form onSubmit={submit}>
        <div className="field-grid">
          <label>
            {t.newPasswordLabel}
            <input
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(event) => {
                setPasswordInput(event.target.value);
              }}
            />
          </label>
          <label>
            {shared.confirmPasswordLabel}
            <input
              type="password"
              autoComplete="new-password"
              value={confirm}
              onChange={(event) => {
                setConfirm(event.target.value);
              }}
            />
          </label>
        </div>
        <p className="actions">
          <button type="submit" disabled={busy || password === '' || confirm === ''}>
            {t.submitButton}
          </button>
        </p>
      </form>
    </main>
  );
}
