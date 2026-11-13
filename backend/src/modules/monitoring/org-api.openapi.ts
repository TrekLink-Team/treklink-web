import { ApiResponse } from '@nestjs/swagger';
import type { SchemaObject } from '@nestjs/swagger/dist/interfaces/open-api-spec.interface';

// OpenAPI description of the organization API (api-design 04 and 05, UC-39). The two routes of
// `OrgApiController` are the only public surface of the backend, so they alone carry these
// annotations; there is no global swagger plugin. `npm run openapi:export` writes the public file
// `developer-docs/openapi/organization-api.json` from them, and CI fails when that file is stale.

export const ORG_API_TAG = 'Organization API';
export const API_KEY_SCHEME = 'apiKey';
export const API_KEY_HEADER_NAME = 'X-Api-Key';

export const ORG_API_DESCRIPTION =
  'Read-only access to the devices an organization holds and to the stream of events about them. ' +
  'Every request carries an organization API key in the X-Api-Key header. An access token is refused.';

// Every endpoint answers inside the envelope of D-002.
const envelope = (result: SchemaObject, example: unknown): SchemaObject => ({
  type: 'object',
  required: ['result', 'isSuccess', 'statusCode', 'message'],
  properties: {
    result,
    isSuccess: { type: 'boolean' },
    statusCode: { type: 'integer' },
    message: { type: 'string' },
  },
  example,
});

const nullable = (schema: SchemaObject): SchemaObject => ({ ...schema, nullable: true });

const position: SchemaObject = {
  type: 'object',
  required: ['lat', 'lon', 'at'],
  properties: {
    lat: { type: 'number', format: 'double', example: 11.5601 },
    lon: { type: 'number', format: 'double', example: 108.5402 },
    at: {
      type: 'string',
      format: 'date-time',
      description: 'Time of the reading that carried the position.',
    },
  },
};

const device: SchemaObject = {
  type: 'object',
  required: [
    'id',
    'assetTag',
    'hardwareVariant',
    'holder',
    'position',
    'group',
    'batteryPct',
    'lastSeenAt',
    'stale',
    'openIncident',
    'contractCode',
    'simulated',
    'state',
  ],
  properties: {
    id: { type: 'string', format: 'uuid' },
    assetTag: { type: 'string', example: 'TL-0042' },
    hardwareVariant: { type: 'string', example: 'treklink-v3' },
    holder: nullable({
      type: 'object',
      description: 'The holder label set at handover, or null when none is set.',
      required: ['name'],
      properties: { name: { type: 'string' } },
    }),
    position: nullable({
      ...position,
      description: 'Last position inside your custody interval, or null.',
    }),
    group: nullable({
      type: 'object',
      required: ['id', 'name', 'parentId'],
      properties: {
        id: { type: 'string' },
        name: { type: 'string' },
        parentId: nullable({ type: 'string' }),
      },
    }),
    batteryPct: nullable({ type: 'integer', minimum: 0, maximum: 100 }),
    lastSeenAt: nullable({ type: 'string', format: 'date-time' }),
    stale: { type: 'boolean', description: 'True for the OFFLINE state only.' },
    openIncident: nullable({
      type: 'object',
      description: 'Shown only when the incident is routed to your organization.',
      required: ['id', 'code', 'state'],
      properties: {
        id: { type: 'string', format: 'uuid' },
        code: { type: 'string' },
        state: { type: 'string' },
      },
    }),
    contractCode: { type: 'string', example: 'RC-2026-0042' },
    simulated: {
      type: 'boolean',
      description: 'The latest field event inside your custody interval is simulated.',
    },
    state: {
      type: 'string',
      enum: ['LIVE', 'OFFLINE', 'NOT_HEARD'],
      description:
        'LIVE: heard since the handover and within the stale limit. OFFLINE: heard since the ' +
        'handover, silent longer. NOT_HEARD: nothing heard since the handover.',
    },
  },
};

const streamEntry: SchemaObject = {
  type: 'object',
  required: ['seq', 'type', 'deviceId', 'payload', 'createdAt'],
  properties: {
    seq: {
      type: 'integer',
      description: 'Position of the entry in the stream. Use it as the cursor.',
    },
    type: {
      type: 'string',
      description:
        'Kind of entry, for example device.position, device.telemetry, incident.changed, ' +
        'device.label, device.groupChanged, device.handedOver, device.released, device.stale ' +
        'or station.stale.',
      example: 'device.position',
    },
    deviceId: nullable({ type: 'string', format: 'uuid' }),
    payload: { type: 'object', additionalProperties: true, description: 'Fields depend on type.' },
    createdAt: { type: 'string', format: 'date-time' },
  },
};

export const DEVICES_OK = envelope(
  {
    type: 'object',
    required: ['cursor', 'devices'],
    properties: {
      cursor: {
        type: 'integer',
        description: 'Newest stream position at the time of the read. Stream from here.',
      },
      devices: { type: 'array', items: device },
    },
  },
  {
    result: {
      cursor: 88213,
      devices: [
        {
          id: '0d3f6a2b-7e11-4c55-8f0a-2b1c9e7d4a10',
          assetTag: 'TL-0042',
          hardwareVariant: 'treklink-v3',
          holder: { name: 'Le Thi E' },
          position: { lat: 11.5601, lon: 108.5402, at: '2026-10-20T03:15:00.000Z' },
          group: { id: 'g-2', name: 'Team A', parentId: 'g-1' },
          batteryPct: 81,
          lastSeenAt: '2026-10-20T03:15:00.000Z',
          stale: false,
          openIncident: null,
          contractCode: 'RC-2026-0042',
          simulated: false,
          state: 'LIVE',
        },
        {
          id: '6a0e4c1f-2b8d-4e37-9a51-7c3f0d2e8b14',
          assetTag: 'TL-0043',
          hardwareVariant: 'treklink-v3',
          holder: null,
          position: null,
          group: { id: 'g-2', name: 'Team A', parentId: 'g-1' },
          batteryPct: null,
          lastSeenAt: null,
          stale: false,
          openIncident: null,
          contractCode: 'RC-2026-0042',
          simulated: false,
          state: 'NOT_HEARD',
        },
      ],
    },
    isSuccess: true,
    statusCode: 200,
    message: 'OK',
  },
);

export const STREAM_OK = envelope(
  {
    type: 'object',
    required: ['entries', 'nextCursor', 'hasMore'],
    properties: {
      entries: { type: 'array', items: streamEntry },
      nextCursor: {
        type: 'integer',
        description: 'Cursor for the next request: the seq of the last entry, or after when empty.',
      },
      hasMore: { type: 'boolean', description: 'True when more entries wait after nextCursor.' },
    },
  },
  {
    result: {
      entries: [
        {
          seq: 88214,
          type: 'device.position',
          deviceId: '0d3f6a2b-7e11-4c55-8f0a-2b1c9e7d4a10',
          payload: { lat: 11.5603, lon: 108.5405, at: '2026-10-20T03:15:00.000Z' },
          createdAt: '2026-10-20T03:15:00.000Z',
        },
        {
          seq: 88215,
          type: 'incident.changed',
          deviceId: '0d3f6a2b-7e11-4c55-8f0a-2b1c9e7d4a10',
          payload: {
            incidentId: '7a6b5c4d-3e2f-4a1b-8c9d-0e1f2a3b4c5d',
            state: 'NOTIFY_PRIMARY',
          },
          createdAt: '2026-10-20T03:15:00.000Z',
        },
      ],
      nextCursor: 88215,
      hasMore: false,
    },
    isSuccess: true,
    statusCode: 200,
    message: 'OK',
  },
);

// An error answers with the same envelope: `result.errorCode` names the failure (D-026).
const errorEnvelope = (status: number, errorCode: string, message: string): SchemaObject =>
  envelope(
    {
      type: 'object',
      required: ['errorCode'],
      properties: { errorCode: { type: 'string', enum: [errorCode] } },
    },
    { result: { errorCode }, isSuccess: false, statusCode: status, message },
  );

// One documented error response with its envelope example.
export const ApiEnvelopeError = (
  status: number,
  description: string,
  errorCode: string,
  message: string,
): MethodDecorator & ClassDecorator =>
  ApiResponse({ status, description, schema: errorEnvelope(status, errorCode, message) });

export const UNAUTHENTICATED_MESSAGE = 'Authentication required.';
export const FORBIDDEN_MESSAGE = 'You do not have access to this.';
export const RATE_LIMITED_MESSAGE = 'Too many requests. Try again in a minute.';
export const CURSOR_EXPIRED_MESSAGE =
  'The cursor is too old. Read the devices again and stream from the new cursor.';
