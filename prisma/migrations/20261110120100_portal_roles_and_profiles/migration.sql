-- ============================================================
-- Migration: portal_roles_and_profiles
--
-- Purpose:
--   * Add UserAccountStatus enum + User.accountStatus
--   * Link portal Users to their Landlord / Tenant / ServiceProvider
--     profile records via unique nullable FKs
--   * Add ServiceProviderProperty join table (multi-property
--     service provider assignments) and backfill it from the
--     legacy ServiceProvider.propertyId column
--
-- This file depends on `portal_roles_enum` having added the new
-- Role values. All changes are additive. No existing column,
-- constraint, or index is renamed or dropped.
-- ============================================================

-- ── 1. UserAccountStatus enum ───────────────────────────────
CREATE TYPE "UserAccountStatus" AS ENUM (
  'PENDING_INVITATION',
  'ACTIVE',
  'SUSPENDED',
  'DISABLED'
);

-- ── 2. User: accountStatus + profile FKs ────────────────────
ALTER TABLE "User"
  ADD COLUMN "accountStatus"            "UserAccountStatus" NOT NULL DEFAULT 'ACTIVE',
  ADD COLUMN "landlordProfileId"        TEXT,
  ADD COLUMN "tenantProfileId"          TEXT,
  ADD COLUMN "serviceProviderProfileId" TEXT;

-- Uniqueness: one portal profile may back at most one User account
CREATE UNIQUE INDEX "User_landlordProfileId_key"
  ON "User" ("landlordProfileId");

CREATE UNIQUE INDEX "User_tenantProfileId_key"
  ON "User" ("tenantProfileId");

CREATE UNIQUE INDEX "User_serviceProviderProfileId_key"
  ON "User" ("serviceProviderProfileId");

-- Foreign keys (nullable; ON DELETE SET NULL means deleting the
-- profile does not orphan or delete the account, it just unlinks it)
ALTER TABLE "User"
  ADD CONSTRAINT "User_landlordProfileId_fkey"
    FOREIGN KEY ("landlordProfileId")
    REFERENCES "Landlord"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "User"
  ADD CONSTRAINT "User_tenantProfileId_fkey"
    FOREIGN KEY ("tenantProfileId")
    REFERENCES "Tenant"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "User"
  ADD CONSTRAINT "User_serviceProviderProfileId_fkey"
    FOREIGN KEY ("serviceProviderProfileId")
    REFERENCES "ServiceProvider"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- ── 3. ServiceProviderProperty join table ───────────────────
CREATE TABLE "ServiceProviderProperty" (
  "id"                TEXT         NOT NULL,
  "serviceProviderId" TEXT         NOT NULL,
  "propertyId"        TEXT         NOT NULL,
  "isActive"          BOOLEAN      NOT NULL DEFAULT TRUE,
  "assignedAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "assignedById"      TEXT,

  CONSTRAINT "ServiceProviderProperty_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ServiceProviderProperty_serviceProviderId_propertyId_key"
  ON "ServiceProviderProperty" ("serviceProviderId", "propertyId");

CREATE INDEX "ServiceProviderProperty_serviceProviderId_isActive_idx"
  ON "ServiceProviderProperty" ("serviceProviderId", "isActive");

CREATE INDEX "ServiceProviderProperty_propertyId_isActive_idx"
  ON "ServiceProviderProperty" ("propertyId", "isActive");

ALTER TABLE "ServiceProviderProperty"
  ADD CONSTRAINT "ServiceProviderProperty_serviceProviderId_fkey"
    FOREIGN KEY ("serviceProviderId")
    REFERENCES "ServiceProvider"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ServiceProviderProperty"
  ADD CONSTRAINT "ServiceProviderProperty_propertyId_fkey"
    FOREIGN KEY ("propertyId")
    REFERENCES "Property"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- ── 4. Backfill legacy single-property → join table ─────────
-- For every ServiceProvider that already has a propertyId,
-- create one active row in the join table. Uses md5(...) for the
-- primary key so we don't depend on pgcrypto / PG-13's
-- gen_random_uuid(); the exact hash value is unimportant because
-- these are backfilled synthetic IDs, not user-facing IDs.
INSERT INTO "ServiceProviderProperty"
  ("id", "serviceProviderId", "propertyId", "isActive", "assignedAt", "assignedById")
SELECT
  md5(random()::text || clock_timestamp()::text || sp."id"),
  sp."id",
  sp."propertyId",
  TRUE,
  CURRENT_TIMESTAMP,
  NULL
FROM "ServiceProvider" sp
WHERE sp."propertyId" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM "ServiceProviderProperty" spp
    WHERE spp."serviceProviderId" = sp."id"
      AND spp."propertyId"        = sp."propertyId"
  );