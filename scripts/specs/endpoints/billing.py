from ._common import (USER_ID, ORG_ID, DEVICE_ID, VARIANT_ID, CONTRACT_ID, INVOICE_ID, NOW, ep, paged, PAGE_QUERY,
                      state_409)

INVOICE = {"id": INVOICE_ID, "number": "INV-2026-000123", "organizationId": ORG_ID,
           "contract": {"id": CONTRACT_ID, "code": "RC-2026-0042"}, "kind": "TERM", "term": {"seq": 1},
           "status": "PARTIALLY_PAID", "totalVnd": 4500000, "paidVnd": 2250000, "issuedAt": NOW,
           "lines": [{"seq": 1, "type": "HOLDING_FEE", "description": "Term 1 holding fee, 10 x treklink-v3",
                      "quantity": 10, "unitVnd": 225000, "amountVnd": 2250000, "dueAt": "2026-10-25T02:00:00Z",
                      "paidVnd": 2250000},
                     {"seq": 2, "type": "TERM_BALANCE", "description": "Term 1 balance, 10 x treklink-v3",
                      "quantity": 10, "unitVnd": 225000, "amountVnd": 2250000, "dueAt": "2026-11-25T02:00:00Z",
                      "paidVnd": 0}]}
PAYMENT = {"id": "p-1", "reference": "TL7K2Q9M4D", "invoiceId": INVOICE_ID, "contractId": CONTRACT_ID,
           "amountVnd": 2250000, "method": "SEPAY", "status": "PENDING", "isSandbox": True,
           "expiresAt": "2026-10-20T03:45:00Z", "confirmedAt": None}
INV_PATH = ["id", "Invoice id; members may use only their own", "uuid", f"`{INVOICE_ID}`"]

ENDPOINTS = [
    ep("GET", "/api/plans", "Public plan catalogue", "Public",
       "What the website sells: every active hardware variant with its current monthly price per device, "
       "the day-plan lengths and premium, the holding-fee ratio and the minimum order quantity. All values "
       "come from configuration (BR-29).",
       "UC-56, FR-BILL-01, FR-BILL-02, BR-02, BR-29",
       response={"minOrderQuantity": 5, "holdingFeeRatio": 0.5, "dayPlanLengths": [3, 4, 7], "dayPremium": 1.5,
                 "variants": [{"id": VARIANT_ID, "code": "treklink-v3", "name": "TrekLink v3 (GPS, SOS button)",
                               "monthlyPriceVnd": 450000, "dayPriceVnd": 22500}],
                 "sandbox": True},
       steps=["Read current price per active variant", "Read plan parameters"],
       controller="PlansController", service="PricingService", call="catalogue()",
       seq=["Svc->>DB: SELECT DISTINCT ON (variant) price_schedules ORDER BY effectiveFrom DESC"]),

    ep("POST", "/api/quotes", "Quote a plan", "Org Manager: own; TrekLink Staff",
       "Prices a prospective contract before it is requested: first payment, term fee or day-plan total "
       "(FR-BILL-01, FR-BILL-02). Nothing is stored.",
       "UC-15, FR-BILL-01, FR-BILL-02, BR-06, BR-07",
       body=[["planType", "`MONTHLY` or `DAY`", "enum", "yes", "`DAY`"], ["dayPlanDays", "DAY only", "int", "cond.", "`4`"],
             ["hardwareVariantId", "Variant", "uuid", "yes", f"`{VARIANT_ID}`"], ["quantity", "Devices", "int", "yes", "`8`"]],
       sample={"planType": "DAY", "dayPlanDays": 4, "hardwareVariantId": VARIANT_ID, "quantity": 8},
       response={"planType": "DAY", "quantity": 8, "unitPerDayVnd": 22500, "days": 4, "totalVnd": 720000,
                 "firstPaymentVnd": 720000, "formula": "450000 / 30 x 1.5 x 4 x 8"},
       errors=[(400, "BELOW_MOQ", "Quantity below the minimum order quantity", "The minimum order is 5 devices.")],
       steps=["Read the current price and plan parameters", "Compute in integer VND, rounding up per line"],
       controller="QuotesController", service="PricingService", call="quote(dto)", seq=["Svc->>DB: SELECT current price"]),

    ep("GET", "/api/price-schedules", "Price history", "TrekLink Admin",
       "Lists the append-only monthly price schedule per variant, current and future rows included.",
       "UC-56, FR-CFG-02", query=[["hardwareVariantId", "Variant", "uuid", "no", f"`{VARIANT_ID}`"]] + PAGE_QUERY,
       response=paged({"id": "ps-1", "hardwareVariantId": VARIANT_ID, "monthlyPriceVnd": 450000,
                       "effectiveFrom": "2026-10-01T00:00:00Z", "createdBy": "TrekLink Admin", "createdAt": NOW}),
       steps=["Read price_schedules"], controller="PriceSchedulesController", service="PricingService",
       call="history(query)", seq=["Svc->>DB: SELECT price_schedules"]),

    ep("POST", "/api/price-schedules", "Set a monthly price", "TrekLink Admin",
       "Adds a monthly price per device for a variant, effective from a time not in the past. Contracts "
       "already requested keep their snapshot (FR-CFG-02).", "UC-56, FR-CFG-01, FR-CFG-02",
       body=[["hardwareVariantId", "Variant", "uuid", "yes", f"`{VARIANT_ID}`"],
             ["monthlyPriceVnd", "Positive integer VND", "int", "yes", "`480000`"],
             ["effectiveFrom", "Now or later", "datetime", "yes", "`2026-11-01T00:00:00Z`"]],
       sample={"hardwareVariantId": VARIANT_ID, "monthlyPriceVnd": 480000, "effectiveFrom": "2026-11-01T00:00:00Z"},
       response={"id": "ps-2", "hardwareVariantId": VARIANT_ID, "monthlyPriceVnd": 480000,
                 "effectiveFrom": "2026-11-01T00:00:00Z"}, status=201, message="Price scheduled",
       errors=[(400, "EFFECTIVE_IN_PAST", "effectiveFrom is in the past", "effectiveFrom must not be in the past.")],
       steps=["Validate", "Insert the row (append-only)", "Emit audit.record price.set"],
       controller="PriceSchedulesController", service="PricingService", call="set(dto, actor)",
       seq=["Svc->>DB: INSERT price_schedules"]),

    ep("GET", "/api/damage-rates", "Damage schedule", "TrekLink Staff, TrekLink Admin",
       "Lists the damage codes with their amount, generic or per variant (FR-BILL-04).", "UC-47, FR-BILL-04",
       query=[["hardwareVariantId", "Variant; generic rows always included", "uuid", "no", f"`{VARIANT_ID}`"]],
       response=[{"id": "dr-1", "code": "ANTENNA_BROKEN", "label": "Antenna broken", "hardwareVariantId": None,
                  "amountVnd": 300000, "isActive": True}],
       steps=["Read damage_rates"], controller="DamageRatesController", service="DamageScheduleService",
       call="list(query)", seq=["Svc->>DB: SELECT damage_rates"]),

    ep("POST", "/api/damage-rates", "Add a damage rate", "TrekLink Admin",
       "Adds a damage code and amount, generic or for one variant.", "UC-56, FR-BILL-04",
       body=[["code", "UPPER_SNAKE code", "string", "yes", "`CASING_CRACKED`"], ["label", "Display label", "string", "yes", "`Casing cracked`"],
             ["hardwareVariantId", "Null for every variant", "uuid", "no", "`null`"], ["amountVnd", "Positive VND", "int", "yes", "`400000`"]],
       sample={"code": "CASING_CRACKED", "label": "Casing cracked", "hardwareVariantId": None, "amountVnd": 400000},
       response={"id": "dr-2", "code": "CASING_CRACKED", "amountVnd": 400000, "isActive": True}, status=201, message="Saved.",
       errors=[(409, "CONFLICT_UNIQUE", "The code exists for that variant scope", "CASING_CRACKED is already registered.")],
       steps=["Insert"], controller="DamageRatesController", service="DamageScheduleService", call="create(dto, actor)",
       seq=["Svc->>DB: INSERT damage_rates"]),

    ep("PATCH", "/api/damage-rates/:id", "Edit a damage rate", "TrekLink Admin",
       "Changes the label, amount or active flag. Charges already created keep their amount.", "UC-56, FR-BILL-04",
       path=[["id", "Damage rate id", "uuid", "`dr-1`"]],
       body=[["label", "Label", "string", "no", "`...`"], ["amountVnd", "VND", "int", "no", "`350000`"], ["isActive", "Active", "bool", "no", "`false`"]],
       sample={"amountVnd": 350000}, response={"id": "dr-1", "code": "ANTENNA_BROKEN", "amountVnd": 350000}, message="Saved.",
       entity="Damage rate", steps=["Update", "Emit audit.record damageRate.update"],
       controller="DamageRatesController", service="DamageScheduleService", call="update(id, dto, actor)",
       seq=["Svc->>DB: UPDATE damage_rates"]),

    ep("GET", "/api/invoices", "List invoices", "Org Manager: own; TrekLink Staff, TrekLink Admin",
       "Lists invoices with their status and amounts; members see only their organization's (FR-AUTH-11).",
       "UC-55, FR-AUTH-11, FR-BILL-06",
       query=[["contractId", "Contract", "uuid", "no", f"`{CONTRACT_ID}`"], ["status", "InvoiceStatus", "enum", "no", "`ISSUED`"],
              ["overdue", "Only invoices with a line past due", "bool", "no", "`true`"]] + PAGE_QUERY,
       response=paged({k: INVOICE[k] for k in INVOICE if k != "lines"}, 2), steps=["Apply scope", "Read invoices"],
       controller="InvoicesController", service="InvoicesService", call="list(query, caller)",
       seq=["Svc->>DB: SELECT invoices WHERE scope"]),

    ep("GET", "/api/invoices/:id", "Invoice detail", "Org Manager: own; TrekLink Staff, TrekLink Admin",
       "Returns the immutable, itemized invoice with its dated lines and payments.", "UC-45, UC-55, FR-BILL-06",
       path=[INV_PATH], response={**INVOICE, "payments": [{**PAYMENT, "status": "CONFIRMED", "confirmedAt": NOW}]},
       entity="Invoice", steps=["Read within scope"], controller="InvoicesController", service="InvoicesService",
       call="get(id, caller)", seq=["Svc->>DB: SELECT invoice, lines, payments"]),

    ep("GET", "/api/contracts/:id/balance", "Contract balance", "Org Manager: own; TrekLink Staff, TrekLink Admin",
       "Sums every invoice line of the contract into due now, due later and paid, and lists damage charges "
       "awaiting approval (UC-45). The closing check uses the same calculation (FR-CON-13).",
       "UC-45, FR-BILL-06, FR-CON-13",
       path=[["id", "Contract id", "uuid", f"`{CONTRACT_ID}`"]],
       response={"contractId": CONTRACT_ID, "dueNowVnd": 0, "dueLaterVnd": 2250000, "paidVnd": 2250000,
                 "pendingDamageCharges": [], "settled": False},
       entity="Contract", steps=["Sum lines by dueAt", "List pending damage charges"],
       controller="BalancesController", service="BalanceService", call="forContract(id, caller)",
       seq=["Svc->>DB: SELECT invoice_lines, damage_charges"]),

    ep("POST", "/api/invoices/:id/payments/sepay", "Pay online with SePay", "Org Manager: own",
       "Creates a SePay payment request in the sandbox for the amount due now on the invoice (or a chosen "
       "line), with a unique reference, and returns its VietQR. The payment is recorded only when SePay's "
       "webhook confirms it (FR-BILL-07, BR-34, NFR-UI-03).",
       "UC-19, FR-BILL-07, FR-BILL-09, BR-34, MSG25",
       path=[INV_PATH], body=[["lineSeq", "Pay one line; default every line due now", "int", "no", "`1`"]],
       sample={"lineSeq": 2},
       response={**PAYMENT, "vietQr": {"imageUrl": "https://qr.sepay.vn/img?acc=...&amount=2250000&des=TL7K2Q9M4D",
                                       "bankAccount": "SANDBOX-0001", "content": "TL7K2Q9M4D"}},
       status=201, message="Scan the QR code to pay (sandbox).", entity="Invoice",
       errors=[(409, "NOTHING_DUE", "No unpaid amount on the invoice or line", "This invoice has nothing to pay."),
               (409, "PAYMENT_PENDING", "A pending SePay payment for this invoice has not expired",
                "A payment for this invoice is already waiting. Use its QR code.")],
       steps=["Compute the amount due", "Insert payment PENDING with a fresh reference and expiry",
              "Build the VietQR from configuration (sandbox account)"],
       controller="PaymentsController", service="SepayService", call="createRequest(invoiceId, dto, caller)",
       seq=["Svc->>DB: INSERT payments (PENDING)", "Svc->>Svc: build VietQR URL"]),

    ep("POST", "/api/payments/sepay/webhook", "SePay confirmation webhook", "Public (SePay API key header)",
       "Receives SePay's transaction notification. Authenticated by the `Authorization: Apikey ...` header "
       "and matched to a reference the system issued (NFR-SEC-07). A repeated transaction id or reference "
       "records nothing and logs the duplicate (FR-BILL-08, BR-31, E01-6). The amount is applied to the "
       "invoice lines oldest due first, in one transaction.",
       "UC-19, FR-BILL-07, FR-BILL-08, BR-31, NFR-SEC-07, E01-6",
       body=[["id", "SePay transaction id", "int", "yes", "`92704`"],
             ["transferAmount", "Amount received", "int", "yes", "`2250000`"],
             ["content", "Transfer content; holds the reference", "string", "yes", "`TL7K2Q9M4D`"],
             ["transferType", "`in`", "string", "yes", "`in`"], ["transactionDate", "SePay time", "string", "yes", "`2026-10-20 10:20:31`"]],
       sample={"id": 92704, "gateway": "Sandbox", "transactionDate": "2026-10-20 10:20:31", "accountNumber": "SANDBOX-0001",
               "subAccount": None, "code": None, "content": "TL7K2Q9M4D", "transferType": "in",
               "description": "TL7K2Q9M4D", "transferAmount": 2250000, "accumulated": 2250000,
               "referenceCode": "FT26293...."},
       response={"success": True}, message="OK",
       notes=("Verified against https://docs.sepay.vn/tich-hop-webhooks.html (2026-10-04): SePay sends "
              "`Authorization: Apikey <key>`, posts id, gateway, transactionDate, accountNumber, subAccount, code, "
              "content, transferType, description, transferAmount, accumulated, referenceCode; it expects HTTP 200 "
              "or 201 with the body `{\"success\": true}` within 30 s and otherwise retries up to 7 times over 5 hours. "
              "OPEN (D-038 pending): whether this endpoint answers the bare body, an exception to D-002, or the "
              "envelope shown here."),
       errors=[(401, "WEBHOOK_UNAUTHENTICATED", "Missing or wrong SePay API key", "Authentication required."),
               (200, "UNMATCHED", "No issued reference in the content: logged for Staff, not recorded", "OK")],
       steps=["Verify the API key in constant time", "Extract the reference", "Lock the payment by reference",
              "If already CONFIRMED or the txn id is known: log duplicate, return 200",
              "Confirm the payment, apply to lines, update invoice status", "Emit payment.confirmed"],
       controller="SepayWebhookController", service="SepayService", call="handleWebhook(body, headers)",
       actor="SePay",
       seq=["Svc->>DB: BEGIN, SELECT payment WHERE reference FOR UPDATE",
            "Svc->>DB: UPDATE payment CONFIRMED, invoice_lines.paidVnd, invoices, COMMIT", "Svc-)Svc: emit payment.confirmed"]),

    ep("POST", "/api/invoices/:id/payments/counter", "Record a counter payment", "TrekLink Staff, TrekLink Admin",
       "Records cash or bank transfer received at the counter with the receipt number as reference; a "
       "repeated receipt number records nothing (FR-BILL-08). Payments made in the sandbox stay labelled as such.",
       "UC-22, FR-BILL-08, BR-31, MSG20",
       path=[INV_PATH],
       body=[["method", "`CASH` or `BANK_TRANSFER`", "enum", "yes", "`CASH`"],
             ["amountVnd", "Amount received, at most the amount due", "int", "yes", "`2250000`"],
             ["reference", "Receipt number or bank reference", "string", "yes", "`RCPT-2026-0193`"]],
       sample={"method": "CASH", "amountVnd": 2250000, "reference": "RCPT-2026-0193"},
       response={**PAYMENT, "method": "CASH", "reference": "RCPT-2026-0193", "status": "CONFIRMED", "isSandbox": False,
                 "confirmedAt": NOW}, status=201, message="Payment of 2,250,000 VND received.", entity="Invoice",
       errors=[(409, "DUPLICATE_REFERENCE", "The reference is already recorded (logged no-op)",
                "RCPT-2026-0193 is already registered."),
               (400, "OVERPAYMENT", "Amount exceeds the amount still due", "amountVnd must be between 1 and 2250000.")],
       steps=["Lock the invoice", "Insert payment CONFIRMED", "Apply to lines oldest due first", "Emit payment.confirmed"],
       controller="PaymentsController", service="CounterPaymentService", call="record(invoiceId, dto, actor)",
       seq=["Svc->>DB: BEGIN, SELECT invoice FOR UPDATE", "Svc->>DB: INSERT payments, UPDATE lines, invoice, COMMIT"]),

    ep("GET", "/api/payments", "List payments", "Org Manager: own; TrekLink Staff, TrekLink Admin",
       "Lists payments with status, method and sandbox flag.", "UC-55, FR-BILL-07, NFR-UI-03",
       query=[["contractId", "Contract", "uuid", "no", f"`{CONTRACT_ID}`"], ["status", "PaymentStatus", "enum", "no", "`PENDING`"]] + PAGE_QUERY,
       response=paged(PAYMENT), steps=["Apply scope", "Read payments"], controller="PaymentsController",
       service="PaymentsService", call="list(query, caller)", seq=["Svc->>DB: SELECT payments WHERE scope"]),

    ep("GET", "/api/payments/:id", "Payment status", "Org Manager: own; TrekLink Staff, TrekLink Admin",
       "Returns one payment; the payment page polls it while the QR is shown. A `PENDING` payment past its "
       "expiry is reported `EXPIRED` and the amount stays due (FR-BILL-09).", "UC-19, FR-BILL-09, E05-4",
       path=[["id", "Payment id", "uuid", "`p-1`"]], response={**PAYMENT, "status": "CONFIRMED", "confirmedAt": NOW},
       entity="Payment", steps=["Read within scope", "Expire a stale PENDING row lazily"],
       controller="PaymentsController", service="PaymentsService", call="get(id, caller)",
       seq=["Svc->>DB: SELECT payment; UPDATE EXPIRED if past expiresAt"]),

    ep("GET", "/api/damage-charges", "Damage charges", "TrekLink Staff, TrekLink Admin",
       "Lists damage charges; Admins use `status=PENDING_APPROVAL` as their approval queue (BR-24).",
       "UC-47, UC-48, FR-BILL-04",
       query=[["status", "DamageChargeStatus", "enum", "no", "`PENDING_APPROVAL`"],
              ["contractId", "Contract", "uuid", "no", f"`{CONTRACT_ID}`"]] + PAGE_QUERY,
       response=paged({"id": "dc-1", "deviceId": DEVICE_ID, "assetTag": "TL-0042", "inspectionId": "in-1",
                       "inspector": {"id": USER_ID, "fullName": "Tran Thi B"}, "damageCodes": ["CASING_CRACKED", "ANTENNA_BROKEN"],
                       "amountVnd": 700000, "status": "PENDING_APPROVAL", "createdAt": NOW}),
       steps=["Read damage_charges"], controller="DamageChargesController", service="DamageChargeService",
       call="list(query)", seq=["Svc->>DB: SELECT damage_charges"]),

    ep("POST", "/api/damage-charges/:id/decision", "Decide a damage charge", "TrekLink Admin, never the inspector",
       "Approves, reduces or waives a charge above `billing.damageApprovalThresholdVnd`. The approver must "
       "not be the inspector (BR-24, E05-6, MSG30). The decided amount becomes a DAMAGE line on the closing "
       "invoice.", "UC-48, FR-BILL-04, BR-24, E05-6, MSG30",
       path=[["id", "Damage charge id", "uuid", "`dc-1`"]],
       body=[["decision", "`APPROVED`, `REDUCED` or `WAIVED`", "enum", "yes", "`REDUCED`"],
             ["finalVnd", "Required for REDUCED, below the amount", "int", "cond.", "`400000`"],
             ["note", "Reason", "string", "yes", "`Pre-existing scratch on intake photo`"]],
       sample={"decision": "REDUCED", "finalVnd": 400000, "note": "Casing crack predates the rental (intake photo)."},
       response={"id": "dc-1", "status": "REDUCED", "amountVnd": 700000, "finalVnd": 400000, "decidedAt": NOW},
       message="Decision recorded", entity="Damage charge",
       errors=[(403, "SEPARATION_OF_DUTY", "The caller recorded the inspection", "A different Admin must approve this charge."),
               state_409("damage charge", "APPROVED")],
       steps=["Require PENDING_APPROVAL", "Refuse the inspector", "Record the decision",
              "Add the DAMAGE line to the closing invoice draft"],
       controller="DamageChargesController", service="DamageChargeService", call="decide(id, dto, actor)",
       seq=["Svc->>DB: SELECT charge, inspection FOR UPDATE", "Svc->>DB: UPDATE damage_charges"]),

]

NOTES = ("Charges created by other modules have no endpoint of their own: `chargeLate` on check-in "
         "(FR-BILL-03), `chargeDamage` from an inspection (FR-BILL-04), `chargeLoss` (FR-BILL-05), and the "
         "term invoice issued by the term rollover (FR-BILL-01). See `design.md` §2.")
