from ._common import ORG_ID, DEVICE_ID, INCIDENT_ID, STATION_ID, NOW, ep, paged

SNAP_DEVICE = {"id": DEVICE_ID, "assetTag": "TL-0042", "hardwareVariant": "treklink-v3",
               "holder": {"name": "Le Thi E"}, "position": {"lat": 11.5601, "lon": 108.5402, "at": NOW},
               "batteryPct": 81, "lastSeenAt": NOW, "stale": False, "openIncident": None, "contractCode": "RC-2026-0042"}
API_KEY_HDR = [["X-Api-Key", "Organization API key (read-only)", "string", "yes", "`tlk_7Hc2...`"]]

ENDPOINTS = [
    ep("GET", "/api/map/config", "Map configuration", "Any signed-in user",
       "Map provider, tile URL template, attribution and default viewport from the business parameters "
       "(FR-CFG-03, D-031). The sovereignty overlay labels are a constant of the build, "
       "`SOVEREIGNTY_OVERLAY` in `monitoring`, and an Admin cannot edit them away (D-031, BR-30). "
       "The client never hard-codes a provider or a label.",
       "UC-38, FR-CFG-03, FR-MON-01, BR-30, NFR-LEG-01",
       response={"provider": "openstreetmap", "tileUrl": "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
                 "attribution": "© OpenStreetMap contributors", "defaultViewport": {"lat": 11.56, "lon": 108.54, "zoom": 12},
                 "sovereigntyOverlay": [{"label": "Quần đảo Hoàng Sa (Việt Nam)", "lat": 16.5, "lon": 112.0},
                                        {"label": "Quần đảo Trường Sa (Việt Nam)", "lat": 10.0, "lon": 114.0}],
                 "staleAfterSeconds": 300},
       steps=["Read monitoring.map* parameters"], controller="MapController", service="MapConfigService",
       call="config()", seq=["Svc->>DB: SELECT business_parameters (cached)"]),

    ep("GET", "/api/map/snapshot", "Live map snapshot", "Org Manager, Org Operator: own; TrekLink Staff, TrekLink Admin",
       "The initial state the live map draws before it subscribes: every device the caller may see with its "
       "last plotted position, battery, staleness, holder label and open incident, plus the organization's "
       "Field Stations, and the stream cursor to subscribe from (FR-MON-02, FR-MON-03, FR-AUTH-11).",
       "UC-38, UC-41, FR-AUTH-11, FR-MON-02, FR-MON-03, BR-19, BR-21",
       query=[["organizationId", "TrekLink staff: one organization; omit for the fleet", "uuid", "no", f"`{ORG_ID}`"]],
       response={"cursor": 88213, "devices": [SNAP_DEVICE],
                 "fieldStations": [{"id": STATION_ID, "name": "Ta Nang basecamp laptop", "lastSyncAt": NOW, "stale": False}]},
       steps=["Resolve the caller's scope", "Read projections of visible devices", "Read the current stream cursor"],
       controller="MapController", service="LiveMapService", call="snapshot(query, caller)",
       participants=[["Rent", "RentalsService"], ["Dev", "DevicesService"], ["Inc", "IncidentsService"]],
       seq=["Svc->>Rent: visibleDevices(caller)", "Svc->>Dev: projections(ids)", "Svc->>Inc: openByDevices(ids)",
            "Svc->>DB: SELECT max(seq) FROM stream_events"]),

    ep("GET", "/api/telemetry/devices/:id/history", "Device position and telemetry history",
       "Org Manager, Org Operator: own; TrekLink Staff, TrekLink Admin",
       "Positions and telemetry of one device over a period, clipped to the periods the caller's "
       "organization rented it (from handover to check-in). Unplotted implausible positions are excluded "
       "(FR-MON-07, FR-MON-04).", "UC-40, FR-AUTH-11, FR-MON-07, BR-19",
       path=[["id", "Device id", "uuid", f"`{DEVICE_ID}`"]],
       query=[["from", "Inclusive start", "datetime", "yes", "`2026-10-20T00:00:00Z`"],
              ["to", "Exclusive end, after from and at most `monitoring.historyMaxRangeDays` (7) days later", "datetime", "yes", "`2026-10-21T00:00:00Z`"],
              ["kind", "`POSITION`, `TELEMETRY` or both", "enum[]", "no", "`[\"POSITION\"]`"],
              ["format", "`json` or `csv`", "enum", "no", "`json`"]],
       response={"deviceId": DEVICE_ID, "clippedTo": [{"from": "2026-10-20T02:00:00Z", "to": "2026-10-21T00:00:00Z"}],
                 "points": [{"at": NOW, "kind": "POSITION", "lat": 11.5601, "lon": 108.5402, "altitude": 1320, "batteryPct": 81}]},
       entity="Device", steps=["Ask rentals for the caller's rental periods of the device", "Read events inside them"],
       controller="TelemetryController", service="HistoryService", call="history(id, query, caller)",
       participants=[["Rent", "RentalsService"], ["Gw", "GatewaySyncService"]],
       seq=["Svc->>Rent: rentalPeriods(deviceId, orgId)", "Svc->>Gw: events(deviceId, periods, kinds)"]),

    ep("GET", "/api/telemetry/devices", "Organization API: devices and last state", "Organization API key",
       "For the organization's own system: every device it currently rents with its last position, battery, "
       "staleness and holder label (UC-39). Authenticated by `X-Api-Key`, read-only, rate limited "
       "(`monitoring.apiRateLimitPerMinute`, E04-5).", "UC-39, FR-AUTH-11, FR-MON-06, FR-ORG-06, BR-20",
       query=API_KEY_HDR, response={"cursor": 88213, "devices": [SNAP_DEVICE]},
       errors=[(429, "RATE_LIMITED", "More requests than the key's limit", "Too many requests. Retry after 12 seconds.")],
       steps=["Hash and look up the key, record lastUsedAt", "Apply the rate limit", "Read the organization's devices"],
       controller="OrgApiController", service="OrgApiService", call="devices(apiKey)",
       actor="Organization system", participants=[["Org", "OrganizationsService"]],
       seq=["Svc->>Org: resolveApiKey(key)", "Svc->>DB: SELECT projections"]),

    ep("GET", "/api/telemetry/stream", "Organization API: replay the stream", "Organization API key",
       "Returns the organization's stream entries after a cursor (positions, telemetry, staleness and "
       "incident changes), oldest first, at most `limit`. A client polls with its last cursor, or uses the "
       "WebSocket for push ([ws-live-contract.md](ws-live-contract.md)). A cursor older than the retention "
       "window answers 410 and the client re-reads the snapshot (FR-MON-05, FR-MON-06).",
       "UC-39, FR-MON-05, FR-MON-06, E04-3",
       query=API_KEY_HDR + [["after", "Last cursor seen", "int", "yes", "`88213`"], ["limit", "At most 500", "int", "no", "`200`"]],
       response={"entries": [{"seq": 88214, "type": "device.position", "deviceId": DEVICE_ID,
                              "payload": {"lat": 11.5603, "lon": 108.5405, "at": NOW}, "createdAt": NOW},
                             {"seq": 88215, "type": "incident.changed", "deviceId": DEVICE_ID,
                              "payload": {"incidentId": INCIDENT_ID, "state": "NOTIFY_PRIMARY"}, "createdAt": NOW}],
                 "nextCursor": 88215, "hasMore": False},
       errors=[(410, "CURSOR_EXPIRED", "The cursor is older than monitoring.streamRetentionHours",
                "The cursor has expired. Reload the snapshot."),
               (429, "RATE_LIMITED", "More requests than the key's limit", "Too many requests. Retry after 12 seconds.")],
       steps=["Resolve the key", "Check retention", "Read stream_events WHERE organizationId AND seq > after"],
       controller="OrgApiController", service="StreamService", call="replay(apiKey, after, limit)",
       actor="Organization system", seq=["Svc->>DB: SELECT stream_events ORDER BY seq LIMIT n"]),

    ep("GET", "/api/system-health", "System health", "TrekLink Admin",
       "Ingestion rate, duplicate and malformed counts, Field Station connectivity, Stage B devices "
       "buffering, failed alert deliveries and the platform health (FR-MON-10, FR-EVT-13). "
       "`fieldStations.items[]` lists every station that is not revoked with its health and `outdated` "
       "against `currentRelease` (organizations REQ-EVT-11); queue depths are named per priority, P0 to P3 "
       "(D-057 rule 9).",
       "UC-42, FR-EVT-13, FR-MON-10",
       query=[["windowMinutes", "Look-back for rates, default 60", "int", "no", "`60`"]],
       response={"health": {"status": "ok", "components": {"database": "up", "mqtt": "up"}},
                 "ingestion": {"perMinute": 41.2, "accepted": 2471, "duplicates": 12, "malformed": 0, "unknownDevice": 1},
                 "fieldStations": {"total": 6, "stale": 1, "outdated": 1, "currentRelease": "1.2.0",
                                   "maxQueueDepth": {"p0": 0, "p1": 0, "p2": 14, "p3": 230},
                                   "items": [{"id": STATION_ID, "name": "Ta Nang basecamp laptop",
                                              "organization": {"id": ORG_ID, "name": "ACME Trek Co., Ltd."},
                                              "lastSyncAt": NOW, "stale": False,
                                              "queueDepth": {"p0": 0, "p1": 0, "p2": 14, "p3": 230},
                                              "oldestRetryCount": 2, "version": "1.1.0", "outdated": True}]},
                 "devicesBuffering": 2, "alerts": {"pending": 0, "failed": 1}},
       steps=["Collect from platform, gateway-sync, organizations and incidents services"],
       controller="SystemHealthController", service="SystemHealthService", call="report(query)",
       participants=[["Gw", "GatewaySyncService"], ["Org", "OrganizationsService"], ["Inc", "IncidentsService"]],
       seq=["Svc->>Gw: stats(window)", "Svc->>Org: fieldStationHealth()", "Svc->>Inc: alertDeliveryStats()"]),
    ep("GET", "/api/devices/:id/history", "Device history", "TrekLink Staff, TrekLink Admin",
       "Read-only chronological history of a device: state changes, intake checks, provisioning, resets, "
       "inspections, maintenance, contracts and incidents, each with actor and UTC time (FR-DEV-11). Served by "
       "`monitoring`, the read model that may import every module, so `devices` imports neither `rentals` nor "
       "`incidents`.", "UC-53, UC-58, FR-DEV-11",
       path=[["id", "Device id", "uuid", f"`{DEVICE_ID}`"]],
       query=[["pageNumber", "1-based page", "int", "no", "`1`"], ["pageSize", "Items per page", "int", "no", "`20`"]],
       response=paged({"at": NOW, "kind": "STATE", "summary": "RETURNED to AVAILABLE", "actor": "Tran Thi B",
                       "refType": "INSPECTION", "refId": "in-1"}, 37),
       entity="Device", steps=["Merge the device's own trail with contracts and incidents"],
       controller="DeviceHistoryController", service="DeviceHistoryService", call="history(id, query)",
       participants=[["Dev", "DevicesService"], ["Rent", "RentalsService"], ["Inc", "IncidentsService"]],
       seq=["Svc->>Dev: trail(id)", "Svc->>Rent: contractsOfDevice(id)", "Svc->>Inc: incidentsOfDevice(id)"]),

    ep("GET", "/api/reports/:kind", "Reports", "TrekLink Staff, TrekLink Admin",
       "Utilization, revenue per variant, overdue contracts, lost units, and time-to-acknowledge and "
       "time-to-resolve over a date range; `format=csv` returns the rows as CSV text in `result` (FR-BILL-10). "
       "The period must end after it starts and span at most `monitoring.reportMaxRangeDays` (366) days, "
       "otherwise 400 `VALIDATION_FAILED` (D-057 rule 10). Row shape per kind: "
       "`utilization` {variant, unitsInService, rentedUnitDays, availableUnitDays, utilizationPct}; "
       "`revenue` {variant, invoicedVnd, paidVnd, outstandingVnd}; "
       "`overdue` {contractId, contractCode, organization, endDate, daysOverdue, unitsOut, lateFeeVnd, state}, as of `to`; "
       "`lost` {lossCaseId, assetTag, variant, organization, contractId, contractCode, lostAt, lossCaseState, chargeVnd}; "
       "`incident-times` {organization, incidents, ackMedianSec, ackP95Sec, resolveMedianSec, resolveP95Sec}, "
       "one row per organization plus one row with `organization` null computed over every incident of the period. "
       "`utilizationPct` is rented unit-days over unit-days in service. The ids let a row link to its detail page "
       "(D-059 rule 6).",
       "UC-59, FR-BILL-10",
       path=[["kind", "`utilization`, `revenue`, `overdue`, `lost`, `incident-times`", "enum", "`revenue`"]],
       query=[["from", "Inclusive start", "date", "yes", "`2026-10-01`"], ["to", "Exclusive end", "date", "yes", "`2026-11-01`"],
              ["format", "`json` or `csv`", "enum", "no", "`json`"]],
       response={"kind": "revenue", "from": "2026-10-01", "to": "2026-11-01",
                 "rows": [{"variant": "treklink-v3", "invoicedVnd": 18000000, "paidVnd": 13500000,
                           "outstandingVnd": 4500000}]},
       no404=True, steps=["Ask the owning module for each report's rows", "Format as JSON or CSV"],
       controller="ReportsController", service="ReportsService", call="run(kind, query)",
       participants=[["Inc", "IncidentsService"], ["Rent", "RentalsService"], ["Bill", "BillingService"],
                     ["Dev", "DevicesService"]],
       seq=["Svc->>Bill: revenue(range)", "Svc->>Rent: utilization(range), overdue(asOf)",
            "Svc->>Dev: lostUnits(range)", "Svc->>Inc: responseTimes(range)"]),
]

NOTES = ("Live push is the Socket.io contract in [ws-live-contract.md](ws-live-contract.md). The staleness "
         "sweep and stream pruning are scheduler jobs with no endpoint (monitoring design §3).")
