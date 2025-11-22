-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "RentType" ADD VALUE 'TIERED';
ALTER TYPE "RentType" ADD VALUE 'GRADUATED';
ALTER TYPE "RentType" ADD VALUE 'INDEXED';
ALTER TYPE "RentType" ADD VALUE 'PERCENT_OF_REVENUE';
ALTER TYPE "RentType" ADD VALUE 'PER_ROOM';
ALTER TYPE "RentType" ADD VALUE 'PER_OCCUPANT';
ALTER TYPE "RentType" ADD VALUE 'PER_BED';
ALTER TYPE "RentType" ADD VALUE 'DAILY';
ALTER TYPE "RentType" ADD VALUE 'WEEKLY';
ALTER TYPE "RentType" ADD VALUE 'MONTHLY';
ALTER TYPE "RentType" ADD VALUE 'ANNUAL';
ALTER TYPE "RentType" ADD VALUE 'NEGOTIATED';
ALTER TYPE "RentType" ADD VALUE 'PARTIAL_SUBSIDY';
ALTER TYPE "RentType" ADD VALUE 'VARIABLE';
