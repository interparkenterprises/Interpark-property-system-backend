import fs from "fs";
import path from "path";

const letterhead = fs.readFileSync(
  path.join(process.cwd(), "src/letterHeads/letterhead.jpg")
);

const letterheadBase64 = `data:image/png;base64,${letterhead.toString("base64")}`;


export function buildPaymentReportHtml(paymentReport) {
  if (!paymentReport) {
    throw new Error("Payment Report not found");
  }

  const tenant = paymentReport.tenant;

  if (!tenant) {
    throw new Error("Tenant not found");
  }

  const property = tenant.unit?.property || {};

  const currency = value =>
    Number(value ?? 0).toLocaleString("en-KE", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });

  const statusColor =
    paymentReport.status === "PAID"
      ? "#22c55e"
      : paymentReport.status === "PARTIAL"
      ? "#f59e0b"
      : paymentReport.status === "CREDIT" || paymentReport.status === "PREPAID"
      ? "#0d6efd"
      : "#ef4444";

  const rent = Number(paymentReport.rent ?? 0);
  const serviceCharge = Number(paymentReport.serviceCharge ?? 0);
  const vat = Number(paymentReport.vat ?? 0);
  const subtotal = rent + serviceCharge;

  const items = [
    { description: "Rent", qty: 1, amount: rent },
    ...(serviceCharge > 0
      ? [{ description: "Service Charge", qty: 1, amount: serviceCharge }]
      : []),
  ];

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
margin:35px;
}

.header{
display:flex;
justify-content:space-between;
align-items:flex-start;
border-bottom:2px solid #004f79;
padding-bottom:15px;
margin-bottom:25px;
}

.logo{
height:75px;
}

.company{
text-align:right;
font-size:12px;
color:#555;
}

.title{
text-align:center;
font-size:28px;
font-weight:bold;
margin:25px 0;
color:#004f79;
letter-spacing:1px;
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

table{
width:100%;
border-collapse:collapse;
margin-top:20px;
}

th{
background:#004f79;
color:white;
padding:10px;
}

td{
padding:10px;
border:1px solid #ddd;
}

.footer{
margin-top:50px;
padding-top:15px;
border-top:1px solid #ccc;
font-size:11px;
text-align:center;
color:#777;
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

PAYMENT REPORT

</div>

<div class="details">

<div class="left">


<p><strong>Tenant</strong></p>

<p><strong>${tenant.fullName ?? "-"}</strong></p>

<p><strong>Premise</strong>: ${property.name ?? "-"}</p>

<p><strong>Unit</strong>: ${tenant.unit?.unitNo ?? "-"}</p>

</div>

<div class="right">

<p><strong>Payment Period:</strong> ${
  paymentReport.paymentPeriod
    ? new Date(paymentReport.paymentPeriod).toLocaleDateString('en-KE', { month: 'long', year: 'numeric' })
    : "-"
}</p>

<p><strong>Date Paid:</strong> ${
  paymentReport.datePaid
    ? new Date(paymentReport.datePaid).toLocaleDateString()
    : "-"
}</p>

<p><strong>Status:</strong>
<span class="status">${paymentReport.status ?? "-"}</span>
</p>

</div>

</div>

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
<td colspan="2" align="right"><strong>Total Due</strong></td>
<td style="text-align:right">${currency(paymentReport.totalDue)}</td>
</tr>

<tr>
<td colspan="2" align="right"><strong>Amount Paid</strong></td>
<td style="text-align:right">${currency(paymentReport.amountPaid)}</td>
</tr>

${paymentReport.arrears > 0 ? `
<tr>
<td colspan="2" align="right"><strong>Arrears</strong></td>
<td style="text-align:right">${currency(paymentReport.arrears)}</td>
</tr>
` : ""}

</tfoot>

</table>

${
paymentReport.notes
? `
<div style="margin-top:25px">

<strong>Notes</strong>

<p>${paymentReport.notes}</p>

</div>
`
: ""
}

<div class="footer">

Thank you for your payment.<br>

<strong>INTERPARK PROPERTY MANAGEMENT</strong><br>
Property Management Solutions

</div>

</body>

</html>

`;
}