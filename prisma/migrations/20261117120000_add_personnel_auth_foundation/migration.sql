-- Additive personnel portal authentication foundation.
-- Existing users, personnel, assignments, schedules, and ERP sessions remain valid.

ALTER TYPE "Role" ADD VALUE 'PERSONNEL';

CREATE TYPE "AccountTokenType" AS ENUM (
  'PERSONNEL_ACTIVATION',
  'PERSONNEL_PASSWORD_RESET'
);

ALTER TABLE "ServicePersonnel" ADD COLUMN "userId" TEXT;

CREATE TABLE "AccountToken" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "type" "AccountTokenType" NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "usedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AccountToken_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ServicePersonnel_userId_key" ON "ServicePersonnel"("userId");
CREATE UNIQUE INDEX "AccountToken_tokenHash_key" ON "AccountToken"("tokenHash");
CREATE INDEX "AccountToken_userId_type_idx" ON "AccountToken"("userId", "type");
CREATE INDEX "AccountToken_expiresAt_idx" ON "AccountToken"("expiresAt");

ALTER TABLE "ServicePersonnel"
  ADD CONSTRAINT "ServicePersonnel_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "AccountToken"
  ADD CONSTRAINT "AccountToken_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
