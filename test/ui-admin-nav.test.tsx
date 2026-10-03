// @vitest-environment jsdom
/**
 * The admin tab strip (#414): which screens it lists, which one a route marks active, and that
 * it renders as a labelled navigation of plain links in both locales.
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { activeAdminTabKey, ADMIN_HOME_HREF, ADMIN_TABS } from '../src/ui/admin-nav.js';
import { AdminNav } from '../src/ui/AdminNav.js';
import { adminNavMessages } from '../src/ui/AdminNav.messages.js';
import { setLocale } from '../src/ui/locale.js';
import { parseRoute, type Route } from '../src/ui/route.js';

describe('admin tab logic', () => {
  it('lists the four admin screens in menu order, each at its own route', () => {
    expect(ADMIN_TABS.map((tab) => tab.key)).toEqual(['users', 'usage', 'corpus-overrides', 'corpus-candidates']);
    for (const tab of ADMIN_TABS) {
      expect(activeAdminTabKey(parseRoute(tab.href))).toBe(tab.key);
    }
  });

  it('sends the person menu’s Admin tab to the first admin screen', () => {
    expect(ADMIN_HOME_HREF).toBe('#/admin');
  });

  it('is null for every non-admin route', () => {
    const routes: Route[] = [{ kind: 'people' }, { kind: 'about' }, { kind: 'shared' }, { kind: 'setup' }];
    for (const route of routes) expect(activeAdminTabKey(route)).toBeNull();
  });
});

describe('AdminNav', () => {
  let mounted: { container: HTMLElement; root: Root } | undefined;

  afterEach(() => {
    if (mounted !== undefined) {
      act(() => {
        mounted?.root.unmount();
      });
      mounted.container.remove();
      mounted = undefined;
    }
    setLocale('en');
  });

  async function mount(route: Route, locale: 'en' | 'nl' = 'en'): Promise<HTMLElement> {
    setLocale(locale);
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(<AdminNav route={route} />);
      await Promise.resolve();
    });
    mounted = { container, root };
    return container;
  }

  it('renders one link per admin screen inside a labelled nav', async () => {
    const container = await mount({ kind: 'admin' });
    const nav = container.querySelector('nav');
    expect(nav?.getAttribute('aria-label')).toBe(adminNavMessages.en.adminSectionsAriaLabel);
    const links = [...container.querySelectorAll('a')];
    expect(links.map((link) => link.textContent)).toEqual([
      'Users',
      'AI usage',
      'Corpus overrides',
      'Corpus candidates',
    ]);
    expect(links.map((link) => link.getAttribute('href'))).toEqual(ADMIN_TABS.map((tab) => tab.href));
  });

  it('marks only the current screen active, with aria-current', async () => {
    const container = await mount({ kind: 'admin-usage' });
    const active = [...container.querySelectorAll('a')].filter((link) => link.classList.contains('active'));
    expect(active.map((link) => link.textContent)).toEqual(['AI usage']);
    expect(active[0]?.getAttribute('aria-current')).toBe('page');
    expect(container.querySelectorAll('[aria-current]')).toHaveLength(1);
  });

  it('labels the links in Dutch when the locale is Dutch', async () => {
    const container = await mount({ kind: 'corpus-overrides' }, 'nl');
    expect([...container.querySelectorAll('a')].map((link) => link.textContent)).toEqual([
      'Gebruikers',
      'AI-gebruik',
      'Corpuscorrecties',
      'Corpuskandidaten',
    ]);
  });
});
