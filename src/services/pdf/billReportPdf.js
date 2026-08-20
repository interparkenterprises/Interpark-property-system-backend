import fs from "fs";
import path from "path";

const letterhead = fs.readFileSync(
  path.join(process.cwd(), "src/letterHeads/letterhead-02.jpg")
);
const letterheadBase64 = `data:image/jpeg;base64,${letterhead.toString("base64")}`;

const amountOnly = (value) =>
  Number(value ?? 0).toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const currencyCell = (value, emphasis = "") => `
<div class="currency-cell">
  <span class="currency-label">KSH</span>
  <span class="currency-amount ${emphasis}">${amountOnly(value)}</span>
</div>`;

const statusColor = (status) =>
  status === "PAID" ? "#22c55e" : status === "PARTIAL" ? "#f59e0b" : status === "OVERDUE" ? "#ef4444" : "#6b7280";

const formatDate = (d) => d ? new Date(d).toLocaleDateString("en-KE", { day: "2-digit", month: "short", year: "numeric" }) : "-";

/**
 * Combined bill invoices report -- every bill invoice (water/electricity) for
 * a tenant in one document. Same design language as allPaymentReportsPdf.js
 * (stacked KSH cells, letterhead, brand blue, repeating footer via Puppeteer).
 */
export function buildBillReportHtml(tenant, billInvoices) {
  if (!tenant) throw new Error("Tenant not found");
  if (!billInvoices || billInvoices.length === 0) throw new Error("No bill invoices available for this tenant");

  const property = tenant.unit?.property || {};
  const sorted = [...billInvoices].sort((a, b) => new Date(b.issueDate) - new Date(a.issueDate));

  const totals = sorted.reduce((acc, b) => {
    acc.grandTotal += Number(b.grandTotal ?? 0);
    acc.amountPaid += Number(b.amountPaid ?? 0);
    acc.balance += Number(b.balance ?? 0);
    return acc;
  }, { grandTotal: 0, amountPaid: 0, balance: 0 });

  const generatedOn = new Date().toLocaleDateString("en-KE", { day: "2-digit", month: "long", year: "numeric" });

  return `
<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<style>
* { box-sizing: border-box; }
body { font-family: Arial, Helvetica, sans-serif; font-size: 12px; color: #333; margin: 0; }
.letterhead { width: 100%; display: block; margin-bottom: 10px; }
.title-block { text-align: center; margin: 18px 0 28px 0; padding-bottom: 16px; border-bottom: 2px solid #004f79; }
.title-block h1 { font-size: 22px; font-weight: bold; color: #004f79; letter-spacing: 0.5px; margin: 0 0 6px 0; }
.title-block .generated { font-size: 11px; color: #777; }
.section-label { font-size: 13px; font-weight: bold; color: #004f79; margin: 0 0 10px 0; text-transform: uppercase; letter-spacing: 0.5px; }
.tenant-box { background: #f4f6f8; border: 1px solid #e2e6ea; border-radius: 6px; padding: 18px 22px; margin-bottom: 28px; }
.tenant-grid { display: flex; justify-content: space-between; flex-wrap: wrap; }
.tenant-grid .col { width: 48%; }
.tenant-grid p { margin: 6px 0; font-size: 12.5px; }
.tenant-grid .label { display: inline-block; width: 105px; color: #555; font-weight: bold; }
table.history { width: 100%; border-collapse: collapse; margin-bottom: 30px; }
table.history th { background: #004f79; color: #fff; padding: 7px 6px; font-size: 9.5px; text-align: left; }
table.history td { padding: 7px 6px; border-bottom: 1px solid #e5e8eb; font-size: 9.5px; vertical-align: middle; }
table.history tbody tr:nth-child(even) { background: #f9fafb; }
.currency-cell { display: flex; flex-direction: column; line-height: 1.25; }
.currency-label { font-size: 7.5px; font-weight: bold; color: #8a9aa5; letter-spacing: 0.5px; }
.currency-amount { font-size: 11px; font-weight: 600; color: #1a1a1a; }
.currency-amount.positive { color: #16a34a; }
.currency-amount.warning { color: #dc2626; }
.status-pill { display: inline-block; padding: 3px 8px; border-radius: 10px; color: #fff; font-weight: bold; font-size: 9px; }
.summary-grid { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 12px; margin-bottom: 10px; }
.summary-card { border: 1px solid #e2e6ea; border-radius: 6px; padding: 14px 18px; background: #fafbfc; text-align: center; }
.summary-card .label { font-size: 10px; color: #666; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 6px; }
</style>
</head>
<body>
<img src="${letterheadBase64}" class="letterhead">
<div class="title-block">
  <h1>BILL INVOICES — SUMMARY REPORT</h1>
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
      <p><span class="label">KRA PIN:</span> ${tenant.KRAPin ?? "-"}</p>
    </div>
  </div>
</div>
<div class="section-label">Bill Invoices (${sorted.length})</div>
<table class="history">
<thead>
<tr>
  <th>Invoice No.</th><th>Type</th><th>Issue Date</th><th>Due Date</th><th>Units</th><th>Grand Total</th><th>Paid</th><th>Balance</th><th>Status</th>
</tr>
</thead>
<tbody>
${sorted.map(b => `
<tr>
  <td>${b.invoiceNumber ?? "-"}</td>
  <td>${b.billType === "WATER" ? "Water" : b.billType === "ELECTRICITY" ? "Electricity" : b.billType ?? "-"}</td>
  <td>${formatDate(b.issueDate)}</td>
  <td>${formatDate(b.dueDate)}</td>
  <td>${Number(b.units ?? 0).toLocaleString()}</td>
  <td>${currencyCell(b.grandTotal)}</td>
  <td>${currencyCell(b.amountPaid, "positive")}</td>
  <td>${currencyCell(b.balance, b.balance > 0 ? "warning" : "")}</td>
  <td><span class="status-pill" style="background:${statusColor(b.status)}">${b.status ?? "-"}</span></td>
</tr>`).join("")}
</tbody>
</table>
<div class="section-label">Summary</div>
<div class="summary-grid">
  <div class="summary-card"><div class="label">Total Billed</div>${currencyCell(totals.grandTotal)}</div>
  <div class="summary-card"><div class="label">Total Paid</div>${currencyCell(totals.amountPaid, "positive")}</div>
  <div class="summary-card"><div class="label">Total Balance</div>${currencyCell(totals.balance, totals.balance > 0 ? "warning" : "positive")}</div>
</div>
</body>
</html>
`;
}

export function buildBillReportFooterTemplate() {
  return `
<div style="font-size:9px; color:#888; width:100%; text-align:center; padding:0 45px; font-family:Arial,Helvetica,sans-serif; border-top:1px solid #ccc; padding-top:6px;">
  <span style="font-weight:bold;">INTERPARK PROPERTY MANAGEMENT</span><br>
  0110 060 088 &nbsp;|&nbsp; info@interparkenterprises.co.ke &nbsp;|&nbsp; www.interparkenterprises.co.ke
  &nbsp;&nbsp;&middot;&nbsp;&nbsp; Page <span class="pageNumber"></span> of <span class="totalPages"></span>
</div>
`;
}