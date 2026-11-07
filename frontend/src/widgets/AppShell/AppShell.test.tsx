// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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
import { useConnectorStore } from '../../features/device-connector';
import { useTheme } from '../../shared/lib/theme';

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

const show = (
  path: string,
  page: React.ReactNode = <p>page body</p>,
  user: SessionUser = MANAGER,
) => {
  act(() =>
    useSession
      .getState()
      .signIn(
        { accessToken: 'a', accessTokenExpiresIn: 1, refreshToken: 'r', refreshTokenExpiresIn: 1 },
        user,
      ),
  );
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={[path]}>
        <AppShell
          user={user}
          home={user.accountType === 'TREKLINK' ? '/t/fleet' : '/o/contracts'}
          banner={<div role="alert">SOS banner</div>}
        >
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

  it('shows no device connector to an organization account (devices REQ-UBI-07, AC-28)', () => {
    show('/o/contracts');
    expect(screen.queryByRole('button', { name: /^Devices, / })).toBeNull();
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

  it('renders the TrekLink mark as a theme-coloured mask in the header', () => {
    show('/o/contracts');
    const header = screen.getByRole('banner');
    const marks = within(header).getAllByRole('img', { name: 'TrekLink' });

    expect(marks).toHaveLength(2);
    marks.forEach((mark) => {
      expect(mark.className).toContain('bg-brand');
      expect(mark.className).toContain('h-[18px]');
      expect(mark.className).toContain('w-[47px]');
      expect(mark.style.maskImage).toContain('/brand/treklink-mark.webp');
    });
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

  // Review of treklink-web#385: a tall list on a map page grew this wrapper, so `main` scrolled and the
  // map legend dropped below the fold. A full-bleed page must let the wrapper shrink to `main`.
  it('lets the wrapper of a full-bleed page shrink to the content area, and no other page', () => {
    // The plain class, not the fit-page variant `has-[[data-fit-page]]:min-h-0` every page carries
    // (ui standard §7, W24b).
    show('/o/map');
    expect(document.getElementById('main')!.firstElementChild!.classList.contains('min-h-0')).toBe(
      true,
    );
    cleanup();
    show('/o/contracts');
    expect(document.getElementById('main')!.firstElementChild!.classList.contains('min-h-0')).toBe(
      false,
    );
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
// The header below 640 px and at 400 % zoom (design-system §5, W41): Go to page, Devices and the theme switch move
// into one More menu; jsdom applies no CSS, so the tests check the breakpoint classes and the menu's items.
describe('AppShell header, the More menu below 640 px (and below 1024 px for TrekLink accounts)', () => {
  const STAFF: SessionUser = {
    id: 's',
    email: 'staff@treklink.local',
    fullName: 'Demo Staff',
    accountType: 'TREKLINK',
    roles: ['STAFF'],
    organization: null,
  };
  const wrapper = (element: HTMLElement) =>
    element.closest('span.inline-flex, button') as HTMLElement;

  afterEach(() => act(() => useConnectorStore.setState({ open: false })));

  it('collapses Go to page, Devices and the theme switch into More on a phone, and keeps them from 640 px', () => {
    const { container } = show('/t/fleet', <p>page body</p>, STAFF);
    const header = container.querySelector('header') as HTMLElement;
    // A TrekLink account keeps the More menu up to 1023 px (W41b): its Devices button does not fit from 640 to 816 px.
    const more = within(header).getByRole('button', { name: 'More header actions' });
    expect(wrapper(more).parentElement?.className).toContain('lg:hidden');
    expect(within(header).queryByRole('button', { name: 'Go to page' })).toBeNull();
    expect(
      within(header).getByRole('button', { name: /^Devices, 0 connected/ }).className,
    ).toContain('hidden lg:flex');
    expect(
      within(header).getByRole('button', { name: /^Switch to (dark|light) theme$/ }).className,
    ).toContain('hidden lg:inline-flex');
    // The account menu drops its chevron below 640 px; the environment badge keeps its text.
    expect(within(header).getByRole('button', { name: /account menu$/ }).className).toContain(
      '[&_[data-menu-chevron]]:hidden',
    );
    expect(within(header).getByText('Sandbox')).toBeTruthy();

    fireEvent.click(more);
    expect(screen.getAllByRole('menuitem').map((item) => item.textContent)).toEqual([
      'Go to page',
      'Devices, 0 connected',
      useTheme.getState().resolved === 'dark' ? 'Switch to light theme' : 'Switch to dark theme',
    ]);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Devices, 0 connected' }));
    expect(useConnectorStore.getState().open).toBe(true);
  });

  it('runs Go to page and the theme switch from the More menu', () => {
    show('/t/fleet', <p>page body</p>, STAFF);
    fireEvent.click(screen.getByRole('button', { name: 'More header actions' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Go to page' }));
    expect(useShell.getState().quickNavOpen).toBe(true);
    act(() => useShell.setState({ quickNavOpen: false }));

    const before = useTheme.getState().resolved;
    fireEvent.click(screen.getByRole('button', { name: 'More header actions' }));
    fireEvent.click(screen.getByRole('menuitem', { name: /^Switch to (dark|light) theme$/ }));
    expect(useTheme.getState().resolved).not.toBe(before);
    act(() => useTheme.getState().toggle());
  });

  it('holds no Devices item for an organization account and keeps its More menu below 640 px only', () => {
    const { container } = show('/o/contracts');
    const header = container.querySelector('header') as HTMLElement;
    expect(
      wrapper(within(header).getByRole('button', { name: 'More header actions' })).parentElement
        ?.className,
    ).toContain('sm:hidden');
    expect(within(header).getByRole('button', { name: 'Go to page' }).className).toContain(
      'hidden sm:inline-flex lg:hidden',
    );
    expect(
      within(header).getByRole('button', { name: /^Switch to (dark|light) theme$/ }).className,
    ).toContain('hidden sm:inline-flex');
    fireEvent.click(screen.getByRole('button', { name: 'More header actions' }));
    expect(screen.getAllByRole('menuitem').map((item) => item.textContent)).toEqual([
      'Go to page',
      useTheme.getState().resolved === 'dark' ? 'Switch to light theme' : 'Switch to dark theme',
    ]);
  });
});

describe('AppShell, Demo control entry', () => {
  const ADMIN: SessionUser = {
    id: 'a',
    email: 'admin@treklink.local',
    fullName: 'Demo Admin',
    accountType: 'TREKLINK',
    roles: ['ADMIN'],
    organization: null,
  };

  it('hides the entry when the control status is off despite a simulation response', async () => {
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
      useSession.getState().signIn(
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
    await waitFor(() =>
      expect(api.mock.calls.some(([path]) => path === '/demo/status')).toBe(true),
    );
    expect(within(nav).queryByRole('link', { name: 'Demo control' })).toBeNull();
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
                {
                  route: '/t/admin/prices',
                  label: 'Prices and damage rates',
                  icon: Tag,
                  roles: ['ADMIN'],
                  built: true,
                },
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
