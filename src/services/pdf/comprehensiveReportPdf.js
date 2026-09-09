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
  status === "PAID" ? "#22c55e" : status === "PARTIAL" ? "#f59e0b" : status === "OVERDUE" ? "#ef4444" : status === "UNPAID" ? "#ef4444" : "#6b7280";

const shortDate = (d) => d ? new Date(d).toLocaleDateString("en-KE") : "-";

/**
 * Comprehensive report -- matches the structure of the tenant's existing
 * combined report exactly (Rent Payment History merging payment reports +
 * invoices into one table, a separate Bill Payment History table, and a
 * simple 3-row Comprehensive Summary table), with professional styling
 * layered on top: letterhead, brand color, stacked KSH cells, and a
 * properly repeating Puppeteer footer.
 */
export function buildComprehensiveReportHtml(tenant, { paymentReports = [], invoices = [], billInvoices = [] }) {
  if (!tenant) throw new Error("Tenant not found");

  const property = tenant.unit?.property || {};
  const generatedOn = new Date().toLocaleDateString("en-KE", { day: "2-digit", month: "long", year: "numeric" });

  // Merge payment reports + invoices into one "Rent Payment History" table,
  // matching the reference report's structure -- each source contributes
  // its own rows rather than being deduplicated/joined (row-level display
  // is unchanged from before).
  const rentRows = [
    ...paymentReports.map((r) => ({
      period: r.paymentPeriod ? new Date(r.paymentPeriod).toLocaleDateString("en-KE", { month: "short", year: "numeric" }) : "-",
      invoiceNo: "-",
      issueDate: null,
      datePaid: r.datePaid,
      rent: r.rent,
      serviceCharge: r.serviceCharge,
      vat: r.vat,
      totalDue: r.totalDue,
      amountPaid: r.amountPaid,
      arrears: r.arrears,
      status: r.status,
      sortDate: r.paymentPeriod ? new Date(r.paymentPeriod).getTime() : 0
    })),
    ...invoices.map((i) => ({
      period: i.paymentPeriod ?? "-",
      invoiceNo: i.invoiceNumber ?? "-",
      issueDate: i.issueDate,
      datePaid: i.issueDate, // Invoice has no dedicated "date paid" field
      rent: i.rent,
      serviceCharge: i.serviceCharge,
      vat: i.vat,
      totalDue: i.totalDue,
      amountPaid: i.amountPaid,
      arrears: i.balance,
      status: i.status,
      sortDate: i.issueDate ? new Date(i.issueDate).getTime() : 0
    }))
  ].sort((a, b) => b.sortDate - a.sortDate);

  const periodKey = (date) => {
    if (!date) return "unknown";
    return new Date(date).toLocaleDateString("en-US", { year: "numeric", month: "short" });
  };

  const reportsByPeriod = new Map();
  for (const r of paymentReports) {
    const key = periodKey(r.paymentPeriod);
    if (!reportsByPeriod.has(key)) reportsByPeriod.set(key, []);
    reportsByPeriod.get(key).push(r);
  }

  let consolidatedTotalDue = 0;
  let totalPaidAll = 0;
  let consolidatedArrears = 0;

  for (const [, group] of reportsByPeriod) {
    // "Latest" = the report with the most recent datePaid in this period
    // group (its final state) -- matches consolidatePaymentReports() in
    // the frontend's pdfGenerator.ts exactly.
    const latestReport = [...group].sort(
      (a, b) => new Date(b.datePaid ?? 0) - new Date(a.datePaid ?? 0)
    )[0];
    consolidatedTotalDue += Number(latestReport.totalDue ?? 0);
    totalPaidAll += group.reduce((sum, r) => sum + Number(r.amountPaid ?? 0), 0);
    consolidatedArrears += Number(latestReport.arrears ?? 0);
  }

  // NOTE: invoices are NOT folded into this consolidation -- confirmed by
  // reading the actual frontend source, consolidatePaymentReports() only
  // ever looks at paymentReports. How invoice totals combine with this for
  // the Comprehensive Summary's "Rent" row is still being confirmed against
  // the frontend's overall-combination logic before finalizing this part.
  const rentTotals = {
    totalDue: consolidatedTotalDue,
    amountPaid: totalPaidAll,
    arrears: consolidatedArrears
  };

  // Bill totals -- mirrors consolidateBillInvoices() in the frontend
  // exactly: group by issueDate (year/month), take the LATEST invoice per
  // period for totalAmount/vatAmount/grandTotal/balance, but SUM units
  // and amountPaid across every invoice in that period.
  const billPeriodGroups = new Map();
  for (const b of billInvoices) {
    const key = b.issueDate
      ? new Date(b.issueDate).toLocaleDateString("en-US", { year: "numeric", month: "short" })
      : "unknown";
    if (!billPeriodGroups.has(key)) billPeriodGroups.set(key, []);
    billPeriodGroups.get(key).push(b);
  }

  let billGrandTotal = 0;
  let billTotalPaid = 0;
  let billTotalBalance = 0;

  for (const [, group] of billPeriodGroups) {
    const latestInvoice = [...group].sort(
      (a, b) => new Date(b.issueDate ?? 0) - new Date(a.issueDate ?? 0)
    )[0];
    billGrandTotal += Number(latestInvoice.grandTotal ?? 0);
    billTotalBalance += Number(latestInvoice.balance ?? 0);
    billTotalPaid += group.reduce((sum, inv) => sum + Number(inv.amountPaid ?? 0), 0);
  }

  const billTotals = {
    grandTotal: billGrandTotal,
    amountPaid: billTotalPaid,
    balance: billTotalBalance
  };

  const overall = {
    totalDue: rentTotals.totalDue + billTotals.grandTotal,
    amountPaid: rentTotals.amountPaid + billTotals.amountPaid,
    balance: rentTotals.arrears + billTotals.balance
  };

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
.section-label { font-size: 13px; font-weight: bold; color: #004f79; margin: 26px 0 10px 0; text-transform: uppercase; letter-spacing: 0.5px; }
.section-label.bills { color: #004f79; }
.tenant-box { background: #f4f6f8; border: 1px solid #e2e6ea; border-radius: 6px; padding: 18px 22px; margin-bottom: 10px; }
.tenant-grid { display: flex; justify-content: space-between; flex-wrap: wrap; }
.tenant-grid .col { width: 48%; }
.tenant-grid p { margin: 6px 0; font-size: 12.5px; }
.tenant-grid .label { display: inline-block; width: 105px; color: #555; font-weight: bold; }
table.history { width: 100%; border-collapse: collapse; margin-bottom: 14px; }
table.history th { padding: 7px 6px; font-size: 9px; text-align: left; color: #fff; }
table.history.rent th { background: #004f79; }
table.history.bills th { background: #004f79; }
table.history td { padding: 7px 6px; border-bottom: 1px solid #e5e8eb; font-size: 9px; vertical-align: middle; }
table.history tbody tr:nth-child(even) { background: #f9fafb; }
.currency-cell { display: flex; flex-direction: column; line-height: 1.2; }
.currency-label { font-size: 7px; font-weight: bold; color: #8a9aa5; letter-spacing: 0.5px; }
.currency-amount { font-size: 10px; font-weight: 600; color: #1a1a1a; }
.currency-amount.positive { color: #16a34a; }
.currency-amount.warning { color: #dc2626; }
.status-pill { display: inline-block; padding: 2px 7px; border-radius: 10px; color: #fff; font-weight: bold; font-size: 8px; }
.empty-note { font-size: 11px; color: #888; font-style: italic; margin-bottom: 14px; }
table.summary { width: 100%; border-collapse: collapse; margin-top: 8px; }
table.summary th { background: #1e293b; color: #fff; padding: 9px 12px; font-size: 10.5px; text-align: left; text-transform: uppercase; letter-spacing: 0.5px; }
table.summary td { padding: 10px 12px; border-bottom: 1px solid #e5e8eb; font-size: 12px; }
table.summary tr.overall td { font-weight: bold; background: #f4f6f8; }
table.summary tbody tr:nth-child(odd) { background: #fafbfc; }
</style>
</head>
<body>
<img src="${letterheadBase64}" class="letterhead">
<div class="title-block">
  <h1>COMPREHENSIVE PAYMENT REPORT</h1>
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
      <p><span class="label">KRA PIN:</span> ${tenant.KRAPin ?? "-"}</p>
      <p><span class="label">Monthly Rent:</span> Ksh ${amountOnly(tenant.rent)}</p>
    </div>
  </div>
</div>

<div class="section-label">Rent Payment History</div>
${rentRows.length === 0 ? '<div class="empty-note">No rent payment records on file.</div>' : `
<table class="history rent">
<thead>
<tr>
  <th>Period</th><th>Invoice #</th><th>Issue Date</th><th>Date Paid</th><th>Rent</th><th>Service Charge</th><th>VAT</th><th>Total Due</th><th>Amount Paid</th><th>Arrears</th><th>Status</th>
</tr>
</thead>
<tbody>
${rentRows.map(r => `
<tr>
  <td>${r.period}</td>
  <td>${r.invoiceNo}</td>
  <td>${shortDate(r.issueDate)}</td>
  <td>${shortDate(r.datePaid)}</td>
  <td>${currencyCell(r.rent)}</td>
  <td>${r.serviceCharge ? currencyCell(r.serviceCharge) : "-"}</td>
  <td>${r.vat ? currencyCell(r.vat) : "-"}</td>
  <td>${currencyCell(r.totalDue)}</td>
  <td>${currencyCell(r.amountPaid, "positive")}</td>
  <td>${currencyCell(r.arrears, r.arrears > 0 ? "warning" : "")}</td>
  <td><span class="status-pill" style="background:${statusColor(r.status)}">${r.status ?? "-"}</span></td>
</tr>`).join("")}
</tbody>
</table>`}

<div class="section-label bills">Bill Payment History</div>
${billInvoices.length === 0 ? '<div class="empty-note">No bill invoices on file.</div>' : `
<table class="history bills">
<thead>
<tr>
  <th>Type</th><th>Invoice #</th><th>Date</th><th>Units</th><th>Rate</th><th>Amount</th><th>VAT</th><th>Total</th><th>Paid</th><th>Balance</th><th>Status</th>
</tr>
</thead>
<tbody>
${billInvoices.map(b => `
<tr>
  <td>${b.billType === "WATER" ? "Water" : b.billType === "ELECTRICITY" ? "Electricity" : b.billType ?? "-"}</td>
  <td>${b.invoiceNumber ?? "-"}</td>
  <td>${shortDate(b.issueDate)}</td>
  <td>${Number(b.units ?? 0).toLocaleString()}</td>
  <td>${currencyCell(b.chargePerUnit)}</td>
  <td>${currencyCell(b.totalAmount)}</td>
  <td>${currencyCell(b.vatAmount)}</td>
  <td>${currencyCell(b.grandTotal)}</td>
  <td>${currencyCell(b.amountPaid, "positive")}</td>
  <td>${currencyCell(b.balance, b.balance > 0 ? "warning" : "")}</td>
  <td><span class="status-pill" style="background:${statusColor(b.status)}">${b.status ?? "-"}</span></td>
</tr>`).join("")}
</tbody>
</table>`}

<div class="section-label">Comprehensive Summary</div>
<table class="summary">
<thead><tr><th>Category</th><th>Total Due</th><th>Total Paid</th><th>Balance</th></tr></thead>
<tbody>
<tr><td>Rent</td><td>Ksh ${amountOnly(rentTotals.totalDue)}</td><td>Ksh ${amountOnly(rentTotals.amountPaid)}</td><td>Ksh ${amountOnly(rentTotals.arrears)}</td></tr>
<tr><td>Bills</td><td>Ksh ${amountOnly(billTotals.grandTotal)}</td><td>Ksh ${amountOnly(billTotals.amountPaid)}</td><td>Ksh ${amountOnly(billTotals.balance)}</td></tr>
<tr class="overall"><td>Overall</td><td>Ksh ${amountOnly(overall.totalDue)}</td><td>Ksh ${amountOnly(overall.amountPaid)}</td><td>Ksh ${amountOnly(overall.balance)}</td></tr>
</tbody>
</table>

</body>
</html>
`;
}

export function buildComprehensiveReportFooterTemplate() {
  return `
<div style="font-size:9px; color:#888; width:100%; text-align:center; padding:0 45px; font-family:Arial,Helvetica,sans-serif; border-top:1px solid #ccc; padding-top:6px;">
  Phone: 0110 060 088 &nbsp;|&nbsp; Email: info@interparkenterprises.co.ke<br>
  www.interparkenterprises.co.ke<br>
  &copy; ${new Date().getFullYear()} Interpark Enterprises Limited
  &nbsp;&nbsp;&middot;&nbsp;&nbsp; Page <span class="pageNumber"></span> of <span class="totalPages"></span>
</div>
`;
}