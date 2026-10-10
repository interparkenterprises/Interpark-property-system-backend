import fs from "fs";
import path from "path";

const letterhead = fs.readFileSync(
  path.join(process.cwd(), "src/letterHeads/letterhead-02.jpg")
);

const letterheadBase64 = `data:image/jpeg;base64,${letterhead.toString("base64")}`;

const amountOnly = (value) =>
  Number(value ?? 0).toLocaleString("en-KE", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

const currencyCell = (value, options = {}) => {
  const { emphasis = "" } = options;
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

// How many months a policy spans
const policyMonthsFor = (policy) => {
  switch ((policy || "").toUpperCase()) {
    case "QUARTERLY":
      return 3;
    case "ANNUAL":
      return 12;
    case "MONTHLY":
    default:
      return 1;
  }
};

const MONTH_NAMES = [
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
];

/**
 * Parse a period string like "September 2026 - November 2026",
 * "May 2026", or an ISO date into a Date (start of that month).
 * Returns null if it can't be parsed.
 *
 * IMPORTANT: the explicit "Month YYYY" regex is tried FIRST because
 * `new Date("February 2027 - April 2027")` behaves differently across
 * JS engines / Node versions (valid Date on some, Invalid Date on
 * others). That engine divergence is what caused localhost and
 * production to disagree on grouping keys and row order.
 */
const parsePaymentPeriodToDate = (paymentPeriod) => {
  if (!paymentPeriod) return null;
  if (paymentPeriod instanceof Date) return paymentPeriod;

  // 1) Explicit "Month YYYY" / "Month YYYY - Month YYYY" form FIRST.
  const match = String(paymentPeriod).match(/^([A-Za-z]+)\s+(\d{4})/);
  if (match) {
    const mIdx = MONTH_NAMES.indexOf(match[1].toLowerCase());
    if (mIdx >= 0) {
      return new Date(parseInt(match[2], 10), mIdx, 1);
    }
  }

  // 2) Fall back to ISO date parsing.
  const iso = new Date(paymentPeriod);
  if (!isNaN(iso.getTime())) return iso;

  return null;
};

/**
 * Build a stable grouping key for a report. We group by the
 * normalized billing period (YYYY-MM) because:
 *   - Multiple partial reports can point at the same period.
 *   - An orphaned report may have NO linked invoice, while its
 *     sibling DOES — so grouping by invoice id splits them apart.
 *   - The tenant is already fixed (single-tenant PDF), so we don't
 *     need tenantId in the key here.
 */
const reportGroupKey = (report) => {
  const parsed = parsePaymentPeriodToDate(report.paymentPeriod);
  if (parsed && !isNaN(parsed.getTime())) {
    return `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(
      2,
      "0"
    )}`;
  }
  // Fallback: stringify whatever we have
  return `unknown:${String(report.paymentPeriod ?? "null")}`;
};

/**
 * Deterministically pick the "latest" report in a bucket.
 *
 * Sort by datePaid descending; if tied (very common when several
 * reports were generated on the same day, e.g. all four rows here
 * share datePaid = 29/09/2026), fall back to a stable tiebreak on
 * report id so localhost and production produce identical output.
 */
const pickLatest = (reports) => {
  if (!reports || reports.length === 0) return null;
  return [...reports].sort((a, b) => {
    const ta = new Date(a.datePaid ?? 0).getTime() || 0;
    const tb = new Date(b.datePaid ?? 0).getTime() || 0;
    if (tb !== ta) return tb - ta; // newest datePaid first
    // Stable tiebreak: newest report id first
    return String(b.id ?? "").localeCompare(String(a.id ?? ""));
  })[0];
};

// Format a period using the tenant's payment policy.
// Normalizes the start to the 1st of the month BEFORE doing arithmetic,
// so a start date like "28 Sept 2026" can't leak into December.
const formatPaymentPeriodLabel = (startDate, paymentPolicy) => {
  if (!startDate) return "-";
  let start = new Date(startDate);
  if (isNaN(start.getTime())) return "-";

  // Snap to 1st of the month
  start = new Date(start.getFullYear(), start.getMonth(), 1);

  const months = policyMonthsFor(paymentPolicy);

  if (months <= 1) {
    return start.toLocaleDateString("en-KE", {
      month: "short",
      year: "numeric",
    });
  }

  // Last covered month = start + months - 1
  const lastCoveredMonthStart = new Date(
    start.getFullYear(),
    start.getMonth() + months - 1,
    1
  );
  // End day = last day of last covered month
  const end = new Date(
    lastCoveredMonthStart.getFullYear(),
    lastCoveredMonthStart.getMonth() + 1,
    0
  );

  const startYear = start.getFullYear();
  const endYear = end.getFullYear();
  const startMonth = start.toLocaleDateString("en-KE", { month: "short" });
  const endMonth = end.toLocaleDateString("en-KE", { month: "short" });

  if (startYear === endYear) {
    return `${startMonth} - ${endMonth} ${startYear}`;
  }
  return `${startMonth} ${startYear} - ${endMonth} ${endYear}`;
};

export function buildAllPaymentReportsHtml(tenant, paymentReports) {
  if (!tenant) {
    throw new Error("Tenant not found");
  }
  if (!paymentReports || paymentReports.length === 0) {
    throw new Error("No payment reports available for this tenant");
  }

  const property = tenant.unit?.property || {};

  // ---------------------------------------------------------------
  // SORT — newest billing period first.
  // We must use parsePaymentPeriodToDate (regex-first) because
  // `new Date("February 2027 - April 2027")` yields NaN on some
  // Node versions, which silently disabled the original sort.
  // ---------------------------------------------------------------
  const sorted = [...paymentReports].sort((a, b) => {
    const da = parsePaymentPeriodToDate(a.paymentPeriod);
    const db = parsePaymentPeriodToDate(b.paymentPeriod);
    const ta = da && !isNaN(da.getTime()) ? da.getTime() : 0;
    const tb = db && !isNaN(db.getTime()) ? db.getTime() : 0;
    return tb - ta;
  });

  // =============================================
  // GROUPING — dedupe by NORMALIZED BILLING PERIOD.
  // ---------------------------------------------------------------
  // Multiple reports can point at the same billing period:
  //   - orphaned earlier partials (no linked invoice)
  //   - a final linked report
  //   - a split payment that spans multiple invoices
  // We group them into one billing-period bucket so summary totals
  // don't double-count the same cash.
  // =============================================
  const groups = new Map();
  for (const r of sorted) {
    const key = reportGroupKey(r);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  }

  // =============================================
  // TOTALS — the invariant is:
  //     Total Paid = Total Billed − Total Arrears
  //
  // This is algebraically correct by definition (cash received =
  // amount billed − amount still outstanding), and it's resilient
  // to how any individual report stored `amountPaid`.
  //
  // It correctly handles:
  //   - split payments across multiple invoices
  //   - orphaned partial reports
  //   - overpayments that created PREPAID periods
  //   - multi-period settlements
  // =============================================
  let totalBilled = 0;
  let totalArrears = 0;
  let totalRent = 0;
  let totalServiceCharge = 0;
  let totalVat = 0;

  for (const [, groupReports] of groups) {
    const latest = pickLatest(groupReports);
    if (!latest) continue;

    // Billed = the constant amount due for this period
    const billedTotal = Number(latest.totalDue ?? 0);
    totalBilled += billedTotal;

    // Arrears = the live outstanding balance for this period.
    // PREPAID / CREDIT periods have no outstanding balance.
    if (latest.status === "PREPAID" || latest.status === "CREDIT") {
      totalArrears += 0;
    } else {
      totalArrears += Math.max(0, Number(latest.arrears ?? 0));
    }

    // Component totals come from the same "latest per group" report
    // so they always reconcile with the billed total.
    totalRent += Number(latest.rent ?? 0);
    totalServiceCharge += Number(latest.serviceCharge ?? 0);
    totalVat += Number(latest.vat ?? 0);
  }

  // Round to 2dp to avoid float drift
  totalBilled = parseFloat(totalBilled.toFixed(2));
  totalArrears = parseFloat(totalArrears.toFixed(2));
  totalRent = parseFloat(totalRent.toFixed(2));
  totalServiceCharge = parseFloat(totalServiceCharge.toFixed(2));
  totalVat = parseFloat(totalVat.toFixed(2));

  // Paid is DERIVED, never summed from report.amountPaid
  const totalPaid = parseFloat(
    Math.max(0, totalBilled - totalArrears).toFixed(2)
  );

  const totals = {
    rent: totalRent,
    serviceCharge: totalServiceCharge,
    vat: totalVat,
    totalDue: totalBilled,
    amountPaid: totalPaid,
    arrears: totalArrears,
  };

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
      <p><span class="label">Monthly Rent:</span> Ksh ${amountOnly(
        tenant.rent
      )}</p>
      <p><span class="label">KRA PIN:</span> ${tenant.KRAPin ?? "-"}</p>
    </div>
  </div>
</div>

<div class="section-label">Payment History (${sorted.length} report${
    sorted.length > 1 ? "s" : ""
  })</div>
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
    const invoice = (r.invoices && r.invoices[0]) || null;

    // Prefer the linked invoice's policy, then the tenant's, then MONTHLY
    const reportPolicy =
      (invoice && invoice.paymentPolicy) ||
      tenant.paymentPolicy ||
      "MONTHLY";

    // ---------------------------------------------------------------
    // Derive the period label from the GROUP KEY rather than from the
    // individual row's paymentPeriod string. Every row in the same
    // bucket then renders the same label, and that label matches the
    // sort key. Falls back to the invoice's own period string (if
    // present) for display fidelity.
    // ---------------------------------------------------------------
    const groupKey = reportGroupKey(r);
    let periodLabel;
    if (invoice && invoice.paymentPeriod) {
      periodLabel = invoice.paymentPeriod;
    } else if (/^\d{4}-\d{2}$/.test(groupKey)) {
      const [gy, gm] = groupKey.split("-").map(Number);
      periodLabel = formatPaymentPeriodLabel(
        new Date(gy, gm - 1, 1),
        reportPolicy
      );
    } else {
      periodLabel = formatPaymentPeriodLabel(r.paymentPeriod, reportPolicy);
    }

    // ---------------------------------------------------------------
    // Determine the Paid / Arrears for THIS row.
    //
    // Rule:
    //   - PREPAID reports are fully covered. Show totalDue as Paid,
    //     and 0 as Arrears (they don't owe anything for this period).
    //   - PAID reports with no siblings (single report for the period)
    //     are fully settled. Show totalDue as Paid, 0 Arrears.
    //   - PAID reports with siblings (multiple reports in the same
    //     period) show transactional amountPaid and their stored
    //     arrears snapshot, so the payment trail is visible.
    //   - PARTIAL / UNPAID reports show transactional amountPaid
    //     and the stored arrears / live balance.
    // ---------------------------------------------------------------
    const groupReports = groups.get(groupKey) || [r];
    const hasSiblings = groupReports.length > 1;

    let paidCellValue;
    let arrearsCellValue;

    if (r.status === "PREPAID" || r.status === "CREDIT") {
      // Fully covered period — no cash trail to display per row.
      paidCellValue = Number(r.totalDue ?? 0);
      arrearsCellValue = 0;
    } else if (r.status === "PAID" && !hasSiblings) {
      // Single report, fully settled.
      paidCellValue = Number(r.totalDue ?? 0);
      arrearsCellValue = 0;
    } else if (r.status === "PAID" && hasSiblings) {
      // Part of a split-payment trail — show transactional amount.
      paidCellValue = Number(r.amountPaid ?? 0);
      arrearsCellValue = Number(r.arrears ?? 0);
    } else {
      // PARTIAL / UNPAID — show transactional amount and arrears.
      paidCellValue = Number(r.amountPaid ?? 0);
      arrearsCellValue = Number(r.arrears ?? 0);
    }

    return `
<tr>
  <td>${periodLabel}</td>
  <td>${
    r.datePaid ? new Date(r.datePaid).toLocaleDateString("en-KE") : "-"
  }</td>
  <td>${invoice?.invoiceNumber ?? "-"}</td>
  <td>${
    invoice?.issueDate
      ? new Date(invoice.issueDate).toLocaleDateString("en-KE")
      : "-"
  }</td>
  <td>${currencyCell(r.rent)}</td>
  <td>${r.serviceCharge ? currencyCell(r.serviceCharge) : "-"}</td>
  <td>${r.vat ? currencyCell(r.vat) : "-"}</td>
  <td>${currencyCell(r.totalDue)}</td>
  <td>${currencyCell(paidCellValue, { emphasis: "positive" })}</td>
  <td>${currencyCell(arrearsCellValue, {
    emphasis: arrearsCellValue > 0 ? "warning" : "",
  })}</td>
  <td><span class="status-pill" style="background:${statusColor(
    r.status
  )}">${r.status ?? "-"}</span></td>
</tr>`;
  })
  .join("")}
</tbody>
</table>

<div class="section-label">Summary</div>
<div class="summary-grid">
  <div class="summary-card">
    <div class="row"><span class="row-label">Total Rent</span>${currencyCell(
      totals.rent
    )}</div>
    <div class="row"><span class="row-label">Total Service Charge</span>${currencyCell(
      totals.serviceCharge
    )}</div>
    <div class="row"><span class="row-label">Total VAT</span>${currencyCell(
      totals.vat
    )}</div>
  </div>
  <div class="summary-card">
    <div class="row"><span class="row-label">Total Due</span>${currencyCell(
      totals.totalDue
    )}</div>
    <div class="row"><span class="row-label">Total Paid</span>${currencyCell(
      totals.amountPaid,
      { emphasis: "positive" }
    )}</div>
    <div class="row"><span class="row-label">Total Arrears</span>${currencyCell(
      totals.arrears,
      { emphasis: totals.arrears > 0 ? "warning" : "positive" }
    )}</div>
  </div>
</div>

</body>
</html>
`;
}

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