// @vitest-environment jsdom
import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { Incident } from './api';
import { StateBadges } from './ui';

const INCIDENT = {
  state: 'NOTIFY_PRIMARY',
  confidence: 'CONFIRMED',
  stale: false,
} as Incident;

describe('StateBadges', () => {
  afterEach(() => cleanup());

  it('labels an incident opened by a simulated event, in words (screen 7.5, demo design §9)', () => {
    render(<StateBadges incident={{ ...INCIDENT, simulated: true }} />);
    expect(screen.getByText('Simulated')).toBeTruthy();
  });

  it('shows no Simulated label for a real incident or an older backend', () => {
    render(<StateBadges incident={{ ...INCIDENT, simulated: false }} />);
    render(<StateBadges incident={INCIDENT} />);
    expect(screen.queryByText('Simulated')).toBeNull();
  });
});
