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
import { activeTabKey, isTabEnabled, PERSON_TABS } from './person-nav.js';
import { personNavMessages } from './PersonNav.messages.js';
import { useMessages } from './messages.js';
import { useStoreState } from './store-context.js';
import type { Route } from './route.js';

export function PersonNav({ personId, route }: { personId: string; route: Route }): React.JSX.Element {
  const state = useStoreState();
  const t = useMessages(personNavMessages);
  const person = state.people.get(personId);
  const hasBirthMoment = person?.moment !== undefined;
  const active = activeTabKey(route, window.location.hash);
  const anyDisabled = PERSON_TABS.some((tab) => !isTabEnabled(tab.key, hasBirthMoment));

  return (
    <div className="person-nav">
      <nav className="person-tabs" aria-label={t.chartTypesAriaLabel}>
        {PERSON_TABS.map((tab) => {
          const label = t.tabLabels[tab.key];
          const enabled = isTabEnabled(tab.key, hasBirthMoment);
          if (!enabled) {
            return (
              <button
                key={tab.key}
                type="button"
                disabled
                className="person-tab disabled"
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
              className={isActive ? 'person-tab active' : 'person-tab'}
              aria-current={isActive ? 'page' : undefined}
            >
              {label}
            </a>
          );
        })}
      </nav>
      {anyDisabled && <p className="hint">{t.completeBirthRecordHint}</p>}
    </div>
  );
}
