/**
 * Commercial Offer Letter Template (LOF)
 * For Commercial, Industrial, and Institutional properties
 * Updated to match exact document structure and wording
 */
export const generateCommercialOfferLetter = (data) => {
  const {
    propertyName,
    propertyAddress,
    propertyLRNumber,
    landlordName,
    landlordPOBox,
    landlordAddress,
    tenantName,
    tenantPOBox,
    tenantAddress,
    date,
    floor,
    areaSqFt,
    rentPerSqFt,
    totalRent,
    leaseTerm,
    leaseStartDate,
    fitOutPeriod,
    escalationRate,
    escalationFrequency,
    serviceChargePerSqFt,
    totalServiceCharge,
    serviceChargeEscalation = '5',
    vatRate = 16,
    securityDepositMonths = 3,
    securityDepositAmount,
    userPurpose,
    paymentPolicy = 'QUARTERLY',
    additionalTerms,
    bankDetails,
    legalFees,
    promotionExpenses,
    includeTerrace = false
  } = data;

  // Calculate derived values
  const totalRentValue = totalRent || (rentPerSqFt * areaSqFt);
  const totalServiceChargeValue = totalServiceCharge || (serviceChargePerSqFt * areaSqFt);
  const securityDepositValue = securityDepositAmount || (totalRentValue + totalServiceChargeValue) * securityDepositMonths;
  const vatAmount = (totalRentValue + totalServiceChargeValue) * securityDepositMonths * (vatRate / 100);
  const advancePayment = (totalRentValue + totalServiceChargeValue) * securityDepositMonths;
  const totalInitialPayment = securityDepositValue + advancePayment + vatAmount;

  // Convert total payment to words for legal clarity
  const totalInWords = convertNumberToWords(Math.round(totalInitialPayment));

  // Format payment policy text
  const paymentPolicyText = paymentPolicy === 'MONTHLY' ? 'monthly' : 
                           paymentPolicy === 'QUARTERLY' ? 'quarterly' : 
                           paymentPolicy === 'ANNUALLY' ? 'annually' : 'quarterly';

  // Format escalation frequency
  const escalationText = escalationFrequency === 'BI_ANNUALLY' ? 'Six (6)' : 'Twelve (12)';

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    body {
      font-family: 'Times New Roman', Times, serif;
      line-height: 1.6;
      margin: 40px 60px;
      font-size: 12pt;
      color: #000;
    }
    .header {
      text-align: left;
      margin-bottom: 40px;
    }
    .property-name {
      font-weight: bold;
      font-size: 11pt;
      margin-bottom: 10px;
    }
    .date-section {
      display: flex;
      justify-content: space-between;
      margin-bottom: 30px;
    }
    .attn-section {
      flex: 1;
    }
    .date-right {
      text-align: right;
      flex: 1;
    }
    .subject {
      font-weight: bold;
      text-align: right;
      margin: 20px 0;
    }
    .recipient {
      margin-bottom: 25px;
    }
    .salutation {
      margin-bottom: 25px;
    }
    .re-line {
      font-weight: bold;
      margin: 25px 0;
      line-height: 1.8;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      margin: 25px 0;
    }
    table td {
      padding: 10px 8px;
      border: 1px solid #000;
      vertical-align: top;
      text-align: left;
      line-height: 1.6;
    }
    table td:first-child {
      width: 35px;
      text-align: center;
      font-weight: bold;
    }
    table td:nth-child(2) {
      width: 180px;
      font-weight: bold;
    }
    .list-item {
      margin-left: 30px;
      text-indent: -20px;
      margin-bottom: 5px;
    }
    .signature-section {
      margin-top: 50px;
      margin-bottom: 80px;
    }
    .signature-block {
      margin-top: 60px;
    }
    .acceptance-section {
      margin-top: 80px;
      page-break-before: always;
    }
    .acceptance-title {
      font-weight: bold;
      text-align: center;
      text-decoration: underline;
      margin: 30px 0;
      font-size: 12pt;
    }
    .payment-table {
      width: 100%;
      border: none;
      margin: 20px 0;
    }
    .payment-table td {
      border: none;
      padding: 5px 0;
    }
    .payment-table td:first-child {
      width: 70%;
      text-align: left;
    }
    .payment-table td:last-child {
      width: 30%;
      text-align: left;
    }
    .seal-section {
      text-align: center;
      font-weight: bold;
      margin: 40px 0 60px 0;
      line-height: 2;
    }
    .witness-section {
      margin: 60px 0;
      display: flex;
      justify-content: space-between;
    }
    .witness-block {
      width: 45%;
    }
    .certification-box {
      border: 1px solid #000;
      padding: 20px;
      margin-top: 60px;
    }
    .certification-title {
      font-weight: bold;
      text-align: center;
      text-decoration: underline;
      margin-bottom: 15px;
    }
    .underline-space {
      display: inline-block;
      border-bottom: 1px solid #000;
      min-width: 150px;
      margin: 0 5px;
    }
    .bold {
      font-weight: bold;
    }
    p {
      margin: 10px 0;
      text-align: justify;
    }
  </style>
</head>
<body>
  <div class="header">
    <div class="property-name">${propertyName || 'Property Name PO Box and location'}</div>
  </div>

  <div class="date-section">
    <div class="attn-section">
      <strong>ATTN,</strong>
    </div>
    <div class="date-right">
      Date: ${date || '……………..'}
    </div>
  </div>

  <div class="recipient">
    ${tenantName || 'xxxxxxxxxxxxxxx'}<br>
    ${tenantPOBox ? `P. O. Box ${tenantPOBox}` : 'P. O. Box …………………..'}${tenantAddress ? '<br>' + tenantAddress : '<br>………………...'}
  </div>

  <div class="subject">
    "Subject to Lease"
  </div>

  <div class="salutation">
    Dear ${tenantName ? (tenantName.includes(' ') ? tenantName.split(' ')[0] : tenantName) : '………………………….,'},
  </div>

  <div class="re-line">
    RE: OFFER TO LEASE COMMERCIAL SPACE ON THE ${floor ? floor.toUpperCase() : '……………'} FLOOR OF THE DEVELOPMENT ERECTED ON LAND REFERENCE L.R. NO. ${propertyLRNumber || '………………………………..'}
  </div>

  <p>
    Further to our discussions in respect to the referenced matter, we are pleased to offer to lease to you the commercial space${includeTerrace ? ' and the terrace abutting the commercial space' : ''} measuring approximately ${areaSqFt || '…………….'}  Square Feet on the ${floor || '……………'} Floor of the development erected on L.R. No. ${propertyLRNumber || '.…………..'} at ${propertyAddress || '…………….'}subject to contract, and subject to the following terms:
  </p>

  <table>
    <tr>
      <td>1.</td>
      <td>Premises:</td>
      <td>
        The Premise leased is the commercial space${includeTerrace ? ' and the terrace abutting the commercial space' : ''} measuring approximately ${areaSqFt || '………………'} Square Feet on the ${floor || '………………...'} Floor of the development erected on L.R. No. ${propertyLRNumber || '……………'} at ${propertyAddress || '……………'}
      </td>
    </tr>
    <tr>
      <td>2.</td>
      <td>Landlord:</td>
      <td>
        ${landlordName || 'XXXXXXXXXXXXXXXXXXXXX'}<br>
        ${landlordPOBox ? `P. O. Box ${landlordPOBox}` : 'P. O. Box XXXXXXXXXXXXX'}${landlordAddress ? '<br>' + landlordAddress : '<br>XXXXXXXX'}
      </td>
    </tr>
    <tr>
      <td>3.</td>
      <td>Tenant:</td>
      <td>
        ${tenantName || 'xxxxxxxxxxxxxxxxx'} Limited<br>
        ${tenantPOBox ? `P. O. Box ${tenantPOBox}` : 'P. O. Box xxxxxxx'}${tenantAddress ? '<br>' + tenantAddress : '<br>XXXXXXXXX.'}
      </td>
    </tr>
    <tr>
      <td>4.</td>
      <td>Term:</td>
      <td>
        ${leaseTerm || 'Six (6) Years'} from the 1<sup>st</sup> day of ${leaseStartDate ? new Date(leaseStartDate).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }) : 'XXX(Month) XXX(Year)'} or such other earlier date that the Parties shall agree.
      </td>
    </tr>
    <tr>
      <td>5.</td>
      <td>Guarantors:</td>
      <td>
        The Tenant's Directors shall issue and execute a personal Deed of Guarantee and Indemnity to the Landlord to guarantee the Tenant's fulfillment of its obligation under the Lease.
      </td>
    </tr>
    ${fitOutPeriod ? `
    <tr>
      <td>6.</td>
      <td>Fit Out Period:</td>
      <td>
        The Tenant shall be granted ${fitOutPeriod} rent free Fit Out Period. The Tenant shall undertake all the required Fit Out Works before the rent Commencement Date, and the Landlord hereby warrants and undertakes to grant to the Tenant with vacant possession on the 1<sup>st</sup> day of ${leaseStartDate ? new Date(leaseStartDate).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }) : 'xxx (Month) xxx(Year)'} or such other earlier date as the Tenant may require, provided that should the Tenant take possession of the Premises earlier than the 1<sup>st</sup> day of ${leaseStartDate ? new Date(leaseStartDate).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }) : 'May 2026'}, the Term Commencement Date shall be amended to two months after the Tenant takes possession of the Premises.
      </td>
    </tr>
    ` : ''}
    <tr>
      <td>${fitOutPeriod ? '7' : '6'}.</td>
      <td>Rent:</td>
      <td>
        The Rent which shall be payable from the Term Commencement Date shall be assessed at Kenya Shilling ${rentPerSqFt ? rentPerSqFt.toLocaleString() : 'xxxxxx'} per Square Foot aggregating to Kenya Shillings ${totalRentValue ? totalRentValue.toLocaleString() : 'xxxxxxxxxxxxxxxxxx'} (Kshs. ${totalRentValue ? totalRentValue.toLocaleString() : 'xxxxxxxxx'}/=) which shall escalate at the rate of ${escalationRate || 'xxx'}% after every ${escalationText} months after the Term Commencement Date. The rent is inclusive of service charge.<br><br>
        Rent shall be paid ${paymentPolicyText} in advance not later than the 5<sup>th</sup> day of every month upon presentation of an invoice, and if the rent is not paid by then, the Tenant shall pay the Landlord interest on the rent arrears at the rate of Fifteen Percent (15%) per month from the date the Rent fell due until the date it is paid in full. Interest shall be calculated on daily balances and debited monthly by way of compound interest.
      </td>
    </tr>
    <tr>
      <td>${fitOutPeriod ? '8' : '7'}.</td>
      <td>Service charge:</td>
      <td>
        The Service Charge levied at Ksh. ${serviceChargePerSqFt ? serviceChargePerSqFt.toLocaleString() : 'Xxxxx'} per sq.ft or ${totalServiceChargeValue ? totalServiceChargeValue.toLocaleString() : 'XX'} amount, which shall be payable either monthly or quarterly in advance together with the rent, shall cover all outgoings, operational costs and overheads relating to the building that shall include but not be limited to the following: -
        <div class="list-item">a) Electricity for common areas</div>
        <div class="list-item">b) Cleanliness for common areas</div>
        <div class="list-item">c) Insurance</div>
        <div class="list-item">d) Cost of periodic maintenance and decoration of common areas water pumps and other machinery</div>
        <div class="list-item">e) Maintenance of vehicle parking and delivery areas</div>
        <div class="list-item">f) Management costs</div>
        <div class="list-item">g) Rates and ground rents</div>
        <div class="list-item">h) Repairs of common areas</div>
        <div class="list-item">i) Security for common areas</div>
        <br>
        Service charge will be payable from the Term Commencement Date.<br><br>
        The Service Charge shall escalate at the rate of ${serviceChargeEscalation}% per annum after every 12 months from the Term Commencement Date.<br><br>
        The Service Charge does not cover electricity and water exclusively consumed by the Tenant, which will be metered separately and payable by the Tenant.
      </td>
    </tr>
    <tr>
      <td>${fitOutPeriod ? '9' : '8'}.</td>
      <td>VAT</td>
      <td>
        The Rent and Service Charge shall attract VAT at the prevailing rate, currently at the rate of ${vatRate}%. In addition to the above rental costs, the Tenant will be liable to pay on demand by the Landlord or to provide exemption certificate including exceptions from The Kenya Revenue Authority in accordance with the legal requirements of all Value Added Taxes or other taxes livable from time to time in law in respect of any amounts payable by the Tenant. Should the rate of VAT be varied during the Term, the Tenant shall pay VAT on the Rent at such higher or lower revised rate.
      </td>
    </tr>
    <tr>
      <td>${fitOutPeriod ? '10' : '9'}.</td>
      <td>Utilities:</td>
      <td>
        The Tenant shall pay for electricity consumed in their premises separately from the rent whether such electricity is supplied through the mains or through the Landlord's generator (if any) at the rate as shall be determined by the Landlord from time to time. All electricity will be sub-metered by the Landlord.<br><br>
        The Tenant shall not make any alterations or additions to the electrical equipment or appliances installed in the Demised Premises (even if the said equipment or appliances have been installed by the Tenant) without the prior written consent of the Landlord.<br><br>
        In the event the Tenant requires any riser or risers for the supply of the Tenant's electrical requirements the Tenant shall make written request therefor to the Landlord. The Landlord shall if in its sole judgement (which judgement will be final and binding upon the Tenant) decide whether or not to permit the installation of such riser or risers as are necessary and/or whether or not such riser or risers will cause damage or injury to the Mall or any part of it or to the electrical circuits to the Demised Premises or cause or create a dangerous or hazardous condition or entail extensive or unreasonable alterations repairs or expense. If the Landlord decides to permit such riser or risers, then the Tenant at the sole cost and expense of the Tenant and subject to the aforesaid terms and conditions also install in addition to such riser or risers all other equipment proper and necessary in connection therewith.<br><br>
        The Tenant shall procure the connection and provision of telephone, internet services and all other required utilities from the respective service providers of the Tenant's choice, and shall pay for telephone, water, internet and all such utilities to the respective service providers.<br><br>
        The Landlord shall not be responsible for the connection or provision of utilities and therefore, the Term or any of the Tenant's obligations under the Lease or this Letter of Offer shall not be affected by any delay or failure of provision of any of these utilities.
      </td>
    </tr>
    <tr>
      <td>${fitOutPeriod ? '11' : '10'}.</td>
      <td>Security Deposit:</td>
      <td>
        Together with the acceptance of this offer, the tenant will pay a Security Deposit of Rent and Service Charge in form of cash or bank guarantee and maintain with the landlord such Security during the Term of the Lease of a sum of Kenya Shillings ${securityDepositValue ? securityDepositValue.toLocaleString() : 'xxxxxxxxxxxx'} (Ksh. ${securityDepositValue ? securityDepositValue.toLocaleString() : 'xxxxxx'} /=) (equivalent to ${securityDepositMonths} month's rent and Service Charge.)<br><br>
        The deposit shall be retained by the landlord as security for the due performance by the tenant of its obligations under the lease.<br><br>
        The deposit will not be utilized by the tenant on account of the payment of rent, service charge or car park license fees for the last month (or longer period) of the term of lease.<br><br>
        During the period of the lease the deposit will be adjusted from time to time so that at no time during the term shall the rents payable be higher than the deposit held.<br><br>
        The deposit shall be refundable without interest to the tenant after expiry of the lease and return of the premises in accordance with the covenants contained in the lease.
      </td>
    </tr>
    <tr>
      <td>${fitOutPeriod ? '12' : '11'}.</td>
      <td>User:</td>
      <td>
        The premises shall be used for the sole purpose as ${userPurpose || 'xxxxxxxxxxx'} and any change of user will not be permitted without the landlord's or its Agents prior approval.<br><br>
        The usage of the space will have to be in accordance with the design of the building.<br><br>
        The Tenant shall at all times during the Term comply with all Laws, Acts, Rules, Regulations or By-Laws now in force, or as shall be enacted, passed, made or issued by the Government of Kenya or any Municipal, Township, Local or other competent authority in relation to the occupation, conduct and user of the Premise AND obtain all such licenses consents certificates or approvals thereon.
      </td>
    </tr>
    <tr>
      <td>${fitOutPeriod ? '13' : '12'}.</td>
      <td>Subletting:</td>
      <td>
        The tenant will not be permitted to transfer, assign, sublet or part with possession of the premises. Upon breach of the covenant, the Landlord may re-enter the premises and there upon the lease shall be terminated absolutely.
      </td>
    </tr>
    <tr>
      <td>${fitOutPeriod ? '14' : '13'}.</td>
      <td>Partitioning, Fixtures and Fittings:</td>
      <td>
        The landlord shall grant vacant possession of the premises as a cold shell.<br><br>
        The Tenant shall obtain the Landlord's written approval of any proposed design and layout of the interior of the Premises.<br><br>
        Before commencing any alterations or improvements to the interior, the Tenant shall submit plans of the intended layout and design specifying the materials to be used to the Landlord for approval. The Tenant shall pay the Landlord and his consultants the cost of considering the proposed plan.<br><br>
        Prior to commencing any fit out works, the Tenant shall obtain all relevant permits and/or approvals from the appropriate local and governmental authorities for such works on the Premises and shall furnish the Landlord with copies of all such permits and/or approvals.<br><br>
        <strong>Work Hours:</strong> All fit out works shall be done during the specific working hours of <strong>8:00 a.m. to 6:00 p.m.</strong> or such other extended period that may be agreed in writing by the Landlord.<br><br>
        Any damage to the building or part thereof and fixtures and fittings thereon forming the Mall, external or internal, (i.e., including but not limited to sidewalks, doors, slab, studs, drywall, ceiling, ductwork, electrical work, plumbing, plumbing fixtures, painting, etc.) caused by the Tenant and/or the Tenant's contractor or agents shall be repaired by the Landlord's contractor at the Tenant's expense and shall be payable forthwith by the Tenant.<br><br>
        All the costs of the improvements or alterations shall be borne by the Tenant.
      </td>
    </tr>
    <tr>
      <td>${fitOutPeriod ? '15' : '14'}.</td>
      <td>Restrictions on Signs, Notices etc:</td>
      <td>
        The Landlord shall allow paint, affix or exhibit of any name or writing or any sign placard, advertisement in the landing or passage upon or outside any private entrance door to the Premises from the landings or passage giving access with the prior written consent of the Landlord.<br><br>
        The Tenant will supply the Landlord with the design, size, type, color and placing of such signboards and also pay all the respective local authority fees and levies if required.
      </td>
    </tr>
    <tr>
      <td>${fitOutPeriod ? '16' : '15'}.</td>
      <td>Hours of Operation:</td>
      <td>
        The minimum hours of operation shall be 7.00 am to 9.00 pm seven (7) days a week throughout the lease term or such other extended hours specified by the Landlord from time to time. For clarity the Mall hours of operation herein would not stop the Tenant from operating prior or beyond those hours up to 24 Hours a day Seven Days a week.<br><br>
        The Tenant covenants to open for business to the public with the Premises fully furnished and stocked with merchandise on or before the Rent commencement date and thereafter, subject to temporary closures for casualty, condemnation or remodelling, that prevents the Tenant from conducting its normal business operations in the Premises, provided that, where the Tenant shall intend to close the business for a continuous period exceeding Fourteen (14) days, the Tenant shall notify the Landlord.
      </td>
    </tr>
    <tr>
      <td>${fitOutPeriod ? '17' : '16'}.</td>
      <td>Use of Brand:</td>
      <td>
        By accepting this letter of offer, the Tenant consents to the Landlord using its name and brand in the promotion of the Mall both to other potential tenants and to the market in general. The Tenant's prior approval on artwork shall be deemed to have been sought and obtained, and no further approvals shall be required during the Term.
      </td>
    </tr>
    <tr>
      <td>${fitOutPeriod ? '18' : '17'}.</td>
      <td>Internal Repair:</td>
      <td>
        The Tenant shall repair and maintain the Premises, including finishes, partitions, doors, windows and internal fixtures and fittings in a tenantable state of repair and condition, fair wear and tear excepted.
      </td>
    </tr>
    <tr>
      <td>${fitOutPeriod ? '19' : '18'}.</td>
      <td>Insurance:</td>
      <td>
        The Tenant shall at its own cost insure and keep insured the Premises and its personal contents and all the glass plates if any with a reputable underwriter to the full insurable value thereof. The Tenant shall also take out an employer's liability and public liability covers with a reputable underwriter to the full insurable value thereof.
      </td>
    </tr>
    <tr>
      <td>${fitOutPeriod ? '20' : '19'}.</td>
      <td>Re-entry:</td>
      <td>
        If the rent agreed or any part thereof shall remain unpaid for fourteen (14) days after becoming payable (whether formally demanded or not) or if at any time thereafter the tenant in breach of any of the covenants or conditions referred to in the standard form lease, it will be lawful for the landlord to re-enter the premises or any part thereof in the name of the whole and thereupon the lease shall be terminated absolutely.
      </td>
    </tr>
    <tr>
      <td>${fitOutPeriod ? '21' : '20'}.</td>
      <td>Possession:</td>
      <td>
        The Tenant shall only be granted possession of the Premises on acceptance of this Letter of Offer, execution of the Lease and payment of all the amounts reserved under this Letter of Offer. The Term and the provisions of this Letter of Offer and the Lease shall not be affected by any delay in executing and returning of this Letter of Offer or the Lease.
      </td>
    </tr>
    <tr>
      <td>${fitOutPeriod ? '22' : '21'}.</td>
      <td>Standard Lease:</td>
      <td>
        The Lease shall be in the Landlord's Standard Lease for the Property which shall be prepared by the Landlord's Advocates. Being a standard Lease for all premises on the Property, no material changes to the standard Lease shall be accepted or incorporated therein save for what is contained in this Letter of Offer.
      </td>
    </tr>
    <tr>
      <td>${fitOutPeriod ? '23' : '22'}.</td>
      <td>Legal Fees and all Incidental Costs:</td>
      <td>
        All costs including Legal Fees to scale for the preparation of the Lease, Stamp Duty, registration fees and other related disbursements shall be borne by the Tenant and paid to the Landlord's Advocates on acceptance of the Letter of Offer and before execution of the Lease. The Legal Fees shall be assessed according to the Advocates (Remuneration) (Amendment) Order 2014.
      </td>
    </tr>
    <tr>
      <td></td>
      <td></td>
      <td>
        By accepting the terms of this letter of offer, the tenant is deemed to approve the standard form lease and agrees to execute and return the lease promptly and within seven days when it is submitted to the tenant together with its remittances to cover the Landlord's advocate's estimate of their charges for completion of the lease which is payable by the tenant immediately on demand.
      </td>
    </tr>
    ${promotionExpenses ? `
    <tr>
      <td>${fitOutPeriod ? '24' : '23'}.</td>
      <td>Promotional Expenses:</td>
      <td>
        In order to promote the Mall, the Landlord may arrange for certain advertising and promotional activities, the costs of which shall be apportioned among the Tenants of the Mall.<br><br>
        The promotion expenses shall be assessed by the Landlord and payable quarterly in advance and will be subject to adjustments at the end of each calendar year following an audit of the promotion fund by the Landlord.<br><br>
        The Tenant shall be informed of all activities prior to its implementation.<br><br>
        Upon the execution of the Lease, the Tenant shall pay the Initial Provisional Promotion Expenses in the manner provided for in the Lease.<br><br>
        Further details in relation to the Promotion Fund will be set out in the Lease.
      </td>
    </tr>
    ` : ''}
    <tr>
      <td>${getClauseNumber(fitOutPeriod, promotionExpenses, 25)}.</td>
      <td>Confidentiality</td>
      <td>
        This offer is made in confidence. No terms shall be discussed with any third party save for the Lessor's and the Lessee's legal advisors who shall, in turn, be bound by this confidentiality clause.
      </td>
    </tr>
    <tr>
      <td>${getClauseNumber(fitOutPeriod, promotionExpenses, 26)}.</td>
      <td>Security</td>
      <td>
        The Lessor will provide day and night security services to the Centre.<br><br>
        The Lessee acknowledges and agrees that no warranty or guarantee is given by the Lessor in respect thereof and the Lessor, its agents and employees are under no liability whatsoever to the Lessee, the Lessee's agents, customers, visitors, licensees, guests, invitees or employees against injury, damage or loss (including loss of property, items or valuables) caused by burglary, theft or otherwise in the Premises.
      </td>
    </tr>
    <tr>
      <td>${getClauseNumber(fitOutPeriod, promotionExpenses, 28)}.</td>
      <td>Governing Law</td>
      <td>
        This Offer Letter shall be governed by and construed in accordance with the laws of Kenya.
      </td>
    </tr>
    <tr>
      <td>${getClauseNumber(fitOutPeriod, promotionExpenses, 29)}.</td>
      <td>Acceptance.</td>
      <td>
        The invitation will remain open for acceptance for a period of Seven (7) days from the date hereof, and may only be accepted on the following conditions. Acceptance shall be in writing and duly signed on this Letter of Offer and shall be effective only when the signed Letter together with the unconditional payment of the amounts specified here below are received within the said period of Seven (7) days failure to which this offer will lapse, unless the late acceptance of the offer is approved by Landlord:<br><br>
        <table class="payment-table">
          <tr>
            <td>${securityDepositMonths} months' Security Deposit of Rent and Service Charge:</td>
            <td>Ksh. ${securityDepositValue ? securityDepositValue.toLocaleString() : '……………'} /=</td>
          </tr>
          <tr>
            <td>${securityDepositMonths} months' Advance Rent & service charge:</td>
            <td>Ksh. ${advancePayment ? advancePayment.toLocaleString() : '……..'}  /=</td>
          </tr>
          <tr>
            <td>VAT</td>
            <td>Ksh. ${vatAmount ? vatAmount.toLocaleString() : '…………'} /=</td>
          </tr>
          <tr>
            <td><strong>Total:</strong></td>
            <td><strong>Ksh. ${totalInitialPayment ? totalInitialPayment.toLocaleString() : '…………'} /=</strong></td>
          </tr>
        </table>
        <br>
        All payments shall be made to the Landlord's Bank Account specified below, and shall be evidenced by an official bank deposit slip duly endorsed by the receiving bank. The Landlord shall not be liable for any payment which is made to any other person or into any other account or in any other mode:<br><br>
        ${bankDetails ? `
        <strong>Account no:</strong> ${bankDetails.accountNumber || '….………...'}<br>
        <strong>Account Name:</strong> ${bankDetails.accountName || '………………...'}<br>
        <strong>Bank:</strong> ${bankDetails.bankName || '……………………….'}<br>
        <strong>Branch:</strong> ${bankDetails.branch || '………………...'}<br>
        <strong>Branch Code:</strong> ${bankDetails.branchCode || '…………'}<br><br>
        ` : `
        <strong>Account no:</strong> ….………...<br>
        <strong>Account Name:</strong> ………………...<br>
        <strong>Bank:</strong> ……………………….<br>
        <strong>Branch:</strong> ………………...<br>
        <strong>Branch Code:</strong> …………<br><br>
        `}
        The Legal Fees for the Landlord's Advocates for attending to the instant transaction shall be payable to the Landlord's Advocates contemporaneous with the payment of the above sums and before the return of the accepted Letter of Offer.<br><br>
        By accepting this Offer, the Tenant is deemed to have accepted the Terms and Conditions contained herein and shall be bound by the same pending execution of the Lease and further agrees and undertakes to execute the Lease within Seven (7) days of receipt of the same.<br><br>
        The Tenant shall furnish the Landlord's Advocates with the following:<br><br>
        <div class="list-item">a) Certified copy of the Certificate of Incorporation of the Tenant;</div>
        <div class="list-item">b) Certified copy of the latest Form CR12 of the Tenant;</div>
        <div class="list-item">c) Copy of the KRA PIN Certificate of the Tenant;</div>
        <div class="list-item">d) ID Card and KRA PIN Certificate of the Tenant's Directors; and</div>
        <div class="list-item">e) Legal Fees.</div>
        <br>
        The Letter of Offer is not binding on the Landlord or at all until the Tenant has returned the same properly executed together with all the respective payments and the documents herein requested and the Landlord has accepted the same.
      </td>
    </tr>
  </table>

  <p>Yours faithfully,</p>

  <div class="signature-section">
    <div class="signature-block">
      <strong>${landlordName || 'Landlords name here'}</strong><br><br>
      Director
    </div>
  </div>

  <div class="acceptance-section">
    <div class="acceptance-title">
      TENANT'S ACCEPTANCE OF THE OFFER
    </div>

    <p>
      We or I <strong>${tenantName || 'xxxxxxxxxxxxxxxxxxxx'}</strong> do hereby unconditionally accept the offer to lease the Premises, and the above Terms and Conditions, and undertake to execute the standard Lease which shall be prepared by the Landlord's Advocates within Seven (7) days of receipt of the engrossed Lease and enclose herewith payments of Kenya Shillings in respect of: -
    </p>

    <table class="payment-table">
      <tr>
        <td>${securityDepositMonths} months' Security Deposit of Rent and Service Charge:</td>
        <td>Ksh. ${securityDepositValue ? securityDepositValue.toLocaleString() : 'xxxxxx'} /=</td>
      </tr>
      <tr>
        <td>${securityDepositMonths} months' Advance Rent & service charge:</td>
        <td>Ksh. ${advancePayment ? advancePayment.toLocaleString() : 'xxxxxx'} /=</td>
      </tr>
      <tr>
        <td>VAT</td>
        <td>Ksh. ${vatAmount ? vatAmount.toLocaleString() : 'xxxxxx'} /=</td>
      </tr>
      <tr>
        <td><strong>Total:</strong></td>
        <td><strong>Ksh. ${totalInitialPayment ? totalInitialPayment.toLocaleString() : 'xxxxxxxx'} /=</strong></td>
      </tr>
      <tr>
        <td><strong>Legal Fees:</strong></td>
        <td>As assessed according to the Advocates (Remuneration) (Amendment) Order 2014.</td>
      </tr>
    </table>

    <div class="seal-section">
      SEALED with the COMMON SEAL of the Tenant the said<br>
      ${tenantName || 'Xxxxxxxxxxxxxxx'} ltd
    </div>

    <div class="witness-section">
      <div class="witness-block">
        <strong>In the presence of: -</strong><br><br><br>
        Name<span class="underline-space"></span><br><br>
        Signature <span class="underline-space"></span>
      </div>
      <div class="witness-block">
        <br><br><br>
        Name<span class="underline-space"></span><br><br>
        Signature <span class="underline-space"></span>
      </div>
    </div>

    <div class="certification-box">
      <div class="certification-title">
        Person Certifying the Execution
      </div>
      <p>
        <strong>I CERTIFY</strong> that<span class="underline-space"></span> and<span class="underline-space"></span> being the persons witnessing the affixing of the Common Seal of the Tenant appeared before me on <span class="underline-space"></span> and being known to me/being identified by <span class="underline-space"></span> of<span class="underline-space"></span> acknowledged the above signature or marks to be theirs and that they had freely and voluntarily executed this instrument and understood its contents.
      </p>
      <br><br>
      <p>
        <span class="underline-space" style="min-width: 300px;"></span><br>
        Name and signature of person certifying
      </p>
    </div>
  </div>
</body>
</html>
  `;
};

// Helper function to get clause number based on conditions
function getClauseNumber(fitOutPeriod, promotionExpenses, baseNumber) {
  let adjustment = 0;
  if (fitOutPeriod) adjustment += 1;
  if (promotionExpenses) adjustment += 0; // Promotion is conditional, doesn't shift later numbers
  
  // The base numbers in the document assume fitOut exists
  // Without fitOut, all numbers shift down by 1
  if (!fitOutPeriod) {
    return baseNumber - 2;
  }
  
  return baseNumber - 1;
}

// Helper function to convert number to words (enhanced)
function convertNumberToWords(num) {
  const ones = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine'];
  const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
  const teens = ['Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
  
  if (num === 0) return 'Zero Only';

  function convertLessThanThousand(n) {
    let str = '';
    if (n >= 100) {
      str += ones[Math.floor(n / 100)] + ' Hundred ';
      n %= 100;
    }
    if (n >= 20) {
      str += tens[Math.floor(n / 10)] + ' ';
      n %= 10;
    }
    if (n >= 10) {
      return str + teens[n - 10];
    }
    if (n > 0) {
      str += ones[n];
    }
    return str.trim();
  }

  let words = '';
  if (num >= 1_000_000_000) {
    words += convertLessThanThousand(Math.floor(num / 1_000_000_000)) + ' Billion ';
    num %= 1_000_000_000;
  }
  if (num >= 1_000_000) {
    words += convertLessThanThousand(Math.floor(num / 1_000_000)) + ' Million ';
    num %= 1_000_000;
  }
  if (num >= 1_000) {
    words += convertLessThanThousand(Math.floor(num / 1_000)) + ' Thousand ';
    num %= 1_000;
  }
  if (num > 0) {
    words += convertLessThanThousand(num);
  }

  return (words.trim() || 'Zero') + ' Only';
}
