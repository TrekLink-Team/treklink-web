import { nodeIdOf } from './demo-sos-packet';

// Compiled copy of the position fixture shape (backend/test/fixtures/mqtt/position.json), sent from a given
// node at a given point, for the MF-02 playback of the demo panel (specs/demo/design.md §11, D-110). Kept
// in src so the build carries no test file, as demo-sos-packet.ts does for the SOS fixture.
export const nodePositionUplink = (
  nodeNum: number,
  now: Date,
  packetId: number,
  point: { lat: number; lon: number },
) => {
  const sender = nodeIdOf(nodeNum);
  const seconds = Math.floor(now.getTime() / 1000);
  return {
    topic: `treklink/2/json/LongFast/${sender}`,
    body: Buffer.from(
      JSON.stringify({
        id: packetId,
        timestamp: seconds,
        to: 4294967295,
        from: nodeNum,
        channel: 0,
        type: 'position',
        sender,
        payload: {
          time: seconds - 1,
          latitude_i: Math.round(point.lat * 1e7),
          longitude_i: Math.round(point.lon * 1e7),
          altitude: 1320,
        },
        rssi: -97,
        snr: 6.25,
        hops_away: 0,
        hop_start: 3,
      }),
    ),
  };
};
