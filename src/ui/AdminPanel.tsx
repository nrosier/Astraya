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
import type { AdminUser, DeletionImpact } from '../sync/admin-client.js';
import type { OidcConfig } from '../sync/auth-client.js';

function describeImpact(impact: DeletionImpact): string {
  if (impact.kind === 'counted') {
    const people = impact.people === 1 ? '1 person' : `${String(impact.people)} people`;
    const charts = impact.charts === 1 ? '1 chart' : `${String(impact.charts)} charts`;
    return `${people} and ${charts}`;
  }
  const rows = impact.opRows === 1 ? '1 stored change' : `${String(impact.opRows)} stored changes`;
  return `${rows} (sync is not configured on this server, so an exact count of people/charts is not available)`;
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

  if (oidcEnabled) {
    return (
      <p className="hint">
        Local accounts cannot be created while sign-in through Authentik is configured — new accounts are provisioned
        there instead.
      </p>
    );
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
          Username
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
          Admin
        </label>
      </div>
      <p className="actions">
        <button type="submit" disabled={busy || username.trim() === ''}>
          Create user
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
  return (
    <tr>
      <td>
        {user.username}
        {user.disabledAt !== null && ' (disabled)'}
      </td>
      <td>{user.isAdmin ? 'Admin' : 'Member'}</td>
      <td>{user.lastSeenAt === null ? 'never' : new Date(user.lastSeenAt).toLocaleString()}</td>
      <td className="actions">
        <button type="button" className="quiet" disabled={disabled} onClick={toggleEnabled}>
          {user.disabledAt === null ? 'Disable' : 'Enable'}
        </button>
        <button type="button" className="quiet" disabled={disabled} onClick={togglePromoted}>
          {user.isAdmin ? 'Demote' : 'Promote'}
        </button>
        <button type="button" className="quiet" disabled={disabled} onClick={requestReset}>
          Reset password
        </button>
        <button type="button" className="danger" disabled={disabled} onClick={requestDelete}>
          Delete
        </button>
        {passwordLink !== undefined && (
          <p className="hint">
            One-time link, shown once — copy it now: <code>{passwordLink}</code>
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
        <a href="#/">&larr; Back</a>
      </p>
      <h1>Admin</h1>

      {error !== undefined && (
        <p className="warning" role="alert">
          {error}
        </p>
      )}

      {pendingDelete !== undefined && (
        <p className="warning" role="alert">
          Deleting {pendingDelete.user.username} removes {describeImpact(pendingDelete.impact)}. This cannot be undone.{' '}
          <button type="button" className="danger" onClick={confirmDelete}>
            Delete permanently
          </button>{' '}
          <button
            type="button"
            className="quiet"
            onClick={() => {
              setPendingDelete(undefined);
            }}
          >
            Cancel
          </button>
        </p>
      )}

      <h2>Create a user</h2>
      <CreateUserForm oidcEnabled={oidcConfig?.enabled === true} create={create} />
      {passwordLink !== undefined && users?.every((u) => u.id !== passwordLink.userId) === true && (
        <p className="hint">
          One-time link, shown once — copy it now: <code>{passwordLink.url}</code>
        </p>
      )}

      <h2>Users</h2>
      {users === undefined ? (
        <p className="status">Loading users…</p>
      ) : (
        <div className="data-table">
          <div className="data-table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Username</th>
                  <th>Role</th>
                  <th>Last seen</th>
                  <th>Actions</th>
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
