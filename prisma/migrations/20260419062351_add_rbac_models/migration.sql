-- CreateEnum
CREATE TYPE "PermissionScope" AS ENUM ('GLOBAL', 'PROPERTY');

-- AlterEnum
ALTER TYPE "Role" ADD VALUE 'USER';

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "canManagerLogin" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "createdByManagerId" TEXT,
ADD COLUMN     "isManagedUser" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "lastLoginAt" TIMESTAMP(3),
ADD COLUMN     "passwordChangedAt" TIMESTAMP(3),
ADD COLUMN     "passwordResetExpires" TIMESTAMP(3),
ADD COLUMN     "passwordResetToken" TEXT;

-- CreateTable
CREATE TABLE "Permission" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "category" TEXT NOT NULL,
    "scope" "PermissionScope" NOT NULL DEFAULT 'PROPERTY',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Permission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RoleTemplate" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "category" TEXT NOT NULL,
    "permissions" JSONB NOT NULL,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RoleTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomRole" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "createdById" TEXT NOT NULL,
    "templateId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomRole_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomRolePermission" (
    "id" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "permissionId" TEXT NOT NULL,
    "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "grantedById" TEXT NOT NULL,

    CONSTRAINT "CustomRolePermission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserRoleAssignment" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "assignedBy" TEXT NOT NULL,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "UserRoleAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomRolePropertyAccess" (
    "id" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT NOT NULL,

    CONSTRAINT "CustomRolePropertyAccess_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PropertyAccess" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "roleId" TEXT,
    "grantedBy" TEXT NOT NULL,
    "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "canView" BOOLEAN NOT NULL DEFAULT true,
    "canEdit" BOOLEAN NOT NULL DEFAULT false,
    "canDelete" BOOLEAN NOT NULL DEFAULT false,
    "canExport" BOOLEAN NOT NULL DEFAULT false,
    "customPermissions" JSONB,

    CONSTRAINT "PropertyAccess_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RBACAuditLog" (
    "id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "performedBy" TEXT NOT NULL,
    "targetUser" TEXT,
    "targetRole" TEXT,
    "targetProperty" TEXT,
    "changes" JSONB,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RBACAuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ManagedPermission" (
    "id" TEXT NOT NULL,
    "managerId" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ManagedPermission_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Permission_code_key" ON "Permission"("code");

-- CreateIndex
CREATE INDEX "Permission_category_idx" ON "Permission"("category");

-- CreateIndex
CREATE INDEX "Permission_code_idx" ON "Permission"("code");

-- CreateIndex
CREATE INDEX "Permission_scope_idx" ON "Permission"("scope");

-- CreateIndex
CREATE UNIQUE INDEX "RoleTemplate_name_key" ON "RoleTemplate"("name");

-- CreateIndex
CREATE INDEX "RoleTemplate_category_idx" ON "RoleTemplate"("category");

-- CreateIndex
CREATE INDEX "RoleTemplate_isSystem_idx" ON "RoleTemplate"("isSystem");

-- CreateIndex
CREATE INDEX "RoleTemplate_createdBy_idx" ON "RoleTemplate"("createdBy");

-- CreateIndex
CREATE INDEX "CustomRole_createdById_idx" ON "CustomRole"("createdById");

-- CreateIndex
CREATE INDEX "CustomRole_name_idx" ON "CustomRole"("name");

-- CreateIndex
CREATE INDEX "CustomRole_templateId_idx" ON "CustomRole"("templateId");

-- CreateIndex
CREATE UNIQUE INDEX "CustomRole_name_createdById_key" ON "CustomRole"("name", "createdById");

-- CreateIndex
CREATE INDEX "CustomRolePermission_roleId_idx" ON "CustomRolePermission"("roleId");

-- CreateIndex
CREATE INDEX "CustomRolePermission_permissionId_idx" ON "CustomRolePermission"("permissionId");

-- CreateIndex
CREATE INDEX "CustomRolePermission_grantedById_idx" ON "CustomRolePermission"("grantedById");

-- CreateIndex
CREATE UNIQUE INDEX "CustomRolePermission_roleId_permissionId_key" ON "CustomRolePermission"("roleId", "permissionId");

-- CreateIndex
CREATE INDEX "UserRoleAssignment_userId_idx" ON "UserRoleAssignment"("userId");

-- CreateIndex
CREATE INDEX "UserRoleAssignment_roleId_idx" ON "UserRoleAssignment"("roleId");

-- CreateIndex
CREATE INDEX "UserRoleAssignment_assignedBy_idx" ON "UserRoleAssignment"("assignedBy");

-- CreateIndex
CREATE INDEX "UserRoleAssignment_isActive_idx" ON "UserRoleAssignment"("isActive");

-- CreateIndex
CREATE INDEX "UserRoleAssignment_expiresAt_idx" ON "UserRoleAssignment"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "UserRoleAssignment_userId_roleId_key" ON "UserRoleAssignment"("userId", "roleId");

-- CreateIndex
CREATE INDEX "CustomRolePropertyAccess_roleId_idx" ON "CustomRolePropertyAccess"("roleId");

-- CreateIndex
CREATE INDEX "CustomRolePropertyAccess_propertyId_idx" ON "CustomRolePropertyAccess"("propertyId");

-- CreateIndex
CREATE INDEX "CustomRolePropertyAccess_createdBy_idx" ON "CustomRolePropertyAccess"("createdBy");

-- CreateIndex
CREATE UNIQUE INDEX "CustomRolePropertyAccess_roleId_propertyId_key" ON "CustomRolePropertyAccess"("roleId", "propertyId");

-- CreateIndex
CREATE INDEX "PropertyAccess_userId_idx" ON "PropertyAccess"("userId");

-- CreateIndex
CREATE INDEX "PropertyAccess_propertyId_idx" ON "PropertyAccess"("propertyId");

-- CreateIndex
CREATE INDEX "PropertyAccess_roleId_idx" ON "PropertyAccess"("roleId");

-- CreateIndex
CREATE INDEX "PropertyAccess_grantedBy_idx" ON "PropertyAccess"("grantedBy");

-- CreateIndex
CREATE INDEX "PropertyAccess_isActive_idx" ON "PropertyAccess"("isActive");

-- CreateIndex
CREATE INDEX "PropertyAccess_expiresAt_idx" ON "PropertyAccess"("expiresAt");

-- CreateIndex
CREATE INDEX "PropertyAccess_canView_canEdit_canDelete_idx" ON "PropertyAccess"("canView", "canEdit", "canDelete");

-- CreateIndex
CREATE UNIQUE INDEX "PropertyAccess_userId_propertyId_key" ON "PropertyAccess"("userId", "propertyId");

-- CreateIndex
CREATE INDEX "RBACAuditLog_performedBy_idx" ON "RBACAuditLog"("performedBy");

-- CreateIndex
CREATE INDEX "RBACAuditLog_targetUser_idx" ON "RBACAuditLog"("targetUser");

-- CreateIndex
CREATE INDEX "RBACAuditLog_targetRole_idx" ON "RBACAuditLog"("targetRole");

-- CreateIndex
CREATE INDEX "RBACAuditLog_createdAt_idx" ON "RBACAuditLog"("createdAt");

-- CreateIndex
CREATE INDEX "RBACAuditLog_action_idx" ON "RBACAuditLog"("action");

-- CreateIndex
CREATE INDEX "ManagedPermission_managerId_idx" ON "ManagedPermission"("managerId");

-- CreateIndex
CREATE INDEX "ManagedPermission_roleId_idx" ON "ManagedPermission"("roleId");

-- CreateIndex
CREATE UNIQUE INDEX "ManagedPermission_managerId_roleId_key" ON "ManagedPermission"("managerId", "roleId");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_createdByManagerId_fkey" FOREIGN KEY ("createdByManagerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomRole" ADD CONSTRAINT "CustomRole_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomRole" ADD CONSTRAINT "CustomRole_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "RoleTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomRolePermission" ADD CONSTRAINT "CustomRolePermission_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "CustomRole"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomRolePermission" ADD CONSTRAINT "CustomRolePermission_permissionId_fkey" FOREIGN KEY ("permissionId") REFERENCES "Permission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomRolePermission" ADD CONSTRAINT "CustomRolePermission_grantedById_fkey" FOREIGN KEY ("grantedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserRoleAssignment" ADD CONSTRAINT "UserRoleAssignment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserRoleAssignment" ADD CONSTRAINT "UserRoleAssignment_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "CustomRole"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserRoleAssignment" ADD CONSTRAINT "UserRoleAssignment_assignedBy_fkey" FOREIGN KEY ("assignedBy") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomRolePropertyAccess" ADD CONSTRAINT "CustomRolePropertyAccess_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "CustomRole"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomRolePropertyAccess" ADD CONSTRAINT "CustomRolePropertyAccess_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomRolePropertyAccess" ADD CONSTRAINT "CustomRolePropertyAccess_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PropertyAccess" ADD CONSTRAINT "PropertyAccess_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PropertyAccess" ADD CONSTRAINT "PropertyAccess_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PropertyAccess" ADD CONSTRAINT "PropertyAccess_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "CustomRole"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PropertyAccess" ADD CONSTRAINT "PropertyAccess_grantedBy_fkey" FOREIGN KEY ("grantedBy") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RBACAuditLog" ADD CONSTRAINT "RBACAuditLog_performedBy_fkey" FOREIGN KEY ("performedBy") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ManagedPermission" ADD CONSTRAINT "ManagedPermission_managerId_fkey" FOREIGN KEY ("managerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ManagedPermission" ADD CONSTRAINT "ManagedPermission_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "CustomRole"("id") ON DELETE CASCADE ON UPDATE CASCADE;
