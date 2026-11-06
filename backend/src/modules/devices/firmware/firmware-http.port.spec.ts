import { BodyTooLargeError, readLimited } from './firmware-http.port';

// The image read of api-design 29 (review of #404): a body above the limit is refused on its Content-Length
// before any of it is read, or cancelled as soon as the streamed body passes the limit.
const URL =
  'https://github.com/TrekLink-Team/treklink-firmware/releases/download/v1/firmware-treklink-v3.bin';

const streamOf = (chunks: number[], pulled: { count: number }, cancelled: { value: boolean }) =>
  new ReadableStream<Uint8Array>({
    pull(controller) {
      const next = chunks.shift();
      if (next === undefined) {
        controller.close();
        return;
      }
      pulled.count += 1;
      controller.enqueue(new Uint8Array(next));
    },
    cancel() {
      cancelled.value = true;
    },
  });

describe('readLimited (firmware-http.port)', () => {
  it('refuses on Content-Length above the limit without reading the body', async () => {
    const pulled = { count: 0 };
    const cancelled = { value: false };
    const response = new Response(streamOf([10, 10], pulled, cancelled), {
      headers: { 'Content-Length': '3300001' },
    });

    await expect(readLimited(response, URL, 3_300_000)).rejects.toBeInstanceOf(BodyTooLargeError);
    expect(pulled.count).toBe(0);
    expect(cancelled.value).toBe(true);
  });

  it('cancels a streamed body without Content-Length once it passes the limit', async () => {
    const pulled = { count: 0 };
    const cancelled = { value: false };
    const response = new Response(streamOf([4, 4, 4, 4, 4, 4, 4, 4], pulled, cancelled));

    await expect(readLimited(response, URL, 10)).rejects.toThrow(
      `GET ${URL} is larger than 10 bytes`,
    );
    // The read stops after the third chunk passes 10 bytes; the stream pre-fetches at most one more.
    expect(pulled.count).toBeLessThanOrEqual(4);
    expect(cancelled.value).toBe(true);
  });

  it('returns a body at the limit whole, and any body without a limit', async () => {
    const at = new Response(new Uint8Array([1, 2, 3, 4]), { headers: { 'Content-Length': '4' } });
    await expect(readLimited(at, URL, 4)).resolves.toEqual(new Uint8Array([1, 2, 3, 4]));
    const chunked = new Response(streamOf([3, 2], { count: 0 }, { value: false }));
    expect((await readLimited(chunked, URL, 5)).length).toBe(5);
    const unlimited = new Response(new Uint8Array(20));
    expect((await readLimited(unlimited, URL)).length).toBe(20);
  });
});
