import React, { useId, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  fetchFirmwareImage,
  imageBytes,
  NO_RELEASE_TEXT,
  useFirmwareReleases,
} from '../../entities/firmware/api';
import {
  FlashError,
  flashUnit,
  SLOW_LINK_VARIANT,
  type FlashMode,
  type FlashStage,
} from '../../shared/lib/esp-flasher';
import { Button } from '../../shared/ui/Button';
import { cn } from '../../shared/ui/cn';
import { ConfirmDialog } from '../../shared/ui/Dialog';
import { Field, RadioGroup, Select } from '../../shared/ui/Field';
import { messageOf } from '../../shared/ui/errors';
import { ALERT, WARNING } from '../../shared/ui/styles';

// What the device hub hands the panel (device-connector FlashPanelProps, devices design section 12.7). Declared
// here, so this feature imports no other feature (FSD); the shell registers the panel with the hub.
export interface FlashFirmwareProps {
  device: {
    id: string;
    assetTag: string;
    nodeNum: number;
    variantCode: string;
    maintenanceRecordId: string;
  };
  withPort: <T>(
    work: (port: SerialPort, stage: (state: 'checking' | 'writing' | 'restarting') => void) => Promise<T>,
  ) => Promise<T>;
  onClose: () => void;
}

// The text shown, never an error, while no release carries the variant (W32, chapter 06 §11.4).
export const NO_RELEASE = NO_RELEASE_TEXT;

const STAGE_TEXT: Record<FlashStage, string> = {
  connecting: 'Connecting to the bootloader…',
  checking: 'Checking the chip and the node number…',
  erasing: 'Erasing the flash…',
  writing: 'Writing and verifying the image…',
  restarting: 'Restarting the unit…',
};

const MODES = [
  {
    value: 'UPDATE' as const,
    label: 'Update',
    description: 'Writes the app image; the unit keeps its channel, owner names and settings.',
  },
  {
    value: 'FULL' as const,
    label: 'Full install',
    description:
      'Erases the unit and writes the factory image; it loses its settings and must be provisioned again before its next handover.',
  },
];

/**
 * The firmware flash panel of screen 4.3 (devices task 8.3, design section 9.2), opened by the device
 * hub's Update firmware on a unit with an `OPEN` `FIRMWARE_UPDATE` record (REQ-EVT-43). It lists the
 * releases that carry the unit's variant, flashes through the port the hub lends under its write lock,
 * and on a verified write hands the release version to the record's Complete (REQ-EVT-28). A failure
 * names its step and records nothing (REQ-ERR-16, REQ-ERR-17, REQ-ERR-30).
 */
export const FlashFirmwarePanel: React.FC<FlashFirmwareProps> = ({ device, withPort, onClose }) => {
  const navigate = useNavigate();
  const releases = useFirmwareReleases(device.variantCode, true);
  const [chosen, setChosen] = useState<string | null>(null);
  const [mode, setMode] = useState<FlashMode>('UPDATE');
  const [stage, setStage] = useState<FlashStage | null>(null);
  const [percent, setPercent] = useState<number | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [flashed, setFlashed] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const running = useRef(false);
  const reasonId = useId();

  const list = releases.data ?? [];
  const preselected = list.find((release) => release.isBaseline)?.version ?? list.at(0)?.version ?? null;
  const version = chosen ?? preselected;
  const release = list.find((candidate) => candidate.version === version);
  const entry = release?.variants.find((candidate) => candidate.variantCode === device.variantCode);
  const busy = stage !== null;
  const unavailable = releases.isLoading
    ? 'Reading the firmware releases…'
    : releases.error
      ? messageOf(releases.error)
      : !entry
        ? NO_RELEASE
        : null;

  const flash = async () => {
    if (running.current || !release || !entry) return;
    running.current = true;
    setFailure(null);
    setFlashed(null);
    setPercent(null);
    setStage('connecting');
    try {
      // The image first: a refused image (502) leaves the port with the hub.
      const image = await fetchFirmwareImage(release.version, device.variantCode, mode === 'FULL' ? 'FACTORY' : 'APP');
      await withPort((port, report) =>
        flashUnit({
          port,
          assetTag: device.assetTag,
          variantCode: device.variantCode,
          chip: entry.chip,
          nodeNum: device.nodeNum,
          mode,
          image: { data: imageBytes(image), offset: image.offset, md5: image.md5 },
          onStage: (next) => {
            setStage(next);
            report(next === 'restarting' ? 'restarting' : next === 'checking' ? 'checking' : 'writing');
          },
          onProgress: (written, total) => setPercent(total > 0 ? Math.floor((written / total) * 100) : null),
        }),
      );
      setFlashed(release.version);
    } catch (error) {
      // Screen 4.3 States: a failed check already says nothing was written; after a failed step the
      // write is to be repeated (REQ-ERR-17).
      const checkFailed = error instanceof FlashError && (error.failure === 'chip' || error.failure === 'node');
      const text = error instanceof FlashError ? error.message : messageOf(error);
      setFailure(checkFailed ? text : `${text} Nothing was recorded. Flash ${device.assetTag} again.`);
    } finally {
      running.current = false;
      setStage(null);
      setPercent(null);
    }
  };

  const complete = () => {
    onClose();
    navigate('/t/maintenance', {
      state: { recordId: device.maintenanceRecordId, flashedVersion: flashed },
    });
  };

  return (
    <section aria-labelledby="flash-firmware-heading" className="flex flex-col gap-4">
      <h3 id="flash-firmware-heading" className="text-title-sm text-ink">
        Update firmware of {device.assetTag}
      </h3>

      {releases.error && (
        <p role="alert" className={ALERT}>
          {messageOf(releases.error)}
        </p>
      )}

      {list.length > 0 && entry && (
        <>
          <Field id="flash-release" label="Release">
            <Select
              id="flash-release"
              value={version ?? ''}
              disabled={busy}
              onChange={(event) => setChosen(event.target.value)}
            >
              {list.map((candidate) => (
                <option key={candidate.version} value={candidate.version}>
                  {candidate.version}
                  {candidate.isBaseline ? ' (baseline)' : ''}
                </option>
              ))}
            </Select>
          </Field>
          <RadioGroup
            name="flash-mode"
            legend="Mode"
            value={mode}
            onChange={(next) => !busy && setMode(next)}
            options={MODES.map((option) => ({ ...option, disabled: busy }))}
          />
        </>
      )}

      {device.variantCode === SLOW_LINK_VARIANT && (
        <p className={WARNING}>
          Hold the power button of {device.assetTag} until the flash finishes; a reset turns a v2 unit off
          otherwise.
        </p>
      )}

      <p role="status" aria-live="polite" className={busy ? 'text-body text-ink' : 'sr-only'}>
        {stage ? `${STAGE_TEXT[stage]}${percent !== null && stage === 'writing' ? ` ${percent} %` : ''}` : ''}
      </p>

      {failure && (
        <p role="alert" className={ALERT}>
          {failure}
        </p>
      )}

      {flashed && (
        <div role="status" className="flex flex-col gap-2 rounded-control border border-line p-3">
          <p className="text-body text-ink">
            {flashed} written and verified on {device.assetTag}. Complete the record to save it.
          </p>
          <div>
            <Button variant="primary" onClick={complete}>
              Complete the record
            </Button>
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-end gap-2">
        {unavailable && !busy && (
          <p id={reasonId} className={releases.error ? 'sr-only' : 'basis-full text-right text-body text-ink'}>
            {unavailable}
          </p>
        )}
        <Button variant="ghost" onClick={onClose} disabled={busy}>
          Close
        </Button>
        <Button
          variant="primary"
          loading={busy}
          // Unavailable keeps its slot and its focus, with the reason beside it (chapter 06 §11.4).
          className={cn(unavailable !== null && !busy && 'cursor-not-allowed opacity-55')}
          aria-disabled={unavailable !== null || undefined}
          aria-describedby={unavailable ? reasonId : undefined}
          onClick={() => {
            if (unavailable !== null) return;
            if (mode === 'FULL') setConfirming(true);
            else void flash();
          }}
        >
          {mode === 'FULL' ? 'Erase and flash' : 'Flash'}
        </Button>
      </div>
      {confirming && version && (
        <ConfirmDialog
          titleId="flash-full-title"
          title={`Erase ${device.assetTag} and install ${version}?`}
          description="The unit loses its channel and owner names and must be provisioned again before its next handover."
          confirmLabel="Erase and flash"
          cancelLabel="Keep the unit as it is"
          destructive
          irreversible
          onCancel={() => setConfirming(false)}
          onConfirm={() => {
            setConfirming(false);
            void flash();
          }}
        />
      )}
    </section>
  );
};
