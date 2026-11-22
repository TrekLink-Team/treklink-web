import { useEffect, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';

// Marks a history entry that Next pushed, with the step it was pushed from, so the in-page Back
// returns to that entry instead of adding a new one (treklink-web#536).
const PUSHED_FROM = 'flowStepFrom';

const pushedFrom = (state: unknown): number | undefined => {
  if (typeof state !== 'object' || state === null || !(PUSHED_FROM in state)) return undefined;
  const value = (state as Record<string, unknown>)[PUSHED_FROM];
  return typeof value === 'number' ? value : undefined;
};

// `?step=2` is the second step; a missing, malformed or zero value is the first.
const requestedOf = (raw: string | null) => {
  const asked = Number(raw);
  return Number.isInteger(asked) && asked >= 1 ? asked - 1 : 0;
};

/**
 * The current step of a multi-step flow, kept in the address as `?step=N` (1-based, absent on the
 * first step) so browser Back and Forward move between steps (treklink-web#536). Other search
 * parameters, such as `mode=handover`, are kept.
 *
 * `reachable` is the last step the form state allows, counted from 0. Each new history entry is
 * clamped to it when it is opened, so a deep link or a reload to a later step whose earlier steps are
 * not filled shows the first unfilled step, and the address is corrected in place. A step already
 * shown is not taken away when `reachable` changes later; the page's own checks handle that.
 *
 * `forward` pushes an entry (Next), `back` returns to the entry Next came from when there is one,
 * and `jump` replaces the current entry (a server refusal sending the user to an earlier step).
 */
export const useStepParam = (reachable: number, key = 'step') => {
  const [params, setParams] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  const requested = requestedOf(params.get(key));
  const clamp = () => Math.max(0, Math.min(requested, reachable));
  // The clamp is taken once per history entry: derived state reset on a new location key.
  const [entry, setEntry] = useState(() => ({ key: location.key, step: clamp() }));
  let step = entry.step;
  if (entry.key !== location.key) {
    step = clamp();
    setEntry({ key: location.key, step });
  }

  const write = (next: number, replace: boolean, state?: unknown) =>
    setParams(
      (current) => {
        const query = new URLSearchParams(current);
        if (next <= 0) query.delete(key);
        else query.set(key, String(next + 1));
        return query;
      },
      { replace, state },
    );

  // The address asked for a step the form cannot show yet: correct it without a new entry.
  const corrected = step !== requested;
  useEffect(() => {
    if (corrected) write(step, true, location.state);
    // Runs when this entry's clamp differs from its address, once per entry.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [corrected, location.key]);

  return {
    step,
    forward: (next: number) => write(next, false, { [PUSHED_FROM]: step }),
    back: () => {
      if (step <= 0) return;
      if (pushedFrom(location.state) === step - 1) navigate(-1);
      else write(step - 1, true);
    },
    jump: (next: number) => {
      if (next !== step) write(next, true);
    },
  };
};
