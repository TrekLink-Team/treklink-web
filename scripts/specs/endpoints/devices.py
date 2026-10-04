from ._common import (USER_ID, ORG_ID, DEVICE_ID, VARIANT_ID, CONTRACT_ID, NOW, ep, paged, PAGE_QUERY,
                      state_409, STALE)

VARIANT = {"id": VARIANT_ID, "code": "treklink-v3", "name": "TrekLink v3 (GPS, SOS button)", "hasGps": True,
           "hasMotionSensor": False, "mqttCapable": True, "firmwareBaseline": "2.7.19-treklink.3",
           "remainingValueSchedule": [{"fromMonths": 0, "valueVnd": 2500000}, {"fromMonths": 12, "valueVnd": 1800000},
                                      {"fromMonths": 24, "valueVnd": 1200000}],
           "isActive": True, "deviceCount": 18}
DEVICE = {"id": DEVICE_ID, "assetTag": "TL-0042", "nodeNum": 2763113171, "nodeId": "!a4b1c2d3",
          "hardwareVariant": {"id": VARIANT_ID, "code": "treklink-v3"}, "firmwareVersion": "2.7.19-treklink.3",
          "acquiredAt": "2026-06-15T00:00:00Z", "status": "AVAILABLE", "statusChangedAt": NOW,
          "keyVersion": None, "keyOrganizationId": None, "batteryPct": 96, "lastSeenAt": NOW,
          "lastPosition": {"lat": 11.5544, "lon": 108.5381}, "version": 5}
DEV_PATH = ["id", "Device id", "uuid", f"`{DEVICE_ID}`"]
VERSION = ["expectedVersion", "Device version the caller saw", "int", "yes", "`5`"]

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
       "Adds a device model with its sensors, firmware baseline and remaining-value schedule (FR-DEV-04).",
       "UC-13, FR-DEV-04, FR-BILL-05",
       body=[["code", "Stable code", "string", "yes", "`treklink-v4`"], ["name", "Display name", "string", "yes", "`TrekLink v4`"],
             ["hasGps", "Has a GPS receiver", "bool", "yes", "`true`"],
             ["hasMotionSensor", "Has an IMU; adds the motion row to the intake check", "bool", "yes", "`true`"],
             ["mqttCapable", "False for builds with MQTT compiled out (v1)", "bool", "yes", "`true`"],
             ["firmwareBaseline", "Firmware the variant ships with", "string", "yes", "`2.7.19-treklink.4`"],
             ["remainingValueSchedule", "Descending value by age in months; first row fromMonths 0", "json", "yes", "see sample"]],
       sample={k: VARIANT[k] for k in ("hasGps", "hasMotionSensor", "mqttCapable", "remainingValueSchedule")}
              | {"code": "treklink-v4", "name": "TrekLink v4 (GPS, SOS, fall detection)", "firmwareBaseline": "2.7.19-treklink.4"},
       response={**VARIANT, "code": "treklink-v4", "deviceCount": 0}, status=201, message="Saved.",
       errors=[(409, "CONFLICT_UNIQUE", "The code exists", "treklink-v4 is already registered."),
               (400, "SCHEDULE_INVALID", "The schedule does not start at 0 months or is not descending",
                "remainingValueSchedule must start at 0 months and never increase.")],
       steps=["Validate the schedule", "Insert the variant"],
       controller="VariantsController", service="VariantsService", call="create(dto, actor)",
       seq=["Svc->>DB: INSERT hardware_variants"]),

    ep("PATCH", "/api/hardware-variants/:id", "Edit a hardware variant", "TrekLink Admin",
       "Edits a variant's name, baseline, schedule or active flag. Sensor flags are fixed once devices "
       "exist, because past intake checks depend on them.", "UC-13, FR-DEV-04",
       path=[["id", "Variant id", "uuid", f"`{VARIANT_ID}`"]],
       body=[["name", "Name", "string", "no", "`...`"], ["firmwareBaseline", "Baseline", "string", "no", "`...`"],
             ["remainingValueSchedule", "Schedule", "json", "no", "`[...]`"], ["isActive", "Offer in new requests", "bool", "no", "`false`"]],
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
               (409, "MAINTENANCE_OPEN", "A maintenance record is still open", "Close the maintenance record first."),
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
       "Moves an `AVAILABLE` device to `MAINTENANCE` for scheduled service or a reported fault, with a "
       "reason (FR-DEV-08). A reserved device that fails its check at handover is swapped through the "
       "contract instead.", "UC-52, FR-DEV-08",
       path=[DEV_PATH],
       body=[["reason", "`SCHEDULED` or `STAFF_REPORTED`", "enum", "yes", "`SCHEDULED`"],
             ["description", "What is to be done", "string", "yes", "`Battery replacement`"], VERSION],
       sample={"reason": "SCHEDULED", "description": "Battery replacement", "expectedVersion": 5},
       response={"record": {"id": "mr-1", "reason": "SCHEDULED", "status": "OPEN", "openedAt": NOW},
                 "device": {**DEVICE, "status": "MAINTENANCE"}}, status=201, message="Maintenance opened",
       entity="Device", errors=[state_409("device", "RENTED"), STALE],
       steps=["Require AVAILABLE", "Insert the record", "Transition to MAINTENANCE"],
       controller="MaintenanceController", service="DeviceLifecycleService", call="openMaintenance(id, dto, actor)",
       seq=["Svc->>DB: INSERT maintenance_records, device_transitions; UPDATE devices"]),

    ep("PATCH", "/api/devices/:id/maintenance/:recordId", "Close maintenance", "TrekLink Staff",
       "Closes a maintenance record as `COMPLETED` or `UNREPAIRABLE`. A completed device stays "
       "`MAINTENANCE` until it passes an intake check (FR-DEV-08); an unrepairable one waits for an Admin "
       "to retire it.", "UC-52, FR-DEV-08",
       path=[DEV_PATH, ["recordId", "Maintenance record id", "uuid", "`mr-1`"]],
       body=[["status", "`COMPLETED` or `UNREPAIRABLE`", "enum", "yes", "`COMPLETED`"],
             ["resolution", "What was done", "string", "yes", "`Battery replaced`"]],
       sample={"status": "COMPLETED", "resolution": "Battery replaced"},
       response={"id": "mr-1", "status": "COMPLETED", "closedAt": NOW}, message="Maintenance closed",
       entity="Maintenance record", errors=[state_409("maintenance record", "COMPLETED")],
       steps=["Require OPEN", "Close the record"], controller="MaintenanceController",
       service="DeviceLifecycleService", call="closeMaintenance(id, recordId, dto, actor)",
       seq=["Svc->>DB: UPDATE maintenance_records"]),

    ep("POST", "/api/devices/:id/retire", "Retire a device", "TrekLink Admin",
       "Sets `RETIRED` from `MAINTENANCE` or `LOST` without deleting the device or its history; refused "
       "while the device is on a running contract (FR-DEV-09).", "UC-53, FR-DEV-09",
       path=[DEV_PATH], body=[["reason", "Why", "string", "yes", "`Unrepairable water damage`"], VERSION],
       sample={"reason": "Unrepairable water damage", "expectedVersion": 12},
       response={**DEVICE, "status": "RETIRED"}, message="Device retired", entity="Device",
       errors=[state_409("device", "RENTED"), STALE],
       steps=["Require MAINTENANCE or LOST", "Transition to RETIRED, set retiredAt"],
       controller="DevicesController", service="DeviceLifecycleService", call="retire(id, dto, actor)",
       seq=["Svc->>DB: INSERT device_transitions; UPDATE devices"]),

    ep("POST", "/api/devices/:id/recover", "Record a recovered device", "TrekLink Staff",
       "A `LOST` device is found and brought to the counter: it moves to `RETURNED` and then goes through "
       "reset and inspection like any return (D-035). A loss charge already invoiced is not reversed here; "
       "an Admin adjusts it in billing.", "UC-49, D-035",
       path=[DEV_PATH], body=[["note", "Where and how it was recovered", "string", "yes", "`Handed in by a ranger`"], VERSION],
       sample={"note": "Handed in by a ranger at Phan Dung", "expectedVersion": 11},
       response={**DEVICE, "status": "RETURNED"}, message="Device recovered", entity="Device",
       errors=[state_409("device", "AVAILABLE"), STALE],
       steps=["Require LOST", "Transition to RETURNED"], controller="DevicesController",
       service="DeviceLifecycleService", call="recover(id, dto, actor)",
       seq=["Svc->>DB: INSERT device_transitions; UPDATE devices"]),

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
