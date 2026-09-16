/**
 * True for the `demo` build (`npm run build:demo`) served at
 * https://nrosier.github.io/Astraya/ — a fully static GitHub Pages deploy with
 * no server component at all. `AccountPanel.tsx` and `session-context.tsx`
 * check this to skip sign-in/sync entirely rather than calling a `/api/*`
 * endpoint that doesn't exist there.
 */
export const IS_DEMO_MODE = import.meta.env.MODE === 'demo';
