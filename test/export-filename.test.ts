import { describe, expect, it } from 'vitest';
import { deriveExportFilename } from '../src/domain/export-filename.js';

describe('deriveExportFilename (#67/#68)', () => {
  it('slugifies the display name and chart kind', () => {
    expect(deriveExportFilename('Jane Doe', 'natal', 'svg')).toBe('jane-doe-natal.svg');
  });

  it('lowercases and collapses punctuation into single dashes', () => {
    expect(deriveExportFilename("O'Brien-Smith Jr.", 'natal', 'png')).toBe('o-brien-smith-jr-natal.png');
  });

  it('falls back to "chart" for an empty display name', () => {
    expect(deriveExportFilename('', 'natal', 'pdf')).toBe('chart-natal.pdf');
  });

  it('falls back to "chart" for a name that is entirely punctuation', () => {
    expect(deriveExportFilename('---', 'natal', 'csv')).toBe('chart-natal.csv');
  });

  it('carries the extension through verbatim', () => {
    expect(deriveExportFilename('Jane', 'natal', 'csv')).toMatch(/\.csv$/);
  });
});
