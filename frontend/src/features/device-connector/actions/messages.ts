import type { DockingFailure } from './DockingService';
import { NO_RESPONSE_TEXT } from '../model/ConnectorRegistry';

// The wording of screens 5.4 and 4.2 for a docking that did not succeed. Null means nothing to show
// (Staff closed the browser's port chooser).

// REQ-ERR-22 (formerly REQ-ERR-14), design section 8.6 decision 4: a unit that answers nothing over USB.
// The text names the firmware, not the variant (design section 11.4 rule 6).
export { NO_RESPONSE_TEXT as NO_RESPONSE_MESSAGE } from '../model/ConnectorRegistry';

export interface DockingFailureInfo {
  failure: DockingFailure | 'api';
  reason: string;
}

const clause = (reason: string) => {
  const trimmed = reason.trim().replace(/\.$/, '');
  return trimmed.charAt(0).toLowerCase() + trimmed.slice(1);
};

// Screen 5.4 step 1 (REQ-ERR-12, REQ-ERR-13).
export const handoverDockMessage = (
  { failure, reason }: DockingFailureInfo,
  assetTag: string,
): string | null => {
  switch (failure) {
    case 'cancelled':
      return null;
    case 'mismatch':
    case 'choose':
      return reason;
    case 'no-response':
      return NO_RESPONSE_TEXT;
    case 'api':
      return `${reason.replace(/\.?$/, '.')} Nothing was written.`;
    default:
      return `${reason} Dock ${assetTag} again before handover.`;
  }
};

// Screen 4.2, Read from unit on the Register panel.
export const intakeDockMessage = ({ failure, reason }: DockingFailureInfo): string | null => {
  if (failure === 'cancelled') return null;
  if (failure === 'choose') return reason;
  if (failure === 'no-response') return NO_RESPONSE_TEXT;
  return 'The unit did not answer. Check the cable, close other Meshtastic apps and try again.';
};

// Screen 4.2, Configure uplink (REQ-ERR-15).
export const uplinkDockMessage = (
  { failure, reason }: DockingFailureInfo,
  assetTag: string,
): string | null => {
  if (failure === 'cancelled') return null;
  if (failure === 'mismatch' || failure === 'choose') return reason;
  if (failure === 'no-response') {
    return `${assetTag} is not configured as an uplink: the unit answered nothing over USB.`;
  }
  return `${assetTag} is not configured as an uplink: ${clause(reason)}.`;
};
