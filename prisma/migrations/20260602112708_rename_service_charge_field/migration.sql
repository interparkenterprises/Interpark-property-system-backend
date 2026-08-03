/*
  Warnings:

  - You are about to drop the column `perSqFtRate` on the `ServiceCharge` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "ServiceCharge" DROP COLUMN "perSqFtRate",
ADD COLUMN     "perSqftRate" DOUBLE PRECISION;
