import type { Connection, ConnectionState } from './ConnectorRegistry';

// The words of the device connector's rows (screen 4.6 States).

export const STATE_TEXT: Record<ConnectionState, string> = {
  reading: 'Reading the unit',
  'looking-up': 'Checking with the server',
  ready: 'Ready',
  'no-response': 'No response over USB',
  busy: 'In use by another tab or app',
  'not-checked': 'Not checked',
  failed: 'Not read',
  unplugged: 'Unplugged',
  'getting-key': 'Getting the key',
  writing: 'Writing settings',
  restarting: 'Restarting the unit',
  reconnect: 'Waiting for the unit to be reconnected',
  checking: 'Checking',
};

export const RETRYABLE: ConnectionState[] = ['no-response', 'busy', 'not-checked', 'failed'];

export const unitName = (connection: Connection): string =>
  connection.recognized?.device?.assetTag ?? `Unknown unit ${connection.unit?.nodeId ?? ''}`.trim();


// The upright product renders by convention (devices design section 12.12 Q5, decided A).
export const renderPath = (code: string, kind: 'detail' | 'icon') => `/variants/${code}-${kind}.png`;
