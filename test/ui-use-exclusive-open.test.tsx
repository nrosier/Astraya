// @vitest-environment jsdom
/**
 * The dropdown rules (#417), tested on the hook itself through a minimal row of two groups, so
 * each rule is pinned without mounting the whole page around it.
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { useExclusiveOpen } from '../src/ui/use-exclusive-open.js';

type Key = 'a' | 'b';

function Menu({ resetKey }: { resetKey: string }): React.JSX.Element {
  const menu = useExclusiveOpen<Key>(resetKey);
  return (
    <div>
      <p id="outside" tabIndex={-1}>
        outside
      </p>
      {(['a', 'b'] as const).map((key) => (
        <div
          key={key}
          ref={menu.groupRef(key)}
          onBlur={(event) => {
            menu.onGroupBlur(key, event);
          }}
        >
          <button
            type="button"
            ref={menu.buttonRef(key)}
            id={`toggle-${key}`}
            aria-expanded={menu.open === key}
            onClick={() => {
              menu.toggle(key);
            }}
          >
            {key}
          </button>
          {menu.open === key && (
            <ul id={`popup-${key}`}>
              <li>
                <a href="#x" id={`link-${key}`} onClick={menu.close}>
                  item
                </a>
              </li>
            </ul>
          )}
        </div>
      ))}
    </div>
  );
}

let mounted: { container: HTMLElement; root: Root } | undefined;

afterEach(() => {
  if (mounted !== undefined) {
    act(() => {
      mounted?.root.unmount();
    });
    mounted.container.remove();
    mounted = undefined;
  }
});

async function mount(
  resetKey = 'page-1',
): Promise<{ container: HTMLElement; rerender: (key: string) => Promise<void> }> {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(<Menu resetKey={resetKey} />);
    await Promise.resolve();
  });
  mounted = { container, root };
  return {
    container,
    rerender: async (key) => {
      await act(async () => {
        root.render(<Menu resetKey={key} />);
        await Promise.resolve();
      });
    },
  };
}

const $ = (id: string): HTMLElement => {
  const element = document.getElementById(id);
  if (element === null) throw new Error(`test fixture bug: no #${id}`);
  return element;
};
const isOpen = (key: Key): boolean => document.getElementById(`popup-${key}`) !== null;

async function click(element: HTMLElement): Promise<void> {
  await act(async () => {
    element.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    element.click();
    await Promise.resolve();
  });
}

async function press(key: string): Promise<void> {
  await act(async () => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
    await Promise.resolve();
  });
}

describe('useExclusiveOpen (#417)', () => {
  it('starts with nothing open', async () => {
    await mount();
    expect(isOpen('a')).toBe(false);
    expect(isOpen('b')).toBe(false);
  });

  it('opens a group on its button and closes it on a second press', async () => {
    await mount();
    await click($('toggle-a'));
    expect(isOpen('a')).toBe(true);
    expect($('toggle-a').getAttribute('aria-expanded')).toBe('true');
    await click($('toggle-a'));
    expect(isOpen('a')).toBe(false);
    expect($('toggle-a').getAttribute('aria-expanded')).toBe('false');
  });

  it('closes the open group when another is opened, so never two at once', async () => {
    await mount();
    await click($('toggle-a'));
    await click($('toggle-b'));
    expect(isOpen('a')).toBe(false);
    expect(isOpen('b')).toBe(true);
  });

  it('closes when something inside the group is chosen', async () => {
    await mount();
    await click($('toggle-a'));
    await click($('link-a'));
    expect(isOpen('a')).toBe(false);
  });

  it('closes on a press anywhere outside the open group', async () => {
    await mount();
    await click($('toggle-a'));
    await click($('outside'));
    expect(isOpen('a')).toBe(false);
  });

  it('stays open when the press is inside the open group, even on its popup', async () => {
    await mount();
    await click($('toggle-a'));
    await act(async () => {
      $('popup-a').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
      await Promise.resolve();
    });
    expect(isOpen('a')).toBe(true);
  });

  it('closes on Escape and returns focus to the button that opened it', async () => {
    await mount();
    await click($('toggle-b'));
    $('link-b').focus();
    await press('Escape');
    expect(isOpen('b')).toBe(false);
    expect(document.activeElement).toBe($('toggle-b'));
  });

  it('ignores other keys', async () => {
    await mount();
    await click($('toggle-a'));
    await press('Enter');
    await press('ArrowDown');
    expect(isOpen('a')).toBe(true);
  });

  it('closes when keyboard focus moves out of the group, but not between its own controls', async () => {
    await mount();
    await click($('toggle-a'));
    $('toggle-a').focus();
    await act(async () => {
      $('link-a').focus();
      await Promise.resolve();
    });
    expect(isOpen('a')).toBe(true);
    await act(async () => {
      $('outside').focus();
      await Promise.resolve();
    });
    expect(isOpen('a')).toBe(false);
  });

  it('closes when the page changes', async () => {
    const { rerender } = await mount('page-1');
    await click($('toggle-a'));
    expect(isOpen('a')).toBe(true);
    await rerender('page-1');
    expect(isOpen('a')).toBe(true);
    await rerender('page-2');
    expect(isOpen('a')).toBe(false);
  });

  it('stops listening once closed: later presses and keys do nothing', async () => {
    await mount();
    await click($('toggle-a'));
    await click($('outside'));
    await press('Escape');
    await click($('outside'));
    expect(isOpen('a')).toBe(false);
    expect(isOpen('b')).toBe(false);
  });
});
