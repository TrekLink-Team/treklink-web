// @vitest-environment jsdom
import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';
import { NotFoundPage } from './NotFoundPage';

afterEach(cleanup);

// #516: an unknown URL showed "You do not have access to this."
describe('NotFoundPage', () => {
  it('says the page was not found, not that access is missing, and links to the start page', () => {
    render(
      <MemoryRouter>
        <NotFoundPage />
      </MemoryRouter>,
    );
    expect(screen.getByRole('heading', { level: 1, name: 'Page not found' })).toBeTruthy();
    expect(screen.queryByText('You do not have access to this.')).toBeNull();
    expect(screen.getByRole('link', { name: 'Go to the start page' }).getAttribute('href')).toBe('/');
  });
});
