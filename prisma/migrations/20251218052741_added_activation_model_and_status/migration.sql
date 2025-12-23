-- CreateEnum
CREATE TYPE "ActivationStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'REJECTED', 'COMPLETED', 'CANCELLED');

-- CreateTable
CREATE TABLE "ActivationRequest" (
    "id" TEXT NOT NULL,
    "requestNumber" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "managerId" TEXT NOT NULL,
    "companyName" TEXT NOT NULL,
    "postalAddress" TEXT NOT NULL,
    "telephone" TEXT NOT NULL,
    "contactPerson" TEXT NOT NULL,
    "designation" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "mobileNo" TEXT NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "setupTime" TEXT NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "tearDownTime" TEXT NOT NULL,
    "activationType" TEXT NOT NULL,
    "description" TEXT,
    "expectedVisitors" INTEGER,
    "spaceRequired" DOUBLE PRECISION NOT NULL,
    "location" TEXT NOT NULL,
    "powerRequirement" TEXT,
    "waterRequirement" BOOLEAN NOT NULL DEFAULT false,
    "internetRequired" BOOLEAN NOT NULL DEFAULT false,
    "ownEquipment" BOOLEAN NOT NULL DEFAULT true,
    "equipmentList" JSONB,
    "furnitureNeeded" JSONB,
    "brandingMaterials" JSONB,
    "soundSystem" BOOLEAN NOT NULL DEFAULT false,
    "displayScreens" BOOLEAN NOT NULL DEFAULT false,
    "insuranceCover" BOOLEAN NOT NULL DEFAULT false,
    "insuranceDetails" TEXT,
    "safetyMeasures" JSONB,
    "firstAidKit" BOOLEAN NOT NULL DEFAULT false,
    "proposedBudget" DOUBLE PRECISION,
    "paymentTerms" TEXT,
    "securityRequired" BOOLEAN NOT NULL DEFAULT false,
    "cleaningRequired" BOOLEAN NOT NULL DEFAULT false,
    "cateringRequired" BOOLEAN NOT NULL DEFAULT false,
    "parkingSpaces" INTEGER DEFAULT 0,
    "termsAccepted" BOOLEAN NOT NULL DEFAULT false,
    "signature" TEXT,
    "signatureDate" TIMESTAMP(3),
    "documentUrl" TEXT,
    "status" "ActivationStatus" NOT NULL DEFAULT 'DRAFT',
    "specialRequests" TEXT,
    "internalNotes" TEXT,
    "submittedAt" TIMESTAMP(3),
    "reviewedAt" TIMESTAMP(3),
    "approvedAt" TIMESTAMP(3),
    "rejectedAt" TIMESTAMP(3),
    "rejectionReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ActivationRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ActivationRequest_requestNumber_key" ON "ActivationRequest"("requestNumber");

-- CreateIndex
CREATE INDEX "ActivationRequest_propertyId_idx" ON "ActivationRequest"("propertyId");

-- CreateIndex
CREATE INDEX "ActivationRequest_managerId_idx" ON "ActivationRequest"("managerId");

-- CreateIndex
CREATE INDEX "ActivationRequest_status_idx" ON "ActivationRequest"("status");

-- CreateIndex
CREATE INDEX "ActivationRequest_startDate_idx" ON "ActivationRequest"("startDate");

-- AddForeignKey
ALTER TABLE "ActivationRequest" ADD CONSTRAINT "ActivationRequest_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActivationRequest" ADD CONSTRAINT "ActivationRequest_managerId_fkey" FOREIGN KEY ("managerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
