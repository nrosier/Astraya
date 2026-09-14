/**
 * Admin user management (#135): list, create, reset-password, disable/enable,
 * promote/demote, and delete — each backed by the matching route in
 * `server/auth/admin-routes.ts` through `sync/admin-client.ts`. Outside `Stored`:
 * this screen manages *other* users' accounts, not this device's local data, so it
 * needs the session but not the store.
 *
 * A create-user account and a password reset both mint the same kind of one-time
 * link, shown here exactly once — the same "shown once in the response" pattern the
 * bootstrap token already establishes over a log line, here over HTTP since the
 * admin is already signed in.
 */
import { useEffect, useState } from 'react';
import {
  createUser,
  demoteUser,
  disableUser,
  enableUser,
  getDeletionImpact,
  listUsers,
  promoteUser,
  resetPassword,
  deleteUser,
} from '../sync/admin-client.js';
import { getOidcConfig } from '../sync/auth-client.js';
import { adminPanelMessages } from './AdminPanel.messages.js';
import { useMessages } from './messages.js';
import { sharedMessages } from './shared.messages.js';
import type { AdminUser, DeletionImpact } from '../sync/admin-client.js';
import type { OidcConfig } from '../sync/auth-client.js';

function describeImpact(impact: DeletionImpact, t: typeof adminPanelMessages.en): string {
  if (impact.kind === 'counted') {
    const people = impact.people === 1 ? t.onePerson : t.peopleCount(String(impact.people));
    const charts = impact.charts === 1 ? t.oneChart : t.chartsCount(String(impact.charts));
    return t.peopleAndCharts(people, charts);
  }
  const rows = impact.opRows === 1 ? t.oneStoredChange : t.storedChangesCount(String(impact.opRows));
  return t.unconfiguredSyncSuffix(rows);
}

interface PendingDelete {
  readonly user: AdminUser;
  readonly impact: DeletionImpact;
}

function CreateUserForm({
  oidcEnabled,
  create,
}: {
  oidcEnabled: boolean;
  create: (username: string, isAdmin: boolean) => Promise<void>;
}): React.JSX.Element {
  const [username, setUsername] = useState('');
  const [isAdmin, setIsAdmin] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const t = useMessages(adminPanelMessages);
  const shared = useMessages(sharedMessages);

  if (oidcEnabled) {
    return <p className="hint">{t.oidcHint}</p>;
  }

  const submit = (event: React.SubmitEvent<HTMLFormElement>): void => {
    event.preventDefault();
    setBusy(true);
    setError(undefined);
    void create(username, isAdmin)
      .then(() => {
        setUsername('');
        setIsAdmin(false);
      })
      .catch((cause: unknown) => {
        setError(cause instanceof Error ? cause.message : String(cause));
      })
      .finally(() => {
        setBusy(false);
      });
  };

  return (
    <form onSubmit={submit}>
      {error !== undefined && (
        <p className="warning" role="alert">
          {error}
        </p>
      )}
      <div className="field-grid">
        <label>
          {shared.usernameLabel}
          <input
            type="text"
            autoComplete="off"
            value={username}
            onChange={(event) => {
              setUsername(event.target.value);
            }}
          />
        </label>
        <label>
          <input
            type="checkbox"
            checked={isAdmin}
            onChange={(event) => {
              setIsAdmin(event.target.checked);
            }}
          />
          {t.adminCheckboxLabel}
        </label>
      </div>
      <p className="actions">
        <button type="submit" disabled={busy || username.trim() === ''}>
          {t.createUserButton}
        </button>
      </p>
    </form>
  );
}

function UserRow({
  user,
  passwordLink,
  disabled,
  toggleEnabled,
  togglePromoted,
  requestReset,
  requestDelete,
}: {
  user: AdminUser;
  passwordLink: string | undefined;
  disabled: boolean;
  toggleEnabled: () => void;
  togglePromoted: () => void;
  requestReset: () => void;
  requestDelete: () => void;
}): React.JSX.Element {
  const t = useMessages(adminPanelMessages);
  return (
    <tr>
      <td>
        {user.username}
        {user.disabledAt !== null && t.disabledSuffix}
      </td>
      <td>{user.isAdmin ? t.adminRoleLabel : t.memberRoleLabel}</td>
      <td>{user.lastSeenAt === null ? t.neverSeen : new Date(user.lastSeenAt).toLocaleString()}</td>
      <td className="actions">
        <button type="button" className="quiet" disabled={disabled} onClick={toggleEnabled}>
          {user.disabledAt === null ? t.disableButton : t.enableButton}
        </button>
        <button type="button" className="quiet" disabled={disabled} onClick={togglePromoted}>
          {user.isAdmin ? t.demoteButton : t.promoteButton}
        </button>
        <button type="button" className="quiet" disabled={disabled} onClick={requestReset}>
          {t.resetPasswordButton}
        </button>
        <button type="button" className="danger" disabled={disabled} onClick={requestDelete}>
          {t.deleteButton}
        </button>
        {passwordLink !== undefined && (
          <p className="hint">
            {t.copyLinkNow} <code>{passwordLink}</code>
          </p>
        )}
      </td>
    </tr>
  );
}

export function AdminPanel(): React.JSX.Element {
  const [users, setUsers] = useState<readonly AdminUser[]>();
  const [oidcConfig, setOidcConfig] = useState<OidcConfig>();
  const [error, setError] = useState<string>();
  const [busyUserId, setBusyUserId] = useState<string>();
  const [passwordLink, setPasswordLink] = useState<{ userId: string; url: string }>();
  const [pendingDelete, setPendingDelete] = useState<PendingDelete>();
  const t = useMessages(adminPanelMessages);
  const shared = useMessages(sharedMessages);

  const refresh = (): Promise<void> =>
    listUsers().then((loaded) => {
      setUsers(loaded);
    });

  useEffect(() => {
    void refresh().catch((cause: unknown) => {
      setError(cause instanceof Error ? cause.message : String(cause));
    });
    void getOidcConfig()
      .then(setOidcConfig)
      .catch(() => undefined);
  }, []);

  const run = (userId: string | undefined, action: () => Promise<void>): void => {
    setBusyUserId(userId);
    setError(undefined);
    setPasswordLink(undefined);
    void action()
      .then(() => refresh())
      .catch((cause: unknown) => {
        setError(cause instanceof Error ? cause.message : String(cause));
      })
      .finally(() => {
        setBusyUserId(undefined);
      });
  };

  const create = (username: string, isAdmin: boolean): Promise<void> =>
    createUser(username, isAdmin).then(({ setPasswordUrl }) => {
      setPasswordLink({ userId: username, url: setPasswordUrl });
      return refresh();
    });

  const requestReset = (user: AdminUser): void => {
    run(user.id, () =>
      resetPassword(user.id).then(({ setPasswordUrl }) => {
        setPasswordLink({ userId: user.id, url: setPasswordUrl });
      }),
    );
  };

  const toggleEnabled = (user: AdminUser): void => {
    run(user.id, () => (user.disabledAt === null ? disableUser(user.id) : enableUser(user.id)).then(() => undefined));
  };

  const togglePromoted = (user: AdminUser): void => {
    run(user.id, () => (user.isAdmin ? demoteUser(user.id) : promoteUser(user.id)).then(() => undefined));
  };

  const requestDelete = (user: AdminUser): void => {
    setError(undefined);
    setBusyUserId(user.id);
    void getDeletionImpact(user.id)
      .then((impact) => {
        setPendingDelete({ user, impact });
      })
      .catch((cause: unknown) => {
        setError(cause instanceof Error ? cause.message : String(cause));
      })
      .finally(() => {
        setBusyUserId(undefined);
      });
  };

  const confirmDelete = (): void => {
    const target = pendingDelete;
    if (!target) return;
    setPendingDelete(undefined);
    run(target.user.id, () => deleteUser(target.user.id));
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

      {pendingDelete !== undefined && (
        <p className="warning" role="alert">
          {t.deleteWarning(pendingDelete.user.username, describeImpact(pendingDelete.impact, t))}{' '}
          <button type="button" className="danger" onClick={confirmDelete}>
            {t.deletePermanentlyButton}
          </button>{' '}
          <button
            type="button"
            className="quiet"
            onClick={() => {
              setPendingDelete(undefined);
            }}
          >
            {t.cancelButton}
          </button>
        </p>
      )}

      <h2>{t.createUserHeading}</h2>
      <CreateUserForm oidcEnabled={oidcConfig?.enabled === true} create={create} />
      {passwordLink !== undefined && users?.every((u) => u.id !== passwordLink.userId) === true && (
        <p className="hint">
          {t.copyLinkNow} <code>{passwordLink.url}</code>
        </p>
      )}

      <h2>{t.usersHeading}</h2>
      {users === undefined ? (
        <p className="status">{t.loadingUsers}</p>
      ) : (
        <div className="data-table">
          <div className="data-table-scroll">
            <table>
              <thead>
                <tr>
                  <th>{shared.usernameLabel}</th>
                  <th>{t.roleColumn}</th>
                  <th>{t.lastSeenColumn}</th>
                  <th>{t.actionsColumn}</th>
                </tr>
              </thead>
              <tbody>
                {users.map((user) => (
                  <UserRow
                    key={user.id}
                    user={user}
                    disabled={busyUserId === user.id}
                    passwordLink={passwordLink?.userId === user.id ? passwordLink.url : undefined}
                    toggleEnabled={() => {
                      toggleEnabled(user);
                    }}
                    togglePromoted={() => {
                      togglePromoted(user);
                    }}
                    requestReset={() => {
                      requestReset(user);
                    }}
                    requestDelete={() => {
                      requestDelete(user);
                    }}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </main>
  );
}
