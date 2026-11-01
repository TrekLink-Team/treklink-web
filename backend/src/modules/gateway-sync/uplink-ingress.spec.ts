import { NodeJsonAdapter } from './adapters/node-json.adapter';
import { IngestionService } from './ingestion.service';
import { UplinkIngress } from './uplink-ingress';

describe('UplinkIngress', () => {
  const at = new Date('2026-11-01T03:00:00.000Z');
  const build = (result: unknown) => {
    const adapter = { adapt: jest.fn().mockReturnValue(result) };
    const ingestion = { ingest: jest.fn(), rejectMalformed: jest.fn() };
    const ingress = new UplinkIngress(
      adapter as unknown as NodeJsonAdapter,
      ingestion as unknown as IngestionService,
    );
    return { ingress, adapter, ingestion };
  };

  it('adapts the message as the subscriber does and ingests the envelope', async () => {
    const envelope = { eventId: 'e1' };
    const { ingress, adapter, ingestion } = build({ kind: 'envelope', envelope });
    const body = Buffer.from('{}');
    await expect(ingress.ingest('treklink/2/json/LongFast/!de00000a', body, at)).resolves.toBe(
      'ingested',
    );
    expect(adapter.adapt).toHaveBeenCalledWith('treklink/2/json/LongFast/!de00000a', body, at);
    expect(ingestion.ingest).toHaveBeenCalledWith(envelope);
  });

  it('records a malformed message and ignores an unrelated topic', async () => {
    const malformed = build({
      kind: 'malformed',
      ingress: 'NODE_UPLINK',
      uplinkKey: 'k',
      detail: 'bad',
      raw: '{',
    });
    await expect(malformed.ingress.ingest('t', Buffer.from('{'), at)).resolves.toBe('malformed');
    expect(malformed.ingestion.rejectMalformed).toHaveBeenCalledWith(
      'NODE_UPLINK',
      'k',
      'bad',
      '{',
    );
    const ignored = build({ kind: 'ignored' });
    await expect(ignored.ingress.ingest('t', Buffer.from(''), at)).resolves.toBe('ignored');
    expect(ignored.ingestion.ingest).not.toHaveBeenCalled();
  });
});
