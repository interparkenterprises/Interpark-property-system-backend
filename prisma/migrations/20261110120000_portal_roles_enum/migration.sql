-- ============================================================
-- Migration: portal_roles_enum
--
-- Purpose:
--   Append LANDLORD / TENANT / SERVICE_PROVIDER to enum "Role".
--
-- IMPORTANT:
--   ALTER TYPE ... ADD VALUE must live in its own migration file
--   and outside of any enclosing transaction, per PostgreSQL's
--   restrictions on enum value addition inside a transaction.
--
-- Every ADD VALUE uses IF NOT EXISTS, making the file idempotent
-- when replayed against a shadow database.
-- ============================================================

ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'LANDLORD';
ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'TENANT';
ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'SERVICE_PROVIDER';