/**
 * The panel beside a bi-wheel (Transits, Synastry) that says what the clicked symbol is (#418):
 * the body and the ring it is on, its sign and degree, the house it falls in on the first ring, and
 * its aspects to the other ring — or, for a sign or an aspect line, what stands in it or joins them.
 * The facts come from `resolveBiWheelSelection`; this only words them, in either language.
 */
import type { Locale } from '../interpretation/schema.js';
import { aspectDisplayName, bodyDisplayName, signDisplayName } from './astro-names.messages.js';
import type { BiWheelAspect, BiWheelFacts, BodyOnRing } from './bi-wheel-selection.js';
import { biWheelSelectionPanelMessages } from './BiWheelSelectionPanel.messages.js';
import { useMessages } from './messages.js';

interface Props {
  readonly facts: BiWheelFacts;
  /** The ring labels, by ring index. */
  readonly ringLabels: readonly string[];
  readonly locale: Locale;
  readonly onClear: () => void;
}

function minutes(value: number): string {
  return String(value).padStart(2, '0');
}

export function BiWheelSelectionPanel({ facts, ringLabels, locale, onClear }: Props) {
  const t = useMessages(biWheelSelectionPanelMessages);
  const ringLabel = (ring: number): string => ringLabels[ring] ?? '';
  const bodyOnRing = (bodyKey: string, ring: number): string =>
    t.onRing(bodyDisplayName(bodyKey, locale), ringLabel(ring));
  const place = (body: BodyOnRing): string =>
    `${signDisplayName(body.signName, locale)} ${String(body.degree)}°${minutes(body.minute)}'${body.retrograde ? ` ${t.retrograde}` : ''}`;

  const aspectItem = ({ row, other }: BiWheelAspect) => (
    <li key={`${row.bodyAKey}-${row.aspectKey}-${row.bodyBKey}-${String(other.ring)}`}>
      {aspectDisplayName(row.aspectKey, locale)} {bodyOnRing(other.bodyKey, other.ring)} (
      {`${t.orbLabel} ${row.orb.toFixed(2)}°, ${row.applying ? t.applying : t.separating}`})
    </li>
  );

  const heading =
    facts.kind === 'body'
      ? bodyOnRing(facts.body.bodyKey, facts.body.ring)
      : facts.kind === 'sign'
        ? signDisplayName(facts.signName, locale)
        : t.aspectBetween(
            aspectDisplayName(facts.row.aspectKey, locale),
            bodyOnRing(facts.a.bodyKey, facts.a.ring),
            bodyOnRing(facts.b.bodyKey, facts.b.ring),
          );
  const orbText = (orb: number, applying: boolean): string =>
    `${t.orbLabel} ${orb.toFixed(2)}°, ${applying ? t.applying : t.separating}`;

  return (
    <div className="chart-isolation-panel">
      <div className="chart-isolation-head">
        <strong>{heading}</strong>
        <button type="button" className="quiet" onClick={onClear}>
          {t.clear}
        </button>
      </div>

      {facts.kind === 'body' && (
        <>
          <p>
            {place(facts.body)}
            {facts.houseInFirstRing !== undefined && ` — ${t.inHouse(ringLabel(0), facts.houseInFirstRing)}`}
          </p>
          {facts.aspects.length === 0 ? (
            <p className="hint">{t.noContacts}</p>
          ) : (
            <ul aria-label={t.contactsHeading}>{facts.aspects.map(aspectItem)}</ul>
          )}
          {facts.ownAspects.length > 0 && (
            <ul aria-label={t.ownAspectsHeading(ringLabel(facts.body.ring))}>{facts.ownAspects.map(aspectItem)}</ul>
          )}
        </>
      )}

      {facts.kind === 'sign' &&
        (facts.bodies.length === 0 ? (
          <p className="hint">{t.signEmpty}</p>
        ) : (
          <ul>
            {facts.bodies.map((body) => (
              <li key={`${body.bodyKey}@${String(body.ring)}`}>
                {bodyOnRing(body.bodyKey, body.ring)} {body.degree}°{minutes(body.minute)}'
                {body.retrograde ? ` ${t.retrograde}` : ''}
              </li>
            ))}
          </ul>
        ))}

      {facts.kind === 'aspect' && <p>{orbText(facts.row.orb, facts.row.applying)}</p>}
    </div>
  );
}
