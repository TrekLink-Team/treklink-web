import { IncidentState } from '@prisma/client';
import { INCIDENT_STATE_LABEL } from './incident-state-labels';

describe('INCIDENT_STATE_LABEL (monitoring api-design 07)', () => {
  it('has a readable label for every incident state, never the enum name', () => {
    for (const state of Object.values(IncidentState)) {
      const label = INCIDENT_STATE_LABEL[state];
      expect(label).toBeTruthy();
      expect(label).not.toBe(state);
      expect(label).not.toMatch(/_|^[A-Z]+$/);
    }
  });

  it('reads the states of the Unrouted and Responding paths as the staff pages do', () => {
    expect(INCIDENT_STATE_LABEL.UNROUTED).toBe('Unrouted');
    expect(INCIDENT_STATE_LABEL.NOTIFY_PRIMARY).toBe('Notifying primary');
    expect(INCIDENT_STATE_LABEL.REPORTED).toBe('Reported to authority');
    expect(INCIDENT_STATE_LABEL.FALSE_ALARM).toBe('False alarm');
  });
});
