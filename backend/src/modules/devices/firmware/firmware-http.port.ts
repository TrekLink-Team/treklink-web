// The HTTP reads of the firmware release reader (devices design section 9.1), behind a port so the unit
// tests answer from a fake and never reach the network.
export interface FirmwareHttp {
  // GET a JSON document; rejects on a network failure or a status other than 2xx.
  json(url: string, headers: Record<string, string>): Promise<unknown>;
  // GET raw bytes, following redirects (a release asset redirects to its storage host).
  bytes(url: string, headers: Record<string, string>): Promise<Uint8Array>;
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

// Node's fetch. The repository is public, so no token is sent (design section 9.1).
export const fetchFirmwareHttp: FirmwareHttp = {
  json: async (url, headers) => (await checked(url, headers)).json() as Promise<unknown>,
  bytes: async (url, headers) => new Uint8Array(await (await checked(url, headers)).arrayBuffer()),
};
