import { describe, expect, it } from 'vitest';
import { DEFAULT_ORB_CONFIG } from '../src/astrology/aspects.js';
import {
  DEFAULT_EXTENDED_SETTINGS,
  toChartCalculationOptions,
  toPointVisibilityOptions,
  toSignWedgeStyle,
  type ExtendedSettings,
} from '../src/chart/extended-settings.js';

function withOverrides(overrides: Partial<ExtendedSettings>): ExtendedSettings {
  return { ...DEFAULT_EXTENDED_SETTINGS, ...overrides };
}

describe('DEFAULT_EXTENDED_SETTINGS', () => {
  it('matches a chart with the panel never opened: Placidus, tropical, no minor aspects, no aspects to Chiron/Lilith/Nodes', () => {
    expect(DEFAULT_EXTENDED_SETTINGS.houseSystem).toBe('P');
    expect(DEFAULT_EXTENDED_SETTINGS.zodiac).toEqual({ kind: 'tropical' });
    expect(DEFAULT_EXTENDED_SETTINGS.orbScalePercent).toBe(0);
    expect(DEFAULT_EXTENDED_SETTINGS.enabledMinorAspects).toEqual([]);
    expect(DEFAULT_EXTENDED_SETTINGS.chironVisible).toBe(true);
    expect(DEFAULT_EXTENDED_SETTINGS.fortuneVisible).toBe(false);
    expect(DEFAULT_EXTENDED_SETTINGS.vertexVisible).toBe(false);
    expect(DEFAULT_EXTENDED_SETTINGS.midpointsVisible).toBe(false);
    expect(DEFAULT_EXTENDED_SETTINGS.rainbowZodiac).toBe(false);
    expect(DEFAULT_EXTENDED_SETTINGS.aspectsToChiron).toBe(false);
    expect(DEFAULT_EXTENDED_SETTINGS.aspectsToLilith).toBe(false);
    expect(DEFAULT_EXTENDED_SETTINGS.aspectsToLunarNodes).toBe(false);
  });
});

describe('toChartCalculationOptions', () => {
  it('passes house system, zodiac, and variants through unchanged', () => {
    const settings = withOverrides({
      houseSystem: 'K',
      zodiac: { kind: 'sidereal', ayanamsa: 1 },
      lilithVariant: 'true',
      nodeVariant: 'true',
    });
    const options = toChartCalculationOptions(settings);
    expect(options.houseSystem).toBe('K');
    expect(options.zodiac).toEqual({ kind: 'sidereal', ayanamsa: 1 });
    expect(options.lilithVariant).toBe('true');
    expect(options.nodeVariant).toBe('true');
  });

  it('builds an orbConfig from DEFAULT_ORB_CONFIG with only scalePercent/enabledMinorAspects overridden', () => {
    const settings = withOverrides({ orbScalePercent: 50, enabledMinorAspects: ['quincunx'] });
    const options = toChartCalculationOptions(settings);
    expect(options.orbConfig).toEqual({
      ...DEFAULT_ORB_CONFIG,
      scalePercent: 50,
      enabledMinorAspects: ['quincunx'],
    });
  });

  it('maps the three aspectsTo booleans by name', () => {
    const settings = withOverrides({ aspectsToChiron: true, aspectsToLilith: false, aspectsToLunarNodes: true });
    const options = toChartCalculationOptions(settings);
    expect(options.aspectsTo).toEqual({ chiron: true, lilith: false, lunarNodes: true });
  });
});

describe('toPointVisibilityOptions', () => {
  it('picks out exactly the four visibility flags', () => {
    const settings = withOverrides({
      chironVisible: false,
      fortuneVisible: true,
      vertexVisible: true,
      midpointsVisible: true,
    });
    expect(toPointVisibilityOptions(settings)).toEqual({
      chironVisible: false,
      fortuneVisible: true,
      vertexVisible: true,
      midpointsVisible: true,
    });
  });
});

describe('toSignWedgeStyle', () => {
  it('is "default" when rainbowZodiac is off and "rainbow" when on', () => {
    expect(toSignWedgeStyle(withOverrides({ rainbowZodiac: false }))).toBe('default');
    expect(toSignWedgeStyle(withOverrides({ rainbowZodiac: true }))).toBe('rainbow');
  });
});
