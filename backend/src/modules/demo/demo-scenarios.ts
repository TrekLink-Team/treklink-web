// The scenarios of specs/demo/design.md §5 (D-088). Each first step names the window, the role and the
// first clicks, from docs/demo/2026-11-01-demo-script.md.

export const SCENARIO_IDS = [
  'clean',
  'org-pending-approval',
  'contract-ready-for-handover',
  'sos-open',
  'term-ended',
  'asset-maintenance',
  'loss-cases',
] as const;

export type ScenarioId = (typeof SCENARIO_IDS)[number];

export interface Scenario {
  id: ScenarioId;
  title: string;
  flow: string;
  summary: string;
  available: boolean;
  unavailableReason: string | null;
  firstSteps: string[];
}

export const SCENARIOS: readonly Scenario[] = [
  {
    id: 'clean',
    title: 'Clean demo seed',
    flow: 'MF-01a to MF-04',
    summary:
      'The demo seed only: ORG-0001, RC-2026-0001 to RC-2026-0003, the unrouted TL-0001 incident. ORG-0002 and RC-2026-0004 are next.',
    available: true,
    unavailableReason: null,
    firstSteps: [
      'Window E, not signed in: Plans page, Register your organization; it becomes ORG-0002.',
      'Window A, Manager (manager@treklink.local): Overview, Request a contract, Monthly, TrekLink v3, quantity 5, start today; it becomes RC-2026-0004.',
      'Window C, Operator (operator@treklink.local): Live map shows TL-0009 and TL-0010 once the gateway runs.',
    ],
  },
  {
    id: 'org-pending-approval',
    title: 'Organization awaiting approval',
    flow: 'MF-01a',
    summary:
      'ORG-0002, Phan Dung Trekking Co., Ltd., registered and PENDING, ready for counter verification and approval.',
    available: true,
    unavailableReason: null,
    firstSteps: [
      'Window B, Staff (staff@treklink.local): Organizations, tab Pending, row ORG-0002.',
      'Counter verification: In person, tick Business registration and Manager ID card, contract MC-2026-0002, tick both terms, Record verification.',
      'Window D, Admin (admin@treklink.local): Organizations, tab Pending, ORG-0002, Approve.',
    ],
  },
  {
    id: 'contract-ready-for-handover',
    title: 'Contract ready for handover',
    flow: 'MF-01',
    summary:
      'RC-2026-0004 requested by the Manager for five treklink-v3 units from today, approved by Staff, holding fee paid.',
    available: true,
    unavailableReason: null,
    firstSteps: [
      'Window B, Staff (staff@treklink.local): open the RC-2026-0004 counter link above, or Contracts, RC-2026-0004, Open the contract, Open the counter.',
      'Step 1 Devices: Select all units, Battery 90, GPS fix, Set readings for selected, then Record provisioning for selected, Next.',
      'Step 2 Payment reads the first payment recorded; Next to Preview note, then Sign as Demo Manager and Complete handover.',
    ],
  },
  {
    id: 'sos-open',
    title: 'SOS open on TL-0010',
    flow: 'MF-03',
    summary:
      'An SOS from TL-0010 (Pham Van F) on RC-2026-0001, ingested as the replay sends it; the incident is routed to the Operator.',
    available: true,
    unavailableReason: null,
    firstSteps: [
      'Window C, Operator (operator@treklink.local): the red banner "SOS: TL-0010 (Pham Van F)", Acknowledge.',
      'Incidents, the open incident: Response under way, then Add status.',
      'Report outcome, Resolve incident.',
    ],
  },
  {
    id: 'term-ended',
    title: 'Term ended, return due',
    flow: 'MF-05',
    summary:
      'Notice given on RC-2026-0002 and its term moved to the last rollover cutoff: RC-2026-0002 is RETURN_DUE at the counter.',
    available: true,
    unavailableReason: null,
    firstSteps: [
      'Window B, Staff (staff@treklink.local): open the RC-2026-0002 counter link above, or Contracts, tab All, RC-2026-0002, Open the counter.',
      'Check-in: type TL-0017, Add, type TL-0018, Add, Check in 2 devices.',
      'Reset and inspection: Record reset on each row; Inspect TL-0017 Passed, TL-0018 Damaged (Casing cracked).',
    ],
  },
  {
    id: 'asset-maintenance',
    title: 'Asset maintenance',
    flow: 'Assets',
    summary: 'TL-0007 in MAINTENANCE with an open record, and TL-0002 due for service tomorrow.',
    available: true,
    unavailableReason: null,
    firstSteps: [
      'Window B, Staff (staff@treklink.local): Devices, chip Maintenance, TL-0007 with its open record.',
      'Maintenance, row TL-0007, Complete: Status Completed, a resolution, Save; then Record intake check on TL-0007.',
      'Devices, TL-0002: Service due tomorrow.',
    ],
  },
  {
    id: 'loss-cases',
    title: 'Loss cases',
    flow: 'MF-05',
    summary: 'A device reported lost on a running contract, for the loss case walk.',
    available: false,
    unavailableReason: 'Needs the loss cases change (treklink-web#228).',
    firstSteps: [],
  },
];

export const scenarioOf = (id: string): Scenario | undefined =>
  SCENARIOS.find((scenario) => scenario.id === id);

// The registration of the org-pending-approval scenario: the demo script's MF-01a data (§2a step 2).
export const DEMO_REGISTRATION = {
  legalName: 'Phan Dung Trekking Co., Ltd.',
  taxCode: '0312345678',
  address: '12 Nguyen Hue, District 1, Ho Chi Minh City',
  contactPhone: '028 3822 0000',
  managerFullName: 'Tran Van Binh',
  managerEmail: 'binh.manager@example.com',
  managerPhone: '0903 000 002',
};

export const SEEDED_EMAILS = {
  ADMIN: 'admin@treklink.local',
  STAFF: 'staff@treklink.local',
  ORG_MANAGER: 'manager@treklink.local',
  ORG_OPERATOR: 'operator@treklink.local',
} as const;

export type SeededRole = keyof typeof SEEDED_EMAILS;
export const SEEDED_ROLES = Object.keys(SEEDED_EMAILS) as SeededRole[];
