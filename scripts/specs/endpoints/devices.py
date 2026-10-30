from ._common import (USER_ID, ORG_ID, DEVICE_ID, VARIANT_ID, CONTRACT_ID, NOW, ep, paged, PAGE_QUERY,
                      state_409, STALE)

VARIANT = {"id": VARIANT_ID, "code": "treklink-v3", "name": "TrekLink v3 (GPS, SOS button)", "hasGps": True,
           "hasMotionSensor": False, "mqttCapable": True, "firmwareBaseline": "2.7.19-treklink.3",
           "remainingValueSchedule": [{"fromMonths": 0, "valueVnd": 2500000}, {"fromMonths": 12, "valueVnd": 1800000},
                                      {"fromMonths": 24, "valueVnd": 1200000}],
           "serviceIntervalDays": 180,
           "serviceChecklist": ["Battery health", "Antenna and connector", "Enclosure seal", "Button and buzzer"],
           "isActive": True, "deviceCount": 18}
DEVICE = {"id": DEVICE_ID, "assetTag": "TL-0042", "nodeNum": 2763113171, "nodeId": "!a4b1c2d3",
          "hardwareVariant": {"id": VARIANT_ID, "code": "treklink-v3"}, "firmwareVersion": "2.7.19-treklink.3",
          "acquiredAt": "2026-06-15T00:00:00Z", "status": "AVAILABLE", "statusChangedAt": NOW,
          "keyVersion": None, "keyOrganizationId": None, "keyOrganization": None, "batteryPct": 96,
          "lastSeenAt": NOW, "lastPosition": {"lat": 11.5544, "lon": 108.5381}, "serviceDueAt": "2026-12-12",
          "version": 5}
DEV_PATH = ["id", "Device id", "uuid", f"`{DEVICE_ID}`"]
VERSION = ["expectedVersion", "Device version the caller saw", "int", "yes", "`5`"]

MREC = {"id": "mr-1", "device": {"id": DEVICE_ID, "assetTag": "TL-0042"}, "reason": "SCHEDULED", "status": "OPEN",
        "description": "Six-month service", "expectedAt": "2026-10-20", "workBy": "VENDOR", "vendorName": "Hoang Long Electronics",
        "estimatedCostVnd": 650000, "estimatedById": USER_ID, "approvedCostVnd": None, "decision": None,
        "decisionReason": None, "actualCostVnd": None, "warrantyUntil": None,
        "checklist": ["Battery health", "Antenna and connector", "Enclosure seal", "Button and buzzer"],
        "checklistResults": None, "firmwareVersion": None, "resolution": None, "openedAt": NOW,
        "closedAt": None, "version": 1}
MR_PATH = ["recordId", "Maintenance record id", "uuid", "`mr-1`"]
MR_VERSION = ["expectedVersion", "Record version the caller saw", "int", "yes", "`1`"]

LOSS = {"id": "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d", "code": "LOSS-0003", "device": {"id": DEVICE_ID, "assetTag": "TL-0042"},
        "state": "SEARCHING", "stateFromDevice": "RENTED", "reportedAt": NOW, "description": "Last seen at Phan Dung camp",
        "lastSeenAt": NOW, "lastPosition": {"lat": 11.5544, "lon": 108.5381}, "custody": "RENTER",
        "contractDeviceId": "cd-77", "organization": {"id": ORG_ID, "code": "ORG-0007"}, "keyExposed": True,
        "suspectedTheft": False, "policeReference": None, "searchEndsAt": "2026-10-27T03:15:00.000Z",
        "decision": None, "chargeVnd": None, "version": 1}
LOSS_ID = LOSS["id"]
LC_PATH = ["id", "Loss case id", "uuid", f"`{LOSS_ID}`"]

ENDPOINTS = [
    ep("GET", "/api/hardware-variants", "List hardware variants",
       "TrekLink Staff, TrekLink Admin; Org Manager (active variants, no counts)",
       "Lists the device models. Org Managers see active variants to choose one in a contract request.",
       "UC-13, UC-15, FR-DEV-04",
       query=[["includeInactive", "Admin only", "bool", "no", "`false`"]], response=[VARIANT],
       steps=["Read variants, with device counts for TrekLink staff"],
       controller="VariantsController", service="VariantsService", call="list(query, caller)",
       seq=["Svc->>DB: SELECT hardware_variants"]),

    ep("POST", "/api/hardware-variants", "Create a hardware variant", "TrekLink Admin",
       "Adds a device model with its sensors, firmware baseline, remaining-value schedule and service plan (FR-DEV-04, D-047).",
       "UC-13, FR-DEV-04, FR-BILL-05",
       body=[["code", "Stable code", "string", "yes", "`treklink-v4`"], ["name", "Display name", "string", "yes", "`TrekLink v4`"],
             ["hasGps", "Has a GPS receiver", "bool", "yes", "`true`"],
             ["hasMotionSensor", "Has an IMU; adds the motion row to the intake check", "bool", "yes", "`true`"],
             ["mqttCapable", "False for builds with MQTT compiled out (v1)", "bool", "yes", "`true`"],
             ["firmwareBaseline", "Firmware the variant ships with", "string", "yes", "`2.7.19-treklink.4`"],
             ["remainingValueSchedule", "Descending value by age in months; first row fromMonths 0", "json", "yes", "see sample"],
             ["serviceIntervalDays", "Days between periodic services; null for none (D-047)", "int", "no", "`180`"],
             ["serviceChecklist", "Items checked at each periodic service; required with an interval", "string[]", "no", "see sample"]],
       sample={k: VARIANT[k] for k in ("hasGps", "hasMotionSensor", "mqttCapable", "remainingValueSchedule",
                                       "serviceIntervalDays", "serviceChecklist")}
              | {"code": "treklink-v4", "name": "TrekLink v4 (GPS, SOS, fall detection)", "firmwareBaseline": "2.7.19-treklink.4"},
       response={**VARIANT, "code": "treklink-v4", "deviceCount": 0}, status=201, message="Saved.",
       errors=[(409, "CONFLICT_UNIQUE", "The code exists", "treklink-v4 is already registered."),
               (400, "SCHEDULE_INVALID", "The schedule does not start at 0 months or is not descending",
                "remainingValueSchedule must start at 0 months and never increase."),
               (400, "CHECKLIST_REQUIRED", "An interval is set without a checklist", "Add at least one service checklist item.")],
       steps=["Validate the schedule and the service plan", "Insert the variant"],
       controller="VariantsController", service="VariantsService", call="create(dto, actor)",
       seq=["Svc->>DB: INSERT hardware_variants"]),

    ep("PATCH", "/api/hardware-variants/:id", "Edit a hardware variant", "TrekLink Admin",
       "Edits a variant's name, baseline, schedule, service plan or active flag. Sensor flags are fixed once devices "
       "exist, because past intake checks depend on them. A new interval applies from each device's next completed "
       "service; a new baseline makes the weekly scan flag every device on an older firmware (D-047).", "UC-13, FR-DEV-04, FR-DEV-18",
       path=[["id", "Variant id", "uuid", f"`{VARIANT_ID}`"]],
       body=[["name", "Name", "string", "no", "`...`"], ["firmwareBaseline", "Baseline", "string", "no", "`...`"],
             ["remainingValueSchedule", "Schedule", "json", "no", "`[...]`"],
             ["serviceIntervalDays", "Days between services, or null", "int", "no", "`180`"],
             ["serviceChecklist", "Service checklist items", "string[]", "no", "`[...]`"],
             ["isActive", "Offer in new requests", "bool", "no", "`false`"]],
       sample={"isActive": False}, response={**VARIANT, "isActive": False}, message="Saved.", entity="Hardware variant",
       errors=[(409, "VARIANT_IN_USE", "A sensor flag change was attempted while devices exist",
                "Sensor flags cannot change once devices are registered.")],
       steps=["Validate", "Update"], controller="VariantsController", service="VariantsService",
       call="update(id, dto, actor)", seq=["Svc->>DB: UPDATE hardware_variants"]),

    ep("DELETE", "/api/hardware-variants/:id", "Delete a hardware variant", "TrekLink Admin",
       "Deletes a variant that has no registered device; otherwise refused (FR-DEV-04). Deactivate it instead.",
       "UC-13, FR-DEV-04, MSG29",
       path=[["id", "Variant id", "uuid", f"`{VARIANT_ID}`"]], response=None, message="Deleted", entity="Hardware variant",
       errors=[(409, "VARIANT_IN_USE", "Devices are registered under it", "This cannot be done while it has open devices.")],
       steps=["Count devices", "Delete"], controller="VariantsController", service="VariantsService",
       call="remove(id, actor)", seq=["Svc->>DB: SELECT count(devices)", "Svc->>DB: DELETE hardware_variants"]),

    ep("POST", "/api/devices", "Register a device", "TrekLink Staff",
       "Registers a physical unit with its printed asset tag and its radio `nodeNum`, both unique across "
       "every device ever registered, and creates it `IN_INTAKE` (FR-DEV-02, BR-10).",
       "UC-11, FR-DEV-01, FR-DEV-02, MSG10",
       body=[["assetTag", "Printed label", "string", "yes", "`TL-0042`"],
             ["nodeNum", "Unsigned 32-bit radio id; or nodeId `!a4b1c2d3`", "int", "yes", "`2763113171`"],
             ["hardwareVariantId", "Variant", "uuid", "yes", f"`{VARIANT_ID}`"],
             ["firmwareVersion", "Firmware on the unit", "string", "yes", "`2.7.19-treklink.3`"],
             ["acquiredAt", "Purchase or build date, the age basis for remaining value", "date", "yes", "`2026-06-15`"]],
       sample={"assetTag": "TL-0042", "nodeNum": 2763113171, "hardwareVariantId": VARIANT_ID,
               "firmwareVersion": "2.7.19-treklink.3", "acquiredAt": "2026-06-15"},
       response={**DEVICE, "status": "IN_INTAKE", "batteryPct": None, "lastSeenAt": None, "lastPosition": None, "version": 0},
       status=201, message="Device registered",
       errors=[(409, "CONFLICT_UNIQUE", "The asset tag or nodeNum was ever registered", "TL-0042 is already registered.")],
       steps=["Normalize nodeId to nodeNum", "Insert the device IN_INTAKE", "Write the registration transition"],
       controller="DevicesController", service="DevicesService", call="register(dto, actor)",
       seq=["Svc->>DB: INSERT devices, device_transitions"]),

    ep("GET", "/api/devices", "List devices", "TrekLink Staff, TrekLink Admin",
       "Lists the fleet. Organization members see their rented devices through the live map snapshot and "
       "the contract detail, never through this fleet view (FR-AUTH-11).",
       "UC-38, UC-54, FR-AUTH-11",
       query=[["status", "DeviceStatus, repeatable", "enum", "no", "`AVAILABLE`"],
              ["hardwareVariantId", "Variant", "uuid", "no", f"`{VARIANT_ID}`"],
              ["q", "Asset tag or nodeId contains", "string", "no", "`TL-00`"]] + PAGE_QUERY,
       response=paged(DEVICE, 40), steps=["Read devices"],
       controller="DevicesController", service="DevicesService", call="list(query)",
       seq=["Svc->>DB: SELECT devices"]),

    ep("GET", "/api/devices/:id", "Device detail", "TrekLink Staff, TrekLink Admin",
       "Returns one device with its open maintenance, last intake check and last reset.",
       "UC-11, UC-53, FR-AUTH-11",
       path=[DEV_PATH],
       response={**DEVICE, "openMaintenance": None, "lastIntakeCheck": {"passed": True, "createdAt": NOW},
                 "lastReset": None},
       entity="Device", steps=["Read the device"],
       controller="DevicesController", service="DevicesService", call="get(id, caller)",
       seq=["Svc->>DB: SELECT device"]),

    ep("PATCH", "/api/devices/:id", "Edit device data", "TrekLink Staff",
       "Corrects the firmware version after a reflash. Identity fields never change; state changes go "
       "through their own endpoints (FR-DEV-01).", "UC-11, FR-DEV-01",
       path=[DEV_PATH], body=[["firmwareVersion", "Firmware on the unit", "string", "yes", "`2.7.19-treklink.4`"], VERSION],
       sample={"firmwareVersion": "2.7.19-treklink.4", "expectedVersion": 5},
       response={**DEVICE, "firmwareVersion": "2.7.19-treklink.4", "version": 6}, message="Saved.", entity="Device",
       errors=[STALE], steps=["Compare-and-set", "Emit audit.record device.update"],
       controller="DevicesController", service="DevicesService", call="update(id, dto, actor)",
       seq=["Svc->>DB: UPDATE devices WHERE version"]),

    ep("POST", "/api/devices/:id/intake-checks", "Record an intake check", "TrekLink Staff",
       "Records the GPS fix, radio, battery and, where the variant has one, motion-sensor results. A pass "
       "moves an `IN_INTAKE` or `MAINTENANCE` device (with no open maintenance record) to `AVAILABLE`; a "
       "failure moves it to `MAINTENANCE` with a record opened (FR-DEV-03, FR-DEV-08).",
       "UC-12, FR-DEV-01, FR-DEV-03, FR-DEV-08",
       path=[DEV_PATH],
       body=[["gpsFixOk", "GPS fix obtained", "bool", "yes", "`true`"], ["radioOk", "Heard on the mesh", "bool", "yes", "`true`"],
             ["batteryOk", "Charges and holds", "bool", "yes", "`true`"],
             ["motionOk", "Required when the variant has a motion sensor", "bool", "cond.", "`true`"],
             ["note", "Free text", "string", "no", "`...`"], VERSION],
       sample={"gpsFixOk": True, "radioOk": True, "batteryOk": True, "expectedVersion": 0},
       response={"check": {"id": "ic-1", "passed": True, "createdAt": NOW}, "device": {**DEVICE, "version": 1}},
       status=201, message="Intake check recorded", entity="Device",
       errors=[(400, "MOTION_RESULT_REQUIRED", "The variant has a motion sensor and motionOk is missing",
                "motionOk is required."),
               (409, "MAINTENANCE_OPEN", "The device has an open maintenance record", "Finish the open maintenance record first."),
               state_409("device", "RENTED"), STALE],
       steps=["Require IN_INTAKE or MAINTENANCE", "Insert the check", "Transition to AVAILABLE or MAINTENANCE",
              "Open a maintenance record on failure"],
       controller="DevicesController", service="DeviceLifecycleService", call="recordIntake(id, dto, actor)",
       seq=["Svc->>DB: SELECT device FOR UPDATE", "Svc->>DB: INSERT intake_checks, device_transitions; UPDATE devices"]),

    ep("POST", "/api/devices/:id/reset", "Record the reset on return", "TrekLink Staff",
       "Records the reset of a `RETURNED` device: channel key removed, node database cleared, owner name "
       "cleared. All three must be true. Required before the inspection, which `rentals` records on the "
       "return (FR-DEV-07, BR-28).",
       "UC-44, FR-DEV-07, BR-28",
       path=[DEV_PATH],
       body=[["keyRemoved", "Channel key removed", "bool", "yes", "`true`"],
             ["nodeDbCleared", "Node database cleared", "bool", "yes", "`true`"],
             ["ownerCleared", "Owner name cleared", "bool", "yes", "`true`"]],
       sample={"keyRemoved": True, "nodeDbCleared": True, "ownerCleared": True},
       response={**DEVICE, "status": "RETURNED", "keyVersion": None, "keyOrganizationId": None}, status=201,
       message="Reset recorded", entity="Device",
       errors=[(400, "RESET_INCOMPLETE", "One of the three steps is false", "Complete every reset step first."),
               state_409("device", "RENTED")],
       steps=["Require RETURNED", "Insert device_resets", "Clear keyVersion and keyOrganizationId"],
       controller="DevicesController", service="DeviceLifecycleService", call="reset(id, dto, actor)",
       seq=["Svc->>DB: INSERT device_resets; UPDATE devices"]),

    ep("POST", "/api/devices/:id/maintenance", "Open maintenance", "TrekLink Staff",
       "Moves an `AVAILABLE` device to `MAINTENANCE` for a reported fault, a service or a firmware update, with a "
       "reason and an expected completion date (FR-DEV-08). The weekly scan opens `SCHEDULED` and `FIRMWARE_UPDATE` "
       "records itself (FR-DEV-18). An estimate above `devices.maintenanceApprovalThresholdVnd` puts the record in "
       "`PENDING_APPROVAL` (FR-DEV-20). A reserved device that fails its check at handover is swapped through the "
       "contract instead.", "UC-52, FR-DEV-08, FR-DEV-20, D-047",
       path=[DEV_PATH],
       body=[["reason", "`STAFF_REPORTED`, `SCHEDULED` or `FIRMWARE_UPDATE`", "enum", "yes", "`STAFF_REPORTED`"],
             ["description", "What is to be done", "string", "yes", "`Battery does not hold charge`"],
             ["expectedAt", "Expected completion date", "date", "yes", "`2026-10-20`"],
             ["workBy", "`IN_HOUSE` or `VENDOR`", "enum", "no", "`VENDOR`"],
             ["vendorName", "Required when workBy is VENDOR", "string", "no", "`Hoang Long Electronics`"],
             ["estimatedCostVnd", "Estimated cost; may be set later", "int", "no", "`650000`"], VERSION],
       sample={"reason": "STAFF_REPORTED", "description": "Battery does not hold charge", "expectedAt": "2026-10-20",
               "workBy": "VENDOR", "vendorName": "Hoang Long Electronics", "estimatedCostVnd": 650000, "expectedVersion": 5},
       response={"record": {**MREC, "reason": "STAFF_REPORTED", "description": "Battery does not hold charge"},
                 "device": {**DEVICE, "status": "MAINTENANCE"}}, status=201, message="Maintenance opened",
       entity="Device",
       errors=[state_409("device", "RENTED"), STALE,
               (409, "MAINTENANCE_OPEN", "The device has an open maintenance record", "Finish the open maintenance record first."),
               (400, "VENDOR_REQUIRED", "workBy is VENDOR without a vendor name", "Name the vendor.")],
       steps=["Require AVAILABLE and no open record", "Insert the record, OPEN or PENDING_APPROVAL by the estimate",
              "Transition to MAINTENANCE"],
       controller="MaintenanceController", service="MaintenanceService", call="open(id, dto, actor)",
       seq=["Svc->>DB: INSERT maintenance_records, device_transitions; UPDATE devices"]),

    ep("PATCH", "/api/devices/:id/maintenance/:recordId/estimate", "Record a maintenance estimate", "TrekLink Staff",
       "Sets or revises who does the work and its estimated cost on an `OPEN` record, for example one the weekly "
       "scan opened or one an Admin rejected. Above `devices.maintenanceApprovalThresholdVnd` the record becomes "
       "`PENDING_APPROVAL` (FR-DEV-20, BR-44).", "UC-52, UC-64, FR-DEV-20, BR-44",
       path=[DEV_PATH, MR_PATH],
       body=[["workBy", "`IN_HOUSE` or `VENDOR`", "enum", "yes", "`VENDOR`"],
             ["vendorName", "Required when workBy is VENDOR", "string", "no", "`Hoang Long Electronics`"],
             ["estimatedCostVnd", "Estimated cost", "int", "yes", "`1800000`"], MR_VERSION],
       sample={"workBy": "VENDOR", "vendorName": "Hoang Long Electronics", "estimatedCostVnd": 1800000, "expectedVersion": 1},
       response={**MREC, "status": "PENDING_APPROVAL", "estimatedCostVnd": 1800000, "version": 2},
       message="Estimate recorded", entity="Maintenance record",
       errors=[state_409("maintenance record", "PENDING_APPROVAL"), STALE,
               (400, "VENDOR_REQUIRED", "workBy is VENDOR without a vendor name", "Name the vendor.")],
       steps=["Require OPEN", "Record the estimate and its author",
              "Set PENDING_APPROVAL and notify the Admins when above the threshold"],
       controller="MaintenanceController", service="MaintenanceService", call="estimate(recordId, dto, actor)",
       seq=["Svc->>DB: UPDATE maintenance_records"]),

    ep("POST", "/api/devices/:id/maintenance/:recordId/decision", "Approve or reject a maintenance cost", "TrekLink Admin",
       "Approves an amount or rejects the estimate with a reason. Either way the record returns to `OPEN`: "
       "approved, the work can be completed up to the amount; rejected, Staff re-estimate or close it "
       "`UNREPAIRABLE`. The Admin is never the person who recorded the estimate (FR-DEV-20, BR-44).",
       "UC-64, FR-DEV-20, BR-44",
       path=[DEV_PATH, MR_PATH],
       body=[["decision", "`APPROVED` or `REJECTED`", "enum", "yes", "`APPROVED`"],
             ["approvedCostVnd", "Approved amount, for APPROVED", "int", "no", "`1800000`"],
             ["reason", "Required for REJECTED", "string", "no", "`...`"], MR_VERSION],
       sample={"decision": "APPROVED", "approvedCostVnd": 1800000, "expectedVersion": 2},
       response={**MREC, "status": "OPEN", "estimatedCostVnd": 1800000, "approvedCostVnd": 1800000, "version": 3},
       message="Maintenance cost decided", entity="Maintenance record",
       errors=[(403, "SEPARATION_OF_DUTY", "The caller recorded the estimate", "A different Admin must approve this cost."),
               state_409("maintenance record", "OPEN"), STALE],
       steps=["Require PENDING_APPROVAL and the caller not the estimator", "Record the decision, the amount or the reason",
              "Return the record to OPEN"],
       controller="MaintenanceController", service="MaintenanceService", call="decide(recordId, dto, actor)",
       seq=["Svc->>DB: UPDATE maintenance_records; INSERT audit"]),

    ep("PATCH", "/api/devices/:id/maintenance/:recordId", "Complete or close maintenance", "TrekLink Staff",
       "Completes a record with the work done, the actual cost, any vendor warranty date, a result per checklist "
       "item for `SCHEDULED` and the new firmware version for `FIRMWARE_UPDATE`, or closes it `UNREPAIRABLE` for an "
       "Admin to retire the device. An actual cost above the approved amount, or above the threshold when nothing "
       "was approved, returns the record to `PENDING_APPROVAL` instead. A completed device stays `MAINTENANCE` "
       "until it passes an intake check; a completed `SCHEDULED` record moves `serviceDueAt` forward by the "
       "variant's interval (FR-DEV-08, FR-DEV-17, FR-DEV-21).", "UC-52, FR-DEV-08, FR-DEV-17, FR-DEV-20, FR-DEV-21",
       path=[DEV_PATH, MR_PATH],
       body=[["status", "`COMPLETED` or `UNREPAIRABLE`", "enum", "yes", "`COMPLETED`"],
             ["resolution", "What was done", "string", "yes", "`Battery and seal replaced`"],
             ["actualCostVnd", "Required for COMPLETED", "int", "no", "`620000`"],
             ["warrantyUntil", "Vendor warranty on the work", "date", "no", "`2027-01-20`"],
             ["checklistResults", "One result per checklist item; required for SCHEDULED", "json", "no", "see sample"],
             ["firmwareVersion", "Firmware now on the unit; required for FIRMWARE_UPDATE", "string", "no", "`2.7.19-treklink.4`"],
             MR_VERSION],
       sample={"status": "COMPLETED", "resolution": "Battery and seal replaced", "actualCostVnd": 620000,
               "warrantyUntil": "2027-01-20", "expectedVersion": 3,
               "checklistResults": [{"item": "Battery health", "passed": True, "note": "replaced"},
                                    {"item": "Antenna and connector", "passed": True},
                                    {"item": "Enclosure seal", "passed": True, "note": "replaced"},
                                    {"item": "Button and buzzer", "passed": True}]},
       response={**MREC, "status": "COMPLETED", "actualCostVnd": 620000, "warrantyUntil": "2027-01-20",
                 "closedAt": NOW, "version": 4}, message="Maintenance updated",
       entity="Maintenance record",
       errors=[state_409("maintenance record", "PENDING_APPROVAL"), STALE,
               (400, "CHECKLIST_INCOMPLETE", "A checklist item of a SCHEDULED record has no result", "Record every checklist item."),
               (400, "FIRMWARE_VERSION_REQUIRED", "A FIRMWARE_UPDATE record without the new version", "Enter the firmware version now on the unit.")],
       steps=["Require OPEN", "Validate checklist and firmware for the reason",
              "Above the approved amount: set PENDING_APPROVAL and stop",
              "Close the record; update firmwareVersion; move serviceDueAt for SCHEDULED"],
       controller="MaintenanceController", service="MaintenanceService", call="complete(recordId, dto, actor)",
       seq=["Svc->>DB: UPDATE maintenance_records; UPDATE devices firmwareVersion, serviceDueAt"]),

    ep("GET", "/api/maintenance-records", "List maintenance records", "TrekLink Staff, TrekLink Admin",
       "Lists records by status and reason, for the week's service list (FR-DEV-18) and the Admins' approval queue "
       "(FR-DEV-20). `dueBefore` keeps the records whose expected completion date is on or before it; it "
       "lists records only, so the devices due for service that are still `RESERVED` or `RENTED` come from "
       "devices api-design 06. The page also carries `approvalThresholdVnd`, the parameter "
       "`devices.maintenanceApprovalThresholdVnd` read at request time, for the hint beside the estimate "
       "(FR-DEV-20, D-015).",
       "UC-52, UC-64, UC-65, FR-DEV-18, FR-DEV-20",
       query=[["status", "OPEN, PENDING_APPROVAL, COMPLETED or UNREPAIRABLE, repeatable", "enum", "no", "`PENDING_APPROVAL`"],
              ["reason", "Reason, repeatable", "enum", "no", "`SCHEDULED`"],
              ["dueBefore", "Records expected to complete on or before this date", "date", "no", "`2026-10-26`"]] + PAGE_QUERY,
       response={**paged(MREC, 6), "approvalThresholdVnd": 1000000},
       steps=["Read records, on expectedAt when dueBefore is given",
              "Read devices.maintenanceApprovalThresholdVnd"],
       controller="MaintenanceController", service="MaintenanceService", call="page(filter) and approvalThresholdVnd()",
       seq=["Svc->>DB: SELECT maintenance_records, parameters"]),

    ep("POST", "/api/devices/:id/retire", "Retire a device", "TrekLink Admin",
       "Sets `RETIRED` from `MAINTENANCE` without deleting the device or its history; refused while the "
       "device is on a running contract (FR-DEV-09). A lost device is retired by settling its loss case "
       "(FR-DEV-15). An open maintenance record is closed first, as `UNREPAIRABLE` when the unit cannot be "
       "repaired.", "UC-53, FR-DEV-09",
       path=[DEV_PATH], body=[["reason", "Why", "string", "yes", "`Unrepairable water damage`"], VERSION],
       sample={"reason": "Unrepairable water damage", "expectedVersion": 12},
       response={**DEVICE, "status": "RETIRED"}, message="Device retired", entity="Device",
       errors=[state_409("device", "RENTED"),
               (409, "MAINTENANCE_OPEN", "The device has an open maintenance record", "Finish the open maintenance record first."),
               STALE],
       steps=["Require MAINTENANCE", "Require no open maintenance record",
              "Transition to RETIRED with reason RETIRED and the request's reason, trimmed, in note; set retiredAt"],
       controller="DevicesController", service="DeviceLifecycleService", call="retire(id, dto, actor)",
       seq=["Svc->>DB: INSERT device_transitions; UPDATE devices"]),

    ep("POST", "/api/devices/:id/loss-cases", "Report a lost device",
       "Org Manager: a device rented by the organization; TrekLink Staff: any device in service",
       "Reports a device in service as lost: the device moves to `LOST` from whichever of the six working "
       "states it was in, and one loss case opens in `REPORTED` with the device's last seen time and position "
       "from telemetry. The contract keeps running. TrekLink Staff are notified (FR-DEV-12, D-045).",
       "UC-49, FR-DEV-12, BR-37, E05-8, E05-9",
       path=[DEV_PATH], body=[["description", "Where and when it was last seen, and what happened", "string", "yes", "`Last seen at Phan Dung camp`"]],
       sample={"description": "Last seen at Phan Dung camp on 2026-10-19 evening"},
       response={**LOSS, "state": "REPORTED", "custody": None, "keyExposed": False, "searchEndsAt": None}, status=201,
       message="Loss reported. TrekLink will contact you.", entity="Device",
       errors=[(409, "LOSS_CASE_OPEN", "The device already has an open loss case", "This device is already reported lost."),
               state_409("device", "RETIRED")],
       steps=["Require the device in service, and rented by the caller's organization for an Org Manager",
              "Move the device to LOST", "Insert loss_cases REPORTED with the last seen time and position",
              "Notify TrekLink Staff"],
       controller="LossCasesController", service="LossCaseService", call="report(deviceId, dto, caller)",
       seq=["Svc->>DB: UPDATE devices LOST; INSERT loss_cases REPORTED", "Svc-)Svc: notify TrekLink Staff"]),

    ep("GET", "/api/loss-cases", "List loss cases", "TrekLink Staff, TrekLink Admin; Org Manager: own organization",
       "Lists loss cases by state; an Org Manager sees the cases of its organization's rented devices only.",
       "UC-49, UC-60", query=PAGE_QUERY + [["state", "Filter by state", "string", "no", "`SEARCHING`"]],
       response=paged(LOSS), steps=["Read loss_cases scoped to the caller"],
       controller="LossCasesController", service="LossCaseService", call="list(query, caller)",
       seq=["Svc->>DB: SELECT loss_cases"]),

    ep("POST", "/api/loss-cases/:id/triage", "Triage a loss case", "TrekLink Staff",
       "Decides custody from the custody interval that contains the last seen time (D-040): the renter's, or "
       "TrekLink's when none does. For renter custody the organization's channel key is marked exposed and its "
       "Manager notified. A suspected theft or fraud opens or links a compliance case. The case moves to "
       "`SEARCHING` and the search window `devices.lossSearchDays` starts (FR-DEV-13).",
       "UC-60, FR-DEV-13, D-045, D-046",
       path=[LC_PATH], body=[["suspectedTheft", "Signs of theft or fraud", "bool", "yes", "`false`"],
                             ["policeReference", "Police report reference, if one exists", "string", "no", "`CA-PD-2026-118`"],
                             ["expectedVersion", "Case version the caller saw", "int", "yes", "`0`"]],
       sample={"suspectedTheft": False, "policeReference": None, "expectedVersion": 0},
       response=LOSS, message="Loss case triaged", entity="Loss case",
       errors=[state_409("loss case", "SETTLED"), STALE],
       steps=["Require REPORTED", "rentals.custodyAt(deviceId, lastSeenAt)", "Set custody and contractDeviceId",
              "Renter custody: organizations.markKeyExposed(orgId)", "Suspected theft: organizations.openOrLinkComplianceCase",
              "Move to SEARCHING, set searchEndsAt"],
       controller="LossCasesController", service="LossCaseService", call="triage(id, dto, actor)",
       participants=[["Rt", "RentalsService"], ["Org", "OrganizationsService"]],
       seq=["Svc->>Rt: custodyAt(deviceId, lastSeenAt)", "Svc->>Org: markKeyExposed(orgId)", "Svc->>DB: UPDATE loss_cases SEARCHING"]),

    ep("POST", "/api/loss-cases/:id/recover", "Record a recovered device", "TrekLink Staff",
       "The lost device is back at the counter: the case moves to `RECOVERED` and the device to `RETURNED`, "
       "to be reset and inspected like any return (FR-DEV-14, BR-38). After settlement the charge stands "
       "unless an Admin records an adjustment in billing (E05-10).", "UC-60, FR-DEV-14, BR-38, E05-10",
       path=[LC_PATH], body=[["note", "Where and how it was recovered", "string", "yes", "`Handed in by a ranger`"],
                             ["expectedVersion", "Case version the caller saw", "int", "yes", "`1`"]],
       sample={"note": "Handed in by a ranger at Phan Dung", "expectedVersion": 1},
       response={**LOSS, "state": "RECOVERED"}, message="Device recovered", entity="Loss case",
       errors=[state_409("loss case", "RECOVERED"), STALE],
       steps=["Require REPORTED, SEARCHING or SETTLED", "Move the case to RECOVERED (a settled case keeps SETTLED)",
              "Move the device to RETURNED"],
       controller="LossCasesController", service="LossCaseService", call="recover(id, dto, actor)",
       seq=["Svc->>DB: UPDATE loss_cases; UPDATE devices RETURNED"]),

    ep("POST", "/api/loss-cases/:id/confirm", "Confirm a loss", "TrekLink Staff",
       "Confirms the loss before the search window ends; the `devices.lossSearch` job does the same when "
       "it ends. For renter custody billing charges the device's remaining value to the contract; TrekLink "
       "custody is written off (FR-DEV-15, FR-BILL-05).", "UC-60, FR-DEV-15, FR-BILL-05, BR-25",
       path=[LC_PATH], body=[["expectedVersion", "Case version the caller saw", "int", "yes", "`1`"]],
       sample={"expectedVersion": 1}, response={**LOSS, "state": "CONFIRMED", "chargeVnd": 1800000},
       message="Loss confirmed", entity="Loss case", errors=[state_409("loss case", "REPORTED"), STALE],
       steps=["Require SEARCHING", "Move to CONFIRMED", "Renter custody: billing.chargeLoss(contract, device, tx)"],
       controller="LossCasesController", service="LossCaseService", call="confirm(id, dto, actor)",
       participants=[["Bill", "ChargesService"]],
       seq=["Svc->>Bill: chargeLoss(contract, device, lostAt, tx)", "Svc->>DB: UPDATE loss_cases CONFIRMED"]),

    ep("POST", "/api/loss-cases/:id/decision", "Settle a loss case", "TrekLink Admin",
       "Settles a confirmed case: keep the charge, reduce or waive it with a reason, or record a TrekLink write-"
       "off. The Admin is never the Staff member who triaged the case (FR-BILL-11, BR-39). The device moves to "
       "`RETIRED`.", "UC-60, FR-BILL-11, FR-DEV-15, BR-39",
       path=[LC_PATH], body=[["decision", "CHARGED, REDUCED, WAIVED or WRITTEN_OFF", "string", "yes", "`REDUCED`"],
                             ["chargeVnd", "Final charge, for REDUCED", "int", "no", "`900000`"],
                             ["reason", "Why; required unless CHARGED", "string", "no", "`Renter filed a police report promptly`"],
                             ["expectedVersion", "Case version the caller saw", "int", "yes", "`2`"]],
       sample={"decision": "REDUCED", "chargeVnd": 900000, "reason": "Renter filed a police report promptly", "expectedVersion": 2},
       response={**LOSS, "state": "SETTLED", "decision": "REDUCED", "chargeVnd": 900000}, message="Loss case settled",
       entity="Loss case",
       errors=[(403, "SEPARATION_OF_DUTY", "The caller triaged the case", "A different Admin must settle this case."),
               state_409("loss case", "SEARCHING"), STALE],
       steps=["Require CONFIRMED and the caller not the triager", "Adjust the loss line for REDUCED or WAIVED",
              "Move the case to SETTLED and the device to RETIRED"],
       controller="LossCasesController", service="LossCaseService", call="decide(id, dto, actor)",
       participants=[["Bill", "ChargesService"]],
       seq=["Svc->>Bill: adjustLoss(caseId, decision, chargeVnd, tx)", "Svc->>DB: UPDATE loss_cases SETTLED; UPDATE devices RETIRED"]),

    ep("POST", "/api/devices/:id/dispose", "Dispose of a retired device", "TrekLink Admin",
       "Records the verified wipe of a `RETIRED` device (channel key, node database, owner name) and moves it to "
       "`DISPOSED`. The device and its history are kept (FR-DEV-16, BR-42).", "UC-62, FR-DEV-16, BR-42",
       path=[DEV_PATH], body=[["keyRemoved", "Channel key removed", "bool", "yes", "`true`"],
                              ["nodeDbCleared", "Node database cleared", "bool", "yes", "`true`"],
                              ["ownerCleared", "Owner name cleared", "bool", "yes", "`true`"],
                              ["method", "How it leaves the fleet", "string", "yes", "`Recycled through a licensed handler`"], VERSION],
       sample={"keyRemoved": True, "nodeDbCleared": True, "ownerCleared": True, "method": "Recycled through a licensed handler",
               "expectedVersion": 14},
       response={**DEVICE, "status": "DISPOSED"}, status=201, message="Device disposed", entity="Device",
       errors=[(400, "WIPE_INCOMPLETE", "One of the three wipe steps is false", "Complete every wipe step first."),
               state_409("device", "MAINTENANCE"), STALE],
       steps=["Require RETIRED", "Insert device_disposals", "Transition to DISPOSED"],
       controller="DevicesController", service="DeviceLifecycleService", call="dispose(id, dto, actor)",
       seq=["Svc->>DB: INSERT device_disposals; UPDATE devices DISPOSED"]),

    ep("GET", "/api/devices/availability", "Availability by variant",
       "TrekLink Staff, TrekLink Admin; Org Manager (counts only)",
       "Counts `AVAILABLE` devices per variant, so a Manager sees whether a request can be met and Staff "
       "verify availability before approval (UC-16). Advisory: the count is enforced only at approval.",
       "UC-15, UC-16, FR-CON-03, MSG11",
       query=[["hardwareVariantId", "Variant", "uuid", "no", f"`{VARIANT_ID}`"]],
       response=[{"hardwareVariantId": VARIANT_ID, "code": "treklink-v3", "available": 14}],
       steps=["Count AVAILABLE per variant"], controller="DevicesController", service="DevicesService",
       call="availability(query)", seq=["Svc->>DB: SELECT variant, count(*) WHERE status = AVAILABLE GROUP BY"]),

    ep("POST", "/api/stock-takes", "Run a stock-take", "TrekLink Staff, TrekLink Admin",
       "Compares scanned asset tags with the fleet: in-stock units confirmed by scan, rented units "
       "confirmed by a packet within `devices.stockTakeSeenHours`, and every unit confirmed by neither "
       "(FR-DEV-10). The run and its result are stored.", "UC-54, FR-DEV-10",
       body=[["scannedTags", "Asset tags scanned on the shelf", "string[]", "yes", "`[\"TL-0001\", \"TL-0002\"]`"]],
       sample={"scannedTags": ["TL-0001", "TL-0002", "TL-0007"]},
       response={"id": "st-1", "inStockConfirmed": 12, "rentedSeen": 20,
                 "unconfirmed": [{"assetTag": "TL-0031", "status": "AVAILABLE"}, {"assetTag": "TL-0040", "status": "RENTED",
                                                                                  "lastSeenAt": "2026-10-17T08:00:00Z"}],
                 "unknownTags": ["TL-9999"]}, status=201, message="Stock-take recorded",
       steps=["Load non-retired devices", "Classify by status, scan and last seen", "Store the run"],
       controller="StockTakesController", service="StockTakeService", call="run(dto, actor)",
       seq=["Svc->>DB: SELECT devices WHERE status <> RETIRED", "Svc->>DB: INSERT stock_takes"]),

    ep("GET", "/api/stock-takes", "List stock-takes", "TrekLink Staff, TrekLink Admin",
       "Lists past stock-take runs with their result summary.", "UC-54, FR-DEV-10", query=PAGE_QUERY,
       response=paged({"id": "st-1", "takenBy": "Tran Thi B", "createdAt": NOW, "unconfirmedCount": 2}),
       steps=["Read stock_takes"], controller="StockTakesController", service="StockTakeService",
       call="list(query)", seq=["Svc->>DB: SELECT stock_takes"]),
]

NOTES = ("Route order: `GET /api/devices/availability` is declared before `GET /api/devices/:id` in "
         "`DevicesController`, so the literal segment is never read as an id.")
