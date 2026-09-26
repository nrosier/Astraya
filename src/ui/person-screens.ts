/**
 * Every screen that lives under the person tab strip, re-exported from one module so
 * `App.tsx` can reach all ten behind a single dynamic `import()` (#338).
 *
 * A barrel rather than ten separate `import()` calls, deliberately: these screens share most
 * of `src/chart/**` and `src/domain/**` between them, so splitting them individually would
 * produce ten chunks plus a shared chunk every one of them waits for — more requests for the
 * same bytes. One boundary is also one thing to keep true: none of these screens is on the
 * path to first paint, and the landing route (`#/people`) needs none of them.
 *
 * Nothing but `App.tsx` should import this file. Importing it statically anywhere that the
 * main chunk reaches would silently pull the whole thing back in, which is what the chunk
 * assertions in `scripts/check-bundle-size.mjs` exist to catch.
 */
export { AstrocartographyView } from './AstrocartographyView.js';
export { ChartView } from './ChartView.js';
export { CompositeView } from './CompositeView.js';
export { HarmonicView } from './HarmonicView.js';
export { PeriodicTransitView } from './PeriodicTransitView.js';
export { PersonForm } from './PersonForm.js';
export { ProfectionsView } from './ProfectionsView.js';
export { ReportScreen } from './ReportScreen.js';
export { SynastryView } from './SynastryView.js';
export { TransitView } from './TransitView.js';
