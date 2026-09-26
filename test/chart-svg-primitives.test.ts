/**
 * `escapeXml` is the only thing standing between user-controlled text and five
 * `dangerouslySetInnerHTML` sinks, so it gets its own tests rather than being covered
 * incidentally by whichever renderer happens to call it (#328).
 *
 * The cases that matter are the *attribute* ones. Every builder in `svg-primitives.ts`
 * interpolates into double-quoted attributes, and an escaper that handles only `&<>` is
 * correct for a text node and an injection point the first time a caller passes user text
 * as a class name or a `<title>` attribute.
 */
import { describe, expect, it } from 'vitest';
import { escapeXml, text } from '../src/chart/svg-primitives.js';

describe('escapeXml', () => {
  it('escapes the markup characters that end a text node', () => {
    expect(escapeXml('A & B <script>alert(1)</script>')).toBe('A &amp; B &lt;script&gt;alert(1)&lt;/script&gt;');
  });

  it('escapes both quote characters, which end an attribute value', () => {
    expect(escapeXml('say "hi"')).toBe('say &quot;hi&quot;');
    expect(escapeXml("it's")).toBe('it&#39;s');
  });

  it('cannot be used to break out of a double-quoted attribute', () => {
    // The shape of the attack this guards against: closing the attribute, then the tag,
    // then opening a new one. Nothing that could do that survives the escape.
    const hostile = '" onload="alert(1)" x="';
    const escaped = escapeXml(hostile);
    expect(escaped).not.toContain('"');
    expect(`<title class="${escaped}" />`).toBe('<title class="&quot; onload=&quot;alert(1)&quot; x=&quot;" />');
  });

  it('escapes the ampersand first, so an escape is never double-escaped', () => {
    // `&lt;` in the input must come back as `&amp;lt;` — the literal text the author
    // wrote — not as `&lt;`, which would decode to a real `<`.
    expect(escapeXml('&lt;script&gt;')).toBe('&amp;lt;script&amp;gt;');
  });

  it('leaves text with nothing to escape byte-identical', () => {
    // The renderers assert on generated markup as strings, so a gratuitous rewrite here
    // would be a diff across every chart test.
    expect(escapeXml('Ada Lovelace')).toBe('Ada Lovelace');
  });

  it('is safe to apply to a class name a builder puts in an attribute', () => {
    expect(text(0, 0, 'middle', escapeXml('a"b'), 'label')).toContain('class="a&quot;b"');
  });
});
