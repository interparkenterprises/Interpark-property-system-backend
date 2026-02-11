import PDFDocument from 'pdfkit';
import fs from 'fs';
import path from 'path';
import sizeOf from 'image-size';
import { fileURLToPath } from 'url';

// Create __dirname equivalent for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Generate PDF receipt with letterhead and proper footer
 * @param {Object} data - Receipt data
 * @returns {Buffer} PDF buffer
 */
export async function generateReceiptPDF(data) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ 
        margin: 50,
        size: 'A4',
        bufferPages: true // Enable bufferPages for footer positioning
      });
      const chunks = [];

      doc.on('data', (chunk) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      /* =====================================================
         LETTERHEAD IMAGE HANDLING
      ====================================================== */

      const projectRoot = process.cwd();
      const possiblePaths = [
        path.join(projectRoot, 'src', 'letterHeads', 'letterhead.png'),
        path.join(projectRoot, 'letterHeads', 'letterhead.png'),
        path.join(__dirname, 'letterHeads', 'letterhead.png'),
        path.join(__dirname, '..', 'letterHeads', 'letterhead.png'),
        path.join(__dirname, '..', 'src', 'letterHeads', 'letterhead.png'),
      ];

      let letterheadPath = null;
      let imageLoaded = false;
      let letterheadHeight = 0;
      
      for (const possiblePath of possiblePaths) {
        try {
          if (fs.existsSync(possiblePath)) {
            const stats = fs.statSync(possiblePath);
            if (stats.size > 0) {
              letterheadPath = possiblePath;
              console.log(`✓ Letterhead found: ${possiblePath}`);
              break;
            }
          }
        } catch (err) {
          console.warn(`Path check failed for ${possiblePath}:`, err.message);
        }
      }

      if (letterheadPath) {
        try {
          const imageBuffer = fs.readFileSync(letterheadPath);
          const dimensions = sizeOf(imageBuffer);

          const maxWidth = doc.page.width - 100;
          const scale = maxWidth / dimensions.width;
          const scaledHeight = dimensions.height * scale;
          const finalHeight = Math.min(scaledHeight, 80);
          const finalWidth = finalHeight !== scaledHeight
            ? (dimensions.width * finalHeight) / dimensions.height
            : maxWidth;

          const xPosition = 50 + (maxWidth - finalWidth) / 2;

          doc.image(imageBuffer, xPosition, 30, {
            width: finalWidth,
          });

          letterheadHeight = 30 + finalHeight + 20;
          doc.y = letterheadHeight;
          imageLoaded = true;

          console.log('✓ Letterhead rendered');
        } catch (err) {
          console.warn('✗ Letterhead failed to load:', err.message);
        }
      }
      
      // Fallback if no image loaded
      if (!imageLoaded) {
        console.warn('Using fallback text header');
        doc.y = 40;
        doc.fontSize(16)
          .fillColor('#005478')
          .font('Helvetica-Bold')
          .text('INTERPARK ENTERPRISES LIMITED', { 
            align: 'center'
          });
        doc.moveDown(0.5);
        letterheadHeight = doc.y;
      }

      // ===========================================
      // HELPER FUNCTIONS
      // ===========================================
      
      const formatDate = (date) => {
        if (!date) return 'N/A';
        const d = new Date(date);
        return d.toLocaleDateString('en-US', {
          year: 'numeric',
          month: 'long',
          day: 'numeric'
        });
      };

      const formatCurrency = (amount) => {
        if (!amount || amount === 0) return 'Ksh 0.00';
        return `Ksh ${parseFloat(amount).toLocaleString('en-US', {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2
        })}`;
      };

      const {
        receiptNumber,
        paymentDate,
        tenantName,
        tenantContact,
        propertyName,
        unitType,
        unitNo,
        paymentPeriod,
        paymentMethod = 'Bank Transfer',
        amountPaid,
        invoicesPaid = [],
        overpaymentAmount = 0,
        creditUsed = 0,
        totalAllocated = 0,
        paymentReportId,
        notes
      } = data;

      // ===========================================
      // RECEIPT TITLE
      // ===========================================
      
      doc.fontSize(14)
         .fillColor('#005478')
         .font('Helvetica-Bold')
         .text('PAYMENT RECEIPT', { align: 'center' });
      
      doc.moveDown(0.3);

      // Blue line under title
      const titleY = doc.y;
      doc.moveTo(50, titleY).lineTo(doc.page.width - 50, titleY).stroke('#005478');
      doc.moveDown(0.5);

      // ===========================================
      // RECEIPT META (Receipt Number & Date)
      // ===========================================
      
      const metaY = doc.y;
      
      // Left: Receipt Number
      doc.fontSize(9)
         .fillColor('#64748b')
         .font('Helvetica')
         .text('RECEIPT NUMBER', 50, metaY);
      
      doc.fontSize(12)
         .fillColor('#005478')
         .font('Helvetica-Bold')
         .text(receiptNumber, 50, metaY + 12);
      
      // Right: Payment Date
      doc.fontSize(9)
         .fillColor('#64748b')
         .font('Helvetica')
         .text('PAYMENT DATE', doc.page.width - 150, metaY, { align: 'right', width: 100 });
      
      doc.fontSize(12)
         .fillColor('#1e293b')
         .font('Helvetica-Bold')
         .text(formatDate(paymentDate), doc.page.width - 150, metaY + 12, { align: 'right', width: 100 });
      
      doc.y = metaY + 35;
      doc.moveDown(0.5);

      // ===========================================
      // TWO COLUMN LAYOUT: TENANT & PAYMENT INFO
      // ===========================================
      
      const colWidth = (doc.page.width - 120) / 2;
      const leftCol = 50;
      const rightCol = 50 + colWidth + 20;
      let leftY = doc.y;
      let rightY = doc.y;

      // --- LEFT COLUMN: Tenant Information ---
      
      doc.fontSize(11)
         .fillColor('#1e293b')
         .font('Helvetica-Bold')
         .text('Tenant Information', leftCol, leftY);
      
      leftY += 18;
      
      // Helper for info rows
      const drawInfoRow = (label, value, x, y, width) => {
        doc.fontSize(8)
           .fillColor('#64748b')
           .font('Helvetica')
           .text(label, x, y);
        
        doc.fontSize(10)
           .fillColor('#1e293b')
           .font('Helvetica-Bold')
           .text(value || 'N/A', x, y + 10, { width: width });
        
        return y + 28;
      };

      leftY = drawInfoRow('Tenant Name', tenantName, leftCol, leftY, colWidth);
      leftY = drawInfoRow('Contact', tenantContact, leftCol, leftY, colWidth);
      leftY = drawInfoRow('Property', propertyName, leftCol, leftY, colWidth);
      leftY = drawInfoRow('Unit', `${unitType}${unitNo ? ' - ' + unitNo : ''}`, leftCol, leftY, colWidth);

      // --- RIGHT COLUMN: Payment Details ---
      
      doc.fontSize(11)
         .fillColor('#1e293b')
         .font('Helvetica-Bold')
         .text('Payment Details', rightCol, rightY);
      
      rightY += 18;
      
      rightY = drawInfoRow('Payment Period', paymentPeriod, rightCol, rightY, colWidth);
      rightY = drawInfoRow('Payment Method', paymentMethod, rightCol, rightY, colWidth);
      
      if (creditUsed > 0) {
        rightY = drawInfoRow('Credit Applied', `-${formatCurrency(creditUsed)}`, rightCol, rightY, colWidth);
      }
      
      if (overpaymentAmount > 0) {
        rightY = drawInfoRow('Overpayment', formatCurrency(overpaymentAmount), rightCol, rightY, colWidth);
      }

      // Update Y to the lower of the two columns
      doc.y = Math.max(leftY, rightY) + 15;

      // ===========================================
      // INVOICES PAID TABLE (SIMPLIFIED)
      // ===========================================
      
      if (invoicesPaid.length > 0) {
        // Check if we need new page (shouldn't happen on single page receipt, but safety check)
        if (doc.y > doc.page.height - 250) {
          doc.addPage();
          doc.y = 50;
        }

        doc.fontSize(11)
           .fillColor('#1e293b')
           .font('Helvetica-Bold')
           .text('Invoices Paid', 50, doc.y);
        
        doc.moveDown(0.3);

        const tableTop = doc.y;
        const tableWidth = doc.page.width - 100;
        const colWidths = [tableWidth * 0.30, tableWidth * 0.25, tableWidth * 0.25, tableWidth * 0.20];
        
        // Table Header
        doc.fillColor('#ffffff')
           .fill('#005478');
        
        doc.rect(50, tableTop, tableWidth, 20).fill('#005478');
        
        let xPos = 50;
        const headers = ['Amount', 'Total Paid', 'Balance', 'Status'];
        
        doc.fontSize(8)
           .fillColor('#ffffff')
           .font('Helvetica-Bold');
        
        headers.forEach((header, i) => {
          doc.text(header, xPos + 3, tableTop + 6, { width: colWidths[i] - 6, align: 'left' });
          xPos += colWidths[i];
        });

        // Table Rows
        let rowY = tableTop + 20;
        
        invoicesPaid.forEach((inv, index) => {
          // Alternate row colors
          if (index % 2 === 0) {
            doc.fillColor('#f8fafc').rect(50, rowY, tableWidth, 18).fill();
          }
          
          // Status color coding - only PARTIAL or PAID
          let statusColor = '#1e293b';
          if (inv.newStatus === 'PAID') statusColor = '#166534';
          if (inv.newStatus === 'PARTIAL') statusColor = '#92400e';
          
          xPos = 50;
          
          // Amount (original total due)
          doc.fontSize(9)
             .fillColor('#1e293b')
             .font('Helvetica')
             .text(formatCurrency(inv.previousBalance + (inv.paymentApplied || 0)), xPos + 3, rowY + 4, { width: colWidths[0] - 6 });
          xPos += colWidths[0];
          
          // Total Paid
          doc.text(formatCurrency(inv.newAmountPaid || inv.amountPaid || 0), xPos + 3, rowY + 4, { width: colWidths[1] - 6 });
          xPos += colWidths[1];
          
          // Balance
          doc.text(formatCurrency(inv.newBalance), xPos + 3, rowY + 4, { width: colWidths[2] - 6 });
          xPos += colWidths[2];
          
          // Status (only PARTIAL or PAID)
          doc.fillColor(statusColor).font('Helvetica-Bold');
          doc.text(inv.newStatus, xPos + 3, rowY + 4, { width: colWidths[3] - 6 });
          
          rowY += 18;
        });

        // Table border
        doc.rect(50, tableTop, tableWidth, rowY - tableTop).stroke('#e2e8f0');
        
        // Vertical lines
        xPos = 50;
        colWidths.forEach((width) => {
          xPos += width;
          doc.moveTo(xPos, tableTop).lineTo(xPos, rowY).stroke('#e2e8f0');
        });

        doc.y = rowY + 15;
      }

      // ===========================================
      // SUMMARY BOX
      // ===========================================
      
      const summaryY = doc.y;
      const summaryWidth = 250;
      const summaryX = doc.page.width - 50 - summaryWidth;
      
      // Background
      doc.fillColor('#f8fafc').rect(summaryX, summaryY, summaryWidth, creditUsed > 0 ? 70 : 45).fill();
      doc.rect(summaryX, summaryY, summaryWidth, creditUsed > 0 ? 70 : 45).stroke('#e2e8f0');
      
      let lineY = summaryY + 8;
      
      if (creditUsed > 0) {
        doc.fontSize(9)
           .fillColor('#475569')
           .font('Helvetica')
           .text('Cash Payment', summaryX + 10, lineY);
        
        doc.fontSize(10)
           .fillColor('#1e293b')
           .font('Helvetica-Bold')
           .text(formatCurrency(amountPaid), summaryX + summaryWidth - 10, lineY, { align: 'right' });
        
        lineY += 18;
        
        doc.fontSize(9)
           .fillColor('#475569')
           .font('Helvetica')
           .text('Credit Applied', summaryX + 10, lineY);
        
        doc.fontSize(10)
           .fillColor('#10b981')
           .font('Helvetica-Bold')
           .text(`-${formatCurrency(creditUsed)}`, summaryX + summaryWidth - 10, lineY, { align: 'right' });
        
        lineY += 18;
      }
      
      // Total line with top border
      doc.moveTo(summaryX + 10, lineY).lineTo(summaryX + summaryWidth - 10, lineY).stroke('#005478');
      lineY += 6;
      
      doc.fontSize(11)
         .fillColor('#005478')
         .font('Helvetica-Bold')
         .text('Total Amount Received', summaryX + 10, lineY);
      
      doc.fontSize(12)
         .fillColor('#005478')
         .font('Helvetica-Bold')
         .text(formatCurrency(totalAllocated || amountPaid), summaryX + summaryWidth - 10, lineY, { align: 'right' });

      doc.y = Math.max(doc.y, summaryY + (creditUsed > 0 ? 75 : 50));

      // ===========================================
      // NOTES SECTION (if provided)
      // ===========================================
      
      if (notes) {
        doc.moveDown(0.5);
        
        doc.fontSize(10)
           .fillColor('#1e293b')
           .font('Helvetica-Bold')
           .text('Notes:', 50, doc.y);
        
        doc.moveDown(0.2);
        
        doc.fontSize(9)
           .fillColor('#475569')
           .font('Helvetica')
           .text(notes, 50, doc.y, { width: doc.page.width - 100 });
        
        doc.moveDown(0.5);
      }

      // ===========================================
      // FIXED FOOTER - Positioned absolutely at bottom
      // ===========================================
      
      const footerY = doc.page.height - 80;
      
      // Footer line
      doc.moveTo(50, footerY - 10).lineTo(doc.page.width - 50, footerY - 10).stroke('#e2e8f0');
      
      // Thank you text
      doc.fontSize(12)
         .fillColor('#005478')
         .font('Helvetica-Bold')
         .text('Thank you for your payment!', 50, footerY, { align: 'center' });
      
      doc.fontSize(9)
         .fillColor('#64748b')
         .font('Helvetica')
         .text('This is an official receipt for your records.', 50, footerY + 16, { align: 'center' });
      
      // Company info
      doc.fontSize(8)
         .fillColor('#94a3b8')
         .font('Helvetica')
         .text('Interpark Enterprises Limited', 50, footerY + 32, { align: 'center' });
      
      doc.fontSize(8)
         .fillColor('#94a3b8')
         .font('Helvetica')
         .text('For any inquiries regarding this receipt, please contact us', 50, footerY + 44, { align: 'center' });
      
      doc.fontSize(8)
         .fillColor('#94a3b8')
         .font('Helvetica')
         .text('Tel: 0110 060 088 | Email: info@interparkenterprises.co.ke', 50, footerY + 54, { align: 'center' });

      // End document
      doc.end();
      
    } catch (error) {
      console.error('Receipt PDF Generation Error:', error);
      reject(error);
    }
  });
}

/**
 * Legacy HTML template for email/backup purposes
 * @param {Object} data - Receipt data
 * @returns {string} HTML content
 */
export const generateReceiptHTML = (data) => {
  // Keep the HTML version for email purposes if needed
  const {
    receiptNumber,
    paymentDate,
    tenantName,
    tenantContact,
    propertyName,
    unitType,
    unitNo,
    paymentPeriod,
    paymentMethod = 'Bank Transfer',
    amountPaid,
    invoicesPaid = [],
    overpaymentAmount = 0,
    creditUsed = 0,
    totalAllocated = 0,
    paymentReportId,
    notes
  } = data;

  const formatCurrency = (amount) => {
    return `Ksh ${parseFloat(amount).toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    })}`;
  };

  const formatDate = (date) => {
    return new Date(date).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
  };

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Payment Receipt - ${receiptNumber}</title>
  <style>
    body { font-family: Arial, sans-serif; margin: 40px; color: #333; }
    .header { text-align: center; border-bottom: 2px solid #005478; padding-bottom: 20px; margin-bottom: 30px; }
    .company { font-size: 24px; font-weight: bold; color: #005478; }
    .title { font-size: 18px; color: #005478; margin-top: 10px; }
    .meta { display: flex; justify-content: space-between; margin: 20px 0; }
    .section { margin: 20px 0; }
    .section-title { font-weight: bold; color: #1e293b; margin-bottom: 10px; }
    table { width: 100%; border-collapse: collapse; margin: 15px 0; }
    th { background: #005478; color: white; padding: 8px; text-align: left; }
    td { padding: 8px; border-bottom: 1px solid #ddd; }
    .total { text-align: right; font-weight: bold; color: #005478; }
    .footer { margin-top: 40px; text-align: center; border-top: 1px solid #ddd; padding-top: 20px; }
    .status-paid { color: #166534; font-weight: bold; }
    .status-partial { color: #92400e; font-weight: bold; }
  </style>
</head>
<body>
  <div class="header">
    <div class="company">Interpark Enterprises Limited</div>
    <div class="title">PAYMENT RECEIPT</div>
  </div>
  
  <div class="meta">
    <div>
      <small>RECEIPT NUMBER</small><br>
      <strong>${receiptNumber}</strong>
    </div>
    <div style="text-align: right;">
      <small>PAYMENT DATE</small><br>
      <strong>${formatDate(paymentDate)}</strong>
    </div>
  </div>

  <div style="display: flex; gap: 40px;">
    <div style="flex: 1;">
      <div class="section-title">Tenant Information</div>
      <p><strong>${tenantName}</strong><br>
      ${tenantContact || 'N/A'}<br>
      ${propertyName}<br>
      ${unitType}${unitNo ? ' - ' + unitNo : ''}</p>
    </div>
    <div style="flex: 1;">
      <div class="section-title">Payment Details</div>
      <p>Period: ${paymentPeriod}<br>
      Method: ${paymentMethod}<br>
      ${creditUsed > 0 ? `Credit Applied: -${formatCurrency(creditUsed)}<br>` : ''}
      ${overpaymentAmount > 0 ? `Overpayment: ${formatCurrency(overpaymentAmount)}<br>` : ''}</p>
    </div>
  </div>

  ${invoicesPaid.length > 0 ? `
  <div class="section">
    <div class="section-title">Invoices Paid</div>
    <table>
      <tr>
        <th>Amount</th>
        <th>Total Paid</th>
        <th>Balance</th>
        <th>Status</th>
      </tr>
      ${invoicesPaid.map(inv => {
        const originalAmount = inv.previousBalance + (inv.paymentApplied || 0);
        const statusClass = inv.newStatus === 'PAID' ? 'status-paid' : 'status-partial';
        return `
        <tr>
          <td>${formatCurrency(originalAmount)}</td>
          <td>${formatCurrency(inv.newAmountPaid || inv.amountPaid || 0)}</td>
          <td>${formatCurrency(inv.newBalance)}</td>
          <td class="${statusClass}">${inv.newStatus}</td>
        </tr>
      `}).join('')}
    </table>
  </div>
  ` : ''}

  <div class="total">
    Total Amount Received: ${formatCurrency(totalAllocated || amountPaid)}
  </div>

  ${notes ? `<div class="section"><div class="section-title">Notes</div><p>${notes}</p></div>` : ''}

  <div class="footer">
    <h3>Thank you for your payment!</h3>
    <p>This is an official receipt for your records.</p>
    <p><small>Interpark Enterprises Limited<br>
    Tel: 0110 060 088 | Email: info@interparkenterprises.co.ke</small></p>
  </div>
</body>
</html>
  `;
};