-- CreateEnum
CREATE TYPE "TaskPriority" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'URGENT');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "ToDoStatus" ADD VALUE 'IN_PROGRESS';
ALTER TYPE "ToDoStatus" ADD VALUE 'PENDING_APPROVAL';
ALTER TYPE "ToDoStatus" ADD VALUE 'OVERDUE';
ALTER TYPE "ToDoStatus" ADD VALUE 'REJECTED';

-- AlterTable
ALTER TABLE "ToDo" ADD COLUMN     "approvedAt" TIMESTAMP(3),
ADD COLUMN     "approvedById" TEXT,
ADD COLUMN     "assignedById" TEXT,
ADD COLUMN     "completedAt" TIMESTAMP(3),
ADD COLUMN     "completionNotes" TEXT,
ADD COLUMN     "isSelfCreated" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "priority" "TaskPriority" NOT NULL DEFAULT 'MEDIUM',
ADD COLUMN     "rejectionReason" TEXT,
ADD COLUMN     "requiresApproval" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "reviewedAt" TIMESTAMP(3),
ADD COLUMN     "reviewedById" TEXT,
ADD COLUMN     "updatedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "ToDo_userId_idx" ON "ToDo"("userId");

-- CreateIndex
CREATE INDEX "ToDo_assignedById_idx" ON "ToDo"("assignedById");

-- CreateIndex
CREATE INDEX "ToDo_status_idx" ON "ToDo"("status");

-- CreateIndex
CREATE INDEX "ToDo_dueDate_idx" ON "ToDo"("dueDate");

-- CreateIndex
CREATE INDEX "ToDo_userId_status_idx" ON "ToDo"("userId", "status");

-- CreateIndex
CREATE INDEX "ToDo_userId_dueDate_idx" ON "ToDo"("userId", "dueDate");

-- AddForeignKey
ALTER TABLE "ToDo" ADD CONSTRAINT "ToDo_assignedById_fkey" FOREIGN KEY ("assignedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ToDo" ADD CONSTRAINT "ToDo_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ToDo" ADD CONSTRAINT "ToDo_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
