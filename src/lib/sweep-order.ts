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

export function orderSweeps(states: SweepState[], now: number, backoffMs: number): SweepState[] {
  const eligible = states.filter((s) => !(s.stalledSince > 0 && now - s.stalledSince < backoffMs));
  return eligible.sort((a, b) => {
    const ac = a.cursor > 0 ? 1 : 0, bc = b.cursor > 0 ? 1 : 0;
    if (ac !== bc) return bc - ac;
    /* Lateness as a MULTIPLE of the gate. A never-run sweep has lastCycle 0, so its ratio is
       enormous and it sorts first — which is what "has no data at all" deserves. */
    const ar = (now - a.lastCycle) / (a.hours * 3_600_000);
    const br = (now - b.lastCycle) / (b.hours * 3_600_000);
    if (ar !== br) return br - ar;
    return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
  });
}
