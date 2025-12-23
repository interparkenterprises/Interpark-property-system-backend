-- AlterTable
ALTER TABLE "ActivationRequest" ADD COLUMN     "businessPermit" TEXT,
ADD COLUMN     "companyRegistration" TEXT,
ADD COLUMN     "kraPinCertificate" TEXT,
ADD COLUMN     "otherDocuments" JSONB,
ADD COLUMN     "proposedDeposit" DOUBLE PRECISION,
ADD COLUMN     "proposedRent" DOUBLE PRECISION,
ADD COLUMN     "proposedServiceCharge" DOUBLE PRECISION,
ALTER COLUMN "location" DROP NOT NULL;
