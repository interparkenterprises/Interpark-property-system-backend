import { PrismaClient } from '@prisma/client';
import { generateCommercialOfferLetter } from '../template/commercialOfferTemplate.js';
import { generateResidentialOfferLetter } from '../template/residentialOfferTemplate.js';
import { generatePDF } from '../utils/pdfGenerator.js';
import { uploadDocument } from '../utils/uploadHelper.js';

const prisma = new PrismaClient();

// Helper function to parse address into components - FIXED to properly extract P.O. Box
const parseAddress = (address) => {
  if (!address) return { poBox: '', fullAddress: address };
  
  // Try to extract P.O. Box if present (various formats)
  const poBoxPatterns = [
    /P\.?\s*O\.?\s*Box\s*(\d+[\w-]*)/i,  // P.O. Box 12345
    /P\.?\s*O\.?\s*BOX\s*(\d+[\w-]*)/i,  // P.O BOX 12345
    /Post\s*Office\s*Box\s*(\d+[\w-]*)/i, // Post Office Box 12345
    /POBox\s*(\d+[\w-]*)/i,              // POBox12345
    /Box\s*(\d+[\w-]*)/i                  // Box 12345
  ];
  
  let poBox = '';
  for (const pattern of poBoxPatterns) {
    const match = address.match(pattern);
    if (match) {
      poBox = match[1];
      break;
    }
  }
  
  return {
    poBox,
    fullAddress: address
  };
};

// Helper function to format date
const formatDate = (date) => {
  if (!date) return new Date().toLocaleDateString('en-GB');
  return new Date(date).toLocaleDateString('en-GB');
};

// Helper function to calculate deposit and advance amounts
const calculatePayments = (rentAmount, serviceCharge, depositMonths = 1, advanceMonths = 1) => {
  const monthlyTotal = (parseFloat(rentAmount) || 0) + (parseFloat(serviceCharge) || 0);
  const deposit = monthlyTotal * depositMonths;
  const advanceRent = monthlyTotal * advanceMonths;
  
  return { deposit, advanceRent, monthlyTotal };
};

// Helper function to generate unique offer number (Solution 4)
const generateOfferNumber = async () => {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const prefix = `OFL-${year}-${month}`;
  
  // Try up to 5 times to avoid collisions
  for (let attempt = 0; attempt < 5; attempt++) {
    // Get count of existing offers this month
    const count = await prisma.offerLetter.count({
      where: {
        createdAt: {
          gte: new Date(year, now.getMonth(), 1), // First day of current month
          lt: new Date(year, now.getMonth() + 1, 1) // First day of next month
        }
      }
    });
    
    // Add attempt number to sequence to ensure uniqueness
    const sequence = count + 1 + attempt;
    const offerNumber = `${prefix}-${String(sequence).padStart(6, '0')}`;
    
    // Check if this number already exists
    const existing = await prisma.offerLetter.findUnique({
      where: { offerNumber }
    });
    
    if (!existing) {
      return offerNumber;
    }
  }
  
  // If all attempts fail, add timestamp for uniqueness
  const timestamp = Date.now().toString().slice(-6);
  return `${prefix}-${timestamp}`;
};

// @desc    Get all offer letters
// @route   GET /api/offer-letters
// @access  Private
export const getOfferLetters = async (req, res) => {
  try {
    const { propertyId, leadId, status } = req.query;
    
    const where = {};
    if (propertyId) where.propertyId = propertyId;
    if (leadId) where.leadId = leadId;
    if (status) where.status = status;

    const offerLetters = await prisma.offerLetter.findMany({
      where,
      include: {
        lead: true,
        property: {
          include: {
            landlord: true
          }
        },
        unit: true
      },
      orderBy: { createdAt: 'desc' }
    });

    res.json(offerLetters);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

// @desc    Get single offer letter
// @route   GET /api/offer-letters/:id
// @access  Private
export const getOfferLetter = async (req, res) => {
  try {
    const offerLetter = await prisma.offerLetter.findUnique({
      where: { id: req.params.id },
      include: {
        lead: true,
        property: {
          include: {
            landlord: true
          }
        },
        unit: true
      }
    });

    if (!offerLetter) {
      return res.status(404).json({ message: 'Offer letter not found' });
    }

    res.json(offerLetter);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

// @desc    Create offer letter
// @route   POST /api/offer-letters
// @access  Private (Admin/Manager)
export const createOfferLetter = async (req, res) => {
  try {
    const {
      leadId,
      propertyId,
      unitId,
      rentAmount,
      deposit,
      leaseTerm,
      serviceCharge,
      escalationRate,
      expiryDate,
      additionalTerms,
      notes,
      // Additional commercial fields
      rentPerSqFt,
      serviceChargePerSqFt,
      useOfPremises,
      fitOutPeriodMonths,
      depositMonths,
      advanceRentMonths,
      // Additional residential fields
      escalationFrequency
    } = req.body;

    // Validate required fields
    if (!leadId || !propertyId) {
      return res.status(400).json({ 
        message: 'Lead and Property are required' 
      });
    }

    // Fetch related data with all necessary includes
    const [lead, property, unit] = await Promise.all([
      prisma.lead.findUnique({ where: { id: leadId } }),
      prisma.property.findUnique({
        where: { id: propertyId },
        include: { landlord: true }
      }),
      unitId ? prisma.unit.findUnique({ where: { id: unitId } }) : null
    ]);

    if (!lead) {
      return res.status(404).json({ message: 'Lead not found' });
    }

    if (!property) {
      return res.status(404).json({ message: 'Property not found' });
    }

    if (unitId && !unit) {
      return res.status(404).json({ message: 'Unit not found' });
    }

    // Determine letter type based on property usage
    let letterType;
    if (['COMMERCIAL', 'INDUSTRIAL', 'INSTITUTIONAL'].includes(property.usage)) {
      letterType = 'COMMERCIAL';
    } else if (property.usage === 'RESIDENTIAL') {
      letterType = 'RESIDENTIAL';
    } else {
      // For MIXED_USE, require explicit selection
      return res.status(400).json({
        message: 'Please specify letter type for mixed-use property',
        requiresSelection: true,
        property: property
      });
    }

    // Generate unique offer number using the new helper function
    const offerNumber = await generateOfferNumber();

    // Calculate deposit and advance rent if not provided
    const finalRentAmount = rentAmount || unit?.rentAmount || 0;
    const finalServiceCharge = serviceCharge || 0;
    const payments = calculatePayments(
      finalRentAmount, 
      finalServiceCharge,
      depositMonths || 1,
      advanceRentMonths || 1
    );

    // Create offer letter record with extended data
    const offerLetter = await prisma.offerLetter.create({
      data: {
        offerNumber,
        leadId,
        propertyId,
        unitId: unitId || null,
        landlordId: property.landlordId,
        letterType,
        usageType: property.usage,
        rentAmount: finalRentAmount,
        deposit: deposit || payments.deposit,
        leaseTerm: leaseTerm || '',
        serviceCharge: finalServiceCharge,
        escalationRate: escalationRate || null,
        expiryDate: expiryDate ? new Date(expiryDate) : null,
        additionalTerms: additionalTerms || null,
        status: 'DRAFT',
        notes: notes || null,
        createdById: req.user.id,
        // Store additional metadata
        metadata: {
          rentPerSqFt: rentPerSqFt || (unit?.sizeSqFt ? finalRentAmount / unit.sizeSqFt : null),
          serviceChargePerSqFt: serviceChargePerSqFt || null,
          useOfPremises: useOfPremises || null,
          fitOutPeriodMonths: fitOutPeriodMonths || null,
          depositMonths: depositMonths || 1,
          advanceRentMonths: advanceRentMonths || 1,
          escalationFrequency: escalationFrequency || 'ANNUALLY'
        }
      },
      include: {
        lead: true,
        property: {
          include: {
            landlord: true
          }
        },
        unit: true
      }
    });

    res.status(201).json(offerLetter);
  } catch (error) {
    console.error('Create offer letter error:', error);
    
    // Handle specific error cases
    if (error.code === 'P2002' && error.meta?.target?.includes('offerNumber')) {
      return res.status(409).json({ 
        message: 'Offer number conflict. Please try again.',
        details: 'The generated offer number already exists. This is rare but can happen with concurrent requests.'
      });
    }
    
    res.status(400).json({ message: error.message });
  }
};

// @desc    Create offer letter for mixed-use property with type selection
// @route   POST /api/offer-letters/mixed-use
// @access  Private (Admin/Manager)
export const createMixedUseOfferLetter = async (req, res) => {
  try {
    const {
      leadId,
      propertyId,
      unitId,
      letterType, // Must be explicitly provided: 'COMMERCIAL' or 'RESIDENTIAL'
      rentAmount,
      deposit,
      leaseTerm,
      serviceCharge,
      escalationRate,
      expiryDate,
      additionalTerms,
      notes,
      // Additional fields
      rentPerSqFt,
      serviceChargePerSqFt,
      useOfPremises,
      fitOutPeriodMonths,
      depositMonths,
      advanceRentMonths,
      escalationFrequency
    } = req.body;

    // Validate required fields
    if (!leadId || !propertyId || !letterType) {
      return res.status(400).json({ 
        message: 'Lead, Property, and Letter Type are required for mixed-use properties' 
      });
    }

    if (!['COMMERCIAL', 'RESIDENTIAL'].includes(letterType)) {
      return res.status(400).json({
        message: 'Letter type must be either COMMERCIAL or RESIDENTIAL'
      });
    }

    // Fetch related data
    const [lead, property, unit] = await Promise.all([
      prisma.lead.findUnique({ where: { id: leadId } }),
      prisma.property.findUnique({
        where: { id: propertyId },
        include: { landlord: true }
      }),
      unitId ? prisma.unit.findUnique({ where: { id: unitId } }) : null
    ]);

    if (!lead) {
      return res.status(404).json({ message: 'Lead not found' });
    }

    if (!property) {
      return res.status(404).json({ message: 'Property not found' });
    }

    if (property.usage !== 'MIXED_USE') {
      return res.status(400).json({
        message: 'This endpoint is only for mixed-use properties'
      });
    }

    if (unitId && !unit) {
      return res.status(404).json({ message: 'Unit not found' });
    }

    // Generate unique offer number using the same helper function
    const offerNumber = await generateOfferNumber();

    // Calculate payments
    const finalRentAmount = rentAmount || unit?.rentAmount || 0;
    const finalServiceCharge = serviceCharge || 0;
    const payments = calculatePayments(
      finalRentAmount,
      finalServiceCharge,
      depositMonths || 1,
      advanceRentMonths || 1
    );

    // Create offer letter record
    const offerLetter = await prisma.offerLetter.create({
      data: {
        offerNumber,
        leadId,
        propertyId,
        unitId: unitId || null,
        landlordId: property.landlordId,
        letterType,
        usageType: property.usage,
        rentAmount: finalRentAmount,
        deposit: deposit || payments.deposit,
        leaseTerm: leaseTerm || '',
        serviceCharge: finalServiceCharge,
        escalationRate: escalationRate || null,
        expiryDate: expiryDate ? new Date(expiryDate) : null,
        additionalTerms: additionalTerms || null,
        status: 'DRAFT',
        notes: notes || null,
        createdById: req.user.id,
        metadata: {
          rentPerSqFt: rentPerSqFt || (unit?.sizeSqFt ? finalRentAmount / unit.sizeSqFt : null),
          serviceChargePerSqFt: serviceChargePerSqFt || null,
          useOfPremises: useOfPremises || null,
          fitOutPeriodMonths: fitOutPeriodMonths || null,
          depositMonths: depositMonths || 1,
          advanceRentMonths: advanceRentMonths || 1,
          escalationFrequency: escalationFrequency || 'ANNUALLY'
        }
      },
      include: {
        lead: true,
        property: {
          include: {
            landlord: true
          }
        },
        unit: true
      }
    });

    res.status(201).json(offerLetter);
  } catch (error) {
    console.error('Create mixed-use offer letter error:', error);
    
    // Handle specific error cases
    if (error.code === 'P2002' && error.meta?.target?.includes('offerNumber')) {
      return res.status(409).json({ 
        message: 'Offer number conflict. Please try again.',
        details: 'The generated offer number already exists. This is rare but can happen with concurrent requests.'
      });
    }
    
    res.status(400).json({ message: error.message });
  }
};

// @desc    Generate PDF for offer letter with complete data extraction - FIXED VERSION
// @route   POST /api/offer-letters/:id/generate-pdf
// @access  Private (Admin/Manager)
export const generateOfferLetterPDF = async (req, res) => {
  try {
    const offerLetter = await prisma.offerLetter.findUnique({
      where: { id: req.params.id },
      include: {
        lead: true,
        property: {
          include: {
            landlord: true
          }
        },
        unit: true
      }
    });

    if (!offerLetter) {
      return res.status(404).json({ message: 'Offer letter not found' });
    }

    // Parse addresses properly - FIXED
    const landlordAddressData = parseAddress(offerLetter.property.landlord?.address);
    const leadAddressData = parseAddress(offerLetter.lead.address);
    const propertyAddressData = parseAddress(offerLetter.property.address);

    // Get metadata
    const metadata = offerLetter.metadata || {};

    // Base template data with FIXED field mappings and PROPER DATE HANDLING
    const baseTemplateData = {
      // Property details
      propertyName: offerLetter.property.name,
      propertyAddress: offerLetter.property.address,
      propertyPOBox: propertyAddressData.poBox,
      propertyLRNumber: offerLetter.property.lrNumber,
      
      // Landlord details - FIXED P.O. Box handling
      landlordName: offerLetter.property.landlord?.name,
      landlordPOBox: landlordAddressData.poBox, // Now properly extracted
      landlordAddress: offerLetter.property.landlord?.address,
      landlordIDNumber: offerLetter.property.landlord?.idNumber,
      
      // Bank details from property
      landlordBankAccount: offerLetter.property.accountNo,
      landlordAccountName: offerLetter.property.accountName,
      landlordBankName: offerLetter.property.bank,
      landlordBankBranch: offerLetter.property.branch,
      landlordBankBranchCode: offerLetter.property.branchCode,
      
      // Lead details - FIXED P.O. Box handling
      leadName: offerLetter.lead.name,
      leadEmail: offerLetter.lead.email,
      leadPOBox: leadAddressData.poBox, // Now properly extracted
      leadAddress: offerLetter.lead.address,
      leadIDNumber: offerLetter.lead.idNumber,
      leadPINNumber: offerLetter.lead.pinNumber,
      leadCompanyName: offerLetter.lead.companyName,
      leadPhone: offerLetter.lead.phone,
      
      // Offer details - FIXED: Always provide valid dates
      date: new Date().toISOString(), // Current date for the agreement
      offerNumber: offerLetter.offerNumber,
      rentAmount: offerLetter.rentAmount,
      deposit: offerLetter.deposit,
      leaseTerm: offerLetter.leaseTerm,
      serviceCharge: offerLetter.serviceCharge,
      escalationRate: offerLetter.escalationRate,
      leaseStartDate: offerLetter.leaseStartDate || new Date().toISOString(), // Fallback to current date
      rentStartDate: offerLetter.rentStartDate || new Date().toISOString(), // Fallback to current date
      
      // Additional terms
      additionalTerms: offerLetter.additionalTerms
    };

    // Generate HTML based on letter type
    let htmlContent;
    
    if (offerLetter.letterType === 'COMMERCIAL') {
      const commercialData = {
        ...baseTemplateData,
        // Unit/Space details
        floor: offerLetter.unit?.floor || metadata.floor,
        areaSqFt: offerLetter.unit?.sizeSqFt,
        rentPerSqFt: metadata.rentPerSqFt || (offerLetter.unit?.sizeSqFt ? offerLetter.rentAmount / offerLetter.unit.sizeSqFt : null),
        serviceChargePerSqFt: metadata.serviceChargePerSqFt,
        
        // Commercial-specific
        useOfPremises: metadata.useOfPremises || offerLetter.unit?.usage || 'General Business',
        fitOutPeriod: metadata.fitOutPeriodMonths ? true : false,
        fitOutPeriodMonths: metadata.fitOutPeriodMonths,
        depositMonths: metadata.depositMonths || 1,
        advanceRentMonths: metadata.advanceRentMonths || 1,
        
        // Calculate advance rent
        advanceRent: (offerLetter.rentAmount + (offerLetter.serviceCharge || 0)) * (metadata.advanceRentMonths || 1),
        
        // Escalation
        serviceChargeEscalationRate: metadata.serviceChargeEscalationRate || 5,
        
        // Defaults
        vatRate: 16,
        interestRate: 15,
        offerValidityDays: 7,
        operatingHoursStart: '7:00 am',
        operatingHoursEnd: '9:00 pm',
        guarantorsRequired: true,
        promotionalExpenses: false,
        includeTerraceArea: false,
        separateWaterElectricity: true
      };
      
      htmlContent = generateCommercialOfferLetter(commercialData);
    } else {
      // RESIDENTIAL - FIXED field mappings and DATE FIXES
      const residentialData = {
        ...baseTemplateData,
        // Unit details - FIXED: proper mapping from unit.unitNo
        houseNumber: offerLetter.unit?.unitNo || offerLetter.unit?.type, // FIXED: Now maps from unitNo
        bedrooms: offerLetter.unit?.bedrooms,  // FIXED: Now properly passed
        bathrooms: offerLetter.unit?.bathrooms, // FIXED: Now properly passed
        floorNumber: offerLetter.unit?.floor,   // FIXED: Now properly passed
        
        // Residential-specific
        escalationFrequency: metadata.escalationFrequency || 'ANNUALLY'
      };
      
      htmlContent = generateResidentialOfferLetter(residentialData);
    }

    // Generate PDF
    const pdfBuffer = await generatePDF(htmlContent);

    // Upload to storage
    const documentUrl = await uploadDocument(
      pdfBuffer,
      `offer-letters/${offerLetter.offerNumber}.pdf`
    );

    // Update offer letter with document URL
    const updatedOfferLetter = await prisma.offerLetter.update({
      where: { id: offerLetter.id },
      data: { documentUrl }
    });

    res.json({
      message: 'PDF generated successfully',
      documentUrl,
      offerLetter: updatedOfferLetter
    });
  } catch (error) {
    console.error('Generate PDF error:', error);
    res.status(500).json({ message: error.message });
  }
};

// @desc    Download offer letter PDF with complete data - FIXED VERSION
// @route   GET /api/offer-letters/:id/download
// @access  Private
export const downloadOfferLetterPDF = async (req, res) => {
  try {
    const offerLetter = await prisma.offerLetter.findUnique({
      where: { id: req.params.id },
      include: {
        lead: true,
        property: {
          include: {
            landlord: true
          }
        },
        unit: true
      }
    });

    if (!offerLetter) {
      return res.status(404).json({ message: 'Offer letter not found' });
    }

    // Parse addresses properly - FIXED
    const landlordAddressData = parseAddress(offerLetter.property.landlord?.address);
    const leadAddressData = parseAddress(offerLetter.lead.address);
    const propertyAddressData = parseAddress(offerLetter.property.address);

    // Get metadata
    const metadata = offerLetter.metadata || {};

    // Base template data (same as generate PDF) - FIXED with PROPER DATES
    const baseTemplateData = {
      propertyName: offerLetter.property.name,
      propertyAddress: offerLetter.property.address,
      propertyPOBox: propertyAddressData.poBox,
      propertyLRNumber: offerLetter.property.lrNumber,
      landlordName: offerLetter.property.landlord?.name,
      landlordPOBox: landlordAddressData.poBox, // FIXED
      landlordAddress: offerLetter.property.landlord?.address,
      landlordIDNumber: offerLetter.property.landlord?.idNumber,
      landlordBankAccount: offerLetter.property.accountNo,
      landlordAccountName: offerLetter.property.accountName,
      landlordBankName: offerLetter.property.bank,
      landlordBankBranch: offerLetter.property.branch,
      landlordBankBranchCode: offerLetter.property.branchCode,
      leadName: offerLetter.lead.name,
      leadEmail: offerLetter.lead.email,
      leadPOBox: leadAddressData.poBox, // FIXED
      leadAddress: offerLetter.lead.address,
      leadIDNumber: offerLetter.lead.idNumber,
      leadPINNumber: offerLetter.lead.pinNumber,
      leadCompanyName: offerLetter.lead.companyName,
      leadPhone: offerLetter.lead.phone,
      // FIXED: Always provide valid dates
      date: new Date().toISOString(), // Current date for the agreement
      offerNumber: offerLetter.offerNumber,
      rentAmount: offerLetter.rentAmount,
      deposit: offerLetter.deposit,
      leaseTerm: offerLetter.leaseTerm,
      serviceCharge: offerLetter.serviceCharge,
      escalationRate: offerLetter.escalationRate,
      leaseStartDate: offerLetter.leaseStartDate || new Date().toISOString(), // Fallback to current date
      rentStartDate: offerLetter.rentStartDate || new Date().toISOString(), // Fallback to current date
      additionalTerms: offerLetter.additionalTerms
    };

    // Generate HTML based on letter type
    let htmlContent;
    
    if (offerLetter.letterType === 'COMMERCIAL') {
      const commercialData = {
        ...baseTemplateData,
        floor: offerLetter.unit?.floor || metadata.floor,
        areaSqFt: offerLetter.unit?.sizeSqFt,
        rentPerSqFt: metadata.rentPerSqFt || (offerLetter.unit?.sizeSqFt ? offerLetter.rentAmount / offerLetter.unit.sizeSqFt : null),
        serviceChargePerSqFt: metadata.serviceChargePerSqFt,
        useOfPremises: metadata.useOfPremises || offerLetter.unit?.usage || 'General Business',
        fitOutPeriod: metadata.fitOutPeriodMonths ? true : false,
        fitOutPeriodMonths: metadata.fitOutPeriodMonths,
        depositMonths: metadata.depositMonths || 1,
        advanceRentMonths: metadata.advanceRentMonths || 1,
        advanceRent: (offerLetter.rentAmount + (offerLetter.serviceCharge || 0)) * (metadata.advanceRentMonths || 1),
        serviceChargeEscalationRate: metadata.serviceChargeEscalationRate || 5,
        vatRate: 16,
        interestRate: 15,
        offerValidityDays: 7,
        operatingHoursStart: '7:00 am',
        operatingHoursEnd: '9:00 pm',
        guarantorsRequired: true,
        promotionalExpenses: false,
        includeTerraceArea: false,
        separateWaterElectricity: true
      };
      
      htmlContent = generateCommercialOfferLetter(commercialData);
    } else {
      // RESIDENTIAL - FIXED with proper date handling
      const residentialData = {
        ...baseTemplateData,
        houseNumber: offerLetter.unit?.unitNo || offerLetter.unit?.type, // FIXED
        bedrooms: offerLetter.unit?.bedrooms,  // FIXED
        bathrooms: offerLetter.unit?.bathrooms, // FIXED
        floorNumber: offerLetter.unit?.floor,   // FIXED
        escalationFrequency: metadata.escalationFrequency || 'ANNUALLY'
      };
      
      htmlContent = generateResidentialOfferLetter(residentialData);
    }

    // Generate PDF
    const pdfBuffer = await generatePDF(htmlContent);

    // Set response headers
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${offerLetter.offerNumber}.pdf"`
    );

    res.send(pdfBuffer);
  } catch (error) {
    console.error('Download PDF error:', error);
    res.status(500).json({ message: error.message });
  }
};

// @desc    Update offer letter
// @route   PUT /api/offer-letters/:id
// @access  Private (Admin/Manager)
export const updateOfferLetter = async (req, res) => {
  try {
    const {
      rentAmount,
      deposit,
      leaseTerm,
      serviceCharge,
      escalationRate,
      expiryDate,
      status,
      additionalTerms,
      notes,
      metadata
    } = req.body;

    const offerLetter = await prisma.offerLetter.update({
      where: { id: req.params.id },
      data: {
        ...(rentAmount !== undefined && { rentAmount }),
        ...(deposit !== undefined && { deposit }),
        ...(leaseTerm && { leaseTerm }),
        ...(serviceCharge !== undefined && { serviceCharge }),
        ...(escalationRate !== undefined && { escalationRate }),
        ...(expiryDate && { expiryDate: new Date(expiryDate) }),
        ...(status && { status }),
        ...(additionalTerms !== undefined && { additionalTerms }),
        ...(notes !== undefined && { notes }),
        ...(metadata && { metadata })
      },
      include: {
        lead: true,
        property: {
          include: {
            landlord: true
          }
        },
        unit: true
      }
    });

    res.json(offerLetter);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

// @desc    Update offer letter status
// @route   PATCH /api/offer-letters/:id/status
// @access  Private (Admin/Manager)
export const updateOfferLetterStatus = async (req, res) => {
  try {
    const { status } = req.body;

    if (!status) {
      return res.status(400).json({ message: 'Status is required' });
    }

    const validStatuses = ['DRAFT', 'SENT', 'ACCEPTED', 'REJECTED', 'EXPIRED', 'CANCELLED', 'CONVERTED'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ 
        message: `Invalid status. Must be one of: ${validStatuses.join(', ')}` 
      });
    }

    const offerLetter = await prisma.offerLetter.update({
      where: { id: req.params.id },
      data: { status },
      include: {
        lead: true,
        property: true,
        unit: true
      }
    });

    res.json(offerLetter);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

// @desc    Delete offer letter
// @route   DELETE /api/offer-letters/:id
// @access  Private (Admin/Manager)
export const deleteOfferLetter = async (req, res) => {
  try {
    await prisma.offerLetter.delete({
      where: { id: req.params.id }
    });

    res.json({ message: 'Offer letter deleted successfully' });
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};