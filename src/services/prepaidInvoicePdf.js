import prisma from '../lib/prisma.js';
import { generatePDF } from '../utils/pdfGenerator.js';
import { uploadToStorage } from '../utils/storage.js';
import { buildInvoiceHtml, buildInvoiceFooterTemplate } from './pdf/invoicePdf.js';

export async function attachInvoicePdf(invoiceId) {
  const invoice = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    include: {
      tenant: { include: { unit: { include: { property: true } }, serviceCharge: true } },
      paymentReport: true
    }
  });
  if (!invoice) return null;

  const pdfBuffer = await generatePDF(buildInvoiceHtml(invoice), {
    displayHeaderFooter: true,
    headerTemplate: '<div></div>',
    footerTemplate: buildInvoiceFooterTemplate(),
    margin: { top: '20px', right: '20px', bottom: '55px', left: '20px' }
  });

  const pdfUrl = await uploadToStorage(pdfBuffer, `${invoice.invoiceNumber}.pdf`);
  await prisma.invoice.update({ where: { id: invoice.id }, data: { pdfUrl } });
  return pdfUrl;
}

export default { attachInvoicePdf };
