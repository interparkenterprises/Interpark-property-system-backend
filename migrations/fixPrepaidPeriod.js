// scripts/fixPrepaidPeriods.js
// Load .env BEFORE Prisma initialises
import 'dotenv/config';

import prisma from '../src/lib/prisma.js';

// ─────────────────────────────────────────────
// CONFIG
// ─────────────────────────────────────────────

// Pass the tenant id as a CLI arg:
//   node scripts/fixPrepaidPeriods.js <tenantId> [--dry-run]
//
// Example:
//   node scripts/fixPrepaidPeriods.js clx123abc --dry-run
//   node scripts/fixPrepaidPeriods.js clx123abc
const [, , tenantIdArg, ...flags] = process.argv;
const dryRun = flags.includes('--dry-run');

if (!tenantIdArg) {
  console.error('Usage: node migrations/fixPrepaidPeriod.js <tenantId> [--dry-run]');
  process.exit(1);
}

const TENANT_ID = 'cc90a720-47bf-402e-9f2d-ee58faae0116';

// The specific PREPAID periods that need shifting forward by one month
// for THIS tenant. Each entry maps the (wrong) stored period to the
// (correct) period it should have been.
const targets = [
  { oldStart: '2026-10-01', newStart: '2026-11-01' },
  { oldStart: '2027-01-01', newStart: '2027-02-01' },
];

// ─────────────────────────────────────────────
// MAIN
// ─────────────────────────────────────────────

async function main() {
  // Sanity check: confirm the tenant exists so we fail loudly on typos.
  const tenant = await prisma.tenant.findUnique({
    where: { id: TENANT_ID },
    select: { id: true, fullName: true, paymentPolicy: true },
  });

  if (!tenant) {
    console.error(`Tenant not found: ${TENANT_ID}`);
    process.exit(1);
  }

  console.log('─────────────────────────────────────────────');
  console.log(`Tenant:  ${tenant.fullName} (${tenant.id})`);
  console.log(`Policy:  ${tenant.paymentPolicy}`);
  console.log(`Mode:    ${dryRun ? 'DRY RUN (no writes)' : 'LIVE (will write)'}`);
  console.log('─────────────────────────────────────────────\n');

  let totalAffected = 0;
  let totalUpdated = 0;

  for (const { oldStart, newStart } of targets) {
    const oldDate = new Date(oldStart);
    const newDate = new Date(newStart);

    const affected = await prisma.paymentReport.findMany({
      where: {
        tenantId: TENANT_ID,
        status: 'PREPAID',
        paymentPeriod: oldDate,
      },
      select: {
        id: true,
        tenantId: true,
        paymentPeriod: true,
        totalDue: true,
        amountPaid: true,
        datePaid: true,
        notes: true,
      },
    });

    console.log(
      `${oldStart} → ${newStart}: found ${affected.length} PREPAID report(s)`
    );

    for (const r of affected) {
      console.log(
        `  • ${r.id}  totalDue=${r.totalDue}  amountPaid=${r.amountPaid}  datePaid=${r.datePaid?.toISOString?.() ?? r.datePaid}`
      );
    }

    totalAffected += affected.length;

    if (!dryRun && affected.length > 0) {
      const result = await prisma.paymentReport.updateMany({
        where: {
          tenantId: TENANT_ID,
          id: { in: affected.map((r) => r.id) },
        },
        data: { paymentPeriod: newDate },
      });
      totalUpdated += result.count;
      console.log(`  → Updated ${result.count} row(s).`);
    }

    console.log('');
  }

  console.log('─────────────────────────────────────────────');
  console.log(`Total matched: ${totalAffected}`);
  if (dryRun) {
    console.log('Dry run complete — no changes written.');
  } else {
    console.log(`Total updated: ${totalUpdated}`);
  }
  console.log('─────────────────────────────────────────────');
}

main()
  .catch((err) => {
    console.error('Script failed:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });