import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

// @desc    Get all units
// @route   GET /api/units
// @access  Private
export const getUnits = async (req, res) => {
  try {
    const units = await prisma.unit.findMany({
      include: {
        property: true,
        tenant: true
      },
      orderBy: { property: { name: 'asc' } }
    });
    res.json(units);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

// @desc    Get units by property
// @route   GET /api/units/property/:propertyId
// @access  Private
export const getUnitsByProperty = async (req, res) => {
  try {
    const units = await prisma.unit.findMany({
      where: { propertyId: req.params.propertyId },
      include: {
        property: true,
        tenant: true
      }
    });
    res.json(units);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

// @desc    Get single unit
// @route   GET /api/units/:id
// @access  Private
export const getUnit = async (req, res) => {
  try {
    const unit = await prisma.unit.findUnique({
      where: { id: req.params.id },
      include: {
        property: {
          include: {
            landlord: true,
            manager: { select: { id: true, name: true, email: true } }
          }
        },
        tenant: true
      }
    });

    if (!unit) {
      return res.status(404).json({ message: 'Unit not found' });
    }

    res.json(unit);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

// @desc    Create unit
// @route   POST /api/units
// @access  Private
export const createUnit = async (req, res) => {
  try {
    const { propertyId, bedrooms, bathrooms, sizeSqFt, type, status, rentType, rentAmount } = req.body;

    const unit = await prisma.unit.create({
      data: {
        propertyId,
        bedrooms,
        bathrooms,
        sizeSqFt,
        type,
        status: status || 'VACANT',
        rentType,
        rentAmount
      },
      include: {
        property: true,
        tenant: true
      }
    });

    res.status(201).json(unit);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

// @desc    Update unit
// @route   PUT /api/units/:id
// @access  Private
export const updateUnit = async (req, res) => {
  try {
    const { bedrooms, bathrooms, sizeSqFt, type, status, rentType, rentAmount } = req.body;

    const unit = await prisma.unit.update({
      where: { id: req.params.id },
      data: {
        bedrooms,
        bathrooms,
        sizeSqFt,
        type,
        status,
        rentType,
        rentAmount
      },
      include: {
        property: true,
        tenant: true
      }
    });

    res.json(unit);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

// @desc    Delete unit
// @route   DELETE /api/units/:id
// @access  Private (Admin only)
export const deleteUnit = async (req, res) => {
  try {
    await prisma.unit.delete({
      where: { id: req.params.id }
    });

    res.json({ message: 'Unit deleted successfully' });
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};