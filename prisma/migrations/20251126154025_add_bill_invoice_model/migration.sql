-- CreateTable
CREATE TABLE "BillInvoice" (
    "id" TEXT NOT NULL,
    "invoiceNumber" TEXT NOT NULL,
    "billId" TEXT NOT NULL,
    "billReferenceNumber" TEXT NOT NULL,
    "billReferenceDate" TIMESTAMP(3) NOT NULL,
    "tenantId" TEXT NOT NULL,
    "issueDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dueDate" TIMESTAMP(3) NOT NULL,
    "billType" "BillType" NOT NULL,
    "previousReading" DOUBLE PRECISION NOT NULL,
    "currentReading" DOUBLE PRECISION NOT NULL,
    "units" DOUBLE PRECISION NOT NULL,
    "chargePerUnit" DOUBLE PRECISION NOT NULL,
    "totalAmount" DOUBLE PRECISION NOT NULL,
    "vatRate" DOUBLE PRECISION,
    "vatAmount" DOUBLE PRECISION,
    "grandTotal" DOUBLE PRECISION NOT NULL,
    "amountPaid" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "balance" DOUBLE PRECISION NOT NULL,
    "status" "InvoiceStatus" NOT NULL DEFAULT 'UNPAID',
    "pdfUrl" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BillInvoice_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BillInvoice_invoiceNumber_key" ON "BillInvoice"("invoiceNumber");

-- CreateIndex
CREATE INDEX "BillInvoice_billId_idx" ON "BillInvoice"("billId");

-- CreateIndex
CREATE INDEX "BillInvoice_tenantId_idx" ON "BillInvoice"("tenantId");

-- CreateIndex
CREATE INDEX "BillInvoice_invoiceNumber_idx" ON "BillInvoice"("invoiceNumber");

-- CreateIndex
CREATE INDEX "BillInvoice_status_idx" ON "BillInvoice"("status");

-- CreateIndex
CREATE INDEX "BillInvoice_billReferenceNumber_idx" ON "BillInvoice"("billReferenceNumber");

-- AddForeignKey
ALTER TABLE "BillInvoice" ADD CONSTRAINT "BillInvoice_billId_fkey" FOREIGN KEY ("billId") REFERENCES "Bill"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BillInvoice" ADD CONSTRAINT "BillInvoice_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
