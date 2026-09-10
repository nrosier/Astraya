/**
 * The "Extended settings" panel's one settings bag, and the pure functions
 * that split it into the shapes its three consumers actually want (#52).
 *
 * `ExtendedSettingsPanel` edits one of these; `ChartView` holds the
 * confirmed value and, on every redraw, splits it three ways: the
 * compute-affecting half goes to `computeChartData` as `ChartCalculationOptions`,
 * the display-filter half goes to `chart-tables.ts`'s `PointVisibilityOptions`,
 * and the cosmetic half becomes the wheel's `signWedgeStyle`. Keeping the split
 * here, rather than inline in `ChartView`, means neither that component nor the
 * panel itself needs to know the shape of any of the three destinations.
 */
import { DEFAULT_ORB_CONFIG, type OrbConfig } from '../astrology/aspects.js';
import type { ChartCalculationOptions } from '../domain/chart-compute.js';
import type { PointVisibilityOptions } from '../domain/chart-tables.js';
import type { HouseSystem, Zodiac } from '../ephemeris/types.js';
import type { SignWedgeStyle } from './wheel.js';

export interface ExtendedSettings {
  readonly houseSystem: HouseSystem;
  readonly zodiac: Zodiac;
  /** -90..90, matching `OrbConfig.scalePercent`. */
  readonly orbScalePercent: number;
  /** Minor-aspect keys to consider; empty means every minor aspect is off. */
  readonly enabledMinorAspects: readonly string[];
  readonly lilithVariant: 'mean' | 'true';
  readonly nodeVariant: 'mean' | 'true';
  readonly fortuneVisible: boolean;
  readonly vertexVisible: boolean;
  readonly chironVisible: boolean;
  readonly midpointsVisible: boolean;
  readonly rainbowZodiac: boolean;
  readonly aspectsToChiron: boolean;
  readonly aspectsToLilith: boolean;
  readonly aspectsToLunarNodes: boolean;
}

/** Placidus, tropical, every default as documented on `DEFAULT_ORB_CONFIG` and `PointVisibilityOptions` — matches what a chart looks like with the panel never opened. */
export const DEFAULT_EXTENDED_SETTINGS: ExtendedSettings = {
  houseSystem: 'P',
  zodiac: { kind: 'tropical' },
  orbScalePercent: 0,
  enabledMinorAspects: [],
  lilithVariant: 'mean',
  nodeVariant: 'mean',
  fortuneVisible: false,
  vertexVisible: false,
  chironVisible: true,
  midpointsVisible: false,
  rainbowZodiac: false,
  aspectsToChiron: false,
  aspectsToLilith: false,
  aspectsToLunarNodes: false,
};

/** The half of `ExtendedSettings` that changes what `computeChartData` returns. */
export function toChartCalculationOptions(settings: ExtendedSettings): ChartCalculationOptions {
  const orbConfig: OrbConfig = {
    ...DEFAULT_ORB_CONFIG,
    scalePercent: settings.orbScalePercent,
    enabledMinorAspects: settings.enabledMinorAspects,
  };
  return {
    houseSystem: settings.houseSystem,
    zodiac: settings.zodiac,
    orbConfig,
    lilithVariant: settings.lilithVariant,
    nodeVariant: settings.nodeVariant,
    aspectsTo: {
      chiron: settings.aspectsToChiron,
      lilith: settings.aspectsToLilith,
      lunarNodes: settings.aspectsToLunarNodes,
    },
  };
}

/** The half that only changes which already-computed points the tables/wheel show. */
export function toPointVisibilityOptions(settings: ExtendedSettings): PointVisibilityOptions {
  return {
    chironVisible: settings.chironVisible,
    fortuneVisible: settings.fortuneVisible,
    vertexVisible: settings.vertexVisible,
    midpointsVisible: settings.midpointsVisible,
  };
}

/** The half that only changes the wheel's cosmetic sign-wedge fill. */
export function toSignWedgeStyle(settings: ExtendedSettings): SignWedgeStyle {
  return settings.rainbowZodiac ? 'rainbow' : 'default';
}
