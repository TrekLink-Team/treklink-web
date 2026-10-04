from ._common import ORG_ID, DEVICE_ID, INCIDENT_ID, STATION_ID, NOW, ep, paged

EVENT = {"seq": 88213, "eventId": "5d41402abc4b2a76b9719d911017c592...", "deviceId": DEVICE_ID, "assetTag": "TL-0042",
         "organizationId": ORG_ID, "ingress": "FIELD_STATION", "uplinkKey": "fs-org-0007-1", "kind": "POSITION",
         "priority": "P2_GPS", "observedAt": "2026-10-20T03:14:58Z", "receivedAt": NOW, "latitude": 11.5601,
         "longitude": 108.5402, "altitude": 1320, "batteryPct": 81, "rssi": -97, "snr": 6.25, "hopsAway": 1,
         "plotted": True, "incidentId": None}
INTERNAL = ("Broker only: the request must come from the broker's network and carry "
            "`X-Broker-Secret` equal to `MQTT_AUTH_HOOK_SECRET`")

ENDPOINTS = [
    ep("POST", "/api/internal/mqtt/user", "Broker credential check", "Internal (broker)",
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
       errors=[(401, "BROKER_SECRET", "The hook secret is missing or wrong", "Authentication required."),
               (403, "CREDENTIAL_REJECTED", "Unknown username, wrong secret, revoked credential or closed organization",
                "Denied.")],
       steps=["Check X-Broker-Secret", "Resolve the username: backend, fleet node or Field Station",
              "bcrypt.compare the secret against secretHash", "Return 200 or 403"],
       actor="Mosquitto", controller="BrokerAuthController", service="BrokerAuthService", call="checkUser(dto)",
       participants=[["Org", "OrganizationsService"]],
       seq=["Svc->>Org: fieldStationByUsername(username)", "Svc->>Svc: bcrypt.compare"]),

    ep("POST", "/api/internal/mqtt/acl", "Broker topic check", "Internal (broker)",
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
       errors=[(401, "BROKER_SECRET", "The hook secret is missing or wrong", "Authentication required."),
               (403, "TOPIC_DENIED", "The topic or access is outside the credential's pattern", "Denied.")],
       steps=["Check X-Broker-Secret", "Match the topic and access against the credential kind's pattern"],
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

    ep("POST", "/api/gateway-sync", "Search the sync audit", "TrekLink Admin", op="listAudit",
       overview="Searches the append-only synchronization audit: one row per ingestion attempt with its "
       "outcome (FR-EVT-11). This is the evidence base for the delivery, duplicate and ordering experiments.",
       traces="UC-42, FR-EVT-05, FR-EVT-11, NFR-REL-03",
       body=[["op", "Literal `listAudit`", "string", "yes", "`listAudit`"],
             ["outcome", "SyncOutcome values", "enum[]", "no", "`[\"DUPLICATE_REJECTED\"]`"],
             ["deviceId", "Device", "uuid", "no", f"`{DEVICE_ID}`"], ["uplinkKey", "Node id or station username", "string", "no", "`fs-org-0007-1`"],
             ["from", "Lower bound", "datetime", "no", "`...`"], ["to", "Upper bound", "datetime", "no", "`...`"],
             ["pageNumber", "1-based", "int", "no", "`1`"], ["pageSize", "Default 100", "int", "no", "`100`"]],
       sample={"op": "listAudit", "outcome": ["DUPLICATE_REJECTED", "MALFORMED_ENVELOPE"], "pageNumber": 1},
       response=paged({"id": "sa-1", "eventId": "5d41...", "nodeNum": 2763113171, "deviceId": DEVICE_ID,
                       "uplinkKey": "fs-org-0007-1", "ingress": "FIELD_STATION", "outcome": "DUPLICATE_REJECTED",
                       "detail": None, "createdAt": NOW}, 9),
       steps=["Dispatch on op", "Read sync_audit_log"], controller="GatewaySyncController",
       service="SyncAuditService", call="listAudit(dto)", seq=["Svc->>DB: SELECT sync_audit_log"]),

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
]

NOTES = ("The MQTT ingress (Stage A, B and C) and the Field Station local page are not HTTP endpoints of "
         "the backend; they are documented in the hand-written contracts below. `POST /api/gateway-sync` is "
         "the D-027 operation endpoint; the broker hooks are separate routes because mosquitto-go-auth calls "
         "fixed URIs.")
