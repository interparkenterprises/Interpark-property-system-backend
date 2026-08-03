-- CreateTable
CREATE TABLE "ServiceProviderAttachment" (
    "id" TEXT NOT NULL,
    "serviceProviderId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "fileUrl" TEXT NOT NULL,
    "fileType" TEXT NOT NULL,
    "fileSize" INTEGER NOT NULL,
    "description" TEXT,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "uploadedById" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "category" TEXT,
    "version" TEXT,
    "expiryDate" TIMESTAMP(3),

    CONSTRAINT "ServiceProviderAttachment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ServiceProviderAttachment_serviceProviderId_idx" ON "ServiceProviderAttachment"("serviceProviderId");

-- CreateIndex
CREATE INDEX "ServiceProviderAttachment_uploadedById_idx" ON "ServiceProviderAttachment"("uploadedById");

-- CreateIndex
CREATE INDEX "ServiceProviderAttachment_isActive_idx" ON "ServiceProviderAttachment"("isActive");

-- CreateIndex
CREATE INDEX "ServiceProviderAttachment_category_idx" ON "ServiceProviderAttachment"("category");

-- CreateIndex
CREATE INDEX "ServiceProviderAttachment_expiryDate_idx" ON "ServiceProviderAttachment"("expiryDate");

-- CreateIndex
CREATE UNIQUE INDEX "ServiceProviderAttachment_serviceProviderId_fileName_key" ON "ServiceProviderAttachment"("serviceProviderId", "fileName");

-- AddForeignKey
ALTER TABLE "ServiceProviderAttachment" ADD CONSTRAINT "ServiceProviderAttachment_serviceProviderId_fkey" FOREIGN KEY ("serviceProviderId") REFERENCES "ServiceProvider"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceProviderAttachment" ADD CONSTRAINT "ServiceProviderAttachment_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
