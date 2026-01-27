-- CreateTable
CREATE TABLE "CommissionInvoice" (
    "id" TEXT NOT NULL,
    "invoiceNumber" TEXT NOT NULL,
    "invoiceDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "commissionId" TEXT NOT NULL,
    "propertyName" TEXT NOT NULL,
    "lrNumber" TEXT,
    "landlordName" TEXT NOT NULL,
    "landlordAddress" TEXT,
    "description" TEXT NOT NULL,
    "collectionAmount" DOUBLE PRECISION NOT NULL,
    "commissionRate" DOUBLE PRECISION NOT NULL,
    "commissionAmount" DOUBLE PRECISION NOT NULL,
    "vatRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "vatAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "totalAmount" DOUBLE PRECISION NOT NULL,
    "bankName" TEXT NOT NULL,
    "accountName" TEXT NOT NULL,
    "accountNumber" TEXT NOT NULL,
    "branch" TEXT,
    "bankCode" TEXT,
    "swiftCode" TEXT,
    "currency" TEXT DEFAULT 'KES',
    "pdfUrl" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CommissionInvoice_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CommissionInvoice_invoiceNumber_key" ON "CommissionInvoice"("invoiceNumber");

-- CreateIndex
CREATE UNIQUE INDEX "CommissionInvoice_commissionId_key" ON "CommissionInvoice"("commissionId");

-- CreateIndex
CREATE INDEX "CommissionInvoice_commissionId_idx" ON "CommissionInvoice"("commissionId");

-- AddForeignKey
ALTER TABLE "CommissionInvoice" ADD CONSTRAINT "CommissionInvoice_commissionId_fkey" FOREIGN KEY ("commissionId") REFERENCES "ManagerCommission"("id") ON DELETE CASCADE ON UPDATE CASCADE;
