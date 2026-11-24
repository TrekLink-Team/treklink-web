// The action catalogue of the demo panel (specs/demo/requirements.md REQ-PNL-07, design §11, D-110 rule 3).
// `needs` names the body fields an action requires; the page renders one button per action.

export const PANEL_ACTIONS = [
  'incident-sos',
  'incident-acknowledge',
  'incident-respond',
  'incident-resolve',
  'incident-false-alarm',
  'incident-close',
  'contract-create',
  'contract-approve',
  'contract-handover',
  'contract-return',
  'contract-close',
  'contract-cancel',
  'invoice-pay',
  'device-maintenance-open',
  'device-maintenance-complete',
] as const;

export type PanelAction = (typeof PANEL_ACTIONS)[number];

export type PanelField = 'recordId' | 'expectedVersion' | 'deviceId';

export interface PanelActionView {
  id: PanelAction;
  group: 'Incidents' | 'Contracts' | 'Billing' | 'Devices';
  label: string;
  needs: PanelField[];
}

const RECORD: PanelField[] = ['recordId', 'expectedVersion'];

export const PANEL_ACTION_VIEWS: readonly PanelActionView[] = [
  { id: 'incident-sos', group: 'Incidents', label: 'Send SOS', needs: ['deviceId'] },
  { id: 'incident-acknowledge', group: 'Incidents', label: 'Acknowledge', needs: RECORD },
  { id: 'incident-respond', group: 'Incidents', label: 'Response under way', needs: RECORD },
  { id: 'incident-resolve', group: 'Incidents', label: 'Resolve', needs: RECORD },
  { id: 'incident-false-alarm', group: 'Incidents', label: 'False alarm', needs: RECORD },
  { id: 'incident-close', group: 'Incidents', label: 'Close (demo time)', needs: RECORD },
  { id: 'contract-create', group: 'Contracts', label: 'Request a contract', needs: [] },
  { id: 'contract-approve', group: 'Contracts', label: 'Approve', needs: RECORD },
  { id: 'contract-handover', group: 'Contracts', label: 'Hand over', needs: RECORD },
  { id: 'contract-return', group: 'Contracts', label: 'Return all units', needs: RECORD },
  { id: 'contract-close', group: 'Contracts', label: 'Close', needs: RECORD },
  { id: 'contract-cancel', group: 'Contracts', label: 'Cancel stale request', needs: RECORD },
  { id: 'invoice-pay', group: 'Billing', label: 'Pay at the counter', needs: ['recordId'] },
  {
    id: 'device-maintenance-open',
    group: 'Devices',
    label: 'Send to maintenance',
    needs: ['deviceId', 'expectedVersion'],
  },
  {
    id: 'device-maintenance-complete',
    group: 'Devices',
    label: 'Complete maintenance',
    needs: ['deviceId'],
  },
];
