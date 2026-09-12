/**
 * Sign-in/out UI (#78, #109). Mounted globally, top-left of every screen — signed-in
 * or signed-out state is the answer to "am I signed in", and that has to be visible
 * without navigating anywhere.
 *
 * Signed out: a compact "Sign in" button that opens into a non-nagging explanation of
 * what an account adds (sync to other devices) plus a form — collapsed by default so
 * it costs no space on the common, signed-out path. Signed in: the username shown
 * inline, always, plus a sign-out button — no click needed to confirm you're signed
 * in. Between the two, at most once ever per device: the adoption prompt (#109), which
 * `signIn` puts this panel into instead of completing the switch on its own.
 */
import { useEffect, useRef, useState } from 'react';
import { useSession } from './session-context.js';
import { getOidcConfig } from '../sync/auth-client.js';
import { startOidcHandshake } from './oidc-pkce.js';
import type { AuthUser, OidcConfig } from '../sync/auth-client.js';

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
    <div className="accountpanel-popover">
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

/**
 * A real top-level navigation to Authentik's `authorization_endpoint`, submitted as a
 * plain GET form rather than `window.location.href = ...` — hidden inputs keep the PKCE
 * challenge and other params out of a manually-constructed URL string. `main.tsx` never
 * needs to know this happened: the callback is consumed and exchanged entirely inside
 * `session-context.tsx`'s boot effect on the next load.
 *
 * `authorizationEndpoint` comes from the server's `/api/auth/oidc/config`, not from a
 * browser-side fetch of the issuer's own discovery document: that fetch would depend on
 * the issuer sending CORS headers on `/.well-known/openid-configuration`, which Authentik
 * does not do by default, and fails with an opaque cross-origin error when it doesn't.
 */
function OidcSignIn({ config }: { config: { clientId: string; authorizationEndpoint: string } }): React.JSX.Element {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const start = (): void => {
    setBusy(true);
    setError(undefined);
    void (async () => {
      const { state, nonce, codeChallenge, redirectUri } = await startOidcHandshake();

      const form = document.createElement('form');
      form.method = 'GET';
      form.action = config.authorizationEndpoint;
      const fields: Record<string, string> = {
        client_id: config.clientId,
        redirect_uri: redirectUri,
        response_type: 'code',
        // `openid` alone gets only `sub` — Authentik only includes `preferred_username`
        // (and `name`/`email`) in the id_token when the `profile` scope is actually
        // requested, so without it every account is provisioned under its raw subject
        // hash instead of a real username.
        scope: 'openid profile',
        code_challenge: codeChallenge,
        code_challenge_method: 'S256',
        state,
        nonce,
      };
      for (const [name, value] of Object.entries(fields)) {
        const input = document.createElement('input');
        input.type = 'hidden';
        input.name = name;
        input.value = value;
        form.append(input);
      }
      document.body.append(form);
      form.submit();
    })().catch((cause: unknown) => {
      setError(cause instanceof Error ? cause.message : String(cause));
      setBusy(false);
    });
  };

  return (
    <p className="actions">
      <button type="button" disabled={busy} onClick={start}>
        Sign in with Authentik
      </button>
      {error !== undefined && (
        <span className="warning" role="alert">
          {' '}
          {error}
        </span>
      )}
    </p>
  );
}

/**
 * Collapsed to a compact "Sign in" button by default — this now lives in the fixed
 * top-left corner of every screen, so an always-open form would sit over the page on
 * every route rather than just where it's relevant. Opening it reveals the same form as
 * a small popover beneath the button; closing it (the × or a successful sign-in) hides
 * the form again without losing anything typed elsewhere on the page.
 */
const SIGNIN_POPOVER_ID = 'accountpanel-signin-popover';
const SIGNIN_POPOVER_HEADING_ID = 'accountpanel-signin-popover-heading';

function SignInForm({
  signIn,
  oidcConfig,
}: {
  signIn: (username: string, password: string) => Promise<void>;
  oidcConfig: OidcConfig | undefined;
}): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  // Survives the disclosure swapping the trigger button out of the DOM when open,
  // so closing (Escape, the ×, or a successful sign-in) can return focus to it (#69)
  // instead of dropping it back to the document body.
  const triggerRef = useRef<HTMLButtonElement>(null);
  const usernameRef = useRef<HTMLInputElement>(null);

  const close = (): void => {
    setOpen(false);
    triggerRef.current?.focus();
  };

  useEffect(() => {
    if (open) usernameRef.current?.focus();
  }, [open]);

  useEffect(() => {
    // Otherwise this floats open over whatever screen the user navigates to next —
    // both a stray dialog left open for no reason, and (since it's positioned
    // absolutely) something that can sit on top of and intercept clicks on the new
    // page's content.
    if (!open) return;
    const onHashChange = (): void => {
      close();
    };
    window.addEventListener('hashchange', onHashChange);
    return () => {
      window.removeEventListener('hashchange', onHashChange);
    };
  }, [open]);

  const submit = (event: React.SubmitEvent<HTMLFormElement>): void => {
    event.preventDefault();
    setBusy(true);
    setError(undefined);
    void signIn(username, password)
      .then(() => {
        setPassword('');
        close();
      })
      .catch((cause: unknown) => {
        setError(cause instanceof Error ? cause.message : String(cause));
      })
      .finally(() => {
        setBusy(false);
      });
  };

  if (!open) {
    return (
      <button
        ref={triggerRef}
        type="button"
        className="topbar-signin"
        aria-expanded={false}
        aria-controls={SIGNIN_POPOVER_ID}
        onClick={() => {
          setOpen(true);
        }}
      >
        Sign in
      </button>
    );
  }

  return (
    <div
      id={SIGNIN_POPOVER_ID}
      className="accountpanel-popover"
      role="dialog"
      aria-labelledby={SIGNIN_POPOVER_HEADING_ID}
      onKeyDown={(event) => {
        if (event.key === 'Escape') close();
      }}
    >
      <p className="accountpanel-popover-head">
        <span id={SIGNIN_POPOVER_HEADING_ID}>Sign in to sync this device</span>
        <button type="button" className="quiet" aria-label="Close" onClick={close}>
          ×
        </button>
      </p>
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
              ref={usernameRef}
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
      {oidcConfig?.enabled === true && <OidcSignIn config={oidcConfig} />}
    </div>
  );
}

/** Always visible, no click needed — the answer to "am I signed in" shows up on its own. */
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
    <div className="accountpanel-signedin">
      <span>
        Signed in as <strong>{user.username}</strong>
      </span>
      <button className="quiet" disabled={busy} onClick={doSignOut}>
        Sign out
      </button>
      {user.isAdmin && <a href="#/admin">Manage users</a>}
      {error !== undefined && (
        <p className="warning" role="alert">
          That did not go through, so you are still signed in. {error}
        </p>
      )}
    </div>
  );
}

export function AccountPanel(): React.JSX.Element {
  const { user, adoption, signIn, signOut, resolveAdoption } = useSession();
  const [oidcConfig, setOidcConfig] = useState<OidcConfig>();

  useEffect(() => {
    // Best-effort: the password form above works regardless, so a failed fetch here
    // just means no "Sign in with Authentik" button rather than a broken panel.
    void getOidcConfig()
      .then(setOidcConfig)
      .catch(() => undefined);
  }, []);

  if (adoption !== undefined) {
    return <AdoptionPanel recordCount={adoption.recordCount} resolveAdoption={resolveAdoption} />;
  }

  return user === undefined ? (
    <SignInForm signIn={signIn} oidcConfig={oidcConfig} />
  ) : (
    <SignedIn user={user} signOut={signOut} />
  );
}
