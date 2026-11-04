// Builds `node-stream.hex`, the byte stream a node on USB writes after a client asks for its
// configuration (gateway-sync design §3.1, AC-09). Run from gateway/:
//   npx ts-node -P test/tsconfig.json --transpile-only test/fixtures/serial/generate.ts
// The frames are encoded from the protobuf schemas of @meshtastic/core 2.6.7, not captured from a radio:
// captures from the bench units (a v1 and a v2 on USB, task 5.1) replace them. Each line of the file is
// one read off the port, as hex; a line starting with # describes the read below it.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { create as createMessage, toBinary, type DescMessage } from '@bufbuild/protobuf';
import { Protobuf } from '@meshtastic/core';

const MESH = Protobuf.Mesh as unknown as Record<string, DescMessage>;
const TELEMETRY = Protobuf.Telemetry as unknown as Record<string, DescMessage>;
// The schemas come from core, whose declarations name their types from a package it does not install.
const create = (schema: DescMessage, init: object) => createMessage(schema, init as never);
const PORT = Protobuf.Portnums.PortNum as Record<string, number>;

// TL-0009 is the station's node, TL-0010 the node it hears (seed-demo.ts node numbers).
export const STATION = 0xde000009;
export const HEARD = 0xde00000a;
const RX_TIME = 1762230000;

const frame = (fromRadio: object): Buffer => {
  const body = toBinary(MESH.FromRadioSchema, create(MESH.FromRadioSchema, fromRadio));
  return Buffer.concat([Buffer.from([0x94, 0xc3, body.length >> 8, body.length & 0xff]), body]);
};

const packet = (id: number, from: number, portnum: number, payload: Uint8Array, extra: object = {}) =>
  frame({
    id,
    payloadVariant: {
      case: 'packet',
      value: create(MESH.MeshPacketSchema, {
        id,
        from,
        to: 0xffffffff,
        channel: 0,
        rxTime: RX_TIME,
        rxSnr: 6.25,
        rxRssi: -97,
        hopLimit: 2,
        hopStart: 3,
        payloadVariant: { case: 'decoded', value: create(MESH.DataSchema, { portnum, payload }) },
        ...extra,
      }),
    },
  });

const text = (value: string) => new TextEncoder().encode(value);
const position = (fields: object) => toBinary(MESH.PositionSchema, create(MESH.PositionSchema, fields));
const deviceMetrics = (fields: object) =>
  toBinary(
    TELEMETRY.TelemetrySchema,
    create(TELEMETRY.TelemetrySchema, {
      time: RX_TIME,
      variant: { case: 'deviceMetrics', value: create(TELEMETRY.DeviceMetricsSchema, fields) },
    }),
  );

const sos = packet(1004, HEARD, PORT.TEXT_MESSAGE_APP, text('SOS - [11.554400], [108.538100]'));

const reads: [string, Buffer][] = [
  ['debug log line before the API starts', Buffer.from('INFO  | 00:00:12 12 [Router] Boot complete\r\n')],
  ['FromRadio my_info: the station node is !de000009', frame({ id: 1, payloadVariant: { case: 'myInfo', value: create(MESH.MyNodeInfoSchema, { myNodeNum: STATION }) } })],
  ['node info packet from !de00000a (NODEINFO_APP): skipped', packet(1001, HEARD, PORT.NODEINFO_APP, toBinary(MESH.UserSchema, create(MESH.UserSchema, { id: '!de00000a', longName: 'TL-0010' })))],
  ['position from !de00000a', packet(1002, HEARD, PORT.POSITION_APP, position({ latitudeI: 115544000, longitudeI: 1085381000, altitude: 1320, time: RX_TIME - 1 }))],
  ['device metrics telemetry from !de00000a', packet(1003, HEARD, PORT.TELEMETRY_APP, deviceMetrics({ batteryLevel: 87, voltage: 4.02, channelUtilization: 3.5, airUtilTx: 0.8, uptimeSeconds: 3600 }))],
  ['SOS text from !de00000a, first 9 bytes of its frame', sos.subarray(0, 9)],
  ['the rest of the SOS frame, then a debug log line', Buffer.concat([sos.subarray(9), Buffer.from('DEBUG | 00:00:13 13 [Router] Enqueued local\r\n')])],
  ['chat text from !de00000a, no hop start, no link quality', packet(1005, HEARD, PORT.TEXT_MESSAGE_APP, text('Reached the ridge'), { hopStart: 0, hopLimit: 0, rxSnr: 0, rxRssi: 0 })],
  ['encrypted packet from !de00000a (no channel key on the node): skipped', frame({ id: 1006, payloadVariant: { case: 'packet', value: create(MESH.MeshPacketSchema, { id: 1006, from: HEARD, to: 0xffffffff, payloadVariant: { case: 'encrypted', value: new Uint8Array([1, 2, 3, 4]) } }) } })],
  ['position without a fix from the station node: skipped', packet(1007, STATION, PORT.POSITION_APP, position({ time: RX_TIME }))],
];

if (require.main === module) {
  const lines = reads.flatMap(([note, bytes]) => [`# ${note}`, bytes.toString('hex')]);
  writeFileSync(join(__dirname, 'node-stream.hex'), `${lines.join('\n')}\n`);
}
