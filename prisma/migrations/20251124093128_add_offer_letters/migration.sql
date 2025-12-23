/*
  Warnings:

  - Added the required column `updatedAt` to the `Lead` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "OfferLetterType" AS ENUM ('COMMERCIAL', 'RESIDENTIAL');

-- CreateEnum
CREATE TYPE "OfferLetterStatus" AS ENUM ('DRAFT', 'SENT', 'ACCEPTED', 'REJECTED', 'EXPIRED', 'CANCELLED', 'CONVERTED');

-- AlterTable
ALTER TABLE "Lead" ADD COLUMN     "email" TEXT,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL;

-- CreateTable
CREATE TABLE "OfferLetter" (
    "id" TEXT NOT NULL,
    "offerNumber" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "unitId" TEXT,
    "landlordId" TEXT,
    "letterType" "OfferLetterType" NOT NULL,
    "usageType" "UsageType" NOT NULL,
    "issueDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiryDate" TIMESTAMP(3),
    "rentAmount" DOUBLE PRECISION NOT NULL,
    "deposit" DOUBLE PRECISION,
    "leaseTerm" TEXT,
    "serviceCharge" DOUBLE PRECISION,
    "escalationRate" DOUBLE PRECISION,
    "status" "OfferLetterStatus" NOT NULL DEFAULT 'DRAFT',
    "documentUrl" TEXT,
    "additionalTerms" JSONB,
    "notes" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OfferLetter_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "OfferLetter_offerNumber_key" ON "OfferLetter"("offerNumber");

-- CreateIndex
CREATE INDEX "OfferLetter_leadId_idx" ON "OfferLetter"("leadId");

-- CreateIndex
CREATE INDEX "OfferLetter_propertyId_idx" ON "OfferLetter"("propertyId");

-- CreateIndex
CREATE INDEX "OfferLetter_offerNumber_idx" ON "OfferLetter"("offerNumber");

-- CreateIndex
CREATE INDEX "OfferLetter_status_idx" ON "OfferLetter"("status");

-- AddForeignKey
ALTER TABLE "OfferLetter" ADD CONSTRAINT "OfferLetter_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OfferLetter" ADD CONSTRAINT "OfferLetter_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OfferLetter" ADD CONSTRAINT "OfferLetter_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "Unit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OfferLetter" ADD CONSTRAINT "OfferLetter_landlordId_fkey" FOREIGN KEY ("landlordId") REFERENCES "Landlord"("id") ON DELETE SET NULL ON UPDATE CASCADE;
