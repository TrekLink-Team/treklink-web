---
origin: third-party
vetting: adopted
subject: esptool-js, the browser flasher for the Staff firmware flash page (W9 item C, D-093 amendment item 3)
recorded: 2026-11-03
decided: 2026-11-03
recorded-by: KhoaDD (orchestrator under D-078, Claude Opus 5.5)
decision-owner: KhoaDD (orchestrator under D-078; the leader may overrule)
---

# Vetting record: esptool-js for flashing TrekLink units from the browser

> Workflow: third-party vetting (inventory, findings, decision, apply plan, record). The D-093
> amendment (item 3) asks this week for a firmware flash tool reachable from the web. Nothing was
> installed into a TrekLink package or run against a unit for this record: the package was read with
> `npm view` and `npm pack esptool-js@0.7.1` (unpacked outside every repository), the repository with
> `gh api repos/espressif/esptool-js`, and the firmware facts from `treklink-firmware` `dev` at
> `a4aa98d`. Read on 2026-11-03.

## 1. What the flash page needs

1. Open the unit's USB serial port from a Chromium browser after Staff choose it in the browser's own
   prompt, as the dock does (`specs/devices/design.md` §8, REQ-UBI-05).
2. Put the chip into its ROM download mode without pressing buttons, on the three active variants:
   v2 (custom PCB, ESP32-S3, native USB), v3 (LilyGo T-Beam v1.2, ESP32 behind a USB to UART bridge)
   and v4 (LilyGo T-Beam Supreme, ESP32-S3, native USB) (`treklink-firmware` `docs/variants.md`).
3. Write a TrekLink image at the right offsets, verify it, and reset the unit.
4. Report progress and errors in words a Staff member can act on.

## 2. Inventory

| Candidate | Version | Last publish | Licence | Runtime dependencies | Unpacked size | Maintainers |
|---|---|---|---|---|---|---|
| `esptool-js` | 0.7.1 | 2026-11-02 | Apache-2.0 | `pako` ^2.1.0 (MIT AND Zlib), `atob-lite` ^2.0.0 (MIT, last published 2022-06-13) | 867 642 B | Espressif staff (`espbignacio`, `esp-phone-app-dev`) |

- Repository `github.com/espressif/esptool-js`: Apache-2.0, not archived, last push 2026-11-02, 556
  stars, 36 open issues; 27 published versions, 0.6.0 (2026-03-26), 0.6.1 (2026-08-06), 0.7.0
  (2026-09-21), 0.7.1 (2026-11-02).
- The flasher stub binaries in `lib/targets/stub_flasher/*.json` come from Espressif's
  `esp-flasher-stub` v1.2.2 (repository README of that folder); the repository folder carries
  `LICENSE-APACHE` and `LICENSE-MIT`, while the npm package ships the JSON files without them.
- Alternatives considered: the Python `esptool` (a terminal tool, the leader's bench path, D-086 rule 7
  `tk.py`; not reachable from a browser) and Meshtastic's web flasher (a hosted site that flashes stock
  Meshtastic builds, so it cannot pin a TrekLink image).

## 3. Findings

### 3.1 Licence

Apache-2.0 for the library, MIT and Zlib for `pako`, MIT for `atob-lite`, Apache-2.0 or MIT for the
stub binaries. All are permissive and compatible with shipping in the web bundle. The bundle keeps their
licence texts (the frontend's licence notice gains the three entries). No copyleft obligation, unlike
the GPL-3.0 Meshtastic packages of D-082.

### 3.2 Code read

- Module format: ES module (`"type": "module"`, `lib/index.js`), with type declarations; a single-file
  `bundle.js` also ships but is not needed with a bundler.
- No network access from the library: no `fetch`, `XMLHttpRequest`, `eval` or `new Function` in `lib/`.
  The images to write are handed in by the page as `Uint8Array`s (`FlashOptions.fileArray`).
- Chip support covers the ESP32 and ESP32-S3 targets the fleet uses (`lib/targets/esp32.js`,
  `esp32s3.js`).
- Reset strategies: `ClassicReset` (DTR and RTS through a USB to UART bridge, v3) and
  `UsbJtagSerialReset` (the ESP32-S3 native USB Serial/JTAG, v2 and v4), plus `HardReset` and a custom
  sequence (`lib/reset.d.ts`).
- Browser support: Chrome and Edge 89 or later on the desktop, through Web Serial; the same constraint
  as the dock (D-080).

### 3.3 Fit with the firmware and the fleet

- Offsets: the bench path writes bootloader at `0x0`, partitions at `0x8000`, `boot_app0` at `0xe000`
  and the app at `0x10000`; writing only the app at `0x10000` keeps NVS and LittleFS, so a unit keeps
  its channel, owner names and settings across an update (bench record 2026-10-29). The build also
  produces `firmware.factory.bin` (`bin/platformio-custom.py:75`), a merged image written at `0x0` for a
  fresh unit, which replaces the stored settings.
- v2 power latch: any reset drops the v2 power latch, so a v2 unit is flashed with its power button held
  (bench record 2026-10-29). The page must say so before it starts on a v2 unit.
- v2 baud: on the bench a baud switch failed mid-write once and left a unit boot-looping until a retry;
  the bench uses 115200 for v2. The page keeps v2 at 115200 and offers a retry that starts the write over.
- No published TrekLink images yet: `treklink-firmware` has no GitHub release (checked 2026-11-03), and
  no workflow builds the three TrekLink environments for release.
- GitHub release assets cannot be fetched by the browser: the download answers 302 to
  `release-assets.githubusercontent.com`, and neither response carries `Access-Control-Allow-Origin`
  (checked 2026-11-03 with `curl -I -H 'Origin: https://treklink-web.vercel.app'` on a Meshtastic
  release asset). The page therefore takes its images from the TrekLink backend, which fetches and
  checks them server-side.

### 3.4 Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| A write interrupted half way leaves a unit that does not boot | Medium | Medium | The chip's download mode lives in mask ROM, and an app-only write does not touch the second-stage bootloader at `0x0`, so a retry from the page or the bench path recovers the unit. The page writes the app only by default, compressed, and passes `FlashOptions.calculateMD5Hash` so the library compares each region with the chip's `flashMd5sum` after the write (`lib/types/flashOptions.d.ts:39`, `:49`, `lib/esploader.d.ts:396`) |
| The wrong image for the variant | Low | High | The backend serves an image per variant from a manifest with its SHA-256; the page reads the docked unit's `pio_env` (dock handshake, §8.2 of the devices design) and refuses an image whose variant differs |
| A full install erases the channel key and owner names | Medium | Medium | Full install is a separate action with its own confirmation, and the device returns to "Not provisioned" in the platform until it is provisioned again |
| `atob-lite` unmaintained since 2022 | Low | Low | A 2-line base64 helper with no further dependencies; pinned with the library |
| Library API changes between 0.x versions | Medium | Low | Exact version pin (`0.7.1`); one adapter file wraps it, as `meshtastic-dock.ts` does for the dock |

## 4. Decision

**Adopt `esptool-js` 0.7.1, pinned exactly**, behind one adapter in `frontend/src/shared/lib/`. Rejected:
re-authoring the ESP serial protocol (large, and the stub flasher is Espressif's own), the Python
`esptool` (not reachable from the Staff browser), and linking Staff to Meshtastic's web flasher (stock
images only).

## 5. Apply plan (spec first, D-052)

1. Firmware: a workflow in `treklink-firmware` that builds `treklink-v2`, `treklink-v3-tbeam` and
   `treklink-v4-supreme` on a tag and attaches, per variant, the app image, the factory image and a
   manifest with the version, variant, offsets and SHA-256 of each file. Workflow files are edited by the
   leader (token scope).
2. Spec in `specs/devices/` (design §9, a firmware flash page for Staff): a backend endpoint pair that
   lists the published versions per variant and streams an image after checking its SHA-256 against the
   manifest; the page on screen 4.2 (device detail) with Update (app only, default) and Full install;
   the variant check against the docked unit; recording the new `firmwareVersion` on the device (devices
   api-design 08) after a verified write.
3. Then the build, once the spec is approved.
