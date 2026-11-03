from ._common import (USER_ID, ORG_ID, DEVICE_ID, VARIANT_ID, VARIANT_SUMMARY, CONTRACT_ID, NOW, ep, paged, PAGE_QUERY,
                      state_409, STALE)

CONTRACT = {"id": CONTRACT_ID, "code": "RC-2026-0042", "organization": {"id": ORG_ID, "code": "ORG-0007",
                                                                        "legalName": "ACME Trek Co., Ltd."},
            "planType": "MONTHLY", "dayPlanDays": None, "hardwareVariant": {"id": VARIANT_ID, "code": "treklink-v3"},
            "quantity": 10, "requestedStartDate": "2026-10-25", "monthlyUnitPriceVnd": 450000, "dayPremium": None,
            "holdingFeeRatio": 0.5, "status": "ACTIVE", "statusChangedAt": NOW, "handedOverAt": NOW,
            "currentTerm": {"seq": 1, "startsAt": "2026-10-25T02:00:00Z", "endsAt": "2026-11-25T02:00:00Z"},
            "endsAt": None, "noticeGivenAt": None, "returnDueAt": None, "version": 4}
CDEV = {"deviceId": DEVICE_ID, "assetTag": "TL-0042", "nodeNum": 275612, "handedOverAt": NOW,
        "checkedInAt": None, "lostAt": None,
        "holder": {"name": "Le Thi E", "phone": "0912345678", "emergencyContact": "Le Van F, 0987654321"}}
GROUP = {"id": "g-1", "name": "Ranger patrol north", "label": "ranger patrol", "parentId": None,
         "startsOn": "2026-11-05", "endsOn": "2026-11-20", "areaNote": "Bidoup ridge, sector 3", "version": 1,
         "deviceCount": 3, "createdAt": NOW, "updatedAt": NOW}
G_PATH = ["id", "Group id; members may use only their own organization's", "uuid", "`g-1`"]
G_DEPTH = (409, "GROUP_DEPTH_EXCEEDED", "The parent's depth plus one plus the height of the group's own subgroups "
           "exceeds `rentals.groupMaxDepth`, or the parent is the group itself or one of its subgroups", "Groups can be nested only 1 level(s) deep. Choose a top-level group as the parent.")
G_UNIQUE = (409, "CONFLICT_UNIQUE", "A live group of the organization with the same parent has that name",
            "A group with this name already exists here.")
C_PATH = ["id", "Contract id; members may use only their own organization's", "uuid", f"`{CONTRACT_ID}`"]
D_PATH = ["deviceId", "Device committed to the contract", "uuid", f"`{DEVICE_ID}`"]
VERSION = ["expectedVersion", "Contract version the caller saw", "int", "yes", "`4`"]
NOT_ON = (409, "DEVICE_NOT_ON_CONTRACT", "The device is not committed to this contract",
          "TL-0042 does not belong to contract RC-2026-0042.")
# D-080, D-082: the docked unit's nodeNum must equal the device record's before a write is kept.
NODE_MISMATCH = (409, "NODE_MISMATCH", "The docked unit's nodeNum differs from the device record",
                 "The docked unit is !0004351c, not TL-0042. Nothing was written.")

ENDPOINTS = [
    ep("POST", "/api/contracts", "Request a rental contract", "Org Manager: own",
       "Requests a plan: monthly, or a day plan of a configured length; one hardware variant; a quantity "
       "at or above the minimum order quantity; a start date. Prices are snapshotted now, so a later price "
       "change does not affect this contract (FR-CFG-02). The organization must be `ACTIVE`. Since D-092 rule 1 "
       "the request holds its devices at once: in the same transaction it reserves the quantity of `AVAILABLE` "
       "units (the approval's row-lock query), creates term 1 and issues the first invoice, whose first line "
       "(the holding fee, or the day-plan fee) is the deposit. The hold lasts `rentals.requestHoldHours`; an "
       "unpaid hold then expires and the contract is cancelled (rentals REQ-EVT-17). Too few units is 409 "
       "`INSUFFICIENT_DEVICES` and nothing is created, so two organizations racing for the last units are "
       "served first come, first served (REQ-UBI-02). The form shows the count of devices api-design 24 first.",
       "UC-15, FR-CON-01, FR-CON-02, FR-CON-07, FR-BILL-01, FR-BILL-02, BR-01, BR-02, BR-03, E01-1, E01-2, E01-3, MSG11, MSG13, MSG14, D-092",
       body=[["planType", "`MONTHLY` or `DAY`", "enum", "yes", "`MONTHLY`"],
             ["dayPlanDays", "One of rentals.dayPlanLengths; DAY only", "int", "cond.", "`4`"],
             ["hardwareVariantId", "Active variant", "uuid", "yes", f"`{VARIANT_ID}`"],
             ["quantity", "At least rentals.minOrderQuantity", "int", "yes", "`10`"],
             ["requestedStartDate", "Handover day, not in the past", "date", "yes", "`2026-10-25`"]],
       sample={"planType": "MONTHLY", "hardwareVariantId": VARIANT_ID, "quantity": 10, "requestedStartDate": "2026-10-25"},
       response={**CONTRACT, "status": "REQUESTED", "handedOverAt": None, "version": 0,
                 "quote": {"firstPaymentVnd": 2250000, "termFeeVnd": 4500000},
                 "holdExpiresAt": "2026-10-23T03:00:00Z", "heldDevices": 10},
       fields=[["quote.firstPaymentVnd", "The deposit: the holding fee of a monthly plan, or the whole day-plan fee; "
                "the first line of the invoice issued now", "int", "`2250000`"],
               ["holdExpiresAt", "When an unpaid hold is released and the request cancelled "
                "(request time + rentals.requestHoldHours)", "datetime", "`2026-10-23T03:00:00Z`"],
               ["heldDevices", "Units held for this request, always the quantity", "int", "`10`"]],
       status=201, message="Request sent. Your devices are held; TrekLink will confirm your handover appointment.",
       # In the order ContractsService.request checks them: the organization first, inside the transaction.
       errors=[(409, "ORGANIZATION_NOT_ACTIVE", "The organization is PENDING, REJECTED, SUSPENDED or CLOSED",
                "Your organization cannot request devices while it is SUSPENDED."),
               (400, "BELOW_MOQ", "Quantity below rentals.minOrderQuantity", "The minimum order is 5 devices."),
               (400, "DAY_PLAN_LENGTH", "dayPlanDays is not a configured length", "Choose a plan of 3, 4 or 7 days."),
               (400, "VALIDATION_FAILED", "requestedStartDate is before today",
                "requestedStartDate must not be in the past."),
               (404, "NOT_FOUND", "The hardware variant is unknown or inactive",
                "Active hardware variant not found."),
               (409, "INSUFFICIENT_DEVICES", "Fewer AVAILABLE devices of the variant than requested; nothing is created (MSG11)",
                "Only 7 treklink-v3 devices are available. Lower the quantity or choose another variant.")],
       steps=["Lock the organization row FOR SHARE in the request transaction and require it ACTIVE",
              "Validate quantity, day-plan length and start date",
              "Require an active hardware variant", "Snapshot price, premium and holding ratio from billing",
              "Insert the contract REQUESTED with holdExpiresAt",
              "SELECT AVAILABLE devices of the variant FOR UPDATE SKIP LOCKED LIMIT quantity, move them to RESERVED, insert contract_devices",
              "Create term 1 from the requested start date and issue its invoice through billing",
              "Notify TrekLink Staff"],
       controller="ContractsController", service="ContractsService", call="request(dto, caller)",
       participants=[["Org", "OrganizationsService"], ["Bill", "PricingService, InvoicesService (billing)"],
                     ["Dev", "DevicesService"]],
       seq=["Svc->>Org: lockActive(orgId, tx), SELECT organizations FOR SHARE", "Svc->>Bill: snapshot(variantId, tx, at)",
            "Svc->>DB: INSERT rental_contracts, contract_transitions",
            "Svc->>Dev: reserve(variant, quantity, at, tx)", "Dev->>DB: SELECT ... FOR UPDATE SKIP LOCKED",
            "Svc->>DB: INSERT contract_devices, contract_terms",
            "Svc->>Bill: issueTermInvoice or issueDayPlanInvoice(contract, term, tx)"]),

    ep("GET", "/api/contracts", "List contracts", "Org Manager, Org Operator: own; TrekLink Staff, TrekLink Admin",
       "Lists contracts. The Staff approval queue is `status=REQUESTED`; the handover queue is `APPROVED`.",
       "UC-55, FR-AUTH-11",
       query=[["status", "ContractStatus, repeatable", "enum", "no", "`REQUESTED`"],
              ["organizationId", "TrekLink staff only", "uuid", "no", f"`{ORG_ID}`"],
              ["planType", "Plan", "enum", "no", "`DAY`"]] + PAGE_QUERY,
       response=paged(CONTRACT, 3), steps=["Apply scope", "Read contracts"],
       controller="ContractsController", service="ContractsService", call="list(query, caller)",
       seq=["Svc->>DB: SELECT rental_contracts WHERE scope"]),

    ep("GET", "/api/contracts/:id", "Contract detail", "Org Manager, Org Operator: own; TrekLink Staff, TrekLink Admin",
       "Returns the contract with its terms, committed devices (with holder labels and each device's "
       "nodeNum, read-only, D-080) and balance summary.",
       "UC-55, FR-AUTH-11, FR-CON-07, D-080",
       path=[C_PATH], response={**CONTRACT, "handoverAppointmentAt": "2026-10-25T02:00:00Z", "holdExpiresAt": None,
                                "terms": [{"seq": 1, "startsAt": "2026-10-25T02:00:00Z",
                                                       "endsAt": "2026-11-25T02:00:00Z", "status": "OPEN"}],
                                "devices": [{**CDEV, "hardwareVariant": VARIANT_SUMMARY, "contractDeviceId": "cd-1",
                                             "resetAt": None, "inspection": None,
                                             "provisionedKeyVersion": None, "afterReturn": None}],
                                "balance": {"dueNowVnd": 0, "dueLaterVnd": 2250000}},
       fields=[["holdExpiresAt", "When the hold of a request expires unpaid (D-092); kept after the decision as history; "
                "null for a contract requested before D-092", "datetime", "`null`"],
               ["devices[].resetAt", "First reset of the unit at or after this row's check-in and before the unit's "
                "next return (devices api-design 10), null when not checked in or not reset yet; the return counter shows it after a reload", "datetime",
                "`2026-10-30T03:05:00.000Z`"],
               ["devices[].hardwareVariant", "The shared variant summary of devices design section 10 (`id`, `code`, `name`, "
                "`imageUrl`, `specSheet`, `hasGps`, `hasMotionSensor`, `mqttCapable`, `firmwareBaseline`), the variant of the contract, "
                "for the device reference and variant card of the Devices tab; absent on the holder answer (api-design 20)", "object",
                "`{\"id\": \"...\", \"code\": \"treklink-v3\", ...}`"],
               ["devices[].contractDeviceId", "This row on the contract; a service credit is requested against it "
                "(billing api-design 18)", "uuid", "`cd-1`"],
               ["devices[].inspection", "Last inspection recorded against this row (api-design 16): `id`, `result` "
                "PASSED, DAMAGED or FAILED, and `at`; null when none. A FAILED one backs a service credit request "
                "(billing api-design 18)", "object", "`null`"],
               ["devices[].provisionedKeyVersion", "The channel key version the unit carries for this "
                "contract's organization (api-design 09), null when it holds none of it; the counter keeps "
                "provisioning after a reload", "int", "`1`"],
               ["devices[].afterReturn", "TrekLink callers only, for a checked-in row: the device's current `status` "
                "and `nextStep`, its next step back to `AVAILABLE` (devices REQ-EVT-23): `action` RESET, INSPECT, "
                "COMPLETE_MAINTENANCE or INTAKE with the `contractId` of the counter that records a reset or "
                "inspection, or null when none is left or a later return of the unit owns it (REQ-EVT-19, D-092 "
                "rule 4); null for a row not checked in and for organization callers", "object",
                "`{\"status\": \"RETURNED\", \"nextStep\": {\"action\": \"INSPECT\", \"contractId\": \"...\"}}`"]],
       entity="Contract", steps=["Read within scope", "Ask billing for the balance summary",
                                 "Ask DevicesService.returnChecks for the reset and inspection of each returned row",
                                 "For a TrekLink caller, ask DevicesService.nextSteps for the state after the return"],
       controller="ContractsController", service="ContractsService", call="get(id, caller)",
       participants=[["Bill", "BillingService"], ["Dev", "DevicesService"]],
       seq=["Svc->>DB: SELECT contract, terms, contract_devices", "Svc->>Dev: returnChecks(rows)",
            "Svc->>Bill: balanceSummary(id)"]),

    ep("POST", "/api/contracts/:id/approve", "Approve a contract", "TrekLink Staff, TrekLink Admin",
       "Confirms the handover appointment and moves the contract to `APPROVED` with the reservation expiry. "
       "Since D-092 rule 1 the request already holds its devices, its term 1 and its first invoice, and "
       "approval keeps them; `deviceIds`, when sent, must name exactly the held units (rentals REQ-ERR-11). "
       "A contract requested before D-092 holds none: approval then reserves exactly the requested number "
       "of `AVAILABLE` devices of the variant in one transaction holding row locks, creates term 1 and "
       "issues its invoice, as before; fewer available devices refuse it, never over-allocated "
       "(FR-CON-03, BR-03, E01-1). Staff may name those devices; otherwise the oldest-checked ones are taken.",
       "UC-16, UC-17, FR-CON-03, FR-CON-11, FR-DEV-01, BR-03, BR-04, E01-1, MSG11",
       path=[C_PATH],
       body=[["deviceIds", "Optional explicit choice, length = quantity", "uuid[]", "no", "`[...]`"],
             ["handoverAt", "Appointment at the counter", "datetime", "yes", "`2026-10-25T02:00:00Z`"], VERSION],
       sample={"handoverAt": "2026-10-25T02:00:00Z", "expectedVersion": 0},
       response={**CONTRACT, "status": "APPROVED", "handedOverAt": None,
                 "reservationExpiresAt": "2026-10-27T02:00:00Z", "handoverAppointmentAt": "2026-10-25T02:00:00Z",
                 "devices": [{**CDEV, "handedOverAt": None, "holder": None}]},
       message="Contract approved", entity="Contract",
       # In the order ContractDecisionsService.approve checks them: version and state before the
       # reservation, and DevicesService.reserve refuses a chosen unit before counting.
       errors=[STALE, state_409("contract", "APPROVED"),
               (400, "VALIDATION_FAILED", "handoverAt is before the current minute (REQ-ERR-09)",
                "The handover appointment is in the past. Choose a time from now on."),
               (400, "VALIDATION_FAILED", "deviceIds is not exactly the contract quantity of distinct ids",
                "Choose exactly 10 distinct devices."),
               (409, "INVALID_STATE_TRANSITION", "The request holds its devices, its holdExpiresAt has passed and the first payment is not paid in full (REQ-ERR-12)",
                "This request held its devices until the deposit was paid, and the hold has expired unpaid. It is cancelled shortly; the organization can request again."),
               (400, "VALIDATION_FAILED", "The request holds its devices and deviceIds names another set (REQ-ERR-11)",
                "This request already holds TL-0041, TL-0042. Swap a unit at the counter instead."),
               (409, "DEVICE_NOT_AVAILABLE", "A chosen device is not an AVAILABLE unit of the contract's variant",
                "TL-0042 is not an available treklink-v3 device. Choose available units of the variant."),
               (409, "INSUFFICIENT_DEVICES", "Fewer AVAILABLE devices of the variant than requested",
                "Only 7 treklink-v3 devices are available. Lower the quantity or choose another variant.")],
       steps=["Lock the contract",
              "Check the version, then the REQUESTED state, then that handoverAt is not in the past, then any chosen deviceIds",
              "Held devices: refuse an unpaid hold past holdExpiresAt (REQ-ERR-12), else keep them, with term 1 and the invoice of the request",
              "No held devices (requested before D-092): SELECT AVAILABLE devices of the variant FOR UPDATE SKIP LOCKED LIMIT quantity",
              "Move the devices to RESERVED, insert contract_devices",
              "Create term 1 from the requested start date and issue its invoice through billing",
              "Move the contract to APPROVED",
              "Notify the Manager with the appointment"],
       controller="ContractsController", service="ContractLifecycleService", call="approve(id, dto, actor)",
       participants=[["Dev", "DevicesService"], ["Bill", "BillingService"]],
       seq=["Svc->>DB: BEGIN, SELECT contract FOR UPDATE",
            "Svc->>Dev: reserve(variantId, quantity, contractId, tx)", "Dev->>DB: SELECT ... FOR UPDATE SKIP LOCKED",
            "Svc->>Bill: issueFirstInvoice(contract, tx)", "Svc->>DB: UPDATE contract, INSERT transition, COMMIT"]),

    ep("POST", "/api/contracts/:id/reject", "Reject a contract request", "TrekLink Staff, TrekLink Admin",
       "Rejects a `REQUESTED` contract with a reason shown to the Manager (MSG16). Since D-092 the request "
       "holds devices and a first invoice: in the same transaction they are released to `AVAILABLE` and the "
       "unpaid first-invoice lines are voided through billing. A deposit already paid is answered as "
       "`paidVnd` and refunded outside TrekLink (leader ruling 2026-11-01).", "UC-17, D-035, MSG16, D-092",
       path=[C_PATH], body=[["reason", "Reason", "string", "yes", "`Variant out of stock until November`"], VERSION],
       sample={"reason": "treklink-v4 is out of stock until November.", "expectedVersion": 0},
       response={**CONTRACT, "status": "REJECTED", "paidVnd": 0}, message="Contract rejected", entity="Contract",
       fields=[["paidVnd", "Deposit already paid on the request, to refund outside TrekLink; 0 when none", "int", "`0`"]],
       errors=[state_409("contract", "APPROVED"), STALE],
       steps=["Require REQUESTED", "Move to REJECTED", "Release held contract_devices, move devices to AVAILABLE",
              "Void unpaid first-invoice lines through billing", "Notify the Manager"],
       controller="ContractsController", service="ContractLifecycleService", call="reject(id, dto, actor)",
       participants=[["Dev", "DevicesService"], ["Bill", "BillingService"]],
       seq=["Svc->>DB: UPDATE contract, INSERT transition", "Svc->>Dev: release(deviceIds, tx)",
            "Svc->>Bill: settleCancellation(contract, tx)"]),

    ep("POST", "/api/contracts/:id/cancel", "Cancel before handover", "Org Manager: own; TrekLink Staff, TrekLink Admin",
       "Cancels a `REQUESTED` or `APPROVED` contract before handover and releases its devices to "
       "`AVAILABLE`. A holding fee already paid is retained; nothing else is charged (FR-CON-04, E01-7, MSG15).",
       "UC-18, FR-CON-04, E01-7, MSG15",
       path=[C_PATH], body=[["reason", "Reason", "string", "yes", "`Tour cancelled`"], VERSION],
       sample={"reason": "Our tour was cancelled.", "expectedVersion": 1},
       response={**CONTRACT, "status": "CANCELLED", "retainedVnd": 2250000}, message="Contract cancelled. Retained: 2,250,000 VND.",
       entity="Contract", errors=[state_409("contract", "ACTIVE"), STALE],
       steps=["Require REQUESTED or APPROVED", "Release contract_devices, move devices to AVAILABLE",
              "Void unpaid first-invoice lines through billing", "Move to CANCELLED"],
       controller="ContractsController", service="ContractLifecycleService", call="cancel(id, dto, caller)",
       participants=[["Dev", "DevicesService"], ["Bill", "BillingService"]],
       seq=["Svc->>Dev: release(contractId, tx)", "Svc->>Bill: settleCancellation(contract, tx)",
            "Svc->>DB: UPDATE contract, INSERT transition"]),

    ep("POST", "/api/contracts/:id/devices/:deviceId/swap", "Swap a reserved device", "TrekLink Staff",
       "A reserved device fails its check at handover: it goes to `MAINTENANCE` and another `AVAILABLE` "
       "device of the variant takes its place (E01-5). With no replacement available the handover is held.",
       "UC-20, FR-CON-05, FR-DEV-08, E01-5, MSG17",
       path=[C_PATH, D_PATH],
       body=[["reason", "What failed", "string", "yes", "`No GPS fix`"],
             ["replacementDeviceId", "Optional explicit replacement", "uuid", "no", "`...`"]],
       sample={"reason": "No GPS fix at the counter"},
       response={"released": {"deviceId": DEVICE_ID, "assetTag": "TL-0042", "status": "MAINTENANCE"},
                 "reserved": {"deviceId": "8f9e...", "assetTag": "TL-0051", "status": "RESERVED"}},
       message="Device swapped", entity="Contract",
       errors=[NOT_ON, (409, "INSUFFICIENT_DEVICES", "No AVAILABLE replacement of the variant",
                        "Only 0 treklink-v3 devices are available. Lower the quantity or choose another variant."),
               state_409("contract", "ACTIVE")],
       steps=["Require APPROVED", "Release the row, open maintenance on the failed device",
              "Reserve a replacement in the same transaction"],
       controller="HandoverController", service="ContractLifecycleService", call="swap(id, deviceId, dto, actor)",
       participants=[["Dev", "DevicesService"]],
       seq=["Svc->>Dev: failHandoverCheck(deviceId, tx)", "Svc->>Dev: reserve(variantId, 1, contractId, tx)"]),

    ep("GET", "/api/contracts/:id/handover-note/preview", "Preview the handover note", "TrekLink Staff",
       "Renders the handover note PDF without a signature, for the Manager to read at the counter before "
       "signing (FR-CON-06).", "UC-21, FR-CON-06",
       path=[C_PATH],
       query=[["checks", "JSON array of the readings the counter holds, in the shape of api-design 10 "
               "`deviceChecks` (`deviceId`, `batteryPct` 0 to 100, `gpsFixOk`); the note prints each unit's "
               "battery and GPS fix, and \"not checked\" for a unit without a reading. Nothing is stored",
               "string (JSON)", "no",
               '`[{"deviceId":"0d3f6a2b-7e11-4c55-8f0a-2b1c9e7d4a10","batteryPct":96,"gpsFixOk":true}]`']],
       response={"pdfBase64": "JVBERi0xLjcK...", "sha256": None},
       notes="Returns `application/json` with the PDF as base64 so the envelope holds.",
       entity="Contract", errors=[state_409("contract", "REQUESTED")],
       steps=["Require APPROVED", "Render organization, plan, term dates and every device by asset tag, "
              "with its battery and GPS fix from checks"],
       controller="ContractsController", service="HandoverNoteService", call="preview(id, checks)",
       seq=["Svc->>DB: SELECT contract, devices, organization", "Svc->>Svc: render PDF"]),

    ep("POST", "/api/contracts/:id/devices/:deviceId/provisioning", "Record provisioning", "TrekLink Staff",
       "Records that the organization's channel key, at its current version, was written to a device "
       "reserved to this contract, by docking it at the counter (D-080, D-082). Only the version and the "
       "organization are stored; the key is never stored, shown, returned or logged (FR-DEV-05, "
       "NFR-SEC-06, NFR-IF-03). A docked nodeNum must match the device record (REQ-ERR-12); a record "
       "without one comes from the Enter manually fallback (devices design §8.6 decision 3) and is audited "
       "as manual.",
       "UC-14, FR-DEV-05, BR-09, NFR-IF-03, D-080, D-082",
       path=[C_PATH, D_PATH],
       body=[["keyVersion", "Must equal the organization's channelKeyVersion", "int", "yes", "`1`"],
             ["nodeNum", "The nodeNum read back from the docked unit; omitted only by the manual fallback "
              "until every rented variant docks", "int", "no", "`275612`"]],
       sample={"keyVersion": 1, "nodeNum": 275612},
       response={"deviceId": DEVICE_ID, "assetTag": "TL-0042", "status": "RESERVED", "keyVersion": 1,
                 "keyOrganizationId": ORG_ID, "provisionedAt": NOW}, status=201, message="Provisioning recorded",
       entity="Contract",
       errors=[NOT_ON, NODE_MISMATCH,
               (409, "KEY_VERSION_MISMATCH", "keyVersion differs from the organization's current version",
                "Provision this device with the organization's key before handover."),
               state_409("contract", "REQUESTED")],
       steps=["Require APPROVED and the device reserved to it", "Compare the docked nodeNum with the device record when it is sent",
              "Read the organization's key version", "DevicesService.recordProvisioning in one transaction",
              "Audit row marks a record without nodeNum as manual"],
       controller="HandoverController", service="HandoverService", call="provision(id, deviceId, dto, actor)",
       participants=[["Org", "OrganizationsService"], ["Dev", "DevicesService"]],
       seq=["Svc->>Dev: byNodeNum(nodeNum)", "Svc->>Org: channelKeyVersion(orgId)",
            "Svc->>Dev: recordProvisioning(deviceId, orgId, keyVersion, tx)"]),

    ep("POST", "/api/contracts/:id/handover", "Complete the handover", "TrekLink Staff",
       "Completes the handover at the counter. Requires the first payment confirmed, the Manager's identity "
       "checked, every reserved device provisioned with the organization's current key and its handover "
       "check passed, and the drawn signature. Stamps the signature into the note, stores the PDF and its "
       "SHA-256, then moves the contract to `ACTIVE` and its devices to `RENTED` in one "
       "transaction (FR-CON-05, FR-CON-06, BR-09, D-037).",
       "UC-20, UC-21, FR-CON-05, FR-CON-06, FR-DEV-01, FR-DEV-05, BR-09, E01-4, MSG06, MSG19, MSG23, MSG24",
       path=[C_PATH],
       body=[["signedByMemberId", "Org Manager signing", "uuid", "yes", f"`{USER_ID}`"],
             ["identityChecked", "Document type and last digits seen", "string", "yes", "`CCCD ...4821`"],
             ["signaturePng", "Drawn signature, base64 PNG", "string", "yes", "`iVBORw0KGgo...`"],
             ["deviceChecks", "Per device: batteryPct and gpsFixOk at the counter", "object[]", "yes", "see sample"],
             ["acknowledgeLowBattery", "Proceed although a battery is below devices.handoverMinBatteryPct", "bool", "no", "`false`"],
             VERSION],
       sample={"signedByMemberId": USER_ID, "identityChecked": "CCCD ...4821", "signaturePng": "iVBORw0KGgo...",
               "deviceChecks": [{"deviceId": DEVICE_ID, "batteryPct": 96, "gpsFixOk": True}], "expectedVersion": 2},
       response={**CONTRACT, "handoverNoteSha256": "9f2c...e1", "devices": [CDEV]},
       message="Handover complete. 10 devices issued under contract RC-2026-0042.", entity="Contract",
       errors=[(409, "FIRST_PAYMENT_MISSING", "The holding fee or day-plan fee is not confirmed",
                "The first payment is not recorded yet."),
               (409, "DEVICE_NOT_PROVISIONED", "A device lacks provisioning at the current key version",
                "Provision this device with the organization's key before handover."),
               (409, "DEVICE_CHECK_FAILED", "A device check failed; swap it first", "This device cannot be allocated while it is MAINTENANCE."),
               (409, "LOW_BATTERY", "A battery is below the minimum and not acknowledged", "Battery 41 %. Charge before use."),
               (409, "BEFORE_START_DATE", "The requested start date has not come yet", "Handover is possible from 2026-10-25."),
               (400, "SIGNER_NOT_MANAGER", "The signer is not an active Manager of the organization",
                "Only a Manager of the organization can sign."),
               state_409("contract", "REQUESTED"), STALE],
       steps=["Require APPROVED and the first payment confirmed", "Check every device provisioned and passing",
              "Stamp the signature into the PDF, store it and its hash",
              "Move devices to RENTED and the contract to ACTIVE in one transaction", "Emit contract.activated"],
       controller="HandoverController", service="HandoverService", call="complete(id, dto, actor)",
       participants=[["Bill", "BillingService"], ["Dev", "DevicesService"], ["Store", "File storage"]],
       seq=["Svc->>Bill: firstPaymentConfirmed(id)", "Svc->>Dev: assertReadyForHandover(ids, keyVersion)",
            "Svc->>Store: put(note.pdf)", "Svc->>DB: BEGIN, UPDATE contract_devices",
            "Svc->>Dev: markRented(ids, tx)", "Svc->>DB: UPDATE contract, INSERT transition, COMMIT"]),

    ep("GET", "/api/contracts/:id/handover-note", "Download the signed handover note",
       "Org Manager: own; TrekLink Staff, TrekLink Admin",
       "Returns the signed PDF and its stored SHA-256; the hash is recomputed on read and a mismatch is "
       "reported, never repaired (FR-CON-06).", "UC-21, FR-CON-06",
       path=[C_PATH], response={"pdfBase64": "JVBERi0xLjcK...", "sha256": "9f2c...e1", "integrity": "OK"},
       entity="Contract", errors=[(409, "NOTE_NOT_SIGNED", "No signed note exists yet", "The handover is not complete yet.")],
       steps=["Load the PDF", "Recompute and compare the hash"],
       controller="ContractsController", service="HandoverNoteService", call="download(id, caller)",
       participants=[["Store", "File storage"]], seq=["Svc->>Store: get(path)", "Svc->>Svc: sha256 compare"]),

    ep("POST", "/api/contracts/:id/notice", "Give notice", "Org Manager: own",
       "Gives notice on a running monthly contract: it moves to `ENDING`, effective at the current term's "
       "end, when the devices fall due (FR-CON-09, BR-08, MSG18). A day plan cannot take notice.",
       "UC-23, FR-CON-09, BR-08, MSG18",
       path=[C_PATH], body=[VERSION], sample={"expectedVersion": 4},
       response={**CONTRACT, "status": "ENDING", "noticeGivenAt": NOW, "endsAt": "2026-11-25T02:00:00Z"},
       message="Notice recorded. The contract ends on 2026-11-25; 2,250,000 VND is due then.", entity="Contract",
       errors=[(409, "DAY_PLAN_NO_NOTICE", "The contract is a day plan", "A day plan ends on its own end date."),
               state_409("contract", "ENDING"), STALE],
       steps=["Require MONTHLY and ACTIVE", "Set endsAt to the current term end", "Move to ENDING"],
       controller="ContractsController", service="ContractLifecycleService", call="giveNotice(id, dto, caller)",
       seq=["Svc->>DB: UPDATE contract, INSERT transition"]),

    ep("PUT", "/api/contracts/:id/devices/:deviceId/holder", "Label a device holder",
       "Org Manager, Org Operator: own",
       "Sets or clears the optional holder label (name, phone, emergency contact) shown on the map and in "
       "alerts for this device. Labels are erased when the contract closes (FR-CON-14, BR-33, NFR-LEG-02).",
       "UC-25, FR-CON-14, BR-33",
       path=[C_PATH, D_PATH],
       body=[["name", "Holder name; null clears the label", "string", "no", "`Le Thi E`"],
             ["phone", "Holder phone", "string", "no", "`0912345678`"],
             ["emergencyContact", "Name and phone", "string", "no", "`Le Van F, 0987654321`"]],
       sample={"name": "Le Thi E", "phone": "0912345678", "emergencyContact": "Le Van F, 0987654321"},
       response=CDEV, message="Saved.", entity="Contract",
       errors=[NOT_ON, state_409("contract", "CLOSED")],
       steps=["Require the device handed over and not checked in", "Update the label", "Emit device.label.changed"],
       controller="ContractsController", service="ContractsService", call="labelHolder(id, deviceId, dto, caller)",
       seq=["Svc->>DB: UPDATE contract_devices"]),

    ep("POST", "/api/contracts/:id/check-ins", "Check devices in", "TrekLink Staff",
       "Checks returned devices in at the counter by asset tag. Each moves to `RETURNED`, its live data "
       "stops reaching the organization (FR-MON-08), and late days are charged when it comes back after "
       "the end plus the grace (FR-BILL-03). When every device is back or recorded lost a `RETURN_DUE`, "
       "`OVERDUE` or `DEFAULTED` contract moves to `RETURNED`; an early return during `ACTIVE` (day plan) or "
       "`ENDING` waits for the end-of-plan job (D-035). A partial check-in is allowed (MSG07).",
       "UC-43, FR-DEV-01, FR-MON-08, FR-BILL-03, E05-1, MSG07, MSG12",
       path=[C_PATH], body=[["assetTags", "Scanned tags", "string[]", "yes", "`[\"TL-0042\"]`"]],
       sample={"assetTags": ["TL-0042", "TL-0043"]},
       response={"checkedIn": ["TL-0042", "TL-0043"], "returned": 10, "total": 10, "contractStatus": "RETURNED",
                 "lateFeeVnd": 0},
       message="Check-in complete. 10 of 10 devices returned.", entity="Contract",
       errors=[(409, "DEVICE_NOT_ON_CONTRACT", "A tag is not on this contract", "TL-0099 does not belong to contract RC-2026-0042."),
               state_409("contract", "APPROVED")],
       steps=["Require ENDING, RETURN_DUE, OVERDUE or DEFAULTED, or ACTIVE for a day plan returned early",
              "Mark rows checked in",
              "Move devices to RETURNED", "Charge late days per device", "Move a RETURN_DUE, OVERDUE or DEFAULTED contract to RETURNED when complete",
              "Emit device.checkedIn per device"],
       controller="ContractsController", service="ReturnService", call="checkIn(id, dto, actor)",
       participants=[["Dev", "DevicesService"], ["Bill", "BillingService"]],
       seq=["Svc->>DB: BEGIN, SELECT contract_devices FOR UPDATE", "Svc->>Dev: markReturned(ids, tx)",
            "Svc->>Bill: chargeLate(contract, devices, tx)", "Svc->>DB: UPDATE contract if complete, COMMIT"]),

    ep("POST", "/api/contracts/:id/devices/:deviceId/replacement", "Replace a device on a running contract",
       "TrekLink Staff",
       "Replaces a faulty unit, or a unit with an open loss case, on an `ACTIVE` or `ENDING` contract with an "
       "`AVAILABLE` unit of the same variant. The faulty unit, if present, is checked in; the replacement is "
       "provisioned, signed on screen by the Manager, and gets its own custody interval. Plan, variant and "
       "quantity stay unchanged (FR-CON-15, BR-41, BR-05).", "UC-61, FR-CON-15, BR-41, BR-05",
       path=[C_PATH, D_PATH],
       body=[["replacementDeviceId", "An AVAILABLE device of the same variant", "uuid", "yes", "`5e6f7a8b-...`"],
             ["keyVersion", "Channel key version written to the replacement", "int", "yes", "`2`"],
             ["signatureImage", "Manager's on-screen signature, PNG base64", "string", "yes", "`iVBORw0KGgo...`"],
             ["faultyPresent", "The faulty unit is at the counter and is checked in now", "bool", "yes", "`true`"]],
       sample={"replacementDeviceId": "5e6f7a8b-9c0d-4e1f-a2b3-c4d5e6f7a8b9", "keyVersion": 2,
               "signatureImage": "iVBORw0KGgo...", "faultyPresent": True},
       response={"replacedDeviceId": DEVICE_ID, "replacementDeviceId": "5e6f7a8b-9c0d-4e1f-a2b3-c4d5e6f7a8b9",
                 "contractDeviceId": "cd-91", "replacesId": "cd-77", "noteSha256": "3b1c...9e"}, status=201,
       message="Device replaced", entity="Contract",
       errors=[NOT_ON, state_409("contract", "RETURN_DUE"),
               (409, "VARIANT_MISMATCH", "The replacement is another variant", "Choose a unit of the same variant."),
               (409, "DEVICE_NOT_AVAILABLE", "The replacement is not AVAILABLE", "Choose an available unit."),
               (409, "ORGANIZATION_NOT_ACTIVE", "The organization is suspended", "Replacement is not allowed while suspended."),
               (409, "KEY_VERSION_MISMATCH", "keyVersion is not the organization's current channel key version",
                "The organization's channel key is at version 2; write that version to the device."),
               (409, "LOSS_CASE_REQUIRED", "The old unit is not at the counter and has no open loss case",
                "Open a loss case for the missing unit first, or check it in at the counter.")],
       steps=["Require ACTIVE or ENDING, the organization ACTIVE, the old unit on the contract",
              "Check in the faulty unit when present, or require its open loss case", "Reserve and provision the replacement",
              "Insert contract_devices with replacesId, handedOverAt now", "Render and store the signed note",
              "Move the replacement to RENTED"],
       controller="ContractsController", service="ReplacementService", call="replace(id, deviceId, dto, actor)",
       participants=[["Dev", "DevicesService"], ["Store", "File storage"]],
       seq=["Svc->>Dev: reserveExplicit([replacementId], id, tx)", "Svc->>Dev: recordProvisioning(...)",
            "Svc->>Store: put(note.pdf)", "Svc->>DB: INSERT contract_devices; UPDATE devices RENTED"]),

    ep("POST", "/api/contracts/:id/devices/:deviceId/inspection", "Inspect a returned device", "TrekLink Staff",
       "Inspects a checked-in, reset device of this contract. `PASSED` moves it to `AVAILABLE`; `DAMAGED` "
       "lists damage codes, moves it to `MAINTENANCE` and has billing price each code, held for approval above "
       "the threshold (FR-BILL-04); `FAILED` moves it to `MAINTENANCE`. A device is never `AVAILABLE` without a "
       "logged reset after its last check-in (BR-28). A recovered `LOST` device is inspected through its last "
       "contract the same way; no damage is billed once that contract is `CLOSED`.",
       "UC-44, UC-47, FR-DEV-01, FR-DEV-07, FR-BILL-04, BR-04, BR-24, BR-28",
       path=[C_PATH, D_PATH],
       body=[["result", "`PASSED`, `DAMAGED` or `FAILED`", "enum", "yes", "`DAMAGED`"],
             ["damageCodes", "DamageRate codes; required for DAMAGED", "string[]", "cond.", "`[\"ANTENNA_BROKEN\"]`"],
             ["note", "Free text", "string", "no", "`Antenna snapped at the base`"]],
       sample={"result": "DAMAGED", "damageCodes": ["ANTENNA_BROKEN"], "note": "Antenna snapped at the base"},
       response={"inspection": {"id": "in-1", "result": "DAMAGED", "damageCodes": ["ANTENNA_BROKEN"], "createdAt": NOW},
                 "device": {"id": DEVICE_ID, "assetTag": "TL-0042", "status": "MAINTENANCE"},
                 "damageCharge": {"id": "dc-1", "amountVnd": 300000, "status": "APPROVED"}},
       status=201, message="Inspection recorded", entity="Contract",
       errors=[NOT_ON, (409, "RESET_REQUIRED", "No reset is logged since the last check-in",
                        "Reset this device before inspecting it."),
               (400, "UNKNOWN_DAMAGE_CODE", "A damage code is not in the schedule", "Unknown damage code: X."),
               state_409("device", "RENTED")],
       steps=["Require the device checked in on this contract and RETURNED", "DevicesService.recordInspection(tx)",
              "BillingService.chargeDamage(tx) for DAMAGED unless the contract is CLOSED"],
       controller="ContractsController", service="ReturnService", call="inspect(id, deviceId, dto, actor)",
       participants=[["Dev", "DevicesService"], ["Bill", "BillingService"]],
       seq=["Svc->>DB: BEGIN, SELECT contract_devices", "Svc->>Dev: recordInspection(deviceId, dto, actor, tx)",
            "Svc->>Bill: chargeDamage(contract, inspection, tx)", "Svc->>DB: COMMIT"]),

    ep("POST", "/api/contracts/:id/close", "Close a contract", "TrekLink Staff, TrekLink Admin",
       "Closes a `RETURNED` contract when every device is checked in, or lost with its loss case `SETTLED` "
       "(`lostAt` set), nothing is owed, no damage "
       "charge awaits approval, and no incident on its devices is outside `CLOSED`. Holder labels are erased "
       "(FR-CON-13, FR-CON-14, BR-27, E05-7).",
       "UC-51, FR-CON-13, FR-CON-14, BR-27, BR-33, E05-4, E05-7, MSG29",
       path=[C_PATH], body=[VERSION], sample={"expectedVersion": 9},
       response={**CONTRACT, "status": "CLOSED", "closedAt": NOW}, message="Contract closed", entity="Contract",
       errors=[(409, "BALANCE_OUTSTANDING", "An invoice line is unpaid or a damage charge is pending",
                "This cannot be done while it has open balances."),
               (409, "OPEN_INCIDENTS", "An incident on one of its devices is not CLOSED",
                "This cannot be done while it has open incidents."),
               state_409("contract", "OVERDUE"), STALE],
       steps=["Require RETURNED", "Ask billing for the balance", "Ask incidents for open incidents",
              "Erase holder labels", "Move to CLOSED"],
       controller="ContractsController", service="ContractLifecycleService", call="close(id, dto, actor)",
       participants=[["Bill", "BillingService"], ["Inc", "IncidentsService"]],
       seq=["Svc->>Bill: outstanding(contractId)", "Svc->>Inc: openIncidentCount(deviceIds)",
            "Svc->>DB: UPDATE contract_devices SET holder* = NULL; UPDATE contract; INSERT transition"]),

    ep("GET", "/api/contracts/:id/transitions", "Contract state history",
       "Org Manager: own; TrekLink Staff, TrekLink Admin",
       "Returns the append-only state history with actor (or SYSTEM for scheduler moves) and reason.",
       "UC-55, D-035", path=[C_PATH],
       response=[{"fromStatus": "APPROVED", "toStatus": "ACTIVE", "actor": "Tran Thi B", "reason": "HANDED_OVER",
                  "createdAt": NOW}],
       entity="Contract", steps=["Read contract_transitions"], controller="ContractsController",
       service="ContractsService", call="transitions(id, caller)", seq=["Svc->>DB: SELECT contract_transitions"]),

    # Appended, not placed after 09, so the numbers of 10 to 18 stay as cited elsewhere.
    ep("POST", "/api/contracts/:id/devices/:deviceId/provisioning/undo", "Undo a provisioning record",
       "TrekLink Staff",
       "Undoes the provisioning record of api-design 09 on a unit of an `APPROVED` contract before the "
       "handover, for a record made on the wrong unit at the counter (dry run 2026-10-30, defect 5). The "
       "unit's key version, key organization and provisioning time are cleared, so it shows \"Not "
       "provisioned yet\" and the handover refuses it until it is recorded again. The append-only "
       "`DeviceProvisioning` row stays; an audit entry `contract.provisioningUndone` records the undo. The "
       "contract `version` increases, so a screen that still shows the unit provisioned reloads before it "
       "signs. Undoing the record does not remove a key already written to the device: write the key again "
       "and record it, or swap the unit (api-design 07) (FR-DEV-05, D-021).",
       "UC-14, FR-DEV-05, BR-09, D-021",
       path=[C_PATH, D_PATH], body=[VERSION],
       sample={"expectedVersion": 2},
       response={"deviceId": DEVICE_ID, "assetTag": "TL-0042", "status": "RESERVED", "keyVersion": None,
                 "keyOrganizationId": None, "provisionedAt": None, "contractVersion": 3},
       message="Provisioning undone", entity="Contract",
       # In the order HandoverService.undoProvisioning checks them, after the contract lock.
       errors=[STALE, state_409("contract", "ACTIVE"), NOT_ON,
               (409, "INVALID_STATE_TRANSITION", "The unit's row on the contract is already handed over",
                "This cannot be done while it is RENTED."),
               (409, "INVALID_STATE_TRANSITION", "The unit is not RESERVED",
                "This cannot be done while it is AVAILABLE."),
               (409, "DEVICE_NOT_PROVISIONED", "The unit carries no provisioning for the contract's organization",
                "TL-0042 has no provisioning to undo.")],
       steps=["Lock the contract", "Check the version, then the APPROVED state",
              "Require the device on the contract, RESERVED and not handed over",
              "Require a key version of the contract's organization on the unit",
              "Increase the contract version",
              "DevicesService.clearProvisioning in the same transaction",
              "Record the audit entry after commit"],
       controller="HandoverController", service="HandoverService",
       call="undoProvisioning(id, deviceId, expectedVersion, actor)",
       participants=[["Dev", "DevicesService"], ["Audit", "AuditService"]],
       seq=["Svc->>DB: BEGIN, SELECT contract FOR UPDATE", "Svc->>Dev: provisioning([deviceId], tx)",
            "Svc->>DB: UPDATE rental_contracts SET version = version + 1",
            "Svc->>Dev: clearProvisioning(deviceId, tx)", "Svc->>DB: COMMIT",
            "Svc-)Audit: audit.record contract.provisioningUndone"]),
    # Appended, so the numbers of 01 to 19 stay as cited elsewhere.
    ep("GET", "/api/contracts/:id/close-check", "What still blocks the close of a contract",
       "TrekLink Staff, TrekLink Admin",
       "Answers whether the contract can close now (api-design 17) and lists every blocker with what resolves "
       "it, so the counter and the contract page show the Close action exactly when the close would pass and "
       "otherwise say what still stops it (REQ-EVT-18, D-092 rule 3). Blocker codes: `NOT_RETURNED` (the "
       "contract waits for its term end or for units still out; `waitsFor` is the term end or return due while it is still ahead, null once it has passed), "
       "`DEVICE_OUT` (a unit handed over, not checked in and not settled lost, replaced units included; "
       "`lossCase` is its open loss case, null when none is reported), `BALANCE_OUTSTANDING` (`amountVnd` "
       "unpaid on the contract's invoices), `DAMAGE_PENDING` (a damage charge waiting for an Admin, "
       "`chargeId`, `deviceId`, `amountVnd`), `SERVICE_CREDIT_PENDING` (a service credit still `REQUESTED`, "
       "`serviceCreditId`, `deviceId`, `amountVnd`; billing design §9.3) and `OPEN_INCIDENTS` (incidents outside `CLOSED` on the "
       "contract or its devices, `incidents[]` with `id` and `code`). A `CLOSED` contract answers `canClose` "
       "false with no blocker. Read only: nothing is locked or changed.",
       "UC-51, FR-CON-13, BR-27, E05-4, E05-7, MSG29",
       path=[C_PATH],
       response={"contractId": CONTRACT_ID, "status": "RETURN_DUE", "version": 7, "canClose": False,
                 "blockers": [
                     {"code": "NOT_RETURNED", "message": "The contract becomes Returned once every unit is back or settled lost.",
                      "waitsFor": "2026-11-25T02:00:00Z"},
                     {"code": "DEVICE_OUT", "message": "TL-0042 is not back and not settled lost.",
                      "deviceId": DEVICE_ID, "assetTag": "TL-0042",
                      "lossCase": {"id": "lc-1", "code": "LOSS-0003", "state": "CONFIRMED"}},
                     {"code": "BALANCE_OUTSTANDING", "message": "1,525,000 VND is unpaid.", "amountVnd": 1525000},
                     {"code": "DAMAGE_PENDING", "message": "A damage charge on TL-0043 waits for an Admin.",
                      "chargeId": "dc-1", "deviceId": "5e6f7a8b-9c0d-4e1f-a2b3-c4d5e6f7a8b9", "assetTag": "TL-0043",
                      "amountVnd": 1200000},
                     {"code": "SERVICE_CREDIT_PENDING",
                      "message": "The service credit of 45,000 VND on TL-0042 waits for an Admin's decision.",
                      "serviceCreditId": "sc-1", "deviceId": DEVICE_ID, "assetTag": "TL-0042", "amountVnd": 45000},
                     {"code": "OPEN_INCIDENTS", "message": "This cannot be done while it has open incidents.",
                      "incidents": [{"id": "inc-1", "code": "INC-2026-000002"}]}]},
       entity="Contract",
       steps=["Read the contract", "List rows handed over, not checked in, not lost, with their open loss case",
              "Ask billing for the unpaid amount and the pending damage charges",
              "Ask every CONTRACT_CLOSE_CHECKS provider", "canClose when RETURNED and nothing blocks"],
       controller="ReturnController", service="ReturnService", call="closeCheck(id)",
       participants=[["Dev", "DevicesService"], ["Bill", "BillingService"], ["Inc", "IncidentsCloseCheck"]],
       seq=["Svc->>DB: SELECT contract, contract_devices", "Svc->>Dev: openLossCases(deviceIds, tx)",
            "Svc->>Bill: outstanding(id, tx), pendingDamageOf(id, tx)",
            "Svc->>Inc: blockingReason(id, deviceIds, tx)"]),
    ep("POST", "/api/contracts/:id/devices/:deviceId/channel-key", "Issue the device's channel key",
       "TrekLink Staff",
       "Derives and returns the organization's channel key for Staff to write to a docked unit "
       "(D-082 decision 1). Requires the contract APPROVED, the device reserved to it, and the docked "
       "nodeNum to match the device record; refuses otherwise. The response is never cached, stored or "
       "logged, and every call writes an audit row with the device, organization and key version, never "
       "the key (REQ-UBI-03).",
       "UC-14, FR-DEV-05, BR-09, NFR-SEC-06, NFR-IF-03, D-082",
       path=[C_PATH, D_PATH], body=[["nodeNum", "The nodeNum read from the docked unit", "int", "yes", "`275612`"]],
       sample={"nodeNum": 275612},
       response={"keyHex": "3f9c0e1a2b4d5e6f7081920a1b2c3d4e5f60718293a4b5c6d7e8f9001a2b3c4d",
                 "keyVersion": 1},
       message="Channel key issued", entity="Contract",
       notes="`Cache-Control: no-store` on the response. The key is derived again on every call (HKDF is "
             "deterministic), so the limit is the reserved device on an APPROVED contract and the "
             "`contract.issueChannelKey` permission; the page asks once per docking and every call is audited.",
       errors=[NOT_ON, NODE_MISMATCH, state_409("contract", "REQUESTED")],
       steps=["Require APPROVED and the device reserved to it", "Compare the docked nodeNum with the device record",
              "ChannelKeyService.deriveKey reads the current key version and derives the key with crypto.hkdfSync",
              "Write an audit row without the key", "Respond with Cache-Control: no-store"],
       controller="HandoverController", service="HandoverService", call="issueChannelKey(id, deviceId, dto, actor)",
       participants=[["Key", "ChannelKeyService"], ["Dev", "DevicesService"]],
       seq=["Svc->>Dev: byNodeNum(nodeNum)", "Svc->>Key: deriveKey(orgId)",
            "Key-->>Svc: key, current keyVersion", "Svc->>DB: INSERT audit_log (no key)"]),
    ep("GET", "/api/groups", "Device groups", "Org Manager, Org Operator: own; TrekLink Staff with `organizationId`",
       "The organization's live groups as a tree, each with its count of devices in it now, for the console and the "
       "group filters of the live map and the incident list (UC-67, FR-MON-11, design §11). `maxDepth` is "
       "`rentals.groupMaxDepth`, so the client lists only the parents that may take a child.",
       "UC-67, FR-CON-17, FR-MON-11, BR-46",
       query=[["organizationId", "TrekLink Staff: the organization to read", "uuid", "cond.", f"`{ORG_ID}`"]],
       response={"maxDepth": 1, "groups": [{**GROUP, "children": [
           {**GROUP, "id": "g-2", "name": "Team A", "label": None, "parentId": "g-1", "deviceCount": 2,
            "children": []}]}]},
       entity="Group", steps=["Scope to the caller's organization", "Read live groups and open assignment counts",
                              "Build the tree"],
       controller="GroupsController", service="GroupsService", call="tree(organizationId)",
       seq=["Svc->>DB: SELECT groups WHERE removedAt IS NULL", "Svc->>DB: COUNT group_assignments WHERE endedAt IS NULL"]),

    ep("POST", "/api/groups", "Create a device group", "Org Manager",
       "Creates a group of the caller's organization, top-level or under a parent at most `rentals.groupMaxDepth` "
       "levels down (FR-CON-17, BR-46, E04-8). Audited as `group.created` after commit.",
       "UC-67, FR-CON-17, BR-46, E04-8, MSG40",
       body=[["name", "1 to 80 characters, unique under the same parent", "string", "yes", "`Team A`"],
             ["parentId", "A live group of the organization; null for top level", "uuid", "no", "`g-1`"],
             ["label", "Free text, at most 80 characters", "string", "no", "`tour`"],
             ["startsOn", "Date", "date", "no", "`2026-11-05`"],
             ["endsOn", "Date, not before startsOn", "date", "no", "`2026-11-20`"],
             ["areaNote", "At most 500 characters", "string", "no", "`Bidoup ridge, sector 3`"]],
       sample={"name": "Team A", "parentId": "g-1", "label": "tour"},
       response={**GROUP, "id": "g-2", "name": "Team A", "label": "tour", "parentId": "g-1", "startsOn": None,
                 "endsOn": None, "areaNote": None, "deviceCount": 0},
       status=201, message="Group created", entity="Group",
       errors=[(400, "VALIDATION_FAILED", "Name empty or too long, or endsOn before startsOn",
                "Choose an end after the start."), G_UNIQUE, G_DEPTH,
               (404, "NOT_FOUND", "The parent is not a live group of the organization", "Not found.")],
       steps=["Validate", "Lock the parent and walk its depth", "Insert the group", "Audit after commit"],
       controller="GroupsController", service="GroupsService", call="create(input, actor)",
       seq=["Svc->>DB: SELECT parent FOR UPDATE; walk parentId", "Svc->>DB: INSERT groups"]),

    ep("PATCH", "/api/groups/:id", "Edit a device group", "Org Manager",
       "Changes a live group's name, label, dates, area note or parent with the `version` the Manager saw. Moving a "
       "group under another counts the height of its own subgroups against the depth cap and refuses a cycle. A group "
       "already deeper than a lowered cap can still be edited in place. Audited as `group.updated`.",
       "UC-67, FR-CON-17, BR-46",
       path=[G_PATH],
       body=[["name", "As at creation", "string", "no", "`Team A north`"],
             ["parentId", "As at creation; null moves it to top level", "uuid", "no", "`null`"],
             ["label, startsOn, endsOn, areaNote", "As at creation; null clears", "mixed", "no", "`null`"],
             ["expectedVersion", "The version the Manager saw", "int", "yes", "`1`"]],
       sample={"name": "Team A north", "expectedVersion": 1},
       response={**GROUP, "id": "g-2", "name": "Team A north", "parentId": "g-1", "version": 2},
       message="Group updated", entity="Group",
       errors=[(400, "VALIDATION_FAILED", "As at creation", "Choose an end after the start."), G_UNIQUE, G_DEPTH, STALE,
               (404, "NOT_FOUND", "Not a live group of the organization", "Not found.")],
       steps=["Lock the group", "Check version, name, dates, depth and cycle", "Update and bump version", "Audit"],
       controller="GroupsController", service="GroupsService", call="update(id, input, actor)",
       seq=["Svc->>DB: SELECT group FOR UPDATE", "Svc->>DB: UPDATE groups SET version = version + 1"]),

    ep("DELETE", "/api/groups/:id", "Remove a device group", "Org Manager",
       "Removes a live group and its subgroups (`removedAt`) and ends every open assignment in them with "
       "`GROUP_REMOVED`, so their devices become ungrouped, in one transaction (FR-CON-17). Audited as `group.removed` "
       "with the subgroups and the devices let go.",
       "UC-67, FR-CON-17",
       path=[G_PATH],
       response={"id": "g-1", "removedGroups": 2, "ungroupedDevices": 3},
       message="Group removed", entity="Group",
       errors=[(404, "NOT_FOUND", "Not a live group of the organization", "Not found.")],
       steps=["Lock the group and its subgroups", "End their open assignments", "Set removedAt", "Audit; emit device.groupChanged per device"],
       controller="GroupsController", service="GroupsService", call="remove(id, actor)",
       seq=["Svc->>DB: SELECT groups FOR UPDATE", "Svc->>DB: UPDATE group_assignments SET endedAt, endedReason",
            "Svc->>DB: UPDATE groups SET removedAt"]),

    ep("POST", "/api/groups/:id/devices", "Assign devices to a group", "Org Manager",
       "Moves each named device into the group: its open assignment elsewhere ends `MOVED` and one opens here "
       "against its live contract row (FR-CON-18, BR-46). Every device must be held by the organization now; one "
       "that is not, its own returned device or another organization's, refuses the whole request with the same "
       "answer. A device already in the group is left as it is. Locks: the group row, then the devices in ascending "
       "`deviceId` order (design §11.4), so two overlapping batches cannot deadlock. Audited per device as "
       "`group.deviceAssigned`.",
       "UC-68, FR-CON-18, BR-46, E04-8, MSG17",
       path=[G_PATH],
       body=[["deviceIds", "1 to 100 devices the organization holds", "uuid[]", "yes", f"`[\"{DEVICE_ID}\"]`"]],
       sample={"deviceIds": [DEVICE_ID]},
       response={"groupId": "g-2", "assigned": [DEVICE_ID], "unchanged": []},
       message="Devices assigned", entity="Group assignment",
       errors=[(400, "VALIDATION_FAILED", "No device, or more than 100", "deviceIds must name 1 to 100 devices."),
               (404, "NOT_FOUND", "Not a live group of the organization", "Not found."),
               (409, "DEVICE_NOT_HELD", "A device has no live, handed-over row on a contract of the organization",
                "This device is not held by your organization now.")],
       steps=["Lock the group", "Find each device's live row of the organization",
              "Per-device advisory locks in ascending deviceId",
              "End the open assignment elsewhere, open one here", "Audit; emit device.groupChanged"],
       controller="GroupsController", service="GroupsService", call="assign(id, deviceIds, actor)",
       seq=["Svc->>DB: SELECT group FOR UPDATE", "Svc->>DB: SELECT live contract_devices of the organization",
            "Svc->>DB: pg_advisory_xact_lock per device, sorted by deviceId", "Svc->>DB: UPDATE then INSERT group_assignments"]),

    ep("DELETE", "/api/groups/:id/devices/:deviceId", "Take a device out of its group", "Org Manager",
       "Ends the device's open assignment in this group with `UNASSIGNED`; the device stays rented and ungrouped. "
       "Audited as `group.deviceUnassigned`.",
       "UC-68, FR-CON-18",
       path=[G_PATH, D_PATH],
       response={"groupId": "g-2", "deviceId": DEVICE_ID, "endedAt": NOW},
       message="Device removed from the group", entity="Group assignment",
       errors=[(404, "NOT_FOUND", "Not a live group of the organization, or the device is not in it", "Not found.")],
       steps=["Lock the assignment", "End it", "Audit; emit device.groupChanged"],
       controller="GroupsController", service="GroupsService", call="unassign(id, deviceId, actor)",
       seq=["Svc->>DB: UPDATE group_assignments SET endedAt, endedReason = UNASSIGNED"]),

    ep("POST", "/api/contracts/:id/devices/:deviceId/fault-reports", "Report a device fault", "Org Manager",
       "Records a fault on a `RENTED` device of one of the organization's contracts against its live row, with the "
       "reporter and the UTC time, and emails TrekLink Staff after commit (MSG41, FR-CON-19). The device stays "
       "`RENTED`; the report is resolved when its custody row closes, with `REPLACED`, `CHECKED_IN`, `LOST` or "
       "`RELEASED` (design §11.4). A service credit may name the report as the source of its outage start (billing "
       "task 8.3).",
       "UC-69, FR-CON-19, MSG41",
       path=[C_PATH, D_PATH],
       body=[["description", "What is wrong, 1 to 1000 characters", "string", "yes", "`Battery swollen, will not charge`"]],
       sample={"description": "Battery swollen, will not charge"},
       response={"id": "fr-1", "contractId": CONTRACT_ID, "contractDeviceId": "cd-1", "deviceId": DEVICE_ID,
                 "description": "Battery swollen, will not charge", "reportedBy": {"id": USER_ID},
                 "reportedAt": NOW, "resolvedAt": None, "resolution": None},
       status=201, message="Fault reported. TrekLink will contact you about a replacement.", entity="Fault report",
       errors=[(400, "VALIDATION_FAILED", "Description empty or too long", "description must be 1 to 1000 characters."),
               state_409("device", "RETURNED"),
               (409, "FAULT_ALREADY_REPORTED", "The live row already has an unresolved report",
                "A fault on this device is already reported."),
               (404, "NOT_FOUND", "Not a contract of the organization, or the device is not on it", "Not found.")],
       steps=["Find the live row of the organization's contract", "Require the device RENTED",
              "Insert the report", "Emit device.faultReported; Staff email after commit"],
       controller="FaultReportsController", service="FaultReportsService",
       call="report(contractId, deviceId, description, actor)",
       seq=["Svc->>DB: SELECT contract_devices live row", "Svc->>DB: INSERT device_fault_reports"]),

    ep("GET", "/api/contracts/:id/fault-reports", "Fault reports of a contract", "Org Manager: own; TrekLink Staff",
       "The contract's fault reports, newest first, open and resolved, with the device's asset tag. `resolution` is "
       "null while open, then `REPLACED`, `CHECKED_IN`, `LOST` or `RELEASED`.",
       "UC-69, FR-CON-19",
       path=[C_PATH],
       response=[{"id": "fr-2", "deviceId": DEVICE_ID, "assetTag": "TL-0042",
                  "description": "Battery swollen, will not charge", "reportedAt": NOW, "resolvedAt": None,
                  "resolution": None},
                 {"id": "fr-1", "deviceId": "6a0e4c1f-2b8d-4e37-9a51-7c3f0d2e8b14", "assetTag": "TL-0043",
                  "description": "No GPS fix in the open", "reportedAt": "2026-10-28T02:00:00.000Z",
                  "resolvedAt": "2026-10-29T03:00:00.000Z", "resolution": "REPLACED"}],
       entity="Fault report", steps=["Scope", "Read device_fault_reports of the contract, newest first"],
       controller="FaultReportsController", service="FaultReportsService", call="ofContract(contractId, caller)",
       seq=["Svc->>DB: SELECT device_fault_reports WHERE contractId"]),

    # The quick swap of the device connector (devices design §11.6, leader's brief answer 1, 2026-11-04).
    # Appended so 01 to 29 keep their numbers; api-design 07 keeps the failed-check swap of E01-5.
    ep("POST", "/api/contracts/:id/devices/:deviceId/exchange", "Exchange a reserved device for a docked unit",
       "TrekLink Staff",
       "The quick swap at the counter (devices design §11.6): an `AVAILABLE` unit of the contract's variant, docked "
       "on the Staff computer, takes the place of a reserved unit that has no provisioning record. The replaced unit "
       "goes back to `AVAILABLE` with no maintenance record (unlike api-design 07, which sends a unit that failed its "
       "check to `MAINTENANCE`); the docked unit becomes `RESERVED` to the contract; quantity, plan, price and variant "
       "do not change (REQ-UBI-03). The docked `nodeNum` must equal the replacement's record (devices REQ-EVT-33, "
       "D-080). The counter then provisions the docked unit at once (devices REQ-EVT-34). The contract `version` "
       "increases, so a signing screen opened before the exchange reloads. Open questions Q1 and Q2 of devices "
       "design §11.12 may change this contract. Permission `contract.operate`, the one of api-design 07.",
       "UC-14, UC-20, FR-CON-05, FR-DEV-05, BR-03, BR-09, E01-5, D-080",
       path=[C_PATH, D_PATH],
       body=[["replacementDeviceId", "The docked unit to reserve in its place", "uuid", "yes", "`8f9e0a1b-...`"],
             ["nodeNum", "The nodeNum read from the docked unit; must equal the replacement's record", "int", "yes",
              "`2763113188`"],
             VERSION],
       sample={"replacementDeviceId": "8f9e0a1b-2c3d-4e5f-8a9b-0c1d2e3f4a5b", "nodeNum": 2763113188,
               "expectedVersion": 4},
       response={"released": {"deviceId": DEVICE_ID, "assetTag": "TL-0001", "status": "AVAILABLE"},
                 "reserved": {"deviceId": "8f9e0a1b-2c3d-4e5f-8a9b-0c1d2e3f4a5b", "assetTag": "TL-0051",
                              "nodeNum": 2763113188, "status": "RESERVED"},
                 "contractVersion": 5},
       message="TL-0051 replaces TL-0001 on RC-2026-0042.", entity="Contract",
       errors=[state_409("contract", "ACTIVE"), STALE, NOT_ON,
               (409, "DEVICE_PROVISIONED", "The reserved unit to replace has a provisioning record",
                "TL-0001 is provisioned. Only units not provisioned can be swapped out."),
               NODE_MISMATCH,
               (409, "VARIANT_MISMATCH", "The replacement is another variant than the contract's",
                "TL-0051 is treklink-v2; RC-2026-0042 rents treklink-v3."),
               (409, "DEVICE_NOT_AVAILABLE", "The replacement is not AVAILABLE or is on a live contract row",
                "TL-0051 is not available. It is reserved to RC-2026-0040.")],
       steps=["Lock the contract; require APPROVED and expectedVersion",
              "Require a live row of the device, RESERVED, with no provisioning record",
              "Lock the replacement by id; require the docked nodeNum, the variant and AVAILABLE with no live row",
              "Release the row; DevicesService.release moves the unit RESERVED to AVAILABLE (reason EXCHANGED)",
              "DevicesService.reserve with the replacement id; insert the live row",
              "Increase the contract version; audit contract.deviceExchanged"],
       controller="HandoverController", service="HandoverService", call="exchange(id, deviceId, dto, actor)",
       participants=[["Dev", "DevicesService"]],
       seq=["Svc->>DB: SELECT contract FOR UPDATE", "Svc->>Dev: provisioning([deviceId], tx)",
            "Svc->>Dev: byId(replacementDeviceId) FOR UPDATE",
            "Svc->>Dev: release([deviceId], at, tx, EXCHANGED)",
            "Svc->>Dev: reserve(variant, 1, contractId, tx, [replacementDeviceId])",
            "Svc->>DB: UPDATE contract_devices releasedAt; INSERT contract_devices; UPDATE contract version"]),

]

NOTES = ("Scheduler moves that have no endpoint (rentals design §5): term rollover and day-plan end "
         "(UC-24, FR-CON-08, FR-CON-10), `RETURN_DUE` to `OVERDUE` to `DEFAULTED` (UC-50, FR-CON-12), and the "
         "reservation-expiry reminder (FR-CON-04).")
