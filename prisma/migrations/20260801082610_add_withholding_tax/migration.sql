-- AlterTable
ALTER TABLE "Tenant" ADD COLUMN     "isWithholdingTaxExempt" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "withholdingTaxRate" DOUBLE PRECISION DEFAULT 0,
ADD COLUMN     "withholdingVatRate" DOUBLE PRECISION DEFAULT 0;
