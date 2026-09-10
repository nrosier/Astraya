/**
 * An alternate on-screen wheel rendering, drawn by `@astrodraw/astrochart` (MIT —
 * https://github.com/AstroDraw/AstroChart) instead of Astraya's own `src/chart/*`
 * SVG-string pipeline.
 *
 * Deliberately screen-only: the library draws by mutating a DOM container
 * (`new Chart(elementId, ...).radix(...)`), which is exactly the imperative,
 * non-serializable style `src/chart/chart-sheet.ts` was built to avoid, so it does
 * not participate in SVG/PNG/PDF export — those keep exporting Astraya's own
 * rendering, unchanged.
 */
import { useEffect, useId, useRef } from 'react';
import { Chart, type Settings } from '@astrodraw/astrochart';
import { toAstroChartRadixData } from '../chart/astrochart-adapter.js';
import type { ChartData } from '../domain/chart-compute.js';
import type { SignWedgeStyle } from '../chart/wheel.js';

/**
 * One hue per sign, 30° apart starting at Aries — the same distribution
 * `multi-wheel.ts`'s `.wheel-sign-wedge-*` rainbow classes use, just opaque
 * rather than a wash, since that's how this library's own default
 * `COLORS_SIGNS` (a 4-color repeating scheme) is already drawn: solid fills
 * sitting behind the points/cusps layers drawn after them.
 */
const RAINBOW_SIGN_COLORS: readonly string[] = Array.from(
  { length: 12 },
  (_, signIndex) => `hsl(${signIndex * 30} 75% 55%)`,
);

export function AstroChartWheel({
  data,
  size = 520,
  signWedgeStyle = 'default',
}: {
  readonly data: ChartData;
  readonly size?: number;
  readonly signWedgeStyle?: SignWedgeStyle;
}): React.JSX.Element {
  const containerId = `astrochart-${useId().replace(/:/g, '')}`;
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (container === null) return undefined;
    container.innerHTML = '';
    const settings: Partial<Settings> = signWedgeStyle === 'rainbow' ? { COLORS_SIGNS: [...RAINBOW_SIGN_COLORS] } : {};
    new Chart(containerId, size, size, settings).radix(toAstroChartRadixData(data));
    return () => {
      container.innerHTML = '';
    };
  }, [containerId, data, size, signWedgeStyle]);

  return <div id={containerId} ref={containerRef} className="chart-wheel-astrochart" />;
}
