from ._common import USER_ID, CONTRACT_ID, NOW, STALE, ep

NOTES = ("The module is loaded only when `DEMO_CONTROLS_ENABLED` is `true`; otherwise routes 01 to 04 "
         "answer 404 (specs/demo/requirements.md REQ-UBI-01). The `POST` routes refuse a production "
         "process and a database that is not on a loopback host before anything else (design §2). Route 05, "
         "the public test accounts list, is the exception: it has its own flag, `DEMO_TEST_ACCOUNTS_ENABLED`, "
         "and no other guard (D-089). Routes 06 to 10, the field simulation, belong to `DemoSimulationModule`, loaded "
         "only when `DEMO_SIMULATION_ENABLED` is `true`; their writes need a database on a loopback host or named "
         "`treklink_prod` and are not refused in production (design §9, D-094).")

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
    response={"enabled": True, "databaseLocal": True,
              "lastStaged": {"scenarioId": "clean", "at": NOW}},
    fields=[["enabled", "False when `NODE_ENV` is production", "boolean", "`true`"],
            ["databaseLocal", "The host of `DATABASE_URL` is loopback", "boolean", "`true`"],
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
# to DemoSimulationModule, loaded only when DEMO_SIMULATION_ENABLED is true.
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
            "trailId": "ta-nang-phan-dung", "pattern": "WALK", "speedMetresPerMinute": 60, "status": "RUNNING",
            "sosKind": None, "sosSince": None, "position": {"lat": 11.497591, "lon": 108.568646},
            "batteryPct": 99, "lastPacketAt": NOW, "simulated": True, "version": 0, "createdAt": NOW,
            "updatedAt": NOW}
SIM_NODE_FIELDS = [
    ["nodeId", "Mesh node id the packets carry, `!` and eight hex digits of `nodeNum`", "string", "`!de00000a`"],
    ["organization", "Organization holding the device now, or null when it is not handed over", "object", "see sample"],
    ["position", "Position the pattern gives at the time of the read (the stop time for a `STOPPED` node)", "object", "see sample"],
    ["batteryPct", "Battery the pattern gives at the same time, 5 to 100", "int", "`99`"],
    ["lastPacketAt", "Last time the device was heard (device projection `lastSeenAt`), or null", "datetime", f"`{NOW}`"],
    ["sosKind", "`SOS` or `FALL` while an SOS is active, otherwise null", "string", "`null`"],
    ["version", "Compare-and-set version for 08 and 09", "int", "`0`"]]

ENDPOINTS.append(ep(
    "GET", "/api/demo/simulation", "Read the field simulation", SIM_PERMISSION,
    "Lists what the field simulation panel needs: the trails (OpenStreetMap, © OpenStreetMap contributors, ODbL), "
    "the patterns, the devices that can be simulated and the simulated nodes, running ones first, then the twenty "
    "most recently stopped. `databaseAllowed` tells the screen whether the writes 07 to 10 can act on this database. "
    "The route belongs to `DemoSimulationModule`, loaded only when `DEMO_SIMULATION_ENABLED` is `true`; it is "
    "independent of `DEMO_CONTROLS_ENABLED` and is not refused in production, because the Vercel staging runs as "
    "production (D-094).",
    "D-093 amendment, D-094, REQ-SIM-01, REQ-SIM-08",
    response={"databaseAllowed": True,
              "trails": [{"id": "ta-nang-phan-dung", "name": "Ta Nang to Phan Dung", "region": "Lam Dong",
                          "lengthMetres": 7200, "pointCount": 63,
                          "source": {"osmWayIds": [1164619760], "readOn": "2026-11-01",
                                     "simplification": "Douglas-Peucker, 10 m, 189 to 63 points"}}],
              "patterns": ["WALK", "STOP", "STRAY", "SILENT", "LOW_BATTERY"],
              "devices": [{"id": "0d3f6a2b-7e11-4c55-8f0a-2b1c9e7d4a10", "assetTag": "TL-0010", "nodeId": "!de00000a",
                           "status": "RENTED", "organization": SIM_NODE["organization"], "runningNodeId": SIM_NODE_ID}],
              "nodes": [SIM_NODE]},
    fields=[["databaseAllowed", "The database is on a loopback host or named `treklink_prod` (REQ-SIM-02)", "boolean", "`true`"],
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
    "runs as at most one node at a time.",
    "D-093 amendment, REQ-SIM-02, REQ-SIM-03, REQ-SIM-04, REQ-SIM-07",
    body=[["deviceId", "Device to simulate", "uuid", "yes", "`0d3f6a2b-...`"],
          ["trailId", "Id of a trail of 06", "string", "yes", "`ta-nang-phan-dung`"],
          ["pattern", "`WALK`, `STOP`, `STRAY`, `SILENT` or `LOW_BATTERY`", "string", "yes", "`WALK`"],
          ["speedMetresPerMinute", "Walking speed, 10 to 300; default 60", "int", "no", "`60`"],
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
    "Changes the pattern, the trail or the speed of a running node. The node is re-anchored where it is now, so the "
    "move continues from there; a new trail starts at its first point. An active SOS stays active.",
    "D-093 amendment, REQ-SIM-02, REQ-SIM-04, REQ-SIM-07",
    path=[["id", "Simulated node id", "uuid", f"`{SIM_NODE_ID}`"]],
    body=[["expectedVersion", "The node's `version` as read", "int", "yes", "`0`"],
          ["pattern", "New pattern", "string", "no", "`STRAY`"],
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
