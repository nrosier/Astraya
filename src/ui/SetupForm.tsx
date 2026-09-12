/**
 * The unauthenticated end of the admin-bootstrap link (`server/auth/bootstrap.ts`) —
 * printed to the server log on first boot, before any account exists. Outside `Stored`:
 * nothing here needs the local store beyond what `setup()` (session-context.tsx) already
 * opens itself, and rendering it without one means a mistyped or expired link never has to
 * open IndexedDB first to say so.
 */
import { useState } from 'react';
import { useSession } from './session-context.js';
import { setupToken } from './route.js';

export function SetupForm(): React.JSX.Element {
  const { setup } = useSession();
  const [token] = useState(() => setupToken(window.location.hash));
  const [username, setUsername] = useState('');
  const [password, setPasswordInput] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  if (token === null) {
    return (
      <main className="shell">
        <p className="back">
          <a href="#/">&larr; Back</a>
        </p>
        <h1>Create the admin account</h1>
        <p className="warning" role="alert">
          This link is missing its token, so it cannot be used. Check the server log for the current one — it expires 15
          minutes after the server starts.
        </p>
      </main>
    );
  }

  const submit = (event: React.SubmitEvent<HTMLFormElement>): void => {
    event.preventDefault();
    if (password !== confirm) {
      setError('Those two passwords do not match.');
      return;
    }
    setBusy(true);
    setError(undefined);
    void setup(token, username, password)
      .then(() => {
        window.location.hash = '#/';
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
        <a href="#/">&larr; Back</a>
      </p>
      <h1>Create the admin account</h1>
      {error !== undefined && (
        <p className="warning" role="alert">
          {error}
        </p>
      )}
      <form onSubmit={submit}>
        <div className="field-grid">
          <label>
            Username
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
            Password
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
            Confirm password
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
            Create admin account
          </button>
        </p>
      </form>
    </main>
  );
}
