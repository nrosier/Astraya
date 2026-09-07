/**
 * Tests for the changelog's Markdown subset renderer.
 *
 * The failure that matters is not ugly output — it is *silently dropped* content. A
 * changelog that quietly omits an entry is worse than one showing raw syntax, so
 * these tests check coverage of the real CHANGELOG.md as well as the syntax cases.
 */
import { isValidElement, type ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import changelogSource from '../CHANGELOG.md?raw';
import { renderMarkdown } from '../src/ui/markdown.js';
import { sourceFileUrl } from '../src/version.js';

/** Flatten a rendered tree to its visible text. */
function textOf(node: ReactNode): string {
  if (node === null || node === undefined || typeof node === 'boolean') return '';
  if (typeof node === 'string') return node;
  if (typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join('');
  if (isValidElement<{ children?: ReactNode }>(node)) return textOf(node.props.children);
  return '';
}

function tagsOf(source: string): string[] {
  return renderMarkdown(source).map((element) => String(element.type));
}

describe('markdown renderer', () => {
  it('demotes headings so the page keeps a single h1', () => {
    // The page owns its <h1>; a document h1 here would give it two and break the
    // heading outline for screen readers.
    expect(tagsOf('# Title\n\n## Section\n\n### Sub')).toEqual(['h2', 'h3', 'h4']);
  });

  it('renders lists, paragraphs, bold, code and links', () => {
    const rendered = renderMarkdown('Some **bold** and `code` text.\n\n- first\n- a [link](https://example.com)\n');
    expect(tagsOf('Some text.\n\n- item\n')).toEqual(['p', 'ul']);
    expect(textOf(rendered)).toBe('Some bold and code text.firsta link');
  });

  it('drops link reference definitions but keeps everything else', () => {
    expect(tagsOf('Text.\n\n[0.1.0]: https://example.com/tag/v0.1.0\n')).toEqual(['p']);
    expect(textOf(renderMarkdown('[0.1.0]: https://example.com\n'))).toBe('');
  });

  it('renders a non-http link as text rather than following it', () => {
    // Our own changelog should never contain one; if it does, showing the syntax is
    // how we find out, and a renderer that cannot emit such an href cannot become
    // an injection sink later.
    const rendered = renderMarkdown('[click](javascript:alert(1))');
    expect(textOf(rendered)).toContain('[click](javascript:alert(1))');
    expect(JSON.stringify(rendered)).not.toContain('href');
  });

  it('renders the real changelog without losing content', () => {
    // Rendered exactly as Changelog.tsx renders it, resolver included — otherwise the
    // test would pass on a path the app never takes.
    const rendered = renderMarkdown(changelogSource, { resolveRelative: sourceFileUrl });
    const text = textOf(rendered);

    expect(rendered.length).toBeGreaterThan(10);
    expect(text).toContain('0.1.0');
    expect(text).toContain('Swiss Ephemeris');
    // No raw syntax left visible, which would mean a construct went unhandled.
    expect(text).not.toMatch(/\*\*/);
    expect(text).not.toMatch(/`/);
    expect(text).not.toMatch(/\]\(/);

    // Every list item in the source survives to the output.
    const sourceItems = changelogSource.split('\n').filter((line) => /^\s*-\s+\S/.test(line)).length;
    const renderedItems = rendered
      .filter((element) => element.type === 'ul')
      .reduce((total, list) => {
        const { children } = list.props as { children: unknown[] };
        return total + children.length;
      }, 0);
    expect(renderedItems).toBe(sourceItems);
  });
});
