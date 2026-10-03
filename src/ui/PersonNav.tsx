/**
 * Persistent per-person tab bar (#234), rendered once above the chart-type view by `App.tsx`.
 *
 * Marked up as plain navigation links styled as tabs, not `role="tablist"`: these are links to
 * different routes, not same-page panels, so the WAI-ARIA tab pattern (roving tabindex, arrow-key
 * navigation) doesn't fit — and every existing e2e `getByRole('link', ...)` locator for these
 * labels keeps working unchanged.
 *
 * Its own `.person-tabs`/`.person-tab` classes, not the `.tabs`/`.tab` that `ChartView`'s
 * internal data tabs already use: this bar is contained to the page's content width and styled
 * to look like a real browser tab strip (connected to the content below it), which would be the
 * wrong look for those already-shipped in-page tabs if the classes were shared.
 */
import { ADMIN_HOME_HREF } from './admin-nav.js';
import { useSessionUserOrUndefined } from './session-context.js';
import { activeTabKey, isTabEnabled, PERSON_TAB_FAMILIES, PERSON_TABS } from './person-nav.js';
import type { PersonTab } from './person-nav.js';
import { personNavMessages } from './PersonNav.messages.js';
import { useMessages } from './messages.js';
import { useStoreState } from './store-context.js';
import type { Route } from './route.js';

const UNGROUPED_KEYS = new Set(['birth-record', 'chart', 'report', 'astrocartography']);

export function PersonNav({ personId, route }: { personId: string; route: Route }): React.JSX.Element {
  const state = useStoreState();
  const sessionUser = useSessionUserOrUndefined();
  const t = useMessages(personNavMessages);
  const person = state.people.get(personId);
  const hasBirthMoment = person?.moment !== undefined;
  const active = activeTabKey(route);
  const anyDisabled = PERSON_TABS.some((tab) => !isTabEnabled(tab.key, hasBirthMoment));
  const tabsByKey = new Map(PERSON_TABS.map((tab) => [tab.key, tab]));

  function renderTab(tab: PersonTab, className = 'person-tab'): React.JSX.Element {
    const label = t.tabLabels[tab.key];
    const enabled = isTabEnabled(tab.key, hasBirthMoment);
    if (!enabled) {
      return (
        <button
          key={tab.key}
          type="button"
          disabled
          className={`${className} disabled`}
          aria-label={t.disabledTabSuffix(label)}
        >
          {label}
        </button>
      );
    }
    const isActive = tab.key === active;
    return (
      <a
        key={tab.key}
        href={tab.buildHref(personId)}
        className={isActive ? `${className} active` : className}
        aria-current={isActive ? 'page' : undefined}
      >
        {label}
      </a>
    );
  }

  return (
    <div className="person-nav">
      <nav className="person-tabs" aria-label={t.chartTypesAriaLabel}>
        {PERSON_TABS.filter((tab) => UNGROUPED_KEYS.has(tab.key)).map((tab) => renderTab(tab))}
        {PERSON_TAB_FAMILIES.map((family) => {
          const familyLabel = t.familyLabels[family.key];
          const isFamilyActive = active !== null && family.members.includes(active);
          return (
            <details key={family.key} className="person-tab-family" open={isFamilyActive}>
              {/* Chromium's accessibility tree exposes a bare `<summary>` as role "generic", not
                  "button" (confirmed via manual a11y-tree inspection) — `role="button"` makes it
                  match `getByRole('button', ...)` for e2e tests and assistive tech alike, without
                  changing its native disclosure behavior. `aria-label` pins the accessible name to
                  just the label text — otherwise it would also pick up `::after`'s CSS-generated
                  disclosure caret (`app.css`'s `.person-tab-family > summary::after`), which is
                  purely visual. */}
              <summary role="button" aria-label={familyLabel}>
                {familyLabel}
              </summary>
              <nav className="person-subtabs" aria-label={t.subtabsAriaLabel(familyLabel)}>
                {family.members.map((memberKey) => {
                  const tab = tabsByKey.get(memberKey);
                  if (tab === undefined) throw new Error(`unreachable: "${memberKey}" is always one of PERSON_TABS`);
                  return renderTab(tab, 'person-subtab');
                })}
              </nav>
            </details>
          );
        })}
        {/* Admin area (#414): last in the strip and only for an admin. Purely navigation — each
            admin route is guarded by `requireAdmin` on the server whatever this shows. */}
        {sessionUser?.isAdmin === true && (
          <a href={ADMIN_HOME_HREF} className="person-tab person-tab-admin">
            {t.adminTabLabel}
          </a>
        )}
      </nav>
      {anyDisabled && <p className="hint">{t.completeBirthRecordHint}</p>}
    </div>
  );
}
