-- Distinguish pending access from deliberate disablement and track invitation delivery.
-- All additions are nullable or have non-destructive defaults.

CREATE TYPE "PersonnelPortalAccessStatus" AS ENUM (
  'PENDING_ACTIVATION',
  'ACTIVE',
  'DISABLED'
);

CREATE TYPE "AccountTokenDeliveryStatus" AS ENUM (
  'PREPARED',
  'ACCEPTED',
  'FAILED'
);

ALTER TABLE "ServicePersonnel"
  ADD COLUMN "portalAccessStatus" "PersonnelPortalAccessStatus";

ALTER TABLE "AccountToken"
  ADD COLUMN "deliveryStatus" "AccountTokenDeliveryStatus" NOT NULL DEFAULT 'PREPARED',
  ADD COLUMN "deliveryAttemptedAt" TIMESTAMP(3),
  ADD COLUMN "deliveredAt" TIMESTAMP(3),
  ADD COLUMN "providerMessageId" TEXT,
  ADD COLUMN "deliveryErrorCode" TEXT;

-- Safely classify any personnel accounts created before this migration.
UPDATE "ServicePersonnel" AS personnel
SET "portalAccessStatus" = CASE
  WHEN app_user."passwordChangedAt" IS NULL THEN 'PENDING_ACTIVATION'::"PersonnelPortalAccessStatus"
  WHEN app_user."isApproved" = true AND app_user."canManagerLogin" = true THEN 'ACTIVE'::"PersonnelPortalAccessStatus"
  ELSE 'DISABLED'::"PersonnelPortalAccessStatus"
END
FROM "User" AS app_user
WHERE personnel."userId" = app_user."id";

CREATE INDEX "ServicePersonnel_portalAccessStatus_idx"
  ON "ServicePersonnel"("portalAccessStatus");
CREATE INDEX "AccountToken_deliveryStatus_idx"
  ON "AccountToken"("deliveryStatus");
