/**
 * Sign-in/out UI (#78, #109). Mounted next to `StatusBar` inside `Stored` — same
 * disclosure style, a one-line summary that opens into detail rather than a modal.
 *
 * Signed out: a non-nagging explanation of what an account adds (sync to other
 * devices) plus a form. Signed in: the username and a sign-out button. Between the
 * two, at most once ever per device: the adoption prompt (#109), which `signIn` puts
 * this panel into instead of completing the switch on its own.
 */
import { useState } from 'react';
import { useSession } from './session-context.js';
import type { AuthUser } from '../sync/auth-client.js';

function changes(count: number): string {
  return count === 1 ? '1 change' : `${String(count)} changes`;
}

function AdoptionPanel({
  recordCount,
  resolveAdoption,
}: {
  recordCount: number;
  resolveAdoption: (accept: boolean) => Promise<void>;
}): React.JSX.Element {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const resolve = (accept: boolean): void => {
    setBusy(true);
    setError(undefined);
    void resolveAdoption(accept).catch((cause: unknown) => {
      setError(cause instanceof Error ? cause.message : String(cause));
      setBusy(false);
    });
  };

  return (
    <div className="accountpanel">
      <p>
        This device saved {changes(recordCount)} before you signed in. Add it to your account so it syncs to your other
        devices, or leave it here.
      </p>
      {error !== undefined && (
        <p className="warning" role="alert">
          That did not go through, so nothing has changed. {error}
        </p>
      )}
      <p className="actions">
        <button
          disabled={busy}
          onClick={() => {
            resolve(true);
          }}
        >
          Add it to my account
        </button>
        <button
          className="quiet"
          disabled={busy}
          onClick={() => {
            resolve(false);
          }}
        >
          Leave it on this device
        </button>
      </p>
    </div>
  );
}

function SignInForm({ signIn }: { signIn: (username: string, password: string) => Promise<void> }): React.JSX.Element {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const submit = (event: React.SubmitEvent<HTMLFormElement>): void => {
    event.preventDefault();
    setBusy(true);
    setError(undefined);
    void signIn(username, password)
      .then(() => {
        setPassword('');
      })
      .catch((cause: unknown) => {
        setError(cause instanceof Error ? cause.message : String(cause));
      })
      .finally(() => {
        setBusy(false);
      });
  };

  return (
    <details className="accountpanel">
      <summary>Sign in to sync this device</summary>
      <p>
        An account syncs your data to your other devices. It is optional — everything here already works with no
        account, on this device alone.
      </p>
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
              autoComplete="current-password"
              value={password}
              onChange={(event) => {
                setPassword(event.target.value);
              }}
            />
          </label>
        </div>
        <p className="actions">
          <button type="submit" disabled={busy || username.trim() === '' || password === ''}>
            Sign in
          </button>
        </p>
      </form>
    </details>
  );
}

function SignedIn({ user, signOut }: { user: AuthUser; signOut: () => Promise<void> }): React.JSX.Element {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const doSignOut = (): void => {
    setBusy(true);
    setError(undefined);
    void signOut().catch((cause: unknown) => {
      setError(cause instanceof Error ? cause.message : String(cause));
      setBusy(false);
    });
  };

  return (
    <details className="accountpanel">
      <summary>Signed in as {user.username}</summary>
      {error !== undefined && (
        <p className="warning" role="alert">
          That did not go through, so you are still signed in. {error}
        </p>
      )}
      <p className="actions">
        <button className="quiet" disabled={busy} onClick={doSignOut}>
          Sign out
        </button>
      </p>
    </details>
  );
}

export function AccountPanel(): React.JSX.Element {
  const { user, adoption, signIn, signOut, resolveAdoption } = useSession();

  if (adoption !== undefined) {
    return <AdoptionPanel recordCount={adoption.recordCount} resolveAdoption={resolveAdoption} />;
  }

  return user === undefined ? <SignInForm signIn={signIn} /> : <SignedIn user={user} signOut={signOut} />;
}
