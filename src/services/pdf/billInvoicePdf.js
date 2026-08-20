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

const formatDate = (date) =>
  date
    ? new Date(date).toLocaleDateString("en-KE", {
        day: "2-digit",
        month: "short",
        year: "numeric",
      })
    : "-";

const statusColors = {
  UNPAID: "#ef4444",
  PARTIAL: "#f59e0b",
  PAID: "#22c55e",
  OVERDUE: "#ef4444",
  CANCELLED: "#6b7280",
};

/**
 * Professional utility bill invoice (water/electricity), branded with
 * Interpark's #004f79 accent.
 *
 * NOTE ON THE FOOTER: this HTML intentionally has NO footer element. The
 * footer is rendered via Puppeteer's own footerTemplate mechanism (see
 * buildBillInvoiceFooterTemplate below), called via
 * generatePDF(html, { displayHeaderFooter: true, footerTemplate, margin }).
 * A footer inside the page content -- even with CSS position:fixed -- does
 * NOT repeat reliably at the true bottom of every printed page in
 * Chromium's print engine; this was confirmed across every other document
 * type in this system and is the only approach that works correctly for
 * multi-page PDFs.
 */
export function buildBillInvoiceHtml(billInvoice) {
  if (!billInvoice) {
    throw new Error("Bill Invoice not found");
  }

  const tenant = billInvoice.tenant;
  if (!tenant) {
    throw new Error("Tenant not found");
  }

  const property = tenant.unit?.property || {};
  const statusColor = statusColors[billInvoice.status] || "#6b7280";

  const billTypeLabel =
    billInvoice.billType === "WATER" ? "Water" :
    billInvoice.billType === "ELECTRICITY" ? "Electricity" :
    billInvoice.billType;

  const billTypeIcon = billInvoice.billType === "WATER" ? "\u{1F4A7}" : "\u26A1";

  const previousReading = Number(billInvoice.previousReading ?? 0);
  const currentReading = Number(billInvoice.currentReading ?? 0);
  const units = Number(billInvoice.units ?? 0);
  const chargePerUnit = Number(billInvoice.chargePerUnit ?? 0);
  const totalAmount = Number(billInvoice.totalAmount ?? 0);
  const vatAmount = Number(billInvoice.vatAmount ?? 0);

  return `
<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<style>
* { box-sizing: border-box; }

body {
  font-family: Arial, Helvetica, sans-serif;
  font-size: 12.5px;
  color: #333;
  margin: 0;
}

.header {
  display: flex;
  justify-content: center;
  border-bottom: 2px solid #004f79;
  padding-bottom: 14px;
  margin-bottom: 10px;
}

.logo { height: 70px; }

.title-block {
  text-align: center;
  margin: 16px 0 26px 0;
}

.title-block h1 {
  font-size: 24px;
  font-weight: bold;
  color: #004f79;
  letter-spacing: 0.5px;
  text-transform: uppercase;
  margin: 0;
}

.title-block .bill-type-badge {
  display: inline-block;
  margin-top: 8px;
  padding: 4px 14px;
  border-radius: 12px;
  background: #eaf2f7;
  color: #004f79;
  font-weight: bold;
  font-size: 11px;
  letter-spacing: 0.5px;
}

.details {
  display: flex;
  justify-content: space-between;
  gap: 20px;
  margin-bottom: 26px;
}

.details .left, .details .right { width: 48%; }

.details p { margin: 6px 0; }
.details .field-label { color: #666; font-weight: bold; }

.status-pill {
  display: inline-block;
  padding: 4px 12px;
  border-radius: 4px;
  background: ${statusColor};
  color: #fff;
  font-weight: bold;
  font-size: 11px;
}

.section-label {
  font-size: 12px;
  font-weight: bold;
  color: #004f79;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  margin: 0 0 10px 0;
}

.reading-box {
  display: flex;
  justify-content: space-between;
  background: #f4f6f8;
  border: 1px solid #e2e6ea;
  border-radius: 6px;
  padding: 16px 20px;
  margin-bottom: 26px;
}

.reading-box .reading {
  text-align: center;
}

.reading-box .reading .label {
  font-size: 10px;
  color: #777;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  margin-bottom: 4px;
}

.reading-box .reading .value {
  font-size: 16px;
  font-weight: bold;
  color: #1a1a1a;
}

.reading-box .divider {
  width: 1px;
  background: #dde3e8;
}

table.charges {
  width: 100%;
  border-collapse: collapse;
  margin-bottom: 26px;
}

table.charges th {
  background: #004f79;
  color: #fff;
  padding: 9px 10px;
  font-size: 11.5px;
  text-align: left;
}

table.charges td {
  padding: 9px 10px;
  border-bottom: 1px solid #e5e8eb;
  font-size: 12px;
}

table.charges tfoot td {
  font-weight: bold;
  background: #f9fafb;
  border-top: 2px solid #e2e6ea;
}

table.charges tfoot tr.grand-total td {
  color: #004f79;
  font-size: 13.5px;
  background: #eaf2f7;
}

.payment-box {
  margin-top: 30px;
  padding: 16px 20px;
  background: #f4f6f8;
  border-left: 4px solid #004f79;
  border-radius: 0 6px 6px 0;
}

.payment-box h3 {
  margin: 0 0 10px 0;
  font-size: 13px;
  color: #004f79;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.payment-box p { margin: 4px 0; }

.notes-block {
  margin-top: 22px;
  padding-left: 12px;
  border-left: 2px solid #ccc;
  color: #555;
  font-size: 11.5px;
  font-style: italic;
}
</style>
</head>
<body>

<div class="header">
  <img src="${letterheadBase64}" class="logo">
</div>

<div class="title-block">
  <h1>${billTypeLabel} Bill Invoice</h1>
  <div class="bill-type-badge">${billTypeIcon} ${billTypeLabel.toUpperCase()}</div>
</div>

<div class="details">
  <div class="left">
    <p class="field-label">Tenant</p>
    <p><strong>${tenant.fullName ?? "-"}</strong></p>
    <p><span class="field-label">Premise:</span> ${property.name ?? "-"}</p>
    <p><span class="field-label">Unit:</span> ${tenant.unit?.unitNo ?? "-"}</p>
  </div>
  <div class="right">
    <p><span class="field-label">Invoice No:</span> ${billInvoice.invoiceNumber ?? "-"}</p>
    <p><span class="field-label">Bill Reference:</span> ${billInvoice.billReferenceNumber ?? "-"}</p>
    <p><span class="field-label">Issue Date:</span> ${formatDate(billInvoice.issueDate)}</p>
    <p><span class="field-label">Due Date:</span> ${formatDate(billInvoice.dueDate)}</p>
    <p><span class="field-label">Status:</span> <span class="status-pill">${billInvoice.status ?? "-"}</span></p>
  </div>
</div>

<div class="section-label">Meter Readings</div>
<div class="reading-box">
  <div class="reading">
    <div class="label">Previous Reading</div>
    <div class="value">${previousReading.toLocaleString()}</div>
  </div>
  <div class="divider"></div>
  <div class="reading">
    <div class="label">Current Reading</div>
    <div class="value">${currentReading.toLocaleString()}</div>
  </div>
  <div class="divider"></div>
  <div class="reading">
    <div class="label">Units Consumed</div>
    <div class="value">${units.toLocaleString()}</div>
  </div>
</div>

<div class="section-label">Charges</div>
<table class="charges">
<thead>
<tr>
  <th>Description</th>
  <th style="text-align:right">Amount</th>
</tr>
</thead>
<tbody>
<tr>
  <td>Charge per Unit</td>
  <td style="text-align:right">Ksh ${currency(chargePerUnit)}</td>
</tr>
<tr>
  <td>${units.toLocaleString()} units &times; Ksh ${currency(chargePerUnit)}</td>
  <td style="text-align:right">Ksh ${currency(totalAmount)}</td>
</tr>
</tbody>
<tfoot>
<tr>
  <td>Subtotal</td>
  <td style="text-align:right">Ksh ${currency(totalAmount)}</td>
</tr>
<tr>
  <td>VAT</td>
  <td style="text-align:right">Ksh ${currency(vatAmount)}</td>
</tr>
<tr class="grand-total">
  <td>Grand Total</td>
  <td style="text-align:right">Ksh ${currency(billInvoice.grandTotal)}</td>
</tr>
<tr>
  <td>Amount Paid</td>
  <td style="text-align:right">Ksh ${currency(billInvoice.amountPaid)}</td>
</tr>
<tr>
  <td>Balance Due</td>
  <td style="text-align:right">Ksh ${currency(billInvoice.balance)}</td>
</tr>
</tfoot>
</table>

<div class="payment-box">
  <h3>Payment Details</h3>
  <p><strong>Bank:</strong> ${property.bank ?? "-"}</p>
  <p><strong>Account Name:</strong> ${property.accountName ?? "-"}</p>
  <p><strong>Account Number:</strong> ${property.accountNo ?? "-"}</p>
  ${property.branch ? `<p><strong>Branch:</strong> ${property.branch}</p>` : ""}
  ${property.branchCode ? `<p><strong>Branch Code:</strong> ${property.branchCode}</p>` : ""}
</div>

${billInvoice.notes ? `<div class="notes-block">${billInvoice.notes}</div>` : ""}

</body>
</html>
`;
}

/**
 * Puppeteer footerTemplate for bill invoices -- renders on every printed
 * page via page.pdf({ displayHeaderFooter: true, footerTemplate }). Must
 * be self-contained inline CSS; external stylesheets are not applied
 * inside header/footer templates.
 */
export function buildBillInvoiceFooterTemplate() {
  return `
<div style="font-size:9px; color:#777; width:100%; text-align:center; padding:0 45px; font-family:Arial,Helvetica,sans-serif; border-top:1px solid #ccc; padding-top:6px;">
  <strong>INTERPARK ENTERPRISES LIMITED</strong><br>
  0110 060 088 &nbsp;|&nbsp; info@interparkenterprises.co.ke &nbsp;|&nbsp; www.interparkenterprises.co.ke
  &nbsp;&nbsp;&middot;&nbsp;&nbsp; Page <span class="pageNumber"></span> of <span class="totalPages"></span>
</div>
`;
}