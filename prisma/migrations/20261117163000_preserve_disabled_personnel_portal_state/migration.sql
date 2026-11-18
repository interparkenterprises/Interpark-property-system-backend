-- Preserve deliberate disablement for any portal account managed before the
-- explicit portalAccessStatus column existed.

WITH latest_portal_event AS (
  SELECT DISTINCT ON ("changes"->>'personnelId')
    "changes"->>'personnelId' AS "personnelId",
    "action"
  FROM "RBACAuditLog"
  WHERE "action" IN (
    'PERSONNEL_PORTAL_ACCESS_GRANTED',
    'PERSONNEL_PORTAL_ACCESS_DISABLED',
    'PERSONNEL_PORTAL_ACCESS_ENABLED'
  )
    AND "changes"->>'personnelId' IS NOT NULL
  ORDER BY "changes"->>'personnelId', "createdAt" DESC
)
UPDATE "ServicePersonnel" AS personnel
SET "portalAccessStatus" = 'DISABLED'::"PersonnelPortalAccessStatus"
FROM latest_portal_event
WHERE personnel."id" = latest_portal_event."personnelId"
  AND latest_portal_event."action" = 'PERSONNEL_PORTAL_ACCESS_DISABLED';
