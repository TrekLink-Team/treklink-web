from ._common import (USER_ID, ORG_ID, DEVICE_ID, CONTRACT_ID, INCIDENT_ID, NOW, ep, paged, PAGE_QUERY,
                      state_409, STALE)

INC = {"id": INCIDENT_ID, "code": "INC-2026-000045", "device": {"id": DEVICE_ID, "assetTag": "TL-0042",
                                                                 "holder": {"name": "Le Thi E", "phone": "0912345678"}},
       "organizationId": ORG_ID, "contractId": CONTRACT_ID, "state": "NOTIFY_PRIMARY", "stateChangedAt": NOW,
       "source": "DEVICE_FALL", "confidence": "CONFIRMED", "firstEventAt": "2026-10-20T03:14:52Z",
       "lastEventAt": NOW, "eventCount": 4, "lastPosition": {"lat": 11.5601, "lon": 108.5402}, "stale": False,
       "owner": None, "tierDeadlineAt": "2026-10-20T03:17:00Z", "statusDueAt": None, "reopenCount": 0,
       "version": 1}
I_PATH = ["id", "Incident id; members may use only their own organization's", "uuid", f"`{INCIDENT_ID}`"]
VERSION = ["expectedVersion", "Incident version the caller saw", "int", "yes", "`1`"]
TAKEN = (409, "ALREADY_OWNED", "Another member acknowledged first (compare-and-set lost)",
         "Pham Van D took this incident at 10:15.")
NOT_OWNER = (403, "NOT_OWNER", "Only the member who owns the response may do this", "You do not have access to this.")
SEQ = ["Svc->>DB: BEGIN, SELECT incident FOR UPDATE", "Svc->>Svc: transition table lookup, guards",
       "Svc->>DB: UPDATE incident SET state, version+1 WHERE version = expected",
       "Svc->>DB: INSERT incident_transitions, alert_deliveries (outbox), COMMIT", "Svc-)Svc: dispatcher delivers outbox"]

ENDPOINTS = [
    ep("GET", "/api/incidents", "List incidents", "Org Manager, Org Operator: own; TrekLink Staff, TrekLink Admin",
       "Lists incidents with state filters. Organization members see their organization's incidents; "
       "TrekLink staff see every incident, and `state=UNROUTED,ESCALATED` is their queue.",
       "UC-29, UC-32, FR-AUTH-11",
       query=[["state", "IncidentState, repeatable", "enum", "no", "`NOTIFY_PRIMARY`"],
              ["open", "Every state except CLOSED", "bool", "no", "`true`"],
              ["deviceId", "Device", "uuid", "no", f"`{DEVICE_ID}`"],
              ["from", "createdAt lower bound", "datetime", "no", "`...`"]] + PAGE_QUERY,
       response=paged(INC, 2), steps=["Apply scope", "Read incidents newest first"],
       controller="IncidentsController", service="IncidentsQueryService", call="list(query, caller)",
       seq=["Svc->>DB: SELECT incidents WHERE scope"]),

    ep("GET", "/api/incidents/:id", "Incident detail", "Org Manager, Org Operator: own; TrekLink Staff, TrekLink Admin",
       "Returns the incident with its device and holder label, owner, pending deadline, latest status "
       "updates and authority reports.", "UC-32, UC-33, FR-AUTH-11",
       path=[I_PATH], response={**INC, "statusUpdates": [], "authorityReports": []}, entity="Incident",
       steps=["Read within scope"], controller="IncidentsController", service="IncidentsQueryService",
       call="get(id, caller)", seq=["Svc->>DB: SELECT incident, updates, reports"]),

    ep("POST", "/api/incidents/:id/acknowledge", "Acknowledge an incident", "Org Manager, Org Operator: own",
       "One step, no required field (NFR-USE-02). Moves a `NOTIFY_*`, `ESCALATED` or `REPORTED` incident to "
       "`ACKNOWLEDGED` with the caller as owner; that time is time-to-acknowledge. A concurrent second "
       "acknowledgement loses the compare-and-set and is shown the owner (FR-INC-06, E03-3, MSG27).",
       "UC-32, FR-INC-04, FR-INC-06, BR-15, E03-3, MSG27",
       path=[I_PATH], body=[["note", "Optional first note", "string", "no", "`On my way to the ridge`"], VERSION],
       sample={"expectedVersion": 1},
       response={**INC, "state": "ACKNOWLEDGED", "owner": {"id": USER_ID, "fullName": "Pham Van D"},
                 "tierDeadlineAt": None, "statusDueAt": "2026-10-20T03:45:00Z", "version": 2},
       message="Incident acknowledged", entity="Incident",
       errors=[TAKEN, state_409("incident", "RESOLVED")],
       steps=["Require NOTIFY_*, ESCALATED or REPORTED", "Compare-and-set to ACKNOWLEDGED, set owner",
              "Clear the tier deadline, set statusDueAt", "Write transition and outbox rows"],
       controller="IncidentsController", service="IncidentLifecycleService", call="acknowledge(id, dto, caller)",
       seq=SEQ),

    ep("POST", "/api/incidents/:id/responding", "Report a response under way", "Owner (Org Manager or Org Operator)",
       "The owner reports that a response is under way: `ACKNOWLEDGED` to `RESPONDING`, and the stale timer "
       "restarts (D-034).", "UC-33, FR-INC-04, FR-INC-07",
       path=[I_PATH], body=[["note", "What is being done", "string", "yes", "`Guide team of 3 dispatched`"], VERSION],
       sample={"note": "Guide team of 3 dispatched from camp 2", "expectedVersion": 2},
       response={**INC, "state": "RESPONDING", "statusDueAt": "2026-10-20T04:15:00Z", "version": 3},
       message="Status recorded", entity="Incident", errors=[NOT_OWNER, state_409("incident", "NOTIFY_PRIMARY"), STALE],
       steps=["Require ACKNOWLEDGED and the caller as owner", "Transition, append the status update, reset statusDueAt"],
       controller="IncidentsController", service="IncidentLifecycleService", call="markResponding(id, dto, caller)", seq=SEQ),

    ep("POST", "/api/incidents/:id/status-updates", "Add a status update", "Owner (Org Manager or Org Operator)",
       "Appends a status note during `ACKNOWLEDGED` or `RESPONDING` and resets the stale timer; no state "
       "change. Without one inside the stale limit the incident escalates (FR-INC-07, E03-5).",
       "UC-33, FR-INC-07, E03-5",
       path=[I_PATH], body=[["note", "Status", "string", "yes", "`Reached the holder, minor ankle injury`"]],
       sample={"note": "Reached the holder, minor ankle injury"},
       response={"id": "su-3", "note": "Reached the holder, minor ankle injury", "createdAt": NOW,
                 "statusDueAt": "2026-10-20T04:45:00Z"}, status=201, message="Status recorded", entity="Incident",
       errors=[NOT_OWNER, state_409("incident", "RESOLVED")],
       steps=["Require ACKNOWLEDGED or RESPONDING and the caller as owner", "Insert the update, reset statusDueAt",
              "Emit incident.changed to the organization stream"],
       controller="IncidentsController", service="IncidentLifecycleService", call="addStatus(id, dto, caller)",
       seq=["Svc->>DB: INSERT incident_status_updates; UPDATE incidents.statusDueAt"]),

    ep("POST", "/api/incidents/:id/resolve", "Report the outcome", "Owner (Org Manager or Org Operator)",
       "The owner reports the outcome with a note: `RESOLVED`; that time is time-to-resolve; the reopen "
       "window starts (FR-INC-08, FR-INC-11).", "UC-33, FR-INC-04, FR-INC-08",
       path=[I_PATH], body=[["outcomeNote", "What happened", "string", "yes", "`Walked out with assistance`"], VERSION],
       sample={"outcomeNote": "Walked out to camp 2 with assistance; no evacuation needed.", "expectedVersion": 3},
       response={**INC, "state": "RESOLVED", "statusDueAt": None, "reopenWindowEndsAt": "2026-10-20T05:20:00Z", "version": 4},
       message="Incident resolved", entity="Incident", errors=[NOT_OWNER, state_409("incident", "NOTIFY_BACKUP"), STALE],
       steps=["Require ACKNOWLEDGED or RESPONDING and the caller as owner", "Transition, set resolvedAt and the reopen window"],
       controller="IncidentsController", service="IncidentLifecycleService", call="resolve(id, dto, caller)", seq=SEQ),

    ep("POST", "/api/incidents/:id/false-alarm", "Declare a false alarm",
       "Org Manager, Org Operator: own; TrekLink Staff, TrekLink Admin: UNROUTED only",
       "A member declares a `NOTIFY_*`, `ACKNOWLEDGED` or `RESPONDING` incident false, with a reason; "
       "TrekLink staff may do so only for an `UNROUTED` incident. Only a person can declare it: a cancel "
       "pressed on the device changes nothing (D-038). The reopen window starts.",
       "UC-34, FR-INC-04, FR-INC-08, D-038",
       path=[I_PATH], body=[["reason", "Why it is false", "string", "yes", "`Pressed by mistake; holder confirmed by radio`"], VERSION],
       sample={"reason": "Pressed by mistake; holder confirmed safe by radio.", "expectedVersion": 1},
       response={**INC, "state": "FALSE_ALARM", "reopenWindowEndsAt": "2026-10-20T04:20:00Z", "version": 2},
       message="Marked as false alarm", entity="Incident", errors=[state_409("incident", "ESCALATED"), STALE],
       steps=["Check the caller kind against the state", "Transition, store the reason, set the reopen window"],
       controller="IncidentsController", service="IncidentLifecycleService", call="declareFalse(id, dto, caller)", seq=SEQ),

    ep("POST", "/api/incidents/:id/authority-reports", "Report to the authorities", "TrekLink Staff, TrekLink Admin",
       "Records a report to the authorities on an `ESCALATED` or `UNROUTED` incident (agency, reference, "
       "time) and moves it to `REPORTED`. TrekLink logs and reports; it never coordinates a rescue "
       "(FR-INC-10, BR-17, NFR-LEG-05). An organization member may still acknowledge afterwards.",
       "UC-35, FR-INC-04, FR-INC-10, BR-17",
       path=[I_PATH],
       body=[["agency", "Who was informed", "string", "yes", "`Lam Dong provincial rescue (114)`"],
             ["reference", "Their case or call reference", "string", "yes", "`LD-114-2026-1020-07`"],
             ["reportedAt", "When, not in the future", "datetime", "yes", "`2026-10-20T03:25:00Z`"],
             ["note", "What was shared", "string", "no", "`Last position and audit log sent`"], VERSION],
       sample={"agency": "Lam Dong provincial rescue (114)", "reference": "LD-114-2026-1020-07",
               "reportedAt": "2026-10-20T03:25:00Z", "note": "Last position and audit log shared by phone and email.",
               "expectedVersion": 5},
       response={**INC, "state": "REPORTED", "version": 6}, status=201, message="Report recorded", entity="Incident",
       errors=[state_409("incident", "ACKNOWLEDGED"), STALE],
       steps=["Require ESCALATED or UNROUTED", "Insert authority_reports", "Transition to REPORTED"],
       controller="IncidentsController", service="AuthorityReportService", call="reportIncident(id, dto, actor)", seq=SEQ),

    ep("POST", "/api/authority-reports/:reportId/close-case", "Record the authority case closed",
       "TrekLink Staff, TrekLink Admin",
       "Records that the authorities closed their case. A `REPORTED` incident moves to `CLOSED` (D-034); a "
       "contract report only records the time.", "UC-35, UC-37, FR-INC-04, D-034",
       path=[["reportId", "Authority report id", "uuid", "`ar-1`"]],
       body=[["closedAt", "When the authority closed it", "datetime", "yes", "`2026-10-21T08:00:00Z`"],
             ["note", "Outcome as reported", "string", "no", "`Holder found safe`"]],
       sample={"closedAt": "2026-10-21T08:00:00Z", "note": "Holder found safe by the rescue team."},
       response={"id": "ar-1", "caseClosedAt": "2026-10-21T08:00:00Z", "incidentState": "CLOSED"},
       message="Case closed", entity="Authority report",
       errors=[(409, "CASE_ALREADY_CLOSED", "caseClosedAt is set", "This cannot be done while it is CLOSED.")],
       steps=["Set caseClosedAt", "If the subject is a REPORTED incident: transition to CLOSED"],
       controller="AuthorityReportsController", service="AuthorityReportService", call="closeCase(reportId, dto, actor)",
       seq=["Svc->>DB: UPDATE authority_reports", "Svc->>DB: UPDATE incident, INSERT transition"]),

    ep("POST", "/api/authority-reports", "Report a defaulted contract", "TrekLink Staff, TrekLink Admin",
       "Records the report to the authorities for a `DEFAULTED` contract, with the audit log and last "
       "positions as evidence (BR-17, BR-26, NFR-LEG-03).", "UC-35, UC-50, BR-17, BR-26",
       body=[["contractId", "A DEFAULTED contract", "uuid", "yes", f"`{CONTRACT_ID}`"],
             ["agency", "Who was informed", "string", "yes", "`District police, Ward 1`"],
             ["reference", "Their reference", "string", "yes", "`PC-Q1-2026-338`"],
             ["reportedAt", "When", "datetime", "yes", "`2026-11-30T02:00:00Z`"], ["note", "What was shared", "string", "no", "`...`"]],
       sample={"contractId": CONTRACT_ID, "agency": "District 1 police", "reference": "PC-Q1-2026-338",
               "reportedAt": "2026-11-30T02:00:00Z"},
       response={"id": "ar-2", "contractId": CONTRACT_ID, "agency": "District 1 police", "reference": "PC-Q1-2026-338"},
       status=201, message="Report recorded",
       errors=[(409, "CONTRACT_NOT_DEFAULTED", "The contract is not DEFAULTED", "This cannot be done while it is OVERDUE.")],
       steps=["Ask rentals for the contract state", "Insert authority_reports"],
       controller="AuthorityReportsController", service="AuthorityReportService", call="reportContract(dto, actor)",
       participants=[["Rent", "RentalsService"]], seq=["Svc->>Rent: statusOf(contractId)", "Svc->>DB: INSERT authority_reports"]),

    ep("GET", "/api/authority-reports", "List authority reports", "TrekLink Staff, TrekLink Admin",
       "Lists authority reports, open cases first.", "UC-35, BR-17",
       query=[["open", "Case not closed", "bool", "no", "`true`"]] + PAGE_QUERY,
       response=paged({"id": "ar-1", "incidentId": INCIDENT_ID, "contractId": None, "agency": "Lam Dong provincial rescue (114)",
                       "reference": "LD-114-2026-1020-07", "reportedAt": NOW, "caseClosedAt": None}),
       steps=["Read authority_reports"], controller="AuthorityReportsController", service="AuthorityReportService",
       call="list(query)", seq=["Svc->>DB: SELECT authority_reports"]),

    ep("GET", "/api/incidents/:id/transitions", "Incident audit trail",
       "Org Manager, Org Operator: own; TrekLink Staff, TrekLink Admin",
       "The append-only transition trail: sequence, from, to, actor or SYSTEM, reason and UTC time (FR-INC-04, BR-18).",
       "UC-58, FR-INC-04, BR-18", path=[I_PATH],
       response=[{"seq": 1, "fromState": None, "toState": "DETECTED", "actor": "SYSTEM", "reason": "CREATED", "createdAt": NOW},
                 {"seq": 2, "fromState": "DETECTED", "toState": "NOTIFY_PRIMARY", "actor": "SYSTEM", "reason": "ROUTED", "createdAt": NOW}],
       entity="Incident", steps=["Read incident_transitions by seq"], controller="IncidentsController",
       service="IncidentsQueryService", call="transitions(id, caller)", seq=["Svc->>DB: SELECT incident_transitions"]),

    ep("GET", "/api/incidents/:id/events", "Episode events", "Org Manager, Org Operator: own; TrekLink Staff, TrekLink Admin",
       "The field events that opened or joined the episode, oldest first, for the incident map trail.",
       "UC-29, FR-INC-01", path=[I_PATH],
       response=[{"eventId": "5d41...", "kind": "FALL_SOS", "observedAt": "2026-10-20T03:14:52Z",
                  "latitude": 11.5601, "longitude": 108.5402}],
       entity="Incident", steps=["Ask gateway-sync for the episode's events"], controller="IncidentsController",
       service="IncidentsQueryService", call="events(id, caller)", participants=[["Gw", "GatewaySyncService"]],
       seq=["Svc->>Gw: eventsOfIncident(id)"]),

    ep("GET", "/api/incidents/:id/alerts", "Alert delivery log", "Org Manager: own; TrekLink Staff, TrekLink Admin",
       "Every alert the incident produced: tier, recipient, channel, attempts and outcome (FR-INC-12, E03-7).",
       "UC-30, FR-INC-12, E03-7", path=[I_PATH],
       response=[{"tier": "PRIMARY", "recipient": "Pham Van D", "channel": "WEBSOCKET", "status": "SENT", "attempts": 1, "sentAt": NOW},
                 {"tier": "PRIMARY", "recipient": "Pham Van D", "channel": "EMAIL", "status": "PENDING", "attempts": 2,
                  "lastError": "SMTP 451"}],
       entity="Incident", steps=["Read alert_deliveries"], controller="IncidentsController",
       service="IncidentsQueryService", call="alerts(id, caller)", seq=["Svc->>DB: SELECT alert_deliveries"]),
]

NOTES = ("Transitions taken by the system have no endpoint (incidents design §2): creation and routing "
         "from ingestion (UC-29), tier timeouts (UC-31), the stale limit (FR-INC-07), reopen on a new episode "
         "and close when the reopen window ends (UC-36, UC-37), and the owner leaving the organization.")
