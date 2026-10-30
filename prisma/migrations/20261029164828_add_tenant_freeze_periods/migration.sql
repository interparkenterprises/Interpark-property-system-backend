-- AlterTable
ALTER TABLE "Tenant" ADD COLUMN     "isFrozen" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "TenantFreezePeriod" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3),
    "reason" TEXT,
    "frozenById" TEXT,
    "unfrozenById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TenantFreezePeriod_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TenantFreezePeriod_tenantId_idx" ON "TenantFreezePeriod"("tenantId");

-- CreateIndex
CREATE INDEX "TenantFreezePeriod_tenantId_startDate_endDate_idx" ON "TenantFreezePeriod"("tenantId", "startDate", "endDate");

-- CreateIndex
CREATE INDEX "TenantFreezePeriod_endDate_idx" ON "TenantFreezePeriod"("endDate");

-- CreateIndex
CREATE INDEX "Tenant_isFrozen_idx" ON "Tenant"("isFrozen");

-- AddForeignKey
ALTER TABLE "TenantFreezePeriod" ADD CONSTRAINT "TenantFreezePeriod_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TenantFreezePeriod" ADD CONSTRAINT "TenantFreezePeriod_frozenById_fkey" FOREIGN KEY ("frozenById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TenantFreezePeriod" ADD CONSTRAINT "TenantFreezePeriod_unfrozenById_fkey" FOREIGN KEY ("unfrozenById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
