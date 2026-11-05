// @vitest-environment jsdom
import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { AuthLayout } from './AuthLayout';

afterEach(cleanup);

describe('AuthLayout (public pages, screen 2.3)', () => {
  it('starts with a skip link to the main content, as the app shell does (W20B item 9)', () => {
    const { container } = render(
      <AuthLayout wide>
        <h1>Rent TrekLink devices</h1>
      </AuthLayout>,
    );
    const skip = screen.getByRole('link', { name: 'Skip to content' });
    expect(skip.getAttribute('href')).toBe('#main');
    // First in the tab order: the first focusable element of the page.
    expect(container.querySelector('a, button, [tabindex]:not([tabindex="-1"])')).toBe(skip);
    const main = screen.getByRole('main');
    expect(main.id).toBe('main');
    // The target takes focus when the link is followed.
    expect(main.getAttribute('tabindex')).toBe('-1');
  });
});
