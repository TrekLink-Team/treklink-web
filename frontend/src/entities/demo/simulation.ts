import { useQuery } from '@tanstack/react-query';
import { ApiError, apiClient } from '../../shared/api/apiClient';

// The field simulation of the demo panel as specs/demo api-design 06 to 10 return it (screen 7.5,
// section "Field simulation"; D-093 amendment, D-094). The backend serves these routes only while
// DEMO_SIMULATION_ENABLED is true, and only to a TrekLink Admin (`demo.simulate`).

export type SimulationPattern = 'WALK' | 'STOP' | 'STRAY' | 'SILENT' | 'LOW_BATTERY';
export type SimulationEventKind = 'SOS' | 'FALL' | 'SOS_CANCEL';

export const PATTERN_LABEL: Record<SimulationPattern, string> = {
  WALK: 'Walk',
  STOP: 'Stop',
  STRAY: 'Stray off the trail',
  SILENT: 'Silent',
  LOW_BATTERY: 'Low battery',
};

// How a node moves while its pattern walks (specs/demo/design.md §9.1, leader ruling 2026-11-06).
export type SimulationStyle =
  | 'JOGGER'
  | 'HIKER'
  | 'CAMPER'
  | 'EXPLORER'
  | 'TRAIL_WALKER'
  | 'WANDERER'
  | 'GROUP_FOLLOWER'
  | 'STRAGGLER';

export const STYLE_LABEL: Record<SimulationStyle, string> = {
  JOGGER: 'Jogger',
  HIKER: 'Hiker',
  CAMPER: 'Camper',
  EXPLORER: 'Explorer',
  TRAIL_WALKER: 'Trail walker',
  WANDERER: 'Wanderer',
  GROUP_FOLLOWER: 'Group follower',
  STRAGGLER: 'Straggler',
};

// A node started before the styles keeps the steady walk at its speed.
export const NO_STYLE_LABEL = 'Steady pace';

export interface SimulationOrganization {
  id: string;
  code: string;
  name: string;
}

export interface SimulationTrail {
  id: string;
  name: string;
  region: string;
  lengthMetres: number;
  pointCount: number;
  source: { osmWayIds: number[]; readOn: string; simplification: string };
}

export interface SimulatableDevice {
  id: string;
  assetTag: string;
  nodeId: string;
  status: string;
  organization: SimulationOrganization | null;
  runningNodeId: string | null;
}

export interface SimulatedNode {
  id: string;
  deviceId: string;
  assetTag: string | null;
  nodeId: string;
  organization: SimulationOrganization | null;
  trailId: string;
  pattern: SimulationPattern;
  style: SimulationStyle | null;
  speedMetresPerMinute: number;
  status: 'RUNNING' | 'STOPPED';
  sosKind: 'SOS' | 'FALL' | null;
  sosSince: string | null;
  position: { lat: number; lon: number };
  batteryPct: number;
  lastPacketAt: string | null;
  simulated: true;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface SimulationOverview {
  databaseAllowed: boolean;
  trails: SimulationTrail[];
  patterns: SimulationPattern[];
  styles: SimulationStyle[];
  devices: SimulatableDevice[];
  nodes: SimulatedNode[];
}

export const simulationKey = ['demo', 'simulation'] as const;

// Design §9: the panel polls every 15 s while open; on the Vercel staging each request may start a job
// tick, which keeps the simulator running during a demo.
export const SIMULATION_POLL_MS = 15_000;

// The simulation off (404) or a caller without `demo.simulate` (403) reads as "no section".
export const fetchSimulation = async (): Promise<SimulationOverview | null> => {
  try {
    return await apiClient<SimulationOverview>('/demo/simulation');
  } catch (error) {
    if (error instanceof ApiError && (error.statusCode === 404 || error.statusCode === 403))
      return null;
    throw error;
  }
};

// The panel polls; the navigation only asks whether the section exists (`poll` false).
export const useDemoSimulation = (enabled = true, poll = true) =>
  useQuery({
    queryKey: simulationKey,
    queryFn: fetchSimulation,
    enabled,
    retry: false,
    staleTime: poll ? 0 : 60_000,
    refetchInterval: poll ? SIMULATION_POLL_MS : false,
  });

export interface StartNodeBody {
  deviceId: string;
  trailId: string;
  pattern: SimulationPattern;
  // Without one, the backend picks the style of the device's asset tag.
  style?: SimulationStyle;
  speedMetresPerMinute?: number;
}

export const startSimulatedNode = (body: StartNodeBody) =>
  apiClient<SimulatedNode>('/demo/simulation/nodes', {
    method: 'POST',
    body: JSON.stringify(body),
  });

export const updateSimulatedNode = (
  node: Pick<SimulatedNode, 'id' | 'version'>,
  change: {
    pattern?: SimulationPattern;
    style?: SimulationStyle;
    trailId?: string;
    speedMetresPerMinute?: number;
  },
) =>
  apiClient<SimulatedNode>(`/demo/simulation/nodes/${encodeURIComponent(node.id)}`, {
    method: 'PATCH',
    body: JSON.stringify({ expectedVersion: node.version, ...change }),
  });

export const stopSimulatedNode = (node: Pick<SimulatedNode, 'id' | 'version'>) =>
  apiClient<SimulatedNode>(`/demo/simulation/nodes/${encodeURIComponent(node.id)}/stop`, {
    method: 'POST',
    body: JSON.stringify({ expectedVersion: node.version }),
  });

export const raiseSimulatedEvent = (node: Pick<SimulatedNode, 'id'>, kind: SimulationEventKind) =>
  apiClient<{ node: SimulatedNode; fieldEventId: string | null }>(
    `/demo/simulation/nodes/${encodeURIComponent(node.id)}/events`,
    { method: 'POST', body: JSON.stringify({ kind }) },
  );
