import prisma from '../lib/prisma.js';

// ======================================================
// HELPERS
// ======================================================

/**
 * Verify the actor has permission to manage service-provider
 * assignments for the given property.
 *
 * ADMIN: any property.
 * MANAGER: only properties where managerId === userId.
 * Everyone else: denied.
 *
 * Returns the property (so callers can reuse `property.id`), or
 * null on deny. Callers must turn a null return into a 403 (or
 * 404 when the property itself doesn't exist — see handlers).
 */
const resolvePropertyForActor = async (actorId, actorRole, propertyId) => {
  if (actorRole === 'ADMIN') {
    const property = await prisma.property.findUnique({
      where: { id: propertyId },
      select: { id: true, name: true, managerId: true }
    });
    return property; // null if property doesn't exist
  }

  if (actorRole === 'MANAGER') {
    const property = await prisma.property.findFirst({
      where: { id: propertyId, managerId: actorId },
      select: { id: true, name: true, managerId: true }
    });
    return property; // null if not found OR not owned by this manager
  }

  return null; // roles other than ADMIN/MANAGER are not allowed
};

/**
 * Load a provider row for the purposes of the assignment endpoints.
 * We only need id + name for the response; the actual authorization
 * is based on property scope, not on who the provider is.
 */
const loadProvider = async (providerId) => {
  return prisma.serviceProvider.findUnique({
    where: { id: providerId },
    select: { id: true, name: true, propertyId: true }
  });
};

// Shape returned by all three endpoints. Keep it stable so the
// frontend can rely on the same keys whether the caller just did a
// GET, a POST, or a DELETE.
const serializeAssignment = (link, provider) => ({
  assignmentId: link.id,
  isActive: link.isActive,
  assignedAt: link.assignedAt,
  assignedById: link.assignedById,
  propertyId: link.propertyId,
  provider: provider
    ? {
        id: provider.id,
        name: provider.name,
        // The legacy primary property is exposed so the admin UI can
        // show "primary vs additional" without an extra fetch. It is
        // a read-only fact from the staff creation flow.
        primaryPropertyId: provider.propertyId,
      }
    : null,
});

// ======================================================
// LIST ASSIGNMENTS FOR A PROPERTY
// ======================================================

// @desc    List service providers currently assigned to a property
// @route   GET /api/properties/:propertyId/service-providers
// @access  Private (ADMIN, MANAGER scoped to owned property)
export const listAssignments = async (req, res) => {
  try {
    const actorId = req.user.id;
    const actorRole = req.user.role;

    if (actorRole !== 'ADMIN' && actorRole !== 'MANAGER') {
      return res.status(403).json({
        message: 'Only ADMIN or MANAGER can list service-provider assignments'
      });
    }

    const { propertyId } = req.params;

    const property = await resolvePropertyForActor(actorId, actorRole, propertyId);
    if (!property) {
      // Whether the property doesn't exist or is out of scope, we
      // respond 404 — never confirm existence outside the actor's scope.
      return res.status(404).json({ message: 'Property not found' });
    }

    const [activeLinks, inactiveLinks] = await Promise.all([
      prisma.serviceProviderProperty.findMany({
        where: { propertyId, isActive: true },
        include: {
          serviceProvider: {
            select: { id: true, name: true, propertyId: true }
          }
        },
        orderBy: { assignedAt: 'desc' }
      }),
      prisma.serviceProviderProperty.findMany({
        where: { propertyId, isActive: false },
        include: {
          serviceProvider: {
            select: { id: true, name: true, propertyId: true }
          }
        },
        orderBy: { assignedAt: 'desc' }
      })
    ]);

    res.json({
      success: true,
      property: { id: property.id, name: property.name },
      active: activeLinks.map(l => serializeAssignment(l, l.serviceProvider)),
      inactive: inactiveLinks.map(l => serializeAssignment(l, l.serviceProvider)),
    });
  } catch (error) {
    console.error('listAssignments error:', error);
    res.status(400).json({ message: error.message });
  }
};

// ======================================================
// ASSIGN
// ======================================================

// @desc    Assign a service provider to a property
// @route   POST /api/properties/:propertyId/service-providers/:providerId/assign
// @access  Private (ADMIN, MANAGER scoped to owned property)
//
// Idempotent:
//   - If no row exists, creates an active row.
//   - If a row exists and is already active, returns it unchanged (200).
//   - If a row exists but is inactive, re-activates it (200).
export const assignProvider = async (req, res) => {
  try {
    const actorId = req.user.id;
    const actorRole = req.user.role;

    if (actorRole !== 'ADMIN' && actorRole !== 'MANAGER') {
      return res.status(403).json({
        message: 'Only ADMIN or MANAGER can assign service providers'
      });
    }

    const { propertyId, providerId } = req.params;

    const property = await resolvePropertyForActor(actorId, actorRole, propertyId);
    if (!property) {
      return res.status(404).json({ message: 'Property not found' });
    }

    const provider = await loadProvider(providerId);
    if (!provider) {
      // Don't confirm whether the provider exists outside scope — 404.
      return res.status(404).json({ message: 'Service provider not found' });
    }

    // Look up any existing row for this (provider, property) pair.
    // The unique constraint is (serviceProviderId, propertyId), so
    // this lookup is at most one row.
    const existing = await prisma.serviceProviderProperty.findUnique({
      where: {
        serviceProviderId_propertyId: {
          serviceProviderId: providerId,
          propertyId,
        }
      }
    });

    let link;
    if (!existing) {
      link = await prisma.serviceProviderProperty.create({
        data: {
          serviceProviderId: providerId,
          propertyId,
          isActive: true,
          assignedById: actorId,
        }
      });
    } else if (!existing.isActive) {
      link = await prisma.serviceProviderProperty.update({
        where: { id: existing.id },
        data: {
          isActive: true,
          assignedAt: new Date(),
          assignedById: actorId,
        }
      });
    } else {
      // Already active — no-op. Return the existing row so callers
      // can be retry-safe (e.g., UI double-click).
      link = existing;
    }

    // Invalidate the provider's cached accessible-property set.
    // The stage-3 permissionService caches getAccessiblePropertyIds
    // per (userId, role) and ServiceProviderProperty changes are NOT
    // tracked by the RBAC invalidation hooks. Simplest correct fix:
    // flush the specific provider user's cache if one exists. If the
    // provider has no portal account yet, this is a no-op.
    try {
      const providerUser = await prisma.user.findFirst({
        where: { serviceProviderProfileId: providerId },
        select: { id: true }
      });
      if (providerUser) {
        const permissionService = (await import('../services/permissionService.js')).default;
        await permissionService.invalidateUserCache(providerUser.id);
      }
    } catch (cacheErr) {
      // Cache invalidation is best-effort — never fail the request
      // because of it. The TTL will catch up in 5 min otherwise.
      console.warn('assignProvider: cache invalidation failed', cacheErr.message);
    }

    res.status(200).json({
      success: true,
      message: existing?.isActive
        ? 'Service provider is already assigned to this property'
        : 'Service provider assigned successfully',
      assignment: serializeAssignment(link, provider),
    });
  } catch (error) {
    console.error('assignProvider error:', error);
    res.status(400).json({ message: error.message });
  }
};

// ======================================================
// UNASSIGN
// ======================================================

// @desc    Unassign a service provider from a property (soft delete)
// @route   DELETE /api/properties/:propertyId/service-providers/:providerId/unassign
// @access  Private (ADMIN, MANAGER scoped to owned property)
//
// Idempotent:
//   - If no assignment exists, returns 200 with `assignment: null`.
//     Rationale: "unassigning" something that isn't assigned is a
//     successful end state, and clients that retry after a network
//     blip shouldn't see a 4xx.
//   - If an active assignment exists, soft-deletes it (isActive=false).
//   - If an inactive assignment exists, returns it unchanged.
export const unassignProvider = async (req, res) => {
  try {
    const actorId = req.user.id;
    const actorRole = req.user.role;

    if (actorRole !== 'ADMIN' && actorRole !== 'MANAGER') {
      return res.status(403).json({
        message: 'Only ADMIN or MANAGER can unassign service providers'
      });
    }

    const { propertyId, providerId } = req.params;

    const property = await resolvePropertyForActor(actorId, actorRole, propertyId);
    if (!property) {
      return res.status(404).json({ message: 'Property not found' });
    }

    const provider = await loadProvider(providerId);
    if (!provider) {
      return res.status(404).json({ message: 'Service provider not found' });
    }

    const existing = await prisma.serviceProviderProperty.findUnique({
      where: {
        serviceProviderId_propertyId: {
          serviceProviderId: providerId,
          propertyId,
        }
      }
    });

    if (!existing) {
      // Nothing to unassign — but a caller's intent is satisfied, so 200.
      return res.status(200).json({
        success: true,
        message: 'Service provider was not assigned to this property',
        assignment: null,
      });
    }

    if (!existing.isActive) {
      return res.status(200).json({
        success: true,
        message: 'Service provider is already unassigned from this property',
        assignment: serializeAssignment(existing, provider),
      });
    }

    const link = await prisma.serviceProviderProperty.update({
      where: { id: existing.id },
      data: { isActive: false }
    });

    // Same best-effort cache invalidation as assignProvider.
    try {
      const providerUser = await prisma.user.findFirst({
        where: { serviceProviderProfileId: providerId },
        select: { id: true }
      });
      if (providerUser) {
        const permissionService = (await import('../services/permissionService.js')).default;
        await permissionService.invalidateUserCache(providerUser.id);
      }
    } catch (cacheErr) {
      console.warn('unassignProvider: cache invalidation failed', cacheErr.message);
    }

    res.status(200).json({
      success: true,
      message: 'Service provider unassigned successfully',
      assignment: serializeAssignment(link, provider),
    });
  } catch (error) {
    console.error('unassignProvider error:', error);
    res.status(400).json({ message: error.message });
  }
};