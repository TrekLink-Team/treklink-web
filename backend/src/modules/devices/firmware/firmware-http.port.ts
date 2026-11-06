// The HTTP reads of the firmware release reader (devices design section 9.1), behind a port so the unit
// tests answer from a fake and never reach the network.
export interface FirmwareHttp {
  // GET a JSON document; rejects on a network failure or a status other than 2xx.
  json(url: string, headers: Record<string, string>): Promise<unknown>;
  // GET raw bytes, following redirects (a release asset redirects to its storage host). With `maxBytes`, a
  // body larger than that rejects with BodyTooLargeError: on its Content-Length before any of the body is
  // read, otherwise as soon as the streamed body passes the limit.
  bytes(url: string, headers: Record<string, string>, maxBytes?: number): Promise<Uint8Array>;
}

export class BodyTooLargeError extends Error {
  constructor(
    readonly url: string,
    readonly maxBytes: number,
  ) {
    super(`GET ${url} is larger than ${maxBytes} bytes`);
    this.name = 'BodyTooLargeError';
  }
}

export const FIRMWARE_HTTP = Symbol('FIRMWARE_HTTP');

const TIMEOUT_MS = 20_000;

const checked = async (url: string, headers: Record<string, string>): Promise<Response> => {
  const response = await fetch(url, {
    headers,
    redirect: 'follow',
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`GET ${url} answered ${response.status}`);
  return response;
};

// Reads a body up to `maxBytes`: refused on Content-Length without reading it, else read chunk by chunk
// and cancelled once it passes the limit, so an oversized image is never downloaded whole (review of #404).
export const readLimited = async (
  response: Response,
  url: string,
  maxBytes?: number,
): Promise<Uint8Array> => {
  if (maxBytes === undefined) return new Uint8Array(await response.arrayBuffer());
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) {
    await response.body?.cancel().catch(() => undefined);
    throw new BodyTooLargeError(url, maxBytes);
  }
  if (!response.body) return new Uint8Array(0);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new BodyTooLargeError(url, maxBytes);
    }
    chunks.push(value);
  }
  const body = new Uint8Array(total);
  let at = 0;
  for (const chunk of chunks) {
    body.set(chunk, at);
    at += chunk.length;
  }
  return body;
};

// Node's fetch. The headers the service passes decide whether a token goes out (design section 9.1).
export const fetchFirmwareHttp: FirmwareHttp = {
  json: async (url, headers) => (await checked(url, headers)).json() as Promise<unknown>,
  bytes: async (url, headers, maxBytes) => readLimited(await checked(url, headers), url, maxBytes),
};
