import React, { useId, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { finishHubAction, startHubAction } from '../../entities/device/api';
import {
  compareFirmware,
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
import { Checkbox, Field, Select } from '../../shared/ui/Field';
import { messageOf } from '../../shared/ui/errors';
import { ALERT, WARNING } from '../../shared/ui/styles';

// What the device hub hands the panel (device-connector FlashPanelProps, devices design sections 12.7 and 12.14).
// Declared here, so this feature imports no other feature (FSD); the shell registers the panel with the hub.
export interface FlashFirmwareProps {
  device: {
    id: string;
    assetTag: string;
    nodeNum: number;
    variantCode: string;
    // The OPEN FIRMWARE_UPDATE record, when the weekly scan opened one; the flash no longer needs it (W39).
    maintenanceRecordId: string | null;
    // The version the unit reports over USB, and the one on record.
    reportedFirmware?: string | null;
    firmwareOnRecord?: string | null;
  };
  // The asset tag typed in the hub's confirmation for a RESERVED or RENTED unit (api-design 33).
  confirmAssetTag?: string;
  withPort: <T>(
    work: (port: SerialPort, stage: (state: 'checking' | 'writing' | 'restarting') => void) => Promise<T>,
  ) => Promise<T>;
  // After a verified write: the hub reads the unit again and refreshes its queries.
  onFlashed?: (version: string) => void;
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

const bytes = new Intl.NumberFormat('en-US');

// "Newer than the unit" beside the release (design section 12.14).
const against = (release: string, unit: string | null | undefined) => {
  if (!unit) return 'The unit reports no version.';
  const order = compareFirmware(release, unit);
  return order > 0 ? 'Newer than the unit' : order < 0 ? 'Older than the unit' : 'Same as the unit';
};

/**
 * The firmware flash panel (devices design sections 9.2 and 12.14, screen 4.3 and 4.7). It lists the releases that
 * carry the unit's variant with the newest preselected and shows each against the unit's version, keeps NVS (the
 * app image at 0x10000) unless the full factory image is ticked, and records the flash itself: the start of a
 * `FIRMWARE_UPDATE` hub action before the write (api-design 33), and SUCCEEDED after a verified write, which sets
 * the firmware on record, or FAILED with the step (api-design 34). No maintenance record is needed (REQ-EVT-48).
 */
export const FlashFirmwarePanel: React.FC<FlashFirmwareProps> = ({
  device,
  confirmAssetTag,
  withPort,
  onFlashed,
  onClose,
}) => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const releases = useFirmwareReleases(device.variantCode, true);
  const [chosen, setChosen] = useState<string | null>(null);
  const [full, setFull] = useState(false);
  const [stage, setStage] = useState<FlashStage | null>(null);
  const [progress, setProgress] = useState<{ written: number; total: number } | null>(null);
  const [sha256, setSha256] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [flashed, setFlashed] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const running = useRef(false);
  const reasonId = useId();

  const list = (releases.data ?? []).filter((release) =>
    release.variants.some((candidate) => candidate.variantCode === device.variantCode),
  );
  // The newest release that carries the variant (design section 12.14).
  const newest = list.reduce<string | null>(
    (best, release) => (best === null || compareFirmware(release.version, best) > 0 ? release.version : best),
    null,
  );
  const version = chosen ?? newest;
  const release = list.find((candidate) => candidate.version === version);
  const entry = release?.variants.find((candidate) => candidate.variantCode === device.variantCode);
  const unitVersion = device.reportedFirmware ?? device.firmwareOnRecord ?? null;
  const mode: FlashMode = full ? 'FULL' : 'UPDATE';
  const busy = stage !== null;
  const unavailable = releases.isLoading
    ? 'Reading the firmware releases…'
    : releases.error
      ? messageOf(releases.error)
      : !entry
        ? NO_RELEASE
        : null;

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['devices'] });
    void queryClient.invalidateQueries({ queryKey: ['device', device.id] });
    void queryClient.invalidateQueries({ queryKey: ['device-history', device.id] });
  };

  const flash = async () => {
    if (running.current || !release || !entry) return;
    running.current = true;
    setFailure(null);
    setFlashed(null);
    setProgress(null);
    setSha256(null);
    setStage('connecting');
    let recordId: string | null = null;
    try {
      // The image first: a refused image (502) leaves the port with the hub and records nothing.
      const image = await fetchFirmwareImage(release.version, device.variantCode, full ? 'FACTORY' : 'APP');
      setSha256(image.sha256);
      // The start of the record before anything is written (api-design 33): a refused start writes nothing.
      const started = await startHubAction(device.id, {
        action: 'FIRMWARE_UPDATE',
        nodeNum: device.nodeNum,
        firmwareTo: release.version,
        fullImage: full,
        ...(confirmAssetTag ? { confirmAssetTag } : {}),
      });
      recordId = started.id;
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
          onProgress: (written, total) => setProgress({ written, total }),
        }),
      );
      const done = recordId;
      recordId = null;
      await finishHubAction(device.id, done, { outcome: 'SUCCEEDED' });
      setFlashed(release.version);
      refresh();
      onFlashed?.(release.version);
    } catch (error) {
      // Screen 4.3 States: a failed check already says nothing was written; after a failed step the write is to be
      // repeated (REQ-ERR-17). A started record is finished FAILED with the step (REQ-ERR-34).
      const checkFailed = error instanceof FlashError && (error.failure === 'chip' || error.failure === 'node');
      const text = error instanceof FlashError ? error.message : messageOf(error);
      if (recordId) {
        await finishHubAction(device.id, recordId, { outcome: 'FAILED', failure: text }).catch(() => undefined);
        refresh();
      }
      setFailure(checkFailed || !recordId ? text : `${text} The flash is recorded as failed. Flash ${device.assetTag} again.`);
    } finally {
      running.current = false;
      setStage(null);
    }
  };

  const complete = () => {
    onClose();
    navigate('/t/maintenance', {
      state: { recordId: device.maintenanceRecordId, flashedVersion: flashed },
    });
  };

  const percent = progress && progress.total > 0 ? Math.floor((progress.written / progress.total) * 100) : null;

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

      {list.length > 0 && entry && version && (
        <>
          <Field id="flash-release" label="Release">
            <Select
              id="flash-release"
              value={version}
              disabled={busy}
              onChange={(event) => setChosen(event.target.value)}
            >
              {list.map((candidate) => (
                <option key={candidate.version} value={candidate.version}>
                  {candidate.version}
                  {candidate.version === newest ? ' (latest)' : ''}
                  {candidate.isBaseline ? ' (baseline)' : ''}
                </option>
              ))}
            </Select>
          </Field>
          <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 text-body-sm">
            <dt className="text-ink-muted">Release</dt>
            <dd className="text-ink">
              {version} <span className="text-ink-muted">({against(version, unitVersion)})</span>
            </dd>
            <dt className="text-ink-muted">On the unit</dt>
            <dd className="text-ink">{device.reportedFirmware ?? 'Not reported'}</dd>
            <dt className="text-ink-muted">On record</dt>
            <dd className="text-ink">{device.firmwareOnRecord ?? 'Not recorded'}</dd>
            {sha256 && (
              <>
                <dt className="text-ink-muted">SHA-256, checked</dt>
                <dd className="break-all font-mono text-ink">{sha256}</dd>
              </>
            )}
          </dl>
          <Checkbox
            checked={full}
            disabled={busy}
            onChange={(event) => setFull(event.target.checked)}
            label="Full factory image (erases the unit's settings)"
            description="Off: writes the app image at 0x10000 and keeps the channel, owner names and settings (NVS). On: erases the unit and writes the factory image at 0x0; provision it again before its next handover."
          />
        </>
      )}

      {device.variantCode === SLOW_LINK_VARIANT && (
        <p className={WARNING}>
          Hold the power button of {device.assetTag} until the flash finishes; a reset turns a v2 unit off
          otherwise.
        </p>
      )}

      {busy && stage === 'writing' && progress && (
        <progress
          className="h-2 w-full accent-brand"
          max={progress.total}
          value={progress.written}
          aria-label="Flash progress"
        />
      )}
      <p role="status" aria-live="polite" className={busy ? 'text-body text-ink' : 'sr-only'}>
        {stage
          ? `${STAGE_TEXT[stage]}${
              progress && stage === 'writing'
                ? ` ${bytes.format(progress.written)} of ${bytes.format(progress.total)} bytes, ${percent ?? 0} %`
                : ''
            }`
          : ''}
      </p>

      {failure && (
        <p role="alert" className={ALERT}>
          {failure}
        </p>
      )}

      {flashed && (
        <div role="status" className="flex flex-col gap-2 rounded-control border border-line p-3">
          <p className="text-body text-ink">
            {flashed} written and verified on {device.assetTag}.
            {device.maintenanceRecordId ? ' Complete the firmware update record to close it.' : ''}
          </p>
          {device.maintenanceRecordId && (
            <div>
              <Button variant="primary" onClick={complete}>
                Complete the record
              </Button>
            </div>
          )}
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
            if (full) setConfirming(true);
            else void flash();
          }}
        >
          {full ? 'Erase and flash' : 'Flash'}
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
