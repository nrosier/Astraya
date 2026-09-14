/**
 * Sign-in/out UI (#78, #109). Mounted globally in `topbar-right`, right next to
 * `SyncBadge` (#230) — signed-in or signed-out state is the answer to "am I signed
 * in", and that has to be visible without navigating anywhere.
 *
 * Signed out: a compact "Sign in" button that opens into a non-nagging explanation of
 * what an account adds (sync to other devices) plus a form — collapsed by default so
 * it costs no space on the common, signed-out path. Signed in: a sign-out button, no
 * click needed to confirm you're signed in since `SyncBadge`'s own "(logged in as:
 * {username})" already says so right next to it (#230) — this panel doesn't repeat it.
 * Between the two, at most once ever per device: the adoption prompt (#109), which
 * `signIn` puts this panel into instead of completing the switch on its own.
 */
import { useEffect, useRef, useState } from 'react';
import { useSession } from './session-context.js';
import { getOidcConfig } from '../sync/auth-client.js';
import { accountPanelMessages } from './AccountPanel.messages.js';
import { useMessages } from './messages.js';
import { startOidcHandshake } from './oidc-pkce.js';
import { sharedMessages } from './shared.messages.js';
import type { AuthUser, OidcConfig } from '../sync/auth-client.js';

function changes(count: number, t: typeof accountPanelMessages.en): string {
  return count === 1 ? t.oneChange : t.changesCount(String(count));
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
  const t = useMessages(accountPanelMessages);

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
      <p>{t.adoptionPrompt(changes(recordCount, t))}</p>
      {error !== undefined && (
        <p className="warning" role="alert">
          {t.adoptionFailed(error)}
        </p>
      )}
      <p className="actions">
        <button
          disabled={busy}
          onClick={() => {
            resolve(true);
          }}
        >
          {t.addToAccountButton}
        </button>
        <button
          className="quiet"
          disabled={busy}
          onClick={() => {
            resolve(false);
          }}
        >
          {t.leaveOnDeviceButton}
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
  const t = useMessages(accountPanelMessages);

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
        {t.signInWithOidcButton}
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
  const t = useMessages(accountPanelMessages);
  const shared = useMessages(sharedMessages);

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
        {t.signInButton}
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
        <span id={SIGNIN_POPOVER_HEADING_ID}>{t.signInPopoverHeading}</span>
        <button type="button" className="quiet" aria-label={t.closeLabel} onClick={close}>
          ×
        </button>
      </p>
      <p>{t.signInExplainer}</p>
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
            {t.passwordLabel}
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
            {t.signInButton}
          </button>
        </p>
      </form>
      {oidcConfig?.enabled === true && <OidcSignIn config={oidcConfig} />}
    </div>
  );
}

/**
 * No "signed in as" text here — `SyncBadge`'s "(logged in as: {username})" already
 * says that, right next to this in `topbar-right` (#230).
 */
function SignedIn({ user, signOut }: { user: AuthUser; signOut: () => Promise<void> }): React.JSX.Element {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const t = useMessages(accountPanelMessages);

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
      <button className="quiet" disabled={busy} onClick={doSignOut}>
        {t.signOutButton}
      </button>
      {user.isAdmin && <a href="#/admin">{t.manageUsersLink}</a>}
      {error !== undefined && (
        <p className="warning" role="alert">
          {t.signOutFailed(error)}
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

  // Positioned so the popover/warning below — absolutely positioned, `left`/`right: 0`
  // — anchors to this trigger's own box rather than to `.topbar-right`'s (#230: this now
  // shares that fixed corner with `SyncBadge` and the toggles, so anchoring to the
  // shared container would misplace the popover under whichever control sits first).
  return (
    <div className="accountpanel">
      {adoption !== undefined ? (
        <AdoptionPanel recordCount={adoption.recordCount} resolveAdoption={resolveAdoption} />
      ) : user === undefined ? (
        <SignInForm signIn={signIn} oidcConfig={oidcConfig} />
      ) : (
        <SignedIn user={user} signOut={signOut} />
      )}
    </div>
  );
}
