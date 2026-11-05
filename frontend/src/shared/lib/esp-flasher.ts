// The one adapter over `esptool-js` 0.7.1 (devices task 8.3, design section 9.2, vetting record
// `vetting/esptool-js.md`). It connects to the unit's ROM bootloader, checks the chip and the node number
// derived from the MAC before any write (REQ-ERR-16), writes one image compressed at its offset with the
// flash header kept, verifies every region against the MD5 the backend computed (REQ-ERR-17), and resets
// the unit. The library loads on demand, so the rest of the app never ships it.

import { toNodeId } from './meshtastic-dock';

export type FlashMode = 'UPDATE' | 'FULL';
export type FlashStage = 'connecting' | 'checking' | 'erasing' | 'writing' | 'restarting';
export type FlashFailure = 'bootloader' | 'chip' | 'node' | 'write' | 'verify' | 'restart';

export class FlashError extends Error {
  constructor(
    readonly failure: FlashFailure,
    message: string,
  ) {
    super(message);
    this.name = 'FlashError';
  }
}

// The part of `ESPLoader` this adapter uses; the tests give a fake (design section 9.3).
export interface FlashLoader {
  main(mode?: 'default_reset'): Promise<string>;
  chip: { CHIP_NAME: string; readMac(loader: never): Promise<string> };
  eraseFlash(): Promise<unknown>;
  writeFlash(options: {
    fileArray: { data: Uint8Array; address: number }[];
    flashMode: 'keep';
    flashFreq: 'keep';
    flashSize: 'keep';
    eraseAll: boolean;
    compress: boolean;
    reportProgress?: (fileIndex: number, written: number, total: number) => void;
    calculateMD5Hash?: (image: Uint8Array) => string;
  }): Promise<void>;
  after(mode?: 'hard_reset'): Promise<void>;
}

export interface FlashLink {
  loader: FlashLoader;
  close(): Promise<void>;
}

export type OpenLoader = (
  port: SerialPort,
  options: { baudrate: number; romBaudrate?: number },
) => Promise<FlashLink>;

// The variant whose native USB drops the port when esptool-js reopens it at a higher rate: it runs at
// 115200 throughout, `romBaudrate` included, so the port is never reopened (design section 9.2 step 3).
export const SLOW_LINK_VARIANT = 'treklink-v2';
const SLOW_BAUD = 115_200;
// Other units: the rate esptool uses by default for an upload (spec silent; design section 9.2 step 3).
const FAST_BAUD = 460_800;

export const baudFor = (variantCode: string): { baudrate: number; romBaudrate?: number } =>
  variantCode === SLOW_LINK_VARIANT ? { baudrate: SLOW_BAUD, romBaudrate: SLOW_BAUD } : { baudrate: FAST_BAUD };

// The firmware's node number: MAC bytes 2 to 5, big-endian (treklink-firmware src/mesh/NodeDB.cpp:1160).
export const nodeNumFromMac = (mac: string): number | null => {
  const bytes = mac.split(/[:-]/).map((part) => Number.parseInt(part, 16));
  if (bytes.length !== 6 || bytes.some((byte) => !Number.isInteger(byte) || byte < 0 || byte > 255)) return null;
  return ((bytes[2] << 24) | (bytes[3] << 16) | (bytes[4] << 8) | bytes[5]) >>> 0;
};

export const openEspLoader: OpenLoader = async (port, options) => {
  const { ESPLoader, Transport } = await import('esptool-js');
  const transport = new Transport(port, false);
  const loader = new ESPLoader({ transport, baudrate: options.baudrate, romBaudrate: options.romBaudrate });
  return {
    loader: loader as unknown as FlashLoader,
    close: () => transport.disconnect(),
  };
};

export interface FlashRequest {
  port: SerialPort;
  assetTag: string;
  variantCode: string;
  // The manifest's chip for the variant and the device's node number (REQ-ERR-16).
  chip: string;
  nodeNum: number;
  mode: FlashMode;
  image: { data: Uint8Array; offset: number; md5: string };
  onStage?: (stage: FlashStage) => void;
  onProgress?: (written: number, total: number) => void;
}

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

// Flashes one unit. Throws a FlashError naming the failed step (screen 4.3 States): a failed check says
// nothing was written; the caller adds what follows a failed write.
export const flashUnit = async (request: FlashRequest, open: OpenLoader = openEspLoader): Promise<void> => {
  const stage = request.onStage ?? (() => undefined);
  stage('connecting');
  let link: FlashLink | null = null;
  try {
    link = await open(request.port, baudFor(request.variantCode));
    await link.loader.main('default_reset');
  } catch (error) {
    await link?.close().catch(() => undefined);
    throw new FlashError(
      'bootloader',
      `${request.assetTag} did not enter its bootloader (${message(error)}).`,
    );
  }
  const { loader } = link;
  const opened = link;
  try {
    stage('checking');
    const chip = loader.chip.CHIP_NAME;
    if (chip !== request.chip) {
      throw new FlashError(
        'chip',
        `The unit on the port is an ${chip}, not the ${request.chip} of ${request.variantCode}. Nothing was written.`,
      );
    }
    const derived = nodeNumFromMac(await loader.chip.readMac(loader as never));
    if (derived !== request.nodeNum) {
      throw new FlashError(
        'node',
        `The unit on the port is ${derived === null ? 'an unknown unit' : toNodeId(derived)}, not ${request.assetTag}. Nothing was written.`,
      );
    }
    if (request.mode === 'FULL') {
      stage('erasing');
      try {
        await loader.eraseFlash();
      } catch (error) {
        throw new FlashError('write', `The erase failed (${message(error)}).`);
      }
    }
    stage('writing');
    try {
      await loader.writeFlash({
        fileArray: [{ data: request.image.data, address: request.image.offset }],
        // "keep": a rewritten header would no longer match the MD5 of the image (design section 9.2 step 5).
        flashMode: 'keep',
        flashFreq: 'keep',
        flashSize: 'keep',
        eraseAll: false,
        compress: true,
        reportProgress: (_file, written, total) => request.onProgress?.(written, total),
        calculateMD5Hash: () => request.image.md5,
      });
    } catch (error) {
      const text = message(error);
      throw /md5/i.test(text)
        ? new FlashError('verify', 'The written image did not verify.')
        : new FlashError('write', `The write failed (${text}).`);
    }
    stage('restarting');
    try {
      await loader.after('hard_reset');
    } catch (error) {
      throw new FlashError('restart', `${request.assetTag} did not restart (${message(error)}).`);
    }
  } finally {
    await opened.close().catch(() => undefined);
  }
};
