/**
 * Which advisor voice the interpretation uses on this device. Read by the Interpretation tab and by
 * the wheel's selection panel (#415), so a planet shows the same words wherever it is read.
 */
import { PERSONA_IDS, type PersonaId } from '../interpretation/schema.js';

export const PERSONA_KEY = 'astraya:reportPersona';

// Off by default: unset, empty, or anything other than 'true' disables the picker. Not the
// string-presence pattern `geocode-provider.ts`'s env vars use — those are "which value", this
// is "on or off", so it's a literal truthy-string check instead.
// Read inside a function rather than hoisted to a module-level constant, the same reason
// `!import.meta.env.PROD` is checked inline elsewhere rather than hoisted: it keeps this
// test-visible per render/mount rather than frozen at whatever value happened to hold at first import.
export function reportPersonasEnabled(): boolean {
  const raw: unknown = import.meta.env.VITE_ENABLE_REPORT_PERSONAS;
  return raw === 'true';
}

export function isPersonaId(value: string): value is PersonaId {
  return (PERSONA_IDS as readonly string[]).includes(value);
}

/** The saved persona, or `undefined` (the neutral voice) when personas are off or none is saved. */
export function initialPersona(): PersonaId | undefined {
  if (!reportPersonasEnabled()) return undefined;
  const stored = localStorage.getItem(PERSONA_KEY);
  return stored !== null && isPersonaId(stored) ? stored : undefined;
}
