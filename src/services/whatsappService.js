// src/services/whatsappService.js
// ES Modules version -- media is generated and uploaded entirely in memory,
// no temp disk writes for the WhatsApp send path.

import axios from 'axios';
import FormData from 'form-data';
import prisma from '../lib/prisma.js';
import { generatePDF } from "../utils/pdfGenerator.js";
import { buildInvoiceHtml } from "./pdf/invoicePdf.js";
import { buildBillInvoiceHtml } from "./pdf/billInvoicePdf.js";
import { buildBillReportHtml, buildBillReportFooterTemplate } from "./pdf/billReportPdf.js";
import { buildComprehensiveReportHtml, buildComprehensiveReportFooterTemplate } from "./pdf/comprehensiveReportPdf.js";
import { buildDemandLetterHtml, buildDemandLetterFooterTemplate } from "./pdf/demandLetterPdf.js";
import { buildAllPaymentReportsHtml, buildAllPaymentReportsFooterTemplate } from "./pdf/allPaymentReportsPdf.js";
import crypto from 'crypto';
import { Readable } from 'stream';

// Configuration from environment variables
const WHATSAPP_API_VERSION = process.env.WHATSAPP_API_VERSION || 'v18.0';
const WHATSAPP_PHONE_ID = process.env.WHATSAPP_PHONE_ID;
const WHATSAPP_ACCESS_TOKEN = process.env.WHATSAPP_ACCESS_TOKEN;
const WHATSAPP_BASE_URL = `https://graph.facebook.com/${WHATSAPP_API_VERSION}`;
const WHATSAPP_WEBHOOK_VERIFY_TOKEN = process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN;
const WHATSAPP_APP_SECRET = process.env.WHATSAPP_APP_SECRET;

console.log("===== WHATSAPP CONFIG =====");
console.log("PHONE ID:", WHATSAPP_PHONE_ID);
console.log(
  "TOKEN:",
  WHATSAPP_ACCESS_TOKEN
    ? `${WHATSAPP_ACCESS_TOKEN.substring(0, 25)}...${WHATSAPP_ACCESS_TOKEN.slice(-15)}`
    : "UNDEFINED"
);
console.log("===========================");

// Retry configuration
const MAX_RETRIES = 5; // was 70 -- see note below on why that was a bug, not a feature
const RETRY_DELAY_MS = 2000;

// Supported document types and their generators.
// Each generator now returns { buffer, filename, mimeType } -- no disk path.
const DOCUMENT_GENERATORS = {
  "Invoice": generateInvoice,
  "Demand Letter": generateDemandLetter,
  "Bill Invoices": generateBillInvoice
};

/**
 * Main service to send document via WhatsApp
 */
export async function sendDocumentViaWhatsApp(options) {
  const {
    documentId,
    documentType,
    propertyId,
    managerId,
    customMessage
  } = options;

  let resolvedPropertyId = propertyId;

  if (!documentId || !documentType) {
    throw new Error("documentId and documentType are required");
  }

  let tenant;
  let documentRecord;

  switch (documentType) {

    case "Invoice":
      documentRecord = await prisma.invoice.findUnique({
        where: { id: documentId },
        include: {
          tenant: {
            include: {
              unit: { include: { property: true } },
              invoices: true
            }
          },
          paymentReport: true
        }
      });

      if (!documentRecord)
        throw new Error("Invoice not found");

      tenant = documentRecord.tenant;
      break;

    case "Bill Invoices":
      documentRecord = await prisma.billInvoice.findUnique({
        where: { id: documentId },
        include: {
          tenant: {
            include: {
              unit: { include: { property: true } },
              billInvoices: true
            }
          },
          bill: true
        }
      });

      if (!documentRecord)
        throw new Error("Bill Invoice not found");

      tenant = documentRecord.tenant;
      break;

    case "Demand Letter":
      documentRecord = await prisma.demandLetter.findUnique({
        where: { id: documentId },
        include: {
          tenant: true,
          landlord: true,
          property: true,
          unit: true,
          invoice: true
        }
      });

      if (!documentRecord)
        throw new Error("Demand Letter not found");

      tenant = documentRecord.tenant;
      resolvedPropertyId = resolvedPropertyId || documentRecord.property?.id;
      break;

    default:
      throw new Error(`Unsupported document type: ${documentType}`);
  }

  // Get phone number with fallback - using contact field
  const contact = tenant.contact || tenant.phoneNumber || tenant.alternativePhone;
  if (!contact) {
    throw new Error(`Tenant ${tenant.id} has no valid phone number`);
  }

  const formattedPhone = formatcontactForWhatsApp(contact);

  // Generate document in memory, with retry
  let document; // { buffer, filename, mimeType }
  let retryCount = 0;

  while (retryCount < MAX_RETRIES) {
    try {
      document = await DOCUMENT_GENERATORS[documentType](documentRecord);
      console.log(`Generated ${documentType} in memory: ${document.buffer.length} bytes`);
      break;
    } catch (error) {
      retryCount++;
      if (retryCount >= MAX_RETRIES) {
        throw new Error(`Failed to generate ${documentType} after ${MAX_RETRIES} attempts: ${error.message}`);
      }
      await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS));
    }
  }

  if (!document?.buffer) {
    throw new Error(`Document generation failed for ${documentType}`);
  }

  // Upload media (in-memory buffer) with retry
  let mediaResponse;
  retryCount = 0;

  while (retryCount < MAX_RETRIES) {
    try {
      mediaResponse = await uploadMediaToWhatsApp(document);
      if (mediaResponse?.id) break;
    } catch (error) {
      if (isNonRetryableWhatsAppError(error)) {
        throw new Error(formatWhatsAppError(error));
      }
      retryCount++;
      if (retryCount >= MAX_RETRIES) {
        throw new Error(`Failed to upload media after ${MAX_RETRIES} attempts: ${error.message}`);
      }
      await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS));
    }
  }

  if (!mediaResponse?.id) {
    throw new Error('Media upload failed');
  }

  // Send message with retry
  let messageResponse;
  retryCount = 0;

  while (retryCount < MAX_RETRIES) {
    try {
      messageResponse = await sendWhatsAppMessage(
        formattedPhone,
        mediaResponse.id,
        documentType,
        tenant,
        customMessage,
        managerId
      );
      if (messageResponse?.messages?.[0]?.id) break;
    } catch (error) {
      if (isNonRetryableWhatsAppError(error)) {
        throw new Error(formatWhatsAppError(error));
      }
      retryCount++;
      if (retryCount >= MAX_RETRIES) {
        throw new Error(`Failed to send message after ${MAX_RETRIES} attempts: ${error.message}`);
      }
      await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS));
    }
  }

  if (!messageResponse?.messages?.[0]?.id) {
    throw new Error('Message sending failed');
  }

  const whatsappMessageId = messageResponse.messages[0].id;

  const log = await saveCommunicationLog({
    tenantId: tenant.id,
    propertyId: resolvedPropertyId || tenant.unit?.property?.id,
    documentType,
    recipientPhone: formattedPhone,
    whatsappMessageId,
    mediaUrl: null,
    status: "sent"
  });

  // No temp file to clean up -- nothing was ever written to disk.

  return {
    success: true,
    message: `${documentType} sent successfully to ${formattedPhone}`,
    data: {
      messageId: whatsappMessageId,
      mediaId: mediaResponse.id,
      mediaUrl: mediaResponse.url,
      logId: log.id
    }
  };
}

/**
 * Fetch a tenant with everything needed to build the combined payment
 * reports PDF. Shared by both the WhatsApp send path and the download
 * path so there is exactly ONE query shape.
 */
async function fetchTenantWithPaymentReports(tenantId) {
  if (!tenantId) {
    throw new Error("tenantId is required");
  }

  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    include: {
      unit: { include: { property: true } },
      paymentReports: {
        include: {
          invoices: { orderBy: { issueDate: 'desc' }, take: 1 }
        }
      }
    }
  });

  if (!tenant) throw new Error("Tenant not found");

  const paymentReports = tenant.paymentReports || [];
  if (paymentReports.length === 0) {
    throw new Error("This tenant has no payment reports");
  }

  return { tenant, paymentReports };
}

async function fetchTenantWithBillInvoices(tenantId) {
  if (!tenantId) throw new Error("tenantId is required");
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    include: {
      unit: { include: { property: true } },
      billInvoices: { include: { bill: true } }
    }
  });
  if (!tenant) throw new Error("Tenant not found");
  const billInvoices = tenant.billInvoices || [];
  if (billInvoices.length === 0) throw new Error("This tenant has no bill invoices");
  return { tenant, billInvoices };
}

export async function generateBillReportPdfBuffer(tenant, billInvoices) {
  const html = buildBillReportHtml(tenant, billInvoices);
  return generatePDF(html, {
    displayHeaderFooter: true,
    headerTemplate: '<div></div>',
    footerTemplate: buildBillReportFooterTemplate(),
    margin: { top: '20px', right: '20px', bottom: '70px', left: '20px' }
  });
}

export async function downloadBillReportBuffer(tenantId) {
  const { tenant, billInvoices } = await fetchTenantWithBillInvoices(tenantId);
  const buffer = await generateBillReportPdfBuffer(tenant, billInvoices);
  return { buffer, tenant };
}

export async function sendBillReportViaWhatsApp({ tenantId, customMessage, managerId }) {
  const { tenant, billInvoices } = await fetchTenantWithBillInvoices(tenantId);
  const contact = tenant.contact || tenant.phoneNumber || tenant.alternativePhone;
  if (!contact) throw new Error(`Tenant ${tenantId} has no valid phone number`);
  const formattedPhone = formatcontactForWhatsApp(contact);

  const pdfBuffer = await generateBillReportPdfBuffer(tenant, billInvoices);
  const document = { buffer: pdfBuffer, filename: "Bill_Invoices_Report.pdf", mimeType: "application/pdf" };

  const mediaResponse = await uploadMediaToWhatsApp(document);
  if (!mediaResponse?.id) throw new Error("Media upload failed");

  const caption = customMessage ||
    `Dear ${tenant.fullName ?? "Valued Tenant"},\n\nPlease find attached your bill invoices summary (${billInvoices.length} total).\n\nRegards,\nInterpark Property Management:\n0110 060 088\ninfo@interparkenterprises.co.ke\nwww.interparkenterprises.co.ke`;

  const payload = {
    messaging_product: "whatsapp",
    to: formattedPhone,
    type: "document",
    document: { id: mediaResponse.id, filename: "Bill_Invoices_Report.pdf", caption }
  };
  const response = await axios.post(`${WHATSAPP_BASE_URL}/${WHATSAPP_PHONE_ID}/messages`, payload, {
    headers: { Authorization: `Bearer ${WHATSAPP_ACCESS_TOKEN}`, "Content-Type": "application/json" }
  });
  const whatsappMessageId = response.data?.messages?.[0]?.id;
  if (!whatsappMessageId) throw new Error("Message sending failed");

  const log = await saveCommunicationLog({
    tenantId: tenant.id,
    propertyId: tenant.unit?.property?.id,
    documentType: "Bill Report",
    recipientPhone: formattedPhone,
    whatsappMessageId,
    mediaUrl: null,
    status: "sent"
  });

  return { success: true, message: `Bill report sent successfully to ${formattedPhone}`, data: { messageId: whatsappMessageId, mediaId: mediaResponse.id, logId: log.id } };
}

async function fetchTenantComprehensiveData(tenantId) {
  if (!tenantId) throw new Error("tenantId is required");
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    include: {
      unit: { include: { property: true } },
      paymentReports: true,
      invoices: true,
      billInvoices: { include: { bill: true } }
    }
  });
  if (!tenant) throw new Error("Tenant not found");
  const { paymentReports = [], invoices = [], billInvoices = [] } = tenant;
  if (paymentReports.length === 0 && invoices.length === 0 && billInvoices.length === 0) {
    throw new Error("This tenant has no records to include in a comprehensive report");
  }
  return { tenant, paymentReports, invoices, billInvoices };
}

export async function generateComprehensiveReportPdfBuffer(tenant, data) {
  const html = buildComprehensiveReportHtml(tenant, data);
  return generatePDF(html, {
    displayHeaderFooter: true,
    headerTemplate: '<div></div>',
    footerTemplate: buildComprehensiveReportFooterTemplate(),
    margin: { top: '20px', right: '20px', bottom: '70px', left: '20px' }
  });
}

export async function downloadComprehensiveReportBuffer(tenantId) {
  const { tenant, ...data } = await fetchTenantComprehensiveData(tenantId);
  const buffer = await generateComprehensiveReportPdfBuffer(tenant, data);
  return { buffer, tenant };
}

//comprehensive and bill report

export async function sendComprehensiveReportViaWhatsApp({ tenantId, customMessage, managerId }) {
  const { tenant, ...data } = await fetchTenantComprehensiveData(tenantId);
  const contact = tenant.contact || tenant.phoneNumber || tenant.alternativePhone;
  if (!contact) throw new Error(`Tenant ${tenantId} has no valid phone number`);
  const formattedPhone = formatcontactForWhatsApp(contact);

  const pdfBuffer = await generateComprehensiveReportPdfBuffer(tenant, data);
  const document = { buffer: pdfBuffer, filename: "Comprehensive_Report.pdf", mimeType: "application/pdf" };

  const mediaResponse = await uploadMediaToWhatsApp(document);
  if (!mediaResponse?.id) throw new Error("Media upload failed");

  const caption = customMessage ||
    `Dear ${tenant.fullName ?? "Valued Tenant"},\n\nPlease find attached your comprehensive account report.\n\nRegards,\nInterpark Property Management:\n0110 060 088\ninfo@interparkenterprises.co.ke\nwww.interparkenterprises.co.ke`;

  const payload = {
    messaging_product: "whatsapp",
    to: formattedPhone,
    type: "document",
    document: { id: mediaResponse.id, filename: "Comprehensive_Report.pdf", caption }
  };
  const response = await axios.post(`${WHATSAPP_BASE_URL}/${WHATSAPP_PHONE_ID}/messages`, payload, {
    headers: { Authorization: `Bearer ${WHATSAPP_ACCESS_TOKEN}`, "Content-Type": "application/json" }
  });
  const whatsappMessageId = response.data?.messages?.[0]?.id;
  if (!whatsappMessageId) throw new Error("Message sending failed");

  const log = await saveCommunicationLog({
    tenantId: tenant.id,
    propertyId: tenant.unit?.property?.id,
    documentType: "Full Report",
    recipientPhone: formattedPhone,
    whatsappMessageId,
    mediaUrl: null,
    status: "sent"
  });

  return { success: true, message: `Comprehensive report sent successfully to ${formattedPhone}`, data: { messageId: whatsappMessageId, mediaId: mediaResponse.id, logId: log.id } };
}

/**
 * Build the combined payment reports PDF buffer. Single source of truth
 * for both the WhatsApp send flow and the download flow.
 */
export async function generatePaymentReportsPdfBuffer(tenant, paymentReports) {
  const html = buildAllPaymentReportsHtml(tenant, paymentReports);
  return generatePDF(html, {
    displayHeaderFooter: true,
    headerTemplate: '<div></div>',
    footerTemplate: buildAllPaymentReportsFooterTemplate(),
    margin: { top: '20px', right: '20px', bottom: '70px', left: '20px' }
  });
}

/**
 * Generate the combined payment reports PDF for direct download.
 */
export async function downloadAllPaymentReportsBuffer(tenantId) {
  const { tenant, paymentReports } = await fetchTenantWithPaymentReports(tenantId);
  const buffer = await generatePaymentReportsPdfBuffer(tenant, paymentReports);
  return { buffer, tenant };
}

/**
 * Send ALL payment reports for a tenant as one combined WhatsApp document.
 */
export async function sendAllPaymentReportsViaWhatsApp({ tenantId, customMessage, managerId }) {
  const { tenant, paymentReports } = await fetchTenantWithPaymentReports(tenantId);

  const contact = tenant.contact || tenant.phoneNumber || tenant.alternativePhone;
  if (!contact) {
    throw new Error(`Tenant ${tenantId} has no valid phone number`);
  }
  const formattedPhone = formatcontactForWhatsApp(contact);

  // Generate the combined PDF in memory
  let pdfBuffer;
  let retryCount = 0;
  while (retryCount < MAX_RETRIES) {
    try {
      pdfBuffer = await generatePaymentReportsPdfBuffer(tenant, paymentReports);
      break;
    } catch (error) {
      retryCount++;
      if (retryCount >= MAX_RETRIES) {
        throw new Error(`Failed to generate combined payment report PDF: ${error.message}`);
      }
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
    }
  }

  const document = {
    buffer: pdfBuffer,
    filename: "Payment_Reports_Summary.pdf",
    mimeType: "application/pdf"
  };

  // Upload + send, same pattern as the rest of the service
  let mediaResponse;
  retryCount = 0;
  while (retryCount < MAX_RETRIES) {
    try {
      mediaResponse = await uploadMediaToWhatsApp(document);
      if (mediaResponse?.id) break;
    } catch (error) {
      if (isNonRetryableWhatsAppError(error)) {
        throw new Error(formatWhatsAppError(error));
      }
      retryCount++;
      if (retryCount >= MAX_RETRIES) {
        throw new Error(`Failed to upload media after ${MAX_RETRIES} attempts: ${error.message}`);
      }
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
    }
  }
  if (!mediaResponse?.id) throw new Error("Media upload failed");

  const caption =
    customMessage ||
    `Dear ${tenant.fullName ?? "Valued Tenant"},\n\nPlease find attached a summary of all your payment reports (${paymentReports.length} total).\n\nRegards,\nInterpark Property Management:\n0110 060 088\ninfo@interparkenterprises.co.ke\nwww.interparkenterprises.co.ke`;

  let messageResponse;
  retryCount = 0;
  while (retryCount < MAX_RETRIES) {
    try {
      const payload = {
        messaging_product: "whatsapp",
        to: formattedPhone,
        type: "document",
        document: {
          id: mediaResponse.id,
          filename: "Payment_Reports_Summary.pdf",
          caption
        }
      };
      const response = await axios.post(
        `${WHATSAPP_BASE_URL}/${WHATSAPP_PHONE_ID}/messages`,
        payload,
        {
          headers: {
            Authorization: `Bearer ${WHATSAPP_ACCESS_TOKEN}`,
            "Content-Type": "application/json"
          }
        }
      );
      messageResponse = response.data;
      if (messageResponse?.messages?.[0]?.id) break;
    } catch (error) {
      if (isNonRetryableWhatsAppError(error)) {
        throw new Error(formatWhatsAppError(error));
      }
      retryCount++;
      if (retryCount >= MAX_RETRIES) {
        throw new Error(formatWhatsAppError(error));
      }
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
    }
  }
  if (!messageResponse?.messages?.[0]?.id) throw new Error("Message sending failed");

  const whatsappMessageId = messageResponse.messages[0].id;

  const log = await saveCommunicationLog({
    tenantId: tenant.id,
    propertyId: tenant.unit?.property?.id,
    documentType: "All Payment Reports",
    recipientPhone: formattedPhone,
    whatsappMessageId,
    mediaUrl: null,
    status: "sent"
  });

  return {
    success: true,
    message: `Payment reports summary sent successfully to ${formattedPhone}`,
    data: {
      messageId: whatsappMessageId,
      mediaId: mediaResponse.id,
      logId: log.id
    }
  };
}

/**
 * Send documents in bulk
 */
export async function sendBulkDocuments(sendOptionsArray) {
  const results = { success: [], failed: [] };

  const concurrencyLimit = 5;
  const batchSize = Math.ceil(sendOptionsArray.length / concurrencyLimit);

  for (let i = 0; i < sendOptionsArray.length; i += batchSize) {
    const batch = sendOptionsArray.slice(i, i + batchSize);

    const batchPromises = batch.map(async (options) => {
      try {
        const result = await sendDocumentViaWhatsApp(options);
        return { ...result, tenantId: options.tenantId, documentType: options.documentType };
      } catch (error) {
        return {
          success: false,
          message: error.message,
          tenantId: options.tenantId,
          documentType: options.documentType,
          error: error.stack
        };
      }
    });

    const batchResults = await Promise.all(batchPromises);

    batchResults.forEach(result => {
      if (result.success) {
        results.success.push(result);
      } else {
        results.failed.push(result);
      }
    });

    if (i + batchSize < sendOptionsArray.length) {
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }

  return {
    total: sendOptionsArray.length,
    successCount: results.success.length,
    failedCount: results.failed.length,
    results
  };
}

/**
 * Get send status for a tenant's documents
 */
export async function getDocumentSendStatus(tenantId) {
  const documentTypes = [...Object.keys(DOCUMENT_GENERATORS), "All Payment Reports", "Bill Report", "Full Report"];

  const statuses = await Promise.all(
    documentTypes.map(async (docType) => {
      const log = await prisma.whatsAppLog.findFirst({
        where: { tenantId, documentType: docType },
        orderBy: { sentAt: 'desc' }
      });

      return {
        documentType: docType,
        lastSent: log?.sentAt || null,
        status: log?.status || 'never_sent',
        whatsappMessageId: log?.whatsappMessageId || null,
        sentBy: log?.sentBy || null
      };
    })
  );

  return statuses;
}

/**
 * Format phone number for WhatsApp API (Kenya +254)
 */
export function formatcontactForWhatsApp(contact) {
  if (!contact) return null;

  const digits = contact.replace(/\D/g, '');
  let formatted = digits.startsWith('0') ? digits.substring(1) : digits;

  if (!formatted.startsWith('254')) {
    formatted = `254${formatted}`;
  }

  return formatted;
}

export function verifyWebhookSignature(req) {
  if (!WHATSAPP_APP_SECRET) {
    console.warn('WHATSAPP_APP_SECRET not set — skipping signature verification (not safe for production).');
    return true;
  }
  const signatureHeader = req.get('X-Hub-Signature-256');
  if (!signatureHeader || !req.rawBody) return false;

  const expectedHash = crypto
    .createHmac('sha256', WHATSAPP_APP_SECRET)
    .update(req.rawBody)
    .digest('hex');
  const expectedSignature = `sha256=${expectedHash}`;

  const a = Buffer.from(signatureHeader);
  const b = Buffer.from(expectedSignature);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/**
 * Distinguish permanent WhatsApp API errors (bad auth, invalid recipient,
 * malformed request) from transient ones (network blip, rate limit).
 * Retrying an OAuth failure 70 times just wastes ~2 minutes per send for
 * an error that will never resolve itself.
 */
function isNonRetryableWhatsAppError(error) {
  const code = error?.response?.data?.error?.code;
  // 190 = invalid/expired access token, 100 = invalid parameter,
  // 131030/131031 = recipient not in allowed list / opted out
  return [190, 100, 131030, 131031].includes(code);
}

function formatWhatsAppError(error) {
  const metaError = error?.response?.data?.error;
  return metaError?.message || error.message || 'WhatsApp request failed';
}

/**
 * Upload media to WhatsApp Cloud API directly from an in-memory buffer --
 * no temp file, no disk I/O.
 */
async function uploadMediaToWhatsApp(document) {
  const form = new FormData();

  const stream = new Readable();
  stream.push(document.buffer);
  stream.push(null); // signals end-of-stream

  form.append('file', stream, {
    filename: document.filename,
    contentType: document.mimeType,
    knownLength: document.buffer.length
  });
  form.append('messaging_product', 'whatsapp');

  try {
    const response = await axios.post(
      `${WHATSAPP_BASE_URL}/${WHATSAPP_PHONE_ID}/media`,
      form,
      {
        headers: {
          ...form.getHeaders(),
          'Authorization': `Bearer ${WHATSAPP_ACCESS_TOKEN}`
        },
        maxContentLength: Infinity,
        maxBodyLength: Infinity
      }
    );
    return response.data;
  } catch (error) {
    console.error('Media upload error:', error.response?.data || error.message);
    throw error;
  }
}
/**
 * Send WhatsApp message with media
 */
async function sendWhatsAppMessage(
  recipientPhone,
  mediaId,
  documentType,
  tenant,
  customMessage = null,
  managerId = null
) {
  const caption = customMessage || generateCaption(documentType, tenant, managerId);

  const payload = {
    messaging_product: "whatsapp",
    to: recipientPhone,
    type: "document",
    document: {
      id: mediaId,
      filename: `${documentType.replace(/\s+/g, "_")}.pdf`,
      caption
    }
  };

  try {
    const response = await axios.post(
      `${WHATSAPP_BASE_URL}/${WHATSAPP_PHONE_ID}/messages`,
      payload,
      {
        headers: {
          'Authorization': `Bearer ${WHATSAPP_ACCESS_TOKEN}`,
          'Content-Type': 'application/json'
        }
      }
    );
    return response.data;
  } catch (error) {
    console.error('WhatsApp API error:', error.response?.data?.error || error.message);
    throw error;
  }
}

/**
 * Generate WhatsApp message caption
 */
function generateCaption(documentType, tenant, managerId = null) {
  const tenantName = tenant.fullName || tenant.name || tenant.companyName || 'Valued Tenant';
  const propertyName = tenant.property?.name || tenant.unit?.property?.name || 'Interpark Property';
  const date = new Date().toLocaleDateString('en-KE', {
    day: '2-digit',
    month: 'long',
    year: 'numeric'
  });

  const captions = {
    'Invoice': `Dear ${tenantName},\n\nPlease find your Invoice for ${propertyName}.\n\nAmount: Ksh ${(tenant.rent || 0).toLocaleString()}\nDue Date: ${date}\n\nRegards,\nInterpark Property Management:\n0110 060 088\ninfo@interparkenterprises.co.ke\nwww.interparkenterprises.co.ke`,
    'Demand Letter': `Dear ${tenantName},\n\nPlease find the Demand Letter regarding your tenancy at ${propertyName}.\n\nDate: ${date}\n\nPlease attend to this matter urgently.\n\nRegards,\nInterpark Property Management:\n0110 060 088\ninfo@interparkenterprises.co.ke\nwww.interparkenterprises.co.ke`,
    'Bill Invoices': `Dear ${tenantName},\n\nPlease find your Bill Invoices for ${propertyName}.\n\nDate: ${date}\n\nRegards,\nInterpark Property Management:\n0110 060 088\ninfo@interparkenterprises.co.ke\nwww.interparkenterprises.co.ke`
  };

  return captions[documentType] || `Document: ${documentType}`;
}

/**
 * Save communication log to database
 */
async function saveCommunicationLog(logData) {
  return await prisma.whatsAppLog.create({
    data: {
      tenantId: logData.tenantId,
      propertyId: logData.propertyId,
      documentType: logData.documentType,
      recipientPhone: logData.recipientPhone,
      whatsappMessageId: logData.whatsappMessageId,
      mediaUrl: logData.mediaUrl ?? null,
      status: logData.status,
      errorMessage: logData.errorMessage ?? null,
      sentAt: new Date()
    }
  });
}

/**
 * Handle incoming WhatsApp webhook
 */
export async function handleWebhook(payload) {
  try {
    const data = payload.body;

    if (data?.entry) {
      for (const entry of data.entry) {
        for (const change of entry.changes) {
          const value = change.value;
          if (value.statuses?.length) {
            await processStatusUpdates(value);
          }
        }
      }
    }

    return { status: 'processed' };
  } catch (error) {
    console.error('Webhook handling error:', error);
    return { status: 'error', message: error.message };
  }
}

/**
 * Process status updates from webhook
 */
async function processStatusUpdates(value) {
  for (const status of value.statuses) {
    const { id: messageId, status: statusType, timestamp } = status;

    const updateData = {
      status: statusType,
      updatedAt: new Date(Number(timestamp) * 1000)
    };

    if (statusType === 'failed') {
      const error = status.errors?.[0];
      updateData.errorMessage = error
        ? `[${error.code}] ${error.title}${error.error_data?.details ? ' - ' + error.error_data.details : ''}`
        : 'Unknown WhatsApp delivery failure';
    }

    const result = await prisma.whatsAppLog.updateMany({
      where: { whatsappMessageId: messageId },
      data: updateData
    });

    if (result.count === 0) {
      console.warn(`No WhatsAppLog found for message ${messageId} (status: ${statusType})`);
    } else {
      console.log(`Message ${messageId} -> ${statusType}`);
    }
  }
}

/**
 * Get WhatsApp communication logs with filters
 */
export async function getCommunicationLogs(filters = {}) {
  const {
    tenantId, propertyId, documentType, startDate, endDate,
    status, managerId, limit = 100, page = 1
  } = filters;

  const where = {};
  if (tenantId) where.tenantId = tenantId;
  if (propertyId) where.propertyId = propertyId;
  if (documentType) where.documentType = documentType;
  if (managerId) where.managerId = managerId;
  if (status) where.status = status;

  if (startDate || endDate) {
    where.sentAt = {};
    if (startDate) where.sentAt.gte = new Date(startDate);
    if (endDate) where.sentAt.lte = new Date(endDate);
  }

  const [logs, total] = await Promise.all([
    prisma.whatsAppLog.findMany({
      where,
      include: {
        tenant: { select: { id: true, fullName: true, contact: true, email: true } },
        property: { select: { id: true, name: true } }
      },
      orderBy: { sentAt: 'desc' },
      take: parseInt(limit),
      skip: (parseInt(page) - 1) * parseInt(limit)
    }),
    prisma.whatsAppLog.count({ where })
  ]);

  return {
    data: logs,
    pagination: {
      page: parseInt(page),
      limit: parseInt(limit),
      total,
      totalPages: Math.ceil(total / parseInt(limit))
    }
  };
}

// ============================================
// DOCUMENT GENERATORS -- all return { buffer, filename, mimeType }
// ============================================

async function generateInvoice(invoice) {
  try {
    const { buildInvoiceFooterTemplate } = await import("./pdf/invoicePdf.js");
    const html = buildInvoiceHtml(invoice);
    const buffer = await generatePDF(html, {
      displayHeaderFooter: true,
      headerTemplate: '<div></div>',
      footerTemplate: buildInvoiceFooterTemplate(),
      margin: { top: '20px', right: '20px', bottom: '55px', left: '20px' }
    });
    return {
      buffer,
      filename: `invoice_${invoice.invoiceNumber || invoice.id}.pdf`,
      mimeType: "application/pdf"
    };
  } catch (error) {
    console.error("Invoice generation error:", error);
    throw new Error(`Failed to generate Invoice: ${error.message}`);
  }
}

async function generateDemandLetter(demandLetter) {
  try {
    const html = buildDemandLetterHtml(demandLetter);
    const buffer = await generatePDF(html, {
      displayHeaderFooter: true,
      headerTemplate: '<div></div>',
      footerTemplate: buildDemandLetterFooterTemplate(demandLetter),
      margin: { top: '20px', right: '20px', bottom: '60px', left: '20px' }
    });
    return {
      buffer,
      filename: `demand_letter_${demandLetter.letterNumber || demandLetter.id}.pdf`,
      mimeType: "application/pdf"
    };
  } catch (error) {
    console.error("Demand Letter generation error:", error);
    throw new Error(`Failed to generate Demand Letter: ${error.message}`);
  }
}

async function generateBillInvoice(billInvoice) {
  try {
    const { buildBillInvoiceHtml, buildBillInvoiceFooterTemplate } = await import("../services/pdf/billInvoicePdf.js");
    const html = buildBillInvoiceHtml(billInvoice);
    const buffer = await generatePDF(html, {
      displayHeaderFooter: true,
      headerTemplate: '<div></div>',
      footerTemplate: buildBillInvoiceFooterTemplate(),
      margin: { top: '20px', right: '20px', bottom: '55px', left: '20px' }
    });
    return {
      buffer,
      filename: `bill_invoice_${billInvoice.invoiceNumber || billInvoice.id}.pdf`,
      mimeType: "application/pdf"
    };
  } catch (error) {
    console.error("Bill Invoice generation error:", error);
    throw new Error(`Failed to generate Bill Invoice: ${error.message}`);
  }
}