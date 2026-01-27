import prisma from '../lib/prisma.js';

export async function generateCommissionInvoiceNumber() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');

  const prefix = `COM-INV-${year}${month}-`;

  const last = await prisma.commissionInvoice.findFirst({
    where: {
      invoiceNumber: { startsWith: prefix }
    },
    orderBy: { invoiceNumber: 'desc' }
  });

  let sequence = 1;
  if (last) {
    const lastSequence = parseInt(last.invoiceNumber.split('-').pop(), 10);
    sequence = Number.isFinite(lastSequence) ? lastSequence + 1 : 1;
  }

  const sequenceStr = String(sequence).padStart(6, '0');
  return `${prefix}${sequenceStr}`;
}