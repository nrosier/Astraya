/**
 * The open/close rules of a row of dropdown buttons (#417), as one hook so they hold for every
 * menu that adopts them and can be tested without mounting the page around them.
 *
 * What a dropdown is expected to do, and a native `<details>` does not:
 * - **One at a time:** opening a group closes whichever was open.
 * - **Choosing something closes it** — the caller closes on selection via `close`.
 * - **Clicking or tapping anywhere outside** the open group closes it, including on another
 *   group's button (which then opens that one) and on the current page's own link.
 * - **Escape closes it** and puts focus back on the button that opened it, so a keyboard user is
 *   not left on an element that has just disappeared.
 * - **Tabbing out of it closes it.**
 * - **Changing page closes it** (`resetKey`), so a navigation never leaves a stale menu behind.
 *
 * The caller owns the markup: it registers each group's wrapper element with `groupRef(key)` (a
 * button and its popup must both be inside it, so pressing on the popup is "inside") and each
 * button with `buttonRef(key)`.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

export interface ExclusiveOpen<K extends string> {
  /** The open group, or `undefined` when none is. */
  readonly open: K | undefined;
  /** Opens `key`, or closes it if it is the one already open. */
  readonly toggle: (key: K) => void;
  readonly close: () => void;
  readonly groupRef: (key: K) => (element: HTMLElement | null) => void;
  readonly buttonRef: (key: K) => (element: HTMLElement | null) => void;
  /** For a group wrapper's `onBlur`: closes when focus moves to something outside that group. */
  readonly onGroupBlur: (key: K, event: React.FocusEvent<HTMLElement>) => void;
}

export function useExclusiveOpen<K extends string>(resetKey: string): ExclusiveOpen<K> {
  const [open, setOpen] = useState<K | undefined>(undefined);
  const groups = useRef(new Map<K, HTMLElement>());
  const buttons = useRef(new Map<K, HTMLElement>());

  // A new page: whatever was open belongs to the old one.
  useEffect(() => {
    setOpen(undefined);
  }, [resetKey]);

  useEffect(() => {
    if (open === undefined) return undefined;
    const onPointerDown = (event: PointerEvent): void => {
      const group = groups.current.get(open);
      if (group !== undefined && event.target instanceof Node && group.contains(event.target)) return;
      setOpen(undefined);
    };
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      setOpen(undefined);
      buttons.current.get(open)?.focus();
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const register = useCallback(
    (store: React.RefObject<Map<K, HTMLElement>>) => (key: K) => (element: HTMLElement | null) => {
      if (element === null) store.current.delete(key);
      else store.current.set(key, element);
    },
    [],
  );

  return {
    open,
    toggle: (key) => {
      setOpen((current) => (current === key ? undefined : key));
    },
    close: () => {
      setOpen(undefined);
    },
    groupRef: register(groups),
    buttonRef: register(buttons),
    onGroupBlur: (key, event) => {
      const next = event.relatedTarget;
      const group = groups.current.get(key);
      // `relatedTarget` is null when focus leaves the window or lands on nothing focusable;
      // that is not a reason to snap the menu shut under a pointer that is still using it.
      if (next instanceof Node && group !== undefined && !group.contains(next)) {
        setOpen((current) => (current === key ? undefined : current));
      }
    },
  };
}
