/**
 * WHICH BULK SWEEP GETS THIS TICK.
 *
 * The ingest runs at most one bulk sweep per invocation — a subrequest ceiling, not a
 * preference — and for a long time it chose by writing them as a chain of `else`s. Position
 * was priority, and that is a structural single point of failure: anything ahead of you being
 * due, or stuck, means you never run. It bit exactly that way when a fifth sweep was added at
 * the end and produced nothing for half an hour while four ahead of it took every tick.
 *
 * The order is now derived from state rather than from source position:
 *
 *   1. A sweep already MID-CYCLE finishes first. A cycle half-done is worse than one not
 *      started — its cursor is walking a frozen list, and leaving it parked means the list
 *      ages under it.
 *   2. Otherwise, the sweep furthest PAST ITS OWN GATE goes, measured in multiples of that
 *      gate rather than in absolute time. A 2-hour sweep an hour late and a 12-hour sweep an
 *      hour late are not equally starved, and comparing raw lateness would always favour the
 *      slow one.
 *   3. A sweep in failure BACKOFF is skipped entirely. Without this, overdue-first has an
 *      obvious pathology: a permanently failing sweep is permanently the most overdue, and
 *      would take every tick forever — swapping one starvation for a worse one.
 *
 * Ties break on name so the choice is deterministic and a test can assert it.
 */
export interface SweepState {
  name: string;
  /** Gate in hours: how often this sweep wants to complete a cycle. */
  hours: number;
  /** When it last completed a full cycle. 0 = never. */
  lastCycle: number;
  /** Cursor into the frozen cycle list; > 0 means a cycle is in progress. */
  cursor: number;
  /** When it last failed to make progress. 0 = not backing off. */
  stalledSince: number;
}

/** How far past its gate a faster sweep must be before it may go ahead of a slower one's
 *  unfinished cycle — see rule 4. */
export const PREEMPT_RATIO = 1.25;

export function orderSweeps(states: SweepState[], now: number, backoffMs: number, blind = false): SweepState[] {
  const eligible = states.filter((s) => !(s.stalledSince > 0 && now - s.stalledSince < backoffMs));
  const ratio = (s: SweepState) => (now - s.lastCycle) / (s.hours * 3_600_000);
  const base = [...eligible].sort((a, b) => {
    const ac = a.cursor > 0 ? 1 : 0, bc = b.cursor > 0 ? 1 : 0;
    if (ac !== bc) return bc - ac;
    /* Lateness as a MULTIPLE of the gate. A never-run sweep has lastCycle 0, so its ratio is
       enormous and it sorts first — which is what "has no data at all" deserves. */
    const ar = (now - a.lastCycle) / (a.hours * 3_600_000);
    const br = (now - b.lastCycle) / (b.hours * 3_600_000);
    if (ar !== br) return br - ar;
    return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
  });
  /* 4. A FASTER SWEEP WELL PAST ITS GATE GOES AHEAD OF A SLOWER ONE'S UNFINISHED CYCLE. Rule 1 let
     the 6-hour funding cycle — six symbols a tick, about ten ticks — hold the slot while the 2-hour
     m15 sweep the 15-minute charts read went 169 minutes without a cycle, past the 3-hour ceiling
     the live chart check allows (15 October 2026, after CHUNK fell from 24 to 12 to stop bursting
     into Hyperliquid's limit). No request is added: the slower cycle keeps its cursor and resumes
     where it stopped. Only a sweep not itself mid-cycle, at PREEMPT_RATIO of its own gate, with a
     shorter gate than every cycle in progress, moves ahead — a slow sweep is delayed, never
     abandoned, and the fast ones cannot preempt each other. */
  if (blind) return base;
  const running = base.filter((s) => s.cursor > 0);
  if (!running.length) return base;
  const slowest = Math.min(...running.map((s) => s.hours));
  const urgent = base.filter((s) => s.cursor === 0 && s.hours < slowest && ratio(s) >= PREEMPT_RATIO);
  return urgent.length ? [...urgent, ...base.filter((s) => !urgent.includes(s))] : base;
}
