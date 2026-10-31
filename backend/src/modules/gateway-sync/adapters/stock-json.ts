import { INGESTED_TYPES, IngestedType, StockPacket } from '../canonical-envelope';

const UINT32_MAX = 0xffffffff;
const isUint32 = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= UINT32_MAX;
export const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export type StockDecode =
  | { kind: 'packet'; packet: StockPacket; message: Record<string, unknown> }
  | { kind: 'malformed'; detail: string; raw: unknown }
  | { kind: 'ignored'; reason: string };

// The stock Meshtastic JSON publish shared by the node and the Field Station topics
// (mqtt-ingress-contract.md, Message; MeshPacketSerializer.cpp:440-454). Envelope validation only;
// payloads are the strategies' job.
export const decodeStock = (body: Buffer): StockDecode => {
  const malformed = (detail: string, raw: unknown): StockDecode => ({
    kind: 'malformed',
    detail,
    raw,
  });

  const text = body.toString('utf8');
  let message: unknown;
  try {
    message = JSON.parse(text);
  } catch {
    return malformed('message is not JSON', text);
  }
  if (!isObject(message)) return malformed('message is not a JSON object', message);

  // Any type ingestion does not read, including the empty type of an unlisted PortNum, is ignored
  // without an audit row (contract, Message table).
  const type = message.type;
  if (typeof type !== 'string') return malformed('type is missing', message);
  if (!(INGESTED_TYPES as readonly string[]).includes(type)) {
    return { kind: 'ignored', reason: `type ${JSON.stringify(type)} is not ingested` };
  }

  for (const field of ['id', 'from', 'timestamp'] as const) {
    if (!isUint32(message[field]))
      return malformed(`${field} is not an unsigned 32-bit integer`, message);
  }
  if (typeof message.sender !== 'string') return malformed('sender is missing', message);
  if (!isObject(message.payload)) return malformed('payload is missing', message);

  const packet: StockPacket = {
    id: message.id as number,
    from: message.from as number,
    timestamp: message.timestamp as number,
    type: type as IngestedType,
    sender: message.sender,
    payload: message.payload,
    ...(typeof message.rssi === 'number' ? { rssi: message.rssi } : {}),
    ...(typeof message.snr === 'number' ? { snr: message.snr } : {}),
    ...(typeof message.hops_away === 'number' ? { hops_away: message.hops_away } : {}),
  };
  return { kind: 'packet', packet, message };
};
