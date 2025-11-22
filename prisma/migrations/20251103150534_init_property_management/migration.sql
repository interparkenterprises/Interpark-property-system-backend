/*
  Warnings:

  - The values [LANDLORD,TENANT] on the enum `Role` will be removed. If these variants are still used in the database, this will fail.
  - You are about to drop the column `poBox` on the `Tenant` table. All the data in the column will be lost.
  - You are about to drop the column `userId` on the `Tenant` table. All the data in the column will be lost.
  - You are about to drop the `manager_assignments` table. If the table is not empty, all the data it contains will be lost.
  - Added the required column `fullName` to the `Tenant` table without a default value. This is not possible if the table is not empty.
  - Made the column `contact` on table `Tenant` required. This step will fail if there are existing NULL values in that column.

*/
-- AlterEnum
BEGIN;
CREATE TYPE "Role_new" AS ENUM ('ADMIN', 'MANAGER');
ALTER TABLE "User" ALTER COLUMN "role" TYPE "Role_new" USING ("role"::text::"Role_new");
ALTER TYPE "Role" RENAME TO "Role_old";
ALTER TYPE "Role_new" RENAME TO "Role";
DROP TYPE "public"."Role_old";
COMMIT;

-- DropForeignKey
ALTER TABLE "public"."Property" DROP CONSTRAINT "Property_landlordId_fkey";

-- DropForeignKey
ALTER TABLE "public"."Tenant" DROP CONSTRAINT "Tenant_userId_fkey";

-- DropForeignKey
ALTER TABLE "public"."manager_assignments" DROP CONSTRAINT "manager_assignments_landlordId_fkey";

-- DropForeignKey
ALTER TABLE "public"."manager_assignments" DROP CONSTRAINT "manager_assignments_managerId_fkey";

-- DropIndex
DROP INDEX "public"."Tenant_userId_key";

-- AlterTable
ALTER TABLE "Property" ADD COLUMN     "managerId" TEXT;

-- AlterTable
ALTER TABLE "Tenant" DROP COLUMN "poBox",
DROP COLUMN "userId",
ADD COLUMN     "fullName" TEXT NOT NULL,
ALTER COLUMN "contact" SET NOT NULL;

-- DropTable
DROP TABLE "public"."manager_assignments";

-- CreateTable
CREATE TABLE "Landlord" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "address" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Landlord_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "Property" ADD CONSTRAINT "Property_landlordId_fkey" FOREIGN KEY ("landlordId") REFERENCES "Landlord"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Property" ADD CONSTRAINT "Property_managerId_fkey" FOREIGN KEY ("managerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
