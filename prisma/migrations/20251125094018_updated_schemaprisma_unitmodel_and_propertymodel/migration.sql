/*
  Warnings:

  - Added the required column `unitType` to the `Unit` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "UnitType" AS ENUM ('RESIDENTIAL', 'COMMERCIAL');

-- AlterTable
ALTER TABLE "Property" ADD COLUMN     "accountName" TEXT,
ADD COLUMN     "accountNo" TEXT,
ADD COLUMN     "bank" TEXT,
ADD COLUMN     "branch" TEXT,
ADD COLUMN     "branchCode" TEXT;

-- AlterTable
ALTER TABLE "Unit" ADD COLUMN     "floor" TEXT,
ADD COLUMN     "unitNo" TEXT,
ADD COLUMN     "unitType" "UnitType" NOT NULL,
ADD COLUMN     "usage" TEXT,
ALTER COLUMN "bedrooms" DROP NOT NULL,
ALTER COLUMN "bathrooms" DROP NOT NULL;
