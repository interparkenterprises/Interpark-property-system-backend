import prisma from "../lib/prisma.js";
import { generatePDF } from '../utils/pdfGenerator.js';
import { uploadToStorage, generateFileName } from '../utils/storage.js';
import { generateActivationPDF as generateActivationPDFTemplate } from '../utils/activationTemplate.js';

//const prisma = new PrismaClient();

/**
 * Sanitize activation data - remove fields not in Prisma schema
 */
const sanitizeActivationData = (data) => {
  const {
    // Remove any fields that shouldn't be in the create/update
    id,
    requestNumber,
    createdAt,
    updatedAt,
    property,
    manager,
    documentUrl, // Don't allow manual setting
    submittedAt,
    approvedAt,
    status,
    // Additional fields to remove if present in request but not in schema
    ...sanitizedData
  } = data;

  // Convert date strings to Date objects if they exist
  const dateFields = [
    'startDate',
    'endDate',
    'signatureDate',
    'submittedAt',
    'approvedAt'
  ];
  
  dateFields.forEach(field => {
    if (sanitizedData[field]) {
      sanitizedData[field] = new Date(sanitizedData[field]);
    }
  });

  // Convert time fields (keep as strings)
  const timeFields = ['setupTime', 'tearDownTime'];
  timeFields.forEach(field => {
    if (sanitizedData[field] && typeof sanitizedData[field] !== 'string') {
      sanitizedData[field] = String(sanitizedData[field]);
    }
  });

  // Convert numeric strings to numbers
  const numericFields = [
    'expectedVisitors',
    'licenseFeePerDay',
    'proposedBudget'
  ];
  
  numericFields.forEach(field => {
    if (sanitizedData[field] !== undefined && sanitizedData[field] !== null) {
      sanitizedData[field] = parseFloat(sanitizedData[field]);
    }
  });

  // Convert integer fields
  const integerFields = ['expectedVisitors', 'numberOfDays'];
  integerFields.forEach(field => {
    if (sanitizedData[field] !== undefined && sanitizedData[field] !== null) {
      sanitizedData[field] = parseInt(sanitizedData[field]);
    }
  });

  // Convert boolean fields - ONLY soundSystem is in your model
  const booleanFields = ['soundSystem'];
  
  booleanFields.forEach(field => {
    if (sanitizedData[field] !== undefined) {
      // Handle string values like "true", "false"
      if (typeof sanitizedData[field] === 'string') {
        sanitizedData[field] = sanitizedData[field].toLowerCase() === 'true';
      } else if (typeof sanitizedData[field] === 'number') {
        sanitizedData[field] = sanitizedData[field] !== 0;
      }
      // If it's already boolean, keep as is
    }
  });

  // Remove undefined values to let Prisma use defaults
  Object.keys(sanitizedData).forEach(key => {
    if (sanitizedData[key] === undefined || sanitizedData[key] === '') {
      delete sanitizedData[key];
    }
  });

  return sanitizedData;
};

/**
 * Create new activation request
 * POST /api/activations
 */
export const createActivationRequest = async (req, res) => {
  try {
    const managerId = req.user.id;
    const activationData = req.body;

    // Validate property access
    const property = await prisma.property.findFirst({
      where: {
        id: activationData.propertyId,
        managerId: managerId
      },
      include: {
        landlord: true
      }
    });

    if (!property) {
      return res.status(403).json({ 
        success: false,
        message: 'You do not have access to this property' 
      });
    }

    // Generate unique request number
    const requestNumber = await generateRequestNumber();

    // Sanitize data
    const sanitizedData = sanitizeActivationData(activationData);

    // Create activation request with all fields from your model
    const activation = await prisma.activationRequest.create({
      data: {
        ...sanitizedData,
        requestNumber,
        managerId,
        status: 'DRAFT',
        // Set default values for required fields
        companyName: sanitizedData.companyName || '',
        postalAddress: sanitizedData.postalAddress || '',
        telephone: sanitizedData.telephone || '',
        contactPerson: sanitizedData.contactPerson || '',
        designation: sanitizedData.designation || '',
        email: sanitizedData.email || '',
        mobileNo: sanitizedData.mobileNo || '',
        startDate: sanitizedData.startDate,
        setupTime: sanitizedData.setupTime || '',
        endDate: sanitizedData.endDate,
        tearDownTime: sanitizedData.tearDownTime || '',
        activationType: sanitizedData.activationType || '',
        soundSystem: sanitizedData.soundSystem || false,
        // Set optional fields
        description: sanitizedData.description || null,
        expectedVisitors: sanitizedData.expectedVisitors || null,
        licenseFeePerDay: sanitizedData.licenseFeePerDay || null,
        numberOfDays: sanitizedData.numberOfDays || null,
        proposedBudget: sanitizedData.proposedBudget || null,
        // Payment details
        bankName: sanitizedData.bankName || null,
        bankBranch: sanitizedData.bankBranch || null,
        accountName: sanitizedData.accountName || null,
        accountNumber: sanitizedData.accountNumber || null,
        swiftCode: sanitizedData.swiftCode || null,
        paybillNumber: sanitizedData.paybillNumber || null,
        mpesaAccount: sanitizedData.mpesaAccount || null,
        // Manager signature info
        managerName: sanitizedData.managerName || null,
        managerDesignation: sanitizedData.managerDesignation || null
      },
      include: {
        property: {
          include: {
            landlord: true
          }
        },
        manager: {
          select: {
            id: true,
            name: true,
            email: true
          }
        }
      }
    });

    res.status(201).json({
      success: true,
      message: 'Activation request created successfully',
      data: activation
    });

  } catch (error) {
    console.error('Error creating activation request:', error);
    res.status(500).json({ 
      success: false,
      message: 'Failed to create activation request',
      error: error.message 
    });
  }
};

/**
 * Get all activation requests for manager
 * GET /api/activations
 */
export const getActivationRequests = async (req, res) => {
  try {
    const managerId = req.user.id;
    const { 
      propertyId, 
      status, 
      startDate, 
      endDate, 
      activationType,
      companyName,
      page = 1, 
      limit = 10 
    } = req.query;

    const where = { managerId };

    if (propertyId) where.propertyId = propertyId;
    if (status) where.status = status;
    if (activationType) where.activationType = activationType;
    if (companyName) where.companyName = { contains: companyName, mode: 'insensitive' };
    
    if (startDate || endDate) {
      where.startDate = {};
      if (startDate) where.startDate.gte = new Date(startDate);
      if (endDate) where.startDate.lte = new Date(endDate);
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const take = parseInt(limit);

    const [activations, totalCount] = await Promise.all([
      prisma.activationRequest.findMany({
        where,
        include: {
          property: {
            select: {
              id: true,
              name: true,
              address: true
            }
          },
          manager: {
            select: {
              id: true,
              name: true,
              email: true
            }
          }
        },
        orderBy: {
          createdAt: 'desc'
        },
        skip,
        take
      }),
      prisma.activationRequest.count({ where })
    ]);

    res.json({
      success: true,
      count: activations.length,
      totalCount,
      data: activations,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        totalPages: Math.ceil(totalCount / parseInt(limit))
      }
    });

  } catch (error) {
    console.error('Error fetching activation requests:', error);
    res.status(500).json({ 
      success: false,
      message: 'Failed to fetch activation requests',
      error: error.message 
    });
  }
};

/**
 * Get single activation request
 * GET /api/activations/:id
 */
export const getActivationRequest = async (req, res) => {
  try {
    const { id } = req.params;
    const managerId = req.user.id;

    const activation = await prisma.activationRequest.findFirst({
      where: {
        id,
        managerId
      },
      include: {
        property: {
          include: {
            landlord: true
          }
        },
        manager: {
          select: {
            id: true,
            name: true,
            email: true
          }
        }
      }
    });

    if (!activation) {
      return res.status(404).json({ 
        success: false,
        message: 'Activation request not found' 
      });
    }

    res.json({
      success: true,
      data: activation
    });

  } catch (error) {
    console.error('Error fetching activation request:', error);
    res.status(500).json({ 
      success: false,
      message: 'Failed to fetch activation request',
      error: error.message 
    });
  }
};

/**
 * Update activation request
 * PUT /api/activations/:id
 */
export const updateActivationRequest = async (req, res) => {
  try {
    const { id } = req.params;
    const managerId = req.user.id;
    const updateData = req.body;

    // Check if activation exists and belongs to manager
    const existing = await prisma.activationRequest.findFirst({
      where: { id, managerId }
    });

    if (!existing) {
      return res.status(404).json({ 
        success: false,
        message: 'Activation request not found' 
      });
    }

    // Don't allow updates to approved/completed requests
    if (['APPROVED', 'COMPLETED'].includes(existing.status)) {
      return res.status(400).json({ 
        success: false,
        message: 'Cannot update approved or completed requests' 
      });
    }

    // If request is SUBMITTED or UNDER_REVIEW, only allow specific updates
    if (['SUBMITTED', 'UNDER_REVIEW'].includes(existing.status)) {
      const allowedFields = [
        'description',
        'expectedVisitors',
        'soundSystem',
        'licenseFeePerDay',
        'numberOfDays',
        'proposedBudget'
      ];
      
      // Filter out fields that shouldn't be updated
      Object.keys(updateData).forEach(key => {
        if (!allowedFields.includes(key)) {
          delete updateData[key];
        }
      });
    }

    // Sanitize data
    const sanitizedData = sanitizeActivationData(updateData);

    const activation = await prisma.activationRequest.update({
      where: { id },
      data: sanitizedData,
      include: {
        property: {
          include: {
            landlord: true
          }
        },
        manager: {
          select: {
            id: true,
            name: true,
            email: true
          }
        }
      }
    });

    res.json({
      success: true,
      message: 'Activation request updated successfully',
      data: activation
    });

  } catch (error) {
    console.error('Error updating activation request:', error);
    res.status(500).json({ 
      success: false,
      message: 'Failed to update activation request',
      error: error.message 
    });
  }
};

/**
 * Generate PDF for activation request
 * POST /api/activations/:id/generate-pdf
 */
export const generateActivationPDFController = async (req, res) => {
  try {
    const { id } = req.params;
    const managerId = req.user.id;

    const activation = await prisma.activationRequest.findFirst({
      where: { id, managerId },
      include: {
        property: {
          include: {
            landlord: true
          }
        },
        manager: {
          select: {
            id: true,
            name: true,
            email: true
          }
        }
      }
    });

    if (!activation) {
      return res.status(404).json({ 
        success: false,
        message: 'Activation request not found' 
      });
    }

    // Generate PDF using new template with all fields
    const pdfBuffer = await generateActivationPDFTemplate(activation);

    // Upload to storage
    const fileName = generateFileName(`activation_${activation.requestNumber}`);
    const documentUrl = await uploadToStorage(pdfBuffer, fileName, 'activations');

    // Update activation with document URL
    const updatedActivation = await prisma.activationRequest.update({
      where: { id },
      data: { 
        documentUrl
      },
      include: {
        property: true,
        manager: true
      }
    });

    // Optional: Also return PDF directly for download
    if (req.query.download === 'true') {
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${fileName}.pdf"`);
      return res.send(pdfBuffer);
    }

    res.json({
      success: true,
      message: 'PDF generated successfully',
      documentUrl,
      activation: updatedActivation,
      pdfBuffer: req.query.includeBuffer === 'true' ? pdfBuffer.toString('base64') : undefined
    });

  } catch (error) {
    console.error('Error generating PDF:', error);
    res.status(500).json({ 
      success: false,
      message: 'Failed to generate PDF',
      error: error.message 
    });
  }
};

/**
 * Submit activation request for review
 * POST /api/activations/:id/submit
 */
export const submitActivationRequest = async (req, res) => {
  try {
    const { id } = req.params;
    const managerId = req.user.id;

    const activation = await prisma.activationRequest.findFirst({
      where: { id, managerId },
      include: {
        property: {
          include: {
            landlord: true
          }
        },
        manager: {
          select: {
            id: true,
            name: true,
            email: true
          }
        }
      }
    });

    if (!activation) {
      return res.status(404).json({ 
        success: false,
        message: 'Activation request not found' 
      });
    }

    if (activation.status !== 'DRAFT') {
      return res.status(400).json({ 
        success: false,
        message: 'Only draft requests can be submitted' 
      });
    }

    // Validate required fields based on your model
    const requiredFields = [
      'companyName',
      'postalAddress',
      'telephone',
      'contactPerson',
      'designation',
      'email',
      'mobileNo',
      'startDate',
      'setupTime',
      'endDate',
      'tearDownTime',
      'activationType'
    ];

    const missingFields = requiredFields.filter(field => {
      const value = activation[field];
      return value === undefined || value === null || value === '';
    });

    if (missingFields.length > 0) {
      return res.status(400).json({ 
        success: false,
        message: 'Missing required fields',
        missingFields 
      });
    }

    // Validate manager signature fields
    if (!activation.managerName || !activation.managerDesignation) {
      return res.status(400).json({ 
        success: false,
        message: 'Manager name and designation are required for submission'
      });
    }

    // Generate PDF if not already generated
    let documentUrl = activation.documentUrl;
    let pdfBuffer = null;

    if (!documentUrl) {
      // Generate PDF with all fields
      pdfBuffer = await generateActivationPDFTemplate(activation);
      const fileName = generateFileName(`activation_${activation.requestNumber}`);
      documentUrl = await uploadToStorage(pdfBuffer, fileName, 'activations');
    }

    const updatedActivation = await prisma.activationRequest.update({
      where: { id },
      data: {
        status: 'SUBMITTED',
        submittedAt: new Date(),
        documentUrl,
        signatureDate: new Date() // Set signature date on submission
      },
      include: {
        property: true,
        manager: true
      }
    });

    // Send email notification with PDF attachment (optional)
    if (req.query.notify === 'true') {
      await sendActivationSubmissionEmail(updatedActivation, pdfBuffer);
    }

    res.json({
      success: true,
      message: 'Activation request submitted successfully',
      data: updatedActivation,
      documentUrl
    });

  } catch (error) {
    console.error('Error submitting activation request:', error);
    res.status(500).json({ 
      success: false,
      message: 'Failed to submit activation request',
      error: error.message 
    });
  }
};

/**
 * Delete activation request
 * DELETE /api/activations/:id
 */
export const deleteActivationRequest = async (req, res) => {
  try {
    const { id } = req.params;
    const managerId = req.user.id;

    const activation = await prisma.activationRequest.findFirst({
      where: { id, managerId }
    });

    if (!activation) {
      return res.status(404).json({ 
        success: false,
        message: 'Activation request not found' 
      });
    }

    // Only allow deletion of draft or rejected requests
    if (!['DRAFT', 'REJECTED'].includes(activation.status)) {
      return res.status(400).json({ 
        success: false,
        message: 'Only draft or rejected requests can be deleted' 
      });
    }

    await prisma.activationRequest.delete({
      where: { id }
    });

    res.json({
      success: true,
      message: 'Activation request deleted successfully'
    });

  } catch (error) {
    console.error('Error deleting activation request:', error);
    res.status(500).json({ 
      success: false,
      message: 'Failed to delete activation request',
      error: error.message 
    });
  }
};

/**
 * Download activation PDF
 * GET /api/activations/:id/download
 */
export const downloadActivationPDF = async (req, res) => {
  try {
    const { id } = req.params;
    const managerId = req.user.id;

    const activation = await prisma.activationRequest.findFirst({
      where: { id, managerId },
      include: {
        property: {
          include: {
            landlord: true
          }
        },
        manager: {
          select: {
            id: true,
            name: true,
            email: true
          }
        }
      }
    });

    if (!activation) {
      return res.status(404).json({ 
        success: false,
        message: 'Activation request not found' 
      });
    }

    // Check if documentUrl exists and is accessible
    let pdfBuffer;
    
    if (activation.documentUrl && activation.documentUrl.startsWith('http')) {
      // If we have a stored URL, try to fetch it
      try {
        const response = await fetch(activation.documentUrl);
        if (response.ok) {
          const arrayBuffer = await response.arrayBuffer();
          pdfBuffer = Buffer.from(arrayBuffer);
        } else {
          // If URL fetch fails, generate fresh PDF
          throw new Error('Stored PDF not accessible');
        }
      } catch (error) {
        console.log('Could not fetch stored PDF, generating fresh one:', error.message);
        // Fall through to generate fresh PDF
      }
    }

    // If no PDF buffer yet (either no documentUrl or fetch failed), generate fresh
    if (!pdfBuffer) {
      // Use the new PDF generation function that includes all fields
      pdfBuffer = await generateActivationPDFTemplate(activation);
      
      // Optionally update the documentUrl in database
      if (req.query.updateUrl === 'true') {
        const fileName = generateFileName(`activation_${activation.requestNumber}`);
        const documentUrl = await uploadToStorage(pdfBuffer, fileName, 'activations');
        await prisma.activationRequest.update({
          where: { id },
          data: { documentUrl }
        });
      }
    }

    // Set appropriate headers
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="activation_${activation.requestNumber}.pdf"`);
    res.setHeader('Content-Length', pdfBuffer.length);
    
    // Send the PDF
    res.send(pdfBuffer);

  } catch (error) {
    console.error('Error downloading activation PDF:', error);
    
    // Don't send JSON when expecting PDF - generate an error PDF or return proper error
    try {
      // Create a simple error message as PDF
      const errorHtml = `
        <html>
          <body>
            <h1>Error Generating PDF</h1>
            <p>${error.message}</p>
          </body>
        </html>
      `;
      const pdfBuffer = await generatePDF(errorHtml);
      
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', 'attachment; filename="error.pdf"');
      res.send(pdfBuffer);
    } catch (pdfError) {
      // If even error PDF fails, send JSON
      res.status(500).json({ 
        success: false,
        message: 'Failed to download activation PDF',
        error: error.message 
      });
    }
  }
};

/**
 * Get activation request statistics
 * GET /api/activations/stats
 */
export const getActivationStats = async (req, res) => {
  try {
    const managerId = req.user.id;

    const stats = await prisma.activationRequest.groupBy({
      by: ['status'],
      where: { managerId },
      _count: {
        status: true
      }
    });

    const totalCount = await prisma.activationRequest.count({
      where: { managerId }
    });

    const upcomingActivations = await prisma.activationRequest.count({
      where: {
        managerId,
        status: 'APPROVED',
        startDate: {
          gte: new Date()
        }
      }
    });

    res.json({
      success: true,
      data: {
        total: totalCount,
        byStatus: stats.reduce((acc, curr) => {
          acc[curr.status] = curr._count.status;
          return acc;
        }, {}),
        upcoming: upcomingActivations
      }
    });

  } catch (error) {
    console.error('Error fetching activation stats:', error);
    res.status(500).json({ 
      success: false,
      message: 'Failed to fetch activation statistics',
      error: error.message 
    });
  }
};

/**
 * Helper function to generate unique request number
 */
async function generateRequestNumber(maxRetries = 3) {
  const prefix = 'ACT';
  const year = new Date().getFullYear();
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      // Use a transaction to ensure atomicity
      const result = await prisma.$transaction(async (tx) => {
        // Get the latest sequence number for this year
        const latestRequest = await tx.activationRequest.findFirst({
          where: {
            requestNumber: {
              startsWith: `${prefix}-${year}`
            }
          },
          orderBy: {
            requestNumber: 'desc'
          },
          select: {
            requestNumber: true
          }
        });

        let sequence = 1;
        
        if (latestRequest) {
          // Extract the sequence number from the latest request number
          const parts = latestRequest.requestNumber.split('-');
          if (parts.length === 3) {
            const lastSequence = parseInt(parts[2]);
            if (!isNaN(lastSequence)) {
              sequence = lastSequence + 1;
            }
          }
        }

        const sequenceStr = String(sequence).padStart(4, '0');
        return `${prefix}-${year}-${sequenceStr}`;
      });

      return result;
    } catch (error) {
      if (attempt === maxRetries) {
        throw error;
      }
      // Wait a bit before retrying
      await new Promise(resolve => setTimeout(resolve, 100 * attempt));
    }
  }
}

// Helper function for email notification (placeholder)
async function sendActivationSubmissionEmail(activation, pdfBuffer) {
  // Implement your email sending logic here
  console.log(`Email notification would be sent for activation ${activation.requestNumber}`);
  // You can use nodemailer or your preferred email service
}