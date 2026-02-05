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
    collectionAmount,       // VAT-exclusive base for commission calculation
    originalIncomeAmount,   // Original total payment (including VAT if applicable)
    vatType,                // INCLUSIVE, EXCLUSIVE, or NOT_APPLICABLE
    vatRate,                // Tenant's VAT rate (e.g., 16)
    commissionRate,         // This should be decimal (e.g., 0.085 for 8.5%)
    commissionAmount,
    vatAmount,              // VAT on commission (manager's invoice VAT)
    totalAmount,            // Total commission invoice amount
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
  
  // Calculate actual VAT amount on commission (not the collection amount)
  // vatAmount passed should be: commissionAmount * (vatRateOnCommission / 100)
  const displayVatAmount = Number(vatAmount || 0);
  const displayCommissionAmount = Number(commissionAmount || 0);
  const displayTotalAmount = Number(totalAmount || 0);
  
  // Calculate extracted VAT from original payment (for transparency)
  const displayOriginalAmount = Number(originalIncomeAmount || collectionAmount || 0);
  const displayCollectionAmount = Number(collectionAmount || 0);
  const extractedVat = displayOriginalAmount - displayCollectionAmount;

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Commission Invoice</title>
  <style>
    @page {
      size: A4;
      margin: 15mm 20mm 20mm 20mm; /* top, right, bottom, left */
    }
    
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }
    
    body { 
      font-family: Arial, Helvetica, sans-serif; 
      color: #111; 
      font-size: 12px; 
      line-height: 1.4;
      min-height: 100vh;
      position: relative;
    }
    
    .container {
      width: 100%;
      max-height: 257mm; /* A4 height (297mm) - margins (40mm) */
      display: flex;
      flex-direction: column;
    }
    
    .h1 { 
      font-size: 16px; 
      font-weight: 800; 
      margin-bottom: 10px; 
      margin-top: 15px;
      line-height: 1.3;
    }
    
    .row { 
      margin: 4px 0; 
      line-height: 1.5;
    }
    
    .label { 
      font-weight: 700; 
      display: inline-block;
      min-width: 120px;
    }
    
    .label-short { 
      font-weight: 700; 
      display: inline-block;
      min-width: 80px;
    }
    
    .spacer { height: 8px; }
    .spacer-lg { height: 15px; }
    
    table { 
      width: 100%; 
      border-collapse: collapse; 
      margin-top: 12px; 
      margin-bottom: 12px;
      font-size: 11px;
    }
    
    th, td { 
      border: 1px solid #333; 
      padding: 6px 8px; 
      vertical-align: top; 
    }
    
    th { 
      background: #f2f2f2; 
      text-align: left; 
      font-weight: bold;
    }
    
    .right { text-align: right; }
    .center { text-align: center; }
    
    .amount-breakdown {
      background: #f9f9f9;
      padding: 8px;
      border: 1px solid #ddd;
      margin: 10px 0;
      font-size: 11px;
    }
    
    .amount-breakdown-row {
      display: flex;
      justify-content: space-between;
      margin: 3px 0;
    }
    
    .bank { 
      margin-top: 15px; 
      margin-bottom: 10px; 
    }
    
    .bank h3 { 
      margin: 0 0 8px 0;
      font-size: 13px;
      border-bottom: 1px solid #333;
      padding-bottom: 4px;
    }
    
    .muted { color: #555; }
    .small { font-size: 10px; }
    
    .footer-signature { 
      margin-top: 15px; 
      font-weight: 700; 
    }
    
    /* Footer at actual bottom of page */
    .footer-info { 
      margin-top: auto;
      padding-top: 15px; 
      border-top: 1px solid #ddd; 
      text-align: center; 
      font-size: 9px; 
      color: #444;
      line-height: 1.6;
    }
    
    .letterhead-container {
      text-align: center;
      margin-bottom: 10px;
      width: 100%;
      max-height: 80px;
      overflow: hidden;
    }
    
    .letterhead-img {
      max-width: 100%;
      height: auto;
      max-height: 70px;
      object-fit: contain;
    }
    
    .text-header {
      text-align: center;
      font-size: 14px;
      font-weight: bold;
      margin-bottom: 15px;
      padding-bottom: 8px;
      border-bottom: 1px solid #ddd;
    }
    
    .invoice-title {
      margin-top: 8px;
      margin-bottom: 12px;
    }
    
    .vat-info {
      font-size: 10px;
      color: #666;
      font-style: italic;
    }
    
    .calculation-detail {
      font-size: 10px;
      color: #444;
      margin-top: 2px;
    }
    
    /* Prevent page breaks inside these elements */
    .no-break {
      page-break-inside: avoid;
      break-inside: avoid;
    }
    
    /* Ensure single page by constraining content */
    .content-wrapper {
      display: flex;
      flex-direction: column;
      min-height: 0;
    }
  </style>
</head>
<body>
  <div class="container">
    <!-- Letterhead Section -->
    ${letterheadBase64 ? `
    <div class="letterhead-container no-break">
      <img src="${letterheadBase64}" 
           class="letterhead-img" 
           alt="Interpark Enterprises Letterhead" />
    </div>
    ` : `
    <div class="text-header no-break">
      INTERPARK ENTERPRISES LIMITED
    </div>
    `}

    <div class="invoice-title no-break">
      <div class="h1">
        COMMISSION INVOICE: ${escapeHtml(propertyName)} ${lrNumber ? `ON LR NUMBER: ${escapeHtml(lrNumber)}` : ''}
      </div>

      <div class="row"><span class="label-short">Date:</span> ${escapeHtml(invoiceDateText)}</div>
      <div class="row"><span class="label-short">Invoice No:</span> ${escapeHtml(invoiceNumber)}</div>
      <div class="row"><span class="label-short">REF:</span> ${escapeHtml(refText || '')}</div>
    </div>

    <div class="spacer"></div>

    <div class="no-break">
      <div class="row"><span class="label-short">TO:</span> <b>Landlord</b></div>
      <div class="row"><span class="label-short">Name:</span> ${escapeHtml(landlordName || '')}</div>
      ${landlordAddress ? `<div class="row"><span class="label-short">Address:</span> ${escapeHtml(landlordAddress)}</div>` : ''}
    </div>

    <div class="spacer"></div>

    <!-- Amount Breakdown Section -->
    <div class="amount-breakdown no-break">
      <div class="amount-breakdown-row">
        <span><b>Total Collection Received:</b></span>
        <span>KES ${formatMoney(displayOriginalAmount)}</span>
      </div>
      ${extractedVat > 0 ? `
      <div class="amount-breakdown-row muted">
        <span>Less: VAT (${vatRate || 16}% ${vatType || 'INCLUSIVE'}):</span>
        <span>(KES ${formatMoney(extractedVat)})</span>
      </div>
      ` : ''}
      <div class="amount-breakdown-row">
        <span><b>Commission Base (VAT-exclusive):</b></span>
        <span>KES ${formatMoney(displayCollectionAmount)}</span>
      </div>
      <div class="calculation-detail" style="margin-top: 5px; border-top: 1px dashed #ccc; padding-top: 5px;">
        VAT Type: ${escapeHtml(vatType || 'NOT_APPLICABLE')} | 
        VAT Rate: ${vatRate || 0}% | 
        Commission Rate: ${commissionRatePercent}%
      </div>
    </div>

    <table class="no-break">
      <thead>
        <tr>
          <th style="width:55%;">DESCRIPTION</th>
          <th style="width:20%;" class="center">CALCULATION</th>
          <th style="width:25%;" class="right">AMOUNT (KES)</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>
            ${escapeHtml(description)}
            <div class="calculation-detail">
              Based on collection of KES ${formatMoney(displayCollectionAmount)} @ ${commissionRatePercent}%
            </div>
          </td>
          <td class="center">
            ${formatMoney(displayCollectionAmount)} × ${commissionRatePercent}%
          </td>
          <td class="right" style="font-weight: bold;">
            ${formatMoney(displayCommissionAmount)}
          </td>
        </tr>
        ${displayVatAmount > 0 ? `
        <tr>
          <td class="right muted" colspan="2">
            <b>Add: VAT (${(displayVatAmount / displayCommissionAmount * 100).toFixed(1)}% on commission)</b>
          </td>
          <td class="right" style="font-weight: bold;">
            ${formatMoney(displayVatAmount)}
          </td>
        </tr>
        ` : ''}
        <tr style="background: #f2f2f2;">
          <td class="right" colspan="2" style="font-size: 12px;">
            <b>TOTAL COMMISSION ${displayVatAmount > 0 ? 'INCLUSIVE OF VAT' : 'DUE'}</b>
          </td>
          <td class="right" style="font-size: 13px; font-weight: bold;">
            ${formatMoney(displayTotalAmount)}
          </td>
        </tr>
      </tbody>
    </table>

    <div class="bank no-break">
      <h3>BANK DETAILS</h3>
      <div class="row"><span class="label-short">Bank:</span> ${escapeHtml(bankName)}</div>
      <div class="row"><span class="label-short">Account Name:</span> ${escapeHtml(accountName)}</div>
      <div class="row"><span class="label-short">Account Number:</span> ${escapeHtml(accountNumber)}</div>
      ${branch ? `<div class="row"><span class="label-short">Branch:</span> ${escapeHtml(branch)}</div>` : ''}
      ${bankCode ? `<div class="row"><span class="label-short">Bank code:</span> ${escapeHtml(bankCode)}</div>` : ''}
      ${swiftCode ? `<div class="row"><span class="label-short">Swift code:</span> ${escapeHtml(swiftCode)}</div>` : ''}
      <div class="row"><span class="label-short">Currency:</span> ${escapeHtml(currency || 'KES')}</div>
    </div>

    <div class="no-break" style="margin-top: 20px;">
      <div class="row"><b>Sincere regards,</b></div>
      <div class="footer-signature">Interpark Enterprises Limited</div>
    </div>

    <!-- Footer at bottom -->
    <div class="footer-info">
      <b>Interpark Enterprises Limited</b><br/>
      Tel: 0110 060 088 | Email: info@interparkenterprises.co.ke<br/>
      Website: www.interparkenterprises.co.ke
    </div>
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