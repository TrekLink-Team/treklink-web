// @vitest-environment jsdom
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../shared/api/apiClient';
import { useToast } from '../shared/ui';
import { VariantsPage } from './VariantsPage';

const api = vi.fn();
vi.mock('../shared/api/apiClient', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../shared/api/apiClient')>()),
  apiClient: (...args: unknown[]) => api(...args),
}));

const variant = (overrides: Record<string, unknown> = {}) => ({
  id: 'v-3',
  code: 'treklink-v3',
  name: 'TrekLink v3 (GPS, SOS button)',
  hasGps: true,
  hasMotionSensor: false,
  mqttCapable: true,
  firmwareBaseline: '2.7.19-treklink.3',
  remainingValueSchedule: [
    { fromMonths: 0, valueVnd: 2500000 },
    { fromMonths: 12, valueVnd: 1800000 },
  ],
  serviceIntervalDays: 180,
  serviceChecklist: ['Battery health'],
  imageUrl: '/variants/treklink-v3-detail.png',
  specSheet: { mcu: 'ESP32' },
  isActive: true,
  deviceCount: 18,
  version: 3,
  ...overrides,
});

const unused = variant({ id: 'v-9', code: 'treklink-v9', name: 'Spare model', deviceCount: 0, version: 0 });

const serve = (items: unknown[], respond: (endpoint: string, options: RequestInit) => unknown = () => null) =>
  api.mockImplementation((endpoint: string, options?: RequestInit) =>
    options?.method ? Promise.resolve().then(() => respond(endpoint, options)) : Promise.resolve(items),
  );

const writes = () => api.mock.calls.filter((call) => (call[1] as RequestInit | undefined)?.method);
const bodyOf = (index: number) =>
  JSON.parse(String((writes()[index][1] as RequestInit).body)) as Record<string, unknown>;

const renderPage = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={['/t/admin/variants']}>
        <VariantsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );

const inTable = () => within(screen.getByRole('table', { name: 'Hardware variants' }));
const loaded = async () => within(await screen.findByRole('table', { name: 'Hardware variants' }));

beforeEach(() => {
  api.mockReset();
  useToast.getState().dismiss();
});
afterEach(cleanup);

describe('VariantsPage (screen 4.1)', () => {
  it('lists every variant, inactive ones included, with units, status and capabilities as text', async () => {
    serve([variant(), unused, variant({ id: 'v-1', code: 'treklink-v1', isActive: false })]);
    renderPage();
    expect(await (await loaded()).findByText('treklink-v3')).toBeTruthy();
    expect(api).toHaveBeenCalledWith('/hardware-variants?includeInactive=true');
    expect(inTable().getAllByText('18 units').length).toBeGreaterThan(0);
    expect(inTable().getByText('Inactive')).toBeTruthy();
    expect(inTable().getAllByText('GPS, MQTT').length).toBeGreaterThan(0);
  });

  it('offers Delete only for a variant without units', async () => {
    serve([variant(), unused]);
    renderPage();
    await (await loaded()).findByText('treklink-v9');
    expect(inTable().queryByRole('button', { name: 'Delete treklink-v3' })).toBeNull();
    expect(inTable().getByRole('button', { name: 'Delete treklink-v9' })).toBeTruthy();
  });

  it('shows the empty state with the New variant button', async () => {
    serve([]);
    renderPage();
    expect(await screen.findByText('No hardware variants yet.')).toBeTruthy();
    expect(screen.getAllByRole('button', { name: 'New variant' }).length).toBe(2);
  });

  it('shows MSG26 when the caller may not read the catalog', async () => {
    api.mockRejectedValue(new ApiError(403, 'FORBIDDEN', 'You do not have access to this.'));
    renderPage();
    expect(await screen.findByText('You do not have access to this.')).toBeTruthy();
  });

  it('creates a variant with the schedule, the checklist and the spec sheet', async () => {
    serve([variant()], () => unused);
    renderPage();
    await (await loaded()).findByText('treklink-v3');
    fireEvent.click(screen.getByRole('button', { name: 'New variant' }));
    const dialog = within(await screen.findByRole('dialog', { name: 'New hardware variant' }));
    fireEvent.change(dialog.getByLabelText(/^Code/), { target: { value: 'treklink-v9' } });
    fireEvent.change(dialog.getByLabelText(/^Name/), { target: { value: 'Spare model' } });
    fireEvent.change(dialog.getByLabelText(/^Firmware baseline/), { target: { value: '2.7.19-treklink.9' } });
    fireEvent.change(dialog.getByLabelText(/^Service interval/), { target: { value: '90' } });
    fireEvent.change(dialog.getByLabelText('Checklist item 1'), { target: { value: 'Battery health' } });
    fireEvent.change(dialog.getByLabelText('Value, VND'), { target: { value: '2,000,000' } });
    fireEvent.change(dialog.getByLabelText('MCU'), { target: { value: ' ESP32-S3 ' } });
    fireEvent.click(dialog.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0][0]).toBe('/hardware-variants');
    expect(bodyOf(0)).toMatchObject({
      code: 'treklink-v9',
      serviceIntervalDays: 90,
      serviceChecklist: ['Battery health'],
      remainingValueSchedule: [{ fromMonths: 0, valueVnd: 2000000 }],
      specSheet: { mcu: 'ESP32-S3' },
      imageUrl: null,
    });
    await waitFor(() => expect(useToast.getState().message).toBe('Saved.'));
  });

  it('refuses a service interval without a checklist item before any request', async () => {
    serve([variant()]);
    renderPage();
    await (await loaded()).findByText('treklink-v3');
    fireEvent.click(screen.getByRole('button', { name: 'New variant' }));
    const dialog = within(await screen.findByRole('dialog', { name: 'New hardware variant' }));
    fireEvent.change(dialog.getByLabelText(/^Code/), { target: { value: 'treklink-v9' } });
    fireEvent.change(dialog.getByLabelText(/^Name/), { target: { value: 'Spare' } });
    fireEvent.change(dialog.getByLabelText(/^Firmware baseline/), { target: { value: 'x' } });
    fireEvent.change(dialog.getByLabelText(/^Service interval/), { target: { value: '90' } });
    fireEvent.change(dialog.getByLabelText('Value, VND'), { target: { value: '100' } });
    fireEvent.click(dialog.getByRole('button', { name: 'Save' }));
    expect(await dialog.findByText('A service interval needs at least one checklist item.')).toBeTruthy();
    expect(writes()).toHaveLength(0);
  });

  it('edits with the version read, keeps the sensor flags fixed while units exist, and shows a code error under its field', async () => {
    serve([variant()], () => {
      throw new ApiError(400, 'VARIANT_MEDIA_INVALID', 'Use an https link or /variants/<file>.');
    });
    renderPage();
    fireEvent.click(await (await loaded()).findByRole('button', { name: 'Edit treklink-v3' }));
    const dialog = within(await screen.findByRole('dialog', { name: 'Edit treklink-v3' }));
    expect(dialog.getByText('Fixed while units are registered')).toBeTruthy();
    expect(dialog.queryByLabelText('GPS')).toBeNull();
    fireEvent.change(dialog.getByLabelText(/^Image link/), { target: { value: 'http://a/b.png' } });
    fireEvent.click(dialog.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0][0]).toBe('/hardware-variants/v-3');
    const body = bodyOf(0);
    expect(body.expectedVersion).toBe(3);
    expect(body).not.toHaveProperty('hasGps');
    const field = await dialog.findByLabelText(/^Image link/);
    expect(field.getAttribute('aria-invalid')).toBe('true');
  });

  it('reloads the list when the form closes after STALE_VERSION, so the next edit sends the new version', async () => {
    let current = variant();
    let attempt = 0;
    serve([], () => {
      attempt += 1;
      if (attempt === 1) {
        // Someone else saved meanwhile: the server is at version 4 now.
        current = variant({ version: 4 });
        throw new ApiError(409, 'STALE_VERSION', 'Someone else changed this.');
      }
      return current;
    });
    // The list read answers whatever the server holds at the time.
    const write = api.getMockImplementation()!;
    api.mockImplementation((endpoint: string, options?: RequestInit) =>
      options?.method ? write(endpoint, options) : Promise.resolve([current]),
    );
    renderPage();
    fireEvent.click(await (await loaded()).findByRole('button', { name: 'Edit treklink-v3' }));
    let dialog = within(await screen.findByRole('dialog', { name: 'Edit treklink-v3' }));
    fireEvent.click(dialog.getByRole('button', { name: 'Save' }));
    expect(await dialog.findByText('Someone else changed this. Close this form to load the current values.')).toBeTruthy();
    fireEvent.click(dialog.getByRole('button', { name: 'Cancel' }));

    // Edit opens on the row the refetch brought, once it is in.
    await waitFor(() =>
      expect(api.mock.calls.filter(([endpoint, options]) => !options && endpoint.includes('hardware-variants')).length).toBe(2),
    );
    fireEvent.click(await inTable().findByRole('button', { name: 'Edit treklink-v3' }));
    dialog = within(await screen.findByRole('dialog', { name: 'Edit treklink-v3' }));
    fireEvent.click(dialog.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(writes()).toHaveLength(2));
    expect(bodyOf(0).expectedVersion).toBe(3);
    expect(bodyOf(1).expectedVersion).toBe(4);
    await waitFor(() => expect(useToast.getState().message).toBe('Saved.'));
  });

  it('deactivates after the confirmation with the version read', async () => {
    serve([variant()], () => variant({ isActive: false, version: 4 }));
    renderPage();
    fireEvent.click(await (await loaded()).findByRole('button', { name: 'Deactivate treklink-v3' }));
    const confirm = within(await screen.findByRole('dialog', { name: 'Deactivate treklink-v3?' }));
    expect(
      confirm.getByText(
        'Deactivated variants cannot be requested by organizations. Units already registered keep working.',
      ),
    ).toBeTruthy();
    fireEvent.click(confirm.getByRole('button', { name: 'Deactivate' }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(bodyOf(0)).toEqual({ isActive: false, expectedVersion: 3 });
  });

  it('deletes an unused variant after a dialog naming its code', async () => {
    serve([unused], () => null);
    renderPage();
    fireEvent.click(await (await loaded()).findByRole('button', { name: 'Delete treklink-v9' }));
    const confirm = within(await screen.findByRole('alertdialog', { name: 'Delete treklink-v9?' }));
    fireEvent.click(confirm.getByRole('button', { name: 'Delete variant' }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]).toEqual(['/hardware-variants/v-9', { method: 'DELETE' }]);
    await waitFor(() => expect(useToast.getState().message).toBe('Saved.'));
  });
});
