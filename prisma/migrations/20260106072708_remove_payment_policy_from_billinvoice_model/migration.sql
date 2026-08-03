/*
  Warnings:

  - You are about to drop the column `paymentPolicy` on the `BillInvoice` table. All the data in the column will be lost.

*/
-- DropIndex
DROP INDEX "BillInvoice_paymentPolicy_idx";

-- AlterTable
ALTER TABLE "BillInvoice" DROP COLUMN "paymentPolicy";
