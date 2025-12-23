import prisma from "../lib/prisma.js";

// @desc    Get all landlords
// @route   GET /api/landlords
// @access  Private
export const getLandlords = async (req, res) => {
  try {
    const userId = req.user.id;
    const userRole = req.user.role;

    let landlords;

    if (userRole === 'ADMIN') {
      // Admin sees all landlords
      landlords = await prisma.landlord.findMany({
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
    } else if (userRole === 'MANAGER') {
      // Manager sees only landlords whose properties they manage
      const managerProperties = await prisma.property.findMany({
        where: { managerId: userId },
        select: { landlordId: true }
      });

      const landlordIds = [...new Set(managerProperties.map(p => p.landlordId))];

      landlords = await prisma.landlord.findMany({
        where: {
          id: { in: landlordIds }
        },
        include: {
          properties: {
            where: {
              managerId: userId // Only show properties they manage
            },
            include: {
              units: true,
              manager: { select: { id: true, name: true, email: true } }
            }
          }
        },
        orderBy: { createdAt: 'desc' }
      });
    } else {
      return res.status(403).json({ message: 'Access denied' });
    }

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
    const userId = req.user.id;
    const userRole = req.user.role;

    let landlord;

    if (userRole === 'ADMIN') {
      // Admin can see any landlord
      landlord = await prisma.landlord.findUnique({
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
    } else if (userRole === 'MANAGER') {
      // Manager can only see landlord if they manage at least one property
      landlord = await prisma.landlord.findUnique({
        where: { id: req.params.id },
        include: {
          properties: {
            where: {
              managerId: userId // Only properties they manage
            },
            include: {
              units: true,
              manager: { select: { id: true, name: true, email: true } }
            }
          }
        }
      });

      // Check if manager has access to this landlord
      if (landlord && landlord.properties.length === 0) {
        return res.status(403).json({ message: 'Access denied to this landlord' });
      }
    } else {
      return res.status(403).json({ message: 'Access denied' });
    }

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
    const { name, email, phone, address, idNumber } = req.body;

    if (!name) {
      return res.status(400).json({ message: 'Name is required' });
    }

    const landlord = await prisma.landlord.create({
      data: {
        name,
        email: email || null,
        phone: phone || null,
        address: address || null,
        idNumber: idNumber || null
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
    const userId = req.user.id;
    const userRole = req.user.role;
    const { name, email, phone, address, idNumber } = req.body;

    // Check access rights for managers
    if (userRole === 'MANAGER') {
      const landlord = await prisma.landlord.findUnique({
        where: { id: req.params.id },
        include: {
          properties: {
            where: { managerId: userId }
          }
        }
      });

      if (!landlord || landlord.properties.length === 0) {
        return res.status(403).json({ 
          success: false,
          message: 'Access denied to update this landlord' 
        });
      }
    }

    const landlord = await prisma.landlord.update({
      where: { id: req.params.id },
      data: {
        ...(name !== undefined && { name }),
        ...(email !== undefined && { email }),
        ...(phone !== undefined && { phone }),
        ...(address !== undefined && { address }),
        ...(idNumber !== undefined && { idNumber })
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
