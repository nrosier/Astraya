/**
 * The corpus, loaded and validated once at module load. Empty today — #55
 * populates `corpus/en.json`/`nl.json` with hand-written exemplars, and #56
 * generates the rest — but the loader's cross-locale and shape checks apply
 * from the first entry onward, not retrofitted once content exists.
 */
import en from './corpus/en.json' with { type: 'json' };
import nl from './corpus/nl.json' with { type: 'json' };
import { loadCorpus } from './loader.js';

export const CORPUS = loadCorpus({ en, nl });

export * from './schema.js';
export { loadCorpus } from './loader.js';
