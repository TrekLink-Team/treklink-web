from ._common import USER_ID, CONTRACT_ID, NOW, STALE, ep

NOTES = ("Control routes require `DEMO_CONTROLS_ENABLED=true` and explicit `VITE_APP_ENV` sandbox or staging; "
         "otherwise they answer 404 (REQ-QUICK-01). Legacy stage and role-switch writes additionally refuse "
         "NODE_ENV production and non-loopback databases (design §2). Additive quick actions 11 and 12 allow "
         "staging production, require an Admin role and `demo.stage`, and check both database URLs. "
         "Route 05 is the public test accounts list under its independent `DEMO_TEST_ACCOUNTS_ENABLED` flag (D-089). "
         "Simulation control routes 06 to 10 require both the control/environment gate and `DEMO_SIMULATION_ENABLED`; "
         "their writes require a local or named staging database and may run in staging production. "
         "The field simulator job retains its separate flag. "
         "Panel routes 13 to 16 (added 2026-11-24, D-110) need no account: they load only when "
         "`DEMO_PANEL_PASSWORD_HASH` parses, and every one of them requires the panel password header "
         "`X-Demo-Panel-Password`; the reseed 16 runs only on the `DEMO_DATABASE_HOST` branch with "
         "`DEMO_RESET_ENABLED`.")

GUARDS = [(403, "DEMO_DISABLED", "`NODE_ENV` is `production`", "Demo controls are disabled in production."),
          (403, "DEMO_DATABASE_NOT_LOCAL", "The host of `DATABASE_URL` is not a loopback address",
           "Demo controls run only against a local database."),
          (409, "DEMO_BUSY", "Another stage or role switch is running", "A demo action is already running. Try again in a moment.")]

SESSION = {"accessToken": "eyJhbGciOi...", "accessTokenExpiresIn": 900, "refreshToken": "rt_...",
           "refreshTokenExpiresIn": 604800,
           "user": {"id": USER_ID, "email": "admin@treklink.local", "fullName": "Demo Admin",
                    "accountType": "TREKLINK", "roles": ["ADMIN"], "organization": None}}

ENDPOINTS = []

ENDPOINTS.append(ep(
    "GET", "/api/demo/status", "Demo controls status", "Any signed-in user",
    "Tells the client whether demo controls can act in this process and on this database, and which "
    "scenario was staged last. The account menu and the demo page read it to show or hide the controls.",
    "D-088, REQ-EVT-01",
    response={"enabled": True, "quickEnabled": True, "roleSwitchEnabled": False, "databaseLocal": False,
              "lastStaged": {"scenarioId": "clean", "at": NOW}},
    fields=[["enabled", "True when local or additive quick controls are available", "boolean", "`true`"],
            ["quickEnabled", "The explicit control/environment gate permits additive actions", "boolean", "`true`"],
            ["roleSwitchEnabled", "Local role switching is allowed; always false in production", "boolean", "`false`"],
            ["databaseLocal", "Both database URLs are loopback with no target overrides", "boolean", "`false`"],
            ["lastStaged", "Last scenario staged by this process, or null", "object", "`null`"]],
    steps=["Read NODE_ENV and the DATABASE_URL host", "Read the last staged scenario held in memory"],
    controller="DemoController", service="DemoScenariosService", call="status()",
    seq=["Svc->>Svc: guards.facts()"]))

ENDPOINTS.append(ep(
    "GET", "/api/demo/scenarios", "List demo scenarios", "TrekLink Admin (`demo.stage`)",
    "Lists the scenarios a stage can reach, each with its main flow and whether it can be staged now.",
    "D-088, REQ-EVT-02",
    response=[{"id": "contract-ready-for-handover", "title": "Contract ready for handover", "flow": "MF-01",
               "summary": "RC-2026-0004 approved for five treklink-v3 units from today, holding fee paid.",
               "available": True, "unavailableReason": None},
              {"id": "loss-cases", "title": "Loss cases", "flow": "MF-05", "summary": "...",
               "available": False, "unavailableReason": "Needs the loss cases change (treklink-web#228)."}],
    steps=["Return the scenario catalogue"],
    controller="DemoController", service="DemoScenariosService", call="list()",
    seq=["Svc->>Svc: SCENARIOS"]))

ENDPOINTS.append(ep(
    "POST", "/api/demo/scenarios/:id/stage", "Stage a demo scenario", "TrekLink Admin (`demo.stage`)",
    "Deletes every row of the local database except the migration-filled reference tables, runs the demo "
    "seed, applies the scenario's steps through the owning modules' services and signs the caller in again "
    "as the seeded Admin. Every other window must sign in again.",
    "D-088, REQ-EVT-03, REQ-ERR-01 to REQ-ERR-05",
    path=[["id", "Scenario id", "string", "`term-ended`"]],
    response={"scenarioId": "contract-ready-for-handover", "stagedAt": NOW,
              "records": [{"label": "Contract", "code": "RC-2026-0004", "path": f"/t/counter/{CONTRACT_ID}"}],
              "firstSteps": ["Window B, Staff: Contracts, tab Approved, RC-2026-0004.",
                             "Open the contract, then Open the counter."],
              "session": SESSION},
    fields=[["records[].path", "Frontend route the panel links to", "string", "`/t/counter/...`"],
            ["session", "Token pair and account of the seeded Admin, as a sign-in returns them", "object", "see sample"]],
    message="Scenario staged", entity="Scenario",
    errors=GUARDS + [
        (409, "DEMO_SCENARIO_UNAVAILABLE", "The scenario is listed as unavailable",
         "Needs the loss cases change (treklink-web#228)."),
        (409, "DEMO_SEED_NOT_CONFIGURED", "A `SEED_*_PASSWORD` variable is missing",
         "Set SEED_ADMIN_PASSWORD before staging.")],
    steps=["Check production, local database, lock", "Check the scenario and the seed passwords",
           "TRUNCATE the data tables in one transaction", "Run the demo seed", "Apply the scenario steps",
           "Issue the Admin session", "Emit audit.record demo.stage"],
    controller="DemoController", service="DemoScenariosService", call="stage(id, client)",
    seq=["Svc->>DB: BEGIN, TRUNCATE ... RESTART IDENTITY CASCADE, COMMIT",
         "Svc->>DB: seedDemo (own transaction)", "Svc->>Svc: scenario steps via exported services",
         "Svc-)Svc: emit audit.record"]))

ENDPOINTS.append(ep(
    "POST", "/api/demo/switch-role", "Switch to a seeded role", "Any seeded role (`demo.switchRole`, `demo.switchRole.org`)",
    "Issues a normal token pair for the seeded account of the chosen role, as a sign-in would, and records "
    "an auth event `DEMO_SWITCH`. A presenter signed in as the Manager can switch back to the Admin.",
    "D-088, REQ-EVT-04, REQ-ERR-01 to REQ-ERR-03, REQ-ERR-06",
    body=[["role", "`ADMIN`, `STAFF`, `ORG_MANAGER` or `ORG_OPERATOR`", "string", "yes", "`ORG_MANAGER`"]],
    sample={"role": "ORG_MANAGER"},
    response={**SESSION, "user": {**SESSION["user"], "email": "manager@treklink.local", "fullName": "Demo Manager",
                                  "accountType": "ORGANIZATION", "roles": ["ORG_MANAGER"]}},
    message="Signed in", entity="Account",
    errors=GUARDS + [(404, "NOT_FOUND", "No seeded account of that role may sign in",
                      "No seeded account for this role. Stage a scenario first.")],
    steps=["Check production, local database, lock", "Load the seeded account of the role",
           "Record DEMO_SWITCH and issue a token pair"],
    controller="DemoController", service="DemoSessionService", call="switchTo(email, client)",
    seq=["Svc->>DB: SELECT users by email", "Svc->>DB: INSERT auth_events, refresh_tokens"]))

ENDPOINTS.append(ep(
    "GET", "/api/demo/accounts", "List the sandbox test accounts", "Public (`DEMO_TEST_ACCOUNTS_ENABLED`)",
    "Lists every account the demo seed creates, with its password, so a tester signs in as any role without "
    "asking anyone. The root page and the sign-in page show it in the \"Sandbox test accounts\" box. The "
    "passwords are read from the `SEED_*_PASSWORD` variables on every request, never stored and never "
    "logged; the response carries `Cache-Control: no-store`. The route belongs to `DemoAccountsModule`, "
    "loaded only when `DEMO_TEST_ACCOUNTS_ENABLED` is `true`, independently of the control panel. It is "
    "read-only and touches no database, so it answers in any `NODE_ENV` and on any database, the Vercel "
    "production included (D-089); the guards of the control panel routes stay as they are.",
    "D-088 amendment of 2026-11-01, D-089, REQ-UBI-01, REQ-EVT-05, REQ-ERR-05",
    response={"accounts": [
        {"role": "ADMIN", "roleLabel": "TrekLink Admin", "email": "admin@treklink.local",
         "password": "<SEED_ADMIN_PASSWORD>", "fullName": "Demo Admin", "organization": None},
        {"role": "STAFF", "roleLabel": "TrekLink Staff", "email": "staff@treklink.local",
         "password": "<SEED_STAFF_PASSWORD>", "fullName": "Demo Staff", "organization": None},
        {"role": "ORG_MANAGER", "roleLabel": "Org Manager", "email": "manager@treklink.local",
         "password": "<SEED_MANAGER_PASSWORD>", "fullName": "Demo Manager", "organization": "ORG-0001"},
        {"role": "ORG_OPERATOR", "roleLabel": "Org Operator", "email": "operator@treklink.local",
         "password": "<SEED_OPERATOR_PASSWORD>", "fullName": "Demo Operator", "organization": "ORG-0001"}]},
    fields=[["accounts", "Every seeded account, in the order Admin, Staff, Manager, Operator", "array", "see sample"],
            ["accounts[].password", "The value of the account's `SEED_*_PASSWORD` variable at request time", "string", "`<SEED_ADMIN_PASSWORD>`"],
            ["accounts[].organization", "Organization code of a member account, null for a TrekLink account", "string", "`ORG-0001`"]],
    errors=[(404, "NOT_FOUND", "`DEMO_TEST_ACCOUNTS_ENABLED` is not `true`: the route does not exist",
             "Cannot GET /api/demo/accounts"),
            (409, "DEMO_SEED_NOT_CONFIGURED", "A `SEED_*_PASSWORD` variable is missing",
             "Set SEED_ADMIN_PASSWORD before listing the test accounts.")],
    steps=["Read the SEED_*_PASSWORD variables", "Map SEEDED_TEST_ACCOUNTS, the compiled copy of the seed list"],
    controller="DemoAccountsController", service="DemoAccountsService", call="list()",
    seq=["Svc->>Svc: readTestAccountPasswords(env)", "Svc->>Svc: SEEDED_TEST_ACCOUNTS"]))

# Field simulation (D-093 amendment, D-094; specs/demo/requirements.md §2.4, design §9). Routes 06 to 10 belong
# to DemoSimulationModule, loaded only when the W43 gate and DEMO_SIMULATION_ENABLED pass.
SIM_PERMISSION = "TrekLink Admin (`demo.simulate`)"
SIM_NOT_ALLOWED = (403, "DEMO_DATABASE_NOT_ALLOWED",
                   "The database of `DATABASE_URL` or `DATABASE_DIRECT_URL` is neither on a loopback host nor named `treklink_prod`",
                   "The field simulation runs only on a local database or the Vercel staging.")
SIM_OFF = (404, "NOT_FOUND", "`DEMO_SIMULATION_ENABLED` is not `true`: the route does not exist",
           "Cannot GET /api/demo/simulation")
SIM_STOPPED = (409, "INVALID_STATE_TRANSITION", "The simulated node is `STOPPED`",
               "This cannot be done while it is STOPPED.")
SIM_NODE_ID = "4b3a2918-0716-4f5e-8d4c-3b2a19080706"
SIM_NODE = {"id": SIM_NODE_ID, "deviceId": "0d3f6a2b-7e11-4c55-8f0a-2b1c9e7d4a10", "assetTag": "TL-0010",
            "nodeId": "!de00000a", "organization": {"id": "5b1d2c0e-7f3a-4e21-9c8d-1a2b3c4d5e6f", "code": "ORG-0001",
                                                     "name": "TrekLink Demo Tours Co., Ltd."},
            "trailId": "ta-nang-phan-dung", "pattern": "WALK", "style": "HIKER", "speedMetresPerMinute": 60,
            "status": "RUNNING",
            "sosKind": None, "sosSince": None, "position": {"lat": 11.497591, "lon": 108.568646},
            "batteryPct": 99, "lastPacketAt": NOW, "simulated": True, "version": 0, "createdAt": NOW,
            "updatedAt": NOW}
SIM_NODE_FIELDS = [
    ["nodeId", "Mesh node id the packets carry, `!` and eight hex digits of `nodeNum`", "string", "`!de00000a`"],
    ["organization", "Organization holding the device now, or null when it is not handed over", "object", "see sample"],
    ["position", "Position the pattern gives at the time of the read (the stop time for a `STOPPED` node)", "object", "see sample"],
    ["batteryPct", "Battery the pattern gives at the same time, 5 to 100", "int", "`99`"],
    ["lastPacketAt", "Last time the device was heard (device projection `lastSeenAt`), or null", "datetime", f"`{NOW}`"],
    ["style", "Movement style while the pattern walks (design §9.1), or null for a node started before the "
     "styles, which keeps the steady walk at `speedMetresPerMinute`", "string", "`HIKER`"],
    ["sosKind", "`SOS` or `FALL` while an SOS is active, otherwise null", "string", "`null`"],
    ["version", "Compare-and-set version for 08 and 09", "int", "`0`"]]

ENDPOINTS.append(ep(
    "GET", "/api/demo/simulation", "Read the field simulation", SIM_PERMISSION,
    "Lists what the field simulation panel needs: the trails (OpenStreetMap, © OpenStreetMap contributors, ODbL), "
    "the patterns, the movement styles, the devices that can be simulated and the simulated nodes, running ones first, then the twenty "
    "most recently stopped. `databaseAllowed` tells the screen whether the writes 07 to 10 can act on this database. "
    "The route belongs to `DemoSimulationModule`, loaded only when the W43 control/environment gate and "
    "`DEMO_SIMULATION_ENABLED` pass. It may run in staging production (D-094, W43).",
    "D-093 amendment, D-094, REQ-SIM-01, REQ-SIM-08, REQ-SIM-09",
    response={"databaseAllowed": True,
              "trails": [{"id": "ta-nang-phan-dung", "name": "Ta Nang to Phan Dung", "region": "Lam Dong",
                          "lengthMetres": 7200, "pointCount": 63,
                          "source": {"osmWayIds": [1164619760], "readOn": "2026-11-01",
                                     "simplification": "Douglas-Peucker, 10 m, 189 to 63 points"}}],
              "patterns": ["WALK", "STOP", "STRAY", "SILENT", "LOW_BATTERY"],
              "styles": ["JOGGER", "HIKER", "CAMPER", "EXPLORER", "TRAIL_WALKER", "WANDERER", "GROUP_FOLLOWER", "STRAGGLER"],
              "devices": [{"id": "0d3f6a2b-7e11-4c55-8f0a-2b1c9e7d4a10", "assetTag": "TL-0010", "nodeId": "!de00000a",
                           "status": "RENTED", "organization": SIM_NODE["organization"], "runningNodeId": SIM_NODE_ID}],
              "nodes": [SIM_NODE]},
    fields=[["databaseAllowed", "The database is on a loopback host or named `treklink_prod` (REQ-SIM-02)", "boolean", "`true`"],
            ["styles", "The movement styles of design §9.1, in the order the seed picks them", "array", "see sample"],
            ["trails[].lengthMetres", "Length of the simplified line", "int", "`7200`"],
            ["trails[].source", "OpenStreetMap way ids, the date they were read through the Overpass API, the simplification", "object", "see sample"],
            ["devices", "Every device not `DISPOSED`, by asset tag; each has a `nodeNum` (devices schema)", "array", "see sample"],
            ["devices[].runningNodeId", "The `RUNNING` simulated node of the device, or null", "uuid", "`null`"],
            *SIM_NODE_FIELDS],
    errors=[SIM_OFF],
    steps=["Read the trails and patterns (compiled data)", "Read the devices and their holders",
           "Read the simulated nodes and their device projections", "Compute each node's position and battery now"],
    controller="DemoSimulationController", service="FieldSimulationService", call="overview(now)",
    seq=["Svc->>DB: SELECT simulated_nodes", "Svc->>Svc: DevicesService.projections, ContractsService.visibleDevices"]))

ENDPOINTS.append(ep(
    "POST", "/api/demo/simulation/nodes", "Start a simulated node", SIM_PERMISSION,
    "Starts a simulated node for a device on a trail with a pattern. From the next run of the field data simulator "
    "(gateway-sync design §2) the node sends one position and one telemetry packet per "
    "`gatewaySync.simulatorIntervalSeconds` through the node uplink path, so positions, staleness, incidents and "
    "alerts behave as for a real node; every field event it causes is stored with `simulated = true`. A device "
    "runs as at most one node at a time. The node's style seed is FNV-1a of its asset tag (shifted to fit 31 bits), so a run repeats; "
    "without a `style` the seed also picks the style.",
    "D-093 amendment, REQ-SIM-02, REQ-SIM-03, REQ-SIM-04, REQ-SIM-07, REQ-SIM-09",
    body=[["deviceId", "Device to simulate", "uuid", "yes", "`0d3f6a2b-...`"],
          ["trailId", "Id of a trail of 06", "string", "yes", "`ta-nang-phan-dung`"],
          ["pattern", "`WALK`, `STOP`, `STRAY`, `SILENT` or `LOW_BATTERY`", "string", "yes", "`WALK`"],
          ["style", "A movement style of 06; default the style of the device's asset tag (design §9.1)",
           "string", "no", "`HIKER`"],
          ["speedMetresPerMinute", "Walking speed of a node with no style, 10 to 300; default 60", "int", "no", "`60`"],
          ["startMetres", "Distance along the trail to start from, 0 to its length; default 0", "int", "no", "`0`"]],
    sample={"deviceId": "0d3f6a2b-7e11-4c55-8f0a-2b1c9e7d4a10", "trailId": "ta-nang-phan-dung", "pattern": "WALK"},
    response=SIM_NODE, fields=SIM_NODE_FIELDS, message="Simulated node started", entity="Simulated node",
    errors=[SIM_NOT_ALLOWED, SIM_OFF,
            (400, "VALIDATION_FAILED", "The trail is unknown, or `startMetres` is past its end", "Unknown trail."),
            (404, "NOT_FOUND", "No such device, or it is `DISPOSED`", "Device not found."),
            (409, "DEMO_NODE_RUNNING", "The device already runs as a simulated node",
             "TL-0010 already runs as a simulated node. Stop it first.")],
    steps=["Check the database (loopback or treklink_prod)", "Load the device and the trail",
           "INSERT simulated_nodes with the anchor at the start point", "Emit audit.record demo.simulation.start"],
    controller="DemoSimulationController", service="FieldSimulationService", call="start(dto, actor)",
    seq=["Svc->>DB: INSERT simulated_nodes (unique RUNNING per device)", "Svc-)Svc: emit audit.record"]))

ENDPOINTS.append(ep(
    "PATCH", "/api/demo/simulation/nodes/:id", "Change a simulated node", SIM_PERMISSION,
    "Changes the pattern, the style, the trail or the speed of a running node. The node is re-anchored where it is now, so the "
    "move continues from there; a new trail starts at its first point. An active SOS stays active.",
    "D-093 amendment, REQ-SIM-02, REQ-SIM-04, REQ-SIM-07, REQ-SIM-09",
    path=[["id", "Simulated node id", "uuid", f"`{SIM_NODE_ID}`"]],
    body=[["expectedVersion", "The node's `version` as read", "int", "yes", "`0`"],
          ["pattern", "New pattern", "string", "no", "`STRAY`"],
          ["style", "New movement style; a `GROUP_FOLLOWER` joins its trail's group at once", "string", "no",
           "`WANDERER`"],
          ["trailId", "New trail", "string", "no", "`ta-nang-phan-dung`"],
          ["speedMetresPerMinute", "New speed, 10 to 300", "int", "no", "`80`"]],
    sample={"expectedVersion": 0, "pattern": "STRAY"},
    response={**SIM_NODE, "pattern": "STRAY", "version": 1}, fields=SIM_NODE_FIELDS,
    message="Simulated node changed", entity="Simulated node",
    errors=[SIM_NOT_ALLOWED, SIM_OFF, (400, "VALIDATION_FAILED", "The trail is unknown", "Unknown trail."),
            (404, "NOT_FOUND", "No such simulated node", "Simulated node not found."), SIM_STOPPED, STALE],
    steps=["Check the database", "Compute the current position and battery", "Compare-and-set the new anchor",
           "Emit audit.record demo.simulation.update"],
    controller="DemoSimulationController", service="FieldSimulationService", call="update(id, dto, actor)",
    seq=["Svc->>DB: UPDATE simulated_nodes WHERE version", "Svc-)Svc: emit audit.record"]))

ENDPOINTS.append(ep(
    "POST", "/api/demo/simulation/nodes/:id/stop", "Stop a simulated node", SIM_PERMISSION,
    "Stops a running node: the simulator sends nothing more for it, and an active SOS ends without a packet. The "
    "device then turns stale after `monitoring.deviceStaleSeconds`, as a real device that falls silent. The row "
    "stays, listed among the stopped nodes; nothing is deleted.",
    "D-093 amendment, REQ-SIM-02, REQ-SIM-07",
    path=[["id", "Simulated node id", "uuid", f"`{SIM_NODE_ID}`"]],
    body=[["expectedVersion", "The node's `version` as read", "int", "yes", "`0`"]],
    sample={"expectedVersion": 0}, response={**SIM_NODE, "status": "STOPPED", "version": 1}, fields=SIM_NODE_FIELDS,
    message="Simulated node stopped", entity="Simulated node",
    errors=[SIM_NOT_ALLOWED, SIM_OFF, (404, "NOT_FOUND", "No such simulated node", "Simulated node not found."),
            SIM_STOPPED, STALE],
    steps=["Check the database", "Compare-and-set STOPPED with the final anchor", "Emit audit.record demo.simulation.stop"],
    controller="DemoSimulationController", service="FieldSimulationService", call="stop(id, dto, actor)",
    seq=["Svc->>DB: UPDATE simulated_nodes SET status = STOPPED WHERE version", "Svc-)Svc: emit audit.record"]))

ENDPOINTS.append(ep(
    "POST", "/api/demo/simulation/nodes/:id/events", "Raise an SOS, a fall or a cancel", SIM_PERMISSION,
    "`SOS` and `FALL` ingest at once, through the node uplink path, the text a TrekLink node sends "
    "(`SOS - [lat], [lon]` or `SOS - FALL DETECTED - [lat], [lon]`, six decimals, firmware ground truth §2) and its "
    "first position beacon; each later simulator run adds the beacons due since the last one, every 5 s for the "
    "first 60 s and every 30 s after. The incident opens, routes, notifies and escalates as for a real device, "
    "marked simulated. A second `SOS` restarts the beacons and joins the open incident. `SOS_CANCEL` stops the "
    "beacons and sends nothing, because the firmware sends no cancel packet: a person resolves the incident.",
    "D-093 amendment, REQ-SIM-02, REQ-SIM-05, REQ-SIM-07, AC-07",
    path=[["id", "Simulated node id", "uuid", f"`{SIM_NODE_ID}`"]],
    body=[["kind", "`SOS`, `FALL` or `SOS_CANCEL`", "string", "yes", "`SOS`"]],
    sample={"kind": "SOS"},
    response={"node": {**SIM_NODE, "sosKind": "SOS", "sosSince": NOW, "version": 1},
              "fieldEventId": "9f2c4e...e1"},
    fields=[["fieldEventId", "D-006 event id of the SOS text packet; null for `SOS_CANCEL`", "string", "`9f2c...`"]],
    message="Simulated event raised", entity="Simulated node",
    errors=[SIM_NOT_ALLOWED, SIM_OFF, (404, "NOT_FOUND", "No such simulated node", "Simulated node not found."),
            SIM_STOPPED,
            (409, "INVALID_STATE_TRANSITION", "`SOS_CANCEL` while no SOS is active", "No SOS is active on this node.")],
    steps=["Check the database", "Re-anchor at the current position and set or clear sosKind",
           "SOS or FALL: ingest the text packet and the first beacon with simulated = true",
           "Emit audit.record demo.simulation.event"],
    controller="DemoSimulationController", service="FieldSimulationService", call="raise(id, kind, actor)",
    seq=["Svc->>DB: UPDATE simulated_nodes WHERE version", "Svc->>Svc: UplinkIngress.ingest(topic, body, now, { simulated: true })",
         "Svc-)Svc: emit audit.record"]))

# W43 additive staging controls. Legacy stage and switch keep their local-only guards.
QUICK_GUARDS = [(403, "DEMO_DISABLED", "Flag or explicit sandbox/staging environment is wrong", "Demo quick controls are disabled."),
                (403, "DEMO_DATABASE_NOT_ALLOWED", "Either database URL is outside the local/staging allowlist", "Demo quick controls require a local or staging database."),
                (409, "STALE_VERSION", "A version changed since the options read", "Reload and try again.")]
ENDPOINTS.append(ep(
    "GET", "/api/demo/quick", "Quick scenario options", "TrekLink Admin (`demo.stage`) plus ADMIN role",
    "Reads active organizations, variants, rented units, contracts, simulated incidents and the persistent escalation profile.",
    "W43, REQ-QUICK-01 to 09", response={"organizations": [], "variants": [], "units": [], "contracts": [], "incidents": [], "profile": {"active": False, "version": 0}},
    steps=["Check explicit environment and Admin role", "Read through exported owning services"],
    controller="DemoQuickController", service="DemoQuickService", call="options(caller)"))
ENDPOINTS.append(ep(
    "POST", "/api/demo/quick/:action", "Run an additive quick scenario", "TrekLink Admin (`demo.stage`) plus ADMIN role",
    "Creates fresh demo records or applies a disclosed demo time control. Never resets, seeds, deletes or truncates. Failed actions return the D-002 error envelope with the owning HTTP status and any committed record links in result.",
    "W43, REQ-QUICK-01 to 09",
    path=[["action", "organization, contract, incident, loss, fault, walkers, profile, term-end, next-tier", "string", "`contract`"]],
    body=[["organizationId", "Active organization for contract", "UUID", "conditional", "..."],
          ["hardwareVariantId", "Active variant for contract", "UUID", "conditional", "..."],
          ["quantity", "At least parameter minimum, two for ACTIVE", "integer", "conditional", "5"],
          ["target", "REQUESTED, APPROVED, ACTIVE, RETURN_DUE", "string", "conditional", "APPROVED"],
          ["deviceId", "Rented unit for SOS/loss/fault", "UUID", "conditional", "..."],
          ["recordId", "Contract or incident for time control", "UUID", "conditional", "..."],
          ["expectedVersion", "Version for profile or time control", "integer", "conditional", "0"],
          ["active", "Enable or restore escalation demo profile", "boolean", "conditional", "true"]],
    sample={"organizationId": USER_ID, "hardwareVariantId": USER_ID, "quantity": 5, "target": "APPROVED"},
    response={"runId": 1, "label": "Demo 1", "records": [], "error": None, "errorCode": None},
    errors=QUICK_GUARDS, message="Demo action completed",
    fields=[["error", "Null on success; failures use the error envelope message and owning HTTP status", "null", "`null`"], ["errorCode", "Null on success; failures return result.errorCode with result.runId, result.label and result.records", "null", "`null`"]],
    steps=["Validate action-specific fields, environment, Admin role and database", "Allocate durable demo counter",
           "Call real owning services and retain links after each committed step", "Commit registry and emit actor audit"],
    controller="DemoQuickController", service="DemoQuickService", call="run(action, dto, caller)"))

# Demo panel for a defence (added 2026-11-24, D-110; specs/demo/requirements.md §5, design §11). Routes 13 to
# 16 belong to DemoPanelModule, loaded only when DEMO_PANEL_PASSWORD_HASH parses. They need no account: every
# route, reads included, requires the panel password in X-Demo-Panel-Password (DemoPanelGuard).
PANEL_PERMISSION = "Public (demo panel password header `X-Demo-Panel-Password`)"
PANEL_AUTH = ("DemoPanelGuard: failure limit, then the password in constant time", "DEMO_PANEL_PASSWORD_INVALID")
PANEL_GUARD = [(401, "DEMO_PANEL_PASSWORD_INVALID", "The panel password header is missing or wrong",
                "Enter the panel password."),
               (404, "NOT_FOUND", "`DEMO_PANEL_PASSWORD_HASH` is unset or does not parse: the route does not exist",
                "Cannot GET /api/demo/panel"),
               (429, "RATE_LIMITED", "Five wrong or missing passwords from this address within ten minutes",
                "Too many wrong panel passwords. Try again after 10:25.")]
PANEL_DB = (403, "DEMO_DATABASE_NOT_ALLOWED",
            "The database is neither allowed for the simulation nor the `DEMO_DATABASE_HOST` endpoint",
            "The demo panel writes only to a local, staging or demo database.")
PANEL_PLAYBACK = {"flow": "MF-03", "status": "PAUSED", "index": 1, "intervalSeconds": 10, "nextAt": None,
                  "steps": [{"title": "SOS from TL-0010", "window": "Physical unit", "screen": "Gateway log",
                             "status": "DONE", "prompt": None, "error": None, "records": []},
                            {"title": "Operator acknowledges", "window": "C, Operator", "screen": "/o/incidents",
                             "status": "PENDING", "prompt": None, "error": None, "records": []}],
                  "error": None}
PANEL_RESULT = {"action": "incident-acknowledge", "runId": 12, "label": "Demo 12",
                "actedAs": {"role": "ORG_OPERATOR", "email": "treklink.dev+operator@gmail.com"},
                "records": [{"label": "Incident, acknowledged", "code": "INC-2026-000002",
                             "path": "/o/incidents/7a6b5c4d-3e2f-4a1b-8c9d-0e1f2a3b4c5d"}]}

def panel_activity(checks, steps, failure=None):
    """The activity of a panel route as the guard and the route run it (review of treklink-web#541): the
    route exists only with a hash that parses (404), the attempt is refused over the failure limit (429) or
    reserved before the password compare (401), then the route's own checks in code order, each
    (question, status, code), then its steps. `failure` = (after_step_index, question, finally_step, reply)
    draws the path where a step fails after the route has committed to it."""
    lines = ["S((Start))", 'A0["Accept request: no account, no token"]', "S --> A0",
             'H{"Panel password hash unset or malformed?"}', "A0 --> H",
             'HE["Return 404 NOT_FOUND: the route does not exist"]', "H -->|yes| HE", "HE --> HX((End))",
             'L{"Five attempts from this address in ten minutes already?"}', "H -->|no| L",
             'LE["Return 429 RATE_LIMITED, no compare"]', "L -->|yes| LE", "LE --> LX((End))",
             'R["Reserve this attempt before the compare"]', "L -->|no| R",
             'P{"Panel password missing or wrong?"}', "R --> P",
             'PE["Return 401 DEMO_PANEL_PASSWORD_INVALID, the attempt stays counted"]', "P -->|yes| PE",
             "PE --> PX((End))",
             'G["Give this attempt back"]', "P -->|no| G"]
    prev, edge = "G", ""
    for i, (question, status, code) in enumerate(checks):
        lines += [f'C{i}{{"{question}?"}}', f"{prev} -->{edge} C{i}",
                  f'CE{i}["Return {status} {code}"]', f"C{i} -->|yes| CE{i}", f"CE{i} --> CX{i}((End))"]
        prev, edge = f"C{i}", "|no|"
    for i, step in enumerate(steps):
        lines += [f'T{i}["{step}"]', f"{prev} -->{edge} T{i}"]
        prev, edge = f"T{i}", ""
        if failure and failure[0] == i:
            _, question, finally_step, reply = failure
            lines += [f'F{i}{{"{question}?"}}', f"T{i} --> F{i}",
                      f'FF{i}["{finally_step}"]', f"F{i} -->|yes| FF{i}",
                      f'FR{i}["{reply}"]', f"FF{i} --> FR{i}", f"FR{i} --> FX{i}((End))"]
            prev, edge = f"F{i}", "|no|"
    lines += ['OK["Return 200"]', f"{prev} -->{edge} OK", "OK --> Z((End))"]
    return lines


ENDPOINTS.append(ep(
    "GET", "/api/demo/panel", "Read the demo panel", PANEL_PERMISSION,
    "Returns what the panel needs: the action catalogue, the options the actions need, the playback state and "
    "whether a reseed is possible now. A 200 also tells the page that the typed password is right. No account "
    "and no policy: the panel password guards every panel route (D-110 rule 1).",
    "D-110, REQ-PNL-01, REQ-PNL-02, REQ-PNL-06, REQ-PNL-10, REQ-PNL-11",
    pre_validation_auth=PANEL_AUTH,
    response={"writable": True,
              "reset": {"available": False, "reason": "The demo reseed is off on this deployment.", "nextAllowedAt": None},
              "actions": [{"id": "incident-acknowledge", "group": "Incidents", "label": "Acknowledge",
                           "needs": ["recordId", "expectedVersion"]}],
              "options": {"incidents": [], "contracts": [], "invoices": [], "devices": [], "organizations": [],
                          "variants": [], "flows": ["MF-01a", "MF-01b", "MF-01c", "MF-02", "MF-03", "MF-04", "MF-05"]},
              "playback": PANEL_PLAYBACK},
    fields=[["writable", "The database accepts panel writes: local, `treklink_prod` or the `DEMO_DATABASE_HOST` branch (REQ-PNL-13)", "boolean", "`true`"],
            ["reset.available", "Every reseed check that needs no input passes now (REQ-PNL-12)", "boolean", "`false`"],
            ["reset.reason", "The first failing check, or null", "string", "see sample"],
            ["actions[].needs", "Body fields the action requires", "array", "see sample"],
            ["options.incidents", "Open, resolved and false-alarm incidents with code, state, version, device", "array", "`[]`"],
            ["options.contracts", "Contracts that an action can move, with code, status and version", "array", "`[]`"],
            ["options.invoices", "Invoices with an amount due; `dueVnd` is a decimal string", "array", "`[]`"],
            ["playback", "The playback run of REQ-PNL-08, `status` IDLE when none ran", "object", "see sample"]],
    errors=PANEL_GUARD,
    steps=["Check the failure limit and the password", "Read options through exported services",
           "Read the playback state", "Evaluate the reseed checks"],
    activity=panel_activity([], ["Read options through exported services", "Read the playback state",
                                 "Evaluate the reseed checks that need no input"]),
    controller="DemoPanelController", service="DemoPanelService", call="overview()"))

ENDPOINTS.append(ep(
    "POST", "/api/demo/panel/actions/:action", "Run a demo panel action", PANEL_PERMISSION,
    "Runs one simulator or live data action through the owning module's exported service, acting as the "
    "account whose real screen the step stands for, under the same state machine, version, membership and "
    "payment rules as the real screens. Writes one `demo.panel.<action>` audit entry with `actorId` null and "
    "`actorRoles` `['DEMO_PANEL']`. A failed action answers the owning error with its committed links.",
    "D-110 rule 3, REQ-PNL-03, REQ-PNL-04, REQ-PNL-07, REQ-PNL-13, REQ-PNL-14",
    pre_validation_auth=PANEL_AUTH,
    path=[["action", "incident-sos, incident-acknowledge, incident-respond, incident-resolve, incident-false-alarm, "
                     "incident-close, contract-create, contract-approve, contract-handover, contract-return, "
                     "contract-close, contract-cancel, invoice-pay, device-maintenance-open, "
                     "device-maintenance-complete", "string", "`incident-acknowledge`"]],
    body=[["recordId", "Incident, contract or invoice the action moves", "uuid", "conditional", "`7a6b5c4d-...`"],
          ["expectedVersion", "The record's `version` as read", "int", "conditional", "`3`"],
          ["deviceId", "Device for `incident-sos` and the maintenance actions", "uuid", "conditional", "`0d3f6a2b-...`"],
          ["organizationId", "Organization for `contract-create`; default ORG-0001", "uuid", "no", "`5b1d2c0e-...`"],
          ["hardwareVariantId", "Variant for `contract-create`; default `treklink-v3`", "uuid", "no", "`a1b2c3d4-...`"],
          ["quantity", "Units for `contract-create`; default `rentals.minOrderQuantity`", "int", "no", "`5`"]],
    sample={"recordId": "7a6b5c4d-3e2f-4a1b-8c9d-0e1f2a3b4c5d", "expectedVersion": 3},
    response=PANEL_RESULT, message="Demo panel action completed", entity="Action",
    fields=[["actedAs", "The seeded or live account the services acted as, null for a packet or time control", "object", "see sample"],
            ["records", "Links to the real screens", "array", "see sample"]],
    errors=PANEL_GUARD + [PANEL_DB, STALE,
                          (409, "DEMO_BUSY", "A reseed is running",
                           "The demo data is being reseeded. Try again when the reseed finishes."),
                          (409, "INVALID_STATE_TRANSITION", "The record's state does not allow the action",
                           "This cannot be done while it is RESOLVED.")],
    activity=panel_activity(
        [("Body fails validation", 400, "VALIDATION_FAILED"),
         ("Action not in the catalogue", 400, "VALIDATION_FAILED"),
         ("A reseed is running", 409, "DEMO_BUSY"),
         ("A field the action needs is missing", 400, "VALIDATION_FAILED"),
         ("Database neither local, staging nor the demo branch", 403, "DEMO_DATABASE_NOT_ALLOWED")],
        ["Allocate a demo run, count the action in flight",
         "Call the owning exported service as the acting account",
         "Save the run links, emit audit demo.panel.action"],
        failure=(1, "The service refused or failed",
                 "Save the run with the error, emit audit demo.panel.action with the error",
                 "Return the owning status and code with the committed records")),
    steps=["Check the failure limit and the password", "Check the database", "Allocate a demo run",
           "Call the owning exported service as the acting account", "Save the run links, emit audit demo.panel.<action>"],
    controller="DemoPanelController", service="DemoPanelService", call="run(action, dto, client)",
    seq=["Svc->>DB: INSERT demo_scenario_runs", "Svc->>Svc: owning service call", "Svc-)Svc: emit audit.record"]))

ENDPOINTS.append(ep(
    "POST", "/api/demo/panel/playback", "Control the main flow playback", PANEL_PERMISSION,
    "Starts, pauses, resumes, steps or stops the scripted playback of one main flow. Steps come from "
    "`docs/demo/2026-11-22-scenario-playbook.md`; each executed step is one panel action (route 14) or a "
    "narration line. One playback runs at a time, held in the backend's memory. The panel never acts as an Admin "
    "(D-110 clarification, 2026-11-25): at the MF-01a approval the run pauses with a waiting step and the prompt "
    "\"Approve ORG-.... on the Admin screen\", and runs on once the organization is Active or the operator "
    "presses RESUME or STEP.",
    "D-110 rule 3, REQ-PNL-08",
    pre_validation_auth=PANEL_AUTH,
    body=[["command", "`START`, `PAUSE`, `RESUME`, `STEP` or `STOP`", "string", "yes", "`START`"],
          ["flow", "`MF-01a`, `MF-01b`, `MF-01c`, `MF-02`, `MF-03`, `MF-04` or `MF-05`; with `START` only", "string", "conditional", "`MF-03`"],
          ["intervalSeconds", "Seconds between steps, 3 to 60; default 10; with `START` only", "int", "no", "`10`"]],
    sample={"command": "START", "flow": "MF-03", "intervalSeconds": 10},
    response=PANEL_PLAYBACK, message="Playback updated", entity="Playback",
    fields=[["steps[].status", "`PENDING`, `RUNNING`, `WAITING` (a person does the step on a real screen), `DONE` or `FAILED`",
             "string", "`PENDING`"],
            ["steps[].prompt", "What to do on the real screen while the step is `WAITING`, otherwise null", "string",
             "`Approve ORG-0002 on the Admin screen ...`"]],
    errors=PANEL_GUARD + [PANEL_DB,
                          (409, "DEMO_BUSY", "`START` while a playback runs or a reseed is running",
                           "A demo action is already running. Try again in a moment."),
                          (409, "INVALID_STATE_TRANSITION", "`PAUSE`, `RESUME`, `STEP` or `STOP` in a state that does not allow it",
                           "This cannot be done while it is DONE.")],
    steps=["Check the failure limit and the password", "Apply the command to the in-memory run",
           "Schedule or clear the next step"],
    activity=panel_activity(
        [("Body fails validation", 400, "VALIDATION_FAILED"),
         ("START while a reseed or a playback runs", 409, "DEMO_BUSY"),
         ("START with an unknown flow or an interval outside 3 to 60", 400, "VALIDATION_FAILED"),
         ("PAUSE, RESUME, STEP or STOP in a state that does not allow it", 409, "INVALID_STATE_TRANSITION"),
         ("RESUME or STEP while a step is executing", 409, "DEMO_BUSY")],
        ["Apply the command to the in-memory run; RESUME or STEP at a waiting step confirms it",
         "Schedule, run or clear the next step; a waiting step pauses and polls until its record is ready"]),
    controller="DemoPanelController", service="DemoPanelPlayback", call="command(dto, client)"))

ENDPOINTS.append(ep(
    "POST", "/api/demo/panel/reset", "Reseed the demo database", PANEL_PERMISSION,
    "Wipes the demo data and loads the standard demo seed, only on the dedicated Neon demo branch named by "
    "`DEMO_DATABASE_HOST` with `DEMO_RESET_ENABLED` on, the typed confirmation `RESET DEMO DATA`, and no reseed "
    "in the last five minutes. Data only: no migration and no schema statement. The audit entry "
    "`demo.panel.reset` is written after the seed, so it is kept after the wipe. Every window must sign in again.",
    "D-110 rule 4, REQ-PNL-09, REQ-PNL-12",
    pre_validation_auth=PANEL_AUTH,
    body=[["confirmation", "Exactly `RESET DEMO DATA`", "string", "yes", "`RESET DEMO DATA`"]],
    sample={"confirmation": "RESET DEMO DATA"},
    response={"resetAt": NOW, "tables": 61, "seedGroups": 24}, message="Demo data reseeded", entity="Database",
    fields=[["tables", "Tables whose rows were deleted", "int", "`61`"],
            ["seedGroups", "Row groups the demo seed created", "int", "`24`"]],
    errors=PANEL_GUARD + [
        (403, "DEMO_DISABLED", "`DEMO_RESET_ENABLED` is not `true`", "The demo reseed is off on this deployment."),
        (403, "DEMO_DATABASE_NOT_ALLOWED", "The database host is not exactly `DEMO_DATABASE_HOST`, a URL carries a target override, "
         "or the URL Prisma reads or the live `current_database()` is not the demo branch (checked before the lock)",
         "The reseed runs only on the dedicated demo database."),
        (400, "VALIDATION_FAILED", "The confirmation is not `RESET DEMO DATA`", "Type RESET DEMO DATA to confirm."),
        (429, "RATE_LIMITED", "A reseed ran less than five minutes ago", "A reseed ran at 10:20. Try again after 10:25."),
        (409, "DEMO_BUSY", "Another reseed or a playback is running", "A demo action is already running. Try again in a moment."),
        (409, "DEMO_SEED_NOT_CONFIGURED", "A `SEED_*_PASSWORD` is missing or the seed is not in this build",
         "The demo seed is not in this build."),
        (500, "INTERNAL_ERROR", "The wipe or the seed failed after the lock was taken; the audit entry names the error",
         "Internal server error")],
    steps=["Check the failure limit and the password", "Check the flag, the host, the confirmation, the spacing, the lock and the seed",
           "Wipe the data in one transaction (no DDL)", "Run the demo seed", "Emit audit.record demo.panel.reset"],
    activity=panel_activity(
        [("Body fails validation", 400, "VALIDATION_FAILED"),
         ("DEMO_RESET_ENABLED is not true", 403, "DEMO_DISABLED"),
         ("Database host is not exactly DEMO_DATABASE_HOST, or a URL carries a target override", 403,
          "DEMO_DATABASE_NOT_ALLOWED"),
         ("Confirmation is not RESET DEMO DATA", 400, "VALIDATION_FAILED"),
         ("A reseed ran less than five minutes ago", 429, "RATE_LIMITED"),
         ("A reseed, a playback or a panel action is running", 409, "DEMO_BUSY"),
         ("Seed not in this build or a SEED password unset", 409, "DEMO_SEED_NOT_CONFIGURED"),
         ("The URL Prisma reads, or current_database(), is not the demo branch", 403,
          "DEMO_DATABASE_NOT_ALLOWED")],
        ["Take the panel lock and start the five-minute spacing: panel actions now answer 409",
         "Wipe the data in one transaction, no DDL, then run the demo seed",
         "finally: emit audit demo.panel.reset, release the lock"],
        failure=(1, "The wipe or the seed failed",
                 "finally: emit audit demo.panel.reset with the error, release the lock",
                 "Return 500 INTERNAL_ERROR, or the mapped error")),
    controller="DemoPanelController", service="DemoPanelResetService", call="reset(dto, client)",
    seq=["Svc->>DB: BEGIN, UPDATE business_parameters, TRUNCATE ... RESTART IDENTITY, DELETE FROM users, COMMIT",
         "Svc->>DB: seedDemo (own transaction)", "Svc-)Svc: emit audit.record"]))
