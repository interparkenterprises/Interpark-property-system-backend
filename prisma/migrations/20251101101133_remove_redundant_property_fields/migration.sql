/*
  Warnings:

  - You are about to drop the column `commercial` on the `Property` table. All the data in the column will be lost.
  - You are about to drop the column `residential` on the `Property` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "Property" DROP COLUMN "commercial",
DROP COLUMN "residential";
