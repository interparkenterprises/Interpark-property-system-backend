-- CreateEnum
CREATE TYPE "TenantStatus" AS ENUM ('ACTIVE', 'LEFT');

-- AlterTable
ALTER TABLE "Tenant" ADD COLUMN     "status" "TenantStatus" NOT NULL DEFAULT 'ACTIVE';
