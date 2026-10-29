from ._common import (USER_ID, ORG_ID, MEMBER_ID, STATION_ID, NOW, ep, paged, PAGE_QUERY, state_409, STALE,
                      ORG_PATH)

ORG = {"id": ORG_ID, "code": "ORG-0007", "legalName": "ACME Trek Co., Ltd.", "taxCode": "0312345678",
       "address": "12 Nguyen Hue, District 1, Ho Chi Minh City", "contactEmail": "ops@acme-trek.vn",
       "contactPhone": "0281234567", "status": "ACTIVE", "statusChangedAt": NOW, "verifiedAt": NOW,
       "decidedAt": NOW, "channelKeyVersion": 1, "version": 3}
MEMBER = {"id": MEMBER_ID, "userId": USER_ID, "email": "operator@acme-trek.vn", "fullName": "Pham Van D",
          "role": "OPERATOR", "invitationPending": False, "deactivatedAt": None}
SHIFT = {"id": "s-1", "startsAt": "2026-10-20T00:00:00Z", "endsAt": "2026-10-20T12:00:00Z",
         "primary": {"memberId": MEMBER_ID, "fullName": "Pham Van D"}, "backup": None}
KEY = {"id": "k-1", "name": "ERP integration", "prefix": "tlk_7Hc2", "createdAt": NOW, "lastUsedAt": None,
       "revokedAt": None}
STATION = {"id": STATION_ID, "name": "Ta Nang basecamp laptop", "mqttUsername": "fs-org-0007-1",
           "createdAt": NOW, "revokedAt": None, "lastSyncAt": NOW, "queueDepth": {"p0": 0, "p1": 0, "p2": 3, "p3": 12},
           "oldestRetryCount": 0, "version": "1.2.0", "outdated": False}
NOT_MEMBER = (404, "NOT_FOUND", "No such member in this organization", "Member not found.")
VERSION = ["expectedVersion", "Version the caller saw; mismatch returns 409", "int", "yes", "`3`"]

CASE = {"id": "c4d3e2f1-a0b9-4c8d-9e7f-6a5b4c3d2e1f", "code": "CMP-0002", "organization": {"id": ORG_ID, "code": "ORG-0007"},
        "type": "SUSPECTED_THEFT", "status": "OPEN", "evidence": "Three devices unreturned 40 days after default; phones unanswered",
        "linkedContractIds": ["c0ffee00-1234-4abc-9def-001122334455"], "linkedLossCases": ["LOSS-0003"],
        "authorityReference": None, "outcome": None, "openedAt": NOW, "actions": []}
CASE_PATH = ["id", "Compliance case id", "uuid", f"`{CASE['id']}`"]
# Each action names its actor (ComplianceAction.actorId, the name from the User): AC-10, FR-ORG-09 (ruling 2026-10-30).
STAFF_ACTOR = {"id": USER_ID, "fullName": "Tran Thi B"}
ACTION = {"kind": "SUSPEND_ORGANIZATION", "actor": STAFF_ACTOR, "at": NOW}


def action_fields(prefix="actions[]"):
    return [[prefix, "Actions taken from the case, in the order they were recorded", "object[]", "see sample"],
            [f"{prefix}.kind", "SUSPEND_ORGANIZATION, REVOKE_FIELD_STATION, REVOKE_API_KEY or OTHER", "enum",
             "`SUSPEND_ORGANIZATION`"],
            [f"{prefix}.actor.id", "User who took the action (ComplianceAction.actorId)", "uuid", f"`{USER_ID}`"],
            [f"{prefix}.actor.fullName", "That user's name", "string", "`Tran Thi B`"],
            [f"{prefix}.at", "When the action was recorded (createdAt), UTC", "datetime", f"`{NOW}`"]]


def limit_field(key, guard):
    return [["items", "The list", "object[]", "see sample"],
            ["limit", f"`{key}`, the most active ones the organization may hold; at that count the create "
                      f"endpoint answers 409 `{guard}` (ruling 2026-10-30)", "int", "`5`"]]


ENDPOINTS = [
    ep("POST", "/api/organizations/register", "Register an organization", "Public",
       "A Guest registers a company with its tax code and the Manager's contact. The organization is "
       "created `PENDING` with its Manager account, which can sign in but cannot request a contract "
       "until the organization is verified and approved (FR-ORG-01).",
       "UC-01, FR-ORG-01, MSG04, MSG10",
       body=[["legalName", "Registered company name", "string", "yes", "`ACME Trek Co., Ltd.`"],
             ["taxCode", "Vietnamese tax code, 10 or 13 digits", "string", "yes", "`0312345678`"],
             ["address", "Registered address", "string", "yes", "`12 Nguyen Hue, ...`"],
             ["contactPhone", "Company phone", "string", "yes", "`0281234567`"],
             ["managerFullName", "Manager's name", "string", "yes", "`Nguyen Van A`"],
             ["managerEmail", "Manager's email; becomes the login", "string", "yes", "`manager@acme-trek.vn`"],
             ["managerPhone", "Manager's phone", "string", "yes", "`0901234567`"]],
       sample={"legalName": "ACME Trek Co., Ltd.", "taxCode": "0312345678",
               "address": "12 Nguyen Hue, District 1, Ho Chi Minh City", "contactPhone": "0281234567",
               "managerFullName": "Nguyen Van A", "managerEmail": "manager@acme-trek.vn", "managerPhone": "0901234567"},
       response={"organizationId": ORG_ID, "code": "ORG-0007", "status": "PENDING"}, status=201,
       message="Registration received. Visit the TrekLink counter or call us to verify your organization.",
       errors=[(409, "CONFLICT_UNIQUE", "The tax code or the Manager email is already registered",
                "0312345678 is already registered.")],
       steps=["Insert the organization PENDING and its first transition", "Insert the Manager user and membership",
              "Email a SET_PASSWORD code to the Manager", "Notify TrekLink Staff of a new registration"],
       controller="OrganizationsController", service="OrganizationsService", call="register(dto)",
       participants=[["Mail", "Email service"]],
       seq=["Svc->>DB: BEGIN, INSERT organizations, organization_transitions, users, organization_members, one_time_codes, COMMIT",
            "Svc-)Mail: invitation to the Manager"]),

    ep("GET", "/api/organizations", "List organizations", "TrekLink Staff, TrekLink Admin",
       "Lists organizations with filters; the Staff verification queue is `status=PENDING`.",
       "UC-02, UC-03, UC-07",
       query=[["status", "OrganizationStatus", "enum", "no", "`PENDING`"],
              ["q", "Name, code or tax code contains", "string", "no", "`acme`"]] + PAGE_QUERY,
       response=paged(ORG, 12), steps=["Read organizations, filtered and paged"],
       controller="OrganizationsController", service="OrganizationsService", call="list(query)",
       seq=["Svc->>DB: SELECT organizations"]),

    ep("GET", "/api/organizations/:id", "Organization detail", "TrekLink Staff, TrekLink Admin; members: own",
       "Returns one organization with its verification record and counts of members, running contracts "
       "and open incidents.", "UC-02, UC-03, FR-AUTH-11",
       path=[ORG_PATH],
       response={**ORG, "verification": {"method": "IN_PERSON", "documentsSeen": ["Business registration", "Manager ID card"],
                                         "masterContractRef": "MC-2026-0007", "verifiedBy": "Tran Thi B"},
                 "counts": {"members": 4, "runningContracts": 1, "openIncidents": 0}},
       entity="Organization", steps=["Read the organization and counts"],
       controller="OrganizationsController", service="OrganizationsService", call="get(id, caller)",
       seq=["Svc->>DB: SELECT organization WHERE id AND scope"]),

    ep("PATCH", "/api/organizations/:id", "Edit contact details", "Org Manager: own; TrekLink Admin",
       "Updates the address and contact details. Legal name and tax code change only through TrekLink "
       "Admin, because the master contract names them.",
       "UC-04, FR-AUTH-11",
       path=[ORG_PATH],
       body=[["address", "Address", "string", "no", "`...`"], ["contactEmail", "Email", "string", "no", "`ops@acme-trek.vn`"],
             ["contactPhone", "Phone", "string", "no", "`0281234567`"],
             ["legalName", "Admin only", "string", "no", "`ACME Trek JSC`"], VERSION],
       sample={"contactPhone": "0287654321", "expectedVersion": 3}, response={**ORG, "contactPhone": "0287654321", "version": 4},
       message="Saved.", entity="Organization", errors=[STALE],
       steps=["Check field-level permission", "Compare-and-set on version", "Emit audit.record organization.update"],
       controller="OrganizationsController", service="OrganizationsService", call="update(id, dto, caller)",
       seq=["Svc->>DB: UPDATE organizations WHERE id AND version"]),

    ep("POST", "/api/organizations/:id/verification", "Record verification", "TrekLink Staff",
       "Records the in-person or phone verification: documents seen and the signed master contract "
       "number, which must include the non-disclosure agreement and the Field Station software licence "
       "(BR-43, D-046). Admins are notified that the organization awaits approval (FR-ORG-02).",
       "UC-02, FR-ORG-02, BR-43",
       path=[ORG_PATH],
       body=[["method", "`IN_PERSON` or `PHONE`", "enum", "yes", "`IN_PERSON`"],
             ["documentsSeen", "Documents checked", "string[]", "yes", "`[\"Business registration\"]`"],
             ["masterContractRef", "Number on the signed master contract", "string", "yes", "`MC-2026-0007`"],
             ["ndaSigned", "The master contract includes the signed NDA", "bool", "yes", "`true`"],
             ["softwareLicenceSigned", "The master contract includes the Field Station software licence", "bool", "yes", "`true`"],
             VERSION],
       sample={"method": "IN_PERSON", "documentsSeen": ["Business registration", "Manager ID card"],
               "masterContractRef": "MC-2026-0007", "ndaSigned": True, "softwareLicenceSigned": True, "expectedVersion": 0},
       response={**ORG, "status": "PENDING", "verifiedAt": NOW, "decidedAt": None}, message="Verification recorded",
       entity="Organization", errors=[(400, "CONTRACT_TERMS_MISSING", "ndaSigned or softwareLicenceSigned is false",
                                       "The master contract must include the NDA and the software licence."),
                                      state_409("organization", "ACTIVE"), STALE],
       steps=["Require status PENDING", "Require ndaSigned and softwareLicenceSigned", "Store the verification fields and the verifying Staff",
              "Notify Admins", "Emit audit.record organization.verify"],
       controller="OrganizationsController", service="OrganizationsService", call="verify(id, dto, actor)",
       seq=["Svc->>DB: UPDATE organizations", "Svc-)Svc: emit organization.verified"]),

    ep("POST", "/api/organizations/:id/approve", "Approve an organization", "TrekLink Admin",
       "Moves a verified organization to `ACTIVE` and emails the Manager (MSG05). An unverified "
       "organization is refused (FR-ORG-03, MSG21).",
       "UC-03, FR-ORG-03, BR-01, MSG05, MSG21",
       path=[ORG_PATH], body=[VERSION], sample={"expectedVersion": 1}, response=ORG,
       message="Organization approved", entity="Organization",
       errors=[(409, "NOT_VERIFIED", "No verification is recorded",
                "Verify this organization at the counter before approving it."),
               state_409("organization", "REJECTED"), STALE],
       steps=["Require PENDING and verified", "Move to ACTIVE, write the transition", "Email the Manager"],
       controller="OrganizationsController", service="OrganizationsService", call="approve(id, dto, actor)",
       participants=[["Mail", "Email service"]],
       seq=["Svc->>DB: UPDATE organizations, INSERT organization_transitions", "Svc-)Mail: MSG05"]),

    ep("POST", "/api/organizations/:id/reject", "Reject an organization", "TrekLink Admin",
       "Moves a `PENDING` organization to `REJECTED` with a reason, and emails the Manager (MSG16).",
       "UC-03, FR-ORG-03, MSG16",
       path=[ORG_PATH], body=[["reason", "Reason shown to the Manager", "string", "yes", "`Tax code not found`"], VERSION],
       sample={"reason": "The tax code is not registered with the tax authority.", "expectedVersion": 1},
       response={**ORG, "status": "REJECTED"}, message="Organization rejected", entity="Organization",
       errors=[state_409("organization", "ACTIVE"), STALE],
       steps=["Require PENDING", "Move to REJECTED with the reason", "Email the Manager"],
       controller="OrganizationsController", service="OrganizationsService", call="reject(id, dto, actor)",
       seq=["Svc->>DB: UPDATE organizations, INSERT organization_transitions"]),

    ep("POST", "/api/organizations/:id/suspend", "Suspend an organization", "TrekLink Admin",
       "Suspends an `ACTIVE` organization by decision. New contracts are refused; rented devices stay "
       "monitored and incidents are still routed (FR-ORG-07, BR-32). The scheduler takes the same "
       "transition when a contract defaults.",
       "UC-07, FR-ORG-07, BR-32",
       path=[ORG_PATH], body=[["reason", "Reason", "string", "yes", "`Unpaid balance`"], VERSION],
       sample={"reason": "Contract RC-2026-0042 defaulted", "expectedVersion": 3},
       response={**ORG, "status": "SUSPENDED"}, message="Organization suspended", entity="Organization",
       errors=[state_409("organization", "PENDING"), STALE],
       steps=["Require ACTIVE", "Move to SUSPENDED with the reason", "Notify the Manager"],
       controller="OrganizationsController", service="OrganizationsService", call="suspend(id, dto, actor)",
       seq=["Svc->>DB: UPDATE organizations, INSERT organization_transitions"]),

    ep("POST", "/api/organizations/:id/reactivate", "Reactivate an organization", "TrekLink Admin",
       "Returns a `SUSPENDED` organization to `ACTIVE`, only when no balance is outstanding (FR-ORG-07).",
       "UC-07, FR-ORG-07",
       path=[ORG_PATH], body=[VERSION], sample={"expectedVersion": 4}, response=ORG,
       message="Organization reactivated", entity="Organization",
       errors=[(409, "BALANCE_OUTSTANDING", "An invoice line is still unpaid",
                "This cannot be done while it has open balances."), state_409("organization", "ACTIVE"), STALE],
       steps=["Require SUSPENDED", "Ask BillingService for the outstanding balance", "Move to ACTIVE"],
       controller="OrganizationsController", service="OrganizationsService", call="reactivate(id, dto, actor)",
       participants=[["Bill", "BillingService"]],
       seq=["Svc->>Bill: outstandingBalance(orgId)", "Svc->>DB: UPDATE organizations, INSERT organization_transitions"]),

    ep("POST", "/api/organizations/:id/close", "Close an organization", "TrekLink Admin",
       "Closes an `ACTIVE` organization that has no open contract; its members are deactivated and its "
       "API keys and Field Station credentials revoked.",
       "UC-07, D-035",
       path=[ORG_PATH], body=[["reason", "Reason", "string", "yes", "`Stopped trading`"], VERSION],
       sample={"reason": "Customer request", "expectedVersion": 3}, response={**ORG, "status": "CLOSED"},
       message="Organization closed", entity="Organization",
       errors=[(409, "OPEN_CONTRACTS", "A contract is not CLOSED, REJECTED or CANCELLED",
                "This cannot be done while it has open contracts."), state_409("organization", "SUSPENDED"), STALE],
       steps=["Require ACTIVE and no open contract", "Deactivate members, revoke keys and stations",
              "Move to CLOSED"],
       controller="OrganizationsController", service="OrganizationsService", call="close(id, dto, actor)",
       participants=[["Rent", "RentalsService"]],
       seq=["Svc->>Rent: hasOpenContracts(orgId)", "Svc->>DB: UPDATE organizations, members, api_keys, field_stations"]),

    ep("GET", "/api/organizations/:id/transitions", "Organization state history",
       "TrekLink Staff, TrekLink Admin; Org Manager: own",
       "Returns the append-only state history of the organization.", "UC-07, D-035",
       path=[ORG_PATH], response=[{"fromStatus": "PENDING", "toStatus": "ACTIVE", "actor": "TrekLink Admin",
                                   "reason": None, "createdAt": NOW}],
       entity="Organization", steps=["Read organization_transitions"],
       controller="OrganizationsController", service="OrganizationsService", call="transitions(id, caller)",
       seq=["Svc->>DB: SELECT organization_transitions"]),

    ep("GET", "/api/organizations/:id/members", "List members", "Org Manager, Org Operator: own; TrekLink Staff",
       "Lists the organization's members with their role and invitation state.", "UC-04, FR-ORG-04",
       path=[ORG_PATH], query=[["includeDeactivated", "Include deactivated members", "bool", "no", "`false`"]],
       response=[MEMBER], entity="Organization", steps=["Read members of the organization"],
       controller="MembersController", service="MembersService", call="list(orgId, caller)",
       seq=["Svc->>DB: SELECT organization_members JOIN users"]),

    ep("POST", "/api/organizations/:id/members", "Invite a member", "Org Manager: own",
       "Invites a person by email as Manager or Operator. The account belongs to this organization only; "
       "an email already registered anywhere is refused (FR-ORG-04).",
       "UC-04, FR-ORG-04, MSG10",
       path=[ORG_PATH],
       body=[["email", "Email", "string", "yes", "`operator@acme-trek.vn`"],
             ["fullName", "Full name", "string", "yes", "`Pham Van D`"],
             ["phoneNumber", "Phone, used in alert contact cards", "string", "no", "`0907654321`"],
             ["role", "`MANAGER` or `OPERATOR`", "enum", "yes", "`OPERATOR`"]],
       sample={"email": "operator@acme-trek.vn", "fullName": "Pham Van D", "phoneNumber": "0907654321", "role": "OPERATOR"},
       response={**MEMBER, "invitationPending": True}, status=201, message="Invitation sent", entity="Organization",
       errors=[(409, "CONFLICT_UNIQUE", "The email is already registered", "operator@acme-trek.vn is already registered."),
               state_409("organization", "CLOSED")],
       steps=["Require the organization not CLOSED or REJECTED", "Insert the user and membership",
              "Email a SET_PASSWORD code", "Emit audit.record member.invite"],
       controller="MembersController", service="MembersService", call="invite(orgId, dto, actor)",
       participants=[["Auth", "AuthService"], ["Mail", "Email service"]],
       seq=["Svc->>Auth: createOrganizationAccount(dto)", "Svc->>DB: INSERT organization_members", "Svc-)Mail: invitation"]),

    ep("PATCH", "/api/organizations/:id/members/:memberId", "Change a member's role", "Org Manager: own",
       "Changes a member's role. The last active Manager cannot be demoted (FR-ORG-04).", "UC-04, FR-ORG-04",
       path=[ORG_PATH, ["memberId", "Member id", "uuid", f"`{MEMBER_ID}`"]],
       body=[["role", "`MANAGER` or `OPERATOR`", "enum", "yes", "`MANAGER`"]],
       sample={"role": "MANAGER"}, response={**MEMBER, "role": "MANAGER"}, message="Saved.", entity="Member",
       errors=[(409, "LAST_MANAGER", "This is the organization's last active Manager",
                "The organization must keep at least one Manager.")],
       steps=["Lock the organization's members", "Refuse demoting the last Manager", "Update the role and user role"],
       controller="MembersController", service="MembersService", call="changeRole(orgId, memberId, dto, actor)",
       seq=["Svc->>DB: SELECT members FOR UPDATE", "Svc->>DB: UPDATE organization_members, user_roles"]),

    ep("POST", "/api/organizations/:id/members/:memberId/deactivate", "Deactivate a member", "Org Manager: own",
       "Deactivates a member: refresh tokens revoked, roster slots from now on cleared, and any incident "
       "the member owns goes back to `NOTIFY_BACKUP` (D-034). The last Manager cannot be deactivated.",
       "UC-04, FR-ORG-04, FR-AUTH-07, D-034",
       path=[ORG_PATH, ["memberId", "Member id", "uuid", f"`{MEMBER_ID}`"]],
       body=[["reason", "Why", "string", "no", "`Left the company`"]], sample={"reason": "Left the company"},
       response={**MEMBER, "deactivatedAt": NOW}, message="Member deactivated", entity="Member",
       errors=[(409, "LAST_MANAGER", "This is the organization's last active Manager",
                "The organization must keep at least one Manager.")],
       steps=["Set deactivatedAt, deactivate the account", "Clear future roster slots",
              "Emit member.deactivated (incidents re-route owned incidents)"],
       controller="MembersController", service="MembersService", call="deactivate(orgId, memberId, actor)",
       participants=[["Inc", "IncidentsService"]],
       seq=["Svc->>DB: UPDATE organization_members, users, roster_shifts", "Svc-)Inc: member.deactivated"]),

    ep("GET", "/api/organizations/:id/roster", "On-duty roster", "Org Manager, Org Operator: own",
       "Lists shift windows in a time range, with `warnings` for every window or gap without a primary "
       "(MSG22): alerts in such a window start at the backup tier (BR-16).",
       "UC-05, FR-ORG-05, BR-16, MSG22",
       path=[ORG_PATH],
       query=[["from", "Inclusive start", "datetime", "yes", "`2026-10-20T00:00:00Z`"],
              ["to", "Exclusive end, at most 31 days after from", "datetime", "yes", "`2026-10-27T00:00:00Z`"]],
       response={"shifts": [SHIFT], "warnings": [{"from": "2026-10-20T12:00:00Z", "to": "2026-10-21T00:00:00Z",
                                                  "kind": "NO_PRIMARY"}]},
       entity="Organization", steps=["Read shifts in range", "Compute gaps and windows without a primary"],
       controller="RosterController", service="RosterService", call="list(orgId, range, caller)",
       seq=["Svc->>DB: SELECT roster_shifts WHERE range overlaps"]),

    ep("POST", "/api/organizations/:id/roster", "Add a shift", "Org Manager: own",
       "Adds a shift window with a primary and an optional backup. Windows of one organization never "
       "overlap (exclusion constraint).", "UC-05, FR-ORG-05",
       path=[ORG_PATH],
       body=[["startsAt", "Start", "datetime", "yes", "`2026-10-20T00:00:00Z`"],
             ["endsAt", "End, after startsAt", "datetime", "yes", "`2026-10-20T12:00:00Z`"],
             ["primaryMemberId", "Active member", "uuid", "no", f"`{MEMBER_ID}`"],
             ["backupMemberId", "Another active member", "uuid", "no", "`...`"]],
       sample={"startsAt": "2026-10-20T00:00:00Z", "endsAt": "2026-10-20T12:00:00Z", "primaryMemberId": MEMBER_ID},
       response={"shift": SHIFT, "warnings": [{"kind": "NO_BACKUP"}]}, status=201, message="Saved.",
       entity="Organization",
       errors=[(409, "SHIFT_OVERLAP", "The window overlaps another shift", "This shift overlaps another one."),
               (400, "MEMBER_NOT_ELIGIBLE", "A member is deactivated, of another organization, or both slots are the same",
                "Choose two different active members of your organization.")],
       steps=["Validate members", "Insert the shift (exclusion constraint guards overlap)"],
       controller="RosterController", service="RosterService", call="create(orgId, dto, actor)",
       seq=["Svc->>DB: INSERT roster_shifts"]),

    ep("PATCH", "/api/organizations/:id/roster/:shiftId", "Edit a shift", "Org Manager: own",
       "Changes a shift's window or members. A change takes effect for the next alert; an incident "
       "already in a tier keeps its recipient. On a shift that has started only `endsAt` may change, and "
       "not to a time before now, so the record of who was on duty stays (ruling 2026-10-30).", "UC-05, FR-ORG-05",
       path=[ORG_PATH, ["shiftId", "Shift id", "uuid", "`s-1`"]],
       body=[["startsAt", "Start; not accepted once the shift has started", "datetime", "no", "`...`"],
             ["endsAt", "End; the only field accepted once the shift has started, then not before now", "datetime", "no", "`...`"],
             ["primaryMemberId", "Member or null; not accepted once the shift has started", "uuid", "no", "`...`"],
             ["backupMemberId", "Member or null; not accepted once the shift has started", "uuid", "no", "`...`"]],
       sample={"backupMemberId": "8d7c6b5a-..."}, response={"shift": SHIFT, "warnings": []}, message="Saved.",
       entity="Shift",
       errors=[(409, "SHIFT_STARTED", "The shift has started and the body changes a field other than endsAt",
                "Only the end of a started shift can change."),
               (400, "VALIDATION_FAILED", "The shift has started and endsAt is before now",
                "endsAt must not be in the past."),
               (409, "SHIFT_OVERLAP", "The window overlaps another shift", "This shift overlaps another one.")],
       steps=["Validate members", "Update the shift"],
       controller="RosterController", service="RosterService", call="update(orgId, shiftId, dto, actor)",
       seq=["Svc->>DB: UPDATE roster_shifts"]),

    ep("DELETE", "/api/organizations/:id/roster/:shiftId", "Delete a shift", "Org Manager: own",
       "Deletes a shift that has not started. A started shift is shortened by editing its end instead, so "
       "the record of who was on duty stays.", "UC-05, FR-ORG-05",
       path=[ORG_PATH, ["shiftId", "Shift id", "uuid", "`s-1`"]], response=None, message="Shift deleted",
       entity="Shift",
       errors=[(409, "SHIFT_STARTED", "The shift has already started", "Shorten a started shift instead of deleting it.")],
       steps=["Require startsAt in the future", "Delete the row"],
       controller="RosterController", service="RosterService", call="remove(orgId, shiftId, actor)",
       seq=["Svc->>DB: DELETE roster_shifts WHERE startsAt > now()"]),

    ep("GET", "/api/organizations/:id/api-keys", "List API keys",
       "Org Manager: own; TrekLink Staff, TrekLink Admin: any organization",
       "Lists the organization's API keys by name and prefix, with last use and revocation time, and the "
       "number of active keys it may hold. The full key is never shown again. TrekLink Staff and Admin "
       "read any organization's keys, for example from a compliance case; creating and revoking stay with "
       "the Org Manager (ruling 2026-10-30).", "UC-06, FR-ORG-06",
       path=[ORG_PATH], response={"items": [KEY], "limit": 5}, fields=limit_field("organizations.maxApiKeys", "KEY_LIMIT"),
       entity="Organization", steps=["Read api_keys of the organization", "Read organizations.maxApiKeys"],
       controller="ApiKeysController", service="ApiKeysService", call="list(orgId, caller)",
       participants=[["Prm", "ParameterService"]],
       seq=["Svc->>DB: SELECT api_keys", "Svc->>Prm: get(organizations.maxApiKeys)"]),

    ep("POST", "/api/organizations/:id/api-keys", "Create an API key", "Org Manager: own",
       "Creates a named read-only key scoped to the organization. The key is returned once and only its "
       "SHA-256 hash is stored (FR-ORG-06, NFR-SEC-02).", "UC-06, FR-ORG-06, BR-20",
       path=[ORG_PATH], body=[["name", "Label", "string", "yes", "`ERP integration`"]],
       sample={"name": "ERP integration"}, response={**KEY, "key": "tlk_7Hc2Qm...full-key-shown-once"}, status=201,
       message="API key created. Copy it now; it will not be shown again.", entity="Organization",
       errors=[(409, "KEY_LIMIT", "organizations.maxApiKeys active keys already exist",
                "Revoke an unused key before creating another.")],
       steps=["Generate 32 random bytes, prefix tlk_", "Store prefix and SHA-256 hash", "Emit audit.record apiKey.create"],
       controller="ApiKeysController", service="ApiKeysService", call="create(orgId, dto, actor)",
       seq=["Svc->>DB: INSERT api_keys"]),

    ep("POST", "/api/organizations/:id/api-keys/:keyId/revoke", "Revoke an API key", "Org Manager: own",
       "Revokes a key; the next request with it gets 401 and an open stream with it is closed.",
       "UC-06, FR-ORG-06, E04-5",
       path=[ORG_PATH, ["keyId", "Key id", "uuid", "`k-1`"]], response={**KEY, "revokedAt": NOW},
       message="API key revoked", entity="API key",
       steps=["Set revokedAt and revokedBy", "Emit apiKey.revoked (monitoring closes its sockets)"],
       controller="ApiKeysController", service="ApiKeysService", call="revoke(orgId, keyId, actor)",
       seq=["Svc->>DB: UPDATE api_keys", "Svc-)Svc: emit apiKey.revoked"]),

    ep("GET", "/api/organizations/:id/field-stations", "List Field Station credentials",
       "Org Manager, Org Operator: own; TrekLink Staff, TrekLink Admin",
       "Lists the organization's Field Station credentials with their health: last sync, queue depth per "
       "tier, the retry count of the oldest queued event, and the version the station last reported, "
       "flagged `outdated` when it is older than the current release (FR-EVT-13, FR-EVT-18). `queueDepth` "
       "is named per priority, `{p0, p1, p2, p3}`, while the column stays `Int[]` (D-057 rule 9). The list carries the number of active credentials "
       "the organization may hold (ruling 2026-10-30).",
       "UC-06, UC-42, FR-EVT-13, FR-EVT-14, FR-EVT-18",
       path=[ORG_PATH], response={"items": [STATION], "limit": 5},
       fields=limit_field("organizations.maxFieldStations", "STATION_LIMIT")
       + [["items[].queueDepth", "Queued events per priority, `{p0, p1, p2, p3}`; null until the station first reports",
           "object", "`{\"p0\": 0, \"p1\": 0, \"p2\": 3, \"p3\": 12}`"]],
       entity="Organization", steps=["Read field_stations", "Read organizations.maxFieldStations"],
       controller="FieldStationsController", service="FieldStationsService", call="list(orgId, caller)",
       participants=[["Prm", "ParameterService"]],
       seq=["Svc->>DB: SELECT field_stations", "Svc->>Prm: get(organizations.maxFieldStations)"]),

    ep("POST", "/api/organizations/:id/field-stations", "Create a Field Station credential", "Org Manager: own",
       "Creates a named Field Station credential (D-037). The MQTT username and secret are returned once; "
       "only the secret's bcrypt hash is stored. The broker accepts publishes under it only for devices "
       "the organization rents (FR-EVT-14).", "UC-06, FR-EVT-14, D-037",
       path=[ORG_PATH], body=[["name", "Label, for example where the laptop runs", "string", "yes", "`Ta Nang basecamp laptop`"]],
       sample={"name": "Ta Nang basecamp laptop"},
       response={**STATION, "lastSyncAt": None, "queueDepth": None, "mqttSecret": "fs_s3cr3t...shown-once",
                 "brokerUrl": "mqtts://mqtt.treklink.vn:8883"}, status=201,
       message="Field Station credential created. Copy it now; it will not be shown again.", entity="Organization",
       errors=[state_409("organization", "SUSPENDED"),
               (409, "STATION_LIMIT", "organizations.maxFieldStations active credentials already exist",
                "Revoke an unused Field Station before creating another.")],
       steps=["Require ACTIVE", "Generate username fs-<org>-<n> and a random secret", "Store the bcrypt hash",
              "Emit audit.record fieldStation.create"],
       controller="FieldStationsController", service="FieldStationsService", call="create(orgId, dto, actor)",
       seq=["Svc->>DB: INSERT field_stations"]),

    ep("POST", "/api/organizations/:id/field-stations/:stationId/revoke", "Revoke a Field Station credential",
       "Org Manager: own; TrekLink Staff, TrekLink Admin",
       "Revokes a credential; the broker refuses it from the next connection (FR-EVT-14). The broker's "
       "auth cache is at most 60 s, and from the moment of revocation the backend drops every message "
       "published under it. Events the station still holds are delivered once a new credential is "
       "configured, since the queue lives on the laptop.", "UC-06, FR-EVT-14, D-037",
       path=[ORG_PATH, ["stationId", "Field Station id", "uuid", f"`{STATION_ID}`"]],
       body=[["reason", "Why; required for TrekLink staff", "string", "no", "`Laptop stolen`"]],
       sample={"reason": "Laptop stolen"}, response={**STATION, "revokedAt": NOW}, message="Field Station credential revoked",
       entity="Field Station",
       steps=["Set revokedAt and revokedBy", "Emit fieldStation.revoked (gateway-sync stops accepting its topic)"],
       controller="FieldStationsController", service="FieldStationsService", call="revoke(orgId, stationId, dto, actor)",
       seq=["Svc->>DB: UPDATE field_stations", "Svc-)Svc: emit fieldStation.revoked"]),

    ep("GET", "/api/organizations/:id/field-stations/release", "Get the current Field Station release",
       "Org Manager, Org Operator: own; TrekLink Staff, TrekLink Admin",
       "Returns the current Field Station release: its version, publication time and one download per "
       "operating system with its SHA-256 and size. The files are served as static downloads outside the "
       "envelope. The organization updates a station by downloading the new release and replacing the "
       "executable (D-039, FR-EVT-18).", "UC-06, FR-EVT-18, D-039",
       path=[ORG_PATH],
       response={"version": "1.2.0", "publishedAt": NOW,
                 "files": [{"os": "windows-x64", "downloadUrl": "/downloads/field-station/1.2.0/treklink-field-station-1.2.0-win-x64.exe",
                            "sha256": "4be1...9a", "sizeBytes": 48211456}]},
       entity="Organization",
       errors=[(503, "RELEASE_UNAVAILABLE", "No readable release.json in FIELD_STATION_RELEASE_DIR",
                "The Field Station download is unavailable. Try again later.")],
       steps=["Read release.json from FIELD_STATION_RELEASE_DIR"],
       controller="FieldStationsController", service="FieldStationReleaseService", call="current()",
       participants=[["Store", "File storage"]], seq=["Svc->>Store: read release.json"]),

    ep("POST", "/api/organizations/:id/channel-key/rotate", "Rotate the organization channel key", "TrekLink Staff",
       "Records that TrekLink rotated the organization's channel key with the counter's provisioning tool: "
       "`channelKeyVersion` increases and `channelKeyExposedAt` is cleared. Devices take the new version as "
       "they are re-provisioned at the counter; until then they hold the old key (D-045, D-021).",
       "UC-60, FR-DEV-13, D-045",
       path=[ORG_PATH], body=[["reason", "Why", "string", "yes", "`Device TL-0042 lost in renter custody`"], VERSION],
       sample={"reason": "Device TL-0042 lost in renter custody", "expectedVersion": 4},
       response={"id": ORG_ID, "channelKeyVersion": 3, "channelKeyExposedAt": None}, message="Channel key rotated",
       entity="Organization", errors=[state_409("organization", "CLOSED"), STALE],
       steps=["Require ACTIVE or SUSPENDED", "Increase channelKeyVersion, clear channelKeyExposedAt",
              "Emit audit.record organization.rotateKey"],
       controller="OrganizationsController", service="OrganizationsService", call="rotateKey(id, dto, actor)",
       seq=["Svc->>DB: UPDATE organizations channelKeyVersion, channelKeyExposedAt"]),

    ep("GET", "/api/compliance-cases", "List compliance cases", "TrekLink Staff, TrekLink Admin",
       "Lists compliance cases by status and type (FR-ORG-08).", "UC-63, FR-ORG-08",
       query=PAGE_QUERY + [["status", "OPEN or CLOSED", "string", "no", "`OPEN`"]],
       response=paged({**CASE, "actions": [ACTION]}), fields=action_fields("items[].actions[]"),
       steps=["Read compliance_cases"], controller="ComplianceCasesController", service="ComplianceCaseService",
       call="list(query, caller)", seq=["Svc->>DB: SELECT compliance_cases"]),

    ep("POST", "/api/organizations/:id/compliance-cases", "Open a compliance case", "TrekLink Staff, TrekLink Admin",
       "Opens a case against an organization for a suspected fraud, theft, IP violation, NDA breach or other "
       "breach, with evidence notes and linked contracts or loss cases (FR-ORG-08, D-046).", "UC-63, FR-ORG-08, D-046",
       path=[ORG_PATH], body=[["type", "SUSPECTED_FRAUD, SUSPECTED_THEFT, IP_VIOLATION, NDA_BREACH or OTHER_BREACH", "string", "yes", "`SUSPECTED_THEFT`"],
                              ["evidence", "What was observed", "string", "yes", "`Three devices unreturned 40 days after default`"],
                              ["linkedContractIds", "Contracts concerned", "uuid[]", "no", "see sample"],
                              ["linkedLossCaseIds", "Loss cases concerned", "uuid[]", "no", "`[]`"]],
       sample={"type": "SUSPECTED_THEFT", "evidence": CASE["evidence"], "linkedContractIds": CASE["linkedContractIds"],
               "linkedLossCaseIds": []},
       response=CASE, status=201, message="Compliance case opened", entity="Organization",
       steps=["Insert compliance_cases OPEN", "Link the loss cases", "Emit audit.record complianceCase.open"],
       controller="ComplianceCasesController", service="ComplianceCaseService", call="open(orgId, dto, actor)",
       seq=["Svc->>DB: INSERT compliance_cases; UPDATE loss_cases SET complianceCaseId"]),

    ep("POST", "/api/compliance-cases/:id/actions", "Record an action on a compliance case",
       "TrekLink Admin (suspend); TrekLink Staff, TrekLink Admin (revoke)",
       "Takes and records an action from the case: suspend the organization (FR-ORG-07), or revoke a Field "
       "Station credential or an API key. Each action is an append-only row with actor and time (FR-ORG-09).",
       "UC-63, FR-ORG-09, FR-ORG-07",
       path=[CASE_PATH], body=[["kind", "SUSPEND_ORGANIZATION, REVOKE_FIELD_STATION, REVOKE_API_KEY or OTHER", "string", "yes", "`SUSPEND_ORGANIZATION`"],
                               ["targetId", "Field Station or API key id, for a revocation", "uuid", "no", f"`{STATION_ID}`"],
                               ["note", "Why", "string", "yes", "`Devices withheld after default`"]],
       sample={"kind": "SUSPEND_ORGANIZATION", "targetId": None, "note": "Devices withheld after default"},
       response={**CASE, "actions": [ACTION]}, fields=action_fields(), status=201, message="Action recorded",
       entity="Compliance case",
       errors=[(403, "FORBIDDEN", "Only an Admin may suspend", "Ask a TrekLink Admin to suspend the organization."),
               state_409("compliance case", "CLOSED")],
       steps=["Require OPEN", "Run the action through the existing service", "Insert compliance_actions"],
       controller="ComplianceCasesController", service="ComplianceCaseService", call="act(id, dto, actor)",
       seq=["Svc->>Svc: suspend or revoke through OrganizationsService", "Svc->>DB: INSERT compliance_actions"]),

    ep("POST", "/api/compliance-cases/:id/close", "Close a compliance case", "TrekLink Staff, TrekLink Admin",
       "Closes the case with an outcome. A suspected fraud or theft case needs a police report reference "
       "(BR-40).", "UC-63, FR-ORG-08, BR-40",
       path=[CASE_PATH], body=[["outcome", "What was decided", "string", "yes", "`Devices recovered by police; contract settled`"],
                               ["authorityReference", "Police report reference", "string", "no", "`CA-PD-2026-118`"]],
       sample={"outcome": "Devices recovered by police; contract settled", "authorityReference": "CA-PD-2026-118"},
       response={**CASE, "status": "CLOSED", "authorityReference": "CA-PD-2026-118",
                 "outcome": "Devices recovered by police; contract settled", "actions": [ACTION]},
       fields=action_fields(), message="Compliance case closed",
       entity="Compliance case",
       errors=[(409, "POLICE_REFERENCE_REQUIRED", "Suspected fraud or theft without authorityReference",
                "Record the police report reference before closing.")],
       steps=["Require OPEN", "Require authorityReference for SUSPECTED_FRAUD or SUSPECTED_THEFT", "Set CLOSED, outcome, closedBy"],
       controller="ComplianceCasesController", service="ComplianceCaseService", call="close(id, dto, actor)",
       seq=["Svc->>DB: UPDATE compliance_cases CLOSED"]),

    ep("GET", "/api/compliance-cases/:id", "Compliance case detail", "TrekLink Staff, TrekLink Admin",
       "Returns one compliance case, the same fields as an item of the list, with every action taken from "
       "it and the actor and time of each (FR-ORG-08, FR-ORG-09, ruling 2026-10-30).",
       "UC-63, FR-ORG-08, FR-ORG-09",
       path=[CASE_PATH], response={**CASE, "actions": [ACTION]}, fields=action_fields(),
       entity="Compliance case",
       steps=["Read the compliance case", "Read its compliance_actions with the actor's name, oldest first"],
       controller="ComplianceCasesController", service="ComplianceCaseService", call="get(id, caller)",
       seq=["Svc->>DB: SELECT compliance_cases WHERE id",
            "Svc->>DB: SELECT compliance_actions JOIN users ORDER BY createdAt"]),
]
