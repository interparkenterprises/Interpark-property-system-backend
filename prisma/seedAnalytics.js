import 'dotenv/config';
import prisma from '../src/lib/prisma.js';

const MANAGER_EMAIL = 'itsmetrokenaki@gmail.com';
const PROPERTY_PREFIX = 'Analytics Demo Property ';
const TENANT_PREFIX = 'Analytics Demo Tenant ';
const LANDLORD_PREFIX = 'Analytics Demo Landlord ';
const SEED_MARKER = '[ANALYTICS_DEMO_SEED_V1]';
const CONFIRMATION_VARIABLE = 'ANALYTICS_SEED_CONFIRM';
const EXPECTED_PROPERTIES = 25;
const EXPECTED_LANDLORDS = 8;

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
    throw new Error(`Refusing to seed a production-looking database target: ${target}`);
  }
  if (process.env[CONFIRMATION_VARIABLE] !== 'YES') {
    throw new Error(`Safety confirmation missing. Review database target ${target}, then set ${CONFIRMATION_VARIABLE}=YES.`);
  }
  console.log(`Database safety check passed for: ${target}`);
}

const pad = (value, size = 3) => String(value).padStart(size, '0');
const roundMoney = value => Math.round(value / 100) * 100;
const seededDate = (year, month, day, hour = 9) => new Date(Date.UTC(year, month, day, hour - 3));
const addMonths = (date, amount) => new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + amount, 1, 6));

const kenyaNames = [
  ['Wanjiku', 'Mwangi'], ['Brian', 'Otieno'], ['Faith', 'Njeri'], ['Kevin', 'Kiptoo'],
  ['Amina', 'Hassan'], ['Peter', 'Omondi'], ['Mercy', 'Wambui'], ['Daniel', 'Mutua'],
  ['Sharon', 'Chebet'], ['Joseph', 'Kamau'], ['Lilian', 'Achieng'], ['Samuel', 'Kariuki'],
  ['Zainab', 'Abdalla'], ['Dennis', 'Wafula'], ['Esther', 'Nyambura'], ['Victor', 'Ouma']
];

const locations = [
  ['Westlands', 'Nairobi'], ['Kilimani', 'Nairobi'], ['Kileleshwa', 'Nairobi'],
  ['Parklands', 'Nairobi'], ['South B', 'Nairobi'], ['Ruiru', 'Kiambu'],
  ['Syokimau', 'Machakos'], ['Nyali', 'Mombasa'], ['Milimani', 'Nakuru'],
  ['Kisumu Central', 'Kisumu'], ['Thika', 'Kiambu'], ['Kitengela', 'Kajiado']
];

const landlordData = Array.from({ length: EXPECTED_LANDLORDS }, (_, index) => ({
  name: `${LANDLORD_PREFIX}${pad(index + 1)}`,
  email: `analytics.demo.landlord.${pad(index + 1)}@example.test`,
  phone: `+2547${String(10000000 + index * 7919).slice(-8)}`,
  address: `P.O. Box ${1200 + index * 137}-${String(10000 + index * 111).slice(-5)}, Nairobi`,
  idNumber: `ADL${pad(index + 1, 6)}`,
  createdAt: addMonths(new Date(), -8 + index)
}));

const forms = ['APARTMENT', 'OFFICE', 'SHOP', 'MAISONETTE', 'WAREHOUSE'];
const usages = ['RESIDENTIAL', 'COMMERCIAL', 'MIXED_USE'];
const banks = [
  ['KCB Bank', 'Westlands', '01100'], ['Equity Bank', 'Kilimani', '68012'],
  ['Co-operative Bank', 'Upper Hill', '11035'], ['NCBA Bank', 'Westlands', '07000']
];

function propertyPlan(index, landlordId, managerId) {
  const [area, county] = locations[index % locations.length];
  const [bank, branch, branchCode] = banks[index % banks.length];
  const unitCount = index < 20 ? 15 : [5, 6, 7, 8, 10][index - 20];
  const performance = index < 8 ? 'strong' : index < 17 ? 'average' : 'weak';
  const occupancyTarget = performance === 'strong' ? 0.84 : performance === 'average' ? 0.78 : 0.71;
  return {
    index: index + 1,
    unitCount,
    occupiedCount: Math.round(unitCount * occupancyTarget),
    performance,
    data: {
      name: `${PROPERTY_PREFIX}${pad(index + 1)}`,
      address: `Plot ${20 + index * 7}, ${area}, ${county} County`,
      lrNumber: `LR/${county.toUpperCase().slice(0, 3)}/${20260 + index}`,
      landlordId,
      managerId,
      form: forms[index % forms.length],
      usage: usages[index % usages.length],
      commissionFee: [5, 6, 7.5, 8][index % 4],
      accountName: `Interpark Analytics Demo ${pad(index + 1)}`,
      accountNo: `01${pad(88000000 + index * 137, 9)}`,
      bank,
      branch,
      branchCode,
      createdAt: addMonths(new Date(), -10 + (index % 5))
    }
  };
}

function tenantPin(index) {
  const digits = String(700000000 + index * 7919).slice(-9);
  return `A${digits}${String.fromCharCode(65 + (index % 26))}`;
}

function invoiceOutcome(performance, hash, isCurrentMonth) {
  const roll = hash % 100;
  const thresholds = performance === 'strong' ? [73, 88, 94, 98]
    : performance === 'average' ? [55, 78, 88, 97]
      : [34, 59, 78, 97];
  if (roll < thresholds[0]) return 'PAID';
  if (roll < thresholds[1]) return 'PARTIAL';
  if (roll < thresholds[2]) return 'UNPAID';
  if (roll < thresholds[3]) return isCurrentMonth ? 'UNPAID' : 'OVERDUE';
  return 'CANCELLED';
}

async function seed() {
  assertSafeDatabase();

  const manager = await prisma.user.findUnique({ where: { email: MANAGER_EMAIL }, select: { id: true, email: true, role: true } });
  if (!manager) throw new Error(`Target manager ${MANAGER_EMAIL} does not exist.`);
  if (!['ADMIN', 'MANAGER'].includes(manager.role)) throw new Error(`Target user must be ADMIN or MANAGER; found ${manager.role}.`);

  const [existingProperties, existingLandlords] = await Promise.all([
    prisma.property.count({ where: { name: { startsWith: PROPERTY_PREFIX } } }),
    prisma.landlord.count({ where: { name: { startsWith: LANDLORD_PREFIX } } })
  ]);
  if (existingProperties === EXPECTED_PROPERTIES && existingLandlords === EXPECTED_LANDLORDS) {
    console.log('Analytics demo seed is already present; no changes made.');
    return;
  }
  if (existingProperties > 0 || existingLandlords > 0) {
    throw new Error('A partial analytics demo seed exists. Run seed:analytics:cleanup before retrying.');
  }

  const firstMonth = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth() - 5, 1, 6));
  const summary = await prisma.$transaction(async tx => {
    await tx.landlord.createMany({ data: landlordData });
    const landlords = await tx.landlord.findMany({ where: { name: { startsWith: LANDLORD_PREFIX } }, orderBy: { name: 'asc' } });
    const plans = Array.from({ length: EXPECTED_PROPERTIES }, (_, index) => propertyPlan(index, landlords[index % landlords.length].id, manager.id));
    await tx.property.createMany({ data: plans.map(plan => plan.data) });
    const properties = await tx.property.findMany({ where: { name: { startsWith: PROPERTY_PREFIX }, managerId: manager.id }, orderBy: { name: 'asc' } });

    await tx.propertyAccess.createMany({ data: properties.map(property => ({
      userId: manager.id, propertyId: property.id, grantedBy: manager.id,
      isActive: true, canView: true, canEdit: true, canDelete: false, canExport: true,
      customPermissions: { VIEW_PAYMENT_REPORTS: true, VIEW_ARREARS: true, VIEW_UNITS: true, VIEW_TENANTS: true }
    })) });

    const units = [];
    const providers = [];
    for (const [propertyIndex, property] of properties.entries()) {
      const plan = plans[propertyIndex];
      const baseRent = 18000 + (propertyIndex % 7) * 6500 + (plan.performance === 'strong' ? 8000 : 0);
      for (let unitIndex = 0; unitIndex < plan.unitCount; unitIndex += 1) {
        const commercial = property.usage !== 'RESIDENTIAL' && unitIndex % 4 === 0;
        units.push({
          propertyId: property.id,
          bedrooms: commercial ? null : 1 + ((unitIndex + propertyIndex) % 4),
          bathrooms: commercial ? 1 : 1 + ((unitIndex + 1) % 2),
          sizeSqFt: commercial ? 650 + unitIndex * 75 : 450 + ((unitIndex + propertyIndex) % 8) * 110,
          type: commercial ? 'Retail/Office Suite' : 'Residential Apartment',
          status: unitIndex < plan.occupiedCount ? 'OCCUPIED' : 'VACANT',
          rentType: 'MONTHLY',
          rentAmount: roundMoney(baseRent + unitIndex * 850),
          floor: `Floor ${Math.floor(unitIndex / 4) + 1}`,
          unitNo: `AD-${pad(propertyIndex + 1)}-${pad(unitIndex + 1, 2)}`,
          unitType: commercial ? 'COMMERCIAL' : 'RESIDENTIAL',
          usage: commercial ? 'Commercial' : 'Residential'
        });
      }
      const providerCount = 1 + (propertyIndex % 3);
      const providerTypes = ['Cleaning & Waste Management', 'Security Services', 'Plumbing & Electrical'];
      for (let providerIndex = 0; providerIndex < providerCount; providerIndex += 1) {
        providers.push({
          propertyId: property.id,
          name: `Analytics Demo Provider ${pad(propertyIndex + 1)}-${providerIndex + 1} ${providerTypes[providerIndex]}`,
          contact: `+2547${String(20000000 + propertyIndex * 997 + providerIndex * 71).slice(-8)}`,
          contractPeriod: '12 months',
          serviceContract: `${SEED_MARKER} ${providerTypes[providerIndex]}`,
          chargeAmount: 18000 + providerIndex * 12500 + plan.unitCount * 450,
          chargeFrequency: 'MONTHLY',
          createdAt: addMonths(new Date(), -7 + providerIndex)
        });
      }
    }
    await tx.unit.createMany({ data: units });
    await tx.serviceProvider.createMany({ data: providers });

    const occupiedUnits = await tx.unit.findMany({
      where: { property: { name: { startsWith: PROPERTY_PREFIX }, managerId: manager.id }, status: 'OCCUPIED' },
      include: { property: { select: { id: true, name: true } } },
      orderBy: [{ property: { name: 'asc' } }, { unitNo: 'asc' }]
    });
    const tenants = occupiedUnits.map((unit, index) => {
      const [firstName, surname] = kenyaNames[index % kenyaNames.length];
      const tenantNumber = index + 1;
      const rentStart = addMonths(firstMonth, -(index % 4));
      return {
        unitId: unit.id,
        leaseTerm: index % 5 === 0 ? '24 months' : '12 months',
        rent: unit.rentAmount,
        termStart: rentStart,
        rentStart,
        deposit: unit.rentAmount * (index % 6 === 0 ? 2 : 1),
        contact: `+2547${String(30000000 + tenantNumber * 3571).slice(-8)}`,
        fullName: `${TENANT_PREFIX}${pad(tenantNumber)} - ${firstName} ${surname}`,
        KRAPin: tenantPin(tenantNumber),
        POBox: `P.O. Box ${4000 + tenantNumber}-${String(10000 + tenantNumber * 13).slice(-5)}`,
        paymentPolicy: 'MONTHLY',
        escalationFrequency: 'ANNUALLY',
        escalationRate: [5, 7.5, 10][tenantNumber % 3],
        vatRate: unit.unitType === 'COMMERCIAL' ? 16 : 0,
        vatType: unit.unitType === 'COMMERCIAL' ? 'EXCLUSIVE' : 'NOT_APPLICABLE',
        withholdingTaxRate: unit.unitType === 'COMMERCIAL' ? 5 : 0,
        withholdingVatRate: unit.unitType === 'COMMERCIAL' ? 2 : 0,
        isWithholdingTaxExempt: unit.unitType !== 'COMMERCIAL',
        email: `analytics.demo.tenant.${pad(tenantNumber)}@example.test`,
        createdAt: rentStart
      };
    });
    await tx.tenant.createMany({ data: tenants });
    const createdTenants = await tx.tenant.findMany({
      where: { fullName: { startsWith: TENANT_PREFIX } },
      include: { unit: { include: { property: { select: { id: true, name: true } } } } },
      orderBy: { fullName: 'asc' }
    });

    const invoices = [];
    const payments = [];
    for (const [tenantIndex, tenant] of createdTenants.entries()) {
      const propertyIndex = Number(tenant.unit.property.name.slice(-3)) - 1;
      const performance = plans[propertyIndex].performance;
      for (let monthIndex = 0; monthIndex < 6; monthIndex += 1) {
        const month = addMonths(firstMonth, monthIndex);
        const year = month.getUTCFullYear();
        const monthNumber = month.getUTCMonth();
        const period = `${year}-${pad(monthNumber + 1, 2)}`;
        const issueDate = seededDate(year, monthNumber, 1, 9);
        const dueDate = seededDate(year, monthNumber, 5, 17);
        const status = invoiceOutcome(performance, tenantIndex * 31 + monthIndex * 17 + propertyIndex * 13, monthIndex === 5);
        const serviceCharge = roundMoney(tenant.rent * (tenant.unit.unitType === 'COMMERCIAL' ? 0.08 : 0.04));
        const vat = tenant.unit.unitType === 'COMMERCIAL' ? roundMoney((tenant.rent + serviceCharge) * 0.16) : 0;
        const totalDue = tenant.rent + serviceCharge + vat;
        const partialRatio = [0.35, 0.5, 0.65, 0.75][(tenantIndex + monthIndex) % 4];
        const amountPaid = status === 'PAID' ? totalDue : status === 'PARTIAL' ? roundMoney(totalDue * partialRatio) : 0;
        const balance = status === 'CANCELLED' ? 0 : Math.max(totalDue - amountPaid, 0);
        invoices.push({
          invoiceNumber: `ANDEMO-INV-${pad(tenantIndex + 1)}-${period}`,
          tenantId: tenant.id, issueDate, dueDate, paymentPeriod: period,
          rent: tenant.rent, serviceCharge, vat, totalDue, amountPaid, balance, status,
          notes: `${SEED_MARKER} ${performance} property`, createdAt: issueDate, paymentPolicy: 'MONTHLY'
        });
        if (status !== 'CANCELLED') {
          const paymentDay = 3 + ((tenantIndex + monthIndex * 3) % 18);
          const datePaid = seededDate(year, monthNumber, paymentDay, 10 + (tenantIndex % 6));
          payments.push({
            tenantId: tenant.id, datePaid, amountPaid, arrears: balance, paymentPeriod: month,
            rent: tenant.rent, serviceCharge, vat, status: status === 'OVERDUE' ? 'UNPAID' : status,
            totalDue, notes: `${SEED_MARKER} Matched to ANDEMO-INV-${pad(tenantIndex + 1)}-${period}`,
            createdAt: datePaid
          });
        }
      }
    }

    const extraCount = Math.min(12, createdTenants.length);
    for (let index = 0; index < extraCount; index += 1) {
      const tenant = createdTenants[index];
      const month = addMonths(firstMonth, 4 + (index % 2));
      const credit = index % 2 === 0;
      payments.push({
        tenantId: tenant.id,
        datePaid: seededDate(month.getUTCFullYear(), month.getUTCMonth(), 22 + (index % 5), 14),
        amountPaid: roundMoney(tenant.rent * (credit ? 0.25 : 1)),
        arrears: credit ? -roundMoney(tenant.rent * 0.25) : 0,
        paymentPeriod: month, rent: tenant.rent, serviceCharge: 0, vat: 0,
        status: credit ? 'CREDIT' : 'PREPAID', totalDue: 0,
        notes: `${SEED_MARKER} Deliberate ${credit ? 'credit' : 'prepayment'} analytics exclusion`
      });
    }

    for (let offset = 0; offset < invoices.length; offset += 500) await tx.invoice.createMany({ data: invoices.slice(offset, offset + 500) });
    for (let offset = 0; offset < payments.length; offset += 500) await tx.paymentReport.createMany({ data: payments.slice(offset, offset + 500) });

    return {
      landlords: landlords.length, properties: properties.length, units: units.length,
      occupiedUnits: occupiedUnits.length, vacantUnits: units.length - occupiedUnits.length,
      tenants: createdTenants.length, invoices: invoices.length, paymentReports: payments.length,
      serviceProviders: providers.length
    };
  }, { maxWait: 20000, timeout: 180000 });

  console.log('Analytics demo seed completed:', summary);
  console.log(`All properties are managed by ${manager.email}.`);
}

seed().catch(error => { console.error(`Analytics seed failed: ${error.message}`); process.exitCode = 1; }).finally(async () => prisma.$disconnect());
