import prisma from "../lib/prisma.js";
import permissionService from "../services/permissionService.js";

// Helper function to check lead permissions
const checkLeadPermission = async (userId, userRole, leadId, operation) => {
  if (userRole === 'ADMIN') {
    return true;
  }
  
  if (userRole === 'MANAGER') {
    // Managers can see leads they created or leads with no creator (legacy)
    const lead = await prisma.lead.findUnique({
      where: { id: leadId },
      select: { createdById: true }
    });
    return lead && (!lead.createdById || lead.createdById === userId);
  }
  
  if (userRole === 'USER') {
    // Check if user has the specific permission
    const permissionCode = operation === 'view' ? 'VIEW_LEADS' : 
                          operation === 'create' ? 'CREATE_LEAD' :
                          operation === 'edit' ? 'EDIT_LEAD' : 'DELETE_LEAD';
    
    const hasPermission = await permissionService.hasPermission(userId, permissionCode);
    if (!hasPermission) return false;
    
    // Also check if they have access to the property this lead belongs to
    const lead = await prisma.lead.findUnique({
      where: { id: leadId },
      select: { propertyId: true }
    });
    
    if (lead && lead.propertyId) {
      const accessiblePropertyIds = await permissionService.getAccessiblePropertyIds(userId, userRole);
      return accessiblePropertyIds.includes(lead.propertyId);
    }
    
    // If no property associated, just check permission
    return true;
  }
  
  return false;
};

// @desc    Get all leads
// @route   GET /api/leads
// @access  Private (Requires VIEW_LEADS permission)
export const getLeads = async (req, res) => {
  try {
    const userId = req.user.id;
    const userRole = req.user.role;
    
    // Check VIEW_LEADS permission for USER role
    if (userRole === 'USER') {
      const hasViewPermission = await permissionService.hasPermission(userId, 'VIEW_LEADS');
      if (!hasViewPermission) {
        return res.status(403).json({
          success: false,
          message: 'Access denied. You do not have permission to view leads.',
          requiredPermission: 'VIEW_LEADS'
        });
      }
    }
    
    // Build where clause based on user role
    let whereClause = {};
    
    if (userRole === 'ADMIN') {
      // Admin sees all leads
      whereClause = {};
    } else if (userRole === 'MANAGER') {
      // Manager sees leads they created or leads with null createdById (legacy)
      whereClause = {
        OR: [
          { createdById: userId },
          { createdById: null }
        ]
      };
    } else if (userRole === 'USER') {
      // User sees leads from properties they have access to
      const accessiblePropertyIds = await permissionService.getAccessiblePropertyIds(userId, userRole);
      
      if (accessiblePropertyIds.length === 0) {
        return res.json([]);
      }
      
      whereClause = {
        propertyId: { in: accessiblePropertyIds }
      };
    }
    
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
// @access  Private (Requires VIEW_LEADS permission)
export const getLead = async (req, res) => {
  try {
    const userId = req.user.id;
    const userRole = req.user.role;
    const { id } = req.params;
    
    // Check VIEW_LEADS permission for USER role
    if (userRole === 'USER') {
      const hasViewPermission = await permissionService.hasPermission(userId, 'VIEW_LEADS');
      if (!hasViewPermission) {
        return res.status(403).json({
          success: false,
          message: 'Access denied. You do not have permission to view leads.',
          requiredPermission: 'VIEW_LEADS'
        });
      }
    }
    
    const lead = await prisma.lead.findUnique({
      where: { id },
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

    // Check permissions based on role
    if (userRole === 'ADMIN') {
      // Admin has full access
      return res.json(lead);
    }
    
    if (userRole === 'MANAGER') {
      // Manager can only view their own leads or unassigned leads
      if (lead.createdById && lead.createdById !== userId) {
        return res.status(403).json({ 
          message: 'Access denied. You can only view leads you created.' 
        });
      }
      return res.json(lead);
    }
    
    if (userRole === 'USER') {
      // User can only view leads from properties they have access to
      const accessiblePropertyIds = await permissionService.getAccessiblePropertyIds(userId, userRole);
      
      if (!lead.propertyId || !accessiblePropertyIds.includes(lead.propertyId)) {
        return res.status(403).json({ 
          message: 'Access denied. You do not have access to the property associated with this lead.' 
        });
      }
      return res.json(lead);
    }

    res.json(lead);
  } catch (error) {
    console.error('Get lead error:', error);
    res.status(400).json({ message: error.message });
  }
};

// @desc    Create lead with extended fields
// @route   POST /api/leads
// @access  Private (Requires CREATE_LEAD permission)
export const createLead = async (req, res) => {
  try {
    const userId = req.user.id;
    const userRole = req.user.role;
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

    // Check CREATE_LEAD permission for USER role
    if (userRole === 'USER') {
      const hasCreatePermission = await permissionService.hasPermission(userId, 'CREATE_LEAD');
      if (!hasCreatePermission) {
        return res.status(403).json({
          success: false,
          message: 'Access denied. You do not have permission to create leads.',
          requiredPermission: 'CREATE_LEAD'
        });
      }
      
      // If property is specified, check if user has access to it
      if (propertyId) {
        const accessiblePropertyIds = await permissionService.getAccessiblePropertyIds(userId, userRole);
        if (!accessiblePropertyIds.includes(propertyId)) {
          return res.status(403).json({
            message: 'Access denied. You do not have access to the specified property.'
          });
        }
      }
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
        createdById: userId
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
    console.error('Create lead error:', error);
    res.status(400).json({ message: error.message });
  }
};

// @desc    Create lead with offer letter
// @route   POST /api/leads/with-offer
// @access  Private (Requires CREATE_LEAD and CREATE_OFFER_LETTERS permissions)
export const createLeadWithOffer = async (req, res) => {
  try {
    const userId = req.user.id;
    const userRole = req.user.role;
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

    // Check CREATE_LEAD permission for USER role
    if (userRole === 'USER') {
      const hasCreatePermission = await permissionService.hasPermission(userId, 'CREATE_LEAD');
      if (!hasCreatePermission) {
        return res.status(403).json({
          success: false,
          message: 'Access denied. You do not have permission to create leads.',
          requiredPermission: 'CREATE_LEAD'
        });
      }
      
      // Check property access
      const accessiblePropertyIds = await permissionService.getAccessiblePropertyIds(userId, userRole);
      if (!accessiblePropertyIds.includes(propertyId)) {
        return res.status(403).json({
          message: 'Access denied. You do not have access to the specified property.'
        });
      }
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
          createdById: userId
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
          createdById: userId
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
// @access  Private (Requires EDIT_LEAD permission)
export const updateLead = async (req, res) => {
  try {
    const userId = req.user.id;
    const userRole = req.user.role;
    const { id } = req.params;
    
    const existingLead = await prisma.lead.findUnique({
      where: { id }
    });

    if (!existingLead) {
      return res.status(404).json({ message: 'Lead not found' });
    }

    // Check EDIT_LEAD permission
    if (userRole === 'USER') {
      const hasEditPermission = await permissionService.hasPermission(userId, 'EDIT_LEAD');
      if (!hasEditPermission) {
        return res.status(403).json({
          success: false,
          message: 'Access denied. You do not have permission to edit leads.',
          requiredPermission: 'EDIT_LEAD'
        });
      }
      
      // Check property access if property is being changed
      const { propertyId } = req.body;
      if (propertyId) {
        const accessiblePropertyIds = await permissionService.getAccessiblePropertyIds(userId, userRole);
        if (!accessiblePropertyIds.includes(propertyId)) {
          return res.status(403).json({
            message: 'Access denied. You do not have access to the specified property.'
          });
        }
      }
    } else if (userRole === 'MANAGER') {
      // Manager can only update their own leads or unassigned leads
      if (existingLead.createdById && existingLead.createdById !== userId) {
        return res.status(403).json({ 
          message: 'Access denied. You can only update leads you created.' 
        });
      }
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
      where: { id },
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
    console.error('Update lead error:', error);
    res.status(400).json({ message: error.message });
  }
};

// @desc    Delete lead
// @route   DELETE /api/leads/:id
// @access  Private (Requires DELETE_LEAD permission)
export const deleteLead = async (req, res) => {
  try {
    const userId = req.user.id;
    const userRole = req.user.role;
    const { id } = req.params;
    
    const existingLead = await prisma.lead.findUnique({
      where: { id }
    });

    if (!existingLead) {
      return res.status(404).json({ message: 'Lead not found' });
    }

    // Check DELETE_LEAD permission
    if (userRole === 'ADMIN') {
      // Admin can delete any lead
      // Proceed to delete
    } else if (userRole === 'MANAGER') {
      // Manager can delete their own leads or unassigned leads
      if (existingLead.createdById && existingLead.createdById !== userId) {
        return res.status(403).json({ 
          message: 'Access denied. You can only delete leads you created.' 
        });
      }
    } else if (userRole === 'USER') {
      const hasDeletePermission = await permissionService.hasPermission(userId, 'DELETE_LEAD');
      if (!hasDeletePermission) {
        return res.status(403).json({
          success: false,
          message: 'Access denied. You do not have permission to delete leads.',
          requiredPermission: 'DELETE_LEAD'
        });
      }
      
      // Check property access
      if (existingLead.propertyId) {
        const accessiblePropertyIds = await permissionService.getAccessiblePropertyIds(userId, userRole);
        if (!accessiblePropertyIds.includes(existingLead.propertyId)) {
          return res.status(403).json({
            message: 'Access denied. You do not have access to the property associated with this lead.'
          });
        }
      }
    } else {
      return res.status(403).json({ 
        message: 'Access denied. You do not have permission to delete leads.' 
      });
    }

    await prisma.lead.delete({ where: { id } });

    res.json({ message: 'Lead deleted successfully' });
  } catch (error) {
    console.error('Delete lead error:', error);
    res.status(400).json({ message: error.message });
  }
};