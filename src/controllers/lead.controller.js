import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

// @desc    Get all leads
// @route   GET /api/leads
// @access  Private
export const getLeads = async (req, res) => {
  try {
    const leads = await prisma.lead.findMany({
      include: {
        property: true,
        offerLetters: {
          orderBy: { createdAt: 'desc' },
          take: 1 // Get most recent offer letter
        }
      },
      orderBy: { createdAt: 'desc' }
    });
    res.json(leads);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

// @desc    Get single lead
// @route   GET /api/leads/:id
// @access  Private
export const getLead = async (req, res) => {
  try {
    const lead = await prisma.lead.findUnique({
      where: { id: req.params.id },
      include: {
        property: true,
        offerLetters: {
          orderBy: { createdAt: 'desc' }
        }
      }
    });

    if (!lead) {
      return res.status(404).json({ message: 'Lead not found' });
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
      idNumber,      // ADD THIS
      companyName,   // ADD THIS
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
        idNumber: idNumber || null,        // ADD THIS
        companyName: companyName || null,  // ADD THIS
        natureOfLead: natureOfLead || null,
        notes: notes || null,
        propertyId: propertyId || null
      },
      include: {
        property: true
      }
    });

    res.status(201).json(lead);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

// Update the createLeadWithOffer function similarly


// @desc    Create lead with offer letter
// @route   POST /api/leads/with-offer
// @access  Private (Admin/Manager)
export const createLeadWithOffer = async (req, res) => {
  try {
    const {
      // Lead data
      name,
      email,
      phone,
      address,
      idNumber,      // ADDED
      companyName,   // ADDED
      natureOfLead,
      notes,
      
      // Property and Unit
      propertyId,
      unitId,
      
      // Offer letter data
      rentAmount,
      deposit,
      leaseTerm,
      serviceCharge,
      escalationRate,
      
      expiryDate,
      additionalTerms,
      letterType // For mixed-use properties
    } = req.body;

    // Validate required fields
    if (!name || !phone || !propertyId) {
      return res.status(400).json({ 
        message: 'Name, phone, and property are required' 
      });
    }

    // Fetch property to determine letter type
    const property = await prisma.property.findUnique({
      where: { id: propertyId },
      include: { landlord: true }
    });

    if (!property) {
      return res.status(404).json({ message: 'Property not found' });
    }

    // For mixed-use properties, require explicit letter type
    if (property.usage === 'MIXED_USE' && !letterType) {
      return res.status(400).json({
        message: 'Letter type is required for mixed-use properties',
        requiresSelection: true,
        property: property
      });
    }

    // Determine letter type
    let determinedLetterType;
    if (property.usage === 'MIXED_USE') {
      determinedLetterType = letterType;
    } else if (['COMMERCIAL', 'INDUSTRIAL', 'INSTITUTIONAL'].includes(property.usage)) {
      determinedLetterType = 'COMMERCIAL';
    } else {
      determinedLetterType = 'RESIDENTIAL';
    }

    // Fetch unit if provided
    let unit = null;
    if (unitId) {
      unit = await prisma.unit.findUnique({
        where: { id: unitId }
      });
      
      if (!unit) {
        return res.status(404).json({ message: 'Unit not found' });
      }
    }

    // Generate unique offer number
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const count = await prisma.offerLetter.count({
      where: {
        offerNumber: {
          startsWith: `OFL-${year}-${month}`
        }
      }
    });
    const offerNumber = `OFL-${year}-${month}-${String(count + 1).padStart(6, '0')}`;

    // Create lead and offer letter in a transaction
    const result = await prisma.$transaction(async (tx) => {
      // Create lead
      const newLead = await tx.lead.create({
        data: {
          name,
          email: email || null,
          phone,
          address: address || null,
          idNumber: idNumber || null,        // ADDED
          companyName: companyName || null,  // ADDED
          natureOfLead: natureOfLead || null,
          notes: notes || null,
          propertyId
        }
      });

      // Create offer letter
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

    // Fetch complete data with relations
    const leadWithOffer = await prisma.lead.findUnique({
      where: { id: result.lead.id },
      include: {
        property: {
          include: {
            landlord: true
          }
        },
        offerLetters: {
          include: {
            unit: true
          }
        }
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
    const { 
      name, 
      email, 
      phone, 
      address, 
      idNumber,      // ADDED
      companyName,   // ADDED
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
        ...(idNumber !== undefined && { idNumber }),        // ADDED
        ...(companyName !== undefined && { companyName }),  // ADDED
        ...(natureOfLead !== undefined && { natureOfLead }),
        ...(notes !== undefined && { notes }),
        ...(propertyId !== undefined && { propertyId })
      },
      include: {
        property: true,
        offerLetters: {
          orderBy: { createdAt: 'desc' }
        }
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
    await prisma.lead.delete({
      where: { id: req.params.id }
    });

    res.json({ message: 'Lead deleted successfully' });
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};
