// @vitest-environment jsdom
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Parameter } from '../entities/parameter/api';
import { ApiError } from '../shared/api/apiClient';
import { useToast } from '../shared/ui';
import { ParametersPage } from './ParametersPage';

const ACK = 'incidents.primaryAckTimeoutSeconds';
const LENGTHS = 'rentals.dayPlanLengths';
const GRACE = 'rentals.returnGraceHours';

const updateParameter = vi.fn();
const refetch = vi.fn();
let state: { data?: { items: Parameter[] }; isPending: boolean; error: unknown } = {
  isPending: true,
  error: null,
};

vi.mock('../entities/parameter/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../entities/parameter/api')>()),
  useParameters: () => ({ ...state, refetch }),
  updateParameter: (...args: unknown[]) => updateParameter(...args),
}));

vi.mock('../widgets/ParameterHistory/ParameterHistoryDrawer', () => ({
  ParameterHistoryDrawer: ({ parameterKey, onClose }: { parameterKey: string; onClose: () => void }) => (
    <div role="dialog" aria-label="History">
      {parameterKey}
      <button type="button" onClick={onClose}>
        Close history
      </button>
    </div>
  ),
}));

const parameter = (overrides: Partial<Parameter>): Parameter => ({
  key: ACK,
  value: 120,
  valueType: 'DURATION_SECONDS',
  bounds: { min: 30, max: 900 },
  unit: 'seconds',
  ownerModule: 'incidents',
  description: 'How long the primary has to acknowledge',
  version: 3,
  updatedAt: '2026-10-20T03:15:00.000Z',
  ...overrides,
});

const items = (): Parameter[] => [
  parameter({}),
  parameter({
    key: LENGTHS,
    value: [3, 4, 7],
    valueType: 'JSON',
    bounds: null,
    unit: null,
    ownerModule: 'rentals',
    description: 'Day plan lengths',
    version: 1,
  }),
  parameter({
    key: GRACE,
    value: 2,
    valueType: 'INT',
    bounds: { min: 0, max: 72 },
    unit: 'hours',
    ownerModule: 'rentals',
    description: 'Grace before a late fee',
    version: 5,
  }),
];

const Probe: React.FC = () => <p data-testid="search">{useLocation().search}</p>;

let client: QueryClient;
const renderPage = (search = '') =>
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[`/t/admin/parameters${search}`]}>
        <ParametersPage />
        <Probe />
      </MemoryRouter>
    </QueryClientProvider>,
  );

const edit = (key: string) => fireEvent.click(screen.getByRole('button', { name: `Edit ${key}` }));
const valueField = (key: string) => screen.getByLabelText(`Value of ${key}`) as HTMLInputElement;

beforeEach(() => {
  client = new QueryClient();
  vi.spyOn(client, 'invalidateQueries').mockResolvedValue(undefined);
  state = { data: { items: items() }, isPending: false, error: null };
});

afterEach(() => {
  cleanup();
  updateParameter.mockReset();
  refetch.mockReset();
  useToast.setState({ message: null });
  vi.restoreAllMocks();
});

describe('ParametersPage (screen 7.4, parameters)', () => {
  it('groups the parameters by module with value, unit, range, type and last change', () => {
    renderPage();
    const headings = screen.getAllByRole('heading', { level: 2 }).map((heading) => heading.textContent);
    expect(headings[0]).toContain('incidents');
    expect(headings[1]).toContain('rentals');
    expect(screen.getByText('120')).toBeTruthy();
    expect(screen.getByText('seconds')).toBeTruthy();
    expect(screen.getByText('30 to 900')).toBeTruthy();
    expect(screen.getByText('Seconds')).toBeTruthy();
    expect(screen.getByText('[3,4,7]')).toBeTruthy();
    expect(screen.getByRole('table', { name: 'Parameters of rentals' })).toBeTruthy();
  });

  it('collapses and opens a module group', () => {
    renderPage();
    const toggle = screen.getByRole('button', { name: /^rentals/ });
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('table', { name: 'Parameters of rentals' })).toBeNull();
  });

  it('filters by module and keeps the filter in the URL', () => {
    renderPage();
    fireEvent.change(screen.getByLabelText('Module'), { target: { value: 'rentals' } });
    expect(screen.getByTestId('search').textContent).toBe('?module=rentals');
    expect(screen.queryByRole('table', { name: 'Parameters of incidents' })).toBeNull();
    expect(screen.getByRole('table', { name: 'Parameters of rentals' })).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Module'), { target: { value: '' } });
    expect(screen.getByTestId('search').textContent).toBe('');
  });

  it('reads the module filter from the URL', () => {
    renderPage('?module=incidents');
    expect((screen.getByLabelText('Module') as HTMLSelectElement).value).toBe('incidents');
    expect(screen.queryByRole('table', { name: 'Parameters of rentals' })).toBeNull();
  });

  it('links each row to its history and to the change log filtered to it', () => {
    renderPage();
    expect(screen.getByRole('link', { name: `Changes of ${ACK}` }).getAttribute('href')).toBe(
      `/t/admin/audit/changes?action=parameter.&subjectId=${ACK}`,
    );
    fireEvent.click(screen.getByRole('button', { name: `History of ${ACK}` }));
    expect(screen.getByRole('dialog', { name: 'History' }).textContent).toContain(ACK);
    fireEvent.click(screen.getByRole('button', { name: 'Close history' }));
    expect(screen.queryByRole('dialog', { name: 'History' })).toBeNull();
  });

  describe('editing', () => {
    it('opens an input with the current value and the allowed range always visible', () => {
      renderPage();
      edit(ACK);
      expect(valueField(ACK).value).toBe('120');
      expect(screen.getByText('Allowed: 30 to 900 seconds')).toBeTruthy();
      expect(screen.getByText('Current value: 120')).toBeTruthy();
      expect(screen.getByRole('button', { name: `Edit ${GRACE}` }).hasAttribute('disabled')).toBe(true);
    });

    it('blocks a value outside the range with MSG02 and sends nothing', () => {
      renderPage();
      edit(ACK);
      fireEvent.change(valueField(ACK), { target: { value: '5' } });
      fireEvent.click(screen.getByRole('button', { name: 'Save' }));
      expect(screen.getByText(`${ACK} must be between 30 and 900.`)).toBeTruthy();
      expect(updateParameter).not.toHaveBeenCalled();
      expect(valueField(ACK).value).toBe('5');
    });

    it('says when the value is unchanged and sends nothing', () => {
      renderPage();
      edit(ACK);
      fireEvent.click(screen.getByRole('button', { name: 'Save' }));
      expect(screen.getByText('The value is unchanged.')).toBeTruthy();
      expect(updateParameter).not.toHaveBeenCalled();
    });

    it('asks "Change {key} from {old} to {new}?" and saves with the loaded version and the reason', async () => {
      updateParameter.mockResolvedValue(parameter({ value: 90, version: 4 }));
      renderPage();
      edit(ACK);
      fireEvent.change(valueField(ACK), { target: { value: '90' } });
      expect(screen.getByText(`Change ${ACK} from 120 to 90?`)).toBeTruthy();
      fireEvent.change(screen.getByLabelText(`Reason for changing ${ACK} (optional)`), {
        target: { value: ' Faster demo ' },
      });
      fireEvent.click(screen.getByRole('button', { name: 'Save' }));
      await waitFor(() =>
        expect(updateParameter).toHaveBeenCalledWith(ACK, {
          value: 90,
          expectedVersion: 3,
          reason: 'Faster demo',
        }),
      );
      await waitFor(() => expect(useToast.getState().message).toContain('Parameter updated'));
      await waitFor(() => expect(screen.queryByRole('button', { name: 'Save' })).toBeNull());
      expect(client.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['parameters'] });
      expect(client.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['parameter-history', ACK] });
      await waitFor(() => expect(document.activeElement?.id).toBe(`edit-${ACK.replace(/\./g, '-')}`));
    });

    it('sends no reason when it is blank', async () => {
      updateParameter.mockResolvedValue(parameter({}));
      renderPage();
      edit(GRACE);
      fireEvent.change(valueField(GRACE), { target: { value: '3' } });
      fireEvent.click(screen.getByRole('button', { name: 'Save' }));
      await waitFor(() =>
        expect(updateParameter).toHaveBeenCalledWith(GRACE, {
          value: 3,
          expectedVersion: 5,
          reason: undefined,
        }),
      );
    });

    it('shows the server message under the input and keeps what was typed', async () => {
      updateParameter.mockRejectedValue(
        new ApiError(400, 'PARAMETER_OUT_OF_RANGE', 'value must be between 30 and 900.'),
      );
      renderPage();
      edit(ACK);
      fireEvent.change(valueField(ACK), { target: { value: '90' } });
      fireEvent.click(screen.getByRole('button', { name: 'Save' }));
      expect(await screen.findByText('value must be between 30 and 900.')).toBeTruthy();
      expect(valueField(ACK).value).toBe('90');
    });

    it('shows MSG36 for a stale version, keeps the typed value and reloads on request', async () => {
      updateParameter.mockRejectedValue(new ApiError(409, 'STALE_VERSION', 'Stale.'));
      renderPage();
      edit(ACK);
      fireEvent.change(valueField(ACK), { target: { value: '90' } });
      fireEvent.click(screen.getByRole('button', { name: 'Save' }));
      const dialog = await screen.findByRole('dialog', { name: 'Reload to see the latest' });
      expect(dialog.textContent).toContain('Someone else changed this. Reload to see the latest.');
      expect(valueField(ACK).value).toBe('90');
      fireEvent.click(screen.getByRole('button', { name: 'Reload' }));
      expect(client.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['parameters'] });
      expect(screen.queryByRole('dialog', { name: 'Reload to see the latest' })).toBeNull();
      expect(valueField(ACK).value).toBe('90');
    });

    it('closes the editor with a toast and reloads when the parameter is gone', async () => {
      updateParameter.mockRejectedValue(new ApiError(404, 'NOT_FOUND', 'Parameter not found.'));
      renderPage();
      edit(ACK);
      fireEvent.change(valueField(ACK), { target: { value: '90' } });
      fireEvent.click(screen.getByRole('button', { name: 'Save' }));
      await waitFor(() => expect(useToast.getState().message).toBe('Parameter not found.'));
      expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
      expect(client.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['parameters'] });
    });

    it('cancels with the button or Escape and returns focus to Edit', () => {
      renderPage();
      edit(ACK);
      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
      expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
      edit(ACK);
      fireEvent.keyDown(valueField(ACK), { key: 'Escape' });
      expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
      expect(document.activeElement?.id).toBe(`edit-${ACK.replace(/\./g, '-')}`);
    });

    it('edits a JSON parameter in a text area, refuses text that is not JSON and sends the parsed value', async () => {
      updateParameter.mockResolvedValue(parameter({}));
      renderPage();
      edit(LENGTHS);
      expect(valueField(LENGTHS).tagName).toBe('TEXTAREA');
      expect(valueField(LENGTHS).value).toBe('[\n  3,\n  4,\n  7\n]');
      fireEvent.change(valueField(LENGTHS), { target: { value: '[3, 4,' } });
      fireEvent.click(screen.getByRole('button', { name: 'Save' }));
      expect(screen.getByText(`${LENGTHS} must be valid JSON.`)).toBeTruthy();
      expect(updateParameter).not.toHaveBeenCalled();
      fireEvent.change(valueField(LENGTHS), { target: { value: '[3, 5]' } });
      fireEvent.click(screen.getByRole('button', { name: 'Save' }));
      await waitFor(() =>
        expect(updateParameter).toHaveBeenCalledWith(LENGTHS, {
          value: [3, 5],
          expectedVersion: 1,
          reason: undefined,
        }),
      );
    });
  });

  it('shows a skeleton while loading', () => {
    state = { isPending: true, error: null };
    renderPage();
    expect(screen.getByRole('status', { name: 'Loading parameters' })).toBeTruthy();
  });

  it('shows the server message with Retry for an error', () => {
    state = { isPending: false, error: new ApiError(500, 'INTERNAL_ERROR', 'Parameters are unavailable.') };
    renderPage();
    expect(screen.getByText('Parameters are unavailable.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(refetch).toHaveBeenCalled();
  });

  it('shows MSG26 alone for a refused role', () => {
    state = { isPending: false, error: new ApiError(403, 'FORBIDDEN', 'No.') };
    renderPage();
    expect(screen.getByRole('alert').textContent).toBe('You do not have access to this.');
    expect(screen.queryByLabelText('Module')).toBeNull();
  });
});
