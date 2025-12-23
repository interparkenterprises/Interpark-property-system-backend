-- CreateEnum
CREATE TYPE "ReportStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'REVIEWED', 'ARCHIVED');

-- CreateTable
CREATE TABLE "DailyReport" (
    "id" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "managerId" TEXT NOT NULL,
    "reportDate" TIMESTAMP(3) NOT NULL,
    "day" TEXT NOT NULL,
    "timeSubmitted" TIMESTAMP(3) NOT NULL,
    "preparedBy" TEXT NOT NULL,
    "securityProvider" TEXT,
    "shiftCoverage" TEXT,
    "securityIncidents" TEXT,
    "securityActions" TEXT,
    "securityOutstandingIssues" TEXT,
    "cleaningContractor" TEXT,
    "areasCleaned" JSONB,
    "cleanlinessStandard" TEXT,
    "cleaningIssues" TEXT,
    "cleaningCorrectiveAction" TEXT,
    "preventiveTasks" JSONB,
    "repairs" JSONB,
    "tenantComplaints" JSONB,
    "landlordInstructions" TEXT,
    "landlordActionTaken" TEXT,
    "landlordStatus" TEXT,
    "newEnquiries" INTEGER DEFAULT 0,
    "enquirySource" TEXT,
    "unitsEnquired" TEXT,
    "followUpAction" TEXT,
    "siteVisits" INTEGER DEFAULT 0,
    "bookingsReceived" TEXT,
    "bookingsConfirmed" INTEGER DEFAULT 0,
    "bookingsCancelled" INTEGER DEFAULT 0,
    "occupancyLevel" DOUBLE PRECISION DEFAULT 0,
    "bookingsRemarks" TEXT,
    "activationName" TEXT,
    "activityNature" TEXT,
    "activityDateTime" TIMESTAMP(3),
    "activityImpact" TEXT,
    "waterStatus" TEXT DEFAULT 'NORMAL',
    "electricityStatus" TEXT DEFAULT 'NORMAL',
    "otherServicesStatus" TEXT DEFAULT 'NORMAL',
    "utilitiesRemarks" TEXT,
    "operationalChallenges" TEXT,
    "healthSafetyIssues" TEXT,
    "attachments" JSONB,
    "status" "ReportStatus" NOT NULL DEFAULT 'DRAFT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DailyReport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DailyReport_propertyId_idx" ON "DailyReport"("propertyId");

-- CreateIndex
CREATE INDEX "DailyReport_managerId_idx" ON "DailyReport"("managerId");

-- CreateIndex
CREATE INDEX "DailyReport_reportDate_idx" ON "DailyReport"("reportDate");

-- CreateIndex
CREATE INDEX "DailyReport_status_idx" ON "DailyReport"("status");

-- AddForeignKey
ALTER TABLE "DailyReport" ADD CONSTRAINT "DailyReport_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailyReport" ADD CONSTRAINT "DailyReport_managerId_fkey" FOREIGN KEY ("managerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
