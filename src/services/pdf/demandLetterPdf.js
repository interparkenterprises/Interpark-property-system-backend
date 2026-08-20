const currency = (value) =>
  `Ksh. ${Number(value ?? 0).toLocaleString("en-KE", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}/=`;

const formatDate = (date) =>
  date
    ? new Date(date).toLocaleDateString("en-KE", {
        day: "numeric",
        month: "long",
        year: "numeric",
      })
    : "-";

// Standard response window for a demand letter -- a fixed policy, NOT derived
// from dueDate (dueDate is the ORIGINAL rent due date, an unrelated field).
const DEFAULT_PAYMENT_DEADLINE_DAYS = 7;

const statusColors = {
  DRAFT: "#6b7280",
  GENERATED: "#0d6efd",
  SENT: "#8b5cf6",
  ACKNOWLEDGED: "#f59e0b",
  SETTLED: "#22c55e",
  ESCALATED: "#ef4444",
};

/**
 * Formal, landlord-voice demand letter. No generic company letterhead --
 * the header IS the landlord's own information, built directly from data,
 * so the letter reads as genuinely coming from the landlord rather than
 * from a templated system notice.
 *
 * IMPORTANT: this requires `landlord`, `property`, and `unit` to be
 * included directly on the DemandLetter record passed in (not just
 * reachable via tenant.unit.property) -- see the Prisma query in
 * whatsappService.js's "Demand Letter" case and demandLetter.controller.js.
 */
export function buildDemandLetterHtml(demandLetter) {
  if (!demandLetter) {
    throw new Error("Demand Letter not found");
  }

  const tenant = demandLetter.tenant;
  const landlord = demandLetter.landlord;
  const property = demandLetter.property;
  const unit = demandLetter.unit;
  const invoice = demandLetter.invoice;

  if (!tenant) throw new Error("Tenant not found on Demand Letter");
  if (!landlord) throw new Error("Landlord not found on Demand Letter");

  const paymentFrequency = tenant.paymentPolicy
    ? tenant.paymentPolicy.charAt(0) + tenant.paymentPolicy.slice(1).toLowerCase()
    : "agreed";

  const deadlineDays = demandLetter.paymentDeadlineDays ?? DEFAULT_PAYMENT_DEADLINE_DAYS;
  const statusColor = statusColors[demandLetter.status] || "#6b7280";

  return `
<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<style>
* { box-sizing: border-box; }

body {
  font-family: Georgia, 'Times New Roman', serif;
  font-size: 12.5px;
  color: #1a1a1a;
  line-height: 1.65;
  margin: 0;
  padding-bottom: 30px;
}

.masthead {
  text-align: center;
  padding-bottom: 18px;
  border-bottom: 3px double #004f79;
  margin-bottom: 26px;
}

.masthead .landlord-name {
  font-size: 22px;
  font-weight: bold;
  letter-spacing: 0.5px;
  color: #004f79;
  margin: 0 0 4px 0;
  text-transform: uppercase;
}

.masthead .property-line {
  font-size: 11.5px;
  color: #555;
  font-style: italic;
  margin: 0 0 6px 0;
}

.masthead .landlord-address {
  font-size: 11px;
  color: #444;
  margin: 0 0 4px 0;
}

.masthead .contact-line {
  font-size: 10.5px;
  color: #666;
  margin: 0;
}

.ref-date-row {
  display: flex;
  justify-content: space-between;
  font-size: 12px;
  color: #444;
  margin-bottom: 22px;
}

.ref-date-row .refs p { margin: 2px 0; }

.tenant-block { margin-bottom: 26px; }
.tenant-block .to-label {
  font-size: 10px;
  letter-spacing: 1.5px;
  color: #004f79;
  text-transform: uppercase;
  margin-bottom: 5px;
  font-weight: bold;
}
.tenant-block p { margin: 2px 0; }
.tenant-block .name { font-weight: bold; font-size: 13px; }

.status-pill {
  display: inline-block;
  padding: 2px 9px;
  border-radius: 10px;
  color: #fff;
  font-weight: bold;
  font-size: 9.5px;
  font-family: Arial, Helvetica, sans-serif;
  margin-left: 10px;
}

.subject-line {
  text-align: center;
  font-weight: bold;
  text-decoration: underline;
  text-decoration-color: #004f79;
  text-transform: uppercase;
  font-size: 13.5px;
  letter-spacing: 0.3px;
  line-height: 1.5;
  color: #004f79;
  margin: 0 auto 30px auto;
  max-width: 90%;
}

.body-text p {
  text-align: justify;
  margin: 0 0 17px 0;
}

.consequences {
  margin: 0 0 20px 26px;
  padding: 0;
}

.consequences li {
  margin-bottom: 9px;
}

.notes-line {
  font-size: 11.5px;
  color: #555;
  font-style: italic;
  margin-bottom: 22px;
  padding-left: 12px;
  border-left: 2px solid #ccc;
}

.payment-table {
  width: 100%;
  border-collapse: collapse;
  margin-bottom: 30px;
}

.payment-table caption {
  text-align: left;
  font-size: 10.5px;
  font-weight: bold;
  letter-spacing: 1px;
  text-transform: uppercase;
  color: #004f79;
  padding-bottom: 8px;
}

.payment-table td {
  border: 1px solid #cddce6;
  padding: 9px 14px;
  font-size: 12px;
}

.payment-table td:first-child {
  color: #555;
  width: 45%;
  background: #f4f8fb;
}

.payment-table td:last-child {
  font-weight: bold;
  text-align: right;
}

.sign-off { margin-bottom: 12px; }

.signature-space { height: 50px; }

.signature-block p { margin: 1px 0; }
.signature-block .signature-line {
  border-top: 1px solid #333;
  width: 220px;
  margin-bottom: 6px;
}
.signature-block .name { font-weight: bold; }
.signature-block .title { color: #555; font-size: 11.5px; font-style: italic; }

.important-notice {
  border: 1px solid #cddce6;
  border-left: 3px solid #004f79;
  padding: 12px 18px;
  font-size: 11px;
  color: #333;
  margin: 28px 0 20px 0;
}

.important-notice strong { text-transform: uppercase; letter-spacing: 0.5px; color: #004f79; }
</style>
</head>
<body>

<div class="masthead">
  <p class="landlord-name">${landlord.name ?? "-"}</p>
  ${property.name ? `<p class="property-line">${property.name}${unit?.unitNo ? ` &middot; Unit ${unit.unitNo}` : ""}</p>` : ""}
  ${landlord.address ? `<p class="landlord-address">${landlord.address}</p>` : ""}
  ${landlord.phone || landlord.email ? `<p class="contact-line">${[landlord.phone ? `Tel: ${landlord.phone}` : null, landlord.email].filter(Boolean).join("  &middot;  ")}</p>` : ""}
</div>

<div class="ref-date-row">
  <div class="refs">
    <p>Letter No: ${demandLetter.letterNumber ?? "-"}</p>
    ${invoice?.invoiceNumber ? `<p>Our Ref: ${invoice.invoiceNumber}</p>` : ""}
  </div>
  <div class="date">
    ${formatDate(demandLetter.issueDate)}
    ${demandLetter.status ? `<span class="status-pill" style="background:${statusColor}">${demandLetter.status}</span>` : ""}
  </div>
</div>

<div class="tenant-block">
  <div class="to-label">To</div>
  <p class="name">${tenant.fullName ?? "-"}</p>
  ${property.address ? `<p>${property.address}${unit?.unitNo ? `, Unit ${unit.unitNo}` : ""}</p>` : ""}
  ${tenant.POBox ? `<p>${tenant.POBox}</p>` : ""}
  ${tenant.contact ? `<p>Tel: ${tenant.contact}</p>` : ""}
</div>

<p>Dear Sir/Madam,</p>

<p class="subject-line">
  Re: Demand for Outstanding Rent Balance of ${currency(demandLetter.outstandingAmount)}
  ${demandLetter.rentalPeriod ? `for ${demandLetter.rentalPeriod}` : ""}
</p>

<div class="body-text">
  <p>
    The Landlord, ${landlord.name ?? "-"}, the lawful landlord and owner of the premises you
    currently occupy${property?.name ? ` at ${property.name}` : ""}${unit?.unitNo ? ` (Unit ${unit.unitNo})` : ""},
    writes to formally demand payment of the outstanding rent balance of
    ${currency(demandLetter.outstandingAmount)}
    ${demandLetter.rentalPeriod ? `for the rental period (${demandLetter.rentalPeriod})` : ""},
    pursuant to the tenancy agreement executed between us.
  </p>

  <p>
    As per the terms of the said agreement, you are required to pay rent equivalent to
    ${currency(tenant.rent)} every ${paymentFrequency}, payable in advance on or before the
    due date of each payment period.
  </p>

  <p>
    However, our records indicate that you have failed to remit the full rent payment
    ${demandLetter.rentalPeriod ? `for ${demandLetter.rentalPeriod}` : ""}, which was due on
    ${formatDate(demandLetter.dueDate)}. This has resulted in an outstanding balance of
    ${currency(demandLetter.outstandingAmount)}, which remains unpaid to date.
  </p>

  <p>
    We hereby demand that you settle the aforementioned outstanding balance in full within
    ${demandLetter.demandPeriod ?? `${deadlineDays} days`} from the date of this letter.
    Failure to comply with this demand shall leave the Landlord with no option but to take
    further legal action to recover the arrears, which may include but is not limited to:
  </p>

  <ul class="consequences">
    <li>Initiating eviction proceedings in accordance with the law;</li>
    <li>Filing a civil suit for recovery of the outstanding amount plus interest and legal costs;</li>
    <li>Reporting the matter to relevant authorities including credit reference bureaus.</li>
  </ul>

  <p>
    Kindly note that the Landlord reserves the right to charge interest on the outstanding
    balance at the prevailing market rate and to recover all legal costs incurred in pursuing
    this matter. If payment has already been made, please disregard this notice and contact us
    with proof of payment.
  </p>
</div>

${demandLetter.notes ? `
<div class="notes-line">${demandLetter.notes}</div>
` : ""}

<table class="payment-table">
  <caption>Payment Details</caption>
  <tr><td>Outstanding Amount</td><td>${currency(demandLetter.outstandingAmount)}</td></tr>
  <tr><td>Rental Period</td><td>${demandLetter.rentalPeriod ?? "-"}</td></tr>
  <tr><td>Due Date</td><td>${formatDate(demandLetter.dueDate)}</td></tr>
  ${demandLetter.partialPayment > 0 ? `
  <tr><td>Partial Payment Received${demandLetter.partialPaymentDate ? ` (${formatDate(demandLetter.partialPaymentDate)})` : ""}</td><td>${currency(demandLetter.partialPayment)}</td></tr>
  ` : ""}
  <tr><td>Payment Deadline</td><td>${demandLetter.demandPeriod ?? `${deadlineDays} days`} from date of this letter</td></tr>
</table>

<p>We trust that you will treat this matter with the urgency it deserves.</p>

<p class="sign-off">Yours faithfully,</p>

<div class="signature-space"></div>

<div class="signature-block">
  <div class="signature-line"></div>
  <p class="name">${landlord.name ?? "-"}</p>
  <p class="title">Landlord</p>
</div>

<div class="important-notice">
  <strong>Important:</strong> This is a formal demand for payment. Failure to respond may
  result in legal action without further notice.
</div>

</body>
</html>
`;
}

/**
 * Puppeteer footerTemplate for the demand letter -- renders on every
 * printed page via page.pdf({ displayHeaderFooter: true, footerTemplate }).
 * Must be self-contained inline CSS; external stylesheets are not applied
 * inside header/footer templates.
 */
export function buildDemandLetterFooterTemplate(demandLetter) {
  return `
<div style="font-size:9px; color:#999; width:100%; text-align:center; padding:0 45px; font-family:Georgia,'Times New Roman',serif; border-top:1px solid #cddce6; padding-top:6px; letter-spacing:0.3px;">
  Letter Number: ${demandLetter?.letterNumber ?? "-"} &middot;
  Generated on: ${formatDate(demandLetter?.generatedAt ?? demandLetter?.issueDate)}
  &middot; Page <span class="pageNumber"></span> of <span class="totalPages"></span>
</div>
`;
}