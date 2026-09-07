import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';

/**
 * Lint configuration for Astraya.
 *
 * Beyond ordinary hygiene this file enforces the two architectural boundaries the
 * design depends on, so they hold mechanically rather than by memory:
 *
 *   1. `sweph-wasm` may only be imported inside `src/ephemeris/`. Everything else
 *      talks to the `EphemerisProvider` interface, which is what keeps the pure
 *      astrology code testable without WebAssembly and the engine swappable.
 *   2. `tools/` may never be imported from `src/`. The interpretation corpus is
 *      LLM-drafted at build time and committed as data; a stray import would put
 *      a model client in the shipped bundle, which must never happen.
 */
export default tseslint.config(
  { ignores: ['dist/**', 'coverage/**', 'public/ephe/**', 'src/ephemeris/generated-constants.ts'] },
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      // A dropped promise in chart code means a silently incomplete chart.
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/consistent-type-imports': 'error',
      // Swiss Ephemeris reports failure through strings that are easy to swallow.
      'no-empty': ['error', { allowEmptyCatch: false }],
      eqeqeq: ['error', 'always'],
      // Numbers interpolate unambiguously, and test names read better for it.
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
    },
  },
  {
    files: ['src/**/*.{ts,tsx}'],
    ignores: ['src/ephemeris/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'sweph-wasm',
              message: 'Swiss Ephemeris is only reachable through src/ephemeris/. Use EphemerisProvider.',
            },
          ],
          patterns: [
            {
              group: ['**/tools/**', 'tools/*'],
              message: 'tools/ is build-time only and must never reach the browser bundle.',
            },
          ],
        },
      ],
    },
  },
  {
    // Scripts are plain .mjs so they run under bare `node` with no build step,
    // which puts them outside the typed project. Order matters: disableTypeChecked
    // replaces languageOptions wholesale, so the Node globals come after it.
    files: ['scripts/**/*.mjs', 'eslint.config.js'],
    ...tseslint.configs.disableTypeChecked,
  },
  {
    files: ['scripts/**/*.mjs', 'eslint.config.js', 'vite.config.ts'],
    languageOptions: { globals: globals.node },
  },
  {
    files: ['src/ephemeris/engine.ts'],
    rules: {
      /**
       * The engine's methods are async with nothing to await, on purpose:
       * `EphemerisProvider` is async because the shipped implementation lives in a
       * Web Worker. Matching that signature here is what lets the direct engine be
       * substituted for the worker client in tests.
       */
      '@typescript-eslint/require-await': 'off',
    },
  },
  {
    files: ['test/**/*.ts'],
    rules: {
      // Test doubles legitimately have no-op members: a transport that drops
      // messages is exactly the failure being simulated.
      '@typescript-eslint/no-empty-function': 'off',
    },
  },
);
