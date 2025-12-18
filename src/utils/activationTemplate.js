/**
 * Generate HTML template for activation request
 * @param {Object} activation - Activation request data with relations
 * @returns {string} HTML content
 */
export const generateActivationHTML = (activation) => {
  const formatDate = (date) => {
    if (!date) return '………………………………';
    return new Date(date).toLocaleDateString('en-GB', {
      day: '2-digit',
      month: 'short',
      year: 'numeric'
    });
  };

  const formatTime = (time) => {
    return time || '………………………………';
  };

  const formatValue = (value) => {
    return value || '………………………………';
  };

  const formatBoolean = (value) => {
    return value ? 'Yes' : 'No';
  };

  const formatArray = (arr) => {
    if (!arr || !Array.isArray(arr) || arr.length === 0) {
      return '<li>None specified</li>';
    }
    return arr.map(item => `<li>${typeof item === 'object' ? JSON.stringify(item) : item}</li>`).join('');
  };

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Activation Request - ${activation.requestNumber}</title>
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }

    body {
      font-family: Arial, sans-serif;
      font-size: 11pt;
      line-height: 1.6;
      color: #000;
      padding: 20px;
    }

    .header {
      text-align: center;
      margin-bottom: 30px;
      border-bottom: 3px solid #000;
      padding-bottom: 20px;
    }

    .header h1 {
      font-size: 18pt;
      font-weight: bold;
      margin-bottom: 10px;
      text-transform: uppercase;
    }

    .header .request-number {
      font-size: 12pt;
      color: #666;
      margin-top: 10px;
    }

    .property-info {
      background-color: #f5f5f5;
      padding: 15px;
      margin-bottom: 20px;
      border-left: 4px solid #333;
    }

    .property-info h3 {
      font-size: 12pt;
      margin-bottom: 10px;
    }

    .section {
      margin-bottom: 30px;
      page-break-inside: avoid;
    }

    .section-title {
      font-size: 13pt;
      font-weight: bold;
      background-color: #333;
      color: #fff;
      padding: 10px 15px;
      margin-bottom: 15px;
      text-transform: uppercase;
    }

    table {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 15px;
    }

    table td {
      padding: 8px;
      border: 1px solid #ddd;
      vertical-align: top;
    }

    table td:first-child {
      font-weight: bold;
      width: 35%;
      background-color: #f9f9f9;
    }

    .info-row {
      display: flex;
      margin-bottom: 10px;
    }

    .info-label {
      font-weight: bold;
      width: 200px;
      flex-shrink: 0;
    }

    .info-value {
      flex-grow: 1;
      border-bottom: 1px dotted #999;
      min-height: 20px;
    }

    ul {
      margin-left: 20px;
      margin-top: 5px;
    }

    ul li {
      margin-bottom: 5px;
    }

    .signature-section {
      margin-top: 50px;
      display: flex;
      justify-content: space-between;
    }

    .signature-box {
      width: 45%;
    }

    .signature-line {
      border-top: 1px solid #000;
      margin-top: 50px;
      padding-top: 5px;
    }

    .footer {
      margin-top: 50px;
      padding-top: 20px;
      border-top: 2px solid #000;
      font-size: 9pt;
      text-align: center;
      color: #666;
    }

    .status-badge {
      display: inline-block;
      padding: 5px 15px;
      border-radius: 3px;
      font-weight: bold;
      font-size: 10pt;
    }

    .status-draft { background-color: #ffc107; color: #000; }
    .status-submitted { background-color: #2196F3; color: #fff; }
    .status-approved { background-color: #4CAF50; color: #fff; }
    .status-rejected { background-color: #f44336; color: #fff; }

    @media print {
      body {
        padding: 0;
      }
      .section {
        page-break-inside: avoid;
      }
    }
  </style>
</head>
<body>
  <div class="header">
    <h1>Application for Activation/Exhibition Space</h1>
    <div class="request-number">
      Request Number: <strong>${activation.requestNumber}</strong>
      <span class="status-badge status-${activation.status.toLowerCase()}">${activation.status}</span>
    </div>
  </div>

  <div class="property-info">
    <h3>Property Information</h3>
    <div class="info-row">
      <div class="info-label">Property Name:</div>
      <div class="info-value">${activation.property.name}</div>
    </div>
    <div class="info-row">
      <div class="info-label">Property Address:</div>
      <div class="info-value">${activation.property.address}</div>
    </div>
    <div class="info-row">
      <div class="info-label">Landlord:</div>
      <div class="info-value">${activation.property.landlord?.name || 'N/A'}</div>
    </div>
  </div>

  <!-- PART 1: CLIENT INFORMATION -->
  <div class="section">
    <div class="section-title">Part 1 – Client Information</div>
    <table>
      <tr>
        <td>Company Name</td>
        <td>${formatValue(activation.companyName)}</td>
      </tr>
      <tr>
        <td>Postal Address</td>
        <td>${formatValue(activation.postalAddress)}</td>
      </tr>
      <tr>
        <td>Telephone</td>
        <td>${formatValue(activation.telephone)}</td>
      </tr>
      <tr>
        <td>Contact Person</td>
        <td>${formatValue(activation.contactPerson)}</td>
      </tr>
      <tr>
        <td>Designation/Title</td>
        <td>${formatValue(activation.designation)}</td>
      </tr>
      <tr>
        <td>Email</td>
        <td>${formatValue(activation.email)}</td>
      </tr>
      <tr>
        <td>Mobile No.</td>
        <td>${formatValue(activation.mobileNo)}</td>
      </tr>
    </table>
  </div>

  <!-- PART 2: DESCRIPTION OF ACTIVATION/EXHIBITION -->
  <div class="section">
    <div class="section-title">Part 2 – Description of the Activation/Exhibition</div>
    <table>
      <tr>
        <td>Activation/Exhibition Start Date</td>
        <td>${formatDate(activation.startDate)}</td>
      </tr>
      <tr>
        <td>Set Up Time</td>
        <td>${formatTime(activation.setupTime)}</td>
      </tr>
      <tr>
        <td>Activation/Exhibition End Date</td>
        <td>${formatDate(activation.endDate)}</td>
      </tr>
      <tr>
        <td>Tear Down Time</td>
        <td>${formatTime(activation.tearDownTime)}</td>
      </tr>
      <tr>
        <td>Type of Activation</td>
        <td>${formatValue(activation.activationType)}</td>
      </tr>
      <tr>
        <td>Brief Description</td>
        <td>${formatValue(activation.description)}</td>
      </tr>
      <tr>
        <td>Expected Number of Visitors</td>
        <td>${activation.expectedVisitors || 'Not specified'}</td>
      </tr>
    </table>
  </div>

  <!-- PART 3: SPACE REQUIREMENTS -->
  <div class="section">
    <div class="section-title">Part 3 – Space Requirements</div>
    <table>
      <tr>
        <td>Space Required (sq meters)</td>
        <td>${activation.spaceRequired || '………………………………'}</td>
      </tr>
      <tr>
        <td>Preferred Location</td>
        <td>${formatValue(activation.location)}</td>
      </tr>
      <tr>
        <td>Power Requirement</td>
        <td>${formatValue(activation.powerRequirement)}</td>
      </tr>
      <tr>
        <td>Water Required</td>
        <td>${formatBoolean(activation.waterRequirement)}</td>
      </tr>
      <tr>
        <td>Internet Required</td>
        <td>${formatBoolean(activation.internetRequired)}</td>
      </tr>
    </table>
  </div>

  <!-- PART 4: EQUIPMENT & SETUP -->
  <div class="section">
    <div class="section-title">Part 4 – Equipment & Setup</div>
    <table>
      <tr>
        <td>Bringing Own Equipment</td>
        <td>${formatBoolean(activation.ownEquipment)}</td>
      </tr>
      <tr>
        <td>Equipment List</td>
        <td>
          <ul>
            ${formatArray(activation.equipmentList)}
          </ul>
        </td>
      </tr>
      <tr>
        <td>Furniture Needed</td>
        <td>
          <ul>
            ${formatArray(activation.furnitureNeeded)}
          </ul>
        </td>
      </tr>
    </table>
  </div>

  <!-- PART 5: BRANDING & MARKETING -->
  <div class="section">
    <div class="section-title">Part 5 – Branding & Marketing</div>
    <table>
      <tr>
        <td>Branding Materials</td>
        <td>
          <ul>
            ${formatArray(activation.brandingMaterials)}
          </ul>
        </td>
      </tr>
      <tr>
        <td>Sound System Required</td>
        <td>${formatBoolean(activation.soundSystem)}</td>
      </tr>
      <tr>
        <td>Display Screens Required</td>
        <td>${formatBoolean(activation.displayScreens)}</td>
      </tr>
    </table>
  </div>

  <!-- PART 6: HEALTH & SAFETY -->
  <div class="section">
    <div class="section-title">Part 6 – Health & Safety</div>
    <table>
      <tr>
        <td>Insurance Cover</td>
        <td>${formatBoolean(activation.insuranceCover)}</td>
      </tr>
      <tr>
        <td>Insurance Details</td>
        <td>${formatValue(activation.insuranceDetails)}</td>
      </tr>
      <tr>
        <td>Safety Measures</td>
        <td>
          <ul>
            ${formatArray(activation.safetyMeasures)}
          </ul>
        </td>
      </tr>
      <tr>
        <td>First Aid Kit Available</td>
        <td>${formatBoolean(activation.firstAidKit)}</td>
      </tr>
    </table>
  </div>

  <!-- PART 7: FINANCIAL INFORMATION -->
  <div class="section">
    <div class="section-title">Part 7 – Financial Information</div>
    <table>
      <tr>
        <td>Proposed Budget</td>
        <td>${activation.proposedBudget ? `KES ${activation.proposedBudget.toLocaleString()}` : '………………………………'}</td>
      </tr>
      <tr>
        <td>Payment Terms</td>
        <td>${formatValue(activation.paymentTerms)}</td>
      </tr>
    </table>
  </div>

  <!-- PART 8: ADDITIONAL SERVICES -->
  <div class="section">
    <div class="section-title">Part 8 – Additional Services</div>
    <table>
      <tr>
        <td>Security Required</td>
        <td>${formatBoolean(activation.securityRequired)}</td>
      </tr>
      <tr>
        <td>Cleaning Required</td>
        <td>${formatBoolean(activation.cleaningRequired)}</td>
      </tr>
      <tr>
        <td>Catering Required</td>
        <td>${formatBoolean(activation.cateringRequired)}</td>
      </tr>
      <tr>
        <td>Parking Spaces Needed</td>
        <td>${activation.parkingSpaces || 0}</td>
      </tr>
    </table>
  </div>

  <!-- PART 9: SPECIAL REQUESTS -->
  ${activation.specialRequests ? `
  <div class="section">
    <div class="section-title">Part 9 – Special Requests</div>
    <p style="padding: 15px; background-color: #f9f9f9; border-left: 4px solid #333;">
      ${activation.specialRequests}
    </p>
  </div>
  ` : ''}

  <!-- SIGNATURE SECTION -->
  <div class="signature-section">
    <div class="signature-box">
      <div class="signature-line">
        <strong>Applicant Signature</strong><br>
        Name: ${activation.contactPerson}<br>
        Date: ${formatDate(activation.signatureDate || activation.createdAt)}
      </div>
    </div>
    <div class="signature-box">
      <div class="signature-line">
        <strong>Property Manager</strong><br>
        Name: ${activation.manager.name}<br>
        Date: ${formatDate(activation.submittedAt)}
      </div>
    </div>
  </div>

  <!-- FOOTER -->
  <div class="footer">
    <p>This is a computer-generated document. No signature is required.</p>
    <p>Generated on: ${new Date().toLocaleString('en-GB')}</p>
    <p>${activation.property.name} | ${activation.property.address}</p>
  </div>
</body>
</html>
  `;
};