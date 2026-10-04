-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "ParameterType" AS ENUM ('INT', 'DECIMAL', 'PERCENT', 'DURATION_SECONDS', 'BOOL', 'JSON');

-- CreateEnum
CREATE TYPE "AccountType" AS ENUM ('TREKLINK', 'ORGANIZATION');

-- CreateEnum
CREATE TYPE "OtpPurpose" AS ENUM ('SET_PASSWORD', 'PASSWORD_RESET');

-- CreateEnum
CREATE TYPE "AuthEventType" AS ENUM ('LOGIN_SUCCEEDED', 'LOGIN_FAILED', 'LOGOUT', 'TOKEN_REFRESHED', 'TOKEN_REUSE_DETECTED', 'PASSWORD_SET', 'PASSWORD_RESET_REQUESTED', 'PASSWORD_RESET_COMPLETED', 'ACCOUNT_LOCKED', 'ACCOUNT_DEACTIVATED', 'ACCOUNT_REACTIVATED');

-- CreateEnum
CREATE TYPE "OrganizationStatus" AS ENUM ('PENDING', 'ACTIVE', 'REJECTED', 'SUSPENDED', 'CLOSED');

-- CreateEnum
CREATE TYPE "MemberRole" AS ENUM ('MANAGER', 'OPERATOR');

-- CreateEnum
CREATE TYPE "DeviceStatus" AS ENUM ('IN_INTAKE', 'AVAILABLE', 'RESERVED', 'RENTED', 'RETURNED', 'MAINTENANCE', 'LOST', 'RETIRED');

-- CreateEnum
CREATE TYPE "MaintenanceStatus" AS ENUM ('OPEN', 'COMPLETED', 'UNREPAIRABLE');

-- CreateEnum
CREATE TYPE "InspectionResult" AS ENUM ('PASSED', 'DAMAGED', 'FAILED');

-- CreateEnum
CREATE TYPE "PlanType" AS ENUM ('MONTHLY', 'DAY');

-- CreateEnum
CREATE TYPE "ContractStatus" AS ENUM ('REQUESTED', 'APPROVED', 'REJECTED', 'CANCELLED', 'ACTIVE', 'ENDING', 'RETURN_DUE', 'OVERDUE', 'DEFAULTED', 'RETURNED', 'CLOSED');

-- CreateEnum
CREATE TYPE "TermStatus" AS ENUM ('OPEN', 'CLOSED');

-- CreateEnum
CREATE TYPE "InvoiceKind" AS ENUM ('TERM', 'DAY_PLAN', 'CLOSING');

-- CreateEnum
CREATE TYPE "InvoiceStatus" AS ENUM ('ISSUED', 'PARTIALLY_PAID', 'PAID');

-- CreateEnum
CREATE TYPE "InvoiceLineType" AS ENUM ('HOLDING_FEE', 'TERM_BALANCE', 'DAY_PLAN_FEE', 'LATE_FEE', 'DAMAGE', 'LOSS', 'ADJUSTMENT');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('SEPAY', 'CASH', 'BANK_TRANSFER');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'CONFIRMED', 'FAILED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "DamageChargeStatus" AS ENUM ('PENDING_APPROVAL', 'APPROVED', 'REDUCED', 'WAIVED');

-- CreateEnum
CREATE TYPE "IncidentState" AS ENUM ('DETECTED', 'NOTIFY_PRIMARY', 'NOTIFY_BACKUP', 'NOTIFY_MANAGER', 'UNROUTED', 'ESCALATED', 'REPORTED', 'ACKNOWLEDGED', 'RESPONDING', 'RESOLVED', 'FALSE_ALARM', 'CLOSED');

-- CreateEnum
CREATE TYPE "IncidentSource" AS ENUM ('DEVICE_SOS', 'DEVICE_FALL', 'CADENCE_INFERRED');

-- CreateEnum
CREATE TYPE "IncidentConfidence" AS ENUM ('CONFIRMED', 'SUSPECTED');

-- CreateEnum
CREATE TYPE "AlertChannel" AS ENUM ('WEB', 'WEBSOCKET', 'EMAIL', 'API_EVENT');

-- CreateEnum
CREATE TYPE "AlertStatus" AS ENUM ('PENDING', 'SENT', 'FAILED');

-- CreateEnum
CREATE TYPE "PriorityTier" AS ENUM ('P0_SOS', 'P1_LOCATION', 'P2_GPS', 'P3_TELEMETRY');

-- CreateEnum
CREATE TYPE "EventKind" AS ENUM ('SOS', 'FALL_SOS', 'POSITION', 'TELEMETRY', 'CHAT');

-- CreateEnum
CREATE TYPE "IngressPath" AS ENUM ('MQTT_NODE', 'FIELD_STATION');

-- CreateEnum
CREATE TYPE "SyncOutcome" AS ENUM ('ACCEPTED', 'DUPLICATE_REJECTED', 'MALFORMED_ENVELOPE', 'NORMALIZATION_FAILED', 'UNKNOWN_DEVICE', 'NOT_RENTED_TO_STATION_ORG', 'INVALID_POSITION', 'IMPLAUSIBLE_POSITION', 'QUEUE_REPORT');

-- CreateTable
CREATE TABLE "business_parameters" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "valueType" "ParameterType" NOT NULL,
    "bounds" JSONB,
    "unit" TEXT,
    "ownerModule" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "updatedById" TEXT,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "business_parameters_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "business_parameter_history" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "previousValue" JSONB NOT NULL,
    "newValue" JSONB NOT NULL,
    "changedById" TEXT NOT NULL,
    "reason" TEXT,
    "changedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "business_parameter_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_log" (
    "id" TEXT NOT NULL,
    "actorId" TEXT,
    "actorRoles" TEXT[],
    "organizationId" TEXT,
    "action" TEXT NOT NULL,
    "subjectType" TEXT NOT NULL,
    "subjectId" TEXT,
    "before" JSONB,
    "after" JSONB,
    "requestId" TEXT,
    "ip" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "phoneNumber" TEXT,
    "passwordHash" TEXT,
    "accountType" "AccountType" NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastLoginAt" TIMESTAMPTZ(3),
    "failedLoginCount" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMPTZ(3),
    "createdById" TEXT,
    "deletedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "roles" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "accountType" "AccountType" NOT NULL,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "permissions" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "conditions" JSONB,
    "fields" TEXT[],
    "inverted" BOOLEAN NOT NULL DEFAULT false,
    "reason" TEXT,

    CONSTRAINT "permissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_roles" (
    "userId" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "grantedById" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_roles_pkey" PRIMARY KEY ("userId","roleId")
);

-- CreateTable
CREATE TABLE "role_permissions" (
    "roleId" TEXT NOT NULL,
    "permissionId" TEXT NOT NULL,

    CONSTRAINT "role_permissions_pkey" PRIMARY KEY ("roleId","permissionId")
);

-- CreateTable
CREATE TABLE "refresh_tokens" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "familyId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "revokedAt" TIMESTAMPTZ(3),
    "replacedById" TEXT,
    "userAgent" TEXT,
    "ip" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "one_time_codes" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "purpose" "OtpPurpose" NOT NULL,
    "codeHash" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "consumedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "one_time_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auth_events" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "email" TEXT,
    "type" "AuthEventType" NOT NULL,
    "ip" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "auth_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "organizations" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "legalName" TEXT NOT NULL,
    "taxCode" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "contactEmail" TEXT NOT NULL,
    "contactPhone" TEXT NOT NULL,
    "status" "OrganizationStatus" NOT NULL DEFAULT 'PENDING',
    "statusChangedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "verifiedAt" TIMESTAMPTZ(3),
    "verifiedById" TEXT,
    "verificationMethod" TEXT,
    "documentsSeen" TEXT[],
    "masterContractRef" TEXT,
    "decidedAt" TIMESTAMPTZ(3),
    "decidedById" TEXT,
    "rejectionReason" TEXT,
    "suspensionReason" TEXT,
    "channelKeyVersion" INTEGER NOT NULL DEFAULT 1,
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "organizations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "organization_members" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "role" "MemberRole" NOT NULL,
    "invitedById" TEXT,
    "deactivatedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "organization_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "organization_transitions" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "fromStatus" "OrganizationStatus",
    "toStatus" "OrganizationStatus" NOT NULL,
    "actorId" TEXT,
    "reason" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "organization_transitions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "roster_shifts" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "startsAt" TIMESTAMPTZ(3) NOT NULL,
    "endsAt" TIMESTAMPTZ(3) NOT NULL,
    "primaryMemberId" TEXT,
    "backupMemberId" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "roster_shifts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "api_keys" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "keyHash" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "lastUsedAt" TIMESTAMPTZ(3),
    "revokedAt" TIMESTAMPTZ(3),
    "revokedById" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "api_keys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "field_stations" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "mqttUsername" TEXT NOT NULL,
    "secretHash" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "revokedAt" TIMESTAMPTZ(3),
    "revokedById" TEXT,
    "lastSyncAt" TIMESTAMPTZ(3),
    "queueDepth" INTEGER[],
    "oldestRetryCount" INTEGER,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "field_stations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hardware_variants" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "hasGps" BOOLEAN NOT NULL,
    "hasMotionSensor" BOOLEAN NOT NULL,
    "mqttCapable" BOOLEAN NOT NULL,
    "firmwareBaseline" TEXT NOT NULL,
    "remainingValueSchedule" JSONB NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "hardware_variants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "devices" (
    "id" TEXT NOT NULL,
    "assetTag" TEXT NOT NULL,
    "nodeNum" BIGINT NOT NULL,
    "hardwareVariantId" TEXT NOT NULL,
    "firmwareVersion" TEXT NOT NULL,
    "acquiredAt" TIMESTAMPTZ(3) NOT NULL,
    "status" "DeviceStatus" NOT NULL DEFAULT 'IN_INTAKE',
    "statusChangedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "keyVersion" INTEGER,
    "keyOrganizationId" TEXT,
    "provisionedAt" TIMESTAMPTZ(3),
    "lastSeenAt" TIMESTAMPTZ(3),
    "batteryPct" INTEGER,
    "lastLatitude" DOUBLE PRECISION,
    "lastLongitude" DOUBLE PRECISION,
    "registeredById" TEXT NOT NULL,
    "retiredAt" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "devices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "device_transitions" (
    "id" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "fromStatus" "DeviceStatus",
    "toStatus" "DeviceStatus" NOT NULL,
    "actorId" TEXT,
    "reason" TEXT NOT NULL,
    "note" TEXT,
    "refType" TEXT,
    "refId" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "device_transitions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "intake_checks" (
    "id" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "gpsFixOk" BOOLEAN NOT NULL,
    "radioOk" BOOLEAN NOT NULL,
    "batteryOk" BOOLEAN NOT NULL,
    "motionOk" BOOLEAN,
    "passed" BOOLEAN NOT NULL,
    "note" TEXT,
    "checkedById" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "intake_checks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "device_provisionings" (
    "id" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "keyVersion" INTEGER NOT NULL,
    "provisionedById" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "device_provisionings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "device_resets" (
    "id" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "keyRemoved" BOOLEAN NOT NULL,
    "nodeDbCleared" BOOLEAN NOT NULL,
    "ownerCleared" BOOLEAN NOT NULL,
    "resetById" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "device_resets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inspections" (
    "id" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "contractDeviceId" TEXT,
    "result" "InspectionResult" NOT NULL,
    "damageCodes" TEXT[],
    "note" TEXT,
    "inspectorId" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inspections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "maintenance_records" (
    "id" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "MaintenanceStatus" NOT NULL DEFAULT 'OPEN',
    "description" TEXT NOT NULL,
    "resolution" TEXT,
    "openedById" TEXT NOT NULL,
    "closedById" TEXT,
    "openedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMPTZ(3),

    CONSTRAINT "maintenance_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_takes" (
    "id" TEXT NOT NULL,
    "scannedTags" TEXT[],
    "result" JSONB NOT NULL,
    "takenById" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_takes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rental_contracts" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "planType" "PlanType" NOT NULL,
    "dayPlanDays" INTEGER,
    "hardwareVariantId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "requestedStartDate" DATE NOT NULL,
    "monthlyUnitPriceVnd" BIGINT NOT NULL,
    "dayPremium" DECIMAL(5,2),
    "holdingFeeRatio" DECIMAL(4,3) NOT NULL,
    "status" "ContractStatus" NOT NULL DEFAULT 'REQUESTED',
    "statusChangedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "requestedById" TEXT NOT NULL,
    "decidedById" TEXT,
    "decidedAt" TIMESTAMPTZ(3),
    "rejectionReason" TEXT,
    "reservationExpiresAt" TIMESTAMPTZ(3),
    "cancelledAt" TIMESTAMPTZ(3),
    "cancelReason" TEXT,
    "handedOverAt" TIMESTAMPTZ(3),
    "handedOverById" TEXT,
    "identityChecked" TEXT,
    "handoverNotePath" TEXT,
    "handoverNoteSha256" TEXT,
    "endsAt" TIMESTAMPTZ(3),
    "noticeGivenAt" TIMESTAMPTZ(3),
    "noticeGivenById" TEXT,
    "returnDueAt" TIMESTAMPTZ(3),
    "overdueAt" TIMESTAMPTZ(3),
    "defaultedAt" TIMESTAMPTZ(3),
    "returnedAt" TIMESTAMPTZ(3),
    "closedAt" TIMESTAMPTZ(3),
    "closedById" TEXT,
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "rental_contracts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contract_terms" (
    "id" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "startsAt" TIMESTAMPTZ(3) NOT NULL,
    "endsAt" TIMESTAMPTZ(3) NOT NULL,
    "status" "TermStatus" NOT NULL DEFAULT 'OPEN',
    "closedAt" TIMESTAMPTZ(3),

    CONSTRAINT "contract_terms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contract_devices" (
    "id" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "reservedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "releasedAt" TIMESTAMPTZ(3),
    "handedOverAt" TIMESTAMPTZ(3),
    "checkedInAt" TIMESTAMPTZ(3),
    "checkedInById" TEXT,
    "lostAt" TIMESTAMPTZ(3),
    "holderName" TEXT,
    "holderPhone" TEXT,
    "holderEmergencyContact" TEXT,

    CONSTRAINT "contract_devices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contract_transitions" (
    "id" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    "fromStatus" "ContractStatus",
    "toStatus" "ContractStatus" NOT NULL,
    "actorId" TEXT,
    "reason" TEXT,
    "refType" TEXT,
    "refId" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contract_transitions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "price_schedules" (
    "id" TEXT NOT NULL,
    "hardwareVariantId" TEXT NOT NULL,
    "monthlyPriceVnd" BIGINT NOT NULL,
    "effectiveFrom" TIMESTAMPTZ(3) NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "price_schedules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "damage_rates" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "hardwareVariantId" TEXT,
    "amountVnd" BIGINT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "damage_rates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoices" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    "termId" TEXT,
    "kind" "InvoiceKind" NOT NULL,
    "status" "InvoiceStatus" NOT NULL DEFAULT 'ISSUED',
    "totalVnd" BIGINT NOT NULL,
    "paidVnd" BIGINT NOT NULL DEFAULT 0,
    "issuedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoice_lines" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "type" "InvoiceLineType" NOT NULL,
    "description" TEXT NOT NULL,
    "deviceId" TEXT,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "unitVnd" BIGINT NOT NULL,
    "amountVnd" BIGINT NOT NULL,
    "dueAt" TIMESTAMPTZ(3) NOT NULL,
    "paidVnd" BIGINT NOT NULL DEFAULT 0,
    "createdById" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invoice_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "amountVnd" BIGINT NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "status" "PaymentStatus" NOT NULL,
    "isSandbox" BOOLEAN NOT NULL DEFAULT true,
    "gatewayTxnId" TEXT,
    "gatewayPayload" JSONB,
    "failureReason" TEXT,
    "requestedById" TEXT,
    "recordedById" TEXT,
    "expiresAt" TIMESTAMPTZ(3),
    "confirmedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "damage_charges" (
    "id" TEXT NOT NULL,
    "inspectionId" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "amountVnd" BIGINT NOT NULL,
    "finalVnd" BIGINT,
    "status" "DamageChargeStatus" NOT NULL,
    "decidedById" TEXT,
    "decisionNote" TEXT,
    "decidedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "damage_charges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "incidents" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "contractId" TEXT,
    "organizationId" TEXT,
    "state" "IncidentState" NOT NULL DEFAULT 'DETECTED',
    "stateChangedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "source" "IncidentSource" NOT NULL,
    "confidence" "IncidentConfidence" NOT NULL,
    "openedByEventId" TEXT,
    "firstEventAt" TIMESTAMPTZ(3) NOT NULL,
    "lastEventAt" TIMESTAMPTZ(3) NOT NULL,
    "eventCount" INTEGER NOT NULL DEFAULT 1,
    "lastLatitude" DOUBLE PRECISION,
    "lastLongitude" DOUBLE PRECISION,
    "ownerId" TEXT,
    "tierDeadlineAt" TIMESTAMPTZ(3),
    "statusDueAt" TIMESTAMPTZ(3),
    "reopenWindowEndsAt" TIMESTAMPTZ(3),
    "stale" BOOLEAN NOT NULL DEFAULT false,
    "acknowledgedAt" TIMESTAMPTZ(3),
    "resolvedAt" TIMESTAMPTZ(3),
    "outcomeNote" TEXT,
    "falseAlarmReason" TEXT,
    "reopenCount" INTEGER NOT NULL DEFAULT 0,
    "closedAt" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "incidents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "incident_transitions" (
    "id" TEXT NOT NULL,
    "incidentId" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "fromState" "IncidentState",
    "toState" "IncidentState" NOT NULL,
    "actorId" TEXT,
    "reason" TEXT NOT NULL,
    "note" TEXT,
    "refEventId" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "incident_transitions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "incident_status_updates" (
    "id" TEXT NOT NULL,
    "incidentId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "note" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "incident_status_updates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "alert_deliveries" (
    "id" TEXT NOT NULL,
    "incidentId" TEXT NOT NULL,
    "transitionId" TEXT NOT NULL,
    "tier" TEXT NOT NULL,
    "recipientId" TEXT,
    "channel" "AlertChannel" NOT NULL,
    "status" "AlertStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastError" TEXT,
    "sentAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "alert_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "authority_reports" (
    "id" TEXT NOT NULL,
    "incidentId" TEXT,
    "contractId" TEXT,
    "agency" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "reportedAt" TIMESTAMPTZ(3) NOT NULL,
    "reportedById" TEXT NOT NULL,
    "note" TEXT,
    "caseClosedAt" TIMESTAMPTZ(3),
    "caseClosedById" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "authority_reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "field_events" (
    "id" TEXT NOT NULL,
    "seq" BIGSERIAL NOT NULL,
    "eventId" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "organizationId" TEXT,
    "fieldStationId" TEXT,
    "uplinkKey" TEXT NOT NULL,
    "ingress" "IngressPath" NOT NULL,
    "kind" "EventKind" NOT NULL,
    "priority" "PriorityTier" NOT NULL,
    "observedAt" TIMESTAMPTZ(3),
    "receivedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "altitude" DOUBLE PRECISION,
    "batteryPct" INTEGER,
    "rssi" INTEGER,
    "snr" DOUBLE PRECISION,
    "hopsAway" INTEGER,
    "plotted" BOOLEAN NOT NULL DEFAULT true,
    "payload" JSONB NOT NULL,
    "incidentId" TEXT,

    CONSTRAINT "field_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sync_audit_log" (
    "id" TEXT NOT NULL,
    "eventId" TEXT,
    "nodeNum" BIGINT,
    "deviceId" TEXT,
    "uplinkKey" TEXT,
    "ingress" "IngressPath" NOT NULL,
    "outcome" "SyncOutcome" NOT NULL,
    "detail" TEXT,
    "rawMessage" JSONB,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sync_audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "device_queue_reports" (
    "id" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "schemaVersion" INTEGER NOT NULL,
    "uptimeSeconds" INTEGER NOT NULL,
    "capacity" INTEGER NOT NULL,
    "depth" INTEGER[],
    "enqueued" INTEGER[],
    "published" INTEGER[],
    "shed" INTEGER[],
    "p0Refused" INTEGER NOT NULL,
    "flashWriteFailed" INTEGER NOT NULL,
    "restoreDiscarded" INTEGER NOT NULL,
    "rebootDetected" BOOLEAN NOT NULL DEFAULT false,
    "receivedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "device_queue_reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stream_events" (
    "seq" BIGSERIAL NOT NULL,
    "organizationId" TEXT,
    "type" TEXT NOT NULL,
    "deviceId" TEXT,
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stream_events_pkey" PRIMARY KEY ("seq")
);

-- CreateIndex
CREATE INDEX "business_parameters_updatedById_idx" ON "business_parameters"("updatedById");

-- CreateIndex
CREATE INDEX "business_parameter_history_key_changedAt_idx" ON "business_parameter_history"("key", "changedAt");

-- CreateIndex
CREATE INDEX "business_parameter_history_changedById_idx" ON "business_parameter_history"("changedById");

-- CreateIndex
CREATE INDEX "audit_log_subjectType_subjectId_createdAt_idx" ON "audit_log"("subjectType", "subjectId", "createdAt");

-- CreateIndex
CREATE INDEX "audit_log_actorId_createdAt_idx" ON "audit_log"("actorId", "createdAt");

-- CreateIndex
CREATE INDEX "audit_log_organizationId_createdAt_idx" ON "audit_log"("organizationId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_accountType_isActive_idx" ON "users"("accountType", "isActive");

-- CreateIndex
CREATE INDEX "users_createdById_idx" ON "users"("createdById");

-- CreateIndex
CREATE UNIQUE INDEX "roles_key_key" ON "roles"("key");

-- CreateIndex
CREATE UNIQUE INDEX "permissions_key_key" ON "permissions"("key");

-- CreateIndex
CREATE INDEX "user_roles_roleId_idx" ON "user_roles"("roleId");

-- CreateIndex
CREATE INDEX "user_roles_grantedById_idx" ON "user_roles"("grantedById");

-- CreateIndex
CREATE INDEX "role_permissions_permissionId_idx" ON "role_permissions"("permissionId");

-- CreateIndex
CREATE UNIQUE INDEX "refresh_tokens_tokenHash_key" ON "refresh_tokens"("tokenHash");

-- CreateIndex
CREATE INDEX "refresh_tokens_userId_familyId_idx" ON "refresh_tokens"("userId", "familyId");

-- CreateIndex
CREATE INDEX "refresh_tokens_replacedById_idx" ON "refresh_tokens"("replacedById");

-- CreateIndex
CREATE INDEX "one_time_codes_userId_purpose_createdAt_idx" ON "one_time_codes"("userId", "purpose", "createdAt");

-- CreateIndex
CREATE INDEX "auth_events_userId_createdAt_idx" ON "auth_events"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "auth_events_type_createdAt_idx" ON "auth_events"("type", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "organizations_code_key" ON "organizations"("code");

-- CreateIndex
CREATE UNIQUE INDEX "organizations_taxCode_key" ON "organizations"("taxCode");

-- CreateIndex
CREATE INDEX "organizations_status_idx" ON "organizations"("status");

-- CreateIndex
CREATE INDEX "organizations_verifiedById_idx" ON "organizations"("verifiedById");

-- CreateIndex
CREATE INDEX "organizations_decidedById_idx" ON "organizations"("decidedById");

-- CreateIndex
CREATE UNIQUE INDEX "organization_members_userId_key" ON "organization_members"("userId");

-- CreateIndex
CREATE INDEX "organization_members_organizationId_role_idx" ON "organization_members"("organizationId", "role");

-- CreateIndex
CREATE INDEX "organization_members_invitedById_idx" ON "organization_members"("invitedById");

-- CreateIndex
CREATE INDEX "organization_transitions_organizationId_createdAt_idx" ON "organization_transitions"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "organization_transitions_actorId_idx" ON "organization_transitions"("actorId");

-- CreateIndex
CREATE INDEX "roster_shifts_organizationId_startsAt_endsAt_idx" ON "roster_shifts"("organizationId", "startsAt", "endsAt");

-- CreateIndex
CREATE INDEX "roster_shifts_primaryMemberId_idx" ON "roster_shifts"("primaryMemberId");

-- CreateIndex
CREATE INDEX "roster_shifts_backupMemberId_idx" ON "roster_shifts"("backupMemberId");

-- CreateIndex
CREATE INDEX "roster_shifts_createdById_idx" ON "roster_shifts"("createdById");

-- CreateIndex
CREATE UNIQUE INDEX "api_keys_keyHash_key" ON "api_keys"("keyHash");

-- CreateIndex
CREATE INDEX "api_keys_organizationId_revokedAt_idx" ON "api_keys"("organizationId", "revokedAt");

-- CreateIndex
CREATE INDEX "api_keys_createdById_idx" ON "api_keys"("createdById");

-- CreateIndex
CREATE INDEX "api_keys_revokedById_idx" ON "api_keys"("revokedById");

-- CreateIndex
CREATE UNIQUE INDEX "field_stations_mqttUsername_key" ON "field_stations"("mqttUsername");

-- CreateIndex
CREATE INDEX "field_stations_organizationId_revokedAt_idx" ON "field_stations"("organizationId", "revokedAt");

-- CreateIndex
CREATE INDEX "field_stations_createdById_idx" ON "field_stations"("createdById");

-- CreateIndex
CREATE INDEX "field_stations_revokedById_idx" ON "field_stations"("revokedById");

-- CreateIndex
CREATE UNIQUE INDEX "hardware_variants_code_key" ON "hardware_variants"("code");

-- CreateIndex
CREATE UNIQUE INDEX "devices_assetTag_key" ON "devices"("assetTag");

-- CreateIndex
CREATE UNIQUE INDEX "devices_nodeNum_key" ON "devices"("nodeNum");

-- CreateIndex
CREATE INDEX "devices_status_idx" ON "devices"("status");

-- CreateIndex
CREATE INDEX "devices_hardwareVariantId_status_idx" ON "devices"("hardwareVariantId", "status");

-- CreateIndex
CREATE INDEX "devices_registeredById_idx" ON "devices"("registeredById");

-- CreateIndex
CREATE INDEX "device_transitions_deviceId_createdAt_idx" ON "device_transitions"("deviceId", "createdAt");

-- CreateIndex
CREATE INDEX "device_transitions_actorId_idx" ON "device_transitions"("actorId");

-- CreateIndex
CREATE INDEX "intake_checks_deviceId_createdAt_idx" ON "intake_checks"("deviceId", "createdAt");

-- CreateIndex
CREATE INDEX "intake_checks_checkedById_idx" ON "intake_checks"("checkedById");

-- CreateIndex
CREATE INDEX "device_provisionings_deviceId_createdAt_idx" ON "device_provisionings"("deviceId", "createdAt");

-- CreateIndex
CREATE INDEX "device_provisionings_organizationId_idx" ON "device_provisionings"("organizationId");

-- CreateIndex
CREATE INDEX "device_provisionings_provisionedById_idx" ON "device_provisionings"("provisionedById");

-- CreateIndex
CREATE INDEX "device_resets_deviceId_createdAt_idx" ON "device_resets"("deviceId", "createdAt");

-- CreateIndex
CREATE INDEX "device_resets_resetById_idx" ON "device_resets"("resetById");

-- CreateIndex
CREATE INDEX "inspections_deviceId_createdAt_idx" ON "inspections"("deviceId", "createdAt");

-- CreateIndex
CREATE INDEX "inspections_contractDeviceId_idx" ON "inspections"("contractDeviceId");

-- CreateIndex
CREATE INDEX "inspections_inspectorId_idx" ON "inspections"("inspectorId");

-- CreateIndex
CREATE INDEX "maintenance_records_deviceId_status_idx" ON "maintenance_records"("deviceId", "status");

-- CreateIndex
CREATE INDEX "maintenance_records_openedById_idx" ON "maintenance_records"("openedById");

-- CreateIndex
CREATE INDEX "maintenance_records_closedById_idx" ON "maintenance_records"("closedById");

-- CreateIndex
CREATE INDEX "stock_takes_takenById_idx" ON "stock_takes"("takenById");

-- CreateIndex
CREATE UNIQUE INDEX "rental_contracts_code_key" ON "rental_contracts"("code");

-- CreateIndex
CREATE INDEX "rental_contracts_organizationId_status_idx" ON "rental_contracts"("organizationId", "status");

-- CreateIndex
CREATE INDEX "rental_contracts_status_returnDueAt_idx" ON "rental_contracts"("status", "returnDueAt");

-- CreateIndex
CREATE INDEX "rental_contracts_hardwareVariantId_idx" ON "rental_contracts"("hardwareVariantId");

-- CreateIndex
CREATE INDEX "rental_contracts_requestedById_idx" ON "rental_contracts"("requestedById");

-- CreateIndex
CREATE INDEX "rental_contracts_decidedById_idx" ON "rental_contracts"("decidedById");

-- CreateIndex
CREATE INDEX "rental_contracts_handedOverById_idx" ON "rental_contracts"("handedOverById");

-- CreateIndex
CREATE INDEX "rental_contracts_noticeGivenById_idx" ON "rental_contracts"("noticeGivenById");

-- CreateIndex
CREATE INDEX "rental_contracts_closedById_idx" ON "rental_contracts"("closedById");

-- CreateIndex
CREATE UNIQUE INDEX "contract_terms_contractId_seq_key" ON "contract_terms"("contractId", "seq");

-- CreateIndex
CREATE INDEX "contract_devices_contractId_idx" ON "contract_devices"("contractId");

-- CreateIndex
CREATE INDEX "contract_devices_deviceId_idx" ON "contract_devices"("deviceId");

-- CreateIndex
CREATE INDEX "contract_devices_checkedInById_idx" ON "contract_devices"("checkedInById");

-- CreateIndex
CREATE INDEX "contract_transitions_contractId_createdAt_idx" ON "contract_transitions"("contractId", "createdAt");

-- CreateIndex
CREATE INDEX "contract_transitions_actorId_idx" ON "contract_transitions"("actorId");

-- CreateIndex
CREATE INDEX "price_schedules_hardwareVariantId_effectiveFrom_idx" ON "price_schedules"("hardwareVariantId", "effectiveFrom");

-- CreateIndex
CREATE INDEX "price_schedules_createdById_idx" ON "price_schedules"("createdById");

-- CreateIndex
CREATE INDEX "damage_rates_hardwareVariantId_idx" ON "damage_rates"("hardwareVariantId");

-- CreateIndex
CREATE INDEX "damage_rates_createdById_idx" ON "damage_rates"("createdById");

-- CreateIndex
CREATE UNIQUE INDEX "damage_rates_code_hardwareVariantId_key" ON "damage_rates"("code", "hardwareVariantId");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_number_key" ON "invoices"("number");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_termId_key" ON "invoices"("termId");

-- CreateIndex
CREATE INDEX "invoices_organizationId_status_idx" ON "invoices"("organizationId", "status");

-- CreateIndex
CREATE INDEX "invoices_contractId_idx" ON "invoices"("contractId");

-- CreateIndex
CREATE INDEX "invoice_lines_deviceId_idx" ON "invoice_lines"("deviceId");

-- CreateIndex
CREATE INDEX "invoice_lines_createdById_idx" ON "invoice_lines"("createdById");

-- CreateIndex
CREATE INDEX "invoice_lines_dueAt_idx" ON "invoice_lines"("dueAt");

-- CreateIndex
CREATE UNIQUE INDEX "invoice_lines_invoiceId_seq_key" ON "invoice_lines"("invoiceId", "seq");

-- CreateIndex
CREATE UNIQUE INDEX "payments_reference_key" ON "payments"("reference");

-- CreateIndex
CREATE UNIQUE INDEX "payments_gatewayTxnId_key" ON "payments"("gatewayTxnId");

-- CreateIndex
CREATE INDEX "payments_organizationId_createdAt_idx" ON "payments"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "payments_contractId_idx" ON "payments"("contractId");

-- CreateIndex
CREATE INDEX "payments_invoiceId_idx" ON "payments"("invoiceId");

-- CreateIndex
CREATE INDEX "payments_requestedById_idx" ON "payments"("requestedById");

-- CreateIndex
CREATE INDEX "payments_recordedById_idx" ON "payments"("recordedById");

-- CreateIndex
CREATE INDEX "damage_charges_inspectionId_idx" ON "damage_charges"("inspectionId");

-- CreateIndex
CREATE INDEX "damage_charges_deviceId_idx" ON "damage_charges"("deviceId");

-- CreateIndex
CREATE INDEX "damage_charges_decidedById_idx" ON "damage_charges"("decidedById");

-- CreateIndex
CREATE INDEX "damage_charges_status_idx" ON "damage_charges"("status");

-- CreateIndex
CREATE UNIQUE INDEX "incidents_code_key" ON "incidents"("code");

-- CreateIndex
CREATE UNIQUE INDEX "incidents_openedByEventId_key" ON "incidents"("openedByEventId");

-- CreateIndex
CREATE INDEX "incidents_deviceId_state_lastEventAt_idx" ON "incidents"("deviceId", "state", "lastEventAt");

-- CreateIndex
CREATE INDEX "incidents_organizationId_state_idx" ON "incidents"("organizationId", "state");

-- CreateIndex
CREATE INDEX "incidents_contractId_idx" ON "incidents"("contractId");

-- CreateIndex
CREATE INDEX "incidents_state_tierDeadlineAt_idx" ON "incidents"("state", "tierDeadlineAt");

-- CreateIndex
CREATE INDEX "incidents_state_statusDueAt_idx" ON "incidents"("state", "statusDueAt");

-- CreateIndex
CREATE INDEX "incidents_state_reopenWindowEndsAt_idx" ON "incidents"("state", "reopenWindowEndsAt");

-- CreateIndex
CREATE INDEX "incidents_ownerId_idx" ON "incidents"("ownerId");

-- CreateIndex
CREATE INDEX "incident_transitions_actorId_idx" ON "incident_transitions"("actorId");

-- CreateIndex
CREATE INDEX "incident_transitions_refEventId_idx" ON "incident_transitions"("refEventId");

-- CreateIndex
CREATE UNIQUE INDEX "incident_transitions_incidentId_seq_key" ON "incident_transitions"("incidentId", "seq");

-- CreateIndex
CREATE INDEX "incident_status_updates_incidentId_createdAt_idx" ON "incident_status_updates"("incidentId", "createdAt");

-- CreateIndex
CREATE INDEX "incident_status_updates_authorId_idx" ON "incident_status_updates"("authorId");

-- CreateIndex
CREATE INDEX "alert_deliveries_status_nextAttemptAt_idx" ON "alert_deliveries"("status", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "alert_deliveries_incidentId_idx" ON "alert_deliveries"("incidentId");

-- CreateIndex
CREATE INDEX "alert_deliveries_transitionId_idx" ON "alert_deliveries"("transitionId");

-- CreateIndex
CREATE INDEX "alert_deliveries_recipientId_idx" ON "alert_deliveries"("recipientId");

-- CreateIndex
CREATE INDEX "authority_reports_incidentId_idx" ON "authority_reports"("incidentId");

-- CreateIndex
CREATE INDEX "authority_reports_contractId_idx" ON "authority_reports"("contractId");

-- CreateIndex
CREATE INDEX "authority_reports_reportedById_idx" ON "authority_reports"("reportedById");

-- CreateIndex
CREATE INDEX "authority_reports_caseClosedById_idx" ON "authority_reports"("caseClosedById");

-- CreateIndex
CREATE UNIQUE INDEX "field_events_seq_key" ON "field_events"("seq");

-- CreateIndex
CREATE UNIQUE INDEX "field_events_eventId_key" ON "field_events"("eventId");

-- CreateIndex
CREATE INDEX "field_events_deviceId_receivedAt_idx" ON "field_events"("deviceId", "receivedAt");

-- CreateIndex
CREATE INDEX "field_events_deviceId_kind_receivedAt_idx" ON "field_events"("deviceId", "kind", "receivedAt");

-- CreateIndex
CREATE INDEX "field_events_organizationId_seq_idx" ON "field_events"("organizationId", "seq");

-- CreateIndex
CREATE INDEX "field_events_incidentId_idx" ON "field_events"("incidentId");

-- CreateIndex
CREATE INDEX "field_events_fieldStationId_idx" ON "field_events"("fieldStationId");

-- CreateIndex
CREATE INDEX "sync_audit_log_outcome_createdAt_idx" ON "sync_audit_log"("outcome", "createdAt");

-- CreateIndex
CREATE INDEX "sync_audit_log_eventId_idx" ON "sync_audit_log"("eventId");

-- CreateIndex
CREATE INDEX "sync_audit_log_deviceId_idx" ON "sync_audit_log"("deviceId");

-- CreateIndex
CREATE INDEX "device_queue_reports_deviceId_receivedAt_idx" ON "device_queue_reports"("deviceId", "receivedAt");

-- CreateIndex
CREATE INDEX "stream_events_organizationId_seq_idx" ON "stream_events"("organizationId", "seq");

-- CreateIndex
CREATE INDEX "stream_events_createdAt_idx" ON "stream_events"("createdAt");

-- AddForeignKey
ALTER TABLE "business_parameters" ADD CONSTRAINT "business_parameters_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "business_parameter_history" ADD CONSTRAINT "business_parameter_history_key_fkey" FOREIGN KEY ("key") REFERENCES "business_parameters"("key") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "business_parameter_history" ADD CONSTRAINT "business_parameter_history_changedById_fkey" FOREIGN KEY ("changedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_grantedById_fkey" FOREIGN KEY ("grantedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_permissionId_fkey" FOREIGN KEY ("permissionId") REFERENCES "permissions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_replacedById_fkey" FOREIGN KEY ("replacedById") REFERENCES "refresh_tokens"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "one_time_codes" ADD CONSTRAINT "one_time_codes_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auth_events" ADD CONSTRAINT "auth_events_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_verifiedById_fkey" FOREIGN KEY ("verifiedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organization_members" ADD CONSTRAINT "organization_members_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organization_members" ADD CONSTRAINT "organization_members_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organization_members" ADD CONSTRAINT "organization_members_invitedById_fkey" FOREIGN KEY ("invitedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organization_transitions" ADD CONSTRAINT "organization_transitions_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organization_transitions" ADD CONSTRAINT "organization_transitions_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "roster_shifts" ADD CONSTRAINT "roster_shifts_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "roster_shifts" ADD CONSTRAINT "roster_shifts_primaryMemberId_fkey" FOREIGN KEY ("primaryMemberId") REFERENCES "organization_members"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "roster_shifts" ADD CONSTRAINT "roster_shifts_backupMemberId_fkey" FOREIGN KEY ("backupMemberId") REFERENCES "organization_members"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "roster_shifts" ADD CONSTRAINT "roster_shifts_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_revokedById_fkey" FOREIGN KEY ("revokedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "field_stations" ADD CONSTRAINT "field_stations_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "field_stations" ADD CONSTRAINT "field_stations_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "field_stations" ADD CONSTRAINT "field_stations_revokedById_fkey" FOREIGN KEY ("revokedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "devices" ADD CONSTRAINT "devices_hardwareVariantId_fkey" FOREIGN KEY ("hardwareVariantId") REFERENCES "hardware_variants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "devices" ADD CONSTRAINT "devices_registeredById_fkey" FOREIGN KEY ("registeredById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "device_transitions" ADD CONSTRAINT "device_transitions_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "devices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "device_transitions" ADD CONSTRAINT "device_transitions_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "intake_checks" ADD CONSTRAINT "intake_checks_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "devices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "intake_checks" ADD CONSTRAINT "intake_checks_checkedById_fkey" FOREIGN KEY ("checkedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "device_provisionings" ADD CONSTRAINT "device_provisionings_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "devices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "device_provisionings" ADD CONSTRAINT "device_provisionings_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "device_provisionings" ADD CONSTRAINT "device_provisionings_provisionedById_fkey" FOREIGN KEY ("provisionedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "device_resets" ADD CONSTRAINT "device_resets_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "devices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "device_resets" ADD CONSTRAINT "device_resets_resetById_fkey" FOREIGN KEY ("resetById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inspections" ADD CONSTRAINT "inspections_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "devices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inspections" ADD CONSTRAINT "inspections_contractDeviceId_fkey" FOREIGN KEY ("contractDeviceId") REFERENCES "contract_devices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inspections" ADD CONSTRAINT "inspections_inspectorId_fkey" FOREIGN KEY ("inspectorId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maintenance_records" ADD CONSTRAINT "maintenance_records_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "devices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maintenance_records" ADD CONSTRAINT "maintenance_records_openedById_fkey" FOREIGN KEY ("openedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maintenance_records" ADD CONSTRAINT "maintenance_records_closedById_fkey" FOREIGN KEY ("closedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_takes" ADD CONSTRAINT "stock_takes_takenById_fkey" FOREIGN KEY ("takenById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rental_contracts" ADD CONSTRAINT "rental_contracts_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rental_contracts" ADD CONSTRAINT "rental_contracts_hardwareVariantId_fkey" FOREIGN KEY ("hardwareVariantId") REFERENCES "hardware_variants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rental_contracts" ADD CONSTRAINT "rental_contracts_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rental_contracts" ADD CONSTRAINT "rental_contracts_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rental_contracts" ADD CONSTRAINT "rental_contracts_handedOverById_fkey" FOREIGN KEY ("handedOverById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rental_contracts" ADD CONSTRAINT "rental_contracts_noticeGivenById_fkey" FOREIGN KEY ("noticeGivenById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rental_contracts" ADD CONSTRAINT "rental_contracts_closedById_fkey" FOREIGN KEY ("closedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract_terms" ADD CONSTRAINT "contract_terms_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "rental_contracts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract_devices" ADD CONSTRAINT "contract_devices_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "rental_contracts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract_devices" ADD CONSTRAINT "contract_devices_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "devices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract_devices" ADD CONSTRAINT "contract_devices_checkedInById_fkey" FOREIGN KEY ("checkedInById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract_transitions" ADD CONSTRAINT "contract_transitions_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "rental_contracts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract_transitions" ADD CONSTRAINT "contract_transitions_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "price_schedules" ADD CONSTRAINT "price_schedules_hardwareVariantId_fkey" FOREIGN KEY ("hardwareVariantId") REFERENCES "hardware_variants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "price_schedules" ADD CONSTRAINT "price_schedules_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "damage_rates" ADD CONSTRAINT "damage_rates_hardwareVariantId_fkey" FOREIGN KEY ("hardwareVariantId") REFERENCES "hardware_variants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "damage_rates" ADD CONSTRAINT "damage_rates_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "rental_contracts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_termId_fkey" FOREIGN KEY ("termId") REFERENCES "contract_terms"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "devices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "rental_contracts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "damage_charges" ADD CONSTRAINT "damage_charges_inspectionId_fkey" FOREIGN KEY ("inspectionId") REFERENCES "inspections"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "damage_charges" ADD CONSTRAINT "damage_charges_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "devices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "damage_charges" ADD CONSTRAINT "damage_charges_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "devices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "rental_contracts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_openedByEventId_fkey" FOREIGN KEY ("openedByEventId") REFERENCES "field_events"("eventId") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incident_transitions" ADD CONSTRAINT "incident_transitions_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "incidents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incident_transitions" ADD CONSTRAINT "incident_transitions_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incident_transitions" ADD CONSTRAINT "incident_transitions_refEventId_fkey" FOREIGN KEY ("refEventId") REFERENCES "field_events"("eventId") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incident_status_updates" ADD CONSTRAINT "incident_status_updates_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "incidents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incident_status_updates" ADD CONSTRAINT "incident_status_updates_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alert_deliveries" ADD CONSTRAINT "alert_deliveries_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "incidents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alert_deliveries" ADD CONSTRAINT "alert_deliveries_transitionId_fkey" FOREIGN KEY ("transitionId") REFERENCES "incident_transitions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alert_deliveries" ADD CONSTRAINT "alert_deliveries_recipientId_fkey" FOREIGN KEY ("recipientId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "authority_reports" ADD CONSTRAINT "authority_reports_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "incidents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "authority_reports" ADD CONSTRAINT "authority_reports_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "rental_contracts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "authority_reports" ADD CONSTRAINT "authority_reports_reportedById_fkey" FOREIGN KEY ("reportedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "authority_reports" ADD CONSTRAINT "authority_reports_caseClosedById_fkey" FOREIGN KEY ("caseClosedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "field_events" ADD CONSTRAINT "field_events_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "devices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "field_events" ADD CONSTRAINT "field_events_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "field_events" ADD CONSTRAINT "field_events_fieldStationId_fkey" FOREIGN KEY ("fieldStationId") REFERENCES "field_stations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "field_events" ADD CONSTRAINT "field_events_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "incidents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sync_audit_log" ADD CONSTRAINT "sync_audit_log_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "devices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "device_queue_reports" ADD CONSTRAINT "device_queue_reports_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "devices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stream_events" ADD CONSTRAINT "stream_events_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;



-- ─── Constraints Prisma cannot express (specs/platform/design.md §3.4) ──────────────────────
-- Column names are the Prisma field names (camelCase); only table names are mapped.
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- organizations, FR-ORG-05: shift windows of one organization never overlap.
ALTER TABLE "roster_shifts"
  ADD CONSTRAINT "roster_shifts_end_after_start" CHECK ("endsAt" > "startsAt"),
  ADD CONSTRAINT "roster_shifts_no_overlap"
  EXCLUDE USING gist ("organizationId" WITH =, tstzrange("startsAt", "endsAt", '[)') WITH &&);

-- organizations, FR-ORG-05: the primary and the backup are different members.
ALTER TABLE "roster_shifts"
  ADD CONSTRAINT "roster_shifts_distinct_members"
  CHECK ("primaryMemberId" IS NULL OR "backupMemberId" IS NULL OR "primaryMemberId" <> "backupMemberId");

-- rentals, BR-03: a device has at most one live commitment to a contract.
CREATE UNIQUE INDEX "contract_devices_one_live_per_device"
  ON "contract_devices" ("deviceId")
  WHERE "releasedAt" IS NULL AND "checkedInAt" IS NULL AND "lostAt" IS NULL;

-- rentals: quantities, plan lengths and term ranges.
ALTER TABLE "rental_contracts"
  ADD CONSTRAINT "rental_contracts_quantity_positive" CHECK ("quantity" > 0),
  ADD CONSTRAINT "rental_contracts_day_plan_length"
  CHECK (("planType" = 'DAY' AND "dayPlanDays" > 0 AND "dayPremium" >= 1)
      OR ("planType" = 'MONTHLY' AND "dayPlanDays" IS NULL)),
  ADD CONSTRAINT "rental_contracts_holding_ratio" CHECK ("holdingFeeRatio" > 0 AND "holdingFeeRatio" <= 1);
ALTER TABLE "contract_terms"
  ADD CONSTRAINT "contract_terms_end_after_start" CHECK ("endsAt" > "startsAt");

-- billing: amounts are never negative except an ADJUSTMENT line; a line is never overpaid.
ALTER TABLE "invoice_lines"
  ADD CONSTRAINT "invoice_lines_amount_sign" CHECK ("type" = 'ADJUSTMENT' OR "amountVnd" >= 0),
  ADD CONSTRAINT "invoice_lines_paid_bounds" CHECK ("paidVnd" >= 0 AND ("type" = 'ADJUSTMENT' OR "paidVnd" <= "amountVnd"));
ALTER TABLE "payments"
  ADD CONSTRAINT "payments_amount_positive" CHECK ("amountVnd" > 0);

-- incidents, BR-17: an authority report is about exactly one incident or one contract.
ALTER TABLE "authority_reports"
  ADD CONSTRAINT "authority_reports_one_subject"
  CHECK (("incidentId" IS NULL) <> ("contractId" IS NULL));

-- incidents, FR-INC-01: at most one open incident per device.
CREATE UNIQUE INDEX "incidents_one_open_per_device"
  ON "incidents" ("deviceId")
  WHERE "state" <> 'CLOSED';

-- Append-only tables (REQ-UBI-07, NFR-SEC-05, BR-18): the database rejects UPDATE and DELETE.
CREATE OR REPLACE FUNCTION raise_append_only() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% on append-only table % is not allowed', TG_OP, TG_TABLE_NAME;
END;
$$;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'audit_log', 'business_parameter_history', 'auth_events', 'organization_transitions',
    'device_transitions', 'intake_checks', 'device_provisionings', 'device_resets', 'inspections',
    'contract_transitions', 'price_schedules', 'incident_transitions', 'incident_status_updates',
    'sync_audit_log'
  ] LOOP
    EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION raise_append_only()',
                   t || '_append_only', t);
  END LOOP;
END $$;

-- field_events is append-only with one exception: an UPDATE that only sets "incidentId" from NULL
-- to a value, which links an accepted event to the episode it opened or joined.
CREATE OR REPLACE FUNCTION field_events_append_only() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND OLD."incidentId" IS NULL AND NEW."incidentId" IS NOT NULL
     AND (to_jsonb(NEW) - 'incidentId') = (to_jsonb(OLD) - 'incidentId') THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION '% on append-only table % is not allowed', TG_OP, TG_TABLE_NAME;
END;
$$;

CREATE TRIGGER "field_events_append_only" BEFORE UPDATE OR DELETE ON "field_events"
  FOR EACH ROW EXECUTE FUNCTION field_events_append_only();
