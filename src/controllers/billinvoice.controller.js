import prisma from "../lib/prisma.js";
import { buildBillInvoiceHtml, buildBillInvoiceFooterTemplate } from '../services/pdf/billInvoicePdf.js';
import { generatePDF } from '../utils/pdfGenerator.js';
import { uploadToStorage } from '../utils/storage.js';
import { generateBillInvoiceNumber } from '../utils/invoiceHelpers.js';
import fs from 'fs';
import path from 'path';
import permissionService from "../services/permissionService.js";

// ======================================================
// PERMISSION HELPER FUNCTIONS
// ======================================================

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

const checkBillInvoicePermission = async (userId, userRole, propertyId, operation) => {
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
    return await permissionService.checkPermission(userId, 'billInvoice', operation, propertyId);
  }
  
  return false;
};

const checkBillInvoiceWriteAccess = async (userId, userRole, billInvoiceId, operation = 'edit') => {
  if (userRole === 'ADMIN') {
    return true;
  }
  
  const billInvoice = await prisma.billInvoice.findUnique({
    where: { id: billInvoiceId },
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
  
  if (!billInvoice) return false;
  
  const propertyId = billInvoice.tenant?.unit?.propertyId;
  if (!propertyId) return false;
  
  if (userRole === 'MANAGER') {
    const property = await prisma.property.findFirst({
      where: { id: propertyId, managerId: userId }
    });
    return !!property;
  }
  
  if (userRole === 'USER') {
    return await checkBillInvoicePermission(userId, userRole, propertyId, operation);
  }
  
  return false;
};

const getAccessiblePropertyIds = async (userId, userRole) => {
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
    return await permissionService.getAccessiblePropertyIds(userId, userRole);
  }
  
  return [];
};

// ======================================================
// BILL INVOICE CONTROLLER FUNCTIONS
// ======================================================

// @desc    Generate invoice for a bill (for current remaining balance)
// @route   POST /api/bill-invoices/generate
// @access  Private
export const generateBillInvoice = async (req, res) => {
  try {
    const userId = req.user.id;
    const userRole = req.user.role;
    const { billId, dueDate, notes } = req.body;

    if (!billId || !dueDate) {
      return res.status(400).json({ 
        success: false, 
        error: 'billId and dueDate are required.' 
      });
    }

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

    if (!bill) {
      return res.status(404).json({ 
        success: false, 
        error: 'Bill not found.' 
      });
    }

    const propertyId = bill.tenant?.unit?.propertyId;
    
    const hasCreatePermission = await checkBillInvoicePermission(userId, userRole, propertyId, 'create');
    
    if (!hasCreatePermission) {
      return res.status(403).json({ 
        success: false,
        error: 'Access denied',
        message: 'You do not have permission to generate bill invoices for this property.',
        requiredPermission: 'CREATE_BILL_INVOICE'
      });
    }

    const remainingBalance = bill.grandTotal - bill.amountPaid;
    
    if (remainingBalance <= 0) {
      return res.status(400).json({ 
        success: false, 
        error: 'Bill is already fully paid. No balance remaining for invoice.' 
      });
    }

    const invoiceNumber = await generateBillInvoiceNumber();
    const billReferenceNumber = `BILL-${bill.type}-${bill.id.substring(0, 8).toUpperCase()}`;

    let status = 'UNPAID';
    const now = new Date();
    const due = new Date(dueDate);
    
    if (now > due) {
      status = 'OVERDUE';
    }

    // Create bill invoice record for the CURRENT BALANCE
    const billInvoice = await prisma.billInvoice.create({
      data: {
        invoiceNumber,
        billId: bill.id,
        billReferenceNumber,
        billReferenceDate: bill.issuedAt,
        tenantId: bill.tenantId,
        issueDate: new Date(),
        dueDate: due,
        billType: bill.type, 
        previousReading: Number(bill.previousReading) || 0,
        currentReading: Number(bill.currentReading) || 0,
        units: Number(bill.units) || 0,
        chargePerUnit: Number(bill.chargePerUnit) || 0,
        totalAmount: Number(bill.totalAmount) || 0,
        vatRate: bill.vatRate ? Number(bill.vatRate) : null,
        vatAmount: bill.vatAmount ? Number(bill.vatAmount) : null,
        grandTotal: remainingBalance,
        amountPaid: 0,
        balance: remainingBalance,
        status,
        notes: notes || `Invoice generated for remaining balance of Ksh ${remainingBalance.toLocaleString()}`
      },
      include: {
        tenant: {
          include: {
            unit: {
              include: {
                property: true
              }
            }
          }
        },
        bill: true
      }
    });

    // Generate PDF -- uses `billInvoice`, the record just created above,
    // which already has the tenant/unit/property/bill include it needs.
    const pdfBuffer = await generatePDF(buildBillInvoiceHtml(billInvoice), {
      displayHeaderFooter: true,
      headerTemplate: '<div></div>',
      footerTemplate: buildBillInvoiceFooterTemplate(),
      margin: { top: '20px', right: '20px', bottom: '55px', left: '20px' }
    });

    const pdfUrl = await uploadToStorage(pdfBuffer, `${invoiceNumber}.pdf`);

    const updatedInvoice = await prisma.billInvoice.update({
      where: { id: billInvoice.id },
      data: { pdfUrl }
    });

    res.status(201).json({
      success: true,
      data: updatedInvoice,
      message: 'Bill invoice generated successfully for remaining balance'
    });
  } catch (error) {
    console.error('Error generating bill invoice:', error);
    res.status(500).json({ success: false, error: 'Internal Server Error' });
  }
};

// @desc    Get all bill invoices
// @route   GET /api/bill-invoices
// @access  Private
export const getAllBillInvoices = async (req, res) => {
  try {
    const userId = req.user.id;
    const userRole = req.user.role;
    const { page = 1, limit = 10, status, tenantId, billType } = req.query;
    const skip = (parseInt(page, 10) - 1) * parseInt(limit, 10);

    let whereClause = {};
    if (status) whereClause.status = status;
    if (tenantId) whereClause.tenantId = tenantId;
    if (billType) whereClause.billType = billType;

    if (userRole === 'ADMIN') {
      // no additional filter
    } else if (userRole === 'MANAGER') {
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
      const accessiblePropertyIds = await getAccessiblePropertyIds(userId, userRole);
      
      if (accessiblePropertyIds.length === 0) {
        return res.status(200).json({
          success: true,
          data: [],
          pagination: {
            page: parseInt(page, 10),
            limit: parseInt(limit, 10),
            total: 0,
            totalPages: 0
          }
        });
      }
      
      const propertiesWithPermission = [];
      for (const propertyId of accessiblePropertyIds) {
        const hasViewPermission = await checkBillInvoicePermission(userId, userRole, propertyId, 'view');
        if (hasViewPermission) {
          propertiesWithPermission.push(propertyId);
        }
      }
      
      if (propertiesWithPermission.length === 0) {
        return res.status(200).json({
          success: true,
          data: [],
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
            propertyId: { in: propertiesWithPermission }
          }
        }
      };
    } else {
      return res.status(403).json({ success: false, error: 'Access denied' });
    }

    const billInvoices = await prisma.billInvoice.findMany({
      where: whereClause,
      skip,
      take: parseInt(limit, 10),
      orderBy: { issueDate: 'desc' },
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
        bill: {
          select: {
            id: true,
            type: true,
            issuedAt: true
          }
        }
      }
    });

    const total = await prisma.billInvoice.count({ where: whereClause });

    res.status(200).json({
      success: true,
      data: billInvoices,
      pagination: {
        page: parseInt(page, 10),
        limit: parseInt(limit, 10),
        total,
        totalPages: Math.ceil(total / parseInt(limit, 10)),
      },
    });
  } catch (error) {
    console.error('Error fetching bill invoices:', error);
    res.status(500).json({ success: false, error: 'Internal Server Error' });
  }
};

// @desc    Get bill invoices by tenant
// @route   GET /api/bill-invoices/tenant/:tenantId
// @access  Private
export const getBillInvoicesByTenant = async (req, res) => {
  try {
    const userId = req.user.id;
    const userRole = req.user.role;
    const { tenantId } = req.params;
    const { page = 1, limit = 10, status, billType } = req.query;
    const skip = (parseInt(page, 10) - 1) * parseInt(limit, 10);

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
      return res.status(404).json({ 
        success: false, 
        error: 'Tenant not found' 
      });
    }
    
    const propertyId = tenant.unit?.propertyId;
    
    const hasViewPermission = await checkBillInvoicePermission(userId, userRole, propertyId, 'view');
    
    if (!hasViewPermission) {
      return res.status(403).json({ 
        success: false,
        error: 'Access denied',
        message: 'You do not have permission to view bill invoices for this tenant.',
        requiredPermission: 'VIEW_BILL_INVOICES'
      });
    }

    const whereClause = { tenantId };
    if (status) whereClause.status = status;
    if (billType) whereClause.billType = billType;

    const billInvoices = await prisma.billInvoice.findMany({
      where: whereClause,
      skip,
      take: parseInt(limit, 10),
      orderBy: { issueDate: 'desc' },
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
                  select: { name: true, address: true }
                }
              }
            }
          }
        },
        bill: true
      }
    });

    const total = await prisma.billInvoice.count({ where: whereClause });

    res.status(200).json({
      success: true,
      data: billInvoices,
      pagination: {
        page: parseInt(page, 10),
        limit: parseInt(limit, 10),
        total,
        totalPages: Math.ceil(total / parseInt(limit, 10)),
      },
    });
  } catch (error) {
    console.error('Error fetching bill invoices:', error);
    res.status(500).json({ success: false, error: 'Internal Server Error' });
  }
};

// @desc    Get single bill invoice by ID
// @route   GET /api/bill-invoices/:id
// @access  Private
export const getBillInvoiceById = async (req, res) => {
  try {
    const userId = req.user.id;
    const userRole = req.user.role;
    const { id } = req.params;

    const billInvoice = await prisma.billInvoice.findUnique({
      where: { id },
      include: {
        tenant: {
          include: {
            unit: {
              include: {
                property: true
              }
            }
          }
        },
        bill: true
      }
    });

    if (!billInvoice) {
      return res.status(404).json({ 
        success: false, 
        error: 'Bill invoice not found.' 
      });
    }

    const propertyId = billInvoice.tenant?.unit?.propertyId;
    
    const hasViewPermission = await checkBillInvoicePermission(userId, userRole, propertyId, 'view');
    
    if (!hasViewPermission) {
      return res.status(403).json({ 
        success: false,
        error: 'Access denied',
        message: 'You do not have permission to view this bill invoice.',
        requiredPermission: 'VIEW_BILL_INVOICES'
      });
    }

    res.status(200).json({ success: true, data: billInvoice });
  } catch (error) {
    console.error('Error fetching bill invoice:', error);
    res.status(500).json({ success: false, error: 'Internal Server Error' });
  }
};

// @desc    Update bill invoice status and payment
// @route   PATCH /api/bill-invoices/:id/payment
// @access  Private
export const updateBillInvoicePayment = async (req, res) => {
  try {
    const userId = req.user.id;
    const userRole = req.user.role;
    const { id } = req.params;
    const { amountPaid } = req.body;

    if (!amountPaid || amountPaid <= 0) {
      return res.status(400).json({ 
        success: false, 
        error: 'Invalid payment amount' 
      });
    }

    const hasEditPermission = await checkBillInvoiceWriteAccess(userId, userRole, id, 'edit');
    
    if (!hasEditPermission) {
      return res.status(403).json({ 
        success: false,
        error: 'Access denied',
        message: 'You do not have permission to update payments for this bill invoice.',
        requiredPermission: 'EDIT_BILL_INVOICE_PAYMENT'
      });
    }

    const billInvoice = await prisma.billInvoice.findUnique({ 
      where: { id } 
    });

    if (!billInvoice) {
      return res.status(404).json({ 
        success: false, 
        error: 'Bill invoice not found' 
      });
    }

    const newAmountPaid = billInvoice.amountPaid + amountPaid;
    const newBalance = billInvoice.grandTotal - newAmountPaid;
    
    let newStatus = billInvoice.status;
    if (newAmountPaid >= billInvoice.grandTotal) {
      newStatus = 'PAID';
    } else if (newAmountPaid > 0) {
      newStatus = 'PARTIAL';
    }

    const now = new Date();
    if (now > billInvoice.dueDate && newStatus !== 'PAID') {
      newStatus = 'OVERDUE';
    }

    const totalPaid = Math.min(newAmountPaid, billInvoice.grandTotal);
    const finalBalance = Math.max(0, billInvoice.grandTotal - totalPaid);

    const updatedInvoice = await prisma.billInvoice.update({
      where: { id },
      data: {
        amountPaid: totalPaid,
        balance: finalBalance,
        status: newStatus
      },
      include: {
        tenant: {
          select: {
            fullName: true,
            unit: {
              select: {
                unitNo: true,
                property: { select: { name: true } }
              }
            }
          }
        }
      }
    });

    await prisma.bill.update({
      where: { id: billInvoice.billId },
      data: {
        amountPaid: totalPaid,
        status: newStatus === 'PAID' ? 'PAID' : newStatus === 'PARTIAL' ? 'PARTIAL' : 'UNPAID',
        paidAt: newStatus === 'PAID' ? new Date() : null
      }
    });

    res.status(200).json({
      success: true,
      data: updatedInvoice,
      message: 'Payment recorded successfully'
    });
  } catch (error) {
    console.error('Error updating bill invoice payment:', error);
    res.status(500).json({ success: false, error: 'Internal Server Error' });
  }
};

// @desc    Record a new payment for a bill invoice (idempotent-friendly)
// @route   POST /api/bill-invoices/:id/record-payment
// @access  Private
export const recordBillInvoicePayment = async (req, res) => {
  try {
    const userId = req.user.id;
    const userRole = req.user.role;
    const { id } = req.params;
    const { amountPaid, paymentDate, notes } = req.body;

    if (!amountPaid || amountPaid <= 0) {
      return res.status(400).json({
        success: false,
        error: 'amountPaid must be a positive number'
      });
    }

    if (!paymentDate) {
      return res.status(400).json({
        success: false,
        error: 'paymentDate is required'
      });
    }

    const hasEditPermission = await checkBillInvoiceWriteAccess(userId, userRole, id, 'edit');
    
    if (!hasEditPermission) {
      return res.status(403).json({ 
        success: false,
        error: 'Access denied',
        message: 'You do not have permission to record payments for this bill invoice.',
        requiredPermission: 'EDIT_BILL_INVOICE_PAYMENT'
      });
    }

    const parsedPaymentDate = new Date(paymentDate);
    if (isNaN(parsedPaymentDate.getTime())) {
      return res.status(400).json({
        success: false,
        error: 'Invalid paymentDate format'
      });
    }

    const billInvoice = await prisma.billInvoice.findUnique({
      where: { id },
      include: { 
        bill: true,
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

    if (!billInvoice) {
      return res.status(404).json({
        success: false,
        error: 'Bill invoice not found'
      });
    }

    const newAmountPaid = billInvoice.amountPaid + amountPaid;
    const invoiceGrandTotal = Number(billInvoice.grandTotal);
    const finalAmountPaid = Math.min(newAmountPaid, invoiceGrandTotal);
    const newBalance = Math.max(0, invoiceGrandTotal - finalAmountPaid);

    let newInvoiceStatus = billInvoice.status;
    if (finalAmountPaid >= invoiceGrandTotal) {
      newInvoiceStatus = 'PAID';
    } else if (finalAmountPaid > 0) {
      newInvoiceStatus = 'PARTIAL';
    }

    const now = new Date();
    if (now > new Date(billInvoice.dueDate) && newInvoiceStatus !== 'PAID') {
      newInvoiceStatus = 'OVERDUE';
    }

    const [updatedInvoice, updatedBill] = await prisma.$transaction(async (tx) => {
      const paymentNote = notes 
        ? `${notes} - Payment of Ksh ${amountPaid.toLocaleString()} recorded on ${parsedPaymentDate.toLocaleDateString()}`
        : `Payment of Ksh ${amountPaid.toLocaleString()} recorded on ${parsedPaymentDate.toLocaleDateString()}`;
      
      const updatedInvoice = await tx.billInvoice.update({
        where: { id },
        data: {
          amountPaid: finalAmountPaid,
          balance: newBalance,
          status: newInvoiceStatus,
          notes: billInvoice.notes 
            ? `${billInvoice.notes}\n${paymentNote}`
            : paymentNote,
          updatedAt: new Date()
        },
        include: {
          tenant: {
            include: {
              unit: { include: { property: true } }
            }
          },
          bill: true
        }
      });

      const billNewAmountPaid = billInvoice.bill.amountPaid + amountPaid;
      const billGrandTotal = Number(billInvoice.bill.grandTotal);
      const billFinalAmountPaid = Math.min(billNewAmountPaid, billGrandTotal);

      let billNewStatus = billInvoice.bill.status;
      if (billFinalAmountPaid >= billGrandTotal) {
        billNewStatus = 'PAID';
      } else if (billFinalAmountPaid > 0) {
        billNewStatus = 'PARTIAL';
      }

      if (billInvoice.bill.dueDate && now > new Date(billInvoice.bill.dueDate) && billNewStatus !== 'PAID') {
        billNewStatus = 'OVERDUE';
      }

      const updatedBill = await tx.bill.update({
        where: { id: billInvoice.billId },
        data: {
          amountPaid: billFinalAmountPaid,
          status: billNewStatus,
          paidAt: billNewStatus === 'PAID' ? new Date() : billInvoice.bill.paidAt
        }
      });

      return [updatedInvoice, updatedBill];
    });

    // Regenerate PDF with updated payment information -- uses `updatedInvoice`
    // (the POST-payment record), not the stale pre-payment `billInvoice`,
    // so the regenerated document actually reflects the new balance.
    let pdfUrl = null;
    try {
      const pdfBuffer = await generatePDF(buildBillInvoiceHtml(updatedInvoice), {
        displayHeaderFooter: true,
        headerTemplate: '<div></div>',
        footerTemplate: buildBillInvoiceFooterTemplate(),
        margin: { top: '20px', right: '20px', bottom: '55px', left: '20px' }
      });
      pdfUrl = await uploadToStorage(pdfBuffer, `${updatedInvoice.invoiceNumber}.pdf`);

      await prisma.billInvoice.update({
        where: { id: updatedInvoice.id },
        data: { pdfUrl }
      });
    } catch (pdfError) {
      console.error('Invoice PDF regeneration failed:', pdfError);
    }

    res.status(200).json({
      success: true,
      data: {
        invoice: {
          ...updatedInvoice,
          pdfUrl: pdfUrl || updatedInvoice.pdfUrl
        },
        bill: updatedBill
      },
      message: 'Payment recorded successfully and invoice updated'
    });
  } catch (error) {
    console.error('Error recording bill invoice payment:', error);
    if (error.code === 'P2002') {
      return res.status(409).json({ success: false, error: 'Duplicate payment detected' });
    }
    res.status(500).json({ success: false, error: 'Failed to record payment' });
  }
};

// @desc    Download bill invoice PDF
// @route   GET /api/bill-invoices/:id/download
// @access  Private
export const downloadBillInvoice = async (req, res) => {
  try {
    const userId = req.user.id;
    const userRole = req.user.role;
    const { id } = req.params;

    const billInvoice = await prisma.billInvoice.findUnique({
      where: { id },
      include: {
        tenant: {
          include: {
            unit: {
              include: {
                property: true
              }
            }
          }
        },
        bill: true
      }
    });

    if (!billInvoice) {
      return res.status(404).json({ 
        success: false, 
        error: 'Bill invoice not found.' 
      });
    }

    const propertyId = billInvoice.tenant?.unit?.propertyId;
    
    const hasDownloadPermission = await checkBillInvoicePermission(userId, userRole, propertyId, 'download');
    
    if (!hasDownloadPermission) {
      return res.status(403).json({ 
        success: false,
        error: 'Access denied',
        message: 'You do not have permission to download this bill invoice.',
        requiredPermission: 'DOWNLOAD_BILL_INVOICE'
      });
    }

    // Generate PDF -- same generator used for WhatsApp sends
    const pdfBuffer = await generatePDF(buildBillInvoiceHtml(billInvoice), {
      displayHeaderFooter: true,
      headerTemplate: '<div></div>',
      footerTemplate: buildBillInvoiceFooterTemplate(),
      margin: { top: '20px', right: '20px', bottom: '55px', left: '20px' }
    });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${billInvoice.invoiceNumber}.pdf"`);
    res.send(pdfBuffer);
  } catch (error) {
    console.error('Error downloading bill invoice:', error);
    res.status(500).json({ success: false, error: 'Internal Server Error' });
  }
};

// @desc    Delete bill invoice and associated PDF
// @route   DELETE /api/bill-invoices/:id
// @access  Private (Admin only or users with DELETE_BILL_INVOICE permission)
export const deleteBillInvoice = async (req, res) => {
  try {
    const userId = req.user.id;
    const userRole = req.user.role;
    const { id } = req.params;
    const { 
      deletePaymentReport = false, 
      deleteLinkedInvoices = false,
      force = false 
    } = req.body;
    
    const hasDeletePermission = await checkBillInvoiceWriteAccess(userId, userRole, id, 'delete');
    
    if (!hasDeletePermission) {
      return res.status(403).json({ 
        success: false,
        error: 'Access denied',
        message: 'You do not have permission to delete this bill invoice.',
        requiredPermission: 'DELETE_BILL_INVOICE'
      });
    }
    
    const billInvoice = await prisma.billInvoice.findUnique({
      where: { id },
      include: {
        paymentReport: {
          include: {
            billInvoices: {
              select: {
                id: true,
                invoiceNumber: true,
                pdfUrl: true,
                createdAt: true,
                tenant: {
                  select: {
                    fullName: true
                  }
                }
              }
            },
            _count: {
              select: { billInvoices: true }
            }
          }
        },
        tenant: {
          select: {
            id: true,
            fullName: true,
            contact: true,
            unit: {
              select: {
                unitNo: true,
                property: {
                  select: { 
                    name: true,
                    address: true 
                  }
                }
              }
            }
          }
        },
        bill: {
          select: {
            id: true,
            type: true,
            status: true,
            grandTotal: true,
            amountPaid: true
          }
        }
      }
    });
    
    if (!billInvoice) {
      return res.status(404).json({ 
        success: false, 
        error: 'Bill invoice not found.' 
      });
    }
    
    const invoiceAge = Date.now() - new Date(billInvoice.createdAt).getTime();
    const maxAgeForDeletion = 60 * 24 * 60 * 60 * 1000;
    
    if (!force && invoiceAge > maxAgeForDeletion) {
      return res.status(400).json({
        success: false,
        message: `Bill invoice is older than 60 days. Use force=true to delete older invoices.`,
        invoiceDate: billInvoice.createdAt,
        ageInDays: Math.floor(invoiceAge / (24 * 60 * 60 * 1000)),
        allowed: false
      });
    }
    
    const result = {
      billInvoiceDeleted: false,
      paymentReportDeleted: false,
      linkedBillInvoicesDeleted: 0,
      totalPdfsDeleted: 0,
      invoiceInfo: {
        id: billInvoice.id,
        invoiceNumber: billInvoice.invoiceNumber,
        tenantName: billInvoice.tenant.fullName,
        propertyName: billInvoice.tenant.unit?.property?.name || 'N/A',
        billType: billInvoice.billType,
        grandTotal: billInvoice.grandTotal,
        balance: billInvoice.balance,
        createdAt: billInvoice.createdAt
      }
    };
    
    let linkedBillInvoices = [];
    if (billInvoice.paymentReport) {
      result.paymentReportInfo = {
        id: billInvoice.paymentReportId,
        status: billInvoice.paymentReport.status,
        totalLinkedBillInvoices: billInvoice.paymentReport._count.billInvoices,
        linkedBillInvoices: billInvoice.paymentReport.billInvoices.map(inv => ({
          id: inv.id,
          invoiceNumber: inv.invoiceNumber,
          tenantName: inv.tenant.fullName,
          createdAt: inv.createdAt
        }))
      };
      linkedBillInvoices = billInvoice.paymentReport.billInvoices;
    }
    
    const deleteOperations = [];
    const deletedBillInvoiceIds = new Set();
    
    const deleteBillInvoiceAndPDF = async (invoiceToDelete, isMainInvoice = false) => {
      let pdfDeleted = false;
      if (invoiceToDelete.pdfUrl) {
        try {
          const filePath = path.join(
            process.cwd(), 
            'uploads', 
            'bill-invoices',
            path.basename(invoiceToDelete.pdfUrl)
          );
          
          if (fs.existsSync(filePath)) {
            await fs.promises.unlink(filePath);
            pdfDeleted = true;
            result.totalPdfsDeleted++;
            console.log(`Deleted PDF: ${invoiceToDelete.invoiceNumber}`);
          }
        } catch (fileError) {
          console.warn(`Could not delete PDF for ${invoiceToDelete.invoiceNumber}:`, fileError.message);
        }
      }
      
      deleteOperations.push(
        prisma.billInvoice.delete({
          where: { id: invoiceToDelete.id }
        }).then(() => {
          deletedBillInvoiceIds.add(invoiceToDelete.id);
          
          if (isMainInvoice) {
            result.billInvoiceDeleted = true;
          } else {
            result.linkedBillInvoicesDeleted++;
          }
          
          console.log(`Deleted bill invoice: ${invoiceToDelete.invoiceNumber}`);
        })
      );
      
      return pdfDeleted;
    };
    
    if (deleteLinkedInvoices && deletePaymentReport && billInvoice.paymentReportId) {
      for (const linkedInvoice of linkedBillInvoices) {
        await deleteBillInvoiceAndPDF(linkedInvoice, linkedInvoice.id === id);
      }
      
      deleteOperations.push(
        prisma.paymentReport.delete({
          where: { id: billInvoice.paymentReportId }
        }).then(() => {
          result.paymentReportDeleted = true;
          console.log(`Deleted PaymentReport: ${billInvoice.paymentReportId}`);
        })
      );
      
    } 
    else if (deleteLinkedInvoices && billInvoice.paymentReportId) {
      for (const linkedInvoice of linkedBillInvoices) {
        await deleteBillInvoiceAndPDF(linkedInvoice, linkedInvoice.id === id);
      }
      result.paymentReportRemains = true;
      
    }
    else if (deletePaymentReport && billInvoice.paymentReportId) {
      const paymentReport = billInvoice.paymentReport;
      
      if (paymentReport && paymentReport._count.billInvoices === 1) {
        await deleteBillInvoiceAndPDF(billInvoice, true);
        
        deleteOperations.push(
          prisma.paymentReport.delete({
            where: { id: billInvoice.paymentReportId }
          }).then(() => {
            result.paymentReportDeleted = true;
            console.log(`Deleted PaymentReport: ${billInvoice.paymentReportId}`);
          })
        );
      } else if (paymentReport) {
        return res.status(400).json({
          success: false,
          message: 'Cannot delete payment report as it has other bill invoices linked to it.',
          linkedBillInvoiceCount: paymentReport._count.billInvoices,
          linkedBillInvoices: paymentReport.billInvoices
            .filter(inv => inv.id !== id)
            .map(inv => ({
              id: inv.id,
              invoiceNumber: inv.invoiceNumber,
              tenantName: inv.tenant.fullName
            })),
          suggestion: 'Use deleteLinkedInvoices=true to delete all linked bill invoices'
        });
      }
    }
    else {
      await deleteBillInvoiceAndPDF(billInvoice, true);
    }
    
    if (deleteOperations.length > 0) {
      await Promise.all(deleteOperations);
    }
    
    if (billInvoice.amountPaid > 0) {
      try {
        const currentBill = await prisma.bill.findUnique({
          where: { id: billInvoice.billId }
        });
        
        if (currentBill) {
          const newBillAmountPaid = Math.max(0, currentBill.amountPaid - billInvoice.amountPaid);
          const newBillBalance = currentBill.grandTotal - newBillAmountPaid;
          
          let newBillStatus = currentBill.status;
          if (newBillAmountPaid >= currentBill.grandTotal) {
            newBillStatus = 'PAID';
          } else if (newBillAmountPaid > 0) {
            newBillStatus = 'PARTIAL';
          } else {
            newBillStatus = 'UNPAID';
          }
          
          await prisma.bill.update({
            where: { id: billInvoice.billId },
            data: {
              amountPaid: newBillAmountPaid,
              status: newBillStatus,
              paidAt: newBillStatus === 'PAID' ? currentBill.paidAt : null
            }
          });
          
          result.billUpdated = {
            id: billInvoice.billId,
            previousAmountPaid: currentBill.amountPaid,
            newAmountPaid: newBillAmountPaid,
            newStatus: newBillStatus
          };
        }
      } catch (billError) {
        console.warn('Could not update bill amounts:', billError.message);
      }
    }
    
    let message = 'Bill invoice deleted successfully';
    if (result.linkedBillInvoicesDeleted > 0) {
      message += ` along with ${result.linkedBillInvoicesDeleted} linked bill invoice(s)`;
    }
    if (result.paymentReportDeleted) {
      message += ' and its payment report';
    }
    if (result.billUpdated) {
      message += `. Original bill payment amounts have been adjusted.`;
    }
    message += '.';
    
    res.status(200).json({
      success: true,
      data: result,
      message: message
    });
    
  } catch (error) {
    console.error('Error deleting bill invoice:', error);
    
    if (error.code === 'P2003') {
      return res.status(400).json({
        success: false,
        message: 'Cannot delete bill invoice due to database constraints.',
        suggestion: 'Try deleting linked records first or use deletePaymentReport=true',
        errorCode: error.code
      });
    }
    
    if (error.code === 'P2025') {
      return res.status(404).json({
        success: false,
        message: 'Record not found. It may have been already deleted.',
        errorCode: error.code
      });
    }
    
    res.status(500).json({ 
      success: false, 
      error: error.message,
      errorCode: error.code
    });
  }
};

// @desc    Delete bill invoice PDF only (keep database record)
// @route   DELETE /api/bill-invoices/:id/pdf
// @access  Private (Admin only or users with DELETE_BILL_INVOICE permission)
export const deleteBillInvoicePDF = async (req, res) => {
  try {
    const userId = req.user.id;
    const userRole = req.user.role;
    const { id } = req.params;
    
    const hasDeletePermission = await checkBillInvoiceWriteAccess(userId, userRole, id, 'delete');
    
    if (!hasDeletePermission) {
      return res.status(403).json({ 
        success: false,
        error: 'Access denied',
        message: 'You do not have permission to delete bill invoice PDFs.',
        requiredPermission: 'DELETE_BILL_INVOICE'
      });
    }
    
    const billInvoice = await prisma.billInvoice.findUnique({
      where: { id }
    });
    
    if (!billInvoice) {
      return res.status(404).json({ 
        success: false, 
        error: 'Bill invoice not found.' 
      });
    }
    
    if (!billInvoice.pdfUrl) {
      return res.status(400).json({ 
        success: false, 
        error: 'No PDF associated with this bill invoice' 
      });
    }
    
    const filePath = path.join(
      process.cwd(), 
      'uploads', 
      'bill-invoices',
      path.basename(billInvoice.pdfUrl)
    );
    
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ 
        success: false, 
        error: 'PDF file not found on server' 
      });
    }
    
    await fs.promises.unlink(filePath);
    
    await prisma.billInvoice.update({
      where: { id },
      data: { pdfUrl: null }
    });
    
    res.status(200).json({
      success: true,
      message: 'Bill invoice PDF deleted successfully',
      data: {
        invoiceId: billInvoice.id,
        invoiceNumber: billInvoice.invoiceNumber,
        pdfUrl: null
      }
    });
  } catch (error) {
    console.error('Error deleting bill invoice PDF:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
};