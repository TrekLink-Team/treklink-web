"""Single source for business parameters, roles and permissions (D-015, FR-AUTH-06, FR-CFG-01).

build_seed.py turns this into the seed migration, specs/platform/configuration-matrix.md and
specs/auth/permission-matrix.md. Module specs link to those pages instead of copying values.
"""

# key, default, type, bounds, unit, description, requirement
# The basemaps of the live map (D-072). Every entry is keyless; maxNativeZoom is the deepest zoom the
# provider draws over the default viewport (checked 2026-10-27), and Leaflet enlarges those tiles up to
# maxZoom instead of requesting tiles that do not exist. localOnly marks a provider that serves keyless
# tiles to a loopback host only: Stadia answered 401 on the Vercel production (2026-11-01), so the client
# hides that entry on any other host.
BASEMAPS = [
    {"id": "opentopomap", "name": "Topographic (OpenTopoMap)",
     "tileUrl": "https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png",
     "attribution": "Map data © OpenStreetMap contributors, SRTM; style © OpenTopoMap (CC-BY-SA)",
     "maxZoom": 18, "maxNativeZoom": 17},
    {"id": "stadia-terrain", "name": "Terrain (Stadia)",
     "tileUrl": "https://tiles.stadiamaps.com/tiles/stamen_terrain/{z}/{x}/{y}.png",
     "attribution": "© Stadia Maps © Stamen Design © OpenMapTiles © OpenStreetMap contributors",
     "maxZoom": 18, "maxNativeZoom": 18, "localOnly": True},
    {"id": "esri-topo", "name": "Topographic (Esri)",
     "tileUrl": "https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}",
     "attribution": "Tiles © Esri and the GIS user community",
     "maxZoom": 18, "maxNativeZoom": 16},
    # The OpenStreetMap standard tiles were dropped on 2026-10-30 (dry run defect 11): over the Paracel and
    # Spratly islands they print PRC district names beside the Vietnamese sovereignty overlay (D-031).
]

PARAMETERS = {
    "auth": [
        ("auth.passwordMinLength", 8, "INT", {"min": 8, "max": 64}, "characters", "Minimum password length", "FR-AUTH-02"),
        ("auth.loginMaxFailures", 5, "INT", {"min": 3, "max": 20}, "attempts", "Failed sign-ins inside the window that lock the account", "FR-AUTH-02"),
        ("auth.loginFailureWindowMinutes", 15, "INT", {"min": 1, "max": 120}, "minutes", "Window in which failed sign-ins are counted", "FR-AUTH-02"),
        ("auth.lockoutMinutes", 15, "INT", {"min": 1, "max": 1440}, "minutes", "How long a locked account stays locked", "FR-AUTH-02"),
        ("auth.resetCodeTtlMinutes", 10, "INT", {"min": 5, "max": 60}, "minutes", "Lifetime of a password reset code", "FR-AUTH-05"),
        ("auth.invitationTtlHours", 72, "INT", {"min": 1, "max": 336}, "hours", "Lifetime of an invitation (set-password) code", "FR-ORG-04"),
        ("auth.codeMaxAttempts", 5, "INT", {"min": 1, "max": 10}, "attempts", "Wrong entries before a code is spent", "FR-AUTH-05"),
        ("auth.codeResendCooldownSeconds", 60, "DURATION_SECONDS", {"min": 10, "max": 600}, "seconds", "Minimum wait before another code is sent", "FR-AUTH-05"),
    ],
    "organizations": [
        ("organizations.maxApiKeys", 5, "INT", {"min": 1, "max": 50}, "keys", "Active API keys per organization", "FR-ORG-06"),
        ("organizations.maxFieldStations", 5, "INT", {"min": 1, "max": 50}, "credentials", "Active Field Station credentials per organization", "FR-EVT-14"),
        ("organizations.rosterMaxRangeDays", 31, "INT", {"min": 1, "max": 92}, "days", "Longest range one roster query returns", "FR-ORG-05"),
    ],
    "devices": [
        ("devices.handoverMinBatteryPct", 50, "PERCENT", {"min": 0, "max": 100}, "percent", "Below this battery the handover needs an explicit acknowledgement (MSG19)", "FR-CON-05"),
        ("devices.stockTakeSeenHours", 24, "INT", {"min": 1, "max": 168}, "hours", "A rented device heard within this window counts as confirmed in a stock-take", "FR-DEV-10"),
        ("devices.lossSearchDays", 7, "INT", {"min": 1, "max": 60}, "days", "A triaged loss case is confirmed when this long passes without recovery", "FR-DEV-15, D-045"),
        ("devices.maintenanceLeadDays", 5, "INT", {"min": 0, "max": 30}, "days", "The weekly scan opens a service this long before it falls due, on top of the week to the next run", "FR-DEV-18, D-047"),
        ("devices.maintenanceApprovalThresholdVnd", 1000000, "INT", {"min": 0, "max": 50000000}, "VND", "A maintenance estimate or actual cost above this needs an Admin's approval", "FR-DEV-20, BR-44"),
        ("devices.serviceScanHourLocal", 1, "INT", {"min": 0, "max": 23}, "hour (UTC+7)", "Hour on Monday at which the weekly service scan runs", "FR-DEV-18"),
    ],
    "rentals": [
        ("rentals.minOrderQuantity", 5, "INT", {"min": 1, "max": 100}, "devices", "Minimum order quantity per contract", "FR-CON-01, BR-02"),
        ("rentals.dayPlanLengths", [3, 4, 7], "JSON", None, "days", "Day-plan lengths offered", "FR-CON-01, BR-07"),
        ("rentals.reservationExpiryHours", 48, "INT", {"min": 1, "max": 336}, "hours", "Approved but not handed over after this long: Staff and Manager are reminded", "FR-CON-04"),
        ("rentals.returnGraceHours", 24, "INT", {"min": 0, "max": 168}, "hours", "Grace after the return due time before OVERDUE and late fees", "FR-CON-12, FR-BILL-03"),
        ("rentals.defaultAfterDays", 7, "INT", {"min": 1, "max": 60}, "days", "OVERDUE this long becomes DEFAULTED", "FR-CON-12, BR-26"),
        ("rentals.termRolloverHourLocal", 9, "INT", {"min": 0, "max": 23}, "hour (UTC+7)", "Hour at which daily term and day-plan jobs run", "FR-CON-08"),
    ],
    "billing": [
        ("billing.holdingFeeRatio", 0.5, "DECIMAL", {"min": 0.1, "max": 1}, "ratio", "Share of a monthly term fee due at the term start", "FR-BILL-01, BR-06"),
        ("billing.dayPremium", 1.5, "DECIMAL", {"min": 1, "max": 5}, "ratio", "Day-plan premium over the monthly rate per day", "FR-BILL-02, BR-07"),
        ("billing.lateFeePerDevicePerDayVnd", 50000, "INT", {"min": 0, "max": 10000000}, "VND", "Late fee per device per started day after the grace", "FR-BILL-03, BR-23"),
        ("billing.damageApprovalThresholdVnd", 500000, "INT", {"min": 0, "max": 100000000}, "VND", "Damage charges above this need an Admin other than the inspector", "FR-BILL-04, BR-24"),
        ("billing.sepayPaymentTtlMinutes", 30, "INT", {"min": 5, "max": 1440}, "minutes", "A SePay payment request expires after this long", "FR-BILL-07"),
        ("billing.sepayBankAccount", "SANDBOX-0001", "JSON", None, None, "Receiving account shown in the VietQR (sandbox)", "FR-BILL-07, BR-34"),
    ],
    "gateway-sync": [
        ("gatewaySync.retroTagGraceSeconds", 60, "DURATION_SECONDS", {"min": 0, "max": 600}, "seconds", "Positions this long before an SOS text are tagged into its episode", "FR-INC-01"),
        ("gatewaySync.lateUploadGraceHours", 168, "INT", {"min": 1, "max": 720}, "hours", "A Field Station may still upload a device's events this long after its organization returned it", "FR-EVT-14, D-040"),
        ("gatewaySync.attributionMarginSeconds", 300, "DURATION_SECONDS", {"min": 0, "max": 3600}, "seconds", "An occurrence time this close to a handover or check-in is `UNATTRIBUTED`", "FR-EVT-17, D-040"),
        ("gatewaySync.deviceTimeMaxAheadSeconds", 60, "DURATION_SECONDS", {"min": 0, "max": 3600}, "seconds", "A device `rx_time` later than receipt by more than this is implausible", "FR-EVT-15, D-040"),
    ],
    "incidents": [
        ("incidents.correlationWindowSeconds", 300, "DURATION_SECONDS", {"min": 30, "max": 3600}, "seconds", "An SOS within this time of the episode's last event joins it", "FR-INC-01, BR-13"),
        ("incidents.cadenceCount", 6, "INT", {"min": 2, "max": 50}, "positions", "N: positions inside W that raise a suspected incident", "FR-INC-02, BR-14"),
        ("incidents.cadenceWindowSeconds", 60, "DURATION_SECONDS", {"min": 10, "max": 600}, "seconds", "W: window for the cadence count", "FR-INC-02, BR-14"),
        ("incidents.primaryAckTimeoutSeconds", 120, "DURATION_SECONDS", {"min": 30, "max": 900}, "seconds", "Primary tier acknowledge timeout", "FR-INC-05, BR-16"),
        ("incidents.backupAckTimeoutSeconds", 120, "DURATION_SECONDS", {"min": 30, "max": 900}, "seconds", "Backup tier acknowledge timeout", "FR-INC-05, BR-16"),
        ("incidents.managerAckTimeoutSeconds", 180, "DURATION_SECONDS", {"min": 30, "max": 1800}, "seconds", "Manager tier acknowledge timeout, then ESCALATED", "FR-INC-05, BR-16"),
        ("incidents.staleLimitMinutes", 30, "INT", {"min": 5, "max": 240}, "minutes", "Longest gap between status updates of an owned incident", "FR-INC-07"),
        ("incidents.reopenWindowMinutes", 60, "INT", {"min": 5, "max": 1440}, "minutes", "A new SOS inside this window after RESOLVED or FALSE_ALARM reopens", "FR-INC-11"),
        ("incidents.alertMaxAttempts", 5, "INT", {"min": 1, "max": 20}, "attempts", "Delivery attempts per alert before FAILED", "FR-INC-12"),
        ("incidents.alertRetryBaseSeconds", 5, "DURATION_SECONDS", {"min": 1, "max": 300}, "seconds", "Base of the exponential retry backoff", "FR-INC-12"),
    ],
    "monitoring": [
        ("monitoring.deviceStaleSeconds", 300, "DURATION_SECONDS", {"min": 30, "max": 7200}, "seconds", "A device silent this long is shown stale", "FR-MON-03, BR-21"),
        ("monitoring.fieldStationStaleSeconds", 180, "DURATION_SECONDS", {"min": 30, "max": 7200}, "seconds", "A Field Station silent this long is shown stale", "FR-MON-03"),
        ("monitoring.staleSweepSeconds", 15, "DURATION_SECONDS", {"min": 5, "max": 300}, "seconds", "Cadence of the staleness sweep", "FR-MON-03"),
        ("monitoring.maxPlausibleSpeedKmh", 30, "INT", {"min": 5, "max": 300}, "km/h", "Positions implying a faster move are not plotted", "FR-MON-04, BR-22"),
        ("monitoring.positionBounds", {"minLat": 8.0, "maxLat": 23.5, "minLon": 102.0, "maxLon": 110.0}, "JSON", None, "degrees", "Positions outside this box are rejected", "FR-MON-04, BR-22"),
        ("monitoring.positionEmitMinIntervalMs", 1000, "INT", {"min": 0, "max": 60000}, "milliseconds", "Minimum interval between position pushes per device", "FR-MON-02"),
        ("monitoring.streamRetentionHours", 72, "INT", {"min": 1, "max": 720}, "hours", "Stream entries older than this are pruned; older cursors get 410", "FR-MON-05"),
        ("monitoring.apiRateLimitPerMinute", 120, "INT", {"min": 10, "max": 6000}, "requests", "Organization API requests per key per minute", "FR-MON-06"),
        ("monitoring.mapProvider", "esri-topo", "JSON", None, None, "Default basemap, an id in monitoring.mapBasemaps (D-031, D-072)", "FR-CFG-03"),
        ("monitoring.mapBasemaps", BASEMAPS, "JSON", None, None, "Basemaps the user can switch between: id, name, tile URL, attribution, maxZoom, maxNativeZoom, optional localOnly (D-072)", "FR-CFG-03, NFR-LEG-04"),
        ("monitoring.mapDefaultViewport", {"lat": 11.56, "lon": 108.54, "zoom": 12}, "JSON", None, None, "Initial map view", "FR-CFG-03"),
        ("monitoring.historyMaxRangeDays", 7, "INT", {"min": 1, "max": 31}, "days", "Longest period one telemetry history request may cover", "FR-MON-07"),
        ("monitoring.reportMaxRangeDays", 366, "INT", {"min": 1, "max": 732}, "days", "Longest period one report may cover (D-057)", "FR-BILL-10"),
    ],
}

ROLES = [  # key, name, account type
    ("ADMIN", "TrekLink Admin", "TREKLINK"),
    ("STAFF", "TrekLink Staff", "TREKLINK"),
    ("ORG_MANAGER", "Org Manager", "ORGANIZATION"),
    ("ORG_OPERATOR", "Org Operator", "ORGANIZATION"),
]

OWN = {"organizationId": "${user.organizationId}"}
OWN_ORG = {"id": "${user.organizationId}"}

# key, action, subject, conditions, roles. FR-AUTH-10: ADMIN gets every STAFF row and ORG_MANAGER
# every ORG_OPERATOR row; the generator adds them, so a row lists only the lowest role.
# D-057: every permission belongs to one account type. `.own` marks an organization permission bound to
# the caller's organization; `.org` marks an organization permission on data no tenant owns (variants,
# availability, quotes), the counterpart of the TrekLink key without the suffix.
PERMISSIONS = [
    # platform
    ("parameter.manage", "manage", "Parameter", None, ["ADMIN"]),
    ("auditLog.read", "read", "AuditLog", None, ["ADMIN"]),
    ("systemHealth.read", "read", "SystemHealth", None, ["ADMIN"]),
    # auth
    ("account.manage", "manage", "Account", None, ["ADMIN"]),
    ("role.manage", "manage", "Role", None, ["ADMIN"]),
    ("authEvent.read", "read", "AuthEvent", None, ["ADMIN"]),
    ("account.triggerReset", "triggerReset", "Account", None, ["STAFF"]),
    # organizations
    ("organization.read", "read", "Organization", None, ["STAFF"]),
    ("organization.read.own", "read", "Organization", OWN_ORG, ["ORG_OPERATOR"]),
    ("organization.update.own", "update", "Organization", OWN_ORG, ["ORG_MANAGER"]),
    # api-design 11: the Manager reads its own status history, suspension reasons included; an Org
    # Operator does not (leader ruling on treklink-web#135). Migration 20261030210000.
    ("organization.history.read.own", "readHistory", "Organization", OWN_ORG, ["ORG_MANAGER"]),
    ("organization.update", "update", "Organization", None, ["ADMIN"]),
    ("organization.verify", "verify", "Organization", None, ["STAFF"]),
    ("organization.decide", "decide", "Organization", None, ["ADMIN"]),
    ("organization.suspend", "suspend", "Organization", None, ["ADMIN"]),
    ("organization.rotateKey", "rotateKey", "Organization", None, ["STAFF"]),  # api-design 27; migration 20261030160000_compliance_and_rotation
    ("member.read", "read", "Member", None, ["STAFF"]),
    ("member.read.own", "read", "Member", OWN, ["ORG_OPERATOR"]),
    ("member.manage.own", "manage", "Member", OWN, ["ORG_MANAGER"]),
    ("roster.read.own", "read", "RosterShift", OWN, ["ORG_OPERATOR"]),
    ("roster.manage.own", "manage", "RosterShift", OWN, ["ORG_MANAGER"]),
    ("apiKey.manage.own", "manage", "ApiKey", OWN, ["ORG_MANAGER"]),
    ("apiKey.read", "read", "ApiKey", None, ["STAFF"]),  # ruling 2026-10-30; migration 20261030120000_api_key_read
    ("fieldStation.read.own", "read", "FieldStation", OWN, ["ORG_OPERATOR"]),
    ("fieldStation.manage.own", "manage", "FieldStation", OWN, ["ORG_MANAGER"]),
    ("fieldStation.read", "read", "FieldStation", None, ["STAFF"]),
    ("fieldStation.revoke", "revoke", "FieldStation", None, ["STAFF"]),
    ("complianceCase.manage", "manage", "ComplianceCase", None, ["STAFF"]),  # api-design 28 to 32; migration 20261030160000_compliance_and_rotation
    # devices
    ("hardwareVariant.read", "read", "HardwareVariant", None, ["STAFF"]),
    ("hardwareVariant.read.org", "read", "HardwareVariant", None, ["ORG_MANAGER"]),  # active variants, no counts
    ("hardwareVariant.manage", "manage", "HardwareVariant", None, ["ADMIN"]),
    ("device.read", "read", "Device", None, ["STAFF"]),
    ("device.register", "create", "Device", None, ["STAFF"]),
    ("device.operate", "operate", "Device", None, ["STAFF"]),
    ("device.retire", "retire", "Device", None, ["ADMIN"]),
    ("device.dispose", "dispose", "Device", None, ["ADMIN"]),  # devices api-design 23, BR-42
    ("device.availability", "readAvailability", "Device", None, ["STAFF"]),
    ("device.availability.org", "readAvailability", "Device", None, ["ORG_MANAGER"]),
    ("maintenance.decide", "decide", "MaintenanceRecord", None, ["ADMIN"]),  # devices api-design 13, BR-44
    ("stockTake.manage", "manage", "StockTake", None, ["STAFF"]),
    # rentals
    ("contract.read", "read", "RentalContract", None, ["STAFF"]),
    ("contract.read.own", "read", "RentalContract", OWN, ["ORG_OPERATOR"]),
    ("contract.request.own", "request", "RentalContract", OWN, ["ORG_MANAGER"]),
    ("contract.cancel.own", "cancel", "RentalContract", OWN, ["ORG_MANAGER"]),
    ("contract.notice.own", "notice", "RentalContract", OWN, ["ORG_MANAGER"]),
    ("contract.label.own", "label", "RentalContract", OWN, ["ORG_OPERATOR"]),
    ("contract.operate", "operate", "RentalContract", None, ["STAFF"]),
    ("handoverNote.read.own", "read", "HandoverNote", OWN, ["ORG_MANAGER"]),
    ("handoverNote.read", "read", "HandoverNote", None, ["STAFF"]),
    # billing
    ("plan.quote", "quote", "Plan", None, ["STAFF"]),
    ("plan.quote.org", "quote", "Plan", None, ["ORG_MANAGER"]),
    ("priceSchedule.manage", "manage", "PriceSchedule", None, ["ADMIN"]),
    ("damageRate.read", "read", "DamageRate", None, ["STAFF"]),
    ("damageRate.manage", "manage", "DamageRate", None, ["ADMIN"]),
    ("invoice.read", "read", "Invoice", None, ["STAFF"]),
    ("invoice.read.own", "read", "Invoice", OWN, ["ORG_MANAGER"]),
    ("payment.read", "read", "Payment", None, ["STAFF"]),
    ("payment.read.own", "read", "Payment", OWN, ["ORG_MANAGER"]),
    ("payment.payOnline.own", "payOnline", "Invoice", OWN, ["ORG_MANAGER"]),
    ("payment.recordCounter", "recordCounter", "Invoice", None, ["STAFF"]),
    ("damageCharge.read", "read", "DamageCharge", None, ["STAFF"]),
    ("damageCharge.decide", "decide", "DamageCharge", None, ["ADMIN"]),
    ("report.read", "read", "Report", None, ["STAFF"]),
    # gateway-sync
    ("fieldEvent.read", "read", "FieldEvent", None, ["STAFF"]),
    ("syncAudit.read", "read", "SyncAudit", None, ["ADMIN"]),
    ("syncAudit.replay", "replay", "SyncAudit", None, ["ADMIN"]),
    ("queueReport.read", "read", "DeviceQueueReport", None, ["STAFF"]),
    # incidents
    ("incident.read", "read", "Incident", None, ["STAFF"]),
    ("incident.read.own", "read", "Incident", OWN, ["ORG_OPERATOR"]),
    ("incident.respond.own", "respond", "Incident", OWN, ["ORG_OPERATOR"]),
    ("incident.respondUnrouted", "respondUnrouted", "Incident", {"state": "UNROUTED"}, ["STAFF"]),
    ("authorityReport.manage", "manage", "AuthorityReport", None, ["STAFF"]),
    ("alertDelivery.read.own", "read", "AlertDelivery", OWN, ["ORG_MANAGER"]),
    ("alertDelivery.read", "read", "AlertDelivery", None, ["STAFF"]),
    # monitoring
    ("liveMap.read", "read", "LiveMap", None, ["STAFF"]),
    ("liveMap.read.own", "read", "LiveMap", OWN, ["ORG_OPERATOR"]),
    ("telemetryHistory.read", "read", "TelemetryHistory", None, ["STAFF"]),
    ("telemetryHistory.read.own", "read", "TelemetryHistory", OWN, ["ORG_OPERATOR"]),
    # demo (D-088, specs/demo/design.md §6): the local demo control panel. The role switch is one key per
    # account type (D-057); migration 20261101120000_demo_controls carries the same rows.
    ("demo.stage", "stage", "Demo", None, ["ADMIN"]),
    ("demo.switchRole", "switchRole", "Demo", None, ["STAFF"]),
    ("demo.switchRole.org", "switchRole", "Demo", None, ["ORG_OPERATOR"]),
]

INHERITS = {"ADMIN": "STAFF", "ORG_MANAGER": "ORG_OPERATOR"}

# Permissions the ADMIN role can never lose (ADMIN_LOCKOUT); served as `protected` by GET /api/permissions.
PROTECTED = {"role.manage"}
