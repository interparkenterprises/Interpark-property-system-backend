/*
  Warnings:

  - You are about to drop the column `escalation` on the `Tenant` table. All the data in the column will be lost.

*/
-- CreateEnum
CREATE TYPE "EscalationFrequency" AS ENUM ('ANNUALLY', 'BI_ANNUALLY');

-- AlterTable
ALTER TABLE "Tenant" DROP COLUMN "escalation",
ADD COLUMN     "escalationFrequency" "EscalationFrequency",
ADD COLUMN     "escalationRate" DOUBLE PRECISION;
