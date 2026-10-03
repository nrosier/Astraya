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
import type { PersonTab, PersonTabFamilyKey } from './person-nav.js';
import { personNavMessages } from './PersonNav.messages.js';
import { useMessages } from './messages.js';
import { useExclusiveOpen } from './use-exclusive-open.js';
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
  // Closed on every page change: the route's kind and person identify the page.
  const dropdown = useExclusiveOpen<PersonTabFamilyKey>(`${route.kind}:${personId}`);

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
        onClick={dropdown.close}
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
          const isOpen = dropdown.open === family.key;
          const popupId = `person-subtabs-${family.key}`;
          return (
            <div
              key={family.key}
              ref={dropdown.groupRef(family.key)}
              className={`person-tab-family${isFamilyActive ? ' active' : ''}${isOpen ? ' open' : ''}`}
              onBlur={(event) => {
                dropdown.onGroupBlur(family.key, event);
              }}
            >
              {/* A real button, opened and closed by `useExclusiveOpen` (#417) — a native
                  `<details>` never closes on a selection or an outside click and lets several
                  groups stay open at once. `aria-label` pins the accessible name to just the
                  label text: Chromium folds CSS-generated content such as the caret
                  (`app.css`'s `.person-tab-family-toggle::after`) into a name otherwise. */}
              <button
                type="button"
                ref={dropdown.buttonRef(family.key)}
                className="person-tab-family-toggle"
                aria-label={familyLabel}
                aria-expanded={isOpen}
                aria-controls={isOpen ? popupId : undefined}
                onClick={() => {
                  dropdown.toggle(family.key);
                }}
              >
                {familyLabel}
              </button>
              {isOpen && (
                <nav id={popupId} className="person-subtabs" aria-label={t.subtabsAriaLabel(familyLabel)}>
                  {family.members.map((memberKey) => {
                    const tab = tabsByKey.get(memberKey);
                    if (tab === undefined) throw new Error(`unreachable: "${memberKey}" is always one of PERSON_TABS`);
                    return renderTab(tab, 'person-subtab');
                  })}
                </nav>
              )}
            </div>
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
