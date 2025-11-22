/*
  Warnings:

  - You are about to drop the column `type` on the `Property` table. All the data in the column will be lost.
  - Added the required column `form` to the `Property` table without a default value. This is not possible if the table is not empty.
  - Added the required column `usage` to the `Property` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "PropertyForm" AS ENUM ('APARTMENT', 'BUNGALOW', 'VILLA', 'OFFICE', 'SHOP', 'DUPLEX', 'TOWNHOUSE', 'MAISONETTE', 'WAREHOUSE', 'INDUSTRIAL_BUILDING', 'RETAIL_CENTER');

-- CreateEnum
CREATE TYPE "UsageType" AS ENUM ('RESIDENTIAL', 'COMMERCIAL', 'INDUSTRIAL', 'INSTITUTIONAL', 'MIXED_USE');

-- AlterTable
ALTER TABLE "Property" DROP COLUMN "type",
ADD COLUMN     "form" "PropertyForm" NOT NULL,
ADD COLUMN     "usage" "UsageType" NOT NULL;

-- DropEnum
DROP TYPE "public"."PropertyType";
