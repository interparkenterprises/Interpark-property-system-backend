-- AlterTable
ALTER TABLE "BillInvoice" ADD COLUMN     "paymentReportId" TEXT;

-- AddForeignKey
ALTER TABLE "BillInvoice" ADD CONSTRAINT "BillInvoice_paymentReportId_fkey" FOREIGN KEY ("paymentReportId") REFERENCES "PaymentReport"("id") ON DELETE SET NULL ON UPDATE CASCADE;
