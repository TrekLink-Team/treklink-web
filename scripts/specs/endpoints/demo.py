from ._common import USER_ID, CONTRACT_ID, NOW, ep

NOTES = ("The module is loaded only when `DEMO_CONTROLS_ENABLED` is `true`; otherwise routes 01 to 04 "
         "answer 404 (specs/demo/requirements.md REQ-UBI-01). The `POST` routes refuse a production "
         "process and a database that is not on a loopback host before anything else (design §2). Route 05, "
         "the public test accounts list, is the exception: it has its own flag, `DEMO_TEST_ACCOUNTS_ENABLED`, "
         "and no other guard (D-089).")

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
