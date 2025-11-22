/*
  Warnings:

  - A unique constraint covering the columns `[managerId,propertyId,periodStart,periodEnd]` on the table `ManagerCommission` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateIndex
CREATE UNIQUE INDEX "ManagerCommission_managerId_propertyId_periodStart_periodEn_key" ON "ManagerCommission"("managerId", "propertyId", "periodStart", "periodEnd");
