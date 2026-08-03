-- CreateEnum
CREATE TYPE "OtherIncomeCategory" AS ENUM ('CONSULTANCY', 'PROPERTY_SALES', 'LEASING', 'PROJECT_MANAGEMENT', 'REFERRAL', 'DOCUMENTATION', 'INSPECTION', 'TRAINING', 'OTHER');

-- CreateTable
CREATE TABLE "OtherIncome" (
    "id" TEXT NOT NULL,
    "invoiceNumber" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "amount" DOUBLE PRECISION NOT NULL,
    "vatRate" DOUBLE PRECISION,
    "vatAmount" DOUBLE PRECISION,
    "vatType" "VATType" NOT NULL DEFAULT 'NOT_APPLICABLE',
    "totalAmount" DOUBLE PRECISION NOT NULL,
    "category" "OtherIncomeCategory" NOT NULL DEFAULT 'CONSULTANCY',
    "subCategory" TEXT,
    "clientName" TEXT NOT NULL,
    "clientEmail" TEXT,
    "clientPhone" TEXT,
    "clientAddress" TEXT,
    "clientCompany" TEXT,
    "issueDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dueDate" TIMESTAMP(3),
    "status" "InvoiceStatus" NOT NULL DEFAULT 'UNPAID',
    "paidDate" TIMESTAMP(3),
    "paymentMethod" TEXT,
    "transactionRef" TEXT,
    "bankName" TEXT,
    "accountName" TEXT,
    "accountNumber" TEXT,
    "branch" TEXT,
    "bankCode" TEXT,
    "swiftCode" TEXT,
    "currency" TEXT NOT NULL DEFAULT 'KES',
    "managerId" TEXT NOT NULL,
    "pdfUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT NOT NULL,

    CONSTRAINT "OtherIncome_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OtherIncomeAttachment" (
    "id" TEXT NOT NULL,
    "otherIncomeId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "fileUrl" TEXT NOT NULL,
    "fileType" TEXT NOT NULL,
    "fileSize" INTEGER NOT NULL,
    "description" TEXT,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "uploadedById" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "OtherIncomeAttachment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "OtherIncome_invoiceNumber_key" ON "OtherIncome"("invoiceNumber");

-- CreateIndex
CREATE INDEX "OtherIncome_managerId_idx" ON "OtherIncome"("managerId");

-- CreateIndex
CREATE INDEX "OtherIncome_status_idx" ON "OtherIncome"("status");

-- CreateIndex
CREATE INDEX "OtherIncome_category_idx" ON "OtherIncome"("category");

-- CreateIndex
CREATE INDEX "OtherIncome_issueDate_idx" ON "OtherIncome"("issueDate");

-- CreateIndex
CREATE INDEX "OtherIncome_invoiceNumber_idx" ON "OtherIncome"("invoiceNumber");

-- CreateIndex
CREATE INDEX "OtherIncome_clientName_idx" ON "OtherIncome"("clientName");

-- CreateIndex
CREATE INDEX "OtherIncome_createdById_idx" ON "OtherIncome"("createdById");

-- CreateIndex
CREATE INDEX "OtherIncomeAttachment_otherIncomeId_idx" ON "OtherIncomeAttachment"("otherIncomeId");

-- CreateIndex
CREATE INDEX "OtherIncomeAttachment_uploadedById_idx" ON "OtherIncomeAttachment"("uploadedById");

-- CreateIndex
CREATE INDEX "OtherIncomeAttachment_isActive_idx" ON "OtherIncomeAttachment"("isActive");

-- AddForeignKey
ALTER TABLE "OtherIncome" ADD CONSTRAINT "OtherIncome_managerId_fkey" FOREIGN KEY ("managerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OtherIncome" ADD CONSTRAINT "OtherIncome_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OtherIncomeAttachment" ADD CONSTRAINT "OtherIncomeAttachment_otherIncomeId_fkey" FOREIGN KEY ("otherIncomeId") REFERENCES "OtherIncome"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OtherIncomeAttachment" ADD CONSTRAINT "OtherIncomeAttachment_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
