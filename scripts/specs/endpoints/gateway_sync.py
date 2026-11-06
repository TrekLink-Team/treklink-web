from ._common import ORG_ID, DEVICE_ID, INCIDENT_ID, STATION_ID, NOW, ep, paged

EVENT = {"seq": 88213, "eventId": "5d41402abc4b2a76b9719d911017c592...", "deviceId": DEVICE_ID, "assetTag": "TL-0042",
         "organizationId": ORG_ID, "ingress": "FIELD_STATION", "uplinkKey": "fs-org-0007-1", "kind": "POSITION",
         "priority": "P2_GPS", "observedAt": "2026-10-20T03:14:58Z", "receivedAt": NOW, "latitude": 11.5601,
         "longitude": 108.5402, "altitude": 1320, "batteryPct": 81, "rssi": -97, "snr": 6.25, "hopsAway": 1,
         "plotted": True, "incidentId": None}
INTERNAL = ("Broker only, enforced by the secret alone: the request must carry `X-Broker-Secret` equal to "
            "`MQTT_AUTH_HOOK_SECRET`, compared in constant time over SHA-256 digests; the source address is "
            "not checked. go-auth's HTTP "
            "backend sends no custom header, so the opt-in broker of `docker-compose.broker-auth.yml` calls "
            "through `broker-hook-proxy`, which adds it (design §4). Public to the JWT guard: the broker "
            "carries no user token")
DRAFT = ("**Draft, pending supervisor acceptance (D-098 amended)**: built only if the supervisor accepts "
         "it (gateway-sync design §10); MQTT stays the primary uplink.")
# With MQTT_AUTH_HOOK_SECRET unset the hooks do not exist; the default open broker never calls them.
UNSET = (404, "NOT_FOUND", "The hook secret variable is unset", "Not found.")
# BrokerHookSecretGuard runs before body validation: unset variable first, then the secret.
SECRET_FIRST = [("MQTT_AUTH_HOOK_SECRET unset", 404, "NOT_FOUND"),
                ("X-Broker-Secret missing or wrong", 401, "BROKER_SECRET")]

ENDPOINTS = [
    ep("POST", "/api/internal/mqtt/user", "Broker credential check", "Public (broker hook secret)",
       "Called by the mosquitto-go-auth HTTP backend (`auth_opt_http_getuser_uri`, JSON params, status "
       "response mode) when a client connects. Allows the backend's subscriber, Stage A and B fleet nodes, and "
       "Field Station credentials that are not revoked and whose organization is not `CLOSED`; a "
       "`SUSPENDED` organization still connects, because its devices stay monitored (BR-32). Any non-2xx denies.",
       "FR-EVT-14, D-037, BR-20, NFR-SEC-02",
       body=[["username", "MQTT username", "string", "yes", "`fs-org-0007-1`"],
             ["password", "MQTT password", "string", "yes", "`fs_s3cr3t...`"],
             ["clientid", "MQTT client id", "string", "yes", "`fieldstation-7f3a`"]],
       sample={"username": "fs-org-0007-1", "password": "fs_s3cr3t...", "clientid": "fieldstation-7f3a"},
       response={"allowed": True, "kind": "FIELD_STATION"}, message="OK", notes=INTERNAL,
       errors=[(401, "BROKER_SECRET", "The hook secret is missing or wrong", "Authentication required."), UNSET,
               (403, "CREDENTIAL_REJECTED", "Unknown username, wrong secret, revoked credential or closed organization",
                "Denied.")],
       guards_first=SECRET_FIRST,
       steps=["Resolve the username: backend, fleet node or Field Station",
              "bcrypt.compare the password against secretHash, or a dummy hash when the station is unknown", "Return 200 or 403"],
       actor="Mosquitto", controller="BrokerAuthController", service="BrokerAuthService", call="checkUser(dto)",
       participants=[["Org", "OrganizationsService"]],
       seq=["Svc->>Org: fieldStationByUsername(username)", "Svc->>Svc: bcrypt.compare"]),

    ep("POST", "/api/internal/mqtt/acl", "Broker topic check", "Public (broker hook secret)",
       "Called per publish and subscribe (`auth_opt_http_aclcheck_uri`). A Field Station may publish only "
       "under `treklink/fs/<its username>/#` and never subscribe; a fleet node only under its own Stage A "
       "topics; the backend subscriber may subscribe to `treklink/#` and publish nothing. Which devices a "
       "station may report for is enforced at ingestion, not here (FR-EVT-14).",
       "FR-EVT-14, D-037",
       body=[["username", "MQTT username", "string", "yes", "`fs-org-0007-1`"],
             ["clientid", "Client id", "string", "yes", "`fieldstation-7f3a`"],
             ["topic", "Topic", "string", "yes", "`treklink/fs/fs-org-0007-1/2/json/LongFast/!a4b1c2d3`"],
             ["acc", "1 read, 2 write, 3 readwrite, 4 subscribe", "int", "yes", "`2`"]],
       sample={"username": "fs-org-0007-1", "clientid": "fieldstation-7f3a",
               "topic": "treklink/fs/fs-org-0007-1/2/json/LongFast/!a4b1c2d3", "acc": 2},
       response={"allowed": True}, message="OK", notes=INTERNAL,
       errors=[(401, "BROKER_SECRET", "The hook secret is missing or wrong", "Authentication required."), UNSET,
               (403, "TOPIC_DENIED", "The topic or access is outside the credential's pattern", "Denied.")],
       guards_first=SECRET_FIRST,
       steps=["Match the topic and access against the credential kind's pattern"],
       actor="Mosquitto", controller="BrokerAuthController", service="BrokerAuthService", call="checkAcl(dto)",
       seq=["Svc->>Svc: pattern match (cached per username for 60 s)"]),

    ep("POST", "/api/gateway-sync", "List field events", "TrekLink Staff, TrekLink Admin", op="listEvents",
       overview="Paged query over the append-only field-event ledger, ordered by ingestion `seq`: the raw "
       "view behind map trails and an incident's episode. Organization members read history through "
       "monitoring (FR-MON-07), never here.",
       traces="UC-26, FR-EVT-01, FR-EVT-11",
       body=[["op", "Literal `listEvents`", "string", "yes", "`listEvents`"],
             ["deviceId", "Device", "uuid", "no", f"`{DEVICE_ID}`"],
             ["organizationId", "Renting organization at ingestion", "uuid", "no", f"`{ORG_ID}`"],
             ["kind", "EventKind values", "enum[]", "no", "`[\"SOS\"]`"],
             ["incidentId", "Events of one episode", "uuid", "no", f"`{INCIDENT_ID}`"],
             ["from", "receivedAt lower bound", "datetime", "no", "`2026-10-20T00:00:00Z`"],
             ["to", "receivedAt upper bound", "datetime", "no", "`2026-10-20T06:00:00Z`"],
             ["pageNumber", "1-based", "int", "no", "`1`"], ["pageSize", "Default 100, at most 500", "int", "no", "`100`"]],
       sample={"op": "listEvents", "deviceId": DEVICE_ID, "kind": ["POSITION", "SOS"], "from": "2026-10-20T00:00:00Z",
               "to": "2026-10-20T06:00:00Z", "pageNumber": 1, "pageSize": 100},
       response=paged(EVENT, 214), steps=["Dispatch on op", "Read field_events by seq"],
       controller="GatewaySyncController", service="FieldEventQueryService", call="listEvents(dto)",
       seq=["Svc->>DB: SELECT field_events ORDER BY seq"]),

    ep("POST", "/api/gateway-sync", "Search the sync audit", "TrekLink Staff, TrekLink Admin", op="listAudit",
       overview="Searches the append-only synchronization audit: one row per ingestion attempt with its "
       "outcome (FR-EVT-11), newest first (`createdAt`, then `id`). This is the evidence base for the delivery, "
       "duplicate and ordering experiments, and the audit list of the Field data sync page. Needs `read "
       "FieldEvent` (`fieldEvent.read`), as `listEvents` does (2026-11-01, KhoaDD under D-078; it read TrekLink "
       "Admin before). `rawExcerpt` is the stored raw payload of a `MALFORMED_ENVELOPE` row, its text or its "
       "JSON serialized, cut to the first 500 Unicode code points with `rawTruncated` true when longer; it is null for "
       "every other outcome. `assetTag` is the device's, null when the row names no device.",
       traces="UC-42, FR-EVT-05, FR-EVT-11, NFR-REL-03",
       body=[["op", "Literal `listAudit`", "string", "yes", "`listAudit`"],
             ["outcome", "SyncOutcome values", "enum[]", "no", "`[\"DUPLICATE_REJECTED\"]`"],
             ["deviceId", "Device", "uuid", "no", f"`{DEVICE_ID}`"], ["uplinkKey", "Node id or station username, at most 64 characters", "string", "no", "`fs-org-0007-1`"],
             ["from", "Lower bound of `createdAt`, inclusive", "datetime", "no", "`...`"], ["to", "Upper bound of `createdAt`, inclusive", "datetime", "no", "`...`"],
             ["pageNumber", "1-based", "int", "no", "`1`"], ["pageSize", "Default 100, at most 500", "int", "no", "`100`"]],
       sample={"op": "listAudit", "outcome": ["DUPLICATE_REJECTED", "MALFORMED_ENVELOPE"], "pageNumber": 1},
       response=paged({"id": "sa-1", "eventId": "5d41...", "nodeNum": 2763113171, "deviceId": DEVICE_ID,
                       "assetTag": "TL-0009", "uplinkKey": "fs-org-0007-1", "ingress": "FIELD_STATION",
                       "outcome": "DUPLICATE_REJECTED", "detail": None, "rawExcerpt": None,
                       "rawTruncated": False, "createdAt": NOW}, 9),
       steps=["Dispatch on op", "Read sync_audit_log", "Cut the raw payload of a malformed row"],
       controller="GatewaySyncController",
       service="SyncAuditService", call="listAudit(dto)", seq=["Svc->>DB: SELECT sync_audit_log ORDER BY createdAt DESC"]),

    ep("POST", "/api/gateway-sync", "Replay a quarantined message", "TrekLink Admin", op="replayAudit",
       overview="Re-runs ingestion on the stored raw message of an `UNKNOWN_DEVICE` audit row, after Staff "
       "registered the device. Idempotent: an `eventId` already stored ends as `DUPLICATE_REJECTED` (BR-11).",
       traces="UC-26, FR-EVT-01, BR-11",
       body=[["op", "Literal `replayAudit`", "string", "yes", "`replayAudit`"],
             ["auditId", "Sync audit row with a stored raw message", "uuid", "yes", "`sa-7`"]],
       sample={"op": "replayAudit", "auditId": "sa-7"},
       response={"auditId": "sa-7", "newAuditId": "sa-9123", "outcome": "ACCEPTED", "eventId": "9a0b..."},
       errors=[(404, "NOT_FOUND", "No such audit row", "Audit row not found."),
               (409, "NOT_REPLAYABLE", "The row has no raw message or its outcome is not UNKNOWN_DEVICE",
                "This cannot be done while it is ACCEPTED.")],
       steps=["Dispatch on op", "Load the raw message", "Run the ingestion pipeline", "Write a new audit row"],
       controller="GatewaySyncController", service="IngestionService", call="replay(auditId, actor)",
       seq=["Svc->>DB: SELECT sync_audit_log", "Svc->>Svc: ingest(raw)", "Svc->>DB: INSERT field_events?, sync_audit_log"]),

    ep("POST", "/api/gateway-sync", "Device queue reports", "TrekLink Staff, TrekLink Admin", op="listQueueReports",
       overview="Lists the Stage B on-device queue health reports of one device: depth, enqueued, published "
       "and shed per tier, and reboot detection (NFR-IF-01).",
       traces="UC-42, NFR-IF-01, NFR-REL-05",
       body=[["op", "Literal `listQueueReports`", "string", "yes", "`listQueueReports`"],
             ["deviceId", "Device", "uuid", "yes", f"`{DEVICE_ID}`"], ["from", "Lower bound", "datetime", "no", "`...`"],
             ["pageNumber", "1-based", "int", "no", "`1`"]],
       sample={"op": "listQueueReports", "deviceId": DEVICE_ID},
       response=paged({"receivedAt": NOW, "capacity": 64, "depth": [0, 0, 2, 9], "shed": [0, 0, 0, 4],
                       "p0Refused": 0, "rebootDetected": False}, 31),
       steps=["Dispatch on op", "Read device_queue_reports"], controller="GatewaySyncController",
       service="QueueReportService", call="list(dto)", seq=["Svc->>DB: SELECT device_queue_reports"]),

    ep("POST", "/api/gateway-sync", "Field data sync status", "TrekLink Staff, TrekLink Admin", op="syncStatus",
       overview="MF-02 end to end for TrekLink Staff and Admin: the backend's MQTT subscriber connection, "
       "every Field Station that is not revoked with its connection state, queue depth per priority (D-057 "
       "rule 9), last sync, last flush and version, and the window's ingestion outcomes from the sync audit "
       "(FR-EVT-13, FR-EVT-18): `accepted` (`ACCEPTED`), `acceptedUnattributed` (`ACCEPTED_UNATTRIBUTED`, "
       "REQ-ERR-06), `duplicates` (`DUPLICATE_REJECTED`), `malformed` (`MALFORMED_ENVELOPE`, REQ-ERR-01), "
       "`normalizationFailed` (`NORMALIZATION_FAILED`, REQ-ERR-05) and `unknownDevice` (`UNKNOWN_DEVICE`), "
       "each 0 when the window holds none. Needs `read FieldEvent` and `read FieldStation`.",
       traces="UC-26, UC-42, FR-EVT-01, FR-EVT-13, FR-EVT-18",
       body=[["op", "Literal `syncStatus`", "string", "yes", "`syncStatus`"],
             ["windowMinutes", "Ingestion look-back, default 60, at most 1440", "int", "no", "`60`"]],
       sample={"op": "syncStatus", "windowMinutes": 60},
       response={
           "broker": {"subscriber": "up"},
           "staleAfterSeconds": 180,
           "fieldStations": [{
               "id": STATION_ID, "name": "Ta Nang basecamp laptop", "mqttUsername": "fs-org-0001-1",
               "organization": {"id": ORG_ID, "code": "ORG-0001", "name": "TrekLink Demo Tours Co., Ltd."},
               "connection": "CONNECTED", "lastSyncAt": NOW, "lastFlushAt": NOW,
               "queueDepth": {"p0": 0, "p1": 0, "p2": 2, "p3": 9}, "oldestRetryCount": 0, "version": "0.1.0",
           }],
           "ingestion": {
               "windowMinutes": 60, "accepted": 26, "acceptedUnattributed": 1, "duplicates": 10,
               "malformed": 0, "normalizationFailed": 0, "unknownDevice": 2, "lastReceivedAt": NOW,
           },
       },
       steps=["Dispatch on op", "Read the MQTT health probe, the active Field Stations and the window's "
              "sync audit outcomes"],
       controller="GatewaySyncController", service="SyncStatusService", call="status(dto)",
       participants=[["Stations", "FieldStationsService"]],
       seq=["Svc->>Stations: activeWithHealth()", "Svc->>DB: GROUP BY outcome FROM sync_audit_log"]),
    # Draft, pending supervisor acceptance (D-098 amended): the HTTPS ingest fallback of design §10.
    ep("POST", "/api/gateway-sync/ingest", "Ingest a Field Station batch over HTTPS",
       "Public (Field Station credential)",
       banner=DRAFT,
       overview="The HTTPS fallback of the Stage C uplink, for a deployment that hosts no MQTT broker, such "
       "as the Vercel staging (design §10). Each element of `packets` is exactly a Stage C MQTT message "
       "(mqtt-ingress-contract.md: the stock JSON plus `fs_captured_at` and `fs_sent_at`), and goes "
       "through the same `FieldStationJsonAdapter` decoding and `IngestionService.ingest` as that message, "
       "with ingress `FIELD_STATION` and the authenticated username as the uplink key: same `eventId` "
       "(D-006), same deduplication, occurrence time, attribution, audit row and outcomes. A packet sent "
       "over MQTT and over HTTPS is stored once (BR-11). Packets are ingested one at a time in array order "
       "with one `receivedAt` for the request, and the answer lists one result per packet in that order; "
       "the Field Station removes exactly the rows listed. An optional `health` member is the "
       "`treklink.fs_health` report of the station's health topic and is recorded the same way. MQTT "
       "stays the primary uplink: the Field Station uses this route only when no broker is configured "
       "(REQ-EVT-19).",
       traces="UC-26, UC-27, FR-EVT-01, FR-EVT-02, FR-EVT-11, FR-EVT-13, FR-EVT-14, BR-11, D-037, D-098 amended",
       notes=("Served only with `HTTPS_INGEST_ENABLED=true`; otherwise 404. TLS only: `request.secure`, or "
              "the first `X-Forwarded-Proto` value with `HTTPS_INGEST_TRUST_PROXY=true` (Vercel). "
              "Authentication: `Authorization: Basic base64(username:secret)`, the Username and Secret of the "
              "station's existing Field Station credential (organizations api-design 24, D-037), checked by "
              "`StationCredentialVerifier`, the check the broker hook of api-design 01 makes: one bcrypt "
              "compare on every path, one refusal code for every reason. Public to the JWT guard, as the "
              "broker hooks are: the caller is a station, not a user, and no permission is added. The station "
              "is taken from the credential, never from the body. Limits from `ParameterService` (D-015), read "
              "per request: `gatewaySync.httpsIngestMaxBatch` packets per request, "
              "`gatewaySync.httpsIngestRequestsPerMinute` requests per username, counted before the secret "
              "compare. Result `outcome` is a `SyncOutcome` value, `IGNORED` for a type ingestion does not "
              "read (no audit row, as on MQTT) or `FAILED` for an unexpected error, logged and acknowledged as "
              "the MQTT subscriber does. `eventId` is null when the packet has no valid `from` and `id`. "
              "`health` is `RECORDED`, `DROPPED` (invalid report) or null (none sent)."),
       body=[["packets", "Stage C messages, at most `gatewaySync.httpsIngestMaxBatch`; may be empty when "
              "`health` is present", "object[]", "yes", "see the sample"],
             ["packets[].id, from, timestamp, type, sender, payload", "The stock Meshtastic JSON members of "
              "mqtt-ingress-contract.md, Message", "mixed", "yes", "`1834576211`"],
             ["packets[].fs_captured_at", "Station clock when the packet came off the serial port", "uint64 epoch ms", "yes", "`1762394400250`"],
             ["packets[].fs_sent_at", "Station clock when this request was sent; the same value for every packet of the request", "uint64 epoch ms", "yes", "`1762394460000`"],
             ["health", "The `treklink.fs_health` report of mqtt-ingress-contract.md, Field Station health", "object", "no", "see the sample"]],
       sample={"packets": [
                   {"id": 2000001, "from": 3724541961, "to": 4294967295, "channel": 0, "timestamp": 1762394400,
                    "type": "text", "sender": "!de000009", "payload": {"text": "SOS - "},
                    "fs_captured_at": 1762394400250, "fs_sent_at": 1762394460000},
                   {"id": 2000002, "from": 3724541962, "to": 4294967295, "channel": 0, "timestamp": 1762394405,
                    "type": "position", "sender": "!de000009",
                    "payload": {"latitude_i": 115601000, "longitude_i": 1085402000, "altitude": 1320},
                    "rssi": -97, "snr": 6.25, "hops_away": 1,
                    "fs_captured_at": 1762394405100, "fs_sent_at": 1762394460000}],
               "health": {"schema": "treklink.fs_health", "v": 1, "version": "0.2.0", "depth": [0, 0, 2, 9],
                          "oldest_attempts": 1, "last_flush_at": 1762394400000, "sent_at": 1762394460000}},
       response={"receivedAt": "2026-11-06T02:01:00.120Z",
                 "results": [{"index": 0, "eventId": "3f1c9a...", "outcome": "ACCEPTED"},
                             {"index": 1, "eventId": "b07e42...", "outcome": "DUPLICATE_REJECTED"}],
                 "health": "RECORDED"},
       fields=[["receivedAt", "The one receipt time of the request, the `receivedAt` of every packet", "datetime", "`2026-11-06T02:01:00.120Z`"],
               ["results[].index", "Position of the packet in `packets`", "int", "`0`"],
               ["results[].eventId", "`sha256(from + \":\" + id)`, lower-case hex; null when the packet has none", "string or null", "`3f1c9a...`"],
               ["results[].outcome", "`SyncOutcome`, or `IGNORED` or `FAILED`", "enum", "`ACCEPTED`"],
               ["health", "`RECORDED`, `DROPPED` or null", "enum or null", "`RECORDED`"]],
       message="Batch ingested.",
       errors=[(413, "PAYLOAD_TOO_LARGE", "The body exceeds `HTTP_BODY_LIMIT`", "The request body is too large."),
               (404, "NOT_FOUND", "`HTTPS_INGEST_ENABLED` is not true", "Not found."),
               (403, "TLS_REQUIRED", "The request did not arrive over TLS", "Use HTTPS."),
               (401, "UNAUTHENTICATED", "The `Authorization` header is missing or not Basic with a username and secret",
                "Authentication required."),
               (429, "RATE_LIMITED", "This username sent more than `gatewaySync.httpsIngestRequestsPerMinute` "
                "requests this minute; `Retry-After` gives the seconds to wait", "Too many requests. Try again in a minute."),
               (403, "CREDENTIAL_REJECTED", "Unknown username, wrong secret, revoked station or `CLOSED` organization",
                "Denied."),
               (400, "BATCH_TOO_LARGE", "More packets than `gatewaySync.httpsIngestMaxBatch`",
                "Send at most 50 packets per request."),
               (503, "INGEST_UNAVAILABLE", "The database became unreachable during the batch; packets before it "
                "stay stored and a resend is deduplicated", "Ingestion is unavailable. Retry later.")],
       error_details={"BATCH_TOO_LARGE": {"maxBatch": 50}},
       activity=[
           "S((Start))", 'B0{"Body over HTTP_BODY_LIMIT?"}', "S --> B0",
           'BE0["Return 413 PAYLOAD_TOO_LARGE"]', "B0 -->|yes| BE0", "BE0 --> BX0((End))",
           'G0{"HTTPS_INGEST_ENABLED not true?"}', "B0 -->|no| G0",
           'GE0["Return 404 NOT_FOUND"]', "G0 -->|yes| GE0", "GE0 --> GX0((End))",
           'G1{"Not over TLS?"}', "G0 -->|no| G1",
           'GE1["Return 403 TLS_REQUIRED"]', "G1 -->|yes| GE1", "GE1 --> GX1((End))",
           'G2{"Authorization missing or not Basic?"}', "G1 -->|no| G2",
           'GE2["Return 401 UNAUTHENTICATED"]', "G2 -->|yes| GE2", "GE2 --> GX2((End))",
           'G3{"Over the requests per minute of this username?"}', "G2 -->|no| G3",
           'GE3["Return 429 RATE_LIMITED with Retry-After"]', "G3 -->|yes| GE3", "GE3 --> GX3((End))",
           'G4{"Credential refused? one bcrypt compare"}', "G3 -->|no| G4",
           'GE4["Return 403 CREDENTIAL_REJECTED"]', "G4 -->|yes| GE4", "GE4 --> GX4((End))",
           'V0{"Body not packets and optional health?"}', "G4 -->|no| V0",
           'VE0["Return 400 VALIDATION_FAILED"]', "V0 -->|yes| VE0", "VE0 --> VX0((End))",
           'V1{"More packets than httpsIngestMaxBatch?"}', "V0 -->|no| V1",
           'VE1["Return 400 BATCH_TOO_LARGE"]', "V1 -->|yes| VE1", "VE1 --> VX1((End))",
           'R0["Take one receivedAt"]', "V1 -->|no| R0",
           'L0{"Next packet?"}', "R0 --> L0",
           'P0["adaptMessage, then ingest or rejectMalformed; audit row"]', "L0 -->|yes| P0",
           'T0{"Database unreachable?"}', "P0 --> T0",
           'TE0["Return 503 INGEST_UNAVAILABLE; earlier packets stay stored"]', "T0 -->|yes| TE0", "TE0 --> TX0((End))",
           'P1["Record the outcome in results"]', "T0 -->|no| P1", "P1 --> L0",
           'H0["Record health when present"]', "L0 -->|no| H0",
           'OK["Return 200 with one result per packet"]', "H0 --> OK", "OK --> Z((End))"],
       sequence=[
           "participant F as Field Station (HttpsUplinkClient)",
           "participant C as StationIngestController",
           "participant G as StationCredentialGuard",
           "participant O as FieldStationsService",
           "participant S as StationIngress",
           "participant I as IngestionService",
           "participant DB as Postgres",
           "F->>C: POST /api/gateway-sync/ingest, Basic credential",
           "C->>G: canActivate: enabled, TLS, header, rate",
           "G->>O: byUsername(username)",
           "O-->>G: secretHash, revokedAt, organizationStatus",
           "G->>G: StationCredentialVerifier.verify, one bcrypt compare",
           "C->>C: validate body, batch size",
           "C->>S: ingestBatch(username, packets, health, receivedAt)",
           "loop each packet in array order",
           "    S->>I: ingest(envelope) or rejectMalformed(...)",
           "    I->>DB: INSERT field_events ON CONFLICT eventId DO NOTHING, sync_audit_log",
           "    I-->>S: SyncOutcome",
           "end",
           "opt health present",
           "    S->>O: recordStationHealth(id, health)",
           "end",
           "S-->>C: results, health",
           "C-->>F: 200 envelope"],
       sequence_note="The refusals of the guard (401, 403, 404, 429), the body checks (400, 413) and the 503 "
                     "of a database outage mid-batch are in the Validation table and the activity diagram; "
                     "the steps inside `IngestionService.ingest` are design Figures 5 and 6."),
]

NOTES = ("The MQTT ingress (Stage A, B and C) and the Field Station local page are not HTTP endpoints of "
         "the backend; they are documented in the hand-written contracts below. `POST /api/gateway-sync` is "
         "the D-027 operation endpoint; the broker hooks are separate routes because mosquitto-go-auth calls "
         "fixed URIs." + (" Draft (D-098 amended): 08, `POST /api/gateway-sync/ingest`, is the HTTPS fallback of the Stage C "
         "uplink for a deployment with no MQTT broker (design §10), a separate route because a Field Station "
         "authenticates with its station credential, not a user token. It is built only if the supervisor "
         "accepts it."))

# The index carries the draft line while endpoint 08 is pending acceptance; remove both on acceptance.
BANNER = ("**Draft, pending supervisor acceptance (D-098 amended)**: endpoint 08 and its note below. "
          "Endpoints 01 to 07 keep their status.")
