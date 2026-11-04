// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useSession, type SessionUser } from '../../entities/session/model';
import { PageHeader } from '../../shared/ui/PageHeader';
import { StickyPageHeader } from '../../shared/ui/PageChrome';
import { Tag } from 'lucide-react';
import { AppShell } from './AppShell';
import { SideNav } from './SideNav';
import { useShell } from './shellStore';

vi.mock('../../shared/api/apiClient', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../shared/api/apiClient')>()),
  apiClient: vi.fn(() => new Promise(() => undefined)),
}));

const MANAGER: SessionUser = {
  id: 'm',
  email: 'manager@example.test',
  fullName: 'Nguyen Van A',
  accountType: 'ORGANIZATION',
  roles: ['ORG_MANAGER'],
  organization: {
    id: 'o',
    code: 'ORG-0007',
    legalName: 'ACME Trek Co., Ltd.',
    status: 'ACTIVE',
    memberRole: 'MANAGER',
  },
};

const show = (path: string, page: React.ReactNode = <p>page body</p>) => {
  act(() =>
    useSession
      .getState()
      .signIn(
        { accessToken: 'a', accessTokenExpiresIn: 1, refreshToken: 'r', refreshTokenExpiresIn: 1 },
        MANAGER,
      ),
  );
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={[path]}>
        <AppShell user={MANAGER} home="/o/contracts" banner={<div role="alert">SOS banner</div>}>
          {page}
        </AppShell>
      </MemoryRouter>
    </QueryClientProvider>,
  );
};

afterEach(() => {
  cleanup();
  act(() => {
    useSession.getState().signOut();
    useShell.setState({ info: null, infoSheetOpen: false, infoOpen: true });
  });
});

describe('AppShell (specs/frontend/design.md §2)', () => {
  it('puts the incident banner before the header', () => {
    const { container } = show('/o/contracts');
    const banner = screen.getByRole('alert');
    const header = container.querySelector('header')!;
    expect(banner.compareDocumentPosition(header) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('shows the workspace, the environment and the built modules of the role', () => {
    show('/o/contracts');
    expect(screen.getAllByText('ACME Trek Co., Ltd.').length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Sandbox/).length).toBeGreaterThan(0);
    const nav = screen.getByRole('navigation', { name: 'Modules' });
    expect(within(nav).getByRole('link', { name: 'Invoices' })).toBeTruthy();
    expect(within(nav).getByRole('link', { name: 'Members' })).toBeTruthy();
    // Loss cases is built (screen 4.4, 2026-10-31); a TrekLink module never shows for an organization.
    expect(within(nav).getByRole('link', { name: 'Loss cases' })).toBeTruthy();
    expect(within(nav).queryByRole('link', { name: 'Maintenance' })).toBeNull();
  });

  // W15 panel walk: at 1280 px the search box squeezed the organization to "TrekLink ..." and broke its
  // code over two lines. The workspace keeps its width from 1280 px; below, only the code shows.
  it('keeps the workspace whole from 1280 px and its code on one line', () => {
    show('/o/contracts');
    const workspace = screen.getByTitle('ACME Trek Co., Ltd.');
    expect(workspace.className).toContain('xl:shrink-0');
    expect(workspace.className).not.toContain('min-w-0');
    const [name, code] = Array.from(workspace.querySelectorAll('span:not(.sr-only)'));
    expect(name.className).toContain('xl:inline');
    expect(code?.className).toContain('whitespace-nowrap');
  });

  it('gives every page a breadcrumb from the navigation table', () => {
    show('/o/contracts/abc');
    const crumbs = screen.getAllByRole('navigation', { name: 'Breadcrumb' })[0];
    expect(crumbs.textContent).toContain('Business');
    expect(crumbs.textContent).toContain('Details');
  });

  it('puts the payment page under Business, Invoices, not under Operate, Overview', () => {
    show('/o/pay/p-1');
    const crumbs = screen.getAllByRole('navigation', { name: 'Breadcrumb' })[0];
    expect(crumbs.textContent).toContain('Business');
    const links = within(crumbs).getAllByRole('link', { name: 'Invoices' });
    expect(links.map((link) => link.getAttribute('href'))).toEqual(links.map(() => '/o/invoices'));
    expect(crumbs.textContent).toContain('Payment');
    expect(crumbs.textContent).not.toContain('Overview');
  });

  it('moves the breadcrumb into a sticky page header, once (leader rule of 2026-10-30)', () => {
    show(
      '/o/contracts/abc',
      <StickyPageHeader>
        <PageHeader title="Contract CT-1" />
      </StickyPageHeader>,
    );
    const crumbs = screen.getAllByRole('navigation', { name: 'Breadcrumb' });
    expect(crumbs).toHaveLength(1);
    expect(crumbs[0].closest('[data-compact]')).toBe(
      screen.getByRole('heading', { level: 1 }).closest('[data-compact]'),
    );
    expect(crumbs[0].textContent).toContain('Details');
  });

  it('turns the published header, command bar and action bar heights into scroll padding on the content area', () => {
    show('/o/contracts');
    const main = document.getElementById('main')!;
    expect(main.className).toContain(
      'scroll-pt-[calc(var(--tl-page-header-h,0px)+var(--tl-collection-bar-h,0px)+0.5rem)]',
    );
    expect(main.className).toContain('scroll-pb-[calc(var(--tl-page-actions-h,0px)+0.5rem)]');
  });

  it('shows no Info pane on map pages', () => {
    act(() =>
      useShell.setState({ info: { title: 'CT-1', body: <p>details</p> }, infoSheetOpen: true }),
    );
    show('/o/map');
    expect(screen.queryByText('details')).toBeNull();
  });

  it('opens the Info pane as a sheet below 1280 px only when asked', () => {
    act(() =>
      useShell.setState({ info: { title: 'CT-1', body: <p>details</p> }, infoSheetOpen: false }),
    );
    show('/o/contracts');
    expect(screen.queryByText('details')).toBeNull();
    act(() => useShell.setState({ infoSheetOpen: true }));
    expect(screen.getByRole('dialog', { name: 'CT-1' }).textContent).toContain('details');
  });
});

// Screen 7.5 and D-094: the Demo control entry shows for an Admin while the field simulation answers,
// even with the control panel off (the Vercel staging), and never asks a non-Admin.
describe('AppShell, Demo control entry', () => {
  const ADMIN: SessionUser = {
    id: 'a',
    email: 'admin@treklink.local',
    fullName: 'Demo Admin',
    accountType: 'TREKLINK',
    roles: ['ADMIN'],
    organization: null,
  };

  it('shows the entry while only the simulation answers', async () => {
    const { apiClient, ApiError } = await import('../../shared/api/apiClient');
    const api = vi.mocked(apiClient);
    api.mockImplementation((path: string) =>
      path === '/demo/simulation'
        ? Promise.resolve({
            databaseAllowed: true,
            trails: [],
            patterns: [],
            devices: [],
            nodes: [],
          })
        : path === '/demo/status'
          ? Promise.reject(new ApiError(404, 'NOT_FOUND', 'Cannot GET /api/demo/status'))
          : new Promise(() => undefined),
    );
    act(() =>
      useSession
        .getState()
        .signIn(
          {
            accessToken: 'a',
            accessTokenExpiresIn: 1,
            refreshToken: 'r',
            refreshTokenExpiresIn: 1,
          },
          ADMIN,
        ),
    );
    render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter initialEntries={['/t/accounts']}>
          <AppShell user={ADMIN} home="/t/accounts" banner={null}>
            <p>page body</p>
          </AppShell>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    const nav = screen.getByRole('navigation', { name: 'Modules' });
    expect(await within(nav).findByRole('link', { name: 'Demo control' })).toBeTruthy();
    api.mockImplementation(() => new Promise(() => undefined));
  });

  it('does not ask for the simulation for an organization member', async () => {
    const { apiClient } = await import('../../shared/api/apiClient');
    const api = vi.mocked(apiClient);
    api.mockClear();
    show('/o/contracts');
    expect(api.mock.calls.some(([path]) => path === '/demo/simulation')).toBe(false);
  });
});

// W15 panel walk: the Admin entry read "Prices and damage ra..."; a long label now wraps instead.
describe('SideNav, expanded', () => {
  it('lets a module label wrap rather than cut it with an ellipsis', () => {
    render(
      <MemoryRouter>
        <SideNav
          groups={[
            {
              id: 'admin',
              label: 'Administration',
              entries: [
                { route: '/t/admin/prices', label: 'Prices and damage rates', icon: Tag, roles: ['ADMIN'], built: true },
              ],
            },
          ]}
        />
      </MemoryRouter>,
    );
    const label = screen.getByText('Prices and damage rates');
    expect(label.className).not.toContain('truncate');
    expect(label.className).toContain('min-w-0');
  });
});
