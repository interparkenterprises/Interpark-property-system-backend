/*
  Warnings:

  - Added the required column `updatedAt` to the `Tenant` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "VATType" AS ENUM ('INCLUSIVE', 'EXCLUSIVE', 'NOT_APPLICABLE');

-- DropForeignKey
ALTER TABLE "PaymentReport" DROP CONSTRAINT "PaymentReport_tenantId_fkey";

-- AlterTable
ALTER TABLE "Tenant" ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL,
ADD COLUMN     "vatRate" DOUBLE PRECISION DEFAULT 0,
ADD COLUMN     "vatType" "VATType" NOT NULL DEFAULT 'NOT_APPLICABLE';

-- AddForeignKey
ALTER TABLE "PaymentReport" ADD CONSTRAINT "PaymentReport_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
