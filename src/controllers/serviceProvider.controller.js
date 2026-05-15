import prisma from "../lib/prisma.js";
import permissionService from "../services/permissionService.js";

// Helper function to check if user has access to a property
const checkPropertyAccess = async (userId, userRole, propertyId, requiredPermission = 'canView') => {
  if (userRole === 'ADMIN') {
    return true;
  }
  
  if (userRole === 'MANAGER') {
    const property = await prisma.property.findFirst({
      where: { id: propertyId, managerId: userId }
    });
    return !!property;
  }
  
  if (userRole === 'USER') {
    return await permissionService.checkPropertyAccess(userId, propertyId, requiredPermission);
  }
  
  return false;
};

// Helper function to check if user has write access to a service provider
const checkServiceProviderWriteAccess = async (userId, userRole, providerId = null) => {
  if (userRole === 'ADMIN') {
    return true;
  }
  
  if (userRole === 'MANAGER') {
    if (providerId) {
      const provider = await prisma.serviceProvider.findUnique({
        where: { id: providerId },
        include: { property: true }
      });
      if (!provider) return false;
      return provider.property.managerId === userId;
    }
    return true;
  }
  
  if (userRole === 'USER') {
    if (providerId) {
      const provider = await prisma.serviceProvider.findUnique({
        where: { id: providerId },
        include: { property: true }
      });
      if (!provider) return false;
      return await permissionService.checkPropertyAccess(userId, provider.propertyId, 'canEdit');
    }
    return false; // USER needs a specific property to create
  }
  
  return false;
};

// @desc    Get all service providers
// @route   GET /api/service-providers
// @access  Private
export const getServiceProviders = async (req, res) => {
  try {
    const userId = req.user.id;
    const userRole = req.user.role;

    let providers;

    if (userRole === 'ADMIN') {
      // Admin sees all service providers
      providers = await prisma.serviceProvider.findMany({
        include: { property: true },
        orderBy: { name: 'asc' }
      });
    } else if (userRole === 'MANAGER') {
      // Manager sees service providers for their properties
      providers = await prisma.serviceProvider.findMany({
        where: {
          property: {
            managerId: userId
          }
        },
        include: { property: true },
        orderBy: { name: 'asc' }
      });
    } else if (userRole === 'USER') {
      // USER sees service providers for accessible properties
      const accessiblePropertyIds = await permissionService.getAccessiblePropertyIds(userId, userRole);
      
      if (accessiblePropertyIds.length === 0) {
        return res.json([]);
      }
      
      providers = await prisma.serviceProvider.findMany({
        where: {
          propertyId: { in: accessiblePropertyIds }
        },
        include: { property: true },
        orderBy: { name: 'asc' }
      });
    } else {
      return res.status(403).json({ message: 'Access denied' });
    }

    res.json(providers);
  } catch (error) {
    console.error('Get service providers error:', error);
    res.status(400).json({ message: error.message });
  }
};

// @desc    Get service providers by property
// @route   GET /api/service-providers/property/:propertyId
// @access  Private
export const getServiceProvidersByProperty = async (req, res) => {
  try {
    const userId = req.user.id;
    const userRole = req.user.role;
    const { propertyId } = req.params;

    // Check property access
    const hasAccess = await checkPropertyAccess(userId, userRole, propertyId, 'canView');
    
    if (!hasAccess) {
      return res.status(403).json({ message: 'Access denied to this property' });
    }

    const providers = await prisma.serviceProvider.findMany({
      where: { propertyId },
      include: { property: true }
    });

    res.json(providers);
  } catch (error) {
    console.error('Get service providers by property error:', error);
    res.status(400).json({ message: error.message });
  }
};

// @desc    Get single service provider
// @route   GET /api/service-providers/:id
// @access  Private
export const getServiceProvider = async (req, res) => {
  try {
    const userId = req.user.id;
    const userRole = req.user.role;
    const { id } = req.params;

    const provider = await prisma.serviceProvider.findUnique({
      where: { id },
      include: { property: true }
    });

    if (!provider) {
      return res.status(404).json({ message: 'Service provider not found' });
    }

    // Check access
    const hasAccess = await checkPropertyAccess(userId, userRole, provider.propertyId, 'canView');
    
    if (!hasAccess) {
      return res.status(403).json({ message: 'Access denied to this service provider' });
    }

    res.json(provider);
  } catch (error) {
    console.error('Get service provider error:', error);
    res.status(400).json({ message: error.message });
  }
};

// @desc    Create service provider
// @route   POST /api/service-providers
// @access  Private
export const createServiceProvider = async (req, res) => {
  try {
    const userId = req.user.id;
    const userRole = req.user.role;
    const {
      propertyId,
      name,
      contact,
      contractPeriod,
      serviceContract,
      chargeAmount,
      chargeFrequency,
    } = req.body;

    // Check if user has write access to the property
    const hasWriteAccess = await checkPropertyAccess(userId, userRole, propertyId, 'canEdit');
    
    if (!hasWriteAccess) {
      return res.status(403).json({ message: 'Access denied. You do not have permission to create service providers for this property.' });
    }

    const provider = await prisma.serviceProvider.create({
      data: {
        propertyId,
        name,
        contact,
        contractPeriod,
        serviceContract,
        chargeAmount,
        chargeFrequency,
      },
      include: { property: true }
    });

    res.status(201).json(provider);
  } catch (error) {
    console.error('Create service provider error:', error);
    res.status(400).json({ message: error.message });
  }
};

// @desc    Update service provider
// @route   PUT /api/service-providers/:id
// @access  Private
export const updateServiceProvider = async (req, res) => {
  try {
    const userId = req.user.id;
    const userRole = req.user.role;
    const { id } = req.params;
    const {
      name,
      contact,
      contractPeriod,
      serviceContract,
      chargeAmount,
      chargeFrequency,
    } = req.body;

    // Check if service provider exists and get property info
    const existingProvider = await prisma.serviceProvider.findUnique({
      where: { id },
      include: { property: true }
    });

    if (!existingProvider) {
      return res.status(404).json({ message: 'Service provider not found' });
    }

    // Check write access
    const hasWriteAccess = await checkServiceProviderWriteAccess(userId, userRole, id);
    
    if (!hasWriteAccess) {
      return res.status(403).json({ message: 'Access denied. You do not have permission to update this service provider.' });
    }

    const provider = await prisma.serviceProvider.update({
      where: { id },
      data: {
        name,
        contact,
        contractPeriod,
        serviceContract,
        chargeAmount,
        chargeFrequency,
      },
      include: { property: true }
    });

    res.json(provider);
  } catch (error) {
    console.error('Update service provider error:', error);
    res.status(400).json({ message: error.message });
  }
};

// @desc    Delete service provider
// @route   DELETE /api/service-providers/:id
// @access  Private
export const deleteServiceProvider = async (req, res) => {
  try {
    const userId = req.user.id;
    const userRole = req.user.role;
    const { id } = req.params;

    // Check if service provider exists and get property info
    const existingProvider = await prisma.serviceProvider.findUnique({
      where: { id },
      include: { property: true }
    });

    if (!existingProvider) {
      return res.status(404).json({ message: 'Service provider not found' });
    }

    // Check write access
    const hasWriteAccess = await checkServiceProviderWriteAccess(userId, userRole, id);
    
    if (!hasWriteAccess) {
      return res.status(403).json({ message: 'Access denied. You do not have permission to delete this service provider.' });
    }

    await prisma.serviceProvider.delete({
      where: { id }
    });

    res.json({ message: 'Service provider deleted successfully' });
  } catch (error) {
    console.error('Delete service provider error:', error);
    res.status(400).json({ message: error.message });
  }
};