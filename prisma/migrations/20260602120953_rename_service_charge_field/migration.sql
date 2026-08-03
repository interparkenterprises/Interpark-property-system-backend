/*
  Warnings:

  - You are about to drop the column `perSqftRate` on the `ServiceCharge` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "ServiceCharge" DROP COLUMN "perSqftRate",
ADD COLUMN     "perSqFtRate" DOUBLE PRECISION;
