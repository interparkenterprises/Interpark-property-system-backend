import fs from "fs";
import path from "path";

const letterhead = fs.readFileSync(
  path.join(process.cwd(), "src/letterHeads/letterhead-02.jpg")
);

const letterheadBase64 = `data:image/jpeg;base64,${letterhead.toString("base64")}`;

// Returns just the formatted number (no "Ksh" prefix) -- used inside the
// stacked currency cell markup below, and anywhere a raw amount is needed.
const amountOnly = (value) =>
  Number(value ?? 0).toLocaleString("en-KE", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

// Stacked "KSH" label above the amount, for consistent currency display
// across every cell in both the history table and the summary cards.
const currencyCell = (value, options = {}) => {
  const { emphasis = "" } = options; // e.g. "positive" | "warning" for colored amounts
  return `
<div class="currency-cell">
  <span class="currency-label">KSH</span>
  <span class="currency-amount ${emphasis}">${amountOnly(value)}</span>
</div>`;
};

const statusColor = (status) =>
  status === "PAID"
    ? "#22c55e"
    : status === "PARTIAL"
    ? "#f59e0b"
    : status === "CREDIT" || status === "PREPAID"
    ? "#0d6efd"
    : "#ef4444";

/**
 * Build a single combined, letterhead-branded PDF listing every payment
 * report for a tenant, including the linked invoice number/date per row
 * (reference number reuses the invoice number, per product decision).
 *
 * NOTE: this HTML intentionally has NO footer -- the footer is rendered by
 * Puppeteer's own footerTemplate mechanism (see buildAllPaymentReportsFooterTemplate
 * below) so it repeats correctly at the bottom of every printed page.
 * A CSS position:fixed footer inside the page content does NOT repeat
 * reliably across multi-page PDFs in Chromium's print engine -- tested,
 * and it overlaps table content on longer payment histories.
 */
export function buildAllPaymentReportsHtml(tenant, paymentReports) {
  if (!tenant) {
    throw new Error("Tenant not found");
  }
  if (!paymentReports || paymentReports.length === 0) {
    throw new Error("No payment reports available for this tenant");
  }

  const property = tenant.unit?.property || {};

  const sorted = [...paymentReports].sort((a, b) => {
    const da = a.paymentPeriod ? new Date(a.paymentPeriod).getTime() : 0;
    const db = b.paymentPeriod ? new Date(b.paymentPeriod).getTime() : 0;
    return db - da;
  });

  const totals = sorted.reduce(
    (acc, r) => {
      acc.rent += Number(r.rent ?? 0);
      acc.serviceCharge += Number(r.serviceCharge ?? 0);
      acc.vat += Number(r.vat ?? 0);
      acc.totalDue += Number(r.totalDue ?? 0);
      acc.amountPaid += Number(r.amountPaid ?? 0);
      acc.arrears += Number(r.arrears ?? 0);
      return acc;
    },
    { rent: 0, serviceCharge: 0, vat: 0, totalDue: 0, amountPaid: 0, arrears: 0 }
  );

  const generatedOn = new Date().toLocaleDateString("en-KE", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });

  return `
<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<style>
* { box-sizing: border-box; }

body {
  font-family: Arial, Helvetica, sans-serif;
  font-size: 12px;
  color: #333;
  margin: 0;
}

.letterhead {
  width: 100%;
  display: block;
  margin-bottom: 10px;
}

.title-block {
  text-align: center;
  margin: 18px 0 28px 0;
  padding-bottom: 16px;
  border-bottom: 2px solid #004f79;
}

.title-block h1 {
  font-size: 22px;
  font-weight: bold;
  color: #004f79;
  letter-spacing: 0.5px;
  margin: 0 0 6px 0;
}

.title-block .generated {
  font-size: 11px;
  color: #777;
}

.section-label {
  font-size: 13px;
  font-weight: bold;
  color: #004f79;
  margin: 0 0 10px 0;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.tenant-box {
  background: #f4f6f8;
  border: 1px solid #e2e6ea;
  border-radius: 6px;
  padding: 18px 22px;
  margin-bottom: 28px;
}

.tenant-grid {
  display: flex;
  justify-content: space-between;
  flex-wrap: wrap;
}

.tenant-grid .col { width: 48%; }

.tenant-grid p {
  margin: 6px 0;
  font-size: 12.5px;
}

.tenant-grid .label {
  display: inline-block;
  width: 105px;
  color: #555;
  font-weight: bold;
}

table.history {
  width: 100%;
  border-collapse: collapse;
  margin-bottom: 30px;
}

table.history th {
  background: #004f79;
  color: #fff;
  padding: 7px 6px;
  font-size: 9.5px;
  text-align: left;
}

table.history td {
  padding: 7px 6px;
  border-bottom: 1px solid #e5e8eb;
  font-size: 9.5px;
  vertical-align: middle;
}

table.history tbody tr:nth-child(even) { background: #f9fafb; }

/* Stacked currency cell: small "KSH" label above a bold amount,
   used consistently in every money column and in the summary cards. */
.currency-cell {
  display: flex;
  flex-direction: column;
  line-height: 1.25;
}

.currency-label {
  font-size: 7.5px;
  font-weight: bold;
  color: #8a9aa5;
  letter-spacing: 0.5px;
}

.currency-amount {
  font-size: 11px;
  font-weight: 600;
  color: #1a1a1a;
}

.currency-amount.positive { color: #16a34a; }
.currency-amount.warning { color: #dc2626; }

.status-pill {
  display: inline-block;
  padding: 3px 8px;
  border-radius: 10px;
  color: #fff;
  font-weight: bold;
  font-size: 9px;
}

.summary-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
  margin-bottom: 10px;
}

.summary-card {
  border: 1px solid #e2e6ea;
  border-radius: 6px;
  padding: 14px 18px;
  background: #fafbfc;
}

.summary-card .row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 7px 0;
  font-size: 12px;
  border-bottom: 1px solid #eef1f3;
}

.summary-card .row:last-child { border-bottom: none; }

.summary-card .row .row-label { color: #444; }

.summary-card .row .currency-cell {
  align-items: flex-end;
}
</style>
</head>
<body>

<img src="${letterheadBase64}" class="letterhead">

<div class="title-block">
  <h1>TENANT PAYMENT REPORT — SUMMARY</h1>
  <div class="generated">Generated on: ${generatedOn}</div>
</div>

<div class="section-label">Tenant Information</div>
<div class="tenant-box">
  <div class="tenant-grid">
    <div class="col">
      <p><span class="label">Name:</span> ${tenant.fullName ?? "-"}</p>
      <p><span class="label">Contact:</span> ${tenant.contact ?? "-"}</p>
      <p><span class="label">Unit:</span> ${tenant.unit?.unitNo ?? "-"}</p>
    </div>
    <div class="col">
      <p><span class="label">Premise:</span> ${property.name ?? "-"}</p>
      <p><span class="label">Monthly Rent:</span> Ksh ${amountOnly(tenant.rent)}</p>
      <p><span class="label">KRA PIN:</span> ${tenant.KRAPin ?? "-"}</p>
    </div>
  </div>
</div>

<div class="section-label">Payment History (${sorted.length} report${sorted.length > 1 ? "s" : ""})</div>
<table class="history">
<thead>
<tr>
  <th>Period</th>
  <th>Date Paid</th>
  <th>Invoice No. / Ref</th>
  <th>Invoice Date</th>
  <th>Rent</th>
  <th>Svc Charge</th>
  <th>VAT</th>
  <th>Total Due</th>
  <th>Paid</th>
  <th>Arrears</th>
  <th>Status</th>
</tr>
</thead>
<tbody>
${sorted
  .map((r) => {
    // A PaymentReport can have multiple linked Invoices; the combined
    // report shows the most relevant one (first match) per row.
    const invoice = (r.invoices && r.invoices[0]) || null;
    return `
<tr>
  <td>${
    r.paymentPeriod
      ? new Date(r.paymentPeriod).toLocaleDateString("en-KE", { month: "short", year: "numeric" })
      : "-"
  }</td>
  <td>${r.datePaid ? new Date(r.datePaid).toLocaleDateString("en-KE") : "-"}</td>
  <td>${invoice?.invoiceNumber ?? "-"}</td>
  <td>${invoice?.issueDate ? new Date(invoice.issueDate).toLocaleDateString("en-KE") : "-"}</td>
  <td>${currencyCell(r.rent)}</td>
  <td>${r.serviceCharge ? currencyCell(r.serviceCharge) : "-"}</td>
  <td>${r.vat ? currencyCell(r.vat) : "-"}</td>
  <td>${currencyCell(r.totalDue)}</td>
  <td>${currencyCell(r.amountPaid, { emphasis: "positive" })}</td>
  <td>${currencyCell(r.arrears, { emphasis: r.arrears > 0 ? "warning" : "" })}</td>
  <td><span class="status-pill" style="background:${statusColor(r.status)}">${r.status ?? "-"}</span></td>
</tr>`;
  })
  .join("")}
</tbody>
</table>

<div class="section-label">Summary</div>
<div class="summary-grid">
  <div class="summary-card">
    <div class="row"><span class="row-label">Total Rent</span>${currencyCell(totals.rent)}</div>
    <div class="row"><span class="row-label">Total Service Charge</span>${currencyCell(totals.serviceCharge)}</div>
    <div class="row"><span class="row-label">Total VAT</span>${currencyCell(totals.vat)}</div>
  </div>
  <div class="summary-card">
    <div class="row"><span class="row-label">Total Due</span>${currencyCell(totals.totalDue)}</div>
    <div class="row"><span class="row-label">Total Paid</span>${currencyCell(totals.amountPaid, { emphasis: "positive" })}</div>
    <div class="row"><span class="row-label">Total Arrears</span>${currencyCell(totals.arrears, { emphasis: totals.arrears > 0 ? "warning" : "positive" })}</div>
  </div>
</div>

</body>
</html>
`;
}

/**
 * Puppeteer footerTemplate for the combined report -- renders on every
 * printed page via page.pdf({ displayHeaderFooter: true, footerTemplate }).
 * Must be self-contained inline CSS; external stylesheets are not applied
 * inside header/footer templates.
 */
export function buildAllPaymentReportsFooterTemplate() {
  return `
<div style="font-size:9px; color:#888; width:100%; text-align:center; padding:0 45px; font-family:Arial,Helvetica,sans-serif; border-top:1px solid #ccc; padding-top:6px;">
  <br>
  <span style="font-weight:bold;">INTERPARK PROPERTY MANAGEMENT</span><br>
  0110 060 088 &nbsp;|&nbsp; info@interparkenterprises.co.ke &nbsp;|&nbsp; www.interparkenterprises.co.ke
  &nbsp;&nbsp;&middot;&nbsp;&nbsp; Page <span class="pageNumber"></span> of <span class="totalPages"></span>
</div>
`;
}