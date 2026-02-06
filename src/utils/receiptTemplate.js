export const generateReceiptHTML = (data) => {
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
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');
    
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }
    
    body {
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      font-size: 14px;
      line-height: 1.5; /* Changed from 1.6 to 1.5 for strict 1.5 line spacing */
      color: #1e293b;
      background: #fff;
      height: 100vh;
      overflow: hidden;
    }
    
    .page-container {
      height: 100vh;
      display: flex;
      flex-direction: column;
    }
    
    .receipt-container {
      max-width: 800px;
      margin: 0 auto;
      padding: 30px;
      flex: 1;
      display: flex;
      flex-direction: column;
    }
    
    .content-wrapper {
      flex: 1;
      display: flex;
      flex-direction: column;
    }
    
    .page-break {
      page-break-before: always;
      break-before: page;
      height: 0;
      visibility: hidden;
    }
    
    .header {
      text-align: center;
      margin-bottom: 30px;
      padding-bottom: 20px;
      border-bottom: 3px solid #005478;
    }
    
    .company-name {
      font-size: 28px;
      font-weight: 700;
      color: #005478;
      margin-bottom: 5px; /* Reduced margin */
      letter-spacing: -0.5px;
      line-height: 1.3; /* Added for better control */
    }
    
    .receipt-title {
      font-size: 24px;
      font-weight: 700;
      color: #005478;
      text-transform: uppercase;
      letter-spacing: 2px;
      margin-top: 15px; /* Reduced margin */
      line-height: 1.3; /* Added for better control */
    }
    
    .receipt-badge {
      display: inline-block;
      background: #10b981;
      color: white;
      padding: 6px 16px;
      border-radius: 20px;
      font-size: 12px;
      font-weight: 600;
      margin-top: 10px; /* Reduced margin */
      line-height: 1.5; /* Added line-height */
    }
    
    .receipt-meta {
      display: flex;
      justify-content: space-between;
      margin-bottom: 25px;
      gap: 40px;
    }
    
    .meta-section {
      flex: 1;
    }
    
    .meta-label {
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: #64748b;
      font-weight: 600;
      margin-bottom: 6px; /* Reduced margin */
    }
    
    .meta-value {
      font-size: 14px;
      color: #1e293b;
      font-weight: 500;
      line-height: 1.5; /* Added line-height */
    }
    
    .meta-value.large {
      font-size: 16px;
      font-weight: 600;
      line-height: 1.5; /* Added line-height */
    }
    
    .divider {
      height: 1px;
      background: #e2e8f0;
      margin: 25px 0;
    }
    
    .section-title {
      font-size: 16px;
      font-weight: 700;
      color: #1e293b;
      margin-bottom: 12px; /* Reduced margin */
      display: flex;
      align-items: center;
      gap: 8px;
      line-height: 1.5; /* Added line-height */
    }
    
    .section-title::before {
      content: '';
      display: inline-block;
      width: 4px;
      height: 18px;
      background: #005478;
      border-radius: 2px;
    }
    
    .info-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 12px; /* Reduced gap */
      margin-bottom: 20px; /* Reduced margin */
    }
    
    .info-item {
      display: flex;
      flex-direction: column;
    }
    
    .info-label {
      font-size: 12px;
      color: #64748b;
      margin-bottom: 3px; /* Reduced margin */
      font-weight: 500;
      line-height: 1.5; /* Added line-height */
    }
    
    .info-value {
      font-size: 14px;
      color: #1e293b;
      font-weight: 600;
      line-height: 1.5; /* Added line-height */
    }
    
    .invoices-table {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 20px; /* Reduced margin */
    }
    
    .invoices-table th {
      background: #005478;
      color: white;
      padding: 10px; /* Reduced padding */
      text-align: left;
      font-size: 12px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      font-weight: 600;
      line-height: 1.5; /* Added line-height */
    }
    
    .invoices-table td {
      padding: 10px; /* Reduced padding */
      border-bottom: 1px solid #e2e8f0;
      font-size: 14px;
      line-height: 1.5; /* Added line-height */
    }
    
    .invoices-table tr:nth-child(even) {
      background: #f8fafc;
    }
    
    .invoices-table tr.paid-in-full {
      background: #f0fdf4;
    }
    
    .invoices-table tr.partial {
      background: #fffbeb;
    }
    
    .status-badge {
      display: inline-block;
      padding: 4px 8px;
      border-radius: 12px;
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
      line-height: 1.5; /* Added line-height */
    }
    
    .status-badge.paid {
      background: #dcfce7;
      color: #166534;
    }
    
    .status-badge.partial {
      background: #fef3c7;
      color: #92400e;
    }
    
    .summary-section {
      background: #f8fafc;
      border-radius: 8px;
      padding: 20px; /* Reduced padding */
      margin-bottom: 20px; /* Reduced margin */
    }
    
    .summary-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 6px 0; /* Reduced padding */
      border-bottom: 1px dashed #e2e8f0;
      line-height: 1.5; /* Added line-height */
    }
    
    .summary-row:last-child {
      border-bottom: none;
      padding-top: 12px; /* Reduced padding */
      margin-top: 6px; /* Reduced margin */
      border-top: 2px solid #005478;
    }
    
    .summary-label {
      font-size: 14px;
      color: #475569;
      line-height: 1.5; /* Added line-height */
    }
    
    .summary-value {
      font-size: 14px;
      font-weight: 600;
      color: #1e293b;
      line-height: 1.5; /* Added line-height */
    }
    
    .summary-row.grand-total .summary-label,
    .summary-row.grand-total .summary-value {
      font-size: 18px;
      font-weight: 700;
      color: #005478;
      line-height: 1.5; /* Added line-height */
    }
    
    .overpayment-box {
      background: #fef3c7;
      border: 1px solid #f59e0b;
      border-radius: 8px;
      padding: 14px; /* Reduced padding */
      margin-bottom: 20px; /* Reduced margin */
    }
    
    .overpayment-title {
      font-size: 14px;
      font-weight: 600;
      color: #92400e;
      margin-bottom: 6px; /* Reduced margin */
      display: flex;
      align-items: center;
      gap: 8px;
      line-height: 1.5; /* Added line-height */
    }
    
    .overpayment-amount {
      font-size: 20px;
      font-weight: 700;
      color: #b45309;
      line-height: 1.5; /* Added line-height */
    }
    
    .footer {
      margin-top: 30px; /* Reduced margin */
      padding-top: 20px; /* Reduced padding */
      border-top: 2px solid #e2e8f0;
      text-align: center;
      flex-shrink: 0;
    }
    
    .thank-you {
      font-size: 18px;
      font-weight: 600;
      color: #005478;
      margin-bottom: 6px; /* Reduced margin */
      line-height: 1.5; /* Added line-height */
    }
    
    .footer-note {
      font-size: 12px;
      color: #64748b;
      margin-bottom: 12px; /* Reduced margin */
      line-height: 1.5; /* Added line-height */
    }
    
    .contact-info {
      font-size: 11px;
      color: #94a3b8;
      line-height: 1.5; /* Changed from 1.8 to 1.5 */
    }
    
    .qr-placeholder {
      width: 100px;
      height: 100px;
      background: #f1f5f9;
      border-radius: 8px;
      margin: 15px auto; /* Reduced margin */
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 10px;
      color: #94a3b8;
      border: 2px dashed #cbd5e1;
    }
    
    .watermark {
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%) rotate(-45deg);
      font-size: 80px;
      font-weight: 700;
      color: rgba(16, 185, 129, 0.08);
      pointer-events: none;
      z-index: 0;
      text-transform: uppercase;
      letter-spacing: 10px;
    }
    
    .page1-content {
      flex: 1;
      display: flex;
      flex-direction: column;
    }
    
    .page2-content {
      flex: 1;
      display: flex;
      flex-direction: column;
    }
    
    @media print {
      body {
        height: auto;
        overflow: auto;
      }
      
      .page-container {
        height: auto;
      }
      
      .receipt-container {
        padding: 20px;
      }
      
      .watermark {
        color: rgba(16, 185, 129, 0.05);
      }
      
      .page-break {
        height: 1px;
        visibility: visible;
        margin: 20px 0;
        border-top: 1px dashed #ccc;
      }
    }
  </style>
</head>
<body>
  <div class="page-container">
    <div class="receipt-container">
      <div class="watermark">Paid</div>
      
      <div class="content-wrapper">
        <!-- Page 1 Content -->
        <div class="page1-content">
          <div class="header">
            <div class="company-name">Interpark Enterprises Limited</div>
            <!-- Removed company details section here -->
            <div class="receipt-title">Payment Receipt</div>
            <div class="receipt-badge">Payment Received</div>
          </div>
          
          <div class="receipt-meta">
            <div class="meta-section">
              <div class="meta-label">Receipt Number</div>
              <div class="meta-value large">${receiptNumber}</div>
            </div>
            <div class="meta-section" style="text-align: right;">
              <div class="meta-label">Payment Date</div>
              <div class="meta-value large">${formatDate(paymentDate)}</div>
            </div>
          </div>
          
          <div class="divider"></div>
          
          <div class="section-title">Tenant Information</div>
          <div class="info-grid">
            <div class="info-item">
              <span class="info-label">Tenant Name</span>
              <span class="info-value">${tenantName}</span>
            </div>
            <div class="info-item">
              <span class="info-label">Contact</span>
              <span class="info-value">${tenantContact || 'N/A'}</span>
            </div>
            <div class="info-item">
              <span class="info-label">Property</span>
              <span class="info-value">${propertyName}</span>
            </div>
            <div class="info-item">
              <span class="info-label">Unit</span>
              <span class="info-value">${unitType}${unitNo ? ' - ' + unitNo : ''}</span>
            </div>
          </div>
          
          <div class="section-title">Payment Details</div>
          <div class="info-grid">
            <div class="info-item">
              <span class="info-label">Payment Period</span>
              <span class="info-value">${paymentPeriod}</span>
            </div>
            <div class="info-item">
              <span class="info-label">Payment Method</span>
              <span class="info-value">${paymentMethod}</span>
            </div>
            ${creditUsed > 0 ? `
            <div class="info-item">
              <span class="info-label">Credit Applied</span>
              <span class="info-value" style="color: #10b981;">-${formatCurrency(creditUsed)}</span>
            </div>
            ` : ''}
          </div>
          
          ${invoicesPaid.length > 0 ? `
          <div class="divider"></div>
          <div class="section-title">Invoices Paid</div>
          <table class="invoices-table">
            <thead>
              <tr>
                <th>Invoice #</th>
                <th>Period</th>
                <th>Previous Balance</th>
                <th>Amount Paid</th>
                <th>New Balance</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              ${invoicesPaid.map(inv => `
                <tr class="${inv.newStatus === 'PAID' ? 'paid-in-full' : inv.newStatus === 'PARTIAL' ? 'partial' : ''}">
                  <td><strong>${inv.invoiceNumber}</strong></td>
                  <td>${inv.paymentPeriod || paymentPeriod}</td>
                  <td>${formatCurrency(inv.previousBalance)}</td>
                  <td style="color: #10b981; font-weight: 600;">${formatCurrency(inv.paymentApplied)}</td>
                  <td>${formatCurrency(inv.newBalance)}</td>
                  <td><span class="status-badge ${inv.newStatus.toLowerCase()}">${inv.newStatus}</span></td>
                </tr>
              `).join('')}
            </tbody>
          </table>
          ` : ''}
        </div>
        
        <!-- Page Break -->
        <div class="page-break"></div>
        
        <!-- Page 2 Content -->
        <div class="page2-content">
          <div class="summary-section">
            ${creditUsed > 0 ? `
            <div class="summary-row">
              <span class="summary-label">Cash Payment</span>
              <span class="summary-value">${formatCurrency(amountPaid)}</span>
            </div>
            <div class="summary-row">
              <span class="summary-label">Credit Applied</span>
              <span class="summary-value" style="color: #10b981;">-${formatCurrency(creditUsed)}</span>
            </div>
            ` : ''}
            <div class="summary-row grand-total">
              <span class="summary-label">Total Amount Received</span>
              <span class="summary-value">${formatCurrency(totalAllocated || amountPaid)}</span>
            </div>
          </div>
          
          ${overpaymentAmount > 0 ? `
          <div class="overpayment-box">
            <div class="overpayment-title">
              <span>⚠️</span>
              <span>Overpayment Recorded</span>
            </div>
            <div class="overpayment-amount">${formatCurrency(overpaymentAmount)}</div>
            <div style="font-size: 12px; color: #92400e; margin-top: 4px; line-height: 1.5;">
              This amount has been recorded as credit for future payments or allocated to future invoices.
            </div>
          </div>
          ` : ''}
          
          ${notes ? `
          <div class="divider"></div>
          <div class="section-title">Notes</div>
          <p style="color: #475569; font-size: 14px; line-height: 1.5;">${notes}</p>
          ` : ''}
          
          <div class="footer">
            <div class="thank-you">Thank you for your payment!</div>
            <div class="footer-note">This is an official receipt for your records.</div>
            <div class="contact-info">
              <strong>Interpark Enterprises Limited</strong><br>
              For any inquiries regarding this receipt, please contact us<br>
              Tel: 0110 060 088 | Email: info@interparkenterprises.co.ke
            </div>
            <div class="qr-placeholder">
              Ref: ${paymentReportId?.substring(0, 8) || 'N/A'}
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</body>
</html>
  `;
};