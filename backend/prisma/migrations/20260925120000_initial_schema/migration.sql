-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "ParameterType" AS ENUM ('INT', 'DECIMAL', 'PERCENT', 'DURATION_SECONDS', 'BOOL', 'JSON');

-- CreateEnum
CREATE TYPE "AccountType" AS ENUM ('CUSTOMER', 'STAFF');

-- CreateEnum
CREATE TYPE "OtpPurpose" AS ENUM ('VERIFY_EMAIL', 'SET_PASSWORD', 'PASSWORD_RESET');

-- CreateEnum
CREATE TYPE "DeviceStatus" AS ENUM ('AVAILABLE', 'RESERVED', 'RENTED', 'IN_FIELD', 'RETURNED', 'MAINTENANCE', 'RETIRED');

-- CreateEnum
CREATE TYPE "RetireReason" AS ENUM ('UNREPAIRABLE', 'LOST', 'DECOMMISSIONED', 'OTHER');

-- CreateEnum
CREATE TYPE "ActorKind" AS ENUM ('USER', 'SYSTEM');

-- CreateEnum
CREATE TYPE "MaintenanceReason" AS ENUM ('RETURN_DAMAGE', 'FAILED_HANDOVER', 'FAILED_INSPECTION', 'SCHEDULED', 'STAFF_REPORTED');

-- CreateEnum
CREATE TYPE "MaintenanceStatus" AS ENUM ('OPEN', 'IN_REPAIR', 'COMPLETED', 'UNREPAIRABLE');

-- CreateEnum
CREATE TYPE "ProvisioningMethod" AS ENUM ('MESHTASTIC_APP_QR', 'MESHTASTIC_CLI', 'OTHER');

-- CreateEnum
CREATE TYPE "PackageStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "Difficulty" AS ENUM ('EASY', 'MODERATE', 'HARD', 'EXPERT');

-- CreateEnum
CREATE TYPE "TripStatus" AS ENUM ('DRAFT', 'PREPARING', 'BOOKING_OPEN', 'READY', 'IN_PROGRESS', 'FINISHED', 'CANCELLED', 'EMERGENCY');

-- CreateEnum
CREATE TYPE "GuideRole" AS ENUM ('LEAD', 'ASSISTANT');

-- CreateEnum
CREATE TYPE "TripRequestStatus" AS ENUM ('OPEN', 'ACCEPTED', 'DECLINED');

-- CreateEnum
CREATE TYPE "ReadinessResult" AS ENUM ('PASS', 'FAIL');

-- CreateEnum
CREATE TYPE "BookingStatus" AS ENUM ('PENDING', 'CONFIRMED', 'COMPLETED', 'CANCELLED', 'REJECTED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "BookingChannel" AS ENUM ('CUSTOMER', 'GUIDE', 'STAFF');

-- CreateEnum
CREATE TYPE "AllocationStatus" AS ENUM ('HELD', 'CONFIRMED', 'CHECKED_OUT', 'ENDED', 'RELEASED');

-- CreateEnum
CREATE TYPE "RentalStatus" AS ENUM ('DRAFT', 'READY', 'CHECKED_OUT', 'OVERDUE', 'RETURNED', 'CLOSED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "RentalItemState" AS ENUM ('ALLOCATED', 'CHECKED_OUT', 'HANDOVER_ACCEPTED', 'HANDOVER_REJECTED', 'MISSING_REPORTED', 'LOSS_SUSPECTED', 'RETURNED', 'LOST', 'REPLACED');

-- CreateEnum
CREATE TYPE "AgreementStatus" AS ENUM ('GENERATED', 'SIGNED', 'VOID');

-- CreateEnum
CREATE TYPE "ReturnCondition" AS ENUM ('GOOD', 'MINOR_DAMAGE', 'MAJOR_DAMAGE', 'MISSING_ACCESSORIES');

-- CreateEnum
CREATE TYPE "PricingScope" AS ENUM ('GLOBAL', 'PACKAGE', 'VARIANT', 'PACKAGE_VARIANT');

-- CreateEnum
CREATE TYPE "PriceComponent" AS ENUM ('TRIP_FEE', 'RENTAL_FEE', 'DEPOSIT');

-- CreateEnum
CREATE TYPE "PriceUnit" AS ENUM ('PER_TRAVELLER', 'PER_DEVICE_PER_TRIP', 'PER_DEVICE_PER_DAY');

-- CreateEnum
CREATE TYPE "InvoiceKind" AS ENUM ('BOOKING_ESCROW', 'SETTLEMENT', 'ADJUSTMENT');

-- CreateEnum
CREATE TYPE "InvoiceStatus" AS ENUM ('ISSUED', 'PARTIALLY_PAID', 'PAID', 'SETTLED', 'VOID');

-- CreateEnum
CREATE TYPE "InvoiceLineType" AS ENUM ('TRIP_FEE', 'RENTAL_FEE', 'DEPOSIT', 'LATE_FEE', 'DAMAGE_FEE', 'LOSS_FEE', 'DEPOSIT_APPLIED', 'CANCELLATION_FEE', 'WAIVER', 'REFUND_DUE');

-- CreateEnum
CREATE TYPE "PaymentDirection" AS ENUM ('CHARGE', 'REFUND');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('SUCCEEDED', 'FAILED');

-- CreateEnum
CREATE TYPE "WaiverStatus" AS ENUM ('APPLIED', 'PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "DamageCondition" AS ENUM ('MINOR_DAMAGE', 'MAJOR_DAMAGE', 'MISSING_ACCESSORIES', 'LOST');

-- CreateEnum
CREATE TYPE "IncidentStatus" AS ENUM ('DETECTED', 'ACKNOWLEDGED', 'IN_PROGRESS', 'RESOLVED', 'CLOSED');

-- CreateEnum
CREATE TYPE "IncidentSource" AS ENUM ('DEVICE_SOS', 'DEVICE_FALL', 'CADENCE_INFERRED', 'MANUAL');

-- CreateEnum
CREATE TYPE "IncidentConfidence" AS ENUM ('CONFIRMED', 'SUSPECTED');

-- CreateEnum
CREATE TYPE "IncidentResolution" AS ENUM ('ASSISTED', 'SELF_RESOLVED', 'EVACUATED', 'FALSE_ALARM', 'OTHER');

-- CreateEnum
CREATE TYPE "IncidentAction" AS ENUM ('CREATED', 'ACKNOWLEDGED', 'STARTED', 'RESOLVED', 'CLOSED', 'REOPENED', 'DISMISSED', 'CONFIDENCE_UPGRADED', 'ESCALATED', 'NOTE_ADDED');

-- CreateEnum
CREATE TYPE "PriorityTier" AS ENUM ('P0_SOS', 'P1_LOCATION', 'P2_GPS', 'P3_TELEMETRY');

-- CreateEnum
CREATE TYPE "EventKind" AS ENUM ('SOS', 'FALL_SOS', 'POSITION', 'TELEMETRY', 'CHAT');

-- CreateEnum
CREATE TYPE "IngressPath" AS ENUM ('MQTT_NODE', 'SERIAL_BRIDGE');

-- CreateEnum
CREATE TYPE "SyncOutcome" AS ENUM ('ACCEPTED', 'DUPLICATE_REJECTED', 'MALFORMED_ENVELOPE', 'NORMALIZATION_FAILED', 'UNKNOWN_DEVICE', 'INVALID_POSITION', 'IMPLAUSIBLE_POSITION', 'CLOCK_SKEW', 'QUEUE_REPORT');

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
    "username" TEXT NOT NULL,
    "email" TEXT,
    "emailVerifiedAt" TIMESTAMPTZ(3),
    "phoneNumber" TEXT,
    "fullName" TEXT NOT NULL,
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
CREATE TABLE "guide_profiles" (
    "userId" TEXT NOT NULL,
    "bio" TEXT,
    "skills" TEXT[],
    "certifications" TEXT[],
    "languages" TEXT[],
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "guide_profiles_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "hardware_variants" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "mqttCapable" BOOLEAN NOT NULL,
    "hasPsram" BOOLEAN NOT NULL,
    "notes" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "hardware_variants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "devices" (
    "id" TEXT NOT NULL,
    "assetTag" TEXT NOT NULL,
    "hardwareVariantId" TEXT NOT NULL,
    "nodeNum" BIGINT,
    "macAddress" TEXT,
    "firmwareVersion" TEXT,
    "status" "DeviceStatus" NOT NULL DEFAULT 'AVAILABLE',
    "statusChangedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "pskVersion" INTEGER,
    "pskProvisionedAt" TIMESTAMPTZ(3),
    "lastSeenAt" TIMESTAMPTZ(3),
    "batteryPct" INTEGER,
    "lastLatitude" DOUBLE PRECISION,
    "lastLongitude" DOUBLE PRECISION,
    "lastGatewayId" TEXT,
    "buffering" BOOLEAN NOT NULL DEFAULT false,
    "retiredAt" TIMESTAMPTZ(3),
    "retireReason" "RetireReason",
    "notes" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "devices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "device_status_history" (
    "id" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "fromStatus" "DeviceStatus",
    "toStatus" "DeviceStatus" NOT NULL,
    "actorKind" "ActorKind" NOT NULL,
    "actorId" TEXT,
    "reason" TEXT NOT NULL,
    "note" TEXT,
    "refType" TEXT,
    "refId" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "device_status_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "maintenance_records" (
    "id" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "reason" "MaintenanceReason" NOT NULL,
    "status" "MaintenanceStatus" NOT NULL DEFAULT 'OPEN',
    "description" TEXT NOT NULL,
    "sourceRefType" TEXT,
    "sourceRefId" TEXT,
    "resolution" TEXT,
    "openedById" TEXT,
    "closedById" TEXT,
    "openedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMPTZ(3),

    CONSTRAINT "maintenance_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "device_provisioning" (
    "id" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "pskVersion" INTEGER NOT NULL,
    "channelName" TEXT NOT NULL,
    "method" "ProvisioningMethod" NOT NULL,
    "provisionedById" TEXT NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "device_provisioning_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trek_packages" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "region" TEXT NOT NULL,
    "durationDays" INTEGER NOT NULL,
    "difficulty" "Difficulty" NOT NULL,
    "minGroupSize" INTEGER NOT NULL,
    "maxGroupSize" INTEGER NOT NULL,
    "acceptedVariantIds" TEXT[],
    "coverImageUrl" TEXT,
    "status" "PackageStatus" NOT NULL DEFAULT 'DRAFT',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "trek_packages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trips" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "packageId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "startAt" TIMESTAMPTZ(3) NOT NULL,
    "endAt" TIMESTAMPTZ(3) NOT NULL,
    "capacity" INTEGER NOT NULL,
    "seatsTaken" INTEGER NOT NULL DEFAULT 0,
    "requiredGuideCount" INTEGER NOT NULL,
    "status" "TripStatus" NOT NULL DEFAULT 'DRAFT',
    "statusChangedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "requestId" TEXT,
    "emergencyNote" TEXT,
    "cancelledReason" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "trips_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trip_guide_assignments" (
    "id" TEXT NOT NULL,
    "tripId" TEXT NOT NULL,
    "guideId" TEXT NOT NULL,
    "role" "GuideRole" NOT NULL,
    "assignedById" TEXT NOT NULL,
    "assignedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "unassignedAt" TIMESTAMPTZ(3),

    CONSTRAINT "trip_guide_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trip_participants" (
    "id" TEXT NOT NULL,
    "tripId" TEXT NOT NULL,
    "bookingId" TEXT,
    "userId" TEXT,
    "displayName" TEXT NOT NULL,
    "phoneNumber" TEXT,
    "emergencyContact" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "trip_participants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trip_readiness_checks" (
    "id" TEXT NOT NULL,
    "tripId" TEXT NOT NULL,
    "guideId" TEXT NOT NULL,
    "items" JSONB NOT NULL,
    "result" "ReadinessResult" NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "trip_readiness_checks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trip_requests" (
    "id" TEXT NOT NULL,
    "guideId" TEXT NOT NULL,
    "packageId" TEXT,
    "preferredStartAt" TIMESTAMPTZ(3) NOT NULL,
    "preferredEndAt" TIMESTAMPTZ(3) NOT NULL,
    "groupSizeEstimate" INTEGER,
    "notes" TEXT,
    "status" "TripRequestStatus" NOT NULL DEFAULT 'OPEN',
    "decidedById" TEXT,
    "decisionNote" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "trip_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trip_status_history" (
    "id" TEXT NOT NULL,
    "tripId" TEXT NOT NULL,
    "fromStatus" "TripStatus",
    "toStatus" "TripStatus" NOT NULL,
    "actorId" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "trip_status_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bookings" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "tripId" TEXT NOT NULL,
    "channel" "BookingChannel" NOT NULL,
    "customerId" TEXT,
    "renterName" TEXT NOT NULL,
    "renterPhone" TEXT,
    "createdById" TEXT NOT NULL,
    "groupSize" INTEGER NOT NULL,
    "requestedDevices" INTEGER NOT NULL,
    "status" "BookingStatus" NOT NULL DEFAULT 'PENDING',
    "holdDisabled" BOOLEAN NOT NULL DEFAULT false,
    "escrowPaidAt" TIMESTAMPTZ(3),
    "confirmedById" TEXT,
    "confirmedAt" TIMESTAMPTZ(3),
    "decisionReason" TEXT,
    "cancelledAt" TIMESTAMPTZ(3),
    "termsAcceptedAt" TIMESTAMPTZ(3) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "bookings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "device_allocations" (
    "id" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "bookingId" TEXT,
    "rentalItemId" TEXT,
    "windowStart" TIMESTAMPTZ(3) NOT NULL,
    "windowEnd" TIMESTAMPTZ(3) NOT NULL,
    "status" "AllocationStatus" NOT NULL,
    "holdExpiresAt" TIMESTAMPTZ(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "device_allocations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rentals" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "bookingId" TEXT,
    "tripId" TEXT NOT NULL,
    "renterId" TEXT,
    "renterName" TEXT NOT NULL,
    "custodianGuideId" TEXT NOT NULL,
    "status" "RentalStatus" NOT NULL DEFAULT 'DRAFT',
    "dueAt" TIMESTAMPTZ(3) NOT NULL,
    "checkedOutAt" TIMESTAMPTZ(3),
    "checkedOutById" TEXT,
    "returnedAt" TIMESTAMPTZ(3),
    "settlementInvoiceId" TEXT,
    "closedAt" TIMESTAMPTZ(3),
    "closedById" TEXT,
    "cancelledReason" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "rentals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rental_items" (
    "id" TEXT NOT NULL,
    "rentalId" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "participantId" TEXT,
    "state" "RentalItemState" NOT NULL DEFAULT 'ALLOCATED',
    "checkedOutAt" TIMESTAMPTZ(3),
    "returnedAt" TIMESTAMPTZ(3),
    "receivedById" TEXT,
    "replacedByItemId" TEXT,
    "lostConfirmedAt" TIMESTAMPTZ(3),
    "lostConfirmedById" TEXT,

    CONSTRAINT "rental_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rental_agreements" (
    "id" TEXT NOT NULL,
    "rentalId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "status" "AgreementStatus" NOT NULL,
    "termsVersion" TEXT NOT NULL,
    "generatedPdf" BYTEA NOT NULL,
    "generatedSha256" TEXT NOT NULL,
    "generatedById" TEXT NOT NULL,
    "generatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "signedPdf" BYTEA,
    "signedSha256" TEXT,
    "signerName" TEXT,
    "signedAt" TIMESTAMPTZ(3),
    "signatureCapturedById" TEXT,

    CONSTRAINT "rental_agreements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "handover_checks" (
    "id" TEXT NOT NULL,
    "rentalItemId" TEXT NOT NULL,
    "guideId" TEXT NOT NULL,
    "batteryPct" INTEGER NOT NULL,
    "gpsFix" BOOLEAN NOT NULL,
    "pskVerified" BOOLEAN NOT NULL,
    "passed" BOOLEAN NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "handover_checks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "return_inspections" (
    "id" TEXT NOT NULL,
    "rentalItemId" TEXT NOT NULL,
    "inspectorId" TEXT NOT NULL,
    "condition" "ReturnCondition" NOT NULL,
    "accessoriesComplete" BOOLEAN NOT NULL,
    "batteryPct" INTEGER,
    "damageNotes" TEXT,
    "evidenceRefs" TEXT[],
    "serviceable" BOOLEAN NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "return_inspections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "booking_status_history" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "fromStatus" "BookingStatus",
    "toStatus" "BookingStatus" NOT NULL,
    "actorId" TEXT,
    "reason" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "booking_status_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rental_status_history" (
    "id" TEXT NOT NULL,
    "rentalId" TEXT NOT NULL,
    "fromStatus" "RentalStatus",
    "toStatus" "RentalStatus" NOT NULL,
    "actorId" TEXT,
    "reason" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rental_status_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pricing_rules" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "component" "PriceComponent" NOT NULL,
    "scope" "PricingScope" NOT NULL,
    "packageId" TEXT,
    "hardwareVariantId" TEXT,
    "channel" TEXT,
    "unit" "PriceUnit" NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "minQuantity" INTEGER NOT NULL DEFAULT 1,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "validFrom" TIMESTAMPTZ(3) NOT NULL,
    "validTo" TIMESTAMPTZ(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "pricing_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "damage_fee_rules" (
    "id" TEXT NOT NULL,
    "condition" "DamageCondition" NOT NULL,
    "hardwareVariantId" TEXT,
    "amount" DECIMAL(14,2) NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "damage_fee_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoices" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "kind" "InvoiceKind" NOT NULL,
    "bookingId" TEXT,
    "rentalId" TEXT,
    "customerId" TEXT,
    "billToName" TEXT NOT NULL,
    "status" "InvoiceStatus" NOT NULL DEFAULT 'ISSUED',
    "currency" TEXT NOT NULL,
    "total" DECIMAL(14,2) NOT NULL,
    "balanceDue" DECIMAL(14,2) NOT NULL,
    "refundDue" DECIMAL(14,2) NOT NULL,
    "dueAt" TIMESTAMPTZ(3),
    "adjustsInvoiceId" TEXT,
    "factsSnapshot" JSONB,
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
    "quantity" DECIMAL(10,2) NOT NULL,
    "unitAmount" DECIMAL(14,2) NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "sourceType" TEXT,
    "sourceId" TEXT,
    "deviceId" TEXT,

    CONSTRAINT "invoice_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "direction" "PaymentDirection" NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "status" "PaymentStatus" NOT NULL,
    "failureReason" TEXT,
    "method" TEXT NOT NULL,
    "sandbox" BOOLEAN NOT NULL DEFAULT true,
    "idempotencyKey" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "providerRef" TEXT,
    "actorId" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fee_waivers" (
    "id" TEXT NOT NULL,
    "invoiceLineId" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "WaiverStatus" NOT NULL,
    "requestedById" TEXT NOT NULL,
    "inspectorId" TEXT,
    "decidedById" TEXT,
    "decisionNote" TEXT,
    "adjustmentInvoiceId" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedAt" TIMESTAMPTZ(3),

    CONSTRAINT "fee_waivers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "incidents" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "deviceId" TEXT,
    "tripId" TEXT,
    "rentalId" TEXT,
    "unassigned" BOOLEAN NOT NULL DEFAULT false,
    "source" "IncidentSource" NOT NULL,
    "confidence" "IncidentConfidence" NOT NULL,
    "status" "IncidentStatus" NOT NULL DEFAULT 'DETECTED',
    "openedByEventId" TEXT,
    "firstEventAt" TIMESTAMPTZ(3) NOT NULL,
    "lastEventAt" TIMESTAMPTZ(3) NOT NULL,
    "eventCount" INTEGER NOT NULL DEFAULT 1,
    "lastLatitude" DOUBLE PRECISION,
    "lastLongitude" DOUBLE PRECISION,
    "title" TEXT,
    "description" TEXT,
    "acknowledgedAt" TIMESTAMPTZ(3),
    "acknowledgedById" TEXT,
    "resolvedAt" TIMESTAMPTZ(3),
    "resolution" "IncidentResolution",
    "closedAt" TIMESTAMPTZ(3),
    "escalatedAt" TIMESTAMPTZ(3),
    "reopenCount" INTEGER NOT NULL DEFAULT 0,
    "dismissedAt" TIMESTAMPTZ(3),
    "createdById" TEXT,
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "incidents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "incident_audits" (
    "id" TEXT NOT NULL,
    "incidentId" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "action" "IncidentAction" NOT NULL,
    "actorId" TEXT,
    "actorRole" TEXT NOT NULL,
    "fromStatus" "IncidentStatus",
    "toStatus" "IncidentStatus",
    "note" TEXT,
    "refEventId" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "incident_audits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gateway_events" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "gatewayId" TEXT NOT NULL,
    "ingress" "IngressPath" NOT NULL,
    "kind" "EventKind" NOT NULL,
    "priority" "PriorityTier" NOT NULL DEFAULT 'P3_TELEMETRY',
    "observedAt" TIMESTAMPTZ(3),
    "receivedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "altitude" DOUBLE PRECISION,
    "rssi" INTEGER,
    "snr" DOUBLE PRECISION,
    "hopsAway" INTEGER,
    "payload" JSONB NOT NULL,
    "incidentId" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "gateway_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sync_audit_log" (
    "id" TEXT NOT NULL,
    "eventId" TEXT,
    "nodeNum" BIGINT,
    "deviceId" TEXT,
    "ingress" "IngressPath" NOT NULL,
    "outcome" "SyncOutcome" NOT NULL,
    "detail" TEXT,
    "rawMessage" JSONB,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sync_audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gateways" (
    "id" TEXT NOT NULL,
    "gatewayKey" TEXT NOT NULL,
    "label" TEXT,
    "ingress" "IngressPath" NOT NULL,
    "lastPacketAt" TIMESTAMPTZ(3),
    "apiKeyHash" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "gateways_pkey" PRIMARY KEY ("id")
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
    "flashBytes" INTEGER NOT NULL,
    "flashBudget" INTEGER NOT NULL,
    "rebootDetected" BOOLEAN NOT NULL DEFAULT false,
    "receivedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "device_queue_reports_pkey" PRIMARY KEY ("id")
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
CREATE UNIQUE INDEX "users_username_key" ON "users"("username");

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
CREATE UNIQUE INDEX "hardware_variants_code_key" ON "hardware_variants"("code");

-- CreateIndex
CREATE UNIQUE INDEX "devices_assetTag_key" ON "devices"("assetTag");

-- CreateIndex
CREATE UNIQUE INDEX "devices_nodeNum_key" ON "devices"("nodeNum");

-- CreateIndex
CREATE UNIQUE INDEX "devices_macAddress_key" ON "devices"("macAddress");

-- CreateIndex
CREATE INDEX "devices_status_idx" ON "devices"("status");

-- CreateIndex
CREATE INDEX "devices_hardwareVariantId_status_idx" ON "devices"("hardwareVariantId", "status");

-- CreateIndex
CREATE INDEX "device_status_history_deviceId_createdAt_idx" ON "device_status_history"("deviceId", "createdAt");

-- CreateIndex
CREATE INDEX "device_status_history_actorId_idx" ON "device_status_history"("actorId");

-- CreateIndex
CREATE INDEX "maintenance_records_deviceId_status_idx" ON "maintenance_records"("deviceId", "status");

-- CreateIndex
CREATE INDEX "maintenance_records_openedById_idx" ON "maintenance_records"("openedById");

-- CreateIndex
CREATE INDEX "maintenance_records_closedById_idx" ON "maintenance_records"("closedById");

-- CreateIndex
CREATE INDEX "device_provisioning_deviceId_createdAt_idx" ON "device_provisioning"("deviceId", "createdAt");

-- CreateIndex
CREATE INDEX "device_provisioning_provisionedById_idx" ON "device_provisioning"("provisionedById");

-- CreateIndex
CREATE UNIQUE INDEX "trek_packages_code_key" ON "trek_packages"("code");

-- CreateIndex
CREATE UNIQUE INDEX "trips_code_key" ON "trips"("code");

-- CreateIndex
CREATE UNIQUE INDEX "trips_requestId_key" ON "trips"("requestId");

-- CreateIndex
CREATE INDEX "trips_status_startAt_idx" ON "trips"("status", "startAt");

-- CreateIndex
CREATE INDEX "trips_packageId_idx" ON "trips"("packageId");

-- CreateIndex
CREATE INDEX "trips_createdById_idx" ON "trips"("createdById");

-- CreateIndex
CREATE INDEX "trip_guide_assignments_guideId_unassignedAt_idx" ON "trip_guide_assignments"("guideId", "unassignedAt");

-- CreateIndex
CREATE INDEX "trip_guide_assignments_tripId_idx" ON "trip_guide_assignments"("tripId");

-- CreateIndex
CREATE INDEX "trip_guide_assignments_assignedById_idx" ON "trip_guide_assignments"("assignedById");

-- CreateIndex
CREATE INDEX "trip_participants_tripId_idx" ON "trip_participants"("tripId");

-- CreateIndex
CREATE INDEX "trip_participants_bookingId_idx" ON "trip_participants"("bookingId");

-- CreateIndex
CREATE INDEX "trip_participants_userId_idx" ON "trip_participants"("userId");

-- CreateIndex
CREATE INDEX "trip_readiness_checks_tripId_createdAt_idx" ON "trip_readiness_checks"("tripId", "createdAt");

-- CreateIndex
CREATE INDEX "trip_readiness_checks_guideId_idx" ON "trip_readiness_checks"("guideId");

-- CreateIndex
CREATE INDEX "trip_requests_guideId_idx" ON "trip_requests"("guideId");

-- CreateIndex
CREATE INDEX "trip_requests_packageId_idx" ON "trip_requests"("packageId");

-- CreateIndex
CREATE INDEX "trip_requests_decidedById_idx" ON "trip_requests"("decidedById");

-- CreateIndex
CREATE INDEX "trip_status_history_tripId_createdAt_idx" ON "trip_status_history"("tripId", "createdAt");

-- CreateIndex
CREATE INDEX "trip_status_history_actorId_idx" ON "trip_status_history"("actorId");

-- CreateIndex
CREATE UNIQUE INDEX "bookings_code_key" ON "bookings"("code");

-- CreateIndex
CREATE INDEX "bookings_tripId_status_idx" ON "bookings"("tripId", "status");

-- CreateIndex
CREATE INDEX "bookings_customerId_status_idx" ON "bookings"("customerId", "status");

-- CreateIndex
CREATE INDEX "bookings_createdById_idx" ON "bookings"("createdById");

-- CreateIndex
CREATE INDEX "bookings_confirmedById_idx" ON "bookings"("confirmedById");

-- CreateIndex
CREATE UNIQUE INDEX "device_allocations_rentalItemId_key" ON "device_allocations"("rentalItemId");

-- CreateIndex
CREATE INDEX "device_allocations_deviceId_status_idx" ON "device_allocations"("deviceId", "status");

-- CreateIndex
CREATE INDEX "device_allocations_status_holdExpiresAt_idx" ON "device_allocations"("status", "holdExpiresAt");

-- CreateIndex
CREATE INDEX "device_allocations_bookingId_idx" ON "device_allocations"("bookingId");

-- CreateIndex
CREATE INDEX "device_allocations_createdById_idx" ON "device_allocations"("createdById");

-- CreateIndex
CREATE UNIQUE INDEX "rentals_code_key" ON "rentals"("code");

-- CreateIndex
CREATE UNIQUE INDEX "rentals_bookingId_key" ON "rentals"("bookingId");

-- CreateIndex
CREATE INDEX "rentals_tripId_status_idx" ON "rentals"("tripId", "status");

-- CreateIndex
CREATE INDEX "rentals_custodianGuideId_status_idx" ON "rentals"("custodianGuideId", "status");

-- CreateIndex
CREATE INDEX "rentals_renterId_idx" ON "rentals"("renterId");

-- CreateIndex
CREATE INDEX "rentals_checkedOutById_idx" ON "rentals"("checkedOutById");

-- CreateIndex
CREATE INDEX "rentals_settlementInvoiceId_idx" ON "rentals"("settlementInvoiceId");

-- CreateIndex
CREATE INDEX "rentals_closedById_idx" ON "rentals"("closedById");

-- CreateIndex
CREATE INDEX "rentals_createdById_idx" ON "rentals"("createdById");

-- CreateIndex
CREATE INDEX "rental_items_rentalId_idx" ON "rental_items"("rentalId");

-- CreateIndex
CREATE INDEX "rental_items_deviceId_state_idx" ON "rental_items"("deviceId", "state");

-- CreateIndex
CREATE INDEX "rental_items_participantId_idx" ON "rental_items"("participantId");

-- CreateIndex
CREATE INDEX "rental_items_receivedById_idx" ON "rental_items"("receivedById");

-- CreateIndex
CREATE INDEX "rental_items_replacedByItemId_idx" ON "rental_items"("replacedByItemId");

-- CreateIndex
CREATE INDEX "rental_items_lostConfirmedById_idx" ON "rental_items"("lostConfirmedById");

-- CreateIndex
CREATE INDEX "rental_agreements_generatedById_idx" ON "rental_agreements"("generatedById");

-- CreateIndex
CREATE INDEX "rental_agreements_signatureCapturedById_idx" ON "rental_agreements"("signatureCapturedById");

-- CreateIndex
CREATE UNIQUE INDEX "rental_agreements_rentalId_version_key" ON "rental_agreements"("rentalId", "version");

-- CreateIndex
CREATE INDEX "handover_checks_rentalItemId_idx" ON "handover_checks"("rentalItemId");

-- CreateIndex
CREATE INDEX "handover_checks_guideId_idx" ON "handover_checks"("guideId");

-- CreateIndex
CREATE UNIQUE INDEX "return_inspections_rentalItemId_key" ON "return_inspections"("rentalItemId");

-- CreateIndex
CREATE INDEX "return_inspections_inspectorId_idx" ON "return_inspections"("inspectorId");

-- CreateIndex
CREATE INDEX "booking_status_history_bookingId_idx" ON "booking_status_history"("bookingId");

-- CreateIndex
CREATE INDEX "booking_status_history_actorId_idx" ON "booking_status_history"("actorId");

-- CreateIndex
CREATE INDEX "rental_status_history_rentalId_idx" ON "rental_status_history"("rentalId");

-- CreateIndex
CREATE INDEX "rental_status_history_actorId_idx" ON "rental_status_history"("actorId");

-- CreateIndex
CREATE INDEX "pricing_rules_component_isActive_idx" ON "pricing_rules"("component", "isActive");

-- CreateIndex
CREATE INDEX "pricing_rules_packageId_idx" ON "pricing_rules"("packageId");

-- CreateIndex
CREATE INDEX "pricing_rules_hardwareVariantId_idx" ON "pricing_rules"("hardwareVariantId");

-- CreateIndex
CREATE INDEX "damage_fee_rules_hardwareVariantId_idx" ON "damage_fee_rules"("hardwareVariantId");

-- CreateIndex
CREATE UNIQUE INDEX "damage_fee_rules_condition_hardwareVariantId_key" ON "damage_fee_rules"("condition", "hardwareVariantId");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_number_key" ON "invoices"("number");

-- CreateIndex
CREATE INDEX "invoices_bookingId_idx" ON "invoices"("bookingId");

-- CreateIndex
CREATE INDEX "invoices_rentalId_idx" ON "invoices"("rentalId");

-- CreateIndex
CREATE INDEX "invoices_customerId_issuedAt_idx" ON "invoices"("customerId", "issuedAt");

-- CreateIndex
CREATE INDEX "invoices_adjustsInvoiceId_idx" ON "invoices"("adjustsInvoiceId");

-- CreateIndex
CREATE INDEX "invoice_lines_deviceId_idx" ON "invoice_lines"("deviceId");

-- CreateIndex
CREATE UNIQUE INDEX "invoice_lines_invoiceId_seq_key" ON "invoice_lines"("invoiceId", "seq");

-- CreateIndex
CREATE UNIQUE INDEX "payments_idempotencyKey_key" ON "payments"("idempotencyKey");

-- CreateIndex
CREATE INDEX "payments_invoiceId_createdAt_idx" ON "payments"("invoiceId", "createdAt");

-- CreateIndex
CREATE INDEX "payments_actorId_idx" ON "payments"("actorId");

-- CreateIndex
CREATE INDEX "fee_waivers_invoiceLineId_idx" ON "fee_waivers"("invoiceLineId");

-- CreateIndex
CREATE INDEX "fee_waivers_requestedById_idx" ON "fee_waivers"("requestedById");

-- CreateIndex
CREATE INDEX "fee_waivers_inspectorId_idx" ON "fee_waivers"("inspectorId");

-- CreateIndex
CREATE INDEX "fee_waivers_decidedById_idx" ON "fee_waivers"("decidedById");

-- CreateIndex
CREATE INDEX "fee_waivers_adjustmentInvoiceId_idx" ON "fee_waivers"("adjustmentInvoiceId");

-- CreateIndex
CREATE UNIQUE INDEX "incidents_code_key" ON "incidents"("code");

-- CreateIndex
CREATE UNIQUE INDEX "incidents_openedByEventId_key" ON "incidents"("openedByEventId");

-- CreateIndex
CREATE INDEX "incidents_deviceId_status_lastEventAt_idx" ON "incidents"("deviceId", "status", "lastEventAt");

-- CreateIndex
CREATE INDEX "incidents_tripId_status_idx" ON "incidents"("tripId", "status");

-- CreateIndex
CREATE INDEX "incidents_status_createdAt_idx" ON "incidents"("status", "createdAt");

-- CreateIndex
CREATE INDEX "incidents_rentalId_idx" ON "incidents"("rentalId");

-- CreateIndex
CREATE INDEX "incidents_acknowledgedById_idx" ON "incidents"("acknowledgedById");

-- CreateIndex
CREATE INDEX "incidents_createdById_idx" ON "incidents"("createdById");

-- CreateIndex
CREATE INDEX "incident_audits_actorId_idx" ON "incident_audits"("actorId");

-- CreateIndex
CREATE INDEX "incident_audits_refEventId_idx" ON "incident_audits"("refEventId");

-- CreateIndex
CREATE UNIQUE INDEX "incident_audits_incidentId_seq_key" ON "incident_audits"("incidentId", "seq");

-- CreateIndex
CREATE UNIQUE INDEX "gateway_events_eventId_key" ON "gateway_events"("eventId");

-- CreateIndex
CREATE INDEX "gateway_events_deviceId_receivedAt_idx" ON "gateway_events"("deviceId", "receivedAt");

-- CreateIndex
CREATE INDEX "gateway_events_deviceId_kind_receivedAt_idx" ON "gateway_events"("deviceId", "kind", "receivedAt");

-- CreateIndex
CREATE INDEX "gateway_events_incidentId_idx" ON "gateway_events"("incidentId");

-- CreateIndex
CREATE INDEX "sync_audit_log_outcome_createdAt_idx" ON "sync_audit_log"("outcome", "createdAt");

-- CreateIndex
CREATE INDEX "sync_audit_log_eventId_idx" ON "sync_audit_log"("eventId");

-- CreateIndex
CREATE INDEX "sync_audit_log_deviceId_idx" ON "sync_audit_log"("deviceId");

-- CreateIndex
CREATE UNIQUE INDEX "gateways_gatewayKey_key" ON "gateways"("gatewayKey");

-- CreateIndex
CREATE INDEX "device_queue_reports_deviceId_receivedAt_idx" ON "device_queue_reports"("deviceId", "receivedAt");

-- AddForeignKey
ALTER TABLE "business_parameters" ADD CONSTRAINT "business_parameters_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "business_parameter_history" ADD CONSTRAINT "business_parameter_history_key_fkey" FOREIGN KEY ("key") REFERENCES "business_parameters"("key") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "business_parameter_history" ADD CONSTRAINT "business_parameter_history_changedById_fkey" FOREIGN KEY ("changedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

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
ALTER TABLE "guide_profiles" ADD CONSTRAINT "guide_profiles_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "devices" ADD CONSTRAINT "devices_hardwareVariantId_fkey" FOREIGN KEY ("hardwareVariantId") REFERENCES "hardware_variants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "device_status_history" ADD CONSTRAINT "device_status_history_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "devices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "device_status_history" ADD CONSTRAINT "device_status_history_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maintenance_records" ADD CONSTRAINT "maintenance_records_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "devices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maintenance_records" ADD CONSTRAINT "maintenance_records_openedById_fkey" FOREIGN KEY ("openedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maintenance_records" ADD CONSTRAINT "maintenance_records_closedById_fkey" FOREIGN KEY ("closedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "device_provisioning" ADD CONSTRAINT "device_provisioning_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "devices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "device_provisioning" ADD CONSTRAINT "device_provisioning_provisionedById_fkey" FOREIGN KEY ("provisionedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trips" ADD CONSTRAINT "trips_packageId_fkey" FOREIGN KEY ("packageId") REFERENCES "trek_packages"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trips" ADD CONSTRAINT "trips_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "trip_requests"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trips" ADD CONSTRAINT "trips_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trip_guide_assignments" ADD CONSTRAINT "trip_guide_assignments_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "trips"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trip_guide_assignments" ADD CONSTRAINT "trip_guide_assignments_guideId_fkey" FOREIGN KEY ("guideId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trip_guide_assignments" ADD CONSTRAINT "trip_guide_assignments_assignedById_fkey" FOREIGN KEY ("assignedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trip_participants" ADD CONSTRAINT "trip_participants_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "trips"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trip_participants" ADD CONSTRAINT "trip_participants_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "bookings"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trip_participants" ADD CONSTRAINT "trip_participants_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trip_readiness_checks" ADD CONSTRAINT "trip_readiness_checks_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "trips"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trip_readiness_checks" ADD CONSTRAINT "trip_readiness_checks_guideId_fkey" FOREIGN KEY ("guideId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trip_requests" ADD CONSTRAINT "trip_requests_guideId_fkey" FOREIGN KEY ("guideId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trip_requests" ADD CONSTRAINT "trip_requests_packageId_fkey" FOREIGN KEY ("packageId") REFERENCES "trek_packages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trip_requests" ADD CONSTRAINT "trip_requests_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trip_status_history" ADD CONSTRAINT "trip_status_history_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "trips"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trip_status_history" ADD CONSTRAINT "trip_status_history_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "trips"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_confirmedById_fkey" FOREIGN KEY ("confirmedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "device_allocations" ADD CONSTRAINT "device_allocations_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "devices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "device_allocations" ADD CONSTRAINT "device_allocations_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "bookings"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "device_allocations" ADD CONSTRAINT "device_allocations_rentalItemId_fkey" FOREIGN KEY ("rentalItemId") REFERENCES "rental_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "device_allocations" ADD CONSTRAINT "device_allocations_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rentals" ADD CONSTRAINT "rentals_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "bookings"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rentals" ADD CONSTRAINT "rentals_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "trips"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rentals" ADD CONSTRAINT "rentals_renterId_fkey" FOREIGN KEY ("renterId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rentals" ADD CONSTRAINT "rentals_custodianGuideId_fkey" FOREIGN KEY ("custodianGuideId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rentals" ADD CONSTRAINT "rentals_checkedOutById_fkey" FOREIGN KEY ("checkedOutById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rentals" ADD CONSTRAINT "rentals_settlementInvoiceId_fkey" FOREIGN KEY ("settlementInvoiceId") REFERENCES "invoices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rentals" ADD CONSTRAINT "rentals_closedById_fkey" FOREIGN KEY ("closedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rentals" ADD CONSTRAINT "rentals_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rental_items" ADD CONSTRAINT "rental_items_rentalId_fkey" FOREIGN KEY ("rentalId") REFERENCES "rentals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rental_items" ADD CONSTRAINT "rental_items_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "devices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rental_items" ADD CONSTRAINT "rental_items_participantId_fkey" FOREIGN KEY ("participantId") REFERENCES "trip_participants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rental_items" ADD CONSTRAINT "rental_items_receivedById_fkey" FOREIGN KEY ("receivedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rental_items" ADD CONSTRAINT "rental_items_replacedByItemId_fkey" FOREIGN KEY ("replacedByItemId") REFERENCES "rental_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rental_items" ADD CONSTRAINT "rental_items_lostConfirmedById_fkey" FOREIGN KEY ("lostConfirmedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rental_agreements" ADD CONSTRAINT "rental_agreements_rentalId_fkey" FOREIGN KEY ("rentalId") REFERENCES "rentals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rental_agreements" ADD CONSTRAINT "rental_agreements_generatedById_fkey" FOREIGN KEY ("generatedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rental_agreements" ADD CONSTRAINT "rental_agreements_signatureCapturedById_fkey" FOREIGN KEY ("signatureCapturedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "handover_checks" ADD CONSTRAINT "handover_checks_rentalItemId_fkey" FOREIGN KEY ("rentalItemId") REFERENCES "rental_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "handover_checks" ADD CONSTRAINT "handover_checks_guideId_fkey" FOREIGN KEY ("guideId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "return_inspections" ADD CONSTRAINT "return_inspections_rentalItemId_fkey" FOREIGN KEY ("rentalItemId") REFERENCES "rental_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "return_inspections" ADD CONSTRAINT "return_inspections_inspectorId_fkey" FOREIGN KEY ("inspectorId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_status_history" ADD CONSTRAINT "booking_status_history_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "bookings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_status_history" ADD CONSTRAINT "booking_status_history_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rental_status_history" ADD CONSTRAINT "rental_status_history_rentalId_fkey" FOREIGN KEY ("rentalId") REFERENCES "rentals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rental_status_history" ADD CONSTRAINT "rental_status_history_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pricing_rules" ADD CONSTRAINT "pricing_rules_packageId_fkey" FOREIGN KEY ("packageId") REFERENCES "trek_packages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pricing_rules" ADD CONSTRAINT "pricing_rules_hardwareVariantId_fkey" FOREIGN KEY ("hardwareVariantId") REFERENCES "hardware_variants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "damage_fee_rules" ADD CONSTRAINT "damage_fee_rules_hardwareVariantId_fkey" FOREIGN KEY ("hardwareVariantId") REFERENCES "hardware_variants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "bookings"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_rentalId_fkey" FOREIGN KEY ("rentalId") REFERENCES "rentals"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_adjustsInvoiceId_fkey" FOREIGN KEY ("adjustsInvoiceId") REFERENCES "invoices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "devices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fee_waivers" ADD CONSTRAINT "fee_waivers_invoiceLineId_fkey" FOREIGN KEY ("invoiceLineId") REFERENCES "invoice_lines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fee_waivers" ADD CONSTRAINT "fee_waivers_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fee_waivers" ADD CONSTRAINT "fee_waivers_inspectorId_fkey" FOREIGN KEY ("inspectorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fee_waivers" ADD CONSTRAINT "fee_waivers_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fee_waivers" ADD CONSTRAINT "fee_waivers_adjustmentInvoiceId_fkey" FOREIGN KEY ("adjustmentInvoiceId") REFERENCES "invoices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "devices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "trips"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_rentalId_fkey" FOREIGN KEY ("rentalId") REFERENCES "rentals"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_openedByEventId_fkey" FOREIGN KEY ("openedByEventId") REFERENCES "gateway_events"("eventId") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_acknowledgedById_fkey" FOREIGN KEY ("acknowledgedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incident_audits" ADD CONSTRAINT "incident_audits_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "incidents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incident_audits" ADD CONSTRAINT "incident_audits_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incident_audits" ADD CONSTRAINT "incident_audits_refEventId_fkey" FOREIGN KEY ("refEventId") REFERENCES "gateway_events"("eventId") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gateway_events" ADD CONSTRAINT "gateway_events_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "devices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gateway_events" ADD CONSTRAINT "gateway_events_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "incidents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sync_audit_log" ADD CONSTRAINT "sync_audit_log_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "devices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "device_queue_reports" ADD CONSTRAINT "device_queue_reports_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "devices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ─── Constraints Prisma cannot express (platform task 1.5) ───────────────────────────────
-- Column names are the Prisma field names (camelCase); only table names are mapped (decision 3).

-- rentals, BR-01: a device is never allocated twice for overlapping time while the allocation
-- is live (specs/rentals/design.md §1, platform design Figure 8).
CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE "device_allocations"
  ADD CONSTRAINT "no_double_allocation"
  EXCLUDE USING gist ("deviceId" WITH =, tstzrange("windowStart", "windowEnd", '[)') WITH &&)
  WHERE ("status" IN ('HELD', 'CONFIRMED', 'CHECKED_OUT'));

-- trips (specs/trips/design.md §1)
ALTER TABLE "trips"
  ADD CONSTRAINT "trips_seats_taken_within_capacity" CHECK ("seatsTaken" >= 0 AND "seatsTaken" <= "capacity"),
  ADD CONSTRAINT "trips_end_after_start" CHECK ("endAt" > "startAt");

CREATE UNIQUE INDEX "trip_guide_assignments_active_guide_key"
  ON "trip_guide_assignments" ("tripId", "guideId")
  WHERE "unassignedAt" IS NULL;

CREATE UNIQUE INDEX "trip_guide_assignments_active_lead_key"
  ON "trip_guide_assignments" ("tripId")
  WHERE "role" = 'LEAD' AND "unassignedAt" IS NULL;

-- Append-only tables (REQ-UBI-07, platform design §4.5): the database rejects UPDATE and DELETE.
CREATE OR REPLACE FUNCTION raise_append_only() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% on append-only table % is not allowed', TG_OP, TG_TABLE_NAME;
END;
$$;

CREATE TRIGGER "audit_log_append_only" BEFORE UPDATE OR DELETE ON "audit_log"
  FOR EACH ROW EXECUTE FUNCTION raise_append_only();
CREATE TRIGGER "business_parameter_history_append_only" BEFORE UPDATE OR DELETE ON "business_parameter_history"
  FOR EACH ROW EXECUTE FUNCTION raise_append_only();
CREATE TRIGGER "device_status_history_append_only" BEFORE UPDATE OR DELETE ON "device_status_history"
  FOR EACH ROW EXECUTE FUNCTION raise_append_only();
CREATE TRIGGER "device_provisioning_append_only" BEFORE UPDATE OR DELETE ON "device_provisioning"
  FOR EACH ROW EXECUTE FUNCTION raise_append_only();
CREATE TRIGGER "trip_status_history_append_only" BEFORE UPDATE OR DELETE ON "trip_status_history"
  FOR EACH ROW EXECUTE FUNCTION raise_append_only();
CREATE TRIGGER "trip_readiness_checks_append_only" BEFORE UPDATE OR DELETE ON "trip_readiness_checks"
  FOR EACH ROW EXECUTE FUNCTION raise_append_only();
CREATE TRIGGER "booking_status_history_append_only" BEFORE UPDATE OR DELETE ON "booking_status_history"
  FOR EACH ROW EXECUTE FUNCTION raise_append_only();
CREATE TRIGGER "rental_status_history_append_only" BEFORE UPDATE OR DELETE ON "rental_status_history"
  FOR EACH ROW EXECUTE FUNCTION raise_append_only();
CREATE TRIGGER "handover_checks_append_only" BEFORE UPDATE OR DELETE ON "handover_checks"
  FOR EACH ROW EXECUTE FUNCTION raise_append_only();
CREATE TRIGGER "return_inspections_append_only" BEFORE UPDATE OR DELETE ON "return_inspections"
  FOR EACH ROW EXECUTE FUNCTION raise_append_only();
CREATE TRIGGER "incident_audits_append_only" BEFORE UPDATE OR DELETE ON "incident_audits"
  FOR EACH ROW EXECUTE FUNCTION raise_append_only();
-- gateway_events is append-only with one exception (leader decision 1, PR #12): an UPDATE that
-- only sets "incidentId" from NULL to a value, which links an accepted event to the episode it
-- opened or joined. Any other UPDATE, and every DELETE, is rejected. "priority" is set at insert.
CREATE OR REPLACE FUNCTION gateway_events_append_only() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND OLD."incidentId" IS NULL
     AND NEW."incidentId" IS NOT NULL
     AND (to_jsonb(NEW) - 'incidentId') = (to_jsonb(OLD) - 'incidentId') THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION '% on append-only table % is not allowed', TG_OP, TG_TABLE_NAME;
END;
$$;

CREATE TRIGGER "gateway_events_append_only" BEFORE UPDATE OR DELETE ON "gateway_events"
  FOR EACH ROW EXECUTE FUNCTION gateway_events_append_only();
