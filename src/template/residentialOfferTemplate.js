/**
 * Residential Tenancy Agreement Template
 * For Residential properties - Based on Kenya Land Registration Act
 * Form LRA 62 (r. 76(1))
 */
export const generateResidentialOfferLetter = (data) => {
  const {
    // Property details
    propertyName,
    propertyAddress,
    propertyLRNumber,
    
    // Landlord details
    landlordName,
    landlordPOBox,
    landlordAddress,
    landlordIDNumber,
    landlordBankAccount,
    landlordAccountName,
    landlordBankName,
    landlordBankBranch,
    landlordBankBranchCode,
    landlordSwiftCode,
    landlordMpesaPaybill,
    landlordMpesaAccount,
    
    // Lead/Tenant details
    leadName,
    leadPOBox,
    leadAddress,
    leadEmail,
    leadIDNumber,
    leadPINNumber,
    leadPhone,
    
    // Offer details
    date,
    offerNumber,
    houseNumber,
    bedrooms,
    bathrooms,
    floorNumber,
    rentAmount,
    leaseTerm,
    deposit,
    serviceCharge,
    rentStartDate,
    leaseStartDate,
    escalationRate,
    escalationFrequency,
    additionalTerms
  } = data;

  // Helper function to format dates
  const formatDate = (dateStr) => {
    if (!dateStr) return { day: '____', month: '____________', year: '____' };
    const date = new Date(dateStr);
    return {
      day: date.getDate(),
      month: date.toLocaleString('default', { month: 'long' }),
      year: date.getFullYear()
    };
  };

  const agreementDate = formatDate(date);
  const startDate = formatDate(leaseStartDate);
  const rentStartDateFormatted = formatDate(rentStartDate);

  // Calculate deposits
  const waterDeposit = 2500;
  const electricityDeposit = 1000;
  const totalDeposit = deposit || (rentAmount ? rentAmount * 1 : 0);
  const garbageFee = 200;

  // Format currency
  const formatCurrency = (amount) => {
    if (!amount) return '_________________';
    return new Intl.NumberFormat('en-KE').format(amount);
  };

  // Format the complete address
  const formatPropertyAddress = () => {
    let address = '';
    if (propertyAddress) address += propertyAddress;
    if (propertyName && propertyAddress) address += ', ';
    if (propertyName) address += propertyName;
    if (propertyLRNumber && (propertyName || propertyAddress)) address += ', ';
    if (propertyLRNumber) address += `LR No: ${propertyLRNumber}`;
    return address || '_______________________';
  };

  // Format landlord address
  const formatLandlordAddress = () => {
    let address = '';
    if (landlordPOBox) address += `P.O. Box ${landlordPOBox}`;
    if (landlordAddress) {
      if (address) address += ', ';
      address += landlordAddress;
    }
    return address || '_______________________';
  };

  // Format tenant address
  const formatTenantAddress = () => {
    let address = '';
    if (leadPOBox) address += `P.O. Box ${leadPOBox}`;
    if (leadAddress) {
      if (address) address += ', ';
      address += leadAddress;
    }
    return address || '_______________________';
  };

  // Get lease term in words and numbers
  const getLeaseTermDescription = () => {
    if (!leaseTerm) return 'One (1) year';
    
    const terms = {
      '1': 'One (1) year',
      '2': 'Two (2) years',
      '3': 'Three (3) years',
      '4': 'Four (4) years',
      '5': 'Five (5) years',
      '6': 'Six (6) months',
      '12': 'One (1) year'
    };
    
    return terms[leaseTerm.toString()] || `${leaseTerm} ${leaseTerm === '1' ? 'year' : 'years'}`;
  };

  // Get bedroom description
  const getBedroomDescription = () => {
    if (!bedrooms) return '_____';
    const descriptions = {
      '1': 'One bedroom',
      '2': 'Two bedrooms',
      '3': 'Three bedrooms',
      '4': 'Four bedrooms',
      '5': 'Five bedrooms'
    };
    return descriptions[bedrooms.toString()] || `${bedrooms} bedroom${bedrooms !== '1' ? 's' : ''}`;
  };

  // Get bathroom description
  const getBathroomDescription = () => {
    if (!bathrooms) return '_____';
    const descriptions = {
      '1': 'One bathroom',
      '2': 'Two bathrooms',
      '3': 'Three bathrooms',
      '4': 'Four bathrooms'
    };
    return descriptions[bathrooms.toString()] || `${bathrooms} bathroom${bathrooms !== '1' ? 's' : ''}`;
  };

  // Format escalation frequency
  const getEscalationFrequency = () => {
    if (!escalationFrequency) return 'annually';
    switch(escalationFrequency) {
      case 'ANNUALLY': return 'annually';
      case 'BI_ANNUALLY': return 'every two years';
      case 'MONTHLY': return 'monthly';
      case 'QUARTERLY': return 'quarterly';
      default: return escalationFrequency.toLowerCase();
    }
  };

  // Get ordinal suffix for dates
  const getOrdinalSuffix = (n) => {
    if (!n) return '';
    const j = n % 10;
    const k = n % 100;
    if (j === 1 && k !== 11) return n + "st";
    if (j === 2 && k !== 12) return n + "nd";
    if (j === 3 && k !== 13) return n + "rd";
    return n + "th";
  };

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    @page {
      margin: 2.5cm 2cm;
      size: A4;
    }
    
    body {
      font-family: 'Times New Roman', Times, serif;
      line-height: 1.6;
      font-size: 12pt;
      color: #000;
      margin: 0;
      padding: 0;
    }
    
    .page-break {
      page-break-after: always;
    }
    
    .header {
      text-align: center;
      margin-bottom: 40px;
    }
    
    .header-line {
      margin: 10px 0;
      font-size: 12pt;
    }
    
    .title {
      font-size: 16pt;
      font-weight: bold;
      margin: 20px 0;
    }
    
    .party-section {
      text-align: center;
      margin: 40px 0;
      line-height: 2.5;
    }
    
    .party-name {
      font-weight: bold;
      font-size: 13pt;
    }
    
    .divider {
      border-top: 2px solid #000;
      margin: 40px auto;
      width: 80%;
    }
    
    .form-header-row {
      display: flex;
      justify-content: space-between;
      margin: 10px 0;
      font-size: 11pt;
    }
    
    .form-header-row > div {
      flex: 1;
      padding: 0 10px;
    }
    
    .form-title-section {
      text-align: center;
      margin: 30px 0;
      font-weight: bold;
      font-size: 13pt;
      line-height: 1.8;
    }
    
    .agreement-intro {
      margin: 25px 0;
      font-size: 12pt;
    }
    
    .details-table {
      width: 100%;
      border-collapse: collapse;
      margin: 20px 0;
      border: 1px solid #000;
    }
    
    .details-table td {
      border: 1px solid #000;
      padding: 12px;
      vertical-align: top;
      font-size: 11.5pt;
      line-height: 1.5;
    }
    
    .details-table td:first-child {
      width: 130px;
      font-weight: bold;
    }
    
    .bank-details-table {
      width: 100%;
      border-collapse: collapse;
      margin: 15px 0;
      border: 1px solid #000;
    }
    
    .bank-details-table td {
      border: 1px solid #000;
      padding: 10px;
      font-size: 11.5pt;
    }
    
    .bank-details-table td:first-child {
      width: 150px;
      font-weight: bold;
    }
    
    .clause-section {
      margin: 15px 0;
    }
    
    .clause-title {
      font-weight: bold;
      margin: 20px 0 15px 0;
      font-size: 12pt;
    }
    
    .bullet-point {
      margin: 12px 0 12px 0;
      text-align: justify;
      position: relative;
      padding-left: 0;
      line-height: 1.6;
    }
    
    .bullet-point:before {
      content: "- ";
      position: absolute;
      left: -15px;
      font-weight: bold;
    }
    
    .nested-bullet {
      margin: 10px 0 10px 20px;
      text-align: justify;
      position: relative;
      padding-left: 0;
      line-height: 1.6;
    }
    
    .nested-bullet:before {
      content: "- ";
      position: absolute;
      left: -15px;
    }
    
    .signature-section {
      margin-top: 50px;
      page-break-inside: avoid;
    }
    
    .signature-block {
      margin: 30px 0;
      line-height: 1.8;
      page-break-inside: avoid;
    }
    
    .signature-header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      margin-bottom: 10px;
    }
    
    .signature-left {
      flex: 1;
    }
    
    .signature-right {
      text-align: right;
      padding-right: 20px;
    }
    
    .signature-line {
      margin: 20px 0;
      min-height: 25px;
    }
    
    .certificate-box {
      border: 2px solid #000;
      padding: 15px;
      margin: 25px 0;
      page-break-inside: avoid;
    }
    
    .certificate-title {
      font-weight: bold;
      text-align: center;
      margin-bottom: 15px;
      text-decoration: underline;
      font-size: 11.5pt;
    }
    
    .certificate-content {
      text-align: justify;
      line-height: 1.6;
      font-size: 11.5pt;
    }
    
    .certificate-signature {
      margin-top: 25px;
      text-align: center;
      border-top: 1px solid #000;
      padding-top: 5px;
      display: inline-block;
      width: 60%;
      margin-left: 20%;
    }
    
    strong {
      font-weight: bold;
    }
    
    .whereas-section {
      margin: 25px 0;
      font-weight: bold;
    }
    
    .witness-clause {
      margin: 30px 0;
      font-weight: bold;
      text-align: center;
      font-size: 12pt;
    }
    
    .tenant-contact-info {
      margin-top: 5px;
      font-size: 11pt;
    }
    
    .property-details-box {
      border: 1px solid #000;
      padding: 15px;
      margin: 15px 0;
      background-color: #f9f9f9;
    }
    
    .additional-info {
      margin: 20px 0;
      padding: 10px;
      border: 1px dashed #666;
    }
  </style>
</head>
<body>
  <!-- Page 1: Cover Page -->
  <div class="header">
    <div class="header-line">DATED the <strong>${agreementDate.day || '……'}</strong> DAY OF <strong>${agreementDate.month ? agreementDate.month.toUpperCase() : '…..'}</strong> <strong>${agreementDate.year || '2025'}</strong></div>
    
    <div class="title">TENANCY AGREEMENT</div>
    
    <div class="header-line">IN RESPECT OF HOUSE NO. <strong>${houseNumber || '………..'}</strong></div>
    
    <div class="title">THE BUILDING CHRISTENED AS "<strong>${propertyName || 'xxxxxxxxxxxxxxxxxxxxxxxx'}</strong>"</div>
    
    <div class="property-details-box">
      <strong>Property Location:</strong> ${formatPropertyAddress()}<br>
      <strong>House Type:</strong> ${getBedroomDescription()} ${getBathroomDescription()} Apartment<br>
      <strong>Floor:</strong> ${floorNumber || '_____'} Floor
    </div>
  </div>

  <div class="party-section">
    <div>between</div>
    <br>
    <div class="party-name">${landlordName || 'xxxxxxxxxxxxxxxxxxxxxxxxx'}</div>
    <div>${formatLandlordAddress()}</div>
    <div>${landlordIDNumber ? `ID No: ${landlordIDNumber}` : ''}</div>
    <div>(the "Landlord")</div>
    <br>
    <div>and</div>
    <br>
    <div class="party-name">${leadName || '…xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx'}</div>
    <div>${formatTenantAddress()}</div>
    <div class="tenant-contact-info">
      ${leadIDNumber ? `ID No: ${leadIDNumber}` : ''} ${leadPINNumber ? `| PIN No: ${leadPINNumber}` : ''}<br>
      ${leadEmail ? `Email: ${leadEmail}` : ''} ${leadPhone ? `| Phone: ${leadPhone}` : ''}
    </div>
    <div>(the "Tenant")</div>
  </div>

  <div class="divider"></div>

  <div class="page-break"></div>

  <!-- Page 2: Agreement Details -->
  <div class="form-header-row">
    <div><strong>Date Received</strong><br>……………………………..</div>
    <div><strong>Presentation Book</strong><br>No. ……………………..</div>
    <div><strong>Official Fees Paid</strong><br>Kshs.</div>
  </div>

  <p style="margin: 20px 0; font-size: 11pt;">Form LRA 62 &nbsp;&nbsp;&nbsp; (r. 76(1))</p>

  <div class="form-title-section">
    REPUBLIC OF KENYA<br>
    THE LAND REGISTRATION ACT<br>
    THE LAND REGISTRATION (GENERAL) REGULATIONS, 2017<br>
    TENANCY AGREEMENT
  </div>

  <p class="agreement-intro">
    THIS TENANCY AGREEMENT is made on the <strong>${agreementDate.day || '____'}</strong> day of <strong>${agreementDate.month || '____________'}</strong> <strong>${agreementDate.year || '20____'}</strong>
  </p>

  <table class="details-table">
    <tr>
      <td>Landlord</td>
      <td>
        <strong>${landlordName || 'xxxxxxxxxxxxxxxxxx'}</strong> of Post Office Box <strong>${landlordPOBox || 'xxxxxxxxxxxxx'}</strong> ${landlordAddress || ''} in the Republic of Kenya ${landlordIDNumber ? `(ID No: ${landlordIDNumber})` : ''} (the "Landlord" which expression shall where the context so requires include the Landlord's personal representatives and assigns)
      </td>
    </tr>
    <tr>
      <td>Tenant</td>
      <td>
        <strong>${leadName || '…………………………………………………………………………………'}</strong> of Post Office Box Number <strong>${leadPOBox || '………………………………'}</strong> ${leadAddress || ''} ${leadIDNumber ? `(ID No: ${leadIDNumber})` : ''} ${leadPINNumber ? `(PIN No: ${leadPINNumber})` : ''} in the said Republic (the "Tenant" which expression shall where the context so requires include the Tenant's personal representatives and assigns)
      </td>
    </tr>
    <tr>
      <td>Premises</td>
      <td>
        House/Apartment No. <strong>${houseNumber || '………………..'}</strong> on the <strong>${floorNumber || '…………………….'}</strong> Floor of the building christened as <strong>${propertyName || 'xxxxxxxxxxxxxxx'}</strong> located at ${propertyAddress || '_______________________'} ${propertyLRNumber ? `(LR No: ${propertyLRNumber})` : ''}. The Premises comprise of ${getBedroomDescription()} and ${getBathroomDescription()}.
      </td>
    </tr>
    <tr>
      <td>Term</td>
      <td>
        ${getLeaseTermDescription()} from the ${startDate.day ? getOrdinalSuffix(startDate.day) : '1st'} day of ${startDate.month || '……………..'} ${startDate.year || '20…….'}. The Landlord shall at his absolute discretion renew this Tenancy Agreement on the same terms contained herein for a further Term of ${getLeaseTermDescription()} at a rent to be determined by the Landlord.
      </td>
    </tr>
    <tr>
      <td>Rents</td>
      <td>
        The monthly rent for the Premises shall be Kenya Shillings ${rentAmount ? new Intl.NumberFormat('en-KE', { style: 'decimal' }).format(rentAmount) : '......................................…………………………………… ………………… …………………………………………………………………………………'} (Kshs. <strong>${rentAmount ? new Intl.NumberFormat('en-KE').format(rentAmount) : '……………………….'}/=</strong>) payable monthly in advance not later than the 5th day of every month in cleared funds without any setoff, deductions or counterclaims whatsoever.
        ${rentStartDate ? `<br><br><strong>Rent Commencement Date:</strong> ${rentStartDateFormatted.day ? getOrdinalSuffix(rentStartDateFormatted.day) : '____'} day of ${rentStartDateFormatted.month || '____________'} ${rentStartDateFormatted.year || '20____'}` : ''}
        ${escalationRate ? `<br><br><strong>Rent Escalation:</strong> The rent shall be subject to an escalation of ${escalationRate}% ${getEscalationFrequency()}.` : ''}
      </td>
    </tr>
    <tr>
      <td>Deposit</td>
      <td>
        On the commencement of the Term, Tenant shall pay to the Landlord, and maintain throughout the Term, Deposit of Rent of the sum of Kenya Shillings <strong>${totalDeposit ? new Intl.NumberFormat('en-KE').format(totalDeposit) : '………………………………… ……………….. ……………………. …….'}</strong> (equivalent to one month rent), Water Deposit of Kenya Shillings Two Thousand and Five Hundred (Kshs. 2,500/=) and Electricity Deposit of Kenya Shillings One Thousand (Kshs. 1,000/=). The Deposit shall be retained by the Landlord as security for the due performance by the Tenant of the Tenant's obligations under this Tenancy Agreement. The Deposit is refundable without interest to the Tenant after the expiry of the Tenancy Agreement and yield up of the Premises in accordance with the covenants contained in this Agreement less any outstandings that may be due by the Tenant to the Landlord, PROVIDED THAT the Landlord may apply the deposit to redecorate, repaint, varnish and or polish the house or to repair plumbing and electrical installations of the Premises to the same state as they were at the commencement of the Term. The Deposit shall not be utilised by the Tenant on account of the payment of Rent, water or electricity bills for any month (or longer period) of the Term.
      </td>
    </tr>
    <tr>
      <td>Service Charge</td>
      <td>
        The Landlord shall provide the Tenant with water, and engage a private garbage collector to collect and dispose off garbage from the Premises. The Tenant shall pay to the Landlord Kenya Shillings <strong>${serviceCharge ? new Intl.NumberFormat('en-KE').format(serviceCharge) : '………………………………………………'}</strong> (Kshs. <strong>${serviceCharge ? new Intl.NumberFormat('en-KE').format(serviceCharge) : '………………'}/=</strong>) on account of water bills per cubic meter and Kenya Shillings Two Hundred (Kshs. 200/=) on account of garbage collection fees in cleared funds without any set off, deductions or counterclaims whatsoever (together hereinafter referred to as "Service Charge"). Service Charge shall be paid together with, and in addition to the monthly rent reserved herein. In the event the cost of providing water and garbage collection services increases beyond the amount set forth herein, the Tenant shall reimburse such increase to the Landlord by an increase of the Service Charge payable per month to correspond with the amount of increase of the Service Charge.
      </td>
    </tr>
  </table>

  <div class="additional-info">
    <strong>Offer Reference:</strong> ${offerNumber || 'N/A'}<br>
    <strong>Tenant Contact:</strong> ${leadPhone ? `Phone: ${leadPhone}` : ''} ${leadEmail ? `| Email: ${leadEmail}` : ''}
  </div>

  <div class="whereas-section">
    <p><strong>WHEREAS:</strong></p>
  </div>

  <div class="clause-section" style="margin-left: 15px;">
    <div class="bullet-point">
      The Landlord has agreed with the Tenant to grant to the Tenant a tenancy over the Premise for the Term at the Rent and subject to the covenants agreements conditions restrictions stipulations and provisions hereinafter contained.
    </div>
  </div>

  <p class="clause-title">NOW THIS TENANCY AGREEMENT WITNESSES AS FOLLOWS:</p>

  <div class="clause-section" style="margin-left: 15px;">
    <div class="bullet-point">
      The Landlord as the legal and or beneficial owner of the Premises HEREBY LEASES to the Tenant the Premises for the Term subject to the payment of Rent and subject to the conditions set out in this Tenancy Agreement;
    </div>

    <div class="bullet-point">
      The Tenant HEREBY COVENANTS with the Landlord:-
    </div>

    <div class="bullet-point">
      To pay the Rent, Deposit and Service Charge in the manner aforesaid in cleared funds without any deductions, setoff or counterclaim whatsoever to the following bank account, or to such other bank account as the Landlord shall notify the Tenant in writing:
    </div>

    <table class="bank-details-table" style="margin-left: 0; margin-top: 15px;">
      <tr>
        <td>Bank:</td>
        <td>${landlordBankName || 'xxxxxxxxxxxxxxxx'}</td>
      </tr>
      <tr>
        <td>Account Name:</td>
        <td>${landlordAccountName || 'xxxxxxxxxxxxxxxx'}</td>
      </tr>
      <tr>
        <td>Account Number:</td>
        <td>${landlordBankAccount || 'zxxxxxxxxxx'}</td>
      </tr>
      <tr>
        <td>Branch</td>
        <td>${landlordBankBranch || 'xxxxxxxxxxxxx'}</td>
      </tr>
      <tr>
        <td>Branch Code</td>
        <td>${landlordBankBranchCode || '__________'}</td>
      </tr>
      <tr>
        <td>Swift Code</td>
        <td>${landlordSwiftCode || 'xxxxxxxxxxxxxxxxxxx'}</td>
      </tr>
      ${landlordMpesaPaybill ? `
      <tr>
        <td colspan="2">
          <strong>Alternative Mpesa Payment:</strong><br>
          Paybill Number: ${landlordMpesaPaybill}<br>
          Account Number: ${landlordMpesaAccount || 'Tenant Name'}
        </td>
      </tr>
      ` : ''}
    </table>

    <div class="bullet-point">
      The Tenant shall not withhold the payment of Rent or any other amount payable in terms of this Tenancy Agreement for any reason whatsoever and/or to attach any condition to any payment;
    </div>

    <div class="bullet-point">
      To be responsible for, and to pay all water and electricity charges which become or shall be payable in respect of the Premises during the Term, and to indemnify and keep indemnified the Landlord for the same;
    </div>

    <div class="bullet-point">
      The Landlord shall be entitled in his discretion to appropriate any payment received from the Tenant towards the payment of any debt owing by the Tenant to the Landlord in terms of this Tenancy Agreement;
    </div>

    <div class="page-break"></div>

    <!-- Page 3 -->
    <div class="bullet-point">
      The Landlord shall not be responsible for any disruption or stoppage of water, electricity or other utility supply to the Premises;
    </div>

    <div class="bullet-point">
      To co-operate in the management of the Premises and adhere to any rules and regulations that the Landlord may from time to time determine;
    </div>

    <div class="bullet-point">
      To repair and keep in good and substantial repair and condition the interior of the Premises and every part thereof and when necessary to replace any of the Landlord's fixtures and fittings which may be or become beyond repair with new ones which are similar in type and quality;
    </div>

    <div class="bullet-point">
      Not to make nor permit to be made alterations in or additions to the said Premises nor to erect any fixtures therein nor drive any nails, screws, bolts or wedges in the floors, walls or ceilings thereof without the consent in writing of the Landlord first obtained and on termination of the tenancy to make good the removal of any such nails, screws, bolts or wedges;
    </div>

    <div class="bullet-point">
      To permit the Landlord, his agent/s, workmen or servants at all reasonable times on notice (whether oral or written) to enter upon the Premises or any part thereof and exercise structural or other repairs to the Premises or to the electrical circuits, water pipes and drainage system or other repairs which the Landlord is responsible to carry out hereunder;
    </div>

    <div class="bullet-point">
      To use the Premises for private residential purposes only for one (1) family and not carry out any form of business or use them as a boarding house or any other unauthorised purpose or illegal or immoral;
    </div>

    <div class="bullet-point">
      Not to transfer, lease, charge or sub-let the Premises or any part thereof during the period of the tenancy;
    </div>

    <div class="bullet-point">
      To use electricity or gas cookers, and not to use charcoal, wood or any other means of cooking or lighting within the building;
    </div>

    <div class="bullet-point">
      To be responsible for all damage which is incurred as a result of negligence or wilful act or default of the Tenant on the Premises including the walls, ceilings, floors, windows and door and to repair the same at its own expense which costs and expenses shall not be deductible from the Rent;
    </div>

    <div class="bullet-point">
      At all times to comply with the conditions of insurance of the Landlord in respect of the Premises (being structural insurance) and NOT to do or permit or suffer to be done anything whereby any Insurance of the Premises against loss or damage by fire or any other risk insured against may be void or violable or whereby the rate of premium for any such insurance may be increased and to repay to the Landlord all sums paid by way of increased premium and all expenses incurred by him in or about the renewal of any such policy rendered necessary by a breach of this covenant and all such payments shall be added to the rent hereinbefore reserved and be recovered as rent. The Tenant shall be responsible for effecting and paying for his or her own house contents insurance;
    </div>

    <div class="bullet-point">
      Not to do or permit or suffer to be done anything in or upon the Premises or any part thereof which may at any time be or become or shall in the sole opinion of the Landlord be considered a nuisance or annoyance to the neighbours or injurious or detrimental to the reputation of the Premises;
    </div>

    <div class="bullet-point">
      Not to deposit or permit to be deposited any waste rubbish or refuse on or in any part of the Building other than in the refuse chute or receptacles designated for that purpose;
    </div>

    <div class="bullet-point">
      Not to use or suffer to be used any of the lavatories, sinks and water closets for the disposal of refuse or for any purpose which may cause a blockage;
    </div>

    <div class="bullet-point">
      To comply with the notices and demands issued to or served upon the Tenant as soon as reasonably practical but in any event within 14 days of such notice or as specified in the notice;
    </div>

    <div class="bullet-point">
      The Tenant covenants with the Landlord that he/she has inspected the Premises at the commencement of the Term and satisfied himself/herself that the Premises is in a good state of repair and decoration, and that the Landlord shall not be required to carry out any decoration or repair of the Premises or to replace any fixture or fitting therein;
    </div>

    <div class="bullet-point">
      At the expiration of the Term, unless the Term is extended or renewed by the Landlord, to yield up the Premises to the Landlord in good and substantial repair and condition in accordance with the covenants contained herein;
    </div>

    <div class="page-break"></div>

    <!-- Page 4 -->
    <div class="bullet-point">
      In the last month of the Term (howsoever determined) to redecorate the Premises to the same state as at the commencement of the Term, fair wear and tear excepted;
    </div>

    <div class="bullet-point">
      The Landlord HEREBY COVENANTS with the Tenant to permit the Tenant paying the Rent and Service Charge hereby reserved and performing and observing all agreements terms and conditions herein contained or implied and on their part to be performed and observed shall and may peacefully and quietly hold possess and enjoy the Premises during the Term without any interruptions from or by the Landlord or any person claiming on his behalf.
    </div>

    <div class="bullet-point">
      <strong>IT IS HEREBY AGREED that:</strong>
    </div>

    <div class="bullet-point">
      If the Rent or any other amount due hereunder shall be in arrears for more than fourteen (14) days after the same has become due and payable, whether demanded or not, or if the Tenant shall fail to perform and observe any of the agreements herein contained or implied and have not complied with any notices in respect of such breach or non-payment, it shall be lawful for the Landlord at any time thereafter to terminate the Agreement, re-enter into the Premises and to again repossess the same without prejudice to any right of action or remedy of the Landlord in respect of any antecedent breach of any of the covenants herein contained or implied or take whatever action it deems fit to recover such arrears or to remedy such breach;
    </div>

    <div class="bullet-point">
      The Tenant shall indemnify the Landlord on an unqualified indemnity basis against all liability in respect of all proceedings damages penalties costs losses expenses claims and demands of whatsoever nature and in respect of any act, omission, or default of the Tenant or the respective Tenant's invitees or visitors;
    </div>

    <div class="bullet-point">
      In the event the Rent shall be in arrears or if any such payment is dishonoured then interest shall be charged on any outstanding amount at the rate of eighteen percent (18%) per month from the date when such sums become due and payable until payment thereof in full both days inclusive;
    </div>

    <div class="bullet-point">
      The receipt by the Landlord of any rents with knowledge of the breach of, and the failure of the Landlord to seek redress for breach of, or to insist on strict performance of any covenant agreement condition restriction stipulation or provision of this Tenancy Agreement shall not be deemed to be a waiver of such breach nor shall the failure of the Landlord to enforce any such rule or regulation as aforesaid against the Tenant be deemed to be a waiver of any such rules and regulations;
    </div>

    <div class="bullet-point">
      No provision of this Tenancy Agreement shall be deemed to have been waived unless the waiver be expressly made by the Landlord in writing;
    </div>

    <div class="bullet-point">
      If the Tenant shall make default in paying any sum required to be paid pursuant hereto (including without limitation, the Rent and Service Charge) such sum shall be recoverable (whether formally demanded or not) as if rent in arrears and the power of the Landlord to distrain upon the Premises for rent in arrears including any such sum as aforesaid shall extend to and include any Tenant's chattels, fixtures and fittings not otherwise distrainable by law which may from time to time be thereon;
    </div>

    <div class="bullet-point">
      The Tenant irrevocably appoints the Landlord to be the Tenant's agent to store or dispose of any effects left by the Tenant on the Premises for more than ten (10) days of the Tenant vacating the Premises after the determination of the Term on such terms as the Landlord in his sole discretion deems fit;
    </div>

    <div class="bullet-point">
      The Tenant shall fully indemnify the Landlord, and shall keep the Landlord fully indemnified against all actions, proceedings, claims, demands, losses, costs, expenses, damages, liability arising in any way directly or indirectly out of any action of the Tenant or breach of any of the obligations of the Tenant under this Tenancy Agreement;
    </div>

    <div class="bullet-point">
      Any notice or demand required to be given to or served on a Party under this Tenancy Agreement shall be validly made, given or served if addressed to the Party and delivered personally, sent via the last known email address (${leadEmail || 'tenant@email.com'}) or sent by registered post or delivered to the Premises;
    </div>

    <div class="bullet-point">
      A notice or demand shall be deemed shall be deemed to have been duly served forthwith on delivery or transmission of email or 96 hours after the letter containing the same is sent;
    </div>

    <div class="page-break"></div>

    <!-- Page 5 -->
    <div class="bullet-point">
      Each Party has been free to secure, and has secured independent legal advise as to the nature and effects of this Tenancy Agreement;
    </div>

    <div class="bullet-point">
      This Tenancy Agreement constitutes the entire agreement between the Parties in respect of the matters dealt with herein and supersedes cancels and nullifies any previous agreement or arrangement between the Parties in relation to such matters notwithstanding the terms of any such agreement or arrangement including any terms as to any rights or provisions expressed to survive termination;
    </div>

    <div class="bullet-point">
      No provision of this Tenancy Agreement shall be waived or varied by either Party hereto except in writing;
    </div>

    <div class="bullet-point">
      The rule known as contra proferentem rule shall not apply to the construction and interpretation of this Agreement.
    </div>

    <div class="bullet-point">
      The Landlord or its agents shall not be liable for any loss or damage or injury to the Tenant their employees agents licensees visitors or invitees of the Premises or any such persons caused by or resulting from or arising out of:
    </div>

    <div class="nested-bullet">
      Any defects in the buildings including the Premises or any defective or negligent working construction or maintenance of the lighting or other parts of the structure or equipment of the Premises;
    </div>

    <div class="nested-bullet">
      Any act or default (negligent or otherwise) of the Landlord its employees or agents;
    </div>

    <div class="nested-bullet">
      Any lack or shortage of electricity water or drainage;
    </div>

    <div class="nested-bullet">
      Any burglary or theft or break-in;
    </div>

    <div class="nested-bullet">
      Any fire or explosion howsoever occurring;
    </div>

    <div class="nested-bullet">
      Any falling plaster rain or leaks;
    </div>

    <p style="margin: 15px 0 15px 0;">AND the Tenants shall indemnify the Landlord against all or any actions claims or proceedings by the Tenants' employees servants invitees visitors licensees and others claiming through the Tenants in respect of such damage or loss or injury;</p>

    <div class="bullet-point">
      The Tenant and the Landlord shall each be entitled to terminate this Agreement upon giving the other party one (1) calendar month's written notice of their intention to do so and at the expiration of such period of notice this Agreement shall cease and determine but without prejudice to any right of action accrued to either party during the currency of the Agreement PROVIDED ALWAYS that the Landlord may terminate this Agreement with immediate effect if there is an existing breach or non-observance of any of the agreements conditions and stipulations and provisions on the part of the Tenant herein contained. Where the Tenant gives a termination notice shorter than one calendar month, the Tenant shall pay to the Landlord a sum equivalent to one month rent in lieu of the notice;
    </div>

    <div class="bullet-point">
      If the Tenant after notice in writing given to it by the Landlord requiring it to carry out any work or repair or redecoration for which it is lawfully liable shall fail to commence and diligently proceed with such works within thirty (30) days it shall be lawful for the Landlord giving such notice to carry out and execute such works and the cost thereof shall be a debt due from the Tenant and be forthwith recoverable by action or additional to the Rent;
    </div>

    <div class="bullet-point">
      Any dispute, difference or question whatsoever which may arise between the parties including the interpretation of rights and liabilities of either party shall first be referred to negotiation prior to a court of competent jurisdiction;
    </div>

    <div class="bullet-point">
      The provisions of Part VI of The Land Act 2012 shall apply as may have been varied or amended in this Agreement;
    </div>

    ${additionalTerms ? `
    <div class="bullet-point">
      <strong>ADDITIONAL TERMS:</strong><br>
      ${additionalTerms}
    </div>
    ` : ''}
  </div>

  <p class="witness-clause">IN WITNESS WHEREOF this Tenancy Agreement is executed as a deed by the Parties hereto the day and year mentioned above.</p>

  <!-- Signature Sections -->
  <div class="signature-section">
    <div class="signature-block">
      <div class="signature-header">
        <div class="signature-left">
          <strong>SIGNED by the Landlord the said</strong>
        </div>
        <div class="signature-right">)</div>
      </div>
      <div class="signature-header">
        <div class="signature-left">
          <strong>${landlordName || 'xxxxxxxxxxxxxxxxxxxxxxx'}</strong>
        </div>
        <div class="signature-right">)</div>
      </div>
      <div class="signature-header">
        <div class="signature-left">
          in the presence of:-
        </div>
        <div class="signature-right">)* …………………………………………………</div>
      </div>
      <div class="signature-header">
        <div class="signature-left">
          &nbsp;
        </div>
        <div class="signature-right">)</div>
      </div>
      <div class="signature-header">
        <div class="signature-left">
          &nbsp;
        </div>
        <div class="signature-right">)</div>
      </div>
      <div class="signature-header">
        <div class="signature-left">
          <strong>Advocate</strong>
        </div>
        <div class="signature-right">)</div>
      </div>
      <div class="signature-header">
        <div class="signature-left">
          &nbsp;
        </div>
        <div class="signature-right">)</div>
      </div>
      <div class="signature-header">
        <div class="signature-left">
          &nbsp;
        </div>
        <div class="signature-right">)</div>
      </div>
    </div>

    <div class="certificate-box">
      <div class="certificate-title">Certificate of Verification under Section 45 of the Land Registration Act</div>
      <div class="certificate-content">
        I CERTIFY that .............................................................. appeared before me on .................................................... and being known to me acknowledged the above signature or mark to be his and that he had freely and voluntarily executed this instrument and understood its contents.
      </div>
      <div class="certificate-signature">
        Name and signature of person certifying
      </div>
    </div>

    <div class="signature-block">
      <div class="signature-header">
        <div class="signature-left">
          <strong>SIGNED by the Tenant the said</strong>
        </div>
        <div class="signature-right">)</div>
      </div>
      <div class="signature-header">
        <div class="signature-left">
          &nbsp;
        </div>
        <div class="signature-right">)</div>
      </div>
      <div class="signature-header">
        <div class="signature-left">
          <strong>${leadName || '…………………………………………………….'}</strong>
        </div>
        <div class="signature-right">)</div>
      </div>
      <div class="signature-header">
        <div class="signature-left">
          in the presence of:-
        </div>
        <div class="signature-right">)* …………………………………</div>
      </div>
      <div class="signature-header">
        <div class="signature-left">
          &nbsp;
        </div>
        <div class="signature-right">)</div>
      </div>
      <div class="signature-header">
        <div class="signature-left">
          &nbsp;
        </div>
        <div class="signature-right">) ID No: ${leadIDNumber || '………………………….'}</div>
      </div>
      <div class="signature-header">
        <div class="signature-left">
          <strong>Advocate</strong>
        </div>
        <div class="signature-right">)</div>
      </div>
      <div class="signature-header">
        <div class="signature-left">
          &nbsp;
        </div>
        <div class="signature-right">) PIN No: ${leadPINNumber || '………………………..'}</div>
      </div>
      <div class="signature-header">
        <div class="signature-left">
          &nbsp;
        </div>
        <div class="signature-right">)</div>
      </div>
      <div class="signature-header">
        <div class="signature-left">
          <strong>Contact:</strong> ${leadPhone || '________________'} | ${leadEmail || '________________'}
        </div>
        <div class="signature-right">)</div>
      </div>
    </div>

    <div class="certificate-box">
      <div class="certificate-title">Certificate of Verification under Section 45 of the Land Registration Act</div>
      <div class="certificate-content">
        I CERTIFY that .............................................................. appeared before me on .................................................... and being known to me/being identified by *.................................................... of .............................................. acknowledged the above signature or mark to be his/hers and that he/she had freely and voluntarily executed this instrument and understood its contents.
      </div>
      <div class="certificate-signature">
        Name and signature of person certifying
      </div>
    </div>
  </div>

  <div style="margin-top: 30px; padding: 10px; border-top: 2px solid #ccc; font-size: 9pt; color: #666;">
    <p><strong>Offer Reference Number:</strong> ${offerNumber || 'Not Provided'}</p>
    <p><strong>Tenant Contact Details:</strong> ${leadPhone || 'Phone: Not Provided'} | ${leadEmail || 'Email: Not Provided'}</p>
    <p><strong>Property Reference:</strong> ${propertyName || 'Not Provided'} ${houseNumber ? `| House No: ${houseNumber}` : ''} ${floorNumber ? `| Floor: ${floorNumber}` : ''}</p>
    <p><strong>Generated Date:</strong> ${new Date().toLocaleDateString('en-GB')}</p>
  </div>
</body>
</html>
  `;
};