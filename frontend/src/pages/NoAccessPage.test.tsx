// @vitest-environment jsdom
import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';
import { NoAccessPage } from './NoAccessPage';

afterEach(cleanup);

describe('NoAccessPage (MSG26, REQ-ERR-01)', () => {
  it('has one h1, keeps MSG26 alone in the alert and links to the start page', () => {
    render(
      <MemoryRouter>
        <NoAccessPage />
      </MemoryRouter>,
    );

    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByRole('alert').textContent).toBe('You do not have access to this.');
    expect(screen.getByRole('link', { name: 'Go to the start page' }).getAttribute('href')).toBe(
      '/',
    );
  });
});
