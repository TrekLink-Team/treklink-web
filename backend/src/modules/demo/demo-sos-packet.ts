// W43: compiled copy of the SOS fixture shape, verified against test/fixtures/mqtt/sos.json.
// Serverless bundles do not need to ship a runtime test directory.
export const quickSosUplink = (now: Date, packetId: number) => ({
  topic: 'treklink/2/json/LongFast/!de00000a',
  body: Buffer.from(
    JSON.stringify({
      id: packetId,
      timestamp: Math.floor(now.getTime() / 1000),
      to: 4294967295,
      from: 3724541962,
      channel: 0,
      type: 'text',
      sender: '!de00000a',
      payload: { text: 'SOS - [11.561000], [108.552000]' },
      rssi: -97,
      snr: 6.25,
      hops_away: 0,
      hop_start: 3,
    }),
  ),
});
