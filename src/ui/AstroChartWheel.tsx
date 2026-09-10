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
import { Chart } from '@astrodraw/astrochart';
import { toAstroChartRadixData } from '../chart/astrochart-adapter.js';
import type { ChartData } from '../domain/chart-compute.js';

export function AstroChartWheel({
  data,
  size = 520,
}: {
  readonly data: ChartData;
  readonly size?: number;
}): React.JSX.Element {
  const containerId = `astrochart-${useId().replace(/:/g, '')}`;
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (container === null) return undefined;
    container.innerHTML = '';
    new Chart(containerId, size, size).radix(toAstroChartRadixData(data));
    return () => {
      container.innerHTML = '';
    };
  }, [containerId, data, size]);

  return <div id={containerId} ref={containerRef} className="chart-wheel-astrochart" />;
}
