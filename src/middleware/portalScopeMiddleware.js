import prisma from '../lib/prisma.js';
import { isTenantFrozenNow } from '../services/tenantFreeze.js';

/**
 * Anti-IDOR helper used by portal controllers.
 *
 * Given a list of IDs the authenticated portal user is allowed to touch,
 * and an ID coming from the client (usually a URL param), throw a 404 if
 * the client ID is not in the allowed set. We prefer 404 over 403 to
 * avoid confirming the existence of records outside the caller's scope.
 *
 * Usage inside a controller:
 *     assertIn(req.landlordPropertyIds, req.params.propertyId);
 */
export const assertIn = (allowedIds, requestedId) => {
  if (!requestedId) {
    const err = new Error('Record not found');
    err.statusCode = 404;
    throw err;
  }
  const allowed = Array.isArray(allowedIds) ? allowedIds : [];
  if (!allowed.includes(requestedId)) {
    const err = new Error('Record not found');
    err.statusCode = 404;
    throw err;
  }
  return true;
};

// ======================================================
// LANDLORD
// ======================================================
export const requireLandlordScope = async (req, res, next) => {
  try {
    if (!req.user || req.user.role !== 'LANDLORD') {
      return res.status(403).json({ message: 'Landlord scope required' });
    }

    const landlordProfileId = req.user.landlordProfileId;
    if (!landlordProfileId) {
      return res.status(403).json({
        message: 'This account is not linked to a landlord profile. Please contact your administrator.'
      });
    }

    // Verify the linked profile still exists. ON DELETE SET NULL on the
    // User FK means a deleted Landlord would leave the User row with a
    // null FK — but be defensive: if the profile row is gone, refuse.
    const landlord = await prisma.landlord.findUnique({
      where: { id: landlordProfileId },
      select: { id: true, name: true, email: true }
    });
    if (!landlord) {
      return res.status(403).json({
        message: 'Your landlord profile is no longer available. Please contact your administrator.'
      });
    }

    // Owned properties only. No manager, no PropertyAccess, no role grants.
    const properties = await prisma.property.findMany({
      where: { landlordId: landlordProfileId },
      select: { id: true }
    });

    req.landlordProfile = landlord;
    req.landlordProfileId = landlordProfileId;
    req.landlordPropertyIds = properties.map(p => p.id);

    next();
  } catch (error) {
    console.error('requireLandlordScope error:', error);
    res.status(500).json({ message: 'Server error resolving landlord scope' });
  }
};

// ======================================================
// TENANT
// ======================================================
export const requireTenantScope = async (req, res, next) => {
  try {
    if (!req.user || req.user.role !== 'TENANT') {
      return res.status(403).json({ message: 'Tenant scope required' });
    }

    const tenantProfileId = req.user.tenantProfileId;
    if (!tenantProfileId) {
      return res.status(403).json({
        message: 'This account is not linked to a tenant profile. Please contact your administrator.'
      });
    }

    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantProfileId },
      include: {
        unit: {
          select: {
            id: true,
            unitNo: true,
            type: true,
            unitType: true,
            floor: true,
            sizeSqFt: true,
            bedrooms: true,
            bathrooms: true,
            propertyId: true,
            property: {
              select: {
                id: true,
                name: true,
                address: true,
                form: true,
                usage: true,
                lrNumber: true,
                image: true,
              }
            }
          }
        },
        freezePeriods: { orderBy: { startDate: 'desc' } },
      }
    });

    if (!tenant) {
      return res.status(403).json({
        message: 'Your tenant profile is no longer available. Please contact your administrator.'
      });
    }

    // Derive lifecycle + freeze states once, here, so controllers don't
    // recompute them inconsistently.
    const isFrozen = isTenantFrozenNow(tenant);
    const isActive = tenant.status === 'ACTIVE';

    req.tenantProfile = tenant;
    req.tenantProfileId = tenantProfileId;
    req.tenantIsActive = isActive;
    req.tenantIsFrozen = isFrozen;
    req.tenantUnitId = tenant.unit?.id || null;
    req.tenantPropertyId = tenant.unit?.propertyId || null;

    // Single-element array kept for symmetry with the landlord/provider
    // middlewares, so `assertIn` works uniformly in tenant controllers.
    req.tenantPropertyIds = tenant.unit?.propertyId ? [tenant.unit.propertyId] : [];

    next();
  } catch (error) {
    console.error('requireTenantScope error:', error);
    res.status(500).json({ message: 'Server error resolving tenant scope' });
  }
};

// ======================================================
// SERVICE PROVIDER
// ======================================================
export const requireServiceProviderScope = async (req, res, next) => {
  try {
    if (!req.user || req.user.role !== 'SERVICE_PROVIDER') {
      return res.status(403).json({ message: 'Service provider scope required' });
    }

    const serviceProviderProfileId = req.user.serviceProviderProfileId;
    if (!serviceProviderProfileId) {
      return res.status(403).json({
        message: 'This account is not linked to a service provider profile. Please contact your administrator.'
      });
    }

    const provider = await prisma.serviceProvider.findUnique({
      where: { id: serviceProviderProfileId },
      select: {
        id: true,
        name: true,
        contact: true,
        contractPeriod: true,
        serviceContract: true,
        chargeAmount: true,
        chargeFrequency: true,
        propertyId: true,                 // legacy single-property FK (kept during rollout)
        propertyLinks: {
          where: { isActive: true },
          select: { propertyId: true, assignedAt: true }
        },
      }
    });

    if (!provider) {
      return res.status(403).json({
        message: 'Your service provider profile is no longer available. Please contact your administrator.'
      });
    }

    // Union of the new join table and the legacy single-property FK,
    // so a provider works correctly even if the backfill hasn't run.
    const ids = new Set();
    for (const link of provider.propertyLinks) ids.add(link.propertyId);
    if (provider.propertyId) ids.add(provider.propertyId);

    req.serviceProviderProfile = provider;
    req.serviceProviderProfileId = serviceProviderProfileId;
    req.serviceProviderPropertyIds = Array.from(ids);

    next();
  } catch (error) {
    console.error('requireServiceProviderScope error:', error);
    res.status(500).json({ message: 'Server error resolving service provider scope' });
  }
};