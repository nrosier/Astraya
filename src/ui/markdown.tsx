/**
 * A deliberately small Markdown renderer for the changelog.
 *
 * Astraya ships its own `CHANGELOG.md` and renders it in-app, so clicking the
 * version shows what changed without leaving for GitHub. That needs Markdown, but
 * not much of it: headings, lists, paragraphs, bold, code and links.
 *
 * It renders to React elements and **never** touches `dangerouslySetInnerHTML`. The
 * changelog is our own committed file rather than user input, so injection is not
 * the live threat — but a renderer that cannot produce raw HTML cannot be turned
 * into an injection sink later either, and that is worth more than the few lines a
 * library would have saved. It also keeps the bundle free of a dependency whose
 * whole job is turning text into markup.
 *
 * Anything it does not understand is rendered as plain text rather than dropped.
 * Silently swallowing a changelog entry would be worse than showing its syntax.
 */
import type { JSX, ReactNode } from 'react';

const INLINE = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)]+\))/g;

export interface MarkdownOptions {
  /**
   * Resolve a repo-relative link such as `docs/RELEASING.md`.
   *
   * The changelog is read in two places: on GitHub, where relative links resolve
   * against the repository, and inside the app, where they would not resolve at all.
   * Rather than forbid relative links in the source, the caller says how to turn one
   * into an absolute URL.
   */
  readonly resolveRelative?: (href: string) => string;
}

/** Parse bold, inline code and links. Everything else stays literal text. */
function inline(text: string, options: MarkdownOptions): ReactNode[] {
  return text.split(INLINE).map((part, index) => {
    const key = `${String(index)}-${part.slice(0, 8)}`;
    if (part.startsWith('**') && part.endsWith('**')) return <strong key={key}>{part.slice(2, -2)}</strong>;
    if (part.startsWith('`') && part.endsWith('`')) return <code key={key}>{part.slice(1, -1)}</code>;
    const link = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(part);
    if (link?.[1] !== undefined && link[2] !== undefined) {
      const raw = link[2];
      const relative = !/^([a-z][a-z0-9+.-]*:|#|\/)/i.test(raw);
      const href = relative && options.resolveRelative !== undefined ? options.resolveRelative(raw) : raw;
      // Only http(s) and in-app hash links survive. A javascript: or data: URL in
      // our own changelog would mean something has gone very wrong, and rendering it
      // as text is the safe way to find that out. Checked *after* resolution, so a
      // resolver cannot smuggle a scheme past this.
      const safe = /^(https?:\/\/|#|\/)/.test(href);
      return safe ? (
        <a key={key} href={href}>
          {link[1]}
        </a>
      ) : (
        <span key={key}>{part}</span>
      );
    }
    return part;
  });
}

/** Render a Markdown subset: `##`/`###` headings, `-` lists and paragraphs. */
export function renderMarkdown(source: string, options: MarkdownOptions = {}): JSX.Element[] {
  const out: JSX.Element[] = [];
  const lines = source.split('\n');
  let paragraph: string[] = [];
  let list: string[] = [];

  const flushParagraph = (): void => {
    if (paragraph.length > 0) {
      out.push(<p key={`p${String(out.length)}`}>{inline(paragraph.join(' '), options)}</p>);
      paragraph = [];
    }
  };
  const flushList = (): void => {
    if (list.length > 0) {
      out.push(
        <ul key={`ul${String(out.length)}`}>
          {list.map((item, index) => (
            <li key={`${String(index)}-${item.slice(0, 12)}`}>{inline(item, options)}</li>
          ))}
        </ul>,
      );
      list = [];
    }
  };
  const flush = (): void => {
    flushParagraph();
    flushList();
  };

  for (const line of lines) {
    // Link reference definitions ("[0.1.0]: https://...") are machinery, not content.
    if (/^\[[^\]]+\]:\s*\S+$/.test(line)) continue;

    if (line.trim() === '') {
      flush();
      continue;
    }
    const heading = /^(#{1,4})\s+(.*)$/.exec(line);
    if (heading?.[1] !== undefined && heading[2] !== undefined) {
      flush();
      const level = heading[1].length;
      const text = inline(heading[2], options);
      const key = `h${String(out.length)}`;
      // Demote by one: the page already owns its <h1>, so a document <h1> here
      // would give the page two and break the heading outline for screen readers.
      if (level <= 1) out.push(<h2 key={key}>{text}</h2>);
      else if (level === 2) out.push(<h3 key={key}>{text}</h3>);
      else out.push(<h4 key={key}>{text}</h4>);
      continue;
    }
    const item = /^\s*-\s+(.*)$/.exec(line);
    if (item?.[1] !== undefined) {
      flushParagraph();
      list.push(item[1]);
      continue;
    }
    flushList();
    paragraph.push(line.trim());
  }
  flush();
  return out;
}
