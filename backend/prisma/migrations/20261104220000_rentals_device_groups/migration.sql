-- Rentals Phase 9 (design §11): schema, constraints, depth parameter and permissions.
BEGIN;

-- CreateEnum
CREATE TYPE "GroupExit" AS ENUM ('MOVED', 'UNASSIGNED', 'GROUP_REMOVED', 'CHECKED_IN', 'LOST', 'REPLACED', 'RELEASED');

-- CreateEnum
CREATE TYPE "FaultResolution" AS ENUM ('REPLACED', 'CHECKED_IN', 'LOST', 'RELEASED');

-- CreateTable
CREATE TABLE "groups" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "parentId" TEXT,
    "name" TEXT NOT NULL,
    "label" TEXT,
    "startsOn" DATE,
    "endsOn" DATE,
    "areaNote" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "removedAt" TIMESTAMPTZ(3),

    CONSTRAINT "groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "group_assignments" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "contractDeviceId" TEXT NOT NULL,
    "assignedById" TEXT NOT NULL,
    "assignedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMPTZ(3),
    "endedReason" "GroupExit",

    CONSTRAINT "group_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "device_fault_reports" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    "contractDeviceId" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "reportedById" TEXT NOT NULL,
    "reportedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMPTZ(3),
    "resolution" "FaultResolution",

    CONSTRAINT "device_fault_reports_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "groups_parentId_organizationId_idx" ON "groups"("parentId", "organizationId");

-- CreateIndex
CREATE INDEX "groups_createdById_idx" ON "groups"("createdById");

-- CreateIndex
CREATE UNIQUE INDEX "groups_organizationId_id_key" ON "groups"("organizationId", "id");

-- CreateIndex
CREATE INDEX "group_assignments_groupId_idx" ON "group_assignments"("groupId");

-- CreateIndex
CREATE INDEX "group_assignments_deviceId_idx" ON "group_assignments"("deviceId");

-- CreateIndex
CREATE INDEX "group_assignments_contractDeviceId_idx" ON "group_assignments"("contractDeviceId");

-- CreateIndex
CREATE INDEX "group_assignments_assignedById_idx" ON "group_assignments"("assignedById");

-- CreateIndex
CREATE INDEX "device_fault_reports_organizationId_idx" ON "device_fault_reports"("organizationId");

-- CreateIndex
CREATE INDEX "device_fault_reports_contractId_idx" ON "device_fault_reports"("contractId");

-- CreateIndex
CREATE INDEX "device_fault_reports_contractDeviceId_idx" ON "device_fault_reports"("contractDeviceId");

-- CreateIndex
CREATE INDEX "device_fault_reports_deviceId_idx" ON "device_fault_reports"("deviceId");

-- CreateIndex
CREATE INDEX "device_fault_reports_reportedById_idx" ON "device_fault_reports"("reportedById");

-- AddForeignKey
ALTER TABLE "groups" ADD CONSTRAINT "groups_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "groups" ADD CONSTRAINT "groups_organizationId_parentId_fkey" FOREIGN KEY ("organizationId", "parentId") REFERENCES "groups"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "groups" ADD CONSTRAINT "groups_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "group_assignments" ADD CONSTRAINT "group_assignments_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "group_assignments" ADD CONSTRAINT "group_assignments_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "devices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "group_assignments" ADD CONSTRAINT "group_assignments_contractDeviceId_fkey" FOREIGN KEY ("contractDeviceId") REFERENCES "contract_devices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "group_assignments" ADD CONSTRAINT "group_assignments_assignedById_fkey" FOREIGN KEY ("assignedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "device_fault_reports" ADD CONSTRAINT "device_fault_reports_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "device_fault_reports" ADD CONSTRAINT "device_fault_reports_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "rental_contracts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "device_fault_reports" ADD CONSTRAINT "device_fault_reports_contractDeviceId_fkey" FOREIGN KEY ("contractDeviceId") REFERENCES "contract_devices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "device_fault_reports" ADD CONSTRAINT "device_fault_reports_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "devices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "device_fault_reports" ADD CONSTRAINT "device_fault_reports_reportedById_fkey" FOREIGN KEY ("reportedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Constraints Prisma cannot express. Keep the definitions in prisma/constraints.sql in sync.
CREATE UNIQUE INDEX "groups_live_name"
  ON "groups" ("organizationId", COALESCE("parentId", '00000000-0000-0000-0000-000000000000'), lower("name"))
  WHERE "removedAt" IS NULL;
ALTER TABLE "groups"
  ADD CONSTRAINT "groups_dates_in_order" CHECK ("endsOn" >= "startsOn");

CREATE UNIQUE INDEX "group_assignments_one_open"
  ON "group_assignments" ("deviceId")
  WHERE "endedAt" IS NULL;
CREATE UNIQUE INDEX "device_fault_reports_one_open"
  ON "device_fault_reports" ("contractDeviceId")
  WHERE "resolvedAt" IS NULL;

-- Forward seed rows for rentals Phase 9. The applied seed migration stays intact.
INSERT INTO "business_parameters" ("key", "value", "valueType", "bounds", "unit", "ownerModule", "description", "version", "updatedAt") VALUES
  ('rentals.groupMaxDepth', '1'::jsonb, 'INT', '{"min": 1, "max": 3}'::jsonb, 'subgroup levels', 'rentals', 'Maximum group depth below a top-level group', 1, CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "permissions" ("id", "key", "action", "subject", "accountType", "conditions", "fields") VALUES
  (gen_random_uuid()::text, 'group.read.own', 'read', 'Group', 'ORGANIZATION', '{"organizationId": "${user.organizationId}"}'::jsonb, ARRAY[]::text[]),
  (gen_random_uuid()::text, 'group.read', 'read', 'Group', 'TREKLINK', NULL, ARRAY[]::text[]),
  (gen_random_uuid()::text, 'group.manage.own', 'manage', 'Group', 'ORGANIZATION', '{"organizationId": "${user.organizationId}"}'::jsonb, ARRAY[]::text[]),
  (gen_random_uuid()::text, 'faultReport.create.own', 'create', 'DeviceFaultReport', 'ORGANIZATION', '{"organizationId": "${user.organizationId}"}'::jsonb, ARRAY[]::text[]),
  (gen_random_uuid()::text, 'faultReport.read.own', 'read', 'DeviceFaultReport', 'ORGANIZATION', '{"organizationId": "${user.organizationId}"}'::jsonb, ARRAY[]::text[]),
  (gen_random_uuid()::text, 'faultReport.read', 'read', 'DeviceFaultReport', 'TREKLINK', NULL, ARRAY[]::text[])
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "role_permissions" ("roleId", "permissionId")
SELECT r."id", p."id" FROM (VALUES
  ('ORG_OPERATOR', 'group.read.own'),
  ('ORG_MANAGER', 'group.read.own'),
  ('STAFF', 'group.read'),
  ('ADMIN', 'group.read'),
  ('ORG_MANAGER', 'group.manage.own'),
  ('ORG_MANAGER', 'faultReport.create.own'),
  ('ORG_MANAGER', 'faultReport.read.own'),
  ('STAFF', 'faultReport.read'),
  ('ADMIN', 'faultReport.read')
) AS g("role", "perm")
JOIN "roles" r ON r."key" = g."role"
JOIN "permissions" p ON p."key" = g."perm"
ON CONFLICT DO NOTHING;

COMMIT;
