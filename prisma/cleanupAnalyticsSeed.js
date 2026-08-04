import 'dotenv/config';
import prisma from '../src/lib/prisma.js';

const MANAGER_EMAIL = 'itsmetrokenaki@gmail.com';
const PROPERTY_PREFIX = 'Analytics Demo Property ';
const TENANT_PREFIX = 'Analytics Demo Tenant ';
const LANDLORD_PREFIX = 'Analytics Demo Landlord ';
const CONFIRMATION_VARIABLE = 'ANALYTICS_SEED_CONFIRM';

function assertSafeDatabase() {
  const value = process.env.DATABASE_URL;
  if (!value) throw new Error('DATABASE_URL is required.');
  let parsed;
  try { parsed = new URL(value); } catch { throw new Error('DATABASE_URL is not a valid URL.'); }
  const host = parsed.hostname.toLowerCase();
  const database = parsed.pathname.replace(/^\//, '').toLowerCase();
  const target = `${host}/${database || '(default database)'}`;
  const productionMarkers = ['prod', 'production', 'live', 'primary'];
  if (process.env.NODE_ENV === 'production' || productionMarkers.some(marker => host.includes(marker) || database.includes(marker))) {
    throw new Error(`Refusing to clean a production-looking database target: ${target}`);
  }
  if (process.env[CONFIRMATION_VARIABLE] !== 'YES') {
    throw new Error(`Safety confirmation missing. Review database target ${target}, then set ${CONFIRMATION_VARIABLE}=YES.`);
  }
  console.log(`Database safety check passed for: ${target}`);
}

async function cleanup() {
  assertSafeDatabase();
  const manager = await prisma.user.findUnique({ where: { email: MANAGER_EMAIL }, select: { id: true } });
  if (!manager) throw new Error(`Target manager ${MANAGER_EMAIL} does not exist; cleanup stopped.`);

  const properties = await prisma.property.findMany({
    where: { managerId: manager.id, name: { startsWith: PROPERTY_PREFIX } },
    select: { id: true }
  });
  const propertyIds = properties.map(property => property.id);
  if (!propertyIds.length) {
    console.log('No manager-owned analytics demo properties found; no changes made.');
    return;
  }

  const tenants = await prisma.tenant.findMany({
    where: { fullName: { startsWith: TENANT_PREFIX }, unit: { propertyId: { in: propertyIds } } },
    select: { id: true }
  });
  const tenantIds = tenants.map(tenant => tenant.id);

  const result = await prisma.$transaction(async tx => {
    const paymentReports = await tx.paymentReport.deleteMany({ where: { tenantId: { in: tenantIds } } });
    const invoices = await tx.invoice.deleteMany({ where: { tenantId: { in: tenantIds } } });
    const tenantRows = await tx.tenant.deleteMany({ where: { id: { in: tenantIds }, fullName: { startsWith: TENANT_PREFIX } } });
    const providers = await tx.serviceProvider.deleteMany({ where: { propertyId: { in: propertyIds }, name: { startsWith: 'Analytics Demo Provider ' } } });
    const access = await tx.propertyAccess.deleteMany({ where: { userId: manager.id, propertyId: { in: propertyIds } } });
    const units = await tx.unit.deleteMany({ where: { propertyId: { in: propertyIds }, unitNo: { startsWith: 'AD-' } } });
    const propertyRows = await tx.property.deleteMany({ where: { id: { in: propertyIds }, managerId: manager.id, name: { startsWith: PROPERTY_PREFIX } } });
    const landlords = await tx.landlord.deleteMany({ where: { name: { startsWith: LANDLORD_PREFIX }, properties: { none: {} } } });
    return {
      paymentReports: paymentReports.count, invoices: invoices.count, tenants: tenantRows.count,
      serviceProviders: providers.count, propertyAccess: access.count, units: units.count,
      properties: propertyRows.count, landlords: landlords.count
    };
  }, { maxWait: 20000, timeout: 120000 });

  console.log('Analytics demo cleanup completed:', result);
}

cleanup().catch(error => { console.error(`Analytics cleanup failed: ${error.message}`); process.exitCode = 1; }).finally(async () => prisma.$disconnect());
