-- Complete the Tenant lifecycle fields already represented in schema.prisma.
-- Nullable columns keep this forward migration safe for existing tenant rows.

CREATE TYPE "TenantLeftReason" AS ENUM (
  'LEASE_EXPIRED',
  'VOLUNTARY',
  'EVICTED',
  'NON_PAYMENT',
  'TRANSFERRED',
  'DECEASED',
  'OTHER'
);

ALTER TABLE "Tenant"
  ADD COLUMN "leftAt" TIMESTAMP(3),
  ADD COLUMN "leftReason" "TenantLeftReason";

CREATE INDEX "Tenant_status_idx" ON "Tenant"("status");
CREATE INDEX "Tenant_unitId_status_idx" ON "Tenant"("unitId", "status");
CREATE INDEX "Tenant_leftAt_idx" ON "Tenant"("leftAt");
