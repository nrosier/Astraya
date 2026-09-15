// @vitest-environment jsdom
/**
 * `HomeRedirect` (#263) — the bare `home` route it renders for is reached on every fresh
 * visit with no hash at all, and (before this fix) by `SetupForm` after the very first
 * account is created. It has one render's worth of time to say something before the
 * `hashchange` it fires lands the app on `#/people` — rendering nothing there is a blank
 * main content area for that render, however briefly.
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { describe, expect, it } from 'vitest';
import { HomeRedirect } from '../src/ui/App.js';

function mount(): { container: HTMLElement; root: Root } {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  act(() => {
    root.render(<HomeRedirect />);
  });
  return { container, root };
}

describe('HomeRedirect', () => {
  it('renders a non-empty <main> immediately, not null, while it redirects to #/people', () => {
    window.location.hash = '#/';
    const { container, root } = mount();
    try {
      const main = container.querySelector('main');
      expect(main).not.toBeNull();
      expect(main?.textContent).not.toBe('');
    } finally {
      act(() => {
        root.unmount();
      });
      container.remove();
    }
  });

  it('redirects to #/people', async () => {
    window.location.hash = '#/';
    const { container, root } = mount();
    try {
      await act(async () => {
        await Promise.resolve();
      });
      expect(window.location.hash).toBe('#/people');
    } finally {
      act(() => {
        root.unmount();
      });
      container.remove();
    }
  });
});
