// @vitest-environment jsdom
import React from 'react';
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { Shift } from '../../entities/organization/roster';
import { RosterCalendar } from './RosterCalendar';

// Local times, so the calendar day is the viewer's day whatever the test machine's timezone.
const at = (day: number, hours: number, minutes = 0) => new Date(2026, 9, day, hours, minutes).toISOString();

const shift = (id: string, startsAt: string, fullName: string): Shift =>
  ({
    id,
    startsAt,
    endsAt: new Date(new Date(startsAt).getTime() + 3_600_000).toISOString(),
    primary: { memberId: `m-${id}`, fullName },
    backup: null,
  }) as Shift;

afterEach(cleanup);

describe('RosterCalendar (screen 3.3)', () => {
  it('puts a shift on the calendar day it starts, late evenings included', () => {
    // Monday 2026-10-26, local midnight.
    const weekStart = new Date(2026, 9, 26);
    render(
      <RosterCalendar
        weekStart={weekStart}
        warnings={[]}
        shifts={[
          shift('1', at(27, 23, 59), 'Late Tuesday'),
          shift('2', at(28, 0, 0), 'Early Wednesday'),
          shift('3', at(25, 22), 'Before the week'),
          shift('4', at(33, 9), 'After the week'),
        ]}
      />,
    );
    const columns = screen.getAllByRole('region');
    expect(within(columns[1]).getByText('Late Tuesday')).toBeTruthy();
    expect(within(columns[2]).getByText('Early Wednesday')).toBeTruthy();
    expect(within(columns[0]).getByText('Before the week')).toBeTruthy();
    expect(within(columns[6]).getByText('After the week')).toBeTruthy();
  });
});
