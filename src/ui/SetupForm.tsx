/**
 * The unauthenticated end of the admin-bootstrap link (`server/auth/bootstrap.ts`) —
 * printed to the server log on first boot, before any account exists. Outside `Stored`:
 * nothing here needs the local store beyond what `setup()` (session-context.tsx) already
 * opens itself, and rendering it without one means a mistyped or expired link never has to
 * open IndexedDB first to say so.
 */
import { useState } from 'react';
import { useMessages } from './messages.js';
import { useSession } from './session-context.js';
import { setupToken } from './route.js';
import { setupFormMessages } from './SetupForm.messages.js';
import { sharedMessages } from './shared.messages.js';

export function SetupForm(): React.JSX.Element {
  const { setup } = useSession();
  const [token] = useState(() => setupToken(window.location.hash));
  const [username, setUsername] = useState('');
  const [password, setPasswordInput] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const t = useMessages(setupFormMessages);
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

  const submit = (event: React.SubmitEvent<HTMLFormElement>): void => {
    event.preventDefault();
    if (password !== confirm) {
      setError(shared.passwordMismatch);
      return;
    }
    setBusy(true);
    setError(undefined);
    void setup(token, username, password)
      .then(() => {
        // Not '#/': `parseRoute` strips the trailing slash, leaving a bare '#' that matches
        // no route and falls through to `home`, whose `HomeRedirect` renders nothing for one
        // frame before correcting itself (#263) — a blank flash this skips by landing on the
        // real destination directly.
        window.location.hash = '#/people';
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
            {shared.usernameLabel}
            <input
              type="text"
              autoComplete="username"
              value={username}
              onChange={(event) => {
                setUsername(event.target.value);
              }}
            />
          </label>
          <label>
            {t.passwordLabel}
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
          <button type="submit" disabled={busy || username === '' || password === '' || confirm === ''}>
            {t.submitButton}
          </button>
        </p>
      </form>
    </main>
  );
}
