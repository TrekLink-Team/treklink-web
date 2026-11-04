import { fromBinary, type DescMessage } from '@bufbuild/protobuf';
import { Protobuf, Utils } from '@meshtastic/core';
import { recordedReads } from '../../test/support/serial-stream';
import { PriorityTier } from '../config';
import { tierOf } from './simulator';
import { nodeIdOf, toStockPacket, type MeshPacketLike } from './stock-packet';

const MESH = Protobuf.Mesh as unknown as Record<string, DescMessage>;
const STATION = 0xde000009;

// The recorded stream through core's serial framing (0x94 0xC3, 16-bit length, FromRadio), as the
// reader receives it: the packets in order, the debug log as text.
const decodeStream = async () => {
  const framing = Utils.fromDeviceStream();
  const writer = framing.writable.getWriter();
  const reads = recordedReads();
  void (async () => {
    for (const read of reads) await writer.write(read);
    await writer.close();
  })();
  const packets: MeshPacketLike[] = [];
  const debug: string[] = [];
  const reader = framing.readable.getReader();
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    if (value.type === 'debug') debug.push(value.data);
    else if (value.type === 'packet') {
      const message = fromBinary(MESH.FromRadioSchema, value.data) as unknown as {
        payloadVariant: { case: string; value: unknown };
      };
      if (message.payloadVariant.case === 'packet') packets.push(message.payloadVariant.value as MeshPacketLike);
    }
  }
  return { packets, debug };
};

describe('toStockPacket on the recorded serial stream (design §3.1, AC-09)', () => {
  it('reads the frames, a frame split across two reads included, and keeps the debug log apart', async () => {
    const { packets, debug } = await decodeStream();
    expect(packets.map((packet) => packet.id)).toEqual([1001, 1002, 1003, 1004, 1005, 1006, 1007]);
    expect(debug.join('')).toContain('Boot complete');
  });

  it('writes the stock JSON shape with the station node as sender, member by member', async () => {
    const { packets } = await decodeStream();
    const stock = packets.map((packet) => toStockPacket(packet, STATION));
    const link = { rssi: -97, snr: 6.25, hops_away: 1, hop_start: 3 };
    const common = { timestamp: 1762230000, to: 0xffffffff, from: 0xde00000a, channel: 0, sender: '!de000009' };
    expect(stock[1]).toEqual({
      kind: 'packet',
      packet: {
        id: 1002,
        ...common,
        type: 'position',
        payload: { latitude_i: 115544000, longitude_i: 1085381000, altitude: 1320, time: 1762229999 },
        ...link,
      },
    });
    expect(stock[2]).toEqual({
      kind: 'packet',
      packet: {
        id: 1003,
        ...common,
        type: 'telemetry',
        payload: {
          battery_level: 87,
          voltage: expect.closeTo(4.02, 5),
          channel_utilization: 3.5,
          air_util_tx: expect.closeTo(0.8, 5),
          uptime_seconds: 3600,
        },
        ...link,
      },
    });
    expect(stock[3]).toEqual({
      kind: 'packet',
      packet: { id: 1004, ...common, type: 'text', payload: { text: 'SOS - [11.554400], [108.538100]' }, ...link },
    });
    // No hop start and no link quality: those members are left out, as the serializer leaves them out.
    expect(stock[4]).toEqual({
      kind: 'packet',
      packet: { id: 1005, ...common, type: 'text', payload: { text: 'Reached the ridge' } },
    });
  });

  it('queues the SOS first, the position at P2, telemetry and chat at P3', async () => {
    const { packets } = await decodeStream();
    const tiers = packets
      .map((packet) => toStockPacket(packet, STATION))
      .flatMap((result) => (result.kind === 'packet' ? [tierOf(result.packet)] : []));
    expect(tiers).toEqual([
      PriorityTier.P2_GPS,
      PriorityTier.P3_TELEMETRY,
      PriorityTier.P0_SOS,
      PriorityTier.P3_TELEMETRY,
    ]);
  });

  it('skips node info, an encrypted packet and a position without a fix, with the reason (REQ-ERR-08)', async () => {
    const { packets } = await decodeStream();
    const reasons = packets
      .map((packet) => toStockPacket(packet, STATION))
      .flatMap((result) => (result.kind === 'skipped' ? [result.reason] : []));
    expect(reasons).toEqual([
      `port number ${(Protobuf.Portnums.PortNum as Record<string, number>).NODEINFO_APP}`,
      'encrypted packet',
      'position without coordinates',
    ]);
  });

  it('skips a payload that does not decode, and telemetry without device metrics', () => {
    const base: MeshPacketLike = {
      id: 1, from: 2, to: 3, channel: 0, rxTime: 0, rxSnr: 0, rxRssi: 0, hopLimit: 0, hopStart: 0,
      payloadVariant: { case: 'decoded', value: { portnum: 3, payload: new Uint8Array([0xff, 0xff, 0xff]) } },
    };
    expect(toStockPacket(base, STATION)).toMatchObject({ kind: 'skipped', reason: expect.stringMatching(/^undecodable payload/) });
    const environment = new Uint8Array([0x1a, 0x00]); // Telemetry.environment_metrics, empty
    expect(
      toStockPacket({ ...base, payloadVariant: { case: 'decoded', value: { portnum: 67, payload: environment } } }, STATION),
    ).toEqual({ kind: 'skipped', reason: 'telemetry without device metrics' });
  });

  it('names a node with eight lower-case hex digits', () => {
    expect(nodeIdOf(0xde00000a)).toBe('!de00000a');
    expect(nodeIdOf(0x1f)).toBe('!0000001f');
    expect(nodeIdOf(0xffffffff)).toBe('!ffffffff');
  });
});
