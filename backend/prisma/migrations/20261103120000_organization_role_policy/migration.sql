-- D-095, specs/auth/design.md section 9: what one organization changed in the permissions of its two
-- roles. Two tables, the catalog entries organizationRole.manage.own (Manager, protected) and
-- organizationRole.read (Staff, held by Admin through FR-AUTH-10), and the parameter
-- auth.permissionCacheTtlSeconds. A forward migration because the seed migration is applied to the
-- shared database; scripts/specs/catalog.py carries the same rows.
-- CreateEnum
CREATE TYPE "OrganizationRoleEffect" AS ENUM ('GRANT', 'REVOKE');

-- CreateTable
CREATE TABLE "organization_role_policies" (
    "organizationId" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "updatedById" TEXT,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "organization_role_policies_pkey" PRIMARY KEY ("organizationId","roleId")
);

-- CreateTable
CREATE TABLE "organization_role_permissions" (
    "organizationId" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "permissionId" TEXT NOT NULL,
    "effect" "OrganizationRoleEffect" NOT NULL,

    CONSTRAINT "organization_role_permissions_pkey" PRIMARY KEY ("organizationId","roleId","permissionId")
);

-- CreateIndex
CREATE INDEX "organization_role_policies_roleId_idx" ON "organization_role_policies"("roleId");

-- CreateIndex
CREATE INDEX "organization_role_policies_updatedById_idx" ON "organization_role_policies"("updatedById");

-- CreateIndex
CREATE INDEX "organization_role_permissions_permissionId_idx" ON "organization_role_permissions"("permissionId");

-- AddForeignKey
ALTER TABLE "organization_role_policies" ADD CONSTRAINT "organization_role_policies_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organization_role_policies" ADD CONSTRAINT "organization_role_policies_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organization_role_policies" ADD CONSTRAINT "organization_role_policies_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organization_role_permissions" ADD CONSTRAINT "organization_role_permissions_permissionId_fkey" FOREIGN KEY ("permissionId") REFERENCES "permissions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organization_role_permissions" ADD CONSTRAINT "organization_role_permissions_organizationId_roleId_fkey" FOREIGN KEY ("organizationId", "roleId") REFERENCES "organization_role_policies"("organizationId", "roleId") ON DELETE CASCADE ON UPDATE CASCADE;


INSERT INTO "permissions" ("id", "key", "action", "subject", "accountType", "conditions", "fields")
VALUES
  (gen_random_uuid()::text, 'organizationRole.manage.own', 'manage', 'OrganizationRole', 'ORGANIZATION',
   '{"organizationId": "${user.organizationId}"}'::jsonb, ARRAY[]::text[]),
  (gen_random_uuid()::text, 'organizationRole.read', 'read', 'OrganizationRole', 'TREKLINK',
   NULL, ARRAY[]::text[])
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "role_permissions" ("roleId", "permissionId")
SELECT r."id", p."id"
FROM "roles" r, "permissions" p
WHERE (r."key" = 'ORG_MANAGER' AND p."key" = 'organizationRole.manage.own')
   OR (r."key" IN ('STAFF', 'ADMIN') AND p."key" = 'organizationRole.read')
ON CONFLICT DO NOTHING;

INSERT INTO "business_parameters" ("key", "value", "valueType", "bounds", "unit", "ownerModule", "description", "version", "updatedAt") VALUES
  ('auth.permissionCacheTtlSeconds', '30'::jsonb, 'INT', '{"min": 5, "max": 300}'::jsonb, 'seconds', 'auth', 'Longest an entry of the permission cache is served without a new read, so a change made on another instance applies within it', 1, CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO NOTHING;
