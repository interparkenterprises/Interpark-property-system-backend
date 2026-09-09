import fs from "fs";
import path from "path";

const letterhead = fs.readFileSync(
  path.join(process.cwd(), "src/letterHeads/letterhead.jpg")
);

const letterheadBase64 = `data:image/png;base64,${letterhead.toString("base64")}`;

const currency = (value) =>
  Number(value ?? 0).toLocaleString("en-KE", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

/**
 * A balance invoice is created with a default notes value of
 * "Balance invoice for {period}" whenever no custom notes are supplied
 * (see generateInvoiceFromPartialPayment in invoice.controller.js). This
 * is the same convention the rest of the codebase already relies on to
 * identify balance invoices -- there's no dedicated `type` column on the
 * Invoice model, so this is the most consistent signal available.
 */
function isBalanceInvoice(invoice) {
  return Boolean(invoice.notes && invoice.notes.toLowerCase().startsWith("balance invoice for"));
}

/**
 * NOTE ON THE FOOTER: this HTML intentionally has NO footer element.
 * The footer is rendered by Puppeteer's own footerTemplate mechanism
 * (see buildInvoiceFooterTemplate below), called via
 * generatePDF(html, { displayHeaderFooter: true, footerTemplate, margin }).
 * A footer placed inside the page content -- even with CSS position:fixed --
 * does NOT repeat reliably at the true bottom of every printed page in
 * Chromium's print engine; it was tested and either disappears on later
 * pages or overlaps table content. Puppeteer's footerTemplate is the only
 * approach confirmed to work correctly across single- and multi-page PDFs.
 */
export function buildInvoiceHtml(invoice) {
  const tenant = invoice.tenant;

  if (!tenant) {
    throw new Error("Tenant not found on invoice");
  }

  const property = tenant.unit?.property || {};
  const balanceVariant = isBalanceInvoice(invoice);

  const statusColor =
    invoice.status === "PAID"
      ? "#22c55e"
      : invoice.status === "PARTIAL"
      ? "#f59e0b"
      : "#ef4444";

  const rent = Number(invoice.rent ?? 0);
  const serviceCharge = Number(invoice.serviceCharge ?? 0);
  const vat = Number(invoice.vat ?? 0);
  const subtotal = rent + serviceCharge;

  const items = [
    { description: `Rent - ${invoice.paymentPeriod ?? "-"}`, qty: 1, amount: rent },
    ...(serviceCharge > 0
      ? [{ description: "Service Charge", qty: 1, amount: serviceCharge }]
      : []),
  ];

  const paymentReport = invoice.paymentReport || null;

  const titleText = balanceVariant ? "Balance Invoice" : "Pro Forma Invoice";
  const titleColor = balanceVariant ? "#004f79" : "#004f79";
  const headerBarColor = balanceVariant ? "#004f79" : "#004f79";

  return `
<!DOCTYPE html>
<html>

<head>

<meta charset="UTF-8">

<style>

*{
box-sizing:border-box;
}

body{
font-family:Arial,Helvetica,sans-serif;
font-size:13px;
color:#333;
margin:0;
}

.header{
display:flex;
justify-content:space-between;
align-items:flex-start;
border-bottom:2px solid ${headerBarColor};
padding-bottom:15px;
margin-bottom:25px;
}

.logo{
height:75px;
}

.title{
text-align:center;
font-size:28px;
font-weight:bold;
margin:25px 0;
color:${titleColor};
letter-spacing:1px;
${balanceVariant ? "text-transform:uppercase;" : ""}
}

.details{
display:flex;
justify-content:space-between;
margin-bottom:25px;
}

.left{
width:55%;
}

.right{
width:40%;
}

.left p,
.right p{
margin:6px 0;
}

.status{
display:inline-block;
padding:5px 12px;
border-radius:4px;
background:${statusColor};
color:#fff;
font-weight:bold;
font-size:12px;
}

.balance-warning{
margin:20px 0;
padding:15px 18px;
background:#fef3c7;
border:1px solid #f59e0b;
border-left:4px solid #d97706;
border-radius:4px;
}

.balance-warning .heading{
font-weight:bold;
color:#92400e;
margin-bottom:6px;
}

.balance-warning p{
margin:3px 0;
color:#78350f;
font-size:12px;
}

.payment-summary{
margin:20px 0;
padding:18px 22px;
background:#f8fafc;
border:1px solid #e2e8f0;
border-radius:6px;
}

.payment-summary .heading{
font-size:13px;
font-weight:bold;
letter-spacing:0.5px;
text-transform:uppercase;
color:#1e293b;
margin-bottom:12px;
}

.payment-summary .row{
display:flex;
justify-content:space-between;
padding:5px 0;
font-size:13px;
}

.payment-summary .row.paid{
color:#16a34a;
font-weight:bold;
}

.payment-summary .row.outstanding{
color:#dc2626;
font-weight:bold;
font-size:14px;
border-top:1px solid #e2e8f0;
margin-top:6px;
padding-top:10px;
}

table{
width:100%;
border-collapse:collapse;
margin-top:20px;
}

th{
background:${headerBarColor};
color:white;
padding:10px;
}

td{
padding:10px;
border:1px solid #ddd;
}

.important-notice{
margin-top:25px;
padding:14px 18px;
background:#fef3c7;
border:1px solid #d97706;
border-radius:4px;
}

.important-notice .heading{
font-weight:bold;
color:#92400e;
}

.bank{
margin-top:35px;
padding:15px;
background:#f8f9fa;
border-left:4px solid #0d6efd;
}

.bank h3{
margin-top:0;
}

</style>

</head>

<body>

<div class="header">

<div>

<img src="${letterheadBase64}" class="logo">

</div>


</div>

<div class="title">

${titleText}

</div>

<div class="details">

<div class="left">

<p><strong>Tenant</strong></p>

<p><strong>${tenant.fullName ?? "-"}</strong></p>

<p><strong>Premise</strong>: ${property.name ?? "-"}</p>

<p><strong>Unit</strong>: ${tenant.unit?.unitNo ?? "-"}</p>

</div>

<div class="right">

<p><strong>Payment Period:</strong> ${invoice.paymentPeriod ?? "-"}</p>

<p><strong>Issue Date:</strong> ${
  invoice.issueDate
    ? new Date(invoice.issueDate).toLocaleDateString()
    : "-"
}</p>

<p><strong>Due Date:</strong> ${
  invoice.dueDate
    ? new Date(invoice.dueDate).toLocaleDateString()
    : "-"
}</p>

<p><strong>Invoice No:</strong> ${invoice.invoiceNumber ?? "-"}</p>

<p><strong>Status:</strong>
<span class="status">${invoice.status ?? "UNPAID"}</span>
</p>

</div>

</div>

${balanceVariant ? `
<div class="balance-warning">
  <div class="heading">⚠ Balance Invoice — Outstanding Payment</div>
  <p>This invoice represents the outstanding balance from a partial payment.</p>
  <p>Original Payment Period: ${invoice.paymentPeriod ?? "-"}</p>
</div>
` : ""}

${balanceVariant && paymentReport ? `
<div class="payment-summary">
  <div class="heading">Payment Summary</div>
  <div class="row"><span>Original Total Due</span><span>Ksh ${currency(paymentReport.totalDue)}</span></div>
  <div class="row paid"><span>Amount Previously Paid</span><span>Ksh ${currency(paymentReport.amountPaid)}</span></div>
  <div class="row outstanding"><span>Outstanding Balance</span><span>Ksh ${currency(paymentReport.arrears)}</span></div>
</div>
` : ""}

<table>
<thead>
<tr>
<th>Description</th>
<th style="text-align:center">Quantity</th>
<th style="text-align:right">Amount</th>
</tr>
</thead>

<tbody>

${items.map(item => `
<tr>
<td>${item.description}</td>
<td style="text-align:center">${item.qty}</td>
<td style="text-align:right">${currency(item.amount)}</td>
</tr>
`).join("")}

</tbody>

<tfoot>

<tr>
<td colspan="2" align="right"><strong>Subtotal</strong></td>
<td style="text-align:right">${currency(subtotal)}</td>
</tr>

<tr>
<td colspan="2" align="right"><strong>VAT</strong></td>
<td style="text-align:right">${currency(vat)}</td>
</tr>

<tr>
<td colspan="2" align="right"><strong>${balanceVariant ? "Total Balance Due" : "Grand Total"}</strong></td>
<td style="text-align:right">${currency(invoice.totalDue)}</td>
</tr>

<tr>
<td colspan="2" align="right"><strong>Amount Paid</strong></td>
<td style="text-align:right">${currency(invoice.amountPaid)}</td>
</tr>

<tr>
<td colspan="2" align="right"><strong>Balance Due</strong></td>
<td style="text-align:right">${currency(invoice.balance)}</td>
</tr>

</tfoot>

</table>

${balanceVariant ? `
<div class="important-notice">
  <span class="heading">⚠ Important Notice</span> —
  Please settle this outstanding balance by the due date to avoid additional charges.
</div>
` : ""}

<div class="bank">

<h3>Payment Details</h3>

<p><strong>Bank:</strong> ${property.bank ?? "-"}</p>

<p><strong>Account Name:</strong> ${property.accountName ?? "-"}</p>

<p><strong>Account Number:</strong> ${property.accountNo ?? "-"}</p>

${
property.branch
? `<p><strong>Branch:</strong> ${property.branch}</p>`
: ""
}

${
property.branchCode
? `<p><strong>Branch Code:</strong> ${property.branchCode}</p>`
: ""
}

</div>

${
invoice.notes
? `
<div style="margin-top:25px">

<strong>Notes</strong>

<p>${invoice.notes}</p>

</div>
`
: ""
}

</body>

</html>

`;
}

/**
 * Puppeteer footerTemplate for invoices -- renders on every printed page
 * via page.pdf({ displayHeaderFooter: true, footerTemplate }). Must be
 * self-contained inline CSS; external stylesheets are not applied inside
 * header/footer templates.
 */
export function buildInvoiceFooterTemplate() {
  return `
<div style="font-size:9px; color:#777; width:100%; text-align:center; padding:0 45px; font-family:Arial,Helvetica,sans-serif; border-top:1px solid #ccc; padding-top:6px;">
  <strong>INTERPARK PROPERTY MANAGEMENT</strong><br>
  Property Management Solutions
  &nbsp;&middot;&nbsp; Page <span class="pageNumber"></span> of <span class="totalPages"></span>
</div>
`;
}