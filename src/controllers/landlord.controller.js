import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

// @desc    Get all landlords
// @route   GET /api/landlords
// @access  Private
export const getLandlords = async (req, res) => {
  try {
    const landlords = await prisma.landlord.findMany({
      include: {
        properties: {
          include: {
            units: true,
            manager: { select: { id: true, name: true, email: true } }
          }
        }
      },
      orderBy: { createdAt: 'desc' }
    });
    res.json(landlords);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

// @desc    Get single landlord
// @route   GET /api/landlords/:id
// @access  Private
export const getLandlord = async (req, res) => {
  try {
    const landlord = await prisma.landlord.findUnique({
      where: { id: req.params.id },
      include: {
        properties: {
          include: {
            units: true,
            manager: { select: { id: true, name: true, email: true } }
          }
        }
      }
    });

    if (!landlord) {
      return res.status(404).json({ message: 'Landlord not found' });
    }

    res.json(landlord);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

// @desc    Create landlord
// @route   POST /api/landlords
// @access  Private
export const createLandlord = async (req, res) => {
  try {
    const { name, email, phone, address, idNumber } = req.body;  // ADD idNumber

    if (!name) {
      return res.status(400).json({ message: 'Name is required' });
    }

    const landlord = await prisma.landlord.create({
      data: {
        name,
        email: email || null,
        phone: phone || null,
        address: address || null,
        idNumber: idNumber || null  // ADD THIS
      }
    });

    res.status(201).json(landlord);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

// @desc    Update landlord
// @route   PUT /api/landlords/:id
// @access  Private
export const updateLandlord = async (req, res) => {
  try {
    const { name, email, phone, address, idNumber } = req.body;  // ADD idNumber

    const landlord = await prisma.landlord.update({
      where: { id: req.params.id },
      data: {
        ...(name !== undefined && { name }),
        ...(email !== undefined && { email }),
        ...(phone !== undefined && { phone }),
        ...(address !== undefined && { address }),
        ...(idNumber !== undefined && { idNumber })  // ADD THIS
      }
    });

    res.json({
      success: true,
      message: 'Landlord updated successfully',
      data: landlord
    });
  } catch (error) {
    res.status(400).json({ 
      success: false,
      message: error.message 
    });
  }
};
// @desc    Delete landlord
// @route   DELETE /api/landlords/:id
// @access  Private (Admin only)
export const deleteLandlord = async (req, res) => {
  try {
    await prisma.landlord.delete({
      where: { id: req.params.id }
    });

    res.json({ message: 'Landlord deleted successfully' });
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};