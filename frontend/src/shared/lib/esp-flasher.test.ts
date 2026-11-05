import { describe, expect, it, vi } from 'vitest';
import { baudFor, flashUnit, FlashError, nodeNumFromMac, type FlashLoader, type FlashRequest } from './esp-flasher';

// devices task 8.3, design sections 9.2 and 9.3, with a fake ESPLoader: the chip and node-number checks
// write nothing, a verify failure is named, Update and Full install offsets, the v2 link rate.
const MAC = 'a4:cf:12:34:56:78';
const NODE = 0x12345678;
const IMAGE = Uint8Array.from([0xe9, 1, 2, 3]);

const fakeLoader = (overrides: Partial<FlashLoader> & { chipName?: string; mac?: string } = {}) => {
  const loader = {
    main: vi.fn(() => Promise.resolve('ESP32')),
    chip: { CHIP_NAME: overrides.chipName ?? 'ESP32', readMac: vi.fn(() => Promise.resolve(overrides.mac ?? MAC)) },
    eraseFlash: vi.fn(() => Promise.resolve(0)),
    writeFlash: vi.fn((options: Parameters<FlashLoader['writeFlash']>[0]) => {
      options.reportProgress?.(0, 2, 4);
      return Promise.resolve();
    }),
    after: vi.fn(() => Promise.resolve()),
    ...overrides,
  };
  return loader;
};

const request = (overrides: Partial<FlashRequest> = {}): FlashRequest => ({
  port: {} as SerialPort,
  assetTag: 'TL-0042',
  variantCode: 'treklink-v3',
  chip: 'ESP32',
  nodeNum: NODE,
  mode: 'UPDATE',
  image: { data: IMAGE, offset: 0x10000, md5: 'f'.repeat(32) },
  ...overrides,
});

const run = async (loader: ReturnType<typeof fakeLoader>, overrides: Partial<FlashRequest> = {}) => {
  const close = vi.fn(() => Promise.resolve());
  const open = vi.fn(() => Promise.resolve({ loader: loader as unknown as FlashLoader, close }));
  const stages: string[] = [];
  const result = await flashUnit(request({ onStage: (stage) => stages.push(stage), ...overrides }), open).then(
    () => null,
    (error: unknown) => error,
  );
  return { result, stages, open, close };
};

describe('esp-flasher (devices task 8.3)', () => {
  it('derives the node number from MAC bytes 2 to 5', () => {
    expect(nodeNumFromMac(MAC)).toBe(NODE);
    expect(nodeNumFromMac('00:00:ff:ff:ff:ff')).toBe(0xffffffff);
    expect(nodeNumFromMac('nonsense')).toBeNull();
  });

  it('runs a v2 unit at 115200 with romBaudrate, and others faster without it', () => {
    expect(baudFor('treklink-v2')).toEqual({ baudrate: 115200, romBaudrate: 115200 });
    expect(baudFor('treklink-v3')).toEqual({ baudrate: 460800 });
  });

  it('Update writes the app image compressed at its offset with the header kept and the backend MD5', async () => {
    const loader = fakeLoader();
    const progress = vi.fn();
    const { result, stages, close } = await run(loader, { onProgress: progress });

    expect(result).toBeNull();
    expect(stages).toEqual(['connecting', 'checking', 'writing', 'restarting']);
    expect(loader.main).toHaveBeenCalledWith('default_reset');
    expect(loader.eraseFlash).not.toHaveBeenCalled();
    const options = vi.mocked(loader.writeFlash).mock.calls[0][0];
    expect(options).toMatchObject({
      fileArray: [{ data: IMAGE, address: 0x10000 }],
      flashMode: 'keep',
      flashFreq: 'keep',
      flashSize: 'keep',
      eraseAll: false,
      compress: true,
    });
    expect(options.calculateMD5Hash?.(new Uint8Array())).toBe('f'.repeat(32));
    expect(progress).toHaveBeenCalledWith(2, 4);
    expect(loader.after).toHaveBeenCalledWith('hard_reset');
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('Full install erases first and writes the factory image at 0', async () => {
    const loader = fakeLoader();
    const { result, stages } = await run(loader, {
      mode: 'FULL',
      image: { data: IMAGE, offset: 0, md5: 'a'.repeat(32) },
    });
    expect(result).toBeNull();
    expect(stages).toEqual(['connecting', 'checking', 'erasing', 'writing', 'restarting']);
    expect(vi.mocked(loader.writeFlash).mock.calls[0][0].fileArray[0].address).toBe(0);
  });

  it('writes nothing when the chip differs (REQ-ERR-16, AC-20)', async () => {
    const loader = fakeLoader({ chipName: 'ESP32' });
    const { result, close } = await run(loader, { chip: 'ESP32-S3' });
    expect(result).toBeInstanceOf(FlashError);
    expect((result as FlashError).failure).toBe('chip');
    expect((result as FlashError).message).toBe(
      'The unit on the port is an ESP32, not the ESP32-S3 of treklink-v3. Nothing was written.',
    );
    expect(loader.writeFlash).not.toHaveBeenCalled();
    expect(loader.eraseFlash).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalled();
  });

  it('writes nothing when the MAC-derived node number is another unit (REQ-ERR-16, AC-20)', async () => {
    const loader = fakeLoader({ mac: 'a4:cf:de:ad:be:ef' });
    const { result } = await run(loader, { variantCode: 'treklink-v2', chip: 'ESP32' });
    expect((result as FlashError).failure).toBe('node');
    expect((result as FlashError).message).toBe(
      'The unit on the port is !deadbeef, not TL-0042. Nothing was written.',
    );
    expect(loader.writeFlash).not.toHaveBeenCalled();
  });

  it('names a verify failure apart from a write failure (REQ-ERR-17)', async () => {
    const md5 = await run(fakeLoader({ writeFlash: vi.fn(() => Promise.reject(new Error('MD5 of file does not match data in flash!'))) }));
    expect((md5.result as FlashError).failure).toBe('verify');
    const write = await run(fakeLoader({ writeFlash: vi.fn(() => Promise.reject(new Error('Timeout'))) }));
    expect((write.result as FlashError).failure).toBe('write');
  });

  it('names the bootloader step when the unit does not answer, and closes the port', async () => {
    const loader = fakeLoader({ main: vi.fn(() => Promise.reject(new Error('Failed to connect'))) });
    const { result, close } = await run(loader);
    expect((result as FlashError).failure).toBe('bootloader');
    expect(close).toHaveBeenCalled();
  });

  it('names the restart when the reset fails after a verified write', async () => {
    const { result } = await run(fakeLoader({ after: vi.fn(() => Promise.reject(new Error('lost'))) }));
    expect((result as FlashError).failure).toBe('restart');
  });
});
