import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

// @desc    Get all leads
// @route   GET /api/leads
// @access  Private
export const getLeads = async (req, res) => {
  try {
    const leads = await prisma.lead.findMany({
      include: {
        property: true
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
        property: true
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

// @desc    Create lead
// @route   POST /api/leads
// @access  Private
export const createLead = async (req, res) => {
  try {
    const { name, phone, address, natureOfLead, notes, propertyId } = req.body;

    const lead = await prisma.lead.create({
      data: {
        name,
        phone,
        address,
        natureOfLead,
        notes,
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

// @desc    Update lead
// @route   PUT /api/leads/:id
// @access  Private
export const updateLead = async (req, res) => {
  try {
    const { name, phone, address, natureOfLead, notes, propertyId } = req.body;

    const lead = await prisma.lead.update({
      where: { id: req.params.id },
      data: {
        name,
        phone,
        address,
        natureOfLead,
        notes,
        propertyId
      },
      include: {
        property: true
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