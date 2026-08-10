import 'dotenv/config';
import prisma from '../src/lib/prisma.js';

const MANAGER_EMAIL = 'itsmetrokenaki@gmail.com';
const MARKER = '[ANALYTICS_DEMO_SEED_V2]';
const PROPERTY_PREFIX = 'Analytics Demo Property ';
const CONFIRMATION_VARIABLE = 'ANALYTICS_SEED_CONFIRM';

function assertSafeDatabase() {
  const value = process.env.DATABASE_URL;
  if (!value) throw new Error('DATABASE_URL is required.');
  let parsed;
  try { parsed = new URL(value); } catch { throw new Error('DATABASE_URL is not a valid URL.'); }
  const host = parsed.hostname.toLowerCase(), database = parsed.pathname.replace(/^\//, '').toLowerCase(), target = `${host}/${database || '(default database)'}`;
  if (process.env.NODE_ENV === 'production' || ['prod', 'production', 'live', 'primary'].some(word => host.includes(word) || database.includes(word))) throw new Error(`Refusing to clean a production-looking database target: ${target}`);
  if (process.env[CONFIRMATION_VARIABLE] !== 'YES') throw new Error(`Review ${target}, then set ${CONFIRMATION_VARIABLE}=YES.`);
  console.log(`Database safety check passed for: ${target}`);
}

async function cleanup() {
  assertSafeDatabase();
  const manager = await prisma.user.findUnique({ where: { email: MANAGER_EMAIL }, select: { id: true } });
  if (!manager) throw new Error(`Target manager ${MANAGER_EMAIL} does not exist; cleanup stopped.`);
  const properties = await prisma.property.findMany({ where: { managerId: manager.id, name: { startsWith: PROPERTY_PREFIX } }, select: { id: true } });
  const propertyIds = properties.map(row => row.id);
  const tenants = await prisma.tenant.findMany({ where: { fullName: { startsWith: 'Analytics Demo Tenant ' }, unit: { propertyId: { in: propertyIds } } }, select: { id: true } });
  const tenantIds = tenants.map(row => row.id);
  const employees = await prisma.employee.findMany({ where: { createdById: manager.id, email: { startsWith: 'analytics.demo.employee.' }, jobDescription: { startsWith: MARKER } }, select: { id: true } });
  const employeeIds = employees.map(row => row.id);

  const result = await prisma.$transaction(async tx => {
    const salaryPayments = await tx.salaryPayment.deleteMany({ where: { employeeId: { in: employeeIds }, notes: { startsWith: MARKER } } });
    const employeeRows = await tx.employee.deleteMany({ where: { id: { in: employeeIds }, createdById: manager.id, email: { startsWith: 'analytics.demo.employee.' } } });
    const otherIncome = await tx.otherIncome.deleteMany({ where: { managerId: manager.id, invoiceNumber: { startsWith: 'ANDEMO-OTHER-' }, description: { startsWith: MARKER } } });
    const demandLetters = await tx.demandLetter.deleteMany({ where: { letterNumber: { startsWith: 'ANDEMO-DL-' }, notes: { startsWith: MARKER }, propertyId: { in: propertyIds } } });
    const commissions = await tx.managerCommission.deleteMany({ where: { managerId: manager.id, propertyId: { in: propertyIds }, notes: { startsWith: MARKER } } });
    const billInvoices = await tx.billInvoice.deleteMany({ where: { invoiceNumber: { startsWith: 'ANDEMO-BILLINV-' }, notes: { startsWith: MARKER }, tenantId: { in: tenantIds } } });
    const bills = await tx.bill.deleteMany({ where: { tenantId: { in: tenantIds }, notes: { startsWith: MARKER } } });
    const paymentReports = await tx.paymentReport.deleteMany({ where: { tenantId: { in: tenantIds }, notes: { startsWith: MARKER } } });
    const invoices = await tx.invoice.deleteMany({ where: { tenantId: { in: tenantIds }, invoiceNumber: { startsWith: 'ANDEMO-INV-' }, notes: { startsWith: MARKER } } });
    const tenantRows = await tx.tenant.deleteMany({ where: { id: { in: tenantIds }, fullName: { startsWith: 'Analytics Demo Tenant ' } } });
    const providers = await tx.serviceProvider.deleteMany({ where: { propertyId: { in: propertyIds }, name: { startsWith: 'Analytics Demo Provider ' }, serviceContract: { startsWith: MARKER } } });
    const access = await tx.propertyAccess.deleteMany({ where: { userId: manager.id, propertyId: { in: propertyIds } } });
    const units = await tx.unit.deleteMany({ where: { propertyId: { in: propertyIds }, unitNo: { startsWith: 'AD-' } } });
    const propertyRows = await tx.property.deleteMany({ where: { id: { in: propertyIds }, managerId: manager.id, name: { startsWith: PROPERTY_PREFIX } } });
    const landlords = await tx.landlord.deleteMany({ where: { name: { startsWith: 'Analytics Demo Landlord ' }, properties: { none: {} } } });
    return { salaryPayments: salaryPayments.count, employees: employeeRows.count, otherIncome: otherIncome.count, demandLetters: demandLetters.count, commissions: commissions.count, billInvoices: billInvoices.count, bills: bills.count, paymentReports: paymentReports.count, invoices: invoices.count, tenants: tenantRows.count, serviceProviders: providers.count, propertyAccess: access.count, units: units.count, properties: propertyRows.count, landlords: landlords.count };
  }, { maxWait: 30000, timeout: 300000 });
  console.log('Analytics V2 cleanup completed:', result);
}

cleanup().catch(error => { console.error(`Analytics cleanup failed: ${error.message}`); process.exitCode = 1; }).finally(async () => prisma.$disconnect());
