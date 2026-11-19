// @vitest-environment jsdom
import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { VersionCell } from './fieldStationUi';
import type { FieldStation } from './fieldStations';

const station = (overrides: Partial<FieldStation> = {}): FieldStation =>
  ({ version: '1.4.0', outdated: false, revokedAt: null, ...overrides }) as FieldStation;

// #511: a station that never reported showed "Not reported" beside a "Current" badge.
describe('VersionCell', () => {
  afterEach(() => cleanup());

  it('shows no version badge until the station reports a version', () => {
    render(<VersionCell station={station({ version: null })} />);
    expect(screen.getByText('Not reported')).toBeTruthy();
    expect(screen.queryByText('Current')).toBeNull();
    expect(screen.queryByText('Outdated')).toBeNull();
  });

  it('badges a reported version as Current or Outdated', () => {
    render(<VersionCell station={station()} />);
    expect(screen.getByText('Current')).toBeTruthy();
    cleanup();
    render(<VersionCell station={station({ outdated: true })} />);
    expect(screen.getByText('Outdated')).toBeTruthy();
  });

  it('shows no badge on a revoked station', () => {
    render(<VersionCell station={station({ revokedAt: '2026-11-01T00:00:00Z' })} />);
    expect(screen.queryByText('Current')).toBeNull();
  });
});
