-- AlterTable
ALTER TABLE "BillInvoice" ADD COLUMN     "paymentPolicy" "PaymentPolicy";

-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN     "paymentPolicy" "PaymentPolicy";

-- CreateIndex
CREATE INDEX "BillInvoice_paymentPolicy_idx" ON "BillInvoice"("paymentPolicy");

-- CreateIndex
CREATE INDEX "Invoice_paymentPolicy_idx" ON "Invoice"("paymentPolicy");
