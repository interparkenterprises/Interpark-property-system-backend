/*
  Warnings:

  - You are about to drop the column `proposedDeposit` on the `ActivationRequest` table. All the data in the column will be lost.
  - You are about to drop the column `proposedRent` on the `ActivationRequest` table. All the data in the column will be lost.
  - You are about to drop the column `proposedServiceCharge` on the `ActivationRequest` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "ActivationRequest" DROP COLUMN "proposedDeposit",
DROP COLUMN "proposedRent",
DROP COLUMN "proposedServiceCharge",
ADD COLUMN     "accountName" TEXT,
ADD COLUMN     "accountNumber" TEXT,
ADD COLUMN     "bankBranch" TEXT,
ADD COLUMN     "bankName" TEXT,
ADD COLUMN     "licenseFeePerDay" DOUBLE PRECISION,
ADD COLUMN     "managerDesignation" TEXT,
ADD COLUMN     "managerName" TEXT,
ADD COLUMN     "mpesaAccount" TEXT,
ADD COLUMN     "numberOfDays" INTEGER,
ADD COLUMN     "paybillNumber" TEXT,
ADD COLUMN     "swiftCode" TEXT;
