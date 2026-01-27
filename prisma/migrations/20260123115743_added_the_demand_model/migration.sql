-- CreateEnum
CREATE TYPE "DemandLetterStatus" AS ENUM ('DRAFT', 'GENERATED', 'SENT', 'ACKNOWLEDGED', 'SETTLED', 'ESCALATED');

-- CreateTable
CREATE TABLE "DemandLetter" (
    "id" TEXT NOT NULL,
    "letterNumber" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "landlordId" TEXT NOT NULL,
    "unitId" TEXT NOT NULL,
    "invoiceId" TEXT,
    "generatedById" TEXT,
    "issueDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "outstandingAmount" DOUBLE PRECISION NOT NULL,
    "rentalPeriod" TEXT NOT NULL,
    "dueDate" TIMESTAMP(3) NOT NULL,
    "demandPeriod" TEXT,
    "partialPayment" DOUBLE PRECISION DEFAULT 0,
    "partialPaymentDate" TIMESTAMP(3),
    "generatedAt" TIMESTAMP(3),
    "paymentPolicy" "PaymentPolicy",
    "landlordContact" TEXT,
    "tenantContact" TEXT,
    "referenceNumber" TEXT,
    "previousInvoiceRef" TEXT,
    "status" "DemandLetterStatus" NOT NULL DEFAULT 'DRAFT',
    "documentUrl" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DemandLetter_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DemandLetter_letterNumber_key" ON "DemandLetter"("letterNumber");

-- CreateIndex
CREATE INDEX "DemandLetter_tenantId_idx" ON "DemandLetter"("tenantId");

-- CreateIndex
CREATE INDEX "DemandLetter_propertyId_idx" ON "DemandLetter"("propertyId");

-- CreateIndex
CREATE INDEX "DemandLetter_landlordId_idx" ON "DemandLetter"("landlordId");

-- CreateIndex
CREATE INDEX "DemandLetter_status_idx" ON "DemandLetter"("status");

-- CreateIndex
CREATE INDEX "DemandLetter_issueDate_idx" ON "DemandLetter"("issueDate");

-- CreateIndex
CREATE INDEX "DemandLetter_generatedById_idx" ON "DemandLetter"("generatedById");

-- AddForeignKey
ALTER TABLE "DemandLetter" ADD CONSTRAINT "DemandLetter_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DemandLetter" ADD CONSTRAINT "DemandLetter_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DemandLetter" ADD CONSTRAINT "DemandLetter_landlordId_fkey" FOREIGN KEY ("landlordId") REFERENCES "Landlord"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DemandLetter" ADD CONSTRAINT "DemandLetter_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "Unit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DemandLetter" ADD CONSTRAINT "DemandLetter_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DemandLetter" ADD CONSTRAINT "DemandLetter_generatedById_fkey" FOREIGN KEY ("generatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
