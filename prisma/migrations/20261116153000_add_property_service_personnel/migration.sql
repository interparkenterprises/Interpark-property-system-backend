-- Additive property service-personnel management schema.
-- Existing employees, providers, contracts, salaries, and tenant billing are unchanged.

CREATE TYPE "ServiceCategory" AS ENUM (
  'CLEANING',
  'SECURITY',
  'CARETAKING',
  'LANDSCAPING',
  'PLUMBING',
  'ELECTRICAL',
  'MAINTENANCE',
  'WASTE_MANAGEMENT',
  'OTHER'
);

CREATE TYPE "PersonnelType" AS ENUM ('INTERNAL', 'EXTERNAL');
CREATE TYPE "PersonnelStatus" AS ENUM ('ACTIVE', 'INACTIVE');
CREATE TYPE "ServiceAssignmentStatus" AS ENUM ('ACTIVE', 'INACTIVE');
CREATE TYPE "ServiceShiftType" AS ENUM ('DAY', 'NIGHT', 'CUSTOM');
CREATE TYPE "WeekDay" AS ENUM (
  'MONDAY',
  'TUESDAY',
  'WEDNESDAY',
  'THURSDAY',
  'FRIDAY',
  'SATURDAY',
  'SUNDAY'
);

CREATE TABLE "ServicePersonnel" (
  "id" TEXT NOT NULL,
  "personnelType" "PersonnelType" NOT NULL,
  "employeeId" TEXT,
  "serviceProviderId" TEXT,
  "name" TEXT NOT NULL,
  "phoneNumber" TEXT,
  "email" TEXT,
  "jobRole" TEXT NOT NULL,
  "status" "PersonnelStatus" NOT NULL DEFAULT 'ACTIVE',
  "createdById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "ServicePersonnel_pkey" PRIMARY KEY ("id"),
  -- Source references may become NULL after their source record is deleted,
  -- but a live reference must always agree with the personnel type.
  CONSTRAINT "ServicePersonnel_source_check" CHECK (
    ("personnelType" = 'INTERNAL' AND "serviceProviderId" IS NULL)
    OR
    ("personnelType" = 'EXTERNAL' AND "employeeId" IS NULL)
  )
);

CREATE TABLE "PropertyServiceAssignment" (
  "id" TEXT NOT NULL,
  "personnelId" TEXT NOT NULL,
  "propertyId" TEXT NOT NULL,
  "serviceCategory" "ServiceCategory" NOT NULL,
  "jobRole" TEXT NOT NULL,
  "startDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "endDate" TIMESTAMP(3),
  "status" "ServiceAssignmentStatus" NOT NULL DEFAULT 'ACTIVE',
  "notes" TEXT,
  "createdById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "PropertyServiceAssignment_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PropertyServiceAssignment_dates_check" CHECK (
    "endDate" IS NULL OR "endDate" >= "startDate"
  )
);

CREATE TABLE "PersonnelSchedule" (
  "id" TEXT NOT NULL,
  "assignmentId" TEXT NOT NULL,
  "dayOfWeek" "WeekDay" NOT NULL,
  "shiftType" "ServiceShiftType" NOT NULL DEFAULT 'DAY',
  "startTime" TEXT,
  "endTime" TEXT,
  "effectiveFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "effectiveTo" TIMESTAMP(3),
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "notes" TEXT,
  "createdById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "PersonnelSchedule_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PersonnelSchedule_dates_check" CHECK (
    "effectiveTo" IS NULL OR "effectiveTo" >= "effectiveFrom"
  ),
  CONSTRAINT "PersonnelSchedule_custom_time_check" CHECK (
    "shiftType" <> 'CUSTOM' OR ("startTime" IS NOT NULL AND "endTime" IS NOT NULL)
  )
);

CREATE UNIQUE INDEX "ServicePersonnel_employeeId_key" ON "ServicePersonnel"("employeeId");
CREATE INDEX "ServicePersonnel_personnelType_idx" ON "ServicePersonnel"("personnelType");
CREATE INDEX "ServicePersonnel_serviceProviderId_idx" ON "ServicePersonnel"("serviceProviderId");
CREATE INDEX "ServicePersonnel_createdById_idx" ON "ServicePersonnel"("createdById");
CREATE INDEX "ServicePersonnel_status_idx" ON "ServicePersonnel"("status");

CREATE INDEX "PropertyServiceAssignment_personnelId_idx" ON "PropertyServiceAssignment"("personnelId");
CREATE INDEX "PropertyServiceAssignment_propertyId_status_idx" ON "PropertyServiceAssignment"("propertyId", "status");
CREATE INDEX "PropertyServiceAssignment_serviceCategory_idx" ON "PropertyServiceAssignment"("serviceCategory");
CREATE INDEX "PropertyServiceAssignment_startDate_endDate_idx" ON "PropertyServiceAssignment"("startDate", "endDate");
CREATE UNIQUE INDEX "PropertyServiceAssignment_active_personnel_property_key"
  ON "PropertyServiceAssignment"("personnelId", "propertyId")
  WHERE "status" = 'ACTIVE';

CREATE INDEX "PersonnelSchedule_assignmentId_isActive_idx" ON "PersonnelSchedule"("assignmentId", "isActive");
CREATE INDEX "PersonnelSchedule_dayOfWeek_shiftType_idx" ON "PersonnelSchedule"("dayOfWeek", "shiftType");
CREATE INDEX "PersonnelSchedule_effectiveFrom_effectiveTo_idx" ON "PersonnelSchedule"("effectiveFrom", "effectiveTo");
CREATE UNIQUE INDEX "PersonnelSchedule_active_assignment_day_shift_key"
  ON "PersonnelSchedule"("assignmentId", "dayOfWeek", "shiftType")
  WHERE "isActive" = true;

ALTER TABLE "ServicePersonnel"
  ADD CONSTRAINT "ServicePersonnel_employeeId_fkey"
  FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ServicePersonnel"
  ADD CONSTRAINT "ServicePersonnel_serviceProviderId_fkey"
  FOREIGN KEY ("serviceProviderId") REFERENCES "ServiceProvider"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ServicePersonnel"
  ADD CONSTRAINT "ServicePersonnel_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "PropertyServiceAssignment"
  ADD CONSTRAINT "PropertyServiceAssignment_personnelId_fkey"
  FOREIGN KEY ("personnelId") REFERENCES "ServicePersonnel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PropertyServiceAssignment"
  ADD CONSTRAINT "PropertyServiceAssignment_propertyId_fkey"
  FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PropertyServiceAssignment"
  ADD CONSTRAINT "PropertyServiceAssignment_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "PersonnelSchedule"
  ADD CONSTRAINT "PersonnelSchedule_assignmentId_fkey"
  FOREIGN KEY ("assignmentId") REFERENCES "PropertyServiceAssignment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PersonnelSchedule"
  ADD CONSTRAINT "PersonnelSchedule_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
