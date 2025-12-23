/*
  Warnings:

  - You are about to drop the column `alternativeContact` on the `ActivationRequest` table. All the data in the column will be lost.
  - You are about to drop the column `brandingMaterials` on the `ActivationRequest` table. All the data in the column will be lost.
  - You are about to drop the column `businessPermit` on the `ActivationRequest` table. All the data in the column will be lost.
  - You are about to drop the column `cateringRequired` on the `ActivationRequest` table. All the data in the column will be lost.
  - You are about to drop the column `cleaningRequired` on the `ActivationRequest` table. All the data in the column will be lost.
  - You are about to drop the column `companyRegistration` on the `ActivationRequest` table. All the data in the column will be lost.
  - You are about to drop the column `displayScreens` on the `ActivationRequest` table. All the data in the column will be lost.
  - You are about to drop the column `equipmentList` on the `ActivationRequest` table. All the data in the column will be lost.
  - You are about to drop the column `firstAidKit` on the `ActivationRequest` table. All the data in the column will be lost.
  - You are about to drop the column `furnitureNeeded` on the `ActivationRequest` table. All the data in the column will be lost.
  - You are about to drop the column `insuranceCover` on the `ActivationRequest` table. All the data in the column will be lost.
  - You are about to drop the column `insuranceDetails` on the `ActivationRequest` table. All the data in the column will be lost.
  - You are about to drop the column `internalNotes` on the `ActivationRequest` table. All the data in the column will be lost.
  - You are about to drop the column `internetRequired` on the `ActivationRequest` table. All the data in the column will be lost.
  - You are about to drop the column `kraPinCertificate` on the `ActivationRequest` table. All the data in the column will be lost.
  - You are about to drop the column `location` on the `ActivationRequest` table. All the data in the column will be lost.
  - You are about to drop the column `otherDocuments` on the `ActivationRequest` table. All the data in the column will be lost.
  - You are about to drop the column `ownEquipment` on the `ActivationRequest` table. All the data in the column will be lost.
  - You are about to drop the column `parkingSpaces` on the `ActivationRequest` table. All the data in the column will be lost.
  - You are about to drop the column `paymentTerms` on the `ActivationRequest` table. All the data in the column will be lost.
  - You are about to drop the column `powerRequirement` on the `ActivationRequest` table. All the data in the column will be lost.
  - You are about to drop the column `rejectedAt` on the `ActivationRequest` table. All the data in the column will be lost.
  - You are about to drop the column `rejectionReason` on the `ActivationRequest` table. All the data in the column will be lost.
  - You are about to drop the column `reviewedAt` on the `ActivationRequest` table. All the data in the column will be lost.
  - You are about to drop the column `safetyMeasures` on the `ActivationRequest` table. All the data in the column will be lost.
  - You are about to drop the column `securityRequired` on the `ActivationRequest` table. All the data in the column will be lost.
  - You are about to drop the column `signature` on the `ActivationRequest` table. All the data in the column will be lost.
  - You are about to drop the column `spaceRequired` on the `ActivationRequest` table. All the data in the column will be lost.
  - You are about to drop the column `specialRequests` on the `ActivationRequest` table. All the data in the column will be lost.
  - You are about to drop the column `termsAccepted` on the `ActivationRequest` table. All the data in the column will be lost.
  - You are about to drop the column `waterRequirement` on the `ActivationRequest` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "ActivationRequest" DROP COLUMN "alternativeContact",
DROP COLUMN "brandingMaterials",
DROP COLUMN "businessPermit",
DROP COLUMN "cateringRequired",
DROP COLUMN "cleaningRequired",
DROP COLUMN "companyRegistration",
DROP COLUMN "displayScreens",
DROP COLUMN "equipmentList",
DROP COLUMN "firstAidKit",
DROP COLUMN "furnitureNeeded",
DROP COLUMN "insuranceCover",
DROP COLUMN "insuranceDetails",
DROP COLUMN "internalNotes",
DROP COLUMN "internetRequired",
DROP COLUMN "kraPinCertificate",
DROP COLUMN "location",
DROP COLUMN "otherDocuments",
DROP COLUMN "ownEquipment",
DROP COLUMN "parkingSpaces",
DROP COLUMN "paymentTerms",
DROP COLUMN "powerRequirement",
DROP COLUMN "rejectedAt",
DROP COLUMN "rejectionReason",
DROP COLUMN "reviewedAt",
DROP COLUMN "safetyMeasures",
DROP COLUMN "securityRequired",
DROP COLUMN "signature",
DROP COLUMN "spaceRequired",
DROP COLUMN "specialRequests",
DROP COLUMN "termsAccepted",
DROP COLUMN "waterRequirement";
