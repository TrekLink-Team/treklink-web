# Device connector: the leader's request (2026-11-04 01:40, at the docking bench), to specify before any code

Recorded the moment it was given (AGENTS.md §2.6). Spec-driven (D-066): requirements, design, tasks and api-design in
`treklink-web/specs/devices/` (and `specs/frontend/ui-design/`) first, after the leader answers the open questions below.

## What the leader asked for (paraphrased closely)

1. **One device connector for the whole system.** A shared panel on the right side of the screen that shows how many
   units are connected over USB and which ones. Every device-related page can open it. "An all-in-one tool device-wise:
   just connect and see what you can do with it."
2. **Recognition on connect.** A registered unit is recognized at once (asset tag, variant, status, contract). A unit
   the system does not know shows a prompt like "New device, sync?" that leads into registration (Read from unit).
3. **Mismatch at the counter becomes a quick swap.** Today a contract lists exact units, so docking a different one is
   refused ("The docked unit is !xxxx, not TL-0001"). The leader finds that backwards: when the docked unit is another
   unit that would serve (the leader: any unit, just a different id), the panel offers to put it on the contract in
   place of the reserved one and provision it right away (hot swap and hot provisioning).
4. **A unit being provisioned shows on the live map** at the place where it is docked (the counter), while it is
   connected.
5. **Order of work:** first the new UI from tonight's design handoff (contract home, CollectionView, ch06 §9 and §10,
   treklink-docs#158), then the device panel, then quick swap, hot provisioning and register from the panel.

## Tonight's evidence it builds on

- Docking works end to end on a v2 with treklink-firmware#27 (USB CDC): Read from unit, Dock and provision, the
  wrong-unit refusal (manual guide `docs/demo/device-docking-manual-test.md` on `feat/devices-docking-frontend`).
- Bug treklink-web#348: the counter's last row hides under the sticky bar.

## Open questions for the leader (asked 2026-11-04)

See the session file for the answers once given.

## Leader's answers (2026-11-04 01:45)

1. **Quick swap:** any AVAILABLE unit of the contract's variant may replace a reserved one; the replaced unit goes back to AVAILABLE. Price, spec and stock stay as they are.
2. **Users:** TrekLink Staff and Admin only (counter, intake, maintenance, fleet). Organizations never dock units.
3. **Live map:** a unit docked for provisioning shows on the Staff map only, pinned at `monitoring.counterLocation` with a "Docked at the counter" state while the browser holds its port. Organizations see it only after handover (D-092 unchanged).
4. **Several units at once:** the panel lists every connected unit, one row each, and remembers granted ports, so a replug reconnects without the chooser.

## Scope addition from the leader (2026-11-04 02:05), binding

The device connector is one centralized device hub for Staff ("in the spirit of 3uTools for TrekLink: connect a unit
and see what you can do with it"). In one place it covers: register a new unit, provision it for a contract (with the
quick swap and hot provisioning above), configure the uplink, read its info (identity, variant, firmware, battery,
contract, status) and flash firmware (devices design §9, tasks Phase 8). The counter rows, the Register panel's Read
from unit, Configure uplink and the flash panel all open the same connector instead of each page docking on its own.
A detailed device view uses an upright product render of the unit, referenced as `/variants/<code>-detail.png`, and
lists and non-detail panes use `/variants/<code>-icon.png` (the images are being made separately). Specified in
`specs/devices/design.md` §11; choices not settled are open questions there.
