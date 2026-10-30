from ._common import (USER_ID, ORG_ID, DEVICE_ID, CONTRACT_ID, INCIDENT_ID, NOW, ep, paged, PAGE_QUERY,
                      state_409, STALE)

INC = {"id": INCIDENT_ID, "code": "INC-2026-000045", "device": {"id": DEVICE_ID, "assetTag": "TL-0042",
                                                                 "holder": {"name": "Le Thi E", "phone": "0912345678"}},
       "organizationId": ORG_ID, "contractId": CONTRACT_ID, "state": "NOTIFY_PRIMARY", "stateChangedAt": NOW,
       "source": "DEVICE_FALL", "confidence": "CONFIRMED", "firstEventAt": "2026-10-20T03:14:52Z",
       "lastEventAt": NOW, "eventCount": 4, "lastPosition": {"lat": 11.5601, "lon": 108.5402}, "stale": False,
       "owner": None, "tierDeadlineAt": "2026-10-20T03:17:00Z", "statusDueAt": None, "reopenCount": 0,
       "version": 1}
# Authority report ids of the examples: an incident report (02, 09, 11) and a contract report (10).
REPORT_ID = "0b6c9f2e-4d1a-4c3b-9e8f-7a6b5c4d3e2f"
CONTRACT_REPORT_ID = "4e3d2c1b-0a9f-4e8d-8c7b-6a5f4e3d2c1b"
I_PATH = ["id", "Incident id; members may use only their own organization's", "uuid", f"`{INCIDENT_ID}`"]
VERSION = ["expectedVersion", "Incident version the caller saw", "int", "yes", "`1`"]
TAKEN = (409, "ALREADY_OWNED", "Another member acknowledged first (compare-and-set lost)",
         "Pham Van D took this incident at 10:15.")
NOT_OWNER = (403, "NOT_OWNER", "Only the member who owns the response may do this", "You do not have access to this.")

def _indent(lines, n=1):
    return ["    " * n + line for line in lines]


MEMBER_HEAD = ["actor U as Org Operator or Org Manager", "participant P as IncidentDetailPage",
               "participant Ctl as IncidentsController", "participant Svc as IncidentsService",
               "participant L as IncidentLifecycle", "participant R as IncidentsRepository",
               "participant Ob as AlertDeliveriesRepository"]


def member_sequence(action, url, call, to, reason, refusal, status, done):
    """IncidentsService.transition as the code runs it (api-design 03, 04, 06, 07): lockById, then
    IncidentLifecycle.apply. Chapter 16 §6 rule 2: the main success path plus one alt for the failure the
    specification names, as two labelled branches, the failure returning to the page; the other refusals
    stay in the Validation table and the activity diagram. No activation lines: the SDD build adds them
    by call stack. The service that owns the transaction sends the COMMIT."""
    label, st, code, msg, extra = refusal
    return MEMBER_HEAD + [
        f"U->>P: {action}", f"P->>Ctl: POST {url}", f"Ctl->>Svc: {call}",
        "Svc->>R: lockById(id, tx)", "R-->>Svc: incident",
        f"Svc->>L: apply(id, current, {to}, member, {reason} with expectedVersion, tx)",
        "L->>R: lockById(id, tx)", "R-->>L: incident",
        f"alt refused: {label}"] + _indent(
        [f"L-->>Svc: {st} {code}"] + extra
        + [f"Svc-->>Ctl: {st} {code}", f"Ctl-->>P: {st} envelope", f"P-->>U: {msg}"]) + [
        "else accepted"] + _indent([
        "L->>R: compareAndSet(current, patch, tx)", "L->>R: insertTransition(row, tx)",
        "L->>Ob: enqueue(API event, tx)", f"L-->>Svc: incident {to}",
        "Svc->>R: COMMIT, then incident.changed and audit.record",
        "Svc-->>Ctl: incident", f"Ctl-->>P: {status} envelope", f"P-->>U: {done}"]) + ["end"]


NOT_OWNER_REFUSAL = ("caller is not the owner", 403, "NOT_OWNER", "MSG26", [])

ENDPOINTS = [
    ep("GET", "/api/incidents", "List incidents", "Org Manager, Org Operator: own; TrekLink Staff, TrekLink Admin",
       "Lists incidents with state filters. Organization members see their organization's incidents; "
       "TrekLink staff see every incident, and `state=UNROUTED,ESCALATED` is their queue. Rows come most "
       "urgent first: `tierDeadlineAt` ascending with nulls last, then `firstEventAt` newest first. There is no "
       "sort parameter (D-059 rule 7).",
       "UC-29, UC-32, FR-AUTH-11",
       query=[["state", "IncidentState, repeatable", "enum", "no", "`NOTIFY_PRIMARY`"],
              ["open", "Every state except CLOSED", "bool", "no", "`true`"],
              ["deviceId", "Device", "uuid", "no", f"`{DEVICE_ID}`"],
              ["from", "createdAt lower bound", "datetime", "no", "`...`"]] + PAGE_QUERY,
       response=paged(INC, 2), steps=["Apply scope", "Read incidents by tierDeadlineAt ascending, nulls last, then firstEventAt newest first"],
       controller="IncidentsController", service="IncidentsQueryService", call="list(query, caller)",
       seq=["Svc->>DB: SELECT incidents WHERE scope"]),

    ep("GET", "/api/incidents/:id", "Incident detail", "Org Manager, Org Operator: own; TrekLink Staff, TrekLink Admin",
       "Returns the incident with its device and holder label, owner, pending deadline, latest status "
       "updates and authority reports. `statusUpdates[]` and `authorityReports[]` are newest first; an "
       "incident with none returns empty arrays (D-059 rule 7). `outcomeNote` is the text the owner reported "
       "on resolving, `null` until the incident is resolved. Each status update carries `correctsId`, the "
       "update it corrects, and `correctedById`, the update that corrects it; both are null on an uncorrected "
       "original. Status updates stay append-only, so a corrected update is still returned (dry run defect 15).",
       "UC-32, UC-33, FR-AUTH-11",
       path=[I_PATH],
       response={**INC, "outcomeNote": None,
                 "statusUpdates": [{"id": "su-4", "note": "Reached the holder, minor knee injury",
                                    "author": {"id": USER_ID, "fullName": "Pham Van D"}, "createdAt": NOW,
                                    "correctsId": "su-3", "correctedById": None},
                                   {"id": "su-3", "note": "Reached the holder, minor ankle injury",
                                    "author": {"id": USER_ID, "fullName": "Pham Van D"}, "createdAt": NOW,
                                    "correctsId": None, "correctedById": "su-4"}],
                 "authorityReports": [{"id": REPORT_ID, "agency": "Lam Dong provincial rescue (114)",
                                       "reference": "LD-114-2026-1020-07", "reportedAt": NOW, "caseClosedAt": None}]},
       entity="Incident",
       steps=["Read within scope"], controller="IncidentsController", service="IncidentsQueryService",
       call="get(id, caller)", seq=["Svc->>DB: SELECT incident, updates, reports"]),

    ep("POST", "/api/incidents/:id/acknowledge", "Acknowledge an incident", "Org Manager, Org Operator: own",
       "One step, no required field (NFR-USE-02). Moves a `NOTIFY_*`, `ESCALATED` or `REPORTED` incident to "
       "`ACKNOWLEDGED` with the caller as owner; that time is time-to-acknowledge. A concurrent second "
       "acknowledgement loses the compare-and-set and is shown the owner (FR-INC-06, E03-3, MSG27). The owner "
       "check comes first, so a second member always learns who took it; a version mismatch on an unowned "
       "incident is `STALE_VERSION` (MSG36, D-059 rule 7).",
       "UC-32, FR-INC-04, FR-INC-06, BR-15, E03-3, MSG27",
       path=[I_PATH], body=[["note", "Optional first note", "string", "no", "`On my way to the ridge`"], VERSION],
       sample={"expectedVersion": 1},
       response={**INC, "state": "ACKNOWLEDGED", "owner": {"id": USER_ID, "fullName": "Pham Van D"},
                 "tierDeadlineAt": None, "statusDueAt": "2026-10-20T03:45:00Z", "version": 2},
       message="Incident acknowledged", entity="Incident",
       errors=[TAKEN, STALE, state_409("incident", "RESOLVED")],
       steps=["Require NOTIFY_*, ESCALATED or REPORTED", "If another member owns it: ALREADY_OWNED",
              "If the version differs: STALE_VERSION", "Compare-and-set to ACKNOWLEDGED, set owner",
              "Clear the tier deadline, set statusDueAt", "Write transition and outbox rows"],
       controller="IncidentsController", service="IncidentsService", call="acknowledge(id, input, caller)",
       sequence_note="Not drawn in the sequence: 403 FORBIDDEN without an organization, 404 NOT_FOUND, 409 STALE_VERSION and 409 INVALID_STATE_TRANSITION"
                     ", which the Validation table and the activity diagram carry.",
       sequence=member_sequence(
           "acknowledge", "/api/incidents/:id/acknowledge", "acknowledge(id, input, caller)",
           "ACKNOWLEDGED", "ACKNOWLEDGED",
           ("another member already owns it", 409, "ALREADY_OWNED", "MSG27, owner shown",
            ["Svc->>R: latestAcknowledgement(id), after rollback", "R-->>Svc: owner and time"]),
           200, "ACKNOWLEDGED, owner is the caller")),

    ep("POST", "/api/incidents/:id/responding", "Report a response under way", "Owner (Org Manager or Org Operator)",
       "The owner reports that a response is under way: `ACKNOWLEDGED` to `RESPONDING`, and the stale timer "
       "restarts (D-034).", "UC-33, FR-INC-04, FR-INC-07",
       path=[I_PATH], body=[["note", "What is being done", "string", "yes", "`Guide team of 3 dispatched`"], VERSION],
       sample={"note": "Guide team of 3 dispatched from camp 2", "expectedVersion": 2},
       response={**INC, "state": "RESPONDING", "statusDueAt": "2026-10-20T04:15:00Z", "version": 3},
       message="Status recorded", entity="Incident", errors=[NOT_OWNER, state_409("incident", "NOTIFY_PRIMARY"), STALE],
       steps=["Require ACKNOWLEDGED and the caller as owner", "Transition with the note on it, reset statusDueAt"],
       controller="IncidentsController", service="IncidentsService", call="responding(id, input, caller)",
       sequence_note="Not drawn in the sequence: 400 VALIDATION_FAILED for a blank note, 403 FORBIDDEN, 404 NOT_FOUND, 409 STALE_VERSION and 409 INVALID_STATE_TRANSITION"
                     ", which the Validation table and the activity diagram carry.",
       sequence=member_sequence(
           "report a response under way", "/api/incidents/:id/responding", "responding(id, input, caller)",
           "RESPONDING", "RESPONDING", NOT_OWNER_REFUSAL, 200, "RESPONDING, next update due")),

    ep("POST", "/api/incidents/:id/status-updates", "Add a status update", "Owner (Org Manager or Org Operator)",
       "Appends a status note during `ACKNOWLEDGED` or `RESPONDING` and resets the stale timer; no state "
       "change. Without one inside the stale limit the incident escalates (FR-INC-07, E03-5). Status updates "
       "are append-only: to correct one, the owner posts a new update with `correctsId` naming it. The corrected "
       "row is never edited; the detail read marks it with `correctedById` (dry run defect 15). An update is "
       "corrected at most once, and a correction is itself a status update that resets the stale timer.",
       "UC-33, FR-INC-07, E03-5",
       path=[I_PATH], body=[["note", "Status", "string", "yes", "`Reached the holder, minor ankle injury`"],
                            ["correctsId", "The earlier update of this incident that this one corrects",
                             "uuid", "no", "`su-3`"]],
       sample={"note": "Reached the holder, minor knee injury", "correctsId": "su-3"},
       response={"id": "su-4", "note": "Reached the holder, minor knee injury", "createdAt": NOW,
                 "statusDueAt": "2026-10-20T04:45:00Z", "correctsId": "su-3"}, status=201, message="Status recorded",
       entity="Incident",
       errors=[(400, "VALIDATION_FAILED", "correctsId names no status update of this incident",
                "correctsId must name a status update of this incident."),
               NOT_OWNER, state_409("incident", "RESOLVED"),
               (409, "CONFLICT_UNIQUE", "The update named by correctsId is already corrected",
                "This status update is already corrected.")],
       steps=["Require ACKNOWLEDGED or RESPONDING and the caller as owner",
              "If correctsId is set: require an update of this incident that no row corrects yet",
              "Insert the update, reset statusDueAt",
              "Emit incident.changed to the organization stream"],
       controller="IncidentsController", service="IncidentsService", call="addStatus(id, input, caller)",
       sequence_note="Not drawn in the sequence: 400 VALIDATION_FAILED for a blank note or a foreign correctsId, 403 FORBIDDEN, 404 NOT_FOUND, "
                     "409 INVALID_STATE_TRANSITION and 409 CONFLICT_UNIQUE for an update already corrected"
                     ", which the Validation table and the activity diagram carry.",
       sequence=MEMBER_HEAD[:4] + ["participant R as IncidentsRepository",
           "U->>P: post a status update", "P->>Ctl: POST /api/incidents/:id/status-updates",
           "Ctl->>Svc: addStatus(id, input, caller)", "Svc->>R: lockById(id, tx)", "R-->>Svc: incident",
           "alt refused: caller is not the owner",
           "    Svc-->>Ctl: 403 NOT_OWNER", "    Ctl-->>P: 403 envelope", "    P-->>U: MSG26",
           "else accepted",
           "    opt correctsId is set",
           "        Svc->>R: findStatusUpdateForCorrection(correctsId, tx)",
           "        R-->>Svc: update of this incident, not yet corrected",
           "    end",
           "    Svc->>R: insertStatusUpdate(row, tx)", "    Svc->>R: resetStatusDue(id, statusDueAt, tx)",
           "    Svc->>R: COMMIT, then incident.changed and audit.record",
           "    Svc-->>Ctl: status update and statusDueAt", "    Ctl-->>P: 201 envelope",
           "    P-->>U: update shown, next update due",
           "end"]),

    ep("POST", "/api/incidents/:id/resolve", "Report the outcome", "Owner (Org Manager or Org Operator)",
       "The owner reports the outcome with a note: `RESOLVED`; that time is time-to-resolve; the reopen "
       "window starts (FR-INC-08, FR-INC-11).", "UC-33, FR-INC-04, FR-INC-08",
       path=[I_PATH], body=[["outcomeNote", "What happened", "string", "yes", "`Walked out with assistance`"], VERSION],
       sample={"outcomeNote": "Walked out to camp 2 with assistance; no evacuation needed.", "expectedVersion": 3},
       response={**INC, "state": "RESOLVED", "statusDueAt": None, "reopenWindowEndsAt": "2026-10-20T05:20:00Z", "version": 4},
       message="Incident resolved", entity="Incident", errors=[NOT_OWNER, state_409("incident", "NOTIFY_BACKUP"), STALE],
       steps=["Require ACKNOWLEDGED or RESPONDING and the caller as owner", "Transition, set resolvedAt and the reopen window"],
       controller="IncidentsController", service="IncidentsService", call="resolve(id, input, caller)",
       sequence_note="Not drawn in the sequence: 400 VALIDATION_FAILED for a blank outcomeNote, 403 FORBIDDEN, 404 NOT_FOUND, 409 STALE_VERSION and 409 INVALID_STATE_TRANSITION"
                     ", which the Validation table and the activity diagram carry.",
       sequence=member_sequence(
           "report the outcome", "/api/incidents/:id/resolve", "resolve(id, input, caller)",
           "RESOLVED", "RESOLVED", NOT_OWNER_REFUSAL, 200, "RESOLVED, reopen window started")),

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
       controller="IncidentsController", service="IncidentsService", call="falseAlarm(id, input, caller)",
       sequence_note="Not drawn in the sequence: 400 VALIDATION_FAILED for a blank reason, 403 FORBIDDEN, 404 NOT_FOUND and 409 STALE_VERSION"
                     ", which the Validation table and the activity diagram carry.",
       sequence=member_sequence(
           "declare a false alarm", "/api/incidents/:id/false-alarm", "falseAlarm(id, input, caller)",
           "FALSE_ALARM", "FALSE_ALARM",
           ("not NOTIFY_*, ACKNOWLEDGED or RESPONDING", 409, "INVALID_STATE_TRANSITION", "MSG28", []),
           200, "FALSE_ALARM, reopen window started")),

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
       controller="IncidentsController", service="AuthorityReportsService", call="reportIncident(id, input, caller)",
       sequence_note="Not drawn in the sequence: 400 VALIDATION_FAILED, 403 FORBIDDEN, 404 NOT_FOUND and 409 STALE_VERSION"
                     ", which the Validation table and the activity diagram carry.",
       sequence=["actor U as TrekLink Staff", "participant P as StaffIncidentsPage",
           "participant Ctl as IncidentsController", "participant Svc as AuthorityReportsService",
           "participant L as IncidentLifecycle", "participant R as IncidentsRepository",
           "participant Ar as AuthorityReportsRepository",
           "U->>P: record agency, reference, time", "P->>Ctl: POST /api/incidents/:id/authority-reports",
           "Ctl->>Svc: reportIncident(id, input, caller)", "Svc->>R: lockById(id, tx)", "R-->>Svc: incident",
           "alt refused: not ESCALATED or UNROUTED",
           "    Svc-->>Ctl: 409 INVALID_STATE_TRANSITION", "    Ctl-->>P: 409 envelope",
           "    P-->>U: MSG28, incident reloaded",
           "else accepted: ESCALATED or UNROUTED",
           "    Svc->>L: apply(id, current, REPORTED, STAFF, AUTHORITY_REPORTED with expectedVersion, tx)",
           "    L->>R: lockById(id, tx)", "    R-->>L: incident",
           "    L->>R: compareAndSet(current, patch, tx)", "    L->>R: insertTransition(row, tx)",
           "    L-->>Svc: incident REPORTED", "    Svc->>Ar: insert(report, tx)", "    Ar-->>Svc: authority report",
           "    Svc->>R: COMMIT, then audit.record and incident.changed",
           "    Svc-->>Ctl: incident REPORTED", "    Ctl-->>P: 201 envelope", "    P-->>U: MSG03, REPORTED",
           "end"]),

    ep("POST", "/api/authority-reports/:reportId/close-case", "Record the authority case closed",
       "TrekLink Staff, TrekLink Admin",
       "Records that the authorities closed their case. A `REPORTED` incident moves to `CLOSED` (D-034) once "
       "no other report on it is still open; a contract report only records the time.",
       "UC-35, UC-37, FR-INC-04, D-034",
       path=[["reportId", "Authority report id", "uuid", f"`{REPORT_ID}`"]],
       body=[["closedAt", "When the authority closed it", "datetime", "yes", "`2026-10-21T08:00:00Z`"],
             ["note", "Outcome as reported", "string", "no", "`Holder found safe`"]],
       sample={"closedAt": "2026-10-21T08:00:00Z", "note": "Holder found safe by the rescue team."},
       response={"id": REPORT_ID, "caseClosedAt": "2026-10-21T08:00:00Z", "incidentState": "CLOSED"},
       message="Case closed", entity="Authority report",
       errors=[(400, "VALIDATION_FAILED", "closedAt is in the future", "closedAt must not be in the future."),
               (400, "VALIDATION_FAILED", "closedAt is before the report's reportedAt",
                "closedAt must not be before reportedAt."),
               (409, "CASE_ALREADY_CLOSED", "caseClosedAt is set", "This cannot be done while it is CLOSED.")],
       steps=["Set caseClosedAt",
              "If the subject is a REPORTED incident with no other open report: transition to CLOSED"],
       controller="AuthorityReportsController", service="AuthorityReportsService", call="closeCase(reportId, dto, actor)",
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
       response={"id": CONTRACT_REPORT_ID, "contractId": CONTRACT_ID, "agency": "District 1 police", "reference": "PC-Q1-2026-338"},
       status=201, message="Report recorded",
       errors=[(404, "NOT_FOUND", "No such contract", "Contract not found."),
               (409, "CONTRACT_NOT_DEFAULTED", "The contract is not DEFAULTED", "This cannot be done while it is OVERDUE.")],
       steps=["Ask rentals for the contract state", "Insert authority_reports"],
       controller="AuthorityReportsController", service="AuthorityReportsService", call="reportContract(dto, actor)",
       participants=[["Contracts", "ContractsService"]], seq=["Svc->>Contracts: statusOf(contractId)", "Svc->>DB: INSERT authority_reports"]),

    ep("GET", "/api/authority-reports", "List authority reports", "TrekLink Staff, TrekLink Admin",
       "Lists authority reports, open cases first, then `reportedAt` newest first. There is no sort "
       "parameter (D-059 rule 7).", "UC-35, BR-17",
       query=[["open", "Case not closed", "bool", "no", "`true`"]] + PAGE_QUERY,
       response=paged({"id": REPORT_ID, "incidentId": INCIDENT_ID, "contractId": None, "agency": "Lam Dong provincial rescue (114)",
                       "reference": "LD-114-2026-1020-07", "reportedAt": NOW, "caseClosedAt": None}),
       steps=["Read authority_reports"], controller="AuthorityReportsController", service="AuthorityReportsService",
       call="list(query)", seq=["Svc->>DB: SELECT authority_reports"]),

    ep("GET", "/api/incidents/:id/transitions", "Incident audit trail",
       "Org Manager, Org Operator: own; TrekLink Staff, TrekLink Admin",
       "The append-only transition trail: sequence, from, to, actor or SYSTEM, reason, note and UTC time "
       "(FR-INC-04, BR-18). `note` is the free text saved with the step (what is being done on "
       "`RESPONDING`, the outcome on `RESOLVED`, the reason on `FALSE_ALARM`) and is `null` for a step that "
       "carries none, such as a system step.",
       "UC-58, FR-INC-04, BR-18", path=[I_PATH],
       response=[{"seq": 1, "fromState": None, "toState": "DETECTED", "actor": "SYSTEM", "reason": "CREATED", "note": None, "createdAt": NOW},
                 {"seq": 2, "fromState": "DETECTED", "toState": "NOTIFY_PRIMARY", "actor": "SYSTEM", "reason": "ROUTED", "note": None, "createdAt": NOW},
                 {"seq": 3, "fromState": "ACKNOWLEDGED", "toState": "RESPONDING", "actor": "Pham Van D", "reason": "RESPONDING",
                  "note": "Two rangers are walking up the north trail", "createdAt": NOW}],
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
