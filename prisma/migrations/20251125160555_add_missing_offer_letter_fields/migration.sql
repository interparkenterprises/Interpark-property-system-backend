/*
  Warnings:

  - The `status` column on the `OfferLetter` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - Made the column `landlordId` on table `OfferLetter` required. This step will fail if there are existing NULL values in that column.
  - Changed the type of `letterType` on the `OfferLetter` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Made the column `deposit` on table `OfferLetter` required. This step will fail if there are existing NULL values in that column.
  - Made the column `leaseTerm` on table `OfferLetter` required. This step will fail if there are existing NULL values in that column.

*/
-- CreateEnum
CREATE TYPE "OfferStatus" AS ENUM ('DRAFT', 'SENT', 'ACCEPTED', 'REJECTED', 'EXPIRED', 'CANCELLED', 'CONVERTED');

-- CreateEnum
CREATE TYPE "LetterType" AS ENUM ('COMMERCIAL', 'RESIDENTIAL');

-- DropForeignKey
ALTER TABLE "OfferLetter" DROP CONSTRAINT "OfferLetter_landlordId_fkey";

-- DropForeignKey
ALTER TABLE "OfferLetter" DROP CONSTRAINT "OfferLetter_leadId_fkey";

-- DropIndex
DROP INDEX "OfferLetter_leadId_idx";

-- DropIndex
DROP INDEX "OfferLetter_offerNumber_idx";

-- DropIndex
DROP INDEX "OfferLetter_propertyId_idx";

-- DropIndex
DROP INDEX "OfferLetter_status_idx";

-- AlterTable
ALTER TABLE "Landlord" ADD COLUMN     "idNumber" TEXT;

-- AlterTable
ALTER TABLE "Lead" ADD COLUMN     "companyName" TEXT,
ADD COLUMN     "idNumber" TEXT;

-- AlterTable
ALTER TABLE "OfferLetter" ADD COLUMN     "leaseStartDate" TIMESTAMP(3),
ADD COLUMN     "metadata" JSONB,
ADD COLUMN     "rentStartDate" TIMESTAMP(3),
ALTER COLUMN "landlordId" SET NOT NULL,
DROP COLUMN "letterType",
ADD COLUMN     "letterType" "LetterType" NOT NULL,
ALTER COLUMN "deposit" SET NOT NULL,
ALTER COLUMN "leaseTerm" SET NOT NULL,
DROP COLUMN "status",
ADD COLUMN     "status" "OfferStatus" NOT NULL DEFAULT 'DRAFT',
ALTER COLUMN "additionalTerms" SET DATA TYPE TEXT;

-- AlterTable
ALTER TABLE "Unit" ALTER COLUMN "status" SET DEFAULT 'VACANT';

-- DropEnum
DROP TYPE "OfferLetterStatus";

-- DropEnum
DROP TYPE "OfferLetterType";

-- AddForeignKey
ALTER TABLE "OfferLetter" ADD CONSTRAINT "OfferLetter_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OfferLetter" ADD CONSTRAINT "OfferLetter_landlordId_fkey" FOREIGN KEY ("landlordId") REFERENCES "Landlord"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
