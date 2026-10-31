import { HttpStatus } from '@nestjs/common';
import { IngressPath, SyncOutcome } from '@prisma/client';
import { ErrorCode } from '../../common/errors';
import { DevicesService } from '../devices';
import {
  AUDIT_PAGE_BOUNDS,
  excerptOf,
  RAW_EXCERPT_MAX_CHARS,
  SyncAuditService,
} from './sync-audit.service';
import { SyncAuditRow, SyncQueryRepository } from './sync-query.repository';

const at = new Date('2026-11-01T03:15:00.000Z');

const row = (overrides: Partial<SyncAuditRow> = {}): SyncAuditRow => ({
  id: 'sa-1',
  eventId: '5d41',
  nodeNum: 3724541961n,
  deviceId: 'dev-1',
  uplinkKey: '!de000009',
  ingress: IngressPath.MQTT_NODE,
  outcome: SyncOutcome.DUPLICATE_REJECTED,
  detail: null,
  rawMessage: { type: 'position' },
  createdAt: at,
  ...overrides,
});

describe('excerptOf', () => {
  it('answers the raw text of a malformed message, whole when short', () => {
    expect(
      excerptOf({ outcome: SyncOutcome.MALFORMED_ENVELOPE, rawMessage: 'not json {' }),
    ).toEqual({ rawExcerpt: 'not json {', rawTruncated: false });
  });

  it('serializes a JSON raw message and truncates it at the bound', () => {
    const long = { text: 'x'.repeat(RAW_EXCERPT_MAX_CHARS * 2) };
    const result = excerptOf({ outcome: SyncOutcome.MALFORMED_ENVELOPE, rawMessage: long });
    expect(result.rawTruncated).toBe(true);
    expect(result.rawExcerpt).toHaveLength(RAW_EXCERPT_MAX_CHARS);
    expect(result.rawExcerpt).toBe(JSON.stringify(long).slice(0, RAW_EXCERPT_MAX_CHARS));
  });

  it('keeps a text of exactly the bound whole', () => {
    const text = 'y'.repeat(RAW_EXCERPT_MAX_CHARS);
    expect(excerptOf({ outcome: SyncOutcome.MALFORMED_ENVELOPE, rawMessage: text })).toEqual({
      rawExcerpt: text,
      rawTruncated: false,
    });
  });

  it('cuts by code points, so a character outside the BMP is never split', () => {
    // 'a' then 600 emoji: 1 + 1200 UTF-16 units, 601 code points.
    const text = `a${'\u{1F600}'.repeat(600)}`;
    const result = excerptOf({ outcome: SyncOutcome.MALFORMED_ENVELOPE, rawMessage: text });

    expect(result.rawTruncated).toBe(true);
    expect([...(result.rawExcerpt ?? '')]).toHaveLength(RAW_EXCERPT_MAX_CHARS);
    expect(result.rawExcerpt).toBe(`a${'\u{1F600}'.repeat(RAW_EXCERPT_MAX_CHARS - 1)}`);
    expect(result.rawExcerpt).not.toMatch(/[\uD800-\uDBFF]$/);
  });

  it('keeps whole a text of the bound in code points but longer in UTF-16 units', () => {
    const text = '\u{1F600}'.repeat(RAW_EXCERPT_MAX_CHARS);
    expect(excerptOf({ outcome: SyncOutcome.MALFORMED_ENVELOPE, rawMessage: text })).toEqual({
      rawExcerpt: text,
      rawTruncated: false,
    });
  });

  it('answers no raw payload for any other outcome, nor for a malformed row without one', () => {
    for (const outcome of Object.values(SyncOutcome).filter(
      (value) => value !== SyncOutcome.MALFORMED_ENVELOPE,
    )) {
      expect(excerptOf({ outcome, rawMessage: { type: 'text' } })).toEqual({
        rawExcerpt: null,
        rawTruncated: false,
      });
    }
    expect(excerptOf({ outcome: SyncOutcome.MALFORMED_ENVELOPE, rawMessage: null })).toEqual({
      rawExcerpt: null,
      rawTruncated: false,
    });
  });
});

describe('SyncAuditService.listAudit (api-design 04)', () => {
  let repository: { pageAudit: jest.Mock };
  let devices: { assetTags: jest.Mock };
  let service: SyncAuditService;

  beforeEach(() => {
    repository = { pageAudit: jest.fn().mockResolvedValue([[], 0]) };
    devices = { assetTags: jest.fn().mockResolvedValue(new Map([['dev-1', 'TL-0009']])) };
    service = new SyncAuditService(
      repository as unknown as SyncQueryRepository,
      devices as unknown as DevicesService,
    );
  });

  it('pages with the default size and no filter', async () => {
    await expect(service.listAudit({ op: 'listAudit' })).resolves.toEqual({
      items: [],
      pageNumber: 1,
      pageSize: AUDIT_PAGE_BOUNDS.defaultPageSize,
      totalCount: 0,
      totalPages: 0,
    });
    expect(repository.pageAudit).toHaveBeenCalledWith({}, 0, AUDIT_PAGE_BOUNDS.defaultPageSize);
  });

  it('filters by outcome, device, uplink and time, and skips to the page', async () => {
    const from = new Date('2026-11-01T02:00:00Z');
    const to = new Date('2026-11-01T03:00:00Z');
    await service.listAudit({
      op: 'listAudit',
      outcome: [SyncOutcome.MALFORMED_ENVELOPE, SyncOutcome.NORMALIZATION_FAILED],
      deviceId: 'dev-1',
      uplinkKey: '!de000009',
      from,
      to,
      pageNumber: 3,
      pageSize: 20,
    });
    expect(repository.pageAudit).toHaveBeenCalledWith(
      {
        outcome: { in: [SyncOutcome.MALFORMED_ENVELOPE, SyncOutcome.NORMALIZATION_FAILED] },
        deviceId: 'dev-1',
        uplinkKey: '!de000009',
        createdAt: { gte: from, lte: to },
      },
      40,
      20,
    );
  });

  it('answers rows with the asset tag, the node number as a number and the raw excerpt', async () => {
    repository.pageAudit.mockResolvedValue([
      [
        row(),
        row({
          id: 'sa-2',
          eventId: null,
          nodeNum: null,
          deviceId: null,
          outcome: SyncOutcome.MALFORMED_ENVELOPE,
          detail: 'message is not JSON',
          rawMessage: 'not json {',
        }),
      ],
      2,
    ]);
    const page = await service.listAudit({ op: 'listAudit', pageSize: 20 });

    expect(devices.assetTags).toHaveBeenCalledWith(['dev-1']);
    expect(page).toMatchObject({ pageSize: 20, totalCount: 2, totalPages: 1 });
    expect(page.items[0]).toEqual({
      id: 'sa-1',
      eventId: '5d41',
      nodeNum: 3724541961,
      deviceId: 'dev-1',
      assetTag: 'TL-0009',
      uplinkKey: '!de000009',
      ingress: IngressPath.MQTT_NODE,
      outcome: SyncOutcome.DUPLICATE_REJECTED,
      detail: null,
      rawExcerpt: null,
      rawTruncated: false,
      createdAt: at,
    });
    expect(page.items[1]).toMatchObject({
      nodeNum: null,
      deviceId: null,
      assetTag: null,
      rawExcerpt: 'not json {',
      rawTruncated: false,
    });
    expect(page.items[1]).not.toHaveProperty('rawMessage');
  });

  it('answers 400 VALIDATION_FAILED for a page size above the bound', async () => {
    await expect(
      service.listAudit({ op: 'listAudit', pageSize: AUDIT_PAGE_BOUNDS.maxPageSize + 1 }),
    ).rejects.toMatchObject({
      httpStatus: HttpStatus.BAD_REQUEST,
      errorCode: ErrorCode.VALIDATION_FAILED,
    });
    expect(repository.pageAudit).not.toHaveBeenCalled();
  });
});
