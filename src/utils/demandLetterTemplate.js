import { generatePDF } from './pdfGenerator.js';

/**
 * Generate demand letter PDF from data
 * @param {Object} data - Demand letter data
 * @returns {Promise<Buffer>} PDF buffer
 */
export const generateDemandLetterPDF = async (data) => {
  const htmlContent = generateDemandLetterHTML(data);
  
  const pdfBuffer = await generatePDF(htmlContent, {
    format: 'A4',
    margin: {
      top: '2.5cm',
      right: '2.5cm',
      bottom: '2.5cm',
      left: '2.5cm'
    },
    printBackground: true
  });

  return pdfBuffer;
};

/**
 * Generate HTML content for demand letter
 * @param {Object} data - Demand letter data
 * @returns {string} HTML content
 */
function generateDemandLetterHTML(data) {
  return `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Demand Letter - ${data.letterNumber}</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }

        body {
            font-family: 'Times New Roman', Times, serif;
            font-size: 12pt;
            line-height: 1.6;
            color: #000;
            background: #fff;
        }

        .page {
            width: 210mm;
            min-height: 297mm;
            padding: 2.5cm;
            margin: 0 auto;
            background: white;
        }

        .header {
            text-align: center;
            margin-bottom: 30px;
            border-bottom: 2px solid #000;
            padding-bottom: 15px;
        }

        .header h1 {
            font-size: 18pt;
            font-weight: bold;
            text-transform: uppercase;
            margin-bottom: 5px;
        }

        .header .property-details {
            font-size: 10pt;
            line-height: 1.4;
            margin-top: 10px;
        }

        .landlord-info {
            margin-bottom: 30px;
            font-size: 11pt;
        }

        .landlord-info p {
            margin: 3px 0;
        }

        .date {
            margin: 20px 0;
            font-weight: bold;
        }

        .recipient {
            margin: 20px 0 30px 0;
        }

        .recipient p {
            margin: 3px 0;
        }

        .subject {
            margin: 25px 0;
            font-weight: bold;
            text-decoration: underline;
            text-align: left;
        }

        .reference {
            margin: 15px 0;
            font-weight: bold;
        }

        .salutation {
            margin: 20px 0;
        }

        .content {
            text-align: justify;
            margin: 20px 0;
        }

        .content p {
            margin: 15px 0;
            text-indent: 0;
        }

        .content .indent {
            text-indent: 40px;
        }

        .highlight {
            font-weight: bold;
        }

        .amount {
            font-weight: bold;
            text-decoration: underline;
        }

        .closing {
            margin-top: 40px;
        }

        .signature-section {
            margin-top: 50px;
        }

        .signature-line {
            border-top: 1px solid #000;
            width: 200px;
            margin-top: 60px;
        }

        .footer {
            margin-top: 30px;
            font-size: 10pt;
            font-style: italic;
        }

        table {
            width: 100%;
            border-collapse: collapse;
            margin: 20px 0;
        }

        table td {
            padding: 5px;
            vertical-align: top;
        }

        .payment-details {
            background-color: #f5f5f5;
            padding: 15px;
            margin: 20px 0;
            border-left: 4px solid #000;
        }

        @media print {
            .page {
                margin: 0;
                border: none;
                box-shadow: none;
            }
        }
    </style>
</head>
<body>
    <div class="page">
        <!-- Header -->
        <div class="header">
            <h1>${escapeHtml(data.propertyName || 'TEXAS PLAZA')}</h1>
            <div class="property-details">
                ${data.propertyLRNumber ? `LAND REFERENCE NUMBER ${escapeHtml(data.propertyLRNumber)}<br>` : ''}
                ${escapeHtml(data.propertyAddress || '')}<br>
                Post Office Box Number 11086-00100 Nairobi
            </div>
        </div>

        <!-- Landlord Information -->
        <div class="landlord-info">
            <p><strong>${escapeHtml(data.landlordName)}</strong></p>
            <p>P.O. Box ${escapeHtml(data.landlordPOBox)}</p>
            ${data.landlordPhone ? `<p>Tel: ${escapeHtml(data.landlordPhone)}</p>` : ''}
            ${data.landlordEmail ? `<p>Email: ${escapeHtml(data.landlordEmail)}</p>` : ''}
        </div>

        <!-- Date -->
        <div class="date">
            <p>Date: ${escapeHtml(data.issueDate)}</p>
        </div>

        <!-- Recipient -->
        <div class="recipient">
            <p><strong>TO:</strong></p>
            <p>${escapeHtml(data.tenantName)}</p>
            ${data.tenantPOBox ? `<p>P.O. Box ${escapeHtml(data.tenantPOBox)}</p>` : ''}
            ${data.tenantContact ? `<p>Tel: ${escapeHtml(data.tenantContact)}</p>` : ''}
            ${data.tenantEmail ? `<p>Email: ${escapeHtml(data.tenantEmail)}</p>` : ''}
        </div>

        <!-- Subject -->
        <div class="subject">
            <p>RE: DEMAND FOR OUTSTANDING RENT BALANCE – KSH. ${escapeHtml(data.outstandingAmount)}/= FOR THE ${escapeHtml(data.rentalPeriod.toUpperCase())}</p>
        </div>

        <!-- Reference -->
        <div class="reference">
            <p>Our Ref: ${escapeHtml(data.referenceNumber)}</p>
        </div>

        <!-- Salutation -->
        <div class="salutation">
            <p>Dear Sir/Madam,</p>
        </div>

        <!-- Main Content -->
        <div class="content">
            <p>
                The Landlord, <span class="highlight">${escapeHtml(data.landlordName)}</span>, 
                the lawful landlord and owner of the premises you currently occupy, writes to formally 
                demand payment of the outstanding rent balance of <span class="amount">Ksh. ${escapeHtml(data.outstandingAmount)}/=</span> 
                for the rental period <span class="highlight">(${escapeHtml(data.rentalPeriod)})</span>, 
                pursuant to the tenancy agreement executed between us.
            </p>

            <p>
                As per the terms of the said agreement, you are required to pay rent equivalent to 
                <span class="highlight">Ksh. ${escapeHtml(data.rentAmount)}/=</span> every 
                <span class="highlight">${escapeHtml(data.paymentPolicy)}</span> 
                (i.e., Ksh. ${escapeHtml(data.rentAmount)}/= per ${escapeHtml(data.paymentPolicy.toLowerCase())}), 
                payable in advance on or before the <span class="highlight">due date</span> of each payment period.
            </p>

            <p>
                However, our records indicate that you have failed to remit the full rent payment for 
                <span class="highlight">${escapeHtml(data.rentalPeriod)}</span>, which was due on 
                <span class="highlight">${escapeHtml(data.dueDate)}</span>. 
                ${data.partialPayment && parseFloat(data.partialPayment) > 0 ? 
                    `While we acknowledge your partial payment of <span class="amount">Ksh. ${escapeHtml(data.partialPayment)}/=</span> 
                    made on <span class="highlight">${escapeHtml(data.partialPaymentDate)}</span>, ` : ''}
                This has resulted in an outstanding balance of 
                <span class="amount">Ksh. ${escapeHtml(data.outstandingAmount)}/=</span>, 
                which remains unpaid to date.
            </p>

            <p>
                We hereby demand that you settle the aforementioned outstanding balance in full within 
                <span class="highlight">${escapeHtml(data.demandPeriod)}</span> from the date of this letter. 
                Failure to comply with this demand shall leave the Landlord with no option but to take 
                further legal action to recover the arrears, which may include but is not limited to:
            </p>

            <ul style="margin-left: 40px; margin-top: 15px; margin-bottom: 15px;">
                <li style="margin: 8px 0;">Initiating eviction proceedings in accordance with the law;</li>
                <li style="margin: 8px 0;">Filing a civil suit for recovery of the outstanding amount plus interest and legal costs;</li>
                <li style="margin: 8px 0;">Reporting the matter to relevant authorities including credit reference bureaus.</li>
            </ul>

            <p>
                Kindly note that the Landlord reserves the right to charge interest on the outstanding 
                balance at the prevailing market rate and to recover all legal costs incurred in pursuing 
                this matter.
            </p>

            ${data.notes ? `
            <p>
                <strong>Additional Notes:</strong><br>
                ${escapeHtml(data.notes)}
            </p>
            ` : ''}
        </div>

        <!-- Payment Details Box -->
        <div class="payment-details">
            <p><strong>PAYMENT DETAILS:</strong></p>
            <p>Outstanding Amount: <strong>KSH. ${escapeHtml(data.outstandingAmount)}/=</strong></p>
            <p>Rental Period: <strong>${escapeHtml(data.rentalPeriod)}</strong></p>
            <p>Due Date: <strong>${escapeHtml(data.dueDate)}</strong></p>
            <p>Payment Deadline: <strong>${escapeHtml(data.demandPeriod)} from date of this letter</strong></p>
        </div>

        <!-- Closing -->
        <div class="closing">
            <p>We trust that you will treat this matter with the urgency it deserves.</p>
            <p style="margin-top: 15px;">Yours faithfully,</p>
        </div>

        <!-- Signature Section -->
        <div class="signature-section">
            <div class="signature-line"></div>
            <p><strong>${escapeHtml(data.landlordName)}</strong></p>
            <p>Landlord</p>
        </div>

        <!-- Footer -->
        <div class="footer">
            <p><strong>IMPORTANT:</strong> This is a formal demand for payment. Failure to respond may result in legal action without further notice.</p>
            <p style="margin-top: 10px;">
                <strong>Letter Number:</strong> ${escapeHtml(data.letterNumber)} | 
                <strong>Generated on:</strong> ${escapeHtml(data.issueDate)}
            </p>
        </div>
    </div>
</body>
</html>
  `;
}

/**
 * Escape HTML special characters
 * @param {string} text 
 * @returns {string}
 */
function escapeHtml(text) {
  if (!text) return '';
  const map = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  };
  return String(text).replace(/[&<>"']/g, m => map[m]);
}