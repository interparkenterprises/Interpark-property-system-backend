import prisma from "../lib/prisma.js";


// @desc    Get all leads
// @route   GET /api/leads
// @access  Private
export const getLeads = async (req, res) => {
  try {
    const { role, id: userId } = req.user;
    
    // Build where clause based on user role
    let whereClause = {};
    
    // If user is MANAGER, only show leads they created
    // Also show leads with null createdById (existing data) to avoid hiding old leads
    if (role === 'MANAGER') {
      whereClause = {
        OR: [
          { createdById: userId },
          { createdById: null } // Include existing leads without creator
        ]
      };
    }
    // ADMIN sees all leads (no where clause)
    
    const leads = await prisma.lead.findMany({
      where: whereClause,
      include: {
        property: true,
        createdBy: {
          select: {
            id: true,
            name: true,
            email: true
          }
        },
        offerLetters: {
          orderBy: { createdAt: 'desc' },
          take: 1
        }
      },
      orderBy: { createdAt: 'desc' }
    });
    
    res.json(leads);
  } catch (error) {
    console.error('Get leads error:', error);
    res.status(400).json({ message: error.message });
  }
};

// @desc    Get single lead
// @route   GET /api/leads/:id
// @access  Private
export const getLead = async (req, res) => {
  try {
    const { role, id: userId } = req.user;
    
    const lead = await prisma.lead.findUnique({
      where: { id: req.params.id },
      include: {
        property: true,
        createdBy: {
          select: {
            id: true,
            name: true,
            email: true
          }
        },
        offerLetters: {
          orderBy: { createdAt: 'desc' }
        }
      }
    });

    if (!lead) {
      return res.status(404).json({ message: 'Lead not found' });
    }

    // Check permissions: MANAGER can only view their own leads or unassigned leads
    if (role === 'MANAGER' && lead.createdById && lead.createdById !== userId) {
      return res.status(403).json({ message: 'Access denied. You can only view leads you created.' });
    }

    res.json(lead);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

// @desc    Create lead with extended fields
// @route   POST /api/leads
// @access  Private
export const createLead = async (req, res) => {
  try {
    const { 
      name, 
      email, 
      phone, 
      address, 
      idNumber,
      companyName,
      natureOfLead, 
      notes, 
      propertyId 
    } = req.body;

    // Validate required fields
    if (!name || !phone) {
      return res.status(400).json({ 
        message: 'Name and phone are required' 
      });
    }

    const lead = await prisma.lead.create({
      data: {
        name,
        email: email || null,
        phone,
        address: address || null,
        idNumber: idNumber || null,
        companyName: companyName || null,
        natureOfLead: natureOfLead || null,
        notes: notes || null,
        propertyId: propertyId || null,
        createdById: req.user.id // Set the creator
      },
      include: {
        property: true,
        createdBy: {
          select: {
            id: true,
            name: true,
            email: true
          }
        }
      }
    });

    res.status(201).json(lead);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

// @desc    Create lead with offer letter
// @route   POST /api/leads/with-offer
// @access  Private (Admin/Manager)
export const createLeadWithOffer = async (req, res) => {
  try {
    const {
      name,
      email,
      phone,
      address,
      idNumber,
      companyName,
      natureOfLead,
      notes,
      propertyId,
      unitId,
      rentAmount,
      deposit,
      leaseTerm,
      serviceCharge,
      escalationRate,
      expiryDate,
      additionalTerms,
      letterType
    } = req.body;

    if (!name || !phone || !propertyId) {
      return res.status(400).json({ 
        message: 'Name, phone, and property are required' 
      });
    }

    const property = await prisma.property.findUnique({
      where: { id: propertyId },
      include: { landlord: true }
    });

    if (!property) {
      return res.status(404).json({ message: 'Property not found' });
    }

    if (property.usage === 'MIXED_USE' && !letterType) {
      return res.status(400).json({
        message: 'Letter type is required for mixed-use properties',
        requiresSelection: true,
        property: property
      });
    }

    let determinedLetterType;
    if (property.usage === 'MIXED_USE') {
      determinedLetterType = letterType;
    } else if (['COMMERCIAL', 'INDUSTRIAL', 'INSTITUTIONAL'].includes(property.usage)) {
      determinedLetterType = 'COMMERCIAL';
    } else {
      determinedLetterType = 'RESIDENTIAL';
    }

    let unit = null;
    if (unitId) {
      unit = await prisma.unit.findUnique({ where: { id: unitId } });
      if (!unit) return res.status(404).json({ message: 'Unit not found' });
    }

    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const count = await prisma.offerLetter.count({
      where: { offerNumber: { startsWith: `OFL-${year}-${month}` } }
    });
    const offerNumber = `OFL-${year}-${month}-${String(count + 1).padStart(6, '0')}`;

    const result = await prisma.$transaction(async (tx) => {
      const newLead = await tx.lead.create({
        data: {
          name,
          email: email || null,
          phone,
          address: address || null,
          idNumber: idNumber || null,
          companyName: companyName || null,
          natureOfLead: natureOfLead || null,
          notes: notes || null,
          propertyId,
          createdById: req.user.id // Set the creator
        }
      });

      const newOfferLetter = await tx.offerLetter.create({
        data: {
          offerNumber,
          leadId: newLead.id,
          propertyId,
          unitId: unitId || null,
          landlordId: property.landlordId,
          letterType: determinedLetterType,
          usageType: property.usage,
          rentAmount: rentAmount || unit?.rentAmount || 0,
          deposit: deposit || 0,
          leaseTerm: leaseTerm || '',
          serviceCharge: serviceCharge || null,
          escalationRate: escalationRate || null,
          expiryDate: expiryDate ? new Date(expiryDate) : null,
          additionalTerms: additionalTerms || null,
          status: 'DRAFT',
          createdById: req.user.id
        }
      });

      return { lead: newLead, offerLetter: newOfferLetter };
    });

    const leadWithOffer = await prisma.lead.findUnique({
      where: { id: result.lead.id },
      include: {
        property: { include: { landlord: true } },
        createdBy: { select: { id: true, name: true, email: true } },
        offerLetters: { include: { unit: true } }
      }
    });

    res.status(201).json(leadWithOffer);
  } catch (error) {
    console.error('Create lead with offer error:', error);
    res.status(400).json({ message: error.message });
  }
};

// @desc    Update lead
// @route   PUT /api/leads/:id
// @access  Private
export const updateLead = async (req, res) => {
  try {
    const { role, id: userId } = req.user;
    
    const existingLead = await prisma.lead.findUnique({
      where: { id: req.params.id }
    });

    if (!existingLead) {
      return res.status(404).json({ message: 'Lead not found' });
    }

    // MANAGER can only update their own leads or unassigned leads
    if (role === 'MANAGER' && existingLead.createdById && existingLead.createdById !== userId) {
      return res.status(403).json({ message: 'Access denied. You can only update leads you created.' });
    }

    const { 
      name, 
      email, 
      phone, 
      address, 
      idNumber,
      companyName,
      natureOfLead, 
      notes, 
      propertyId 
    } = req.body;

    const lead = await prisma.lead.update({
      where: { id: req.params.id },
      data: {
        ...(name && { name }),
        ...(email !== undefined && { email }),
        ...(phone && { phone }),
        ...(address !== undefined && { address }),
        ...(idNumber !== undefined && { idNumber }),
        ...(companyName !== undefined && { companyName }),
        ...(natureOfLead !== undefined && { natureOfLead }),
        ...(notes !== undefined && { notes }),
        ...(propertyId !== undefined && { propertyId })
      },
      include: {
        property: true,
        createdBy: { select: { id: true, name: true, email: true } },
        offerLetters: { orderBy: { createdAt: 'desc' } }
      }
    });

    res.json(lead);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

// @desc    Delete lead
// @route   DELETE /api/leads/:id
// @access  Private
export const deleteLead = async (req, res) => {
  try {
    const { role, id: userId } = req.user;
    
    const existingLead = await prisma.lead.findUnique({
      where: { id: req.params.id }
    });

    if (!existingLead) {
      return res.status(404).json({ message: 'Lead not found' });
    }

    // Only ADMIN can delete any lead
    // MANAGER can delete their own leads or unassigned leads
    if (role === 'MANAGER' && existingLead.createdById && existingLead.createdById !== userId) {
      return res.status(403).json({ message: 'Access denied. You can only delete leads you created.' });
    }

    await prisma.lead.delete({ where: { id: req.params.id } });

    res.json({ message: 'Lead deleted successfully' });
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};