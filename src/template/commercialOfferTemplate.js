/**
 * Commercial Offer Letter Template (LOF)
 * For Commercial, Industrial, and Institutional properties
 * Based on detailed legal document structure
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
    serviceChargeEscalation,
    vatRate = 16,
    securityDepositMonths = 3,
    securityDepositAmount,
    userPurpose,
    paymentPolicy = 'QUARTERLY',
    additionalTerms,
    bankDetails,
    legalFees,
    promotionExpenses
  } = data;

  // Calculate derived values
  const totalRentValue = totalRent || (rentPerSqFt * areaSqFt);
  const totalServiceChargeValue = totalServiceCharge || (serviceChargePerSqFt * areaSqFt);
  const securityDepositValue = securityDepositAmount || (totalRentValue + totalServiceChargeValue) * securityDepositMonths;
  const vatAmount = (totalRentValue + totalServiceChargeValue) * (vatRate / 100);
  const totalInitialPayment = securityDepositValue + (totalRentValue + totalServiceChargeValue) * securityDepositMonths + vatAmount;

  // Convert total payment to words for legal clarity
  const totalInWords = convertNumberToWords(Math.round(totalInitialPayment));

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    body {
      font-family: 'Times New Roman', Times, serif;
      line-height: 1.6;
      margin: 40px;
      font-size: 12pt;
    }
    .header {
      text-align: center;
      margin-bottom: 30px;
    }
    .property-name {
      font-weight: bold;
      font-size: 14pt;
      margin-bottom: 5px;
    }
    .date {
      text-align: right;
      margin-bottom: 20px;
    }
    .subject {
      font-weight: bold;
      text-align: center;
      margin: 20px 0;
      text-decoration: underline;
    }
    .recipient {
      margin-bottom: 20px;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      margin: 20px 0;
    }
    table td {
      padding: 8px;
      border: 1px solid #000;
      vertical-align: top;
      text-align: left;
    }
    table td:first-child {
      width: 30px;
      text-align: center;
      font-weight: bold;
    }
    table td:nth-child(2) {
      width: 150px;
      font-weight: bold;
    }
    .signature-section {
      margin-top: 50px;
    }
    .signature-line {
      margin-top: 60px;
      border-top: 1px solid #000;
      width: 300px;
    }
    .acceptance-section {
      margin-top: 80px;
      page-break-before: always;
    }
    .nested-table {
      width: 100%;
      border: none;
      margin: 10px 0;
    }
    .nested-table td {
      border: none;
      padding: 2px 5px;
    }
    .indented {
      padding-left: 20px !important;
    }
    .underline {
      text-decoration: underline;
    }
    .bold {
      font-weight: bold;
    }
    .center {
      text-align: center;
    }
  </style>
</head>
<body>
  <div class="header">
    <div class="property-name">${propertyName || '[Property Name PO Box and location]'}</div>
  </div>

  <div class="date">
    Date: ${date || new Date().toLocaleDateString('en-GB')}
  </div>

  <div class="recipient">
    <strong>ATTN:</strong><br>
    ${tenantName || '[Tenant Name]'}<br>
    ${tenantPOBox ? `P.O. Box ${tenantPOBox}` : '[P.O. Box]'}<br>
    ${tenantAddress || '[Address]'}<br>
  </div>

  <div class="subject">
    "Subject to Lease"
  </div>

  <p>Dear ${tenantName ? tenantName.split(' ')[0] : '[Tenant Name]'},</p>

  <p>
    <strong>RE: OFFER TO LEASE COMMERCIAL SPACE ON THE ${floor || '[FLOOR]'} FLOOR OF THE DEVELOPMENT 
    ERECTED ON LAND REFERENCE L.R. NO. ${propertyLRNumber || '[LR NUMBER]'}</strong>
  </p>

  <p>
    Further to our discussions in respect to the referenced matter, we are pleased to offer to lease to you 
    the commercial space measuring approximately ${areaSqFt || '[SIZE]'} Square Feet on the ${floor || '[Floor]'} 
    Floor of the development erected on L.R. No. ${propertyLRNumber || '[LR Number]'} at ${propertyAddress || '[Address]'} 
    subject to contract, and subject to the following terms:
  </p>

  <table>
    <tr>
      <td>1.</td>
      <td>Premises:</td>
      <td>
        The Premise leased is the commercial space measuring approximately ${areaSqFt || '[SIZE]'} Square Feet on 
        the ${floor || '[Floor]'} Floor of the development erected on L.R. No. ${propertyLRNumber || '[LR Number]'} 
        at ${propertyAddress || '[Address]'}.
      </td>
    </tr>
    <tr>
      <td>2.</td>
      <td>Landlord:</td>
      <td>
        ${landlordName || '[Landlord Name]'}<br>
        ${landlordPOBox ? `P.O. Box ${landlordPOBox}` : '[P.O. Box]'}<br>
        ${landlordAddress || '[Address]'}
      </td>
    </tr>
    <tr>
      <td>3.</td>
      <td>Tenant:</td>
      <td>
        ${tenantName || '[Tenant Name]'} Limited<br>
        ${tenantPOBox ? `P.O. Box ${tenantPOBox}` : '[P.O. Box]'}<br>
        ${tenantAddress || '[Address]'}
      </td>
    </tr>
    <tr>
      <td>4.</td>
      <td>Term:</td>
      <td>
        ${leaseTerm || '[Term]'} from the 1<sup>st</sup> day of ${leaseStartDate ? new Date(leaseStartDate).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }) : '[Month] [Year]'} or such other earlier date that the Parties shall agree.
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
        The Tenant shall be granted ${fitOutPeriod} rent free Fit Out Period. The Tenant shall undertake all the required Fit Out Works before the rent Commencement Date, and the Landlord hereby warrants and undertakes to grant to the Tenant with vacant possession on the 1<sup>st</sup> day of ${leaseStartDate ? new Date(leaseStartDate).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }) : '[Month] [Year]'} or such other earlier date as the Tenant may require, provided that should the Tenant take possession of the Premises earlier than the 1<sup>st</sup> day of ${leaseStartDate ? new Date(leaseStartDate).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }) : '[Month] [Year]'}, the Term Commencement Date shall be amended to two months after the Tenant takes possession of the Premises.
      </td>
    </tr>
    ` : ''}
    <tr>
      <td>${fitOutPeriod ? '7' : '6'}.</td>
      <td>Rent:</td>
      <td>
        The Rent which shall be payable from the Term Commencement Date shall be assessed at Kenya Shilling ${rentPerSqFt ? rentPerSqFt.toLocaleString() : '[Amount]'} per Square Foot aggregating to Kenya Shillings ${totalRentValue ? totalRentValue.toLocaleString() : '[Amount]'} (Kshs. ${totalRentValue ? totalRentValue.toLocaleString() : '[Amount]'}/=) which shall escalate at the rate of ${escalationRate || '[Rate]'}% after every ${escalationFrequency === 'BI_ANNUALLY' ? 'Six (6)' : 'Twelve (12)'} months after the Term Commencement Date. The rent is inclusive of service charge.<br><br>
        Rent shall be paid ${paymentPolicy.toLowerCase()} in advance not later than the 5<sup>th</sup> day of every month upon presentation of an invoice, and if the rent is not paid by then, the Tenant shall pay the Landlord interest on the rent arrears at the rate of Fifteen Percent (15%) per month from the date the Rent fell due until the date it is paid in full. Interest shall be calculated on daily balances and debited monthly by way of compound interest.
      </td>
    </tr>
    ${serviceChargePerSqFt || totalServiceCharge ? `
    <tr>
      <td>${fitOutPeriod ? '8' : '7'}.</td>
      <td>Service Charge:</td>
      <td>
        <table class="nested-table">
          <tr>
            <td colspan="2">
              The Service Charge levied at Ksh. ${serviceChargePerSqFt ? serviceChargePerSqFt.toLocaleString() : '[Amount]'} per sq.ft or ${totalServiceChargeValue ? totalServiceChargeValue.toLocaleString() : '[Amount]'} amount, which shall be payable either monthly or quarterly in advance together with the rent, shall cover all outgoings, operational costs and overheads relating to the building that shall include but not be limited to the following: -
            </td>
          </tr>
          <tr>
            <td class="indented">a)</td>
            <td>Electricity for common areas</td>
          </tr>
          <tr>
            <td class="indented">b)</td>
            <td>Cleanliness for common areas</td>
          </tr>
          <tr>
            <td class="indented">c)</td>
            <td>Insurance</td>
          </tr>
          <tr>
            <td class="indented">d)</td>
            <td>Cost of periodic maintenance and decoration of common areas water pumps and other machinery</td>
          </tr>
          <tr>
            <td class="indented">e)</td>
            <td>Maintenance of vehicle parking and delivery areas</td>
          </tr>
          <tr>
            <td class="indented">f)</td>
            <td>Management costs</td>
          </tr>
          <tr>
            <td class="indented">g)</td>
            <td>Rates and ground rents</td>
          </tr>
          <tr>
            <td class="indented">h)</td>
            <td>Repairs of common areas</td>
          </tr>
          <tr>
            <td class="indented">i)</td>
            <td>Security for common areas</td>
          </tr>
          <tr>
            <td colspan="2">
              Service charge will be payable from the Term Commencement Date.<br><br>
              The Service Charge shall escalate at the rate of ${serviceChargeEscalation || '5'}% per annum after every 12 months from the Term Commencement Date.<br><br>
              The Service Charge does not cover electricity and water exclusively consumed by the Tenant, which will be metered separately and payable by the Tenant.
            </td>
          </tr>
        </table>
      </td>
    </tr>
    ` : ''}
    <tr>
      <td>${getNextNumber(fitOutPeriod, serviceChargePerSqFt || totalServiceCharge)}.</td>
      <td>VAT</td>
      <td>
        The Rent and Service Charge shall attract VAT at the prevailing rate, currently at the rate of ${vatRate}%. In addition to the above rental costs, the Tenant will be liable to pay on demand by the Landlord or to provide exemption certificate including exceptions from The Kenya Revenue Authority in accordance with the legal requirements of all Value Added Taxes or other taxes livable from time to time in law in respect of any amounts payable by the Tenant. Should the rate of VAT be varied during the Term, the Tenant shall pay VAT on the Rent at such higher or lower revised rate.
      </td>
    </tr>
    <tr>
      <td>${getNextNumber(fitOutPeriod, serviceChargePerSqFt || totalServiceCharge) + 1}.</td>
      <td>Utilities:</td>
      <td>
        The Tenant shall pay for electricity consumed in their premises separately from the rent whether such electricity is supplied through the mains or through the Landlord's generator (if any) at the rate as shall be determined by the Landlord from time to time. All electricity will be sub-metered by the Landlord.<br><br>
        The Tenant shall not make any alterations or additions to the electrical equipment or appliances installed in the Demised Premises (even if the said equipment or appliances have been installed by the Tenant) without the prior written consent of the Landlord.<br><br>
        The Tenant shall procure the connection and provision of telephone, internet services and all other required utilities from the respective service providers of the Tenant's choice, and shall pay for telephone, water, internet and all such utilities to the respective service providers.<br><br>
        The Landlord shall not be responsible for the connection or provision of utilities and therefore, the Term or any of the Tenant's obligations under the Lease or this Letter of Offer shall not be affected by any delay or failure of provision of any of these utilities.
      </td>
    </tr>
    <tr>
      <td>${getNextNumber(fitOutPeriod, serviceChargePerSqFt || totalServiceCharge) + 2}.</td>
      <td>Security Deposit:</td>
      <td>
        Together with the acceptance of this offer, the tenant will pay a Security Deposit of Rent and Service Charge in form of cash or bank guarantee and maintain with the landlord such Security during the Term of the Lease of a sum of Kenya Shillings ${securityDepositValue ? securityDepositValue.toLocaleString() : '[Amount]'} (Ksh. ${securityDepositValue ? securityDepositValue.toLocaleString() : '[Amount]'}/=) (equivalent to ${securityDepositMonths} month's rent and Service Charge.)<br><br>
        The deposit shall be retained by the landlord as security for the due performance by the tenant of its obligations under the lease.<br><br>
        The deposit will not be utilized by the tenant on account of the payment of rent, service charge or car park license fees for the last month (or longer period) of the term of lease.<br><br>
        During the period of the lease the deposit will be adjusted from time to time so that at no time during the term shall the rents payable be higher than the deposit held.<br><br>
        The deposit shall be refundable without interest to the tenant after expiry of the lease and return of the premises in accordance with the covenants contained in the lease.
      </td>
    </tr>
    <tr>
      <td>${getNextNumber(fitOutPeriod, serviceChargePerSqFt || totalServiceCharge) + 3}.</td>
      <td>User:</td>
      <td>
        The premises shall be used for the sole purpose as ${userPurpose || '[Purpose]'} and any change of user will not be permitted without the landlord's or its Agents prior approval.<br><br>
        The usage of the space will have to be in accordance with the design of the building.<br><br>
        The Tenant shall at all times during the Term comply with all Laws, Acts, Rules, Regulations or By-Laws now in force, or as shall be enacted, passed, made or issued by the Government of Kenya or any Municipal, Township, Local or other competent authority in relation to the occupation, conduct and user of the Premise AND obtain all such licenses consents certificates or approvals thereon.
      </td>
    </tr>
    <tr>
      <td>${getNextNumber(fitOutPeriod, serviceChargePerSqFt || totalServiceCharge) + 4}.</td>
      <td>Subletting:</td>
      <td>
        The tenant will not be permitted to transfer, assign, sublet or part with possession of the premises. Upon breach of the covenant, the Landlord may re-enter the premises and there upon the lease shall be terminated absolutely.
      </td>
    </tr>
    <tr>
      <td>${getNextNumber(fitOutPeriod, serviceChargePerSqFt || totalServiceCharge) + 5}.</td>
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
      <td>${getNextNumber(fitOutPeriod, serviceChargePerSqFt || totalServiceCharge) + 6}.</td>
      <td>Restrictions on Signs, Notices etc:</td>
      <td>
        The Landlord shall allow paint, affix or exhibit of any name or writing or any sign placard, advertisement in the landing or passage upon or outside any private entrance door to the Premises from the landings or passage giving access with the prior written consent of the Landlord.<br><br>
        The Tenant will supply the Landlord with the design, size, type, color and placing of such signboards and also pay all the respective local authority fees and levies if required.
      </td>
    </tr>
    <tr>
      <td>${getNextNumber(fitOutPeriod, serviceChargePerSqFt || totalServiceCharge) + 7}.</td>
      <td>Hours of Operation:</td>
      <td>
        The minimum hours of operation shall be 7.00 am to 9.00 pm seven (7) days a week throughout the lease term or such other extended hours specified by the Landlord from time to time. For clarity the Mall hours of operation herein would not stop the Tenant from operating prior or beyond those hours up to 24 Hours a day Seven Days a week.<br><br>
        The Tenant covenants to open for business to the public with the Premises fully furnished and stocked with merchandise on or before the Rent commencement date and thereafter, subject to temporary closures for casualty, condemnation or remodelling, that prevents the Tenant from conducting its normal business operations in the Premises, provided that, where the Tenant shall intend to close the business for a continuous period exceeding Fourteen (14) days, the Tenant shall notify the Landlord.
      </td>
    </tr>
    <tr>
      <td>${getNextNumber(fitOutPeriod, serviceChargePerSqFt || totalServiceCharge) + 8}.</td>
      <td>Use of Brand:</td>
      <td>
        By accepting this letter of offer, the Tenant consents to the Landlord using its name and brand in the promotion of the Mall both to other potential tenants and to the market in general. The Tenant's prior approval on artwork shall be deemed to have been sought and obtained, and no further approvals shall be required during the Term.
      </td>
    </tr>
    <tr>
      <td>${getNextNumber(fitOutPeriod, serviceChargePerSqFt || totalServiceCharge) + 9}.</td>
      <td>Internal Repair:</td>
      <td>
        The Tenant shall repair and maintain the Premises, including finishes, partitions, doors, windows and internal fixtures and fittings in a tenantable state of repair and condition, fair wear and tear excepted.
      </td>
    </tr>
    <tr>
      <td>${getNextNumber(fitOutPeriod, serviceChargePerSqFt || totalServiceCharge) + 10}.</td>
      <td>Insurance:</td>
      <td>
        The Tenant shall at its own cost insure and keep insured the Premises and its personal contents and all the glass plates if any with a reputable underwriter to the full insurable value thereof. The Tenant shall also take out an employer's liability and public liability covers with a reputable underwriter to the full insurable value thereof.
      </td>
    </tr>
    <tr>
      <td>${getNextNumber(fitOutPeriod, serviceChargePerSqFt || totalServiceCharge) + 11}.</td>
      <td>Re-entry:</td>
      <td>
        If the rent agreed or any part thereof shall remain unpaid for fourteen (14) days after becoming payable (whether formally demanded or not) or if at any time thereafter the tenant in breach of any of the covenants or conditions referred to in the standard form lease, it will be lawful for the landlord to re-enter the premises or any part thereof in the name of the whole and thereupon the lease shall be terminated absolutely.
      </td>
    </tr>
    <tr>
      <td>${getNextNumber(fitOutPeriod, serviceChargePerSqFt || totalServiceCharge) + 12}.</td>
      <td>Possession:</td>
      <td>
        The Tenant shall only be granted possession of the Premises on acceptance of this Letter of Offer, execution of the Lease and payment of all the amounts reserved under this Letter of Offer. The Term and the provisions of this Letter of Offer and the Lease shall not be affected by any delay in executing and returning of this Letter of Offer or the Lease.
      </td>
    </tr>
    <tr>
      <td>${getNextNumber(fitOutPeriod, serviceChargePerSqFt || totalServiceCharge) + 13}.</td>
      <td>Standard Lease:</td>
      <td>
        The Lease shall be in the Landlord's Standard Lease for the Property which shall be prepared by the Landlord's Advocates. Being a standard Lease for all premises on the Property, no material changes to the standard Lease shall be accepted or incorporated therein save for what is contained in this Letter of Offer.
      </td>
    </tr>
    <tr>
      <td>${getNextNumber(fitOutPeriod, serviceChargePerSqFt || totalServiceCharge) + 14}.</td>
      <td>Legal Fees and all Incidental Costs:</td>
      <td>
        All costs including Legal Fees to scale for the preparation of the Lease, Stamp Duty, registration fees and other related disbursements shall be borne by the Tenant and paid to the Landlord's Advocates on acceptance of the Letter of Offer and before execution of the Lease. The Legal Fees shall be assessed according to the Advocates (Remuneration) (Amendment) Order 2014.<br><br>
        By accepting the terms of this letter of offer, the tenant is deemed to approve the standard form lease and agrees to execute and return the lease promptly and within seven days when it is submitted to the tenant together with its remittances to cover the Landlord's advocate's estimate of their charges for completion of the lease which is payable by the tenant immediately on demand.
      </td>
    </tr>
    ${promotionExpenses ? `
    <tr>
      <td>${getNextNumber(fitOutPeriod, serviceChargePerSqFt || totalServiceCharge) + 15}.</td>
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
      <td>${getNextNumber(fitOutPeriod, serviceChargePerSqFt || totalServiceCharge) + (promotionExpenses ? 16 : 15)}.</td>
      <td>Confidentiality</td>
      <td>
        This offer is made in confidence. No terms shall be discussed with any third party save for the Lessor's and the Lessee's legal advisors who shall, in turn, be bound by this confidentiality clause.
      </td>
    </tr>
    <tr>
      <td>${getNextNumber(fitOutPeriod, serviceChargePerSqFt || totalServiceCharge) + (promotionExpenses ? 17 : 16)}.</td>
      <td>Security</td>
      <td>
        The Lessor will provide day and night security services to the Centre.<br><br>
        The Lessee acknowledges and agrees that no warranty or guarantee is given by the Lessor in respect thereof and the Lessor, its agents and employees are under no liability whatsoever to the Lessee, the Lessee's agents, customers, visitors, licensees, guests, invitees or employees against injury, damage or loss (including loss of property, items or valuables) caused by burglary, theft or otherwise in the Premises.
      </td>
    </tr>
    <tr>
      <td>${getNextNumber(fitOutPeriod, serviceChargePerSqFt || totalServiceCharge) + (promotionExpenses ? 18 : 17)}.</td>
      <td>Governing Law</td>
      <td>
        This Offer Letter shall be governed by and construed in accordance with the laws of Kenya.
      </td>
    </tr>
    <tr>
      <td>${getNextNumber(fitOutPeriod, serviceChargePerSqFt || totalServiceCharge) + (promotionExpenses ? 19 : 18)}.</td>
      <td>Acceptance.</td>
      <td>
        <table class="nested-table">
          <tr>
            <td colspan="2">
              The invitation will remain open for acceptance for a period of Seven (7) days from the date hereof, and may only be accepted on the following conditions. Acceptance shall be in writing and duly signed on this Letter of Offer and shall be effective only when the signed Letter together with the unconditional payment of the amounts specified here below are received within the said period of Seven (7) days failure to which this offer will lapse, unless the late acceptance of the offer is approved by Landlord:
            </td>
          </tr>
          <tr>
            <td width="70%">${securityDepositMonths} months' Security Deposit of Rent and Service Charge:</td>
            <td>Ksh. ${securityDepositValue ? securityDepositValue.toLocaleString() : '[Amount]'} /=</td>
          </tr>
          <tr>
            <td>${securityDepositMonths} months' Advance Rent & service charge:</td>
            <td>Ksh. ${((totalRentValue + totalServiceChargeValue) * securityDepositMonths).toLocaleString()} /=</td>
          </tr>
          <tr>
            <td>VAT:</td>
            <td>Ksh. ${vatAmount.toLocaleString()} /=</td>
          </tr>
          <tr>
            <td><strong>Total: Ksh. ${totalInitialPayment.toLocaleString()} /=</strong><br><em>(${totalInWords})</em></td>
            <td></td>
          </tr>
          <tr>
            <td colspan="2">
              All payments shall be made to the Landlord's Bank Account specified below, and shall be evidenced by an official bank deposit slip duly endorsed by the receiving bank. The Landlord shall not be liable for any payment which is made to any other person or into any other account or in any other mode:
            </td>
          </tr>
          ${bankDetails ? `
          <tr>
            <td colspan="2">
              <strong>Account no:</strong> ${bankDetails.accountNumber || '[Account Number]'}<br>
              <strong>Account Name:</strong> ${bankDetails.accountName || '[Account Name]'}<br>
              <strong>Bank:</strong> ${bankDetails.bankName || '[Bank Name]'}<br>
              <strong>Branch:</strong> ${bankDetails.branch || '[Branch]'}<br>
              <strong>Branch Code:</strong> ${bankDetails.branchCode || '[Branch Code]'}
            </td>
          </tr>
          ` : ''}
          <tr>
            <td colspan="2">
              The Legal Fees for the Landlord's Advocates for attending to the instant transaction shall be payable to the Landlord's Advocates contemporaneous with the payment of the above sums and before the return of the accepted Letter of Offer.<br><br>
              By accepting this Offer, the Tenant is deemed to have accepted the Terms and Conditions contained herein and shall be bound by the same pending execution of the Lease and further agrees and undertakes to execute the Lease within Seven (7) days of receipt of the same.<br><br>
              The Tenant shall furnish the Landlord's Advocates with the following:<br><br>
              a) Certified copy of the Certificate of Incorporation of the Tenant;<br>
              b) Certified copy of the latest Form CR12 of the Tenant;<br>
              c) Copy of the KRA PIN Certificate of the Tenant;<br>
              d) ID Card and KRA PIN Certificate of the Tenant's Directors; and<br>
              e) Legal Fees.<br><br>
              The Letter of Offer is not binding on the Landlord or at all until the Tenant has returned the same properly executed together with all the respective payments and the documents herein requested and the Landlord has accepted the same.
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>

  <p>Yours faithfully,</p>

  <div class="signature-section">
    <div class="signature-line">
      <strong>${landlordName || '[Landlord Name]'}</strong><br>
      <span class="underline">Director</span><br>
      ${landlordPOBox ? `P.O. Box ${landlordPOBox}` : ''}<br>
      ${landlordAddress || ''}
    </div>
  </div>

  <div class="acceptance-section">
    <p class="bold center">TENANT'S ACCEPTANCE OF THE OFFER</p>
    <p>
      We or I <strong>${tenantName || '[Tenant Name]'}</strong> do hereby unconditionally accept the
      offer to lease the Premises, and the above Terms and Conditions, and
      undertake to execute the standard Lease which shall be prepared by the
      Landlord's Advocates within Seven (7) days of receipt of the engrossed
      Lease and enclose herewith payments of Kenya Shillings in respect of: -
    </p>

    <table class="nested-table">
      <tr>
        <td width="70%">${securityDepositMonths} months' Security Deposit of Rent and Service Charge:</td>
        <td>Ksh. ${securityDepositValue ? securityDepositValue.toLocaleString() : '[Amount]'} /=</td>
      </tr>
      <tr>
        <td>${securityDepositMonths} months' Advance Rent & service charge:</td>
        <td>Ksh. ${((totalRentValue + totalServiceChargeValue) * securityDepositMonths).toLocaleString()} /=</td>
      </tr>
      <tr>
        <td>VAT:</td>
        <td>Ksh. ${vatAmount.toLocaleString()} /=</td>
      </tr>
      <tr>
        <td><strong>Total: Ksh. ${totalInitialPayment.toLocaleString()} /=</strong><br><em>(${totalInWords})</em></td>
        <td></td>
      </tr>
      <tr>
        <td>Legal Fees:</td>
        <td>As assessed according to the Advocates (Remuneration) (Amendment) Order 2014.</td>
      </tr>
    </table>

    <p class="center bold" style="margin-top: 40px;">
      SEALED with the COMMON SEAL of the Tenant the said<br>
      ${tenantName || '[Tenant Name] ltd'}
    </p>

    <div style="margin-top: 60px;">
      <div style="display: inline-block; width: 45%; vertical-align: top;">
        <p>In the presence of: -</p>
        <p>Name: ______________________</p>
        <p>Signature: ___________________</p>
      </div>
      <div style="display: inline-block; width: 45%; vertical-align: top;">
        <p>&nbsp;</p>
        <p>Name: ______________________</p>
        <p>Signature: ___________________</p>
      </div>
    </div>

    <div style="margin-top: 80px; border: 1px solid #000; padding: 15px;">
      <p class="bold center">PERSON CERTIFYING THE EXECUTION</p>
      <p>
        <strong>I CERTIFY</strong> that ______________________ and ______________________ 
        being the persons witnessing the affixing of the Common Seal of the Tenant appeared before me on 
        ______________________ and being known to me/being identified by ______________________ 
        of ______________________ acknowledged the above signature or marks to be theirs and that they 
        had freely and voluntarily executed this instrument and understood its contents.
      </p>
      <div style="margin-top: 40px;">
        <p>_______________________</p>
        <p>Name and signature of person certifying</p>
      </div>
    </div>
  </div>
</body>
</html>
  `;
};

// Helper function to get next number in sequence
function getNextNumber(fitOutPeriod, serviceCharge) {
  let base = 6;
  if (fitOutPeriod) base++;
  if (serviceCharge) base++;
  return base;
}

// Helper function to convert number to words (basic implementation)
// Now USED — resolves ts(6133)
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