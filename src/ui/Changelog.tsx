/**
 * In-app changelog.
 *
 * The version in the footer is a link here, so a user can see what changed in the
 * build they are actually running without leaving for GitHub — and without a
 * network request, since the changelog is bundled at build time.
 */
import changelogSource from '../../CHANGELOG.md?raw';
import { renderMarkdown } from './markdown.js';
import { APP_VERSION, SOURCE_URL, sourceFileUrl } from '../version.js';

export function Changelog(): React.JSX.Element {
  return (
    <main className="shell">
      <p>
        <a href="#/">&larr; Back</a>
      </p>
      <h1>Changelog</h1>
      <p className="tagline">
        You are running <strong>{APP_VERSION}</strong>.
      </p>
      <div className="prose">{renderMarkdown(changelogSource, { resolveRelative: sourceFileUrl })}</div>
      <footer>
        <a href={`${SOURCE_URL}/commits/main`}>Full commit history</a>
      </footer>
    </main>
  );
}
