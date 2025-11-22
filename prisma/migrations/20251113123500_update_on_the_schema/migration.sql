/*
  Warnings:

  - You are about to drop the column `amount` on the `PaymentReport` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[KRAPin]` on the table `Tenant` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `amountPaid` to the `PaymentReport` table without a default value. This is not possible if the table is not empty.
  - Added the required column `arrears` to the `PaymentReport` table without a default value. This is not possible if the table is not empty.
  - Added the required column `paymentPeriod` to the `PaymentReport` table without a default value. This is not possible if the table is not empty.
  - Added the required column `rent` to the `PaymentReport` table without a default value. This is not possible if the table is not empty.
  - Added the required column `totalDue` to the `PaymentReport` table without a default value. This is not possible if the table is not empty.
  - Added the required column `updatedAt` to the `PaymentReport` table without a default value. This is not possible if the table is not empty.
  - Added the required column `chargeAmount` to the `ServiceProvider` table without a default value. This is not possible if the table is not empty.
  - Added the required column `updatedAt` to the `ServiceProvider` table without a default value. This is not possible if the table is not empty.
  - Added the required column `KRAPin` to the `Tenant` table without a default value. This is not possible if the table is not empty.
  - Added the required column `paymentPolicy` to the `Tenant` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "CommissionStatus" AS ENUM ('PENDING', 'PAID', 'PROCESSING', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ServiceChargeType" AS ENUM ('FIXED', 'PERCENTAGE', 'PER_SQ_FT');

-- CreateEnum
CREATE TYPE "PaymentPolicy" AS ENUM ('MONTHLY', 'QUARTERLY', 'ANNUAL');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('PAID', 'PARTIAL', 'UNPAID');

-- CreateEnum
CREATE TYPE "ChargeFrequency" AS ENUM ('DAILY', 'WEEKLY', 'MONTHLY', 'QUARTERLY', 'ANNUAL');

-- AlterTable
ALTER TABLE "PaymentReport" DROP COLUMN "amount",
ADD COLUMN     "amountPaid" DOUBLE PRECISION NOT NULL,
ADD COLUMN     "arrears" DOUBLE PRECISION NOT NULL,
ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "paymentPeriod" TIMESTAMP(3) NOT NULL,
ADD COLUMN     "rent" DOUBLE PRECISION NOT NULL,
ADD COLUMN     "serviceCharge" DOUBLE PRECISION,
ADD COLUMN     "status" "PaymentStatus" NOT NULL DEFAULT 'UNPAID',
ADD COLUMN     "totalDue" DOUBLE PRECISION NOT NULL,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL,
ADD COLUMN     "vat" DOUBLE PRECISION;

-- AlterTable
ALTER TABLE "Property" ADD COLUMN     "commissionFee" DOUBLE PRECISION,
ADD COLUMN     "image" TEXT;

-- AlterTable
ALTER TABLE "ServiceProvider" ADD COLUMN     "chargeAmount" DOUBLE PRECISION NOT NULL,
ADD COLUMN     "chargeFrequency" "ChargeFrequency" NOT NULL DEFAULT 'MONTHLY',
ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL;

-- AlterTable
ALTER TABLE "Tenant" ADD COLUMN     "KRAPin" TEXT NOT NULL,
ADD COLUMN     "POBox" TEXT,
ADD COLUMN     "paymentPolicy" "PaymentPolicy" NOT NULL;

-- CreateTable
CREATE TABLE "ManagerCommission" (
    "id" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "managerId" TEXT NOT NULL,
    "commissionFee" DOUBLE PRECISION NOT NULL,
    "incomeAmount" DOUBLE PRECISION NOT NULL,
    "commissionAmount" DOUBLE PRECISION NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "status" "CommissionStatus" NOT NULL DEFAULT 'PENDING',
    "paidDate" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ManagerCommission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ServiceCharge" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "type" "ServiceChargeType" NOT NULL,
    "fixedAmount" DOUBLE PRECISION,
    "percentage" DOUBLE PRECISION,
    "perSqFtRate" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ServiceCharge_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ManagerCommission_managerId_periodStart_periodEnd_idx" ON "ManagerCommission"("managerId", "periodStart", "periodEnd");

-- CreateIndex
CREATE INDEX "ManagerCommission_propertyId_periodStart_periodEnd_idx" ON "ManagerCommission"("propertyId", "periodStart", "periodEnd");

-- CreateIndex
CREATE UNIQUE INDEX "ServiceCharge_tenantId_key" ON "ServiceCharge"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "Tenant_KRAPin_key" ON "Tenant"("KRAPin");

-- AddForeignKey
ALTER TABLE "ManagerCommission" ADD CONSTRAINT "ManagerCommission_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ManagerCommission" ADD CONSTRAINT "ManagerCommission_managerId_fkey" FOREIGN KEY ("managerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceCharge" ADD CONSTRAINT "ServiceCharge_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
