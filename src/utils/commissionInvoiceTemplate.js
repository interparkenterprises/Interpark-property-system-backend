import fs from 'fs';
import path from 'path';
import sizeOf from 'image-size';
import { fileURLToPath } from 'url';

// Create __dirname equivalent for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Get letterhead image path and load it with dimensions
 */
function getLetterheadPath() {
  const projectRoot = process.cwd();
  const possiblePaths = [
    path.join(projectRoot, 'src', 'letterHeads', 'letterhead.png'),
    path.join(projectRoot, 'letterHeads', 'letterhead.png'),
    path.join(__dirname, 'letterHeads', 'letterhead.png'),
    path.join(__dirname, '..', 'letterHeads', 'letterhead.png'),
    path.join(__dirname, '..', 'src', 'letterHeads', 'letterhead.png'),
    '/root/Interpark-property-system-backend/src/letterHeads/letterhead.png',
    '/home/ubuntu/Interpark-property-system-backend/src/letterHeads/letterhead.png',
    '/var/www/Interpark-property-system-backend/src/letterHeads/letterhead.png',
  ];

  for (const possiblePath of possiblePaths) {
    try {
      if (fs.existsSync(possiblePath)) {
        const stats = fs.statSync(possiblePath);
        if (stats.size > 0) {
          console.log(`✓ Commission Invoice: Letterhead found: ${possiblePath}`);
          
          // Read the file as a buffer FIRST
          const imageBuffer = fs.readFileSync(possiblePath);
          
          // Now get dimensions from the buffer
          const dimensions = sizeOf(imageBuffer);
          
          return {
            path: possiblePath,
            buffer: imageBuffer,
            width: dimensions.width,
            height: dimensions.height
          };
        }
      }
    } catch (err) {
      console.warn(`✗ Path check failed for ${possiblePath}:`, err.message);
    }
  }
  
  console.warn('✗ Commission Invoice: Letterhead not found, using text header');
  return null;
}

/**
 * Generate HTML for commission invoice with letterhead (base64 encoded)
 */
export function commissionInvoiceHTML(data) {
  const {
    propertyName,
    lrNumber,
    invoiceDateText,
    invoiceNumber,
    refText,
    landlordName,
    landlordAddress,
    description,
    collectionAmount,
    commissionRate, // This should be decimal (e.g., 0.085 for 8.5%)
    commissionAmount,
    vatAmount,
    totalAmount,
    bankName,
    accountName,
    accountNumber,
    branch,
    bankCode,
    swiftCode,
    currency
  } = data;

  // Get letterhead path and dimensions
  const letterheadInfo = getLetterheadPath();
  
  // Convert image to base64 if letterhead exists
  let letterheadBase64 = '';
  if (letterheadInfo && letterheadInfo.buffer) {
    letterheadBase64 = `data:image/png;base64,${letterheadInfo.buffer.toString('base64')}`;
  }
  
  // Convert decimal commission rate to percentage with one decimal place
  const commissionRatePercent = (commissionRate * 100).toFixed(1);

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Commission Invoice</title>
  <style>
    @page {
      size: A4;
      margin: 20mm;
    }
    
    body { 
      font-family: Arial, Helvetica, sans-serif; 
      color: #111; 
      font-size: 12.5px; 
      margin: 0;
      padding: 0;
      position: relative;
      min-height: 297mm;
    }
    
    .h1 { 
      font-size: 18px; 
      font-weight: 800; 
      margin-bottom: 12px; 
      margin-top: 20px;
    }
    
    .row { margin: 6px 0; }
    .label { font-weight: 700; }
    .spacer { height: 10px; }
    
    table { 
      width: 100%; 
      border-collapse: collapse; 
      margin-top: 15px; 
      margin-bottom: 15px;
    }
    
    th, td { 
      border: 1px solid #333; 
      padding: 8px; 
      vertical-align: top; 
    }
    
    th { 
      background: #f2f2f2; 
      text-align: left; 
      font-weight: bold;
    }
    
    .right { text-align: right; }
    .bank h3 { margin: 16px 0 8px; }
    .footer-signature { margin-top: 20px; font-weight: 700; }
    .muted { color: #333; }
    
    .footer-info { 
      position: absolute;
      bottom: 15mm;
      left: 0;
      right: 0;
      padding-top: 15px; 
      border-top: 1px solid #ddd; 
      text-align: center; 
      font-size: 10px; 
      color: #444;
    }
    
    .content {
      min-height: calc(297mm - 55mm);
      padding-bottom: 50px;
    }
    
    .letterhead-container {
      text-align: center;
      margin-bottom: 15px;
      width: 100%;
      max-height: 120px;
      overflow: hidden;
    }
    
    .letterhead-img {
      max-width: 100%;
      height: auto;
      max-height: 100px;
      object-fit: contain;
    }
    
    .text-header {
      text-align: center;
      font-size: 16px;
      font-weight: bold;
      margin-bottom: 20px;
      padding-bottom: 10px;
      border-bottom: 1px solid #ddd;
    }
    
    .invoice-title {
      margin-top: 10px;
      margin-bottom: 15px;
    }
  </style>
</head>
<body>

  <div class="content">
    <!-- Letterhead Section -->
    ${letterheadBase64 ? `
    <div class="letterhead-container">
      <img src="${letterheadBase64}" 
           class="letterhead-img" 
           alt="Interpark Enterprises Letterhead" />
    </div>
    ` : `
    <div class="text-header">
      INTERPARK ENTERPRISES LIMITED
    </div>
    `}

    <div class="invoice-title">
      <div class="h1">
        COMMISSION INVOICE: ${escapeHtml(propertyName)} ${lrNumber ? `ON LR NUMBER: ${escapeHtml(lrNumber)}` : ''}
      </div>

      <div class="row"><span class="label">Date:</span> ${escapeHtml(invoiceDateText)}</div>
      <div class="row"><span class="label">Invoice Number:</span> ${escapeHtml(invoiceNumber)}</div>
      <div class="row"><span class="label">REF:</span> ${escapeHtml(refText || '')}</div>
    </div>

    <div class="spacer"></div>

    <div class="row"><span class="label">TO:</span></div>
    <div class="row" style="font-weight:700;">Landlord</div>
    <div class="row"><span class="label">Name:</span> ${escapeHtml(landlordName || '')}</div>
    <div class="row"><span class="label">PO BOX:</span> ${escapeHtml(landlordAddress || '')}</div>

    <table>
      <thead>
        <tr>
          <th style="width:60%;">DESCRIPTION</th>
          <th style="width:15%;">QTY</th>
          <th style="width:25%;">Sub-Total (Ksh.)</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>${escapeHtml(description)}</td>
          <td class="right">KES ${formatMoney(collectionAmount)} × ${commissionRatePercent}%</td>
          <td class="right">${formatMoney(commissionAmount)}</td>
        </tr>
        ${vatAmount > 0 ? `
        <tr>
          <td class="right muted" colspan="2"><b>V.A.T</b></td>
          <td class="right">${formatMoney(vatAmount)}</td>
        </tr>
        ` : ''}
        <tr>
          <td class="right" colspan="2"><b>Total</b></td>
          <td class="right"><b>${formatMoney(totalAmount)}</b></td>
        </tr>
      </tbody>
    </table>

    <div class="bank">
      <h3>BANK DETAILS</h3>
      <div class="row"><span class="label">Bank:</span> ${escapeHtml(bankName)}</div>
      <div class="row"><span class="label">Account Name:</span> ${escapeHtml(accountName)}</div>
      <div class="row"><span class="label">Account Number:</span> ${escapeHtml(accountNumber)}</div>
      ${branch ? `<div class="row"><span class="label">Branch:</span> ${escapeHtml(branch)}</div>` : ''}
      ${bankCode ? `<div class="row"><span class="label">Bank code:</span> ${escapeHtml(bankCode)}</div>` : ''}
      ${swiftCode ? `<div class="row"><span class="label">Swift code:</span> ${escapeHtml(swiftCode)}</div>` : ''}
      <div class="row"><span class="label">Currency:</span> ${escapeHtml(currency || 'KSH')}</div>
    </div>

    <div class="spacer"></div>

    <div class="row"><b>Sincere regards</b></div>
    <div class="footer-signature">Interpark Enterprises Limited</div>
  </div>

  <div class="footer-info">
    Interpark Enterprises Limited | Tel: 0110 060 088 | Email: info@interparkenterprises.co.ke<br/>
    Website: www.interparkenterprises.co.ke
  </div>

</body>
</html>
`;
}

function formatMoney(n) {
  const val = Number(n || 0);
  return val.toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function escapeHtml(str) {
  return String(str ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}
