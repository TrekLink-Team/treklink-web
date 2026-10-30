import React from 'react';
import { addDays, type RosterWarning, type Shift } from '../../entities/organization/roster';
import { cn } from '../../shared/ui';
import { dayLabel, isGap, windowLabel } from './labels';

const shiftName = (shift: Shift): string =>
  `${shift.primary?.fullName ?? 'No primary'}, primary, ${windowLabel(shift.startsAt, shift.endsAt)}`;

// The day of the week a time falls on, by calendar day in the viewer's timezone: the first of the seven
// days whose date it shares. Times before the week start count as its first day, after it as its last.
const sameDay = (a: Date, b: Date): boolean =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

const dayIndex = (iso: string, weekStart: Date): number => {
  const at = new Date(iso);
  if (at < weekStart) return 0;
  const index = Array.from({ length: 7 }, (_, offset) => addDays(weekStart, offset)).findIndex((day) =>
    sameDay(day, at),
  );
  return index === -1 ? 6 : index;
};

interface Props {
  weekStart: Date;
  shifts: Shift[];
  warnings: RosterWarning[];
  /** Present for the Org Manager: each shift becomes a button that opens Edit. */
  onSelect?: (shift: Shift) => void;
}

// Screen 3.3 roster week: one column per day from the md breakpoint, an agenda by day below it. A shift
// sits on the day it starts; every NO_PRIMARY window or gap is an amber dashed cell carrying its words,
// so colour is never the only signal.
export const RosterCalendar: React.FC<Props> = ({ weekStart, shifts, warnings, onSelect }) => {
  const days = Array.from({ length: 7 }, (_, index) => addDays(weekStart, index));
  const gaps = warnings.filter(isGap);
  const ordered = [...shifts].sort((a, b) => a.startsAt.localeCompare(b.startsAt));

  return (
    <div className="grid grid-cols-1 gap-2 md:grid-cols-7">
      {days.map((day, index) => {
        const dayShifts = ordered.filter((shift) => dayIndex(shift.startsAt, weekStart) === index);
        const dayGaps = gaps.filter((gap) => dayIndex(gap.from, weekStart) === index);
        return (
          <section key={day.toISOString()} aria-label={dayLabel(day)} className="flex flex-col gap-2 rounded-panel border border-line bg-surface p-2">
            <h3 className="text-body-sm font-semibold text-ink">{dayLabel(day)}</h3>
            {dayShifts.map((shift) => {
              const body = (
                <>
                  <span className="font-semibold text-ink">{shift.primary?.fullName ?? 'No primary'}</span>
                  <span className="text-body-sm text-ink-muted">{windowLabel(shift.startsAt, shift.endsAt)}</span>
                  <span className="text-body-sm text-ink-muted">
                    {shift.backup ? `backup: ${shift.backup.fullName}` : 'backup: none'}
                  </span>
                </>
              );
              const box = 'flex min-h-11 flex-col items-start gap-0.5 rounded-control border border-status-done-line bg-status-done-tint px-2 py-1.5 text-left';
              return onSelect ? (
                <button
                  key={shift.id}
                  id={`shift-${shift.id}`}
                  type="button"
                  aria-label={shiftName(shift)}
                  onClick={() => onSelect(shift)}
                  className={cn(box, 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus')}
                >
                  {body}
                </button>
              ) : (
                <div key={shift.id} id={`shift-${shift.id}`} aria-label={shiftName(shift)} role="group" className={box}>
                  {body}
                </div>
              );
            })}
            {dayGaps.map((gap) => (
              <div
                key={`${gap.from}-${gap.to}`}
                className="rounded-control border border-dashed border-status-attention-line bg-status-attention-tint px-2 py-1.5 text-body-sm text-status-attention-fg"
              >
                <span className="font-semibold">No primary</span> {windowLabel(gap.from, gap.to)}
              </div>
            ))}
          </section>
        );
      })}
    </div>
  );
};
