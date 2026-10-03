/**
 * Pure logic for the admin tab strip (#414): which admin screens exist, where they live and
 * which one a route is on. Kept apart from `AdminNav.tsx` for the same reason `person-nav.ts`
 * is apart from `PersonNav.tsx` — the active-tab mapping is testable without a DOM.
 */
import type { Route } from './route.js';

export type AdminTabKey = 'users' | 'usage' | 'corpus-overrides' | 'corpus-candidates';

export interface AdminTab {
  readonly key: AdminTabKey;
  readonly href: string;
}

/** The admin screens, in menu order. Labels are translated, so they live in `AdminNav.messages.ts` by `key`. */
export const ADMIN_TABS: readonly AdminTab[] = [
  { key: 'users', href: '#/admin' },
  { key: 'usage', href: '#/admin/usage' },
  { key: 'corpus-overrides', href: '#/admin/corpus-overrides' },
  { key: 'corpus-candidates', href: '#/admin/corpus-candidates' },
];

/** Where the person menu's Admin tab leads: the first admin screen, since the admin area has no person of its own. */
export const ADMIN_HOME_HREF = ADMIN_TABS[0]?.href ?? '#/admin';

/** The admin tab a route belongs to, or `null` for any non-admin route. */
export function activeAdminTabKey(route: Route): AdminTabKey | null {
  switch (route.kind) {
    case 'admin':
      return 'users';
    case 'admin-usage':
      return 'usage';
    case 'corpus-overrides':
      return 'corpus-overrides';
    case 'corpus-candidates':
      return 'corpus-candidates';
    default:
      return null;
  }
}
