// src/controllers/whatsapp.controller.js
// ES Modules version with formatcontactForWhatsApp

import {
  sendDocumentViaWhatsApp,
  downloadAllPaymentReportsBuffer,
  sendBulkDocuments,
  sendAllPaymentReportsViaWhatsApp,
  getDocumentSendStatus,
  getCommunicationLogs,
  handleWebhook,
  verifyWebhookSignature,
  sendBillReportViaWhatsApp,
  downloadBillReportBuffer,
  sendComprehensiveReportViaWhatsApp,
  downloadComprehensiveReportBuffer,
  formatcontactForWhatsApp
} from '../services/whatsappService.js';

import prisma from '../lib/prisma.js';

/**
 * Send document via WhatsApp
 * POST /api/whatsapp/send-document
 * Required roles: MANAGER, ADMINISTRATOR
 */
export async function sendDocument(req, res, next) {
  try {
const {
  documentId,  documentType,  propertyId,  managerId,  customMessage} = req.body;

if (!documentId || !documentType) {
  return res.status(400).json({
    success: false,
    message: "documentId and documentType are required"
  });
}    

    const result = await sendDocumentViaWhatsApp({  documentId,  documentType,  propertyId,  managerId: req.user?.id || managerId,  customMessage
});
    if (result.success) {
      return res.status(200).json(result);
    } else {
      return res.status(400).json(result);
    }
  } catch (error) {
    next(error);
  }
}
/**
 * Download the combined payment reports PDF directly (no WhatsApp)
 * GET /api/whatsapp/payment-reports/:tenantId/download
 * Required roles: MANAGER, ADMINISTRATOR
 */
export async function downloadAllPaymentReports(req, res, next) {
  try {
    const { tenantId } = req.params;
    if (!tenantId) {
      return res.status(400).json({ success: false, message: 'tenantId is required' });
    }

    const { buffer, tenant } = await downloadAllPaymentReportsBuffer(tenantId);
    const safeName = (tenant.fullName || 'Tenant').replace(/\s+/g, '_');

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="Payment_Reports_${safeName}.pdf"`);
    return res.send(buffer);
  } catch (error) {
    next(error);
  }
}

/**
 * Send documents in bulk
 * POST /api/whatsapp/bulk-send
 * Required roles: ADMINISTRATOR
 */
export async function bulkSendDocuments(req, res, next) {
  try {
    const { documents } = req.body;
    
    if (!documents || !Array.isArray(documents) || documents.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'documents array is required and must not be empty'
      });
    }

    // Validate each document entry
    for (const doc of documents) {
      if (!doc.documentId || !doc.documentType) {
        return res.status(400).json({
          success: false,
          message: 'Each document must have documentId and documentType'
        });
      }
    }

    const result = await sendBulkDocuments(documents);
    
    return res.status(200).json({
      success: true,
      ...result
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Get document send status for a tenant
 * GET /api/whatsapp/status/:tenantId
 * Required roles: MANAGER, ADMINISTRATOR, or property access
 */
export async function getSendStatus(req, res, next) {
  try {
    const { tenantId } = req.params;
    
    if (!tenantId) {
      return res.status(400).json({
        success: false,
        message: 'tenantId is required'
      });
    }

    const status = await getDocumentSendStatus(tenantId);
    
    return res.status(200).json({
      success: true,
      data: status
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Get WhatsApp communication logs
 * GET /api/whatsapp/logs
 * Query params: tenantId, propertyId, documentType, startDate, endDate, status, managerId, limit, page
 * Required roles: ADMINISTRATOR, MANAGER
 */
export async function getLogs(req, res, next) {
  try {
    const filters = {
      tenantId: req.query.tenantId,
      propertyId: req.query.propertyId,
      documentType: req.query.documentType,
      startDate: req.query.startDate,
      endDate: req.query.endDate,
      status: req.query.status,
      managerId: req.query.managerId,
      limit: req.query.limit || 100,
      page: req.query.page || 1
    };

    const result = await getCommunicationLogs(filters);
    
    return res.status(200).json({
      success: true,
      ...result
    });
  } catch (error) {
    next(error);
  }
}
export async function sendBillReport(req, res, next) {
  try {
    const { tenantId } = req.params;
    const result = await sendBillReportViaWhatsApp({ tenantId, customMessage: req.body?.customMessage, managerId: req.user?.id });
    return res.status(result.success ? 200 : 400).json(result);
  } catch (error) { next(error); }
}

export async function downloadBillReport(req, res, next) {
  try {
    const { tenantId } = req.params;
    const { buffer, tenant } = await downloadBillReportBuffer(tenantId);
    const safeName = (tenant.fullName || 'Tenant').replace(/\s+/g, '_');
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="Bill_Report_${safeName}.pdf"`);
    return res.send(buffer);
  } catch (error) { next(error); }
}

export async function sendComprehensiveReport(req, res, next) {
  try {
    const { tenantId } = req.params;
    const result = await sendComprehensiveReportViaWhatsApp({ tenantId, customMessage: req.body?.customMessage, managerId: req.user?.id });
    return res.status(result.success ? 200 : 400).json(result);
  } catch (error) { next(error); }
}
//comprehensive/bill reports
export async function downloadComprehensiveReport(req, res, next) {
  try {
    const { tenantId } = req.params;
    const { buffer, tenant } = await downloadComprehensiveReportBuffer(tenantId);
    const safeName = (tenant.fullName || 'Tenant').replace(/\s+/g, '_');
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="Comprehensive_Report_${safeName}.pdf"`);
    return res.send(buffer);
  } catch (error) { next(error); }
}
/**
 * Get single WhatsApp log details
 * GET /api/whatsapp/logs/:id
 * Required roles: ADMINISTRATOR, MANAGER
 */
export async function getLogDetails(req, res, next) {
  try {
    const { id } = req.params;
    
    const log = await prisma.whatsAppLog.findUnique({
      where: { id },
      include: {
        tenant: {
          select: {
            id: true,
            fullName: true,
            contact: true,
            email: true
          }
        },
        property: {
          select: {
            id: true,
            name: true,
            address: true
          }
        }
      }
    });

    if (!log) {
      return res.status(404).json({
        success: false,
        message: 'Log not found'
      });
    }

    return res.status(200).json({
      success: true,
      data: log
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Handle WhatsApp webhook
 * POST /api/whatsapp/webhook
 * Public endpoint (with verification)
 */
export async function webhookHandler(req, res, next) {
  // GET — Meta's one-time verification handshake
  if (req.method === 'GET') {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    if (mode === 'subscribe' && token === process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN) {
      return res.status(200).send(challenge);
    }
    return res.status(403).send('Verification failed');
  }

  // POST — respond immediately, Meta expects a fast 200 or it will retry
  res.sendStatus(200);

  try {
    if (!verifyWebhookSignature(req)) {
      console.warn('Rejected WhatsApp webhook: invalid signature');
      return;
    }
    await handleWebhook({ body: req.body });
  } catch (error) {
    console.error('Webhook processing error:', error);
  }
}
/**
 * Update WhatsApp log status manually
 * PATCH /api/whatsapp/logs/:id/status
 * Required roles: ADMINISTRATOR
 */
export async function updateLogStatus(req, res, next) {
  try {
    const { id } = req.params;
    const { status, errorMessage } = req.body;
    
    if (!status) {
      return res.status(400).json({
        success: false,
        message: 'status is required'
      });
    }

    const validStatuses = ['pending', 'sent', 'delivered', 'read', 'failed'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        message: `Invalid status. Must be one of: ${validStatuses.join(', ')}`
      });
    }

    const log = await prisma.whatsAppLog.update({
      where: { id },
      data: {
        status,
        errorMessage,
        updatedAt: new Date()
      }
    });

    return res.status(200).json({
      success: true,
      data: log
    });
  } catch (error) {
    next(error);
  }
}
//send all payment reports via whatsapp
export async function sendAllPaymentReports(req, res, next) {
  try {
    const { tenantId } = req.params;
    const { customMessage } = req.body;

    if (!tenantId) {
      return res.status(400).json({ success: false, message: 'tenantId is required' });
    }

    const result = await sendAllPaymentReportsViaWhatsApp({
      tenantId,
      customMessage,
      managerId: req.user?.id
    });

    return res.status(result.success ? 200 : 400).json(result);
  } catch (error) {
    next(error);
  }
}

/**
 * Resend a document
 * POST /api/whatsapp/resend/:logId
 * Required roles: MANAGER, ADMINISTRATOR
 */
export async function resendDocument(req, res, next) {
  try {
    const { logId } = req.params;
    const { customMessage } = req.body;
    
    // Get the original log
    const log = await prisma.whatsAppLog.findUnique({
      where: { id: logId }
    });

    if (!log) {
      return res.status(404).json({
        success: false,
        message: 'Log not found'
      });
    }

    // Resend the document
    const result = await sendDocumentViaWhatsApp({
  documentId: log.documentId,
  documentType: log.documentType,
  propertyId: log.propertyId,
  managerId: req.user?.id,
  customMessage
});
    if (result.success) {
      // Update the original log to mark as resent
      await prisma.whatsAppLog.update({
        where: { id: logId },
        data: {
          status: 'resent',
          updatedAt: new Date()
        }
      });
    }

    return res.status(result.success ? 200 : 400).json(result);
  } catch (error) {
    next(error);
  }
}

export default {
  sendDocument,
  downloadAllPaymentReportsBuffer,
  bulkSendDocuments,
  getSendStatus,
  getLogs,
  getLogDetails,
  webhookHandler,
  updateLogStatus,
  sendAllPaymentReports,
  downloadComprehensiveReport,
  sendComprehensiveReport,
  downloadBillReport,
  sendBillReport,
  resendDocument
};