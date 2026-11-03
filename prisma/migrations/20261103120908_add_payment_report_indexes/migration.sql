-- CreateIndex
CREATE INDEX "PaymentReport_status_paymentPeriod_idx" ON "PaymentReport"("status", "paymentPeriod");

-- CreateIndex
CREATE INDEX "PaymentReport_tenantId_status_idx" ON "PaymentReport"("tenantId", "status");
