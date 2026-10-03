/**
 * A horary chart (#406): an ordinary chart for the moment and place a question was asked, with the
 * considerations-before-judgment (`astrology/horary.ts`) worked out alongside it.
 *
 * Reuses `computeChartData` unchanged — a horary chart is a chart-for-a-moment, not a new kind of
 * computation — and `findVoidOfCourseMoon` for the one consideration that needs the ephemeris
 * beyond the chart itself.
 */
import { bodyByKey } from '../astrology/bodies.js';
import { houseOf } from '../astrology/emphasis.js';
import { horaryConsiderations, type HoraryConsideration } from '../astrology/horary.js';
import { findVoidOfCourseMoon, type VoidOfCourseMoon } from '../astrology/void-of-course.js';
import type { EphemerisProvider, HouseSystem } from '../ephemeris/types.js';
import { julianDayFor } from '../time/julian.js';
import { resolveMoment } from '../time/resolve.js';
import type { BirthMomentInput } from '../time/types.js';
import { computeChartData, housesAreDefined, type ChartData } from './chart-compute.js';

/**
 * Regiomontanus, the house system the horary tradition (Lilly onward) cast its charts in. The
 * natal screens default to Placidus; a horary chart is offered in the system its sources use.
 */
export const HORARY_DEFAULT_HOUSE_SYSTEM: HouseSystem = 'R';

export interface HoraryChart {
  readonly data: ChartData;
  readonly considerations: readonly HoraryConsideration[];
  readonly voidOfCourse: VoidOfCourseMoon;
  /** False when the houses came back undefined (no finite cusps), so no Ascendant exists to check. */
  readonly housesAvailable: boolean;
}

export async function computeHoraryChart(
  moment: BirthMomentInput,
  provider: EphemerisProvider,
  houseSystem: HouseSystem = HORARY_DEFAULT_HOUSE_SYSTEM,
): Promise<HoraryChart> {
  const data = await computeChartData(moment, provider, { houseSystem });
  const jd = await julianDayFor(provider, resolveMoment(moment));
  const voidOfCourse = await findVoidOfCourseMoon(provider, jd);

  const moon = bodyByKey('moon');
  const saturn = bodyByKey('saturn');
  const moonLongitude = data.positions.find((position) => position.body === moon?.id)?.longitude;
  const saturnLongitude = data.positions.find((position) => position.body === saturn?.id)?.longitude;
  if (moonLongitude === undefined || saturnLongitude === undefined) {
    throw new Error('unreachable: the ephemeris returned no position for the Moon or Saturn');
  }

  const housesAvailable = housesAreDefined(data.houses);
  return {
    data,
    voidOfCourse,
    housesAvailable,
    considerations: horaryConsiderations({
      // With no houses there is no Ascendant to be early or late; NaN fails both comparisons.
      ascendant: housesAvailable ? data.houses.ascendant : Number.NaN,
      moonLongitude,
      saturnHouse: housesAvailable ? houseOf(saturnLongitude, data.houses.cusps) : undefined,
      moonIsVoid: voidOfCourse.isVoid,
    }),
  };
}
