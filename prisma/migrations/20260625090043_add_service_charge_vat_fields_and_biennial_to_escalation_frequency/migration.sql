-- AlterEnum
ALTER TYPE "EscalationFrequency" ADD VALUE 'BI_ENNIAL';

-- AlterTable
ALTER TABLE "ServiceCharge" ADD COLUMN     "vatRate" DOUBLE PRECISION DEFAULT 0,
ADD COLUMN     "vatType" "VATType" NOT NULL DEFAULT 'NOT_APPLICABLE';
