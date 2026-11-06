# 2026-11-06 10:52 (UTC+7): WF-04 re-run on staging with the cluster markers (treklink-web#402)

LongNN, hand-driven in the Browser pane of the desktop app on `treklink-web.vercel.app`, signed in as the Org Manager of
ORG-0001 (Demo Manager). The organization API was called with `curl` and a read-only API key that the same member
created for this check. Jira TK-206.

This repeats the run of `docs/sessions/2026-11-04-1250-wf04-staging-run.md` for DS-04a and the organization API, now that
#402 (cluster badges and stacked pins, never a ring) is on staging. DS-04a and DS-04b are the WF-04 demo scenarios of
BM04 (`Documents/tracking/BM04-commitment-scope.md` in the capstone repository), steps in
`docs/demo/2026-11-01-demo-script.md` section 5.

## What differs from the scope that was agreed

- The account is an **Org Manager**, not an Admin and not an Operator. A Manager holds every permission of an Operator
  (SRS actor table), so `/o/map` is the Operator view, but it is not the Operator's own login.
- `/t/map` (Staff and Admin) was **not walked**: the Manager is refused with MSG26, which is the expected answer.
- Demo control is for Admin only, and `GET /api/demo/status` answers 404 on this staging (the control panel is off on
  Vercel, D-094), so no node was added and no style of #402 was exercised. The two simulated units that report on staging
  (TL-0009 and TL-0010) were already feeding.
- The Browser pane was set to 1440 by 900 for the walk, because at its own size the page uses the phone stacking and the
  map is 229 px high. It was reset afterwards.
- The deployed commit was not read from the server. That the build holds #402 is shown by the behaviour below, not by a SHA.

## API of the organization (monitoring api-design 04)

| Case | Result |
|---|---|
| `GET /api/telemetry/devices` with `X-Api-Key` | 200 in 0.5 s, envelope `isSuccess true`, `statusCode 200`, `cursor 11383`, 8 devices |
| Same call without the key | 401 |
| Fields of a unit | `assetTag, batteryPct, contractCode, group, hardwareVariant, holder, id, lastSeenAt, openIncident, position, simulated, stale, state`; none names an organization |
| States | 2 LIVE, 1 OFFLINE, 5 NOT_HEARD; contracts RC-2026-0001, 0003, 0004; 3 units with a position, all `simulated`; 2 open incidents |
| Second call 6 minutes later | cursor 11443, same 8 units and states; TL-0009 and TL-0010 `lastSeenAt` 03:50:00Z and 03:50:31Z |

## Live map `/o/map` with the clusters (screen 9.1, REQ-UBI-06)

| Case | Result |
|---|---|
| Same units as the API | Met: "8 devices, 2 SOS open" and "2 live, 1 offline, 5 not heard since handover" equal the API counts |
| Cluster badges at the opening zoom (12) | Met: one badge "5" (the five NOT_HEARD units pinned at the counter, grey) and one badge "2 SOS" (TL-0003 offline with TL-0009), plus the TL-0010 SOS pin alone |
| Badge names | Met: "5 devices, 5 not heard since handover, near 11.5600, 108.5400" and "2 devices, 1 SOS, 1 offline, near 11.5097, 108.5611"; the second centroid equals the mean of the API positions of TL-0003 and TL-0009 |
| Click on a badge zooms to its members | Met for "2 SOS": the map came to a zoom where the SOS diamond of TL-0009 and the offline unit of TL-0003 draw apart |
| Units that share one spot | Met: the five NOT_HEARD units read "n of 5 devices at this spot", and choosing TL-0004 in the list opened the list "5 devices at this spot" with a scrolling list and the "Not heard since handover" chip on the top pin |
| Popup of a single device | Met: TL-0009 popup lists contract, variant, battery, last seen, "Open incident INC-2026-000002" (`/o/incidents/{id}`) and "Position history"; focus is inside the popup |
| DS-04a, positions change without a reload | Met on the Operator view: TL-0009 and TL-0010 "Last seen" moved from 10:48 to 10:50 with no reload, and the API answered the same times; TL-0010 moved from 11.4725, 108.5906 to 11.4696, 108.5919 between the two API calls |
| DS-04b, silent unit shows stale with last seen | Met as found: TL-0003 reads "Offline, last seen 04 Nov 2026, 20:35". Not driven: clearing it needs Demo control |
| Isolation between organizations | Open: ORG-0002 still owns no rented unit on staging |

## Defect seen

- **Popup link contrast in the dark theme.** The links in the marker popup ("Open incident ...", "Position history")
  compute to `rgb(0, 120, 168)` on the popup background `rgb(13, 28, 20)`: a ratio of about 3.56 to 1 at 12 px, below
  4.5 to 1 (WCAG 1.4.3). The same "Open incident" link in the device list uses the lime link token. The cause was not
  traced; Leaflet's own `.leaflet-container a` colour is the first thing to check. Not fixed here.
- Console: the 404s on this page are `GET /api/demo/status`, which the control panel being off explains. No other error.

## Not done

- `/t/map`, the Staff and Admin views, and the organization filter.
- Demo control and the eight walking styles of #402, which need an Admin session.
- The Operator login of ORG-0001 itself.
- The 360 px bottom sheet of treklink-web#410: it is not on staging, so no walk at 360 px was possible.
- A second organization, so DS-04a stays open for the isolation case.
- The API key was created by the member for this check and was passed in the session; it is to be revoked at `/o/api-keys`.
