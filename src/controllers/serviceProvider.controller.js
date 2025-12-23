import prisma from "../lib/prisma.js";


// @desc    Get all service providers
// @route   GET /api/service-providers
// @access  Private
export const getServiceProviders = async (req, res) => {
  try {
    const providers = await prisma.serviceProvider.findMany({
      include: { property: true },
      orderBy: { name: 'asc' }
    });
    res.json(providers);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

// @desc    Get service providers by property
// @route   GET /api/service-providers/property/:propertyId
// @access  Private
export const getServiceProvidersByProperty = async (req, res) => {
  try {
    const providers = await prisma.serviceProvider.findMany({
      where: { propertyId: req.params.propertyId },
      include: { property: true }
    });
    res.json(providers);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

// @desc    Get single service provider
// @route   GET /api/service-providers/:id
// @access  Private
export const getServiceProvider = async (req, res) => {
  try {
    const provider = await prisma.serviceProvider.findUnique({
      where: { id: req.params.id },
      include: { property: true }
    });

    if (!provider) {
      return res.status(404).json({ message: 'Service provider not found' });
    }

    res.json(provider);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

// @desc    Create service provider
// @route   POST /api/service-providers
// @access  Private
export const createServiceProvider = async (req, res) => {
  try {
    const {
      propertyId,
      name,
      contact,
      contractPeriod,
      serviceContract,
      chargeAmount,
      chargeFrequency,
    } = req.body;

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
    res.status(400).json({ message: error.message });
  }
};

// @desc    Update service provider
// @route   PUT /api/service-providers/:id
// @access  Private
export const updateServiceProvider = async (req, res) => {
  try {
    const {
      name,
      contact,
      contractPeriod,
      serviceContract,
      chargeAmount,
      chargeFrequency,
    } = req.body;

    const provider = await prisma.serviceProvider.update({
      where: { id: req.params.id },
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
    res.status(400).json({ message: error.message });
  }
};

// @desc    Delete service provider
// @route   DELETE /api/service-providers/:id
// @access  Private
export const deleteServiceProvider = async (req, res) => {
  try {
    await prisma.serviceProvider.delete({
      where: { id: req.params.id }
    });

    res.json({ message: 'Service provider deleted successfully' });
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};
