import prisma from "../lib/prisma.js";
import { generateBillInvoiceNumber } from '../utils/invoiceHelpers.js';
import { uploadToStorage } from '../utils/storage.js';
import permissionService from "../services/permissionService.js";
import { generateBillInvoicePDF } from "./billinvoice.controller.js";

// ======================================================
// PERMISSION HELPER FUNCTIONS
// ======================================================

// Helper function to check if user has access to a property with specific permission
const checkPropertyAccess = async (userId, userRole, propertyId, requiredPermission = 'canView') => {
  if (userRole === 'ADMIN') {
    return true;
  }
  
  if (userRole === 'MANAGER') {
    const property = await prisma.property.findFirst({
      where: { id: propertyId, managerId: userId }
    });
    return !!property;
  }
  
  if (userRole === 'USER') {
    return await permissionService.checkPropertyAccess(userId, propertyId, requiredPermission);
  }
  
  return false;
};

// Helper function to check bill permission for a property
const checkBillPermission = async (userId, userRole, propertyId, operation) => {
  if (userRole === 'ADMIN') {
    return true;
  }
  
  if (userRole === 'MANAGER') {
    const property = await prisma.property.findFirst({
      where: { id: propertyId, managerId: userId }
    });
    return !!property;
  }
  
  if (userRole === 'USER') {
    // Map operation to permission code
    const permissionMap = {
      view: 'VIEW_BILLS',
      create: 'CREATE_BILLS',
      edit: 'EDIT_BILLS',
      delete: 'DELETE_BILLS',
      pay: 'PAY_BILLS',
      recordMeterReading: 'RECORD_METER_READINGS'
    };
    
    const permissionCode = permissionMap[operation];
    if (!permissionCode) return false;
    
    return await permissionService.hasPermission(userId, permissionCode, propertyId);
  }
  
  return false;
};

// Helper function to check if user has access to a specific bill
const checkBillAccess = async (userId, userRole, billId, operation = 'view') => {
  if (userRole === 'ADMIN') {
    return true;
  }
  
  // Get property ID from bill
  const bill = await prisma.bill.findUnique({
    where: { id: billId },
    include: {
      tenant: {
        include: {
          unit: {
            include: {
              property: true
            }
          }
        }
      }
    }
  });
  
  if (!bill) return false;
  
  const propertyId = bill.tenant?.unit?.propertyId;
  if (!propertyId) return false;
  
  if (userRole === 'MANAGER') {
    const property = await prisma.property.findFirst({
      where: { id: propertyId, managerId: userId }
    });
    return !!property;
  }
  
  if (userRole === 'USER') {
    return await checkBillPermission(userId, userRole, propertyId, operation);
  }
  
  return false;
};

// Helper function to get accessible property IDs for filtering
const getAccessiblePropertyIds = async (userId, userRole, operation = 'view') => {
  if (userRole === 'ADMIN') {
    const allProperties = await prisma.property.findMany({ select: { id: true } });
    return allProperties.map(p => p.id);
  }
  
  if (userRole === 'MANAGER') {
    const properties = await prisma.property.findMany({
      where: { managerId: userId },
      select: { id: true }
    });
    return properties.map(p => p.id);
  }
  
  if (userRole === 'USER') {
    const accessiblePropertyIds = await permissionService.getAccessiblePropertyIds(userId, userRole);
    
    // Filter properties where user has VIEW_BILLS permission
    const propertiesWithPermission = [];
    for (const propertyId of accessiblePropertyIds) {
      const hasPermission = await checkBillPermission(userId, userRole, propertyId, operation);
      if (hasPermission) {
        propertiesWithPermission.push(propertyId);
      }
    }
    return propertiesWithPermission;
  }
  
  return [];
};

// ======================================================
// BILL CONTROLLER FUNCTIONS
// ======================================================

// Create a new bill
export const createBill = async (req, res) => {
  try {
    const userId = req.user.id;
    const userRole = req.user.role;
    const {
      tenantId,
      type,
      description,
      previousReading,
      currentReading,
      chargePerUnit,
      vatRate,
      dueDate,
      notes,
    } = req.body;

    // Validate required fields
    if (!tenantId || !type || currentReading === undefined || chargePerUnit === undefined) {
      return res.status(400).json({ 
        error: 'tenantId, type, currentReading, and chargePerUnit are required.' 
      });
    }

    // Validate tenant exists and get property ID
    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      include: {
        unit: {
          include: {
            property: true
          }
        }
      }
    });
    
    if (!tenant) {
      return res.status(404).json({ error: 'Tenant not found.' });
    }

    const propertyId = tenant.unit?.propertyId;
    
    // Check CREATE_BILL permission
    const hasCreatePermission = await checkBillPermission(userId, userRole, propertyId, 'create');
    
    if (!hasCreatePermission) {
      return res.status(403).json({ 
        error: 'Access denied',
        message: 'You do not have permission to create bills for this property.',
        requiredPermission: 'CREATE_BILLS'
      });
    }

    // Get previous reading from last bill if not provided
    let previousReadingToUse = previousReading;
    
    if (previousReading === undefined) {
      const lastBill = await prisma.bill.findFirst({
        where: {
          tenantId,
          type,
        },
        orderBy: {
          issuedAt: 'desc',
        },
        select: {
          currentReading: true,
          id: true,
          issuedAt: true,
        },
      });

      if (lastBill) {
        previousReadingToUse = lastBill.currentReading;
        console.log(`Auto-filled previous reading from last ${type} bill: ${previousReadingToUse}`);
      } else {
        return res.status(400).json({
          error: `No previous ${type} bill found for this tenant. Please provide a previous reading.`,
          suggestion: 'This appears to be the first bill for this utility type.'
        });
      }
    }

    // Validate readings
    if (currentReading <= previousReadingToUse) {
      return res.status(400).json({
        error: 'Current reading must be greater than previous reading.',
        details: {
          previousReading: previousReadingToUse,
          currentReading,
          difference: currentReading - previousReadingToUse
        }
      });
    }

    // Compute derived values
    const units = currentReading - previousReadingToUse;
    const totalAmount = units * chargePerUnit;
    const vatAmount = vatRate ? totalAmount * (vatRate / 100) : 0;
    const grandTotal = totalAmount + vatAmount;

    const bill = await prisma.bill.create({
      data: {
        tenantId,
        type,
        description,
        previousReading: previousReadingToUse,
        currentReading,
        units,
        chargePerUnit,
        totalAmount,
        vatRate,
        vatAmount,
        grandTotal,
        dueDate: dueDate ? new Date(dueDate) : null,
        notes: notes || (previousReading === undefined ? 
          `Previous reading auto-filled from last bill` : 
          null),
      },
      include: {
        tenant: {
          select: {
            fullName: true,
            contact: true,
            unit: {
              select: {
                property: {
                  select: { name: true, address: true, id: true }
                }
              }
            }
          }
        }
      }
    });

    res.status(201).json({
      success: true,
      data: bill,
      message: `Bill created successfully. ${previousReading === undefined ? 'Previous reading was auto-filled.' : ''}`,
      autoFilled: previousReading === undefined,
      usage: {
        units,
        period: 'Since last bill',
        consumptionRate: units / (new Date().getDate())
      }
    });
  } catch (error) {
    console.error('Error creating bill:', error);
    
    if (error.code === 'P2003') {
      return res.status(400).json({ 
        error: 'Invalid tenant ID.',
        details: 'The specified tenant does not exist.'
      });
    }
    
    if (error.code === 'P2002') {
      return res.status(400).json({ 
        error: 'Duplicate bill detected.',
        details: 'A bill with similar details may already exist.'
      });
    }
    
    res.status(500).json({ 
      error: 'Internal Server Error',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Get last bill info
export const getLastBillInfo = async (req, res) => {
  try {
    const userId = req.user.id;
    const userRole = req.user.role;
    const { tenantId, type } = req.query;

    if (!tenantId || !type) {
      return res.status(400).json({ 
        error: 'tenantId and type are required.' 
      });
    }

    // Get tenant to check property access
    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      include: {
        unit: {
          include: {
            property: true
          }
        }
      }
    });
    
    if (!tenant) {
      return res.status(404).json({ error: 'Tenant not found.' });
    }
    
    const propertyId = tenant.unit?.propertyId;
    
    // Check VIEW_BILLS permission
    const hasViewPermission = await checkBillPermission(userId, userRole, propertyId, 'view');
    
    if (!hasViewPermission) {
      return res.status(403).json({ 
        error: 'Access denied',
        message: 'You do not have permission to view bills for this tenant.',
        requiredPermission: 'VIEW_BILLS'
      });
    }

    const lastBill = await prisma.bill.findFirst({
      where: {
        tenantId,
        type,
      },
      orderBy: {
        issuedAt: 'desc',
      },
      select: {
        id: true,
        currentReading: true,
        issuedAt: true,
        units: true,
        totalAmount: true,
        dueDate: true,
        status: true,
      },
    });

    if (!lastBill) {
      return res.status(404).json({
        success: false,
        message: `No previous ${type} bill found for this tenant.`,
        suggestion: 'This appears to be the first bill for this utility type.'
      });
    }

    res.status(200).json({
      success: true,
      data: {
        lastBill,
        suggestedPreviousReading: lastBill.currentReading,
        daysSinceLastBill: Math.floor((new Date() - new Date(lastBill.issuedAt)) / (1000 * 60 * 60 * 24)),
      },
      message: `Last ${type} bill retrieved successfully.`
    });

  } catch (error) {
    console.error('Error fetching last bill info:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
};

// Get all bills
export const getAllBills = async (req, res) => {
  try {
    const userId = req.user.id;
    const userRole = req.user.role;
    const { page = 1, limit = 10, type, status, tenantId } = req.query;
    const skip = (parseInt(page, 10) - 1) * parseInt(limit, 10);

    let whereClause = {};
    if (type) whereClause.type = type;
    if (status) whereClause.status = status;
    if (tenantId) whereClause.tenantId = tenantId;

    // Apply role-based filtering
    if (userRole === 'ADMIN') {
      // Admin sees all bills
      // No additional where clause needed
    } else if (userRole === 'MANAGER') {
      // Manager sees bills for their properties
      whereClause = {
        ...whereClause,
        tenant: {
          unit: {
            property: {
              managerId: userId
            }
          }
        }
      };
    } else if (userRole === 'USER') {
      // USER sees bills for accessible properties with VIEW_BILLS permission
      const accessiblePropertyIds = await getAccessiblePropertyIds(userId, userRole, 'view');
      
      if (accessiblePropertyIds.length === 0) {
        return res.status(200).json({
          bills: [],
          pagination: {
            page: parseInt(page, 10),
            limit: parseInt(limit, 10),
            total: 0,
            totalPages: 0
          }
        });
      }
      
      whereClause = {
        ...whereClause,
        tenant: {
          unit: {
            propertyId: { in: accessiblePropertyIds }
          }
        }
      };
    } else {
      return res.status(403).json({ error: 'Access denied' });
    }

    const bills = await prisma.bill.findMany({
      where: whereClause,
      skip,
      take: parseInt(limit, 10),
      orderBy: { issuedAt: 'desc' },
      include: {
        tenant: {
          select: {
            fullName: true,
            contact: true,
            KRAPin: true,
            unit: {
              select: {
                unitNo: true,
                property: {
                  select: { 
                    id: true,
                    name: true,
                    address: true
                  }
                }
              }
            }
          }
        }
      }
    });

    const total = await prisma.bill.count({ where: whereClause });

    res.status(200).json({
      bills,
      pagination: {
        page: parseInt(page, 10),
        limit: parseInt(limit, 10),
        total,
        totalPages: Math.ceil(total / parseInt(limit, 10)),
      },
    });
  } catch (error) {
    console.error('Error fetching bills:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
};

// Get a specific bill by ID
export const getBillById = async (req, res) => {
  try {
    const userId = req.user.id;
    const userRole = req.user.role;
    const { id } = req.params;

    // Check VIEW_BILLS permission for this bill
    const hasViewPermission = await checkBillAccess(userId, userRole, id, 'view');
    
    if (!hasViewPermission) {
      return res.status(403).json({ 
        error: 'Access denied',
        message: 'You do not have permission to view this bill.',
        requiredPermission: 'VIEW_BILLS'
      });
    }

    const bill = await prisma.bill.findUnique({
      where: { id },
      include: {
        tenant: {
          select: {
            fullName: true,
            contact: true,
            KRAPin: true,
            unit: {
              select: {
                unitNo: true,
                property: {
                  select: { 
                    id: true,
                    name: true, 
                    address: true 
                  }
                }
              }
            }
          }
        },
        billInvoices: {
          orderBy: { createdAt: 'desc' }
        }
      }
    });

    if (!bill) {
      return res.status(404).json({ error: 'Bill not found.' });
    }

    res.status(200).json(bill);
  } catch (error) {
    console.error('Error fetching bill:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
};

// Update a bill by ID
export const updateBill = async (req, res) => {
  try {
    const userId = req.user.id;
    const userRole = req.user.role;
    const { id } = req.params;
    const updates = req.body;

    // Check EDIT_BILL permission
    const hasEditPermission = await checkBillAccess(userId, userRole, id, 'edit');
    
    if (!hasEditPermission) {
      return res.status(403).json({ 
        error: 'Access denied',
        message: 'You do not have permission to update this bill.',
        requiredPermission: 'EDIT_BILLS'
      });
    }

    // Find the existing bill
    const existingBill = await prisma.bill.findUnique({
      where: { id },
    });

    if (!existingBill) {
      return res.status(404).json({ error: 'Bill not found.' });
    }

    // Recalculate derived values if relevant fields are updated
    let finalUpdates = { ...updates };
    if (updates.currentReading !== undefined || updates.previousReading !== undefined || updates.chargePerUnit !== undefined) {
      const prevRead = updates.previousReading ?? existingBill.previousReading;
      const currRead = updates.currentReading ?? existingBill.currentReading;
      const chargePerUnit = updates.chargePerUnit ?? existingBill.chargePerUnit;
      const vatRate = updates.vatRate ?? existingBill.vatRate;

      const units = currRead - prevRead;
      const totalAmount = units * chargePerUnit;
      const vatAmount = vatRate ? totalAmount * (vatRate / 100) : 0;
      const grandTotal = totalAmount + vatAmount;

      finalUpdates = {
        ...finalUpdates,
        units,
        totalAmount,
        vatAmount,
        grandTotal,
      };
    }

    const updatedBill = await prisma.bill.update({
      where: { id },
      data: finalUpdates,
      include: {
        tenant: {
          select: {
            fullName: true,
            contact: true,
            unit: {
              select: {
                property: {
                  select: { name: true }
                }
              }
            }
          }
        }
      }
    });

    res.status(200).json(updatedBill);
  } catch (error) {
    console.error('Error updating bill:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
};

// Delete a bill by ID
export const deleteBill = async (req, res) => {
  try {
    const userId = req.user.id;
    const userRole = req.user.role;
    const { id } = req.params;

    // Check DELETE_BILL permission
    const hasDeletePermission = await checkBillAccess(userId, userRole, id, 'delete');
    
    if (!hasDeletePermission) {
      return res.status(403).json({ 
        error: 'Access denied',
        message: 'You do not have permission to delete this bill.',
        requiredPermission: 'DELETE_BILLS'
      });
    }

    const bill = await prisma.bill.findUnique({
      where: { id },
    });

    if (!bill) {
      return res.status(404).json({ error: 'Bill not found.' });
    }

    await prisma.bill.delete({
      where: { id },
    });

    res.status(200).json({ message: 'Bill deleted successfully.' });
  } catch (error) {
    console.error('Error deleting bill:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
};

// Pay bill
export const payBill = async (req, res) => {
  try {
    const userId = req.user.id;
    const userRole = req.user.role;
    const { id } = req.params;
    const { amount } = req.body;

    if (!amount || amount <= 0) {
      return res.status(400).json({ error: "Invalid payment amount" });
    }

    // Check PAY_BILL permission
    const hasPayPermission = await checkBillAccess(userId, userRole, id, 'pay');
    
    if (!hasPayPermission) {
      return res.status(403).json({ 
        error: 'Access denied',
        message: 'You do not have permission to pay this bill.',
        requiredPermission: 'PAY_BILLS'
      });
    }

    const bill = await prisma.bill.findUnique({
      where: { id },
      include: {
        tenant: {
          include: {
            unit: { include: { property: true } }
          }
        },
        billInvoices: {
          orderBy: { createdAt: 'desc' },
          take: 1
        }
      }
    });

    if (!bill) return res.status(404).json({ error: "Bill not found" });

    const roundTo2 = (num) => Math.round(num * 100) / 100;
    const newAmountPaid = roundTo2(bill.amountPaid + amount);
    const grandTotal = roundTo2(bill.grandTotal);
    const remainingBalance = roundTo2(grandTotal - bill.amountPaid);
    const now = new Date();

    if (newAmountPaid > grandTotal + 0.01) {
      return res.status(400).json({
        error: `Payment exceeds bill total. Maximum: Ksh ${remainingBalance.toLocaleString()}`
      });
    }

    let newStatus = bill.status;
    let paidAt = bill.paidAt;

    if (newAmountPaid >= grandTotal) {
      newStatus = "PAID";
      paidAt = now;
    } else if (newAmountPaid > 0) {
      newStatus = "PARTIAL";
    }

    if (bill.dueDate && now > bill.dueDate && newStatus !== "PAID") {
      newStatus = "OVERDUE";
    }

    const { updatedBill, invoice } = await prisma.$transaction(async (tx) => {
      const updatedBill = await tx.bill.update({
        where: { id },
        data: {
          amountPaid: newAmountPaid,
          status: newStatus,
          paidAt
        },
        include: {
          tenant: {
            select: {
              fullName: true,
              unit: { select: { property: { select: { name: true } } } }
            }
          }
        }
      });

      const balance = roundTo2(grandTotal - newAmountPaid);
      let invoiceStatus = "UNPAID";
      if (newAmountPaid >= grandTotal) invoiceStatus = "PAID";
      else if (newAmountPaid > 0) invoiceStatus = "PARTIAL";

      if (bill.dueDate && now > bill.dueDate && invoiceStatus !== "PAID") {
        invoiceStatus = "OVERDUE";
      }

      let invoice;

      if (bill.billInvoices && bill.billInvoices.length > 0) {
        const existingInvoice = bill.billInvoices[0];
        
        invoice = await tx.billInvoice.update({
          where: { id: existingInvoice.id },
          data: {
            amountPaid: newAmountPaid,
            balance: balance,
            status: invoiceStatus,
            notes: existingInvoice.notes 
              ? `${existingInvoice.notes}\nPayment of Ksh ${amount.toLocaleString()} recorded on ${now.toLocaleDateString()}`
              : `Payment of Ksh ${amount.toLocaleString()} recorded on ${now.toLocaleDateString()}`,
            updatedAt: now
          }
        });
      } else {
        const invoiceNumber = await generateBillInvoiceNumber();
        const billReferenceNumber = `BILL-${bill.type}-${bill.id.substring(0, 8).toUpperCase()}`;

        invoice = await tx.billInvoice.create({
          data: {
            invoiceNumber,
            billId: bill.id,
            billReferenceNumber,
            billReferenceDate: bill.issuedAt,
            tenantId: bill.tenantId,
            issueDate: now,
            dueDate: bill.dueDate || now,
            billType: bill.type,
            previousReading: Number(bill.previousReading) || 0,
            currentReading: Number(bill.currentReading) || 0,
            units: Number(bill.units) || 0,
            chargePerUnit: Number(bill.chargePerUnit) || 0,
            totalAmount: Number(bill.totalAmount) || 0,
            vatRate: bill.vatRate ? Number(bill.vatRate) : null,
            vatAmount: bill.vatAmount ? Number(bill.vatAmount) : null,
            grandTotal: grandTotal,
            amountPaid: newAmountPaid,
            balance: balance,
            status: invoiceStatus,
            notes: `Initial payment of Ksh ${amount.toLocaleString()} recorded on ${now.toLocaleDateString()}`
          }
        });
      }

      return { updatedBill, invoice };
    }, {
      maxWait: 15000,
      timeout: 30000,
    });

    let pdfUrl = null;
    if (invoice) {
      try {
        const pdfBuffer = await generateBillInvoicePDF(invoice);
        pdfUrl = await uploadToStorage(pdfBuffer, `${invoice.invoiceNumber}.pdf`);
        
        await prisma.billInvoice.update({
          where: { id: invoice.id },
          data: { pdfUrl }
        });
      } catch (pdfError) {
        console.error("Invoice PDF generation failed:", pdfError);
      }
    }

    res.status(200).json({
      success: true,
      data: {
        bill: updatedBill,
        invoice: { ...invoice, pdfUrl }
      },
      message: "Payment recorded and invoice updated successfully"
    });

  } catch (error) {
    console.error("Error processing bill payment:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
};

