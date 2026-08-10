import 'dotenv/config';
import prisma from '../src/lib/prisma.js';

const MANAGER_EMAIL = 'itsmetrokenaki@gmail.com';
const MARKER = '[ANALYTICS_DEMO_SEED_V2]';
const PREFIX = 'Analytics Demo ';
const CONFIRMATION_VARIABLE = 'ANALYTICS_SEED_CONFIRM';
const TARGETS = { landlords: 10, properties: 24, units: 360, tenants: 288, invoices: 3456, paymentReports: 3415, bills: 720, serviceProviders: 72, billInvoices: 720, commissions: 288, demandLetters: 180, otherIncome: 420, employees: 64, salaryPayments: 640 };
const pad = (value, size = 3) => String(value).padStart(size, '0');
const money = value => Math.round(value / 10) * 10;
const now = new Date();
const firstMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 11, 1, 6));
const monthAt = offset => new Date(Date.UTC(firstMonth.getUTCFullYear(), firstMonth.getUTCMonth() + offset, 1, 6));
const at = (month, day, hour = 9) => new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth(), day, hour - 3));
const batchCreate = async (model, rows, size = 500) => { for (let i = 0; i < rows.length; i += size) await model.createMany({ data: rows.slice(i, i + size) }); };

function assertSafeDatabase() {
  const value = process.env.DATABASE_URL;
  if (!value) throw new Error('DATABASE_URL is required.');
  let parsed;
  try { parsed = new URL(value); } catch { throw new Error('DATABASE_URL is not a valid URL.'); }
  const host = parsed.hostname.toLowerCase();
  const database = parsed.pathname.replace(/^\//, '').toLowerCase();
  const target = `${host}/${database || '(default database)'}`;
  const productionMarkers = ['prod', 'production', 'live', 'primary'];
  if (process.env.NODE_ENV === 'production' || productionMarkers.some(word => host.includes(word) || database.includes(word))) {
    throw new Error(`Refusing to seed a production-looking database target: ${target}`);
  }
  if (process.env[CONFIRMATION_VARIABLE] !== 'YES') throw new Error(`Review ${target}, then set ${CONFIRMATION_VARIABLE}=YES.`);
  console.log(`Database safety check passed for: ${target}`);
}

const names = ['Wanjiku Mwangi', 'Brian Otieno', 'Faith Njeri', 'Kevin Kiptoo', 'Amina Hassan', 'Peter Omondi', 'Mercy Wambui', 'Daniel Mutua', 'Sharon Chebet', 'Joseph Kamau', 'Lilian Achieng', 'Samuel Kariuki', 'Zainab Abdalla', 'Dennis Wafula', 'Esther Nyambura', 'Victor Ouma'];
const locations = [['Westlands', 'Nairobi'], ['Kilimani', 'Nairobi'], ['Kileleshwa', 'Nairobi'], ['Parklands', 'Nairobi'], ['South B', 'Nairobi'], ['Ruiru', 'Kiambu'], ['Syokimau', 'Machakos'], ['Nyali', 'Mombasa'], ['Milimani', 'Nakuru'], ['Kisumu Central', 'Kisumu'], ['Thika', 'Kiambu'], ['Kitengela', 'Kajiado']];
const categories = ['CONSULTANCY', 'PROPERTY_SALES', 'LEASING', 'PROJECT_MANAGEMENT', 'REFERRAL', 'DOCUMENTATION', 'INSPECTION', 'TRAINING', 'OTHER'];
const jobTitles = ['Property Officer', 'Accountant', 'Caretaker', 'Security Supervisor', 'Cleaner', 'Leasing Officer', 'Facilities Coordinator', 'Administrator'];
const performanceFor = index => index < 8 ? 'strong' : index < 16 ? 'average' : 'weak';
const rentOutcome = (performance, seed, current) => {
  const roll = seed % 100;
  const cuts = performance === 'strong' ? [82, 93, 97, 99] : performance === 'average' ? [62, 81, 91, 98] : [37, 60, 79, 97];
  if (roll < cuts[0]) return 'PAID'; if (roll < cuts[1]) return 'PARTIAL'; if (roll < cuts[2]) return 'UNPAID';
  if (roll < cuts[3]) return current ? 'UNPAID' : 'OVERDUE'; return 'CANCELLED';
};
const countOwned = async managerId => ({
  landlords: await prisma.landlord.count({ where: { name: { startsWith: `${PREFIX}Landlord ` } } }),
  properties: await prisma.property.count({ where: { managerId, name: { startsWith: `${PREFIX}Property ` } } }),
  units: await prisma.unit.count({ where: { property: { managerId, name: { startsWith: `${PREFIX}Property ` } }, unitNo: { startsWith: 'AD-' } } }),
  tenants: await prisma.tenant.count({ where: { fullName: { startsWith: `${PREFIX}Tenant ` }, unit: { property: { managerId, name: { startsWith: `${PREFIX}Property ` } } } } }),
  invoices: await prisma.invoice.count({ where: { invoiceNumber: { startsWith: 'ANDEMO-INV-' }, notes: { startsWith: MARKER } } }),
  paymentReports: await prisma.paymentReport.count({ where: { notes: { startsWith: MARKER }, tenant: { fullName: { startsWith: `${PREFIX}Tenant ` } } } }),
  bills: await prisma.bill.count({ where: { notes: { startsWith: MARKER }, tenant: { fullName: { startsWith: `${PREFIX}Tenant ` } } } }),
  serviceProviders: await prisma.serviceProvider.count({ where: { name: { startsWith: `${PREFIX}Provider ` }, property: { managerId, name: { startsWith: `${PREFIX}Property ` } } } }),
  billInvoices: await prisma.billInvoice.count({ where: { invoiceNumber: { startsWith: 'ANDEMO-BILLINV-' } } }),
  commissions: await prisma.managerCommission.count({ where: { managerId, notes: { startsWith: MARKER } } }),
  demandLetters: await prisma.demandLetter.count({ where: { letterNumber: { startsWith: 'ANDEMO-DL-' } } }),
  otherIncome: await prisma.otherIncome.count({ where: { managerId, invoiceNumber: { startsWith: 'ANDEMO-OTHER-' } } }),
  employees: await prisma.employee.count({ where: { createdById: managerId, email: { startsWith: 'analytics.demo.employee.' } } }),
  salaryPayments: await prisma.salaryPayment.count({ where: { notes: { startsWith: MARKER }, employee: { createdById: managerId, email: { startsWith: 'analytics.demo.employee.' } } } })
});

async function seed() {
  assertSafeDatabase();
  const manager = await prisma.user.findUnique({ where: { email: MANAGER_EMAIL }, select: { id: true, email: true, role: true } });
  if (!manager) throw new Error(`Target manager ${MANAGER_EMAIL} does not exist.`);
  if (!['ADMIN', 'MANAGER'].includes(manager.role)) throw new Error(`Target user must be ADMIN or MANAGER; found ${manager.role}.`);
  const existing = await countOwned(manager.id);
  if (Object.entries(TARGETS).every(([key, value]) => existing[key] === value)) { console.log('Complete analytics V2 seed already exists; no changes made.', existing); return; }
  if (Object.values(existing).some(Boolean)) throw new Error(`Partial analytics seed detected (${JSON.stringify(existing)}). Run seed:analytics:cleanup after reviewing the cleanup scope.`);

  const summary = await prisma.$transaction(async tx => {
    await tx.landlord.createMany({ data: Array.from({ length: TARGETS.landlords }, (_, i) => ({ name: `${PREFIX}Landlord ${pad(i + 1)}`, email: `analytics.demo.landlord.${pad(i + 1)}@example.test`, phone: `+2547${String(11000000 + i * 7919).slice(-8)}`, address: `P.O. Box ${1400 + i * 113}-${10000 + i * 101}, Kenya`, idNumber: `ADL${pad(i + 1, 7)}`, createdAt: monthAt(i % 12) })) });
    const landlords = await tx.landlord.findMany({ where: { name: { startsWith: `${PREFIX}Landlord ` } }, orderBy: { name: 'asc' } });
    await tx.property.createMany({ data: Array.from({ length: TARGETS.properties }, (_, i) => { const [area, county] = locations[i % locations.length]; return { name: `${PREFIX}Property ${pad(i + 1)}`, address: `Plot ${30 + i * 9}, ${area}, ${county} County`, lrNumber: `LR/ANDEMO/${202600 + i}`, landlordId: landlords[i % landlords.length].id, managerId: manager.id, form: ['APARTMENT', 'OFFICE', 'SHOP', 'MAISONETTE'][i % 4], usage: ['RESIDENTIAL', 'COMMERCIAL', 'MIXED_USE'][i % 3], commissionFee: [5, 6, 7.5, 8][i % 4], accountName: `${PREFIX}Property Account ${pad(i + 1)}`, accountNo: `0199${pad(70000 + i, 6)}`, bank: ['KCB Bank', 'Equity Bank', 'Co-operative Bank'][i % 3], branch: area, branchCode: pad(11000 + i, 5), createdAt: monthAt(i % 6) }; }) });
    const properties = await tx.property.findMany({ where: { managerId: manager.id, name: { startsWith: `${PREFIX}Property ` } }, orderBy: { name: 'asc' } });
    await tx.propertyAccess.createMany({ data: properties.map(property => ({ userId: manager.id, propertyId: property.id, grantedBy: manager.id, isActive: true, canView: true, canEdit: true, canDelete: false, canExport: true, customPermissions: { VIEW_PAYMENT_REPORTS: true, VIEW_ARREARS: true, VIEW_UNITS: true, VIEW_TENANTS: true, VIEW_BILL_INVOICES: true, VIEW_SERVICE_PROVIDERS: true, VIEW_COMMISSIONS: true, VIEW_DEMAND_LETTERS: true } })) });

    const units = [];
    for (let p = 0; p < properties.length; p += 1) {
      const occupancy = performanceFor(p) === 'strong' ? 14 : performanceFor(p) === 'average' ? 12 : 10;
      for (let u = 0; u < 15; u += 1) { const commercial = properties[p].usage !== 'RESIDENTIAL' && u % 4 === 0; units.push({ propertyId: properties[p].id, bedrooms: commercial ? null : 1 + ((p + u) % 4), bathrooms: 1 + (u % 2), sizeSqFt: 480 + ((p + u) % 10) * 95, type: commercial ? 'Retail/Office Suite' : 'Residential Apartment', status: u < occupancy ? 'OCCUPIED' : 'VACANT', rentType: 'MONTHLY', rentAmount: money(18000 + p * 1100 + u * 750 + (performanceFor(p) === 'strong' ? 7000 : 0)), floor: `Floor ${Math.floor(u / 4) + 1}`, unitNo: `AD-${pad(p + 1)}-${pad(u + 1, 2)}`, unitType: commercial ? 'COMMERCIAL' : 'RESIDENTIAL', usage: commercial ? 'Commercial' : 'Residential' }); }
    }
    await batchCreate(tx.unit, units);
    const occupied = await tx.unit.findMany({ where: { property: { managerId: manager.id, name: { startsWith: `${PREFIX}Property ` } }, status: 'OCCUPIED' }, include: { property: true }, orderBy: [{ property: { name: 'asc' } }, { unitNo: 'asc' }] });
    await batchCreate(tx.tenant, occupied.map((unit, i) => ({ unitId: unit.id, leaseTerm: i % 4 === 0 ? '24 months' : '12 months', rent: unit.rentAmount, termStart: monthAt(i % 6), rentStart: monthAt(i % 6), deposit: unit.rentAmount * (i % 7 === 0 ? 2 : 1), contact: `+2547${String(22000000 + i * 3571).slice(-8)}`, fullName: `${PREFIX}Tenant ${pad(i + 1)} - ${names[i % names.length]}`, KRAPin: `A${String(710000000 + i * 7919).slice(-9)}${String.fromCharCode(65 + (i % 26))}`, POBox: `P.O. Box ${5000 + i}-${10100 + (i % 800)}`, paymentPolicy: 'MONTHLY', escalationFrequency: 'ANNUALLY', escalationRate: [5, 7.5, 10][i % 3], vatRate: unit.unitType === 'COMMERCIAL' ? 16 : 0, vatType: unit.unitType === 'COMMERCIAL' ? 'EXCLUSIVE' : 'NOT_APPLICABLE', withholdingTaxRate: unit.unitType === 'COMMERCIAL' ? 5 : 0, withholdingVatRate: unit.unitType === 'COMMERCIAL' ? 2 : 0, isWithholdingTaxExempt: unit.unitType !== 'COMMERCIAL', email: `analytics.demo.tenant.${pad(i + 1)}@example.test`, createdAt: monthAt(i % 12) })));
    const tenants = await tx.tenant.findMany({ where: { fullName: { startsWith: `${PREFIX}Tenant ` } }, include: { unit: { include: { property: true } } }, orderBy: { fullName: 'asc' } });

    const invoices = [], payments = [];
    for (let t = 0; t < tenants.length; t += 1) for (let m = 0; m < 12; m += 1) {
      const tenant = tenants[t], month = monthAt(m), p = Number(tenant.unit.property.name.slice(-3)) - 1, performance = performanceFor(p), period = `${month.getUTCFullYear()}-${pad(month.getUTCMonth() + 1, 2)}`, status = rentOutcome(performance, t * 31 + m * 17 + p * 13, m === 11);
      const serviceCharge = money(tenant.rent * (tenant.unit.unitType === 'COMMERCIAL' ? .08 : .04)), vat = tenant.unit.unitType === 'COMMERCIAL' ? money((tenant.rent + serviceCharge) * .16) : 0, totalDue = tenant.rent + serviceCharge + vat, paid = status === 'PAID' ? totalDue : status === 'PARTIAL' ? money(totalDue * [.35, .5, .65, .75][(t + m) % 4]) : 0, balance = status === 'CANCELLED' ? 0 : totalDue - paid;
      invoices.push({ invoiceNumber: `ANDEMO-INV-${pad(t + 1)}-${period}`, tenantId: tenant.id, issueDate: at(month, 1), dueDate: at(month, 5, 17), paymentPeriod: period, rent: tenant.rent, serviceCharge, vat, totalDue, amountPaid: paid, balance, status, notes: `${MARKER} ${performance}`, createdAt: at(month, 1), paymentPolicy: 'MONTHLY' });
      if (status !== 'CANCELLED') payments.push({ tenantId: tenant.id, datePaid: at(month, 3 + ((t + m * 3) % 18), 10 + (t % 5)), amountPaid: paid, arrears: balance, paymentPeriod: month, rent: tenant.rent, serviceCharge, vat, status: status === 'OVERDUE' ? 'UNPAID' : status, totalDue, notes: `${MARKER} rent ${period}`, createdAt: at(month, 3 + ((t + m * 3) % 18)) });
    }
    for (let i = 0; i < 24; i += 1) { const tenant = tenants[i], month = monthAt(10 + i % 2), credit = i % 2 === 0; payments.push({ tenantId: tenant.id, datePaid: at(month, 23 + i % 4), amountPaid: money(tenant.rent * (credit ? .25 : 1)), arrears: credit ? -money(tenant.rent * .25) : 0, paymentPeriod: month, rent: tenant.rent, serviceCharge: 0, vat: 0, status: credit ? 'CREDIT' : 'PREPAID', totalDue: 0, notes: `${MARKER} deliberate ${credit ? 'credit' : 'prepayment'}` }); }
    await batchCreate(tx.invoice, invoices); await batchCreate(tx.paymentReport, payments);
    const createdInvoices = await tx.invoice.findMany({ where: { invoiceNumber: { startsWith: 'ANDEMO-INV-' } }, select: { id: true, tenantId: true, invoiceNumber: true, balance: true, dueDate: true, paymentPeriod: true }, orderBy: { invoiceNumber: 'asc' } });

    const bills = [];
    for (let i = 0; i < TARGETS.billInvoices; i += 1) { const tenant = tenants[(i * 7) % tenants.length], month = monthAt(i % 12), type = i % 3 === 0 ? 'ELECTRICITY' : 'WATER', unitsUsed = 8 + (i * 11) % 45, rate = type === 'WATER' ? 95 : 31; bills.push({ tenantId: tenant.id, type, description: `${MARKER} ${type} usage`, previousReading: 1000 + i * 3, currentReading: 1000 + i * 3 + unitsUsed, units: unitsUsed, chargePerUnit: rate, totalAmount: unitsUsed * rate, vatRate: 16, vatAmount: money(unitsUsed * rate * .16), grandTotal: money(unitsUsed * rate * 1.16), status: ['PAID', 'PAID', 'PARTIAL', 'UNPAID', 'OVERDUE', 'CANCELLED'][i % 6], issuedAt: at(month, 8 + i % 8), dueDate: at(month, 24), paidAt: i % 6 < 2 ? at(month, 18) : null, notes: `${MARKER} bill ${pad(i + 1, 4)}`, createdAt: at(month, 8 + i % 8), amountPaid: 0 }); }
    await batchCreate(tx.bill, bills);
    const createdBills = await tx.bill.findMany({ where: { notes: { startsWith: MARKER } }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
    const billInvoices = createdBills.map((bill, i) => { const status = bill.status, paid = status === 'PAID' ? bill.grandTotal : status === 'PARTIAL' ? money(bill.grandTotal * .55) : 0; return { invoiceNumber: `ANDEMO-BILLINV-${pad(i + 1, 4)}`, billId: bill.id, billReferenceNumber: `ANDEMO-BILL-${pad(i + 1, 4)}`, billReferenceDate: bill.issuedAt, tenantId: bill.tenantId, issueDate: bill.issuedAt, dueDate: bill.dueDate, billType: bill.type, previousReading: bill.previousReading, currentReading: bill.currentReading, units: bill.units, chargePerUnit: bill.chargePerUnit, totalAmount: bill.totalAmount, vatRate: bill.vatRate, vatAmount: bill.vatAmount, grandTotal: bill.grandTotal, amountPaid: paid, balance: status === 'CANCELLED' ? 0 : bill.grandTotal - paid, status, notes: `${MARKER} utility bill invoice`, createdAt: bill.createdAt }; });
    await batchCreate(tx.billInvoice, billInvoices);

    const providers = [];
    for (let p = 0; p < properties.length; p += 1) for (let s = 0; s < 3; s += 1) providers.push({ propertyId: properties[p].id, name: `${PREFIX}Provider ${pad(p + 1)}-${s + 1}`, contact: `+2547${String(33000000 + p * 997 + s * 71).slice(-8)}`, contractPeriod: s === 0 ? '12 months' : '24 months', serviceContract: `${MARKER} ${['Security', 'Cleaning and waste', 'Plumbing and electrical'][s]}`, chargeAmount: money(16000 + s * 13500 + p * 725), chargeFrequency: ['MONTHLY', 'QUARTERLY', 'ANNUAL'][s], createdAt: at(monthAt((p + s * 3) % 12), 10) });
    await tx.serviceProvider.createMany({ data: providers });

    const commissions = [];
    for (let p = 0; p < properties.length; p += 1) for (let m = 0; m < 12; m += 1) { const month = monthAt(m), income = money(260000 + p * 14500 + m * 4300), fee = properties[p].commissionFee || 5, status = ['PAID', 'PAID', 'PAID', 'PROCESSING', 'PENDING', 'CANCELLED'][(p + m) % 6]; commissions.push({ propertyId: properties[p].id, managerId: manager.id, commissionFee: fee, incomeAmount: income, originalIncomeAmount: income, commissionAmount: money(income * fee / 100), periodStart: at(month, 1), periodEnd: at(new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth() + 1, 0, 6)), 1), status, paidDate: status === 'PAID' ? at(month, 26) : null, notes: `${MARKER} ${performanceFor(p)} property`, createdAt: at(month, 26) }); }
    await batchCreate(tx.managerCommission, commissions);

    const tenantMap = new Map(tenants.map(row => [row.id, row]));
    const openByPerformance = { strong: [], average: [], weak: [] };
    for (const invoice of createdInvoices.filter(row => row.balance > 0)) {
      const tenant = tenantMap.get(invoice.tenantId);
      const propertyIndex = Number(tenant.unit.property.name.slice(-3)) - 1;
      openByPerformance[performanceFor(propertyIndex)].push(invoice);
    }
    const demandCandidates = [
      ...openByPerformance.strong.slice(0, 30),
      ...openByPerformance.average.slice(0, 60),
      ...openByPerformance.weak.slice(0, 90)
    ];
    if (demandCandidates.length !== TARGETS.demandLetters) throw new Error(`Could only prepare ${demandCandidates.length} demand letters.`);
    const demandLetters = demandCandidates.map((invoice, i) => { const tenant = tenantMap.get(invoice.tenantId), issue = new Date(invoice.dueDate.getTime() + (7 + i % 24) * 86400000), status = ['SENT', 'ACKNOWLEDGED', 'ESCALATED', 'SETTLED', 'GENERATED', 'DRAFT'][i % 6]; return { letterNumber: `ANDEMO-DL-${pad(i + 1, 4)}`, tenantId: tenant.id, propertyId: tenant.unit.propertyId, landlordId: tenant.unit.property.landlordId, unitId: tenant.unitId, invoiceId: invoice.id, generatedById: manager.id, issueDate: issue, outstandingAmount: invoice.balance, rentalPeriod: invoice.paymentPeriod, dueDate: invoice.dueDate, demandPeriod: `${7 + i % 24} days`, partialPayment: i % 4 === 0 ? money(invoice.balance * .2) : 0, partialPaymentDate: i % 4 === 0 ? issue : null, generatedAt: issue, paymentPolicy: 'MONTHLY', landlordContact: landlords.find(row => row.id === tenant.unit.property.landlordId)?.phone, tenantContact: tenant.contact, referenceNumber: `ANDEMO-REF-${pad(i + 1, 4)}`, status, notes: `${MARKER} document snapshot`, createdAt: issue }; });
    await batchCreate(tx.demandLetter, demandLetters);

    const otherIncome = Array.from({ length: TARGETS.otherIncome }, (_, i) => { const month = monthAt(i % 12), base = money(8500 + (i * 2371) % 180000), vat = i % 4 === 0 ? money(base * .16) : 0, status = ['PAID', 'PAID', 'PARTIAL', 'UNPAID', 'OVERDUE', 'CANCELLED'][i % 6]; return { invoiceNumber: `ANDEMO-OTHER-${pad(i + 1, 4)}`, title: `${PREFIX}${categories[i % categories.length].replaceAll('_', ' ')} ${pad(i + 1, 4)}`, description: `${MARKER} manager-scoped income; no property attribution`, amount: base, vatRate: vat ? 16 : 0, vatAmount: vat, vatType: vat ? 'EXCLUSIVE' : 'NOT_APPLICABLE', totalAmount: base + vat, category: categories[i % categories.length], subCategory: `Demo category ${i % 7 + 1}`, clientName: `${names[i % names.length]} Holdings`, clientEmail: `analytics.demo.client.${pad(i + 1, 4)}@example.test`, clientPhone: `+2547${String(44000000 + i * 3571).slice(-8)}`, clientAddress: `${locations[i % locations.length][0]}, Kenya`, clientCompany: `${names[i % names.length].split(' ')[1]} Ventures Ltd`, issueDate: at(month, 2 + i % 23), dueDate: at(month, 25), status, paidDate: status === 'PAID' ? at(month, 18 + i % 5) : null, paymentMethod: status === 'PAID' ? ['MPESA', 'BANK_TRANSFER'][i % 2] : null, transactionRef: status === 'PAID' ? `ANDEMO-OI-TXN-${pad(i + 1, 4)}` : null, currency: 'KES', managerId: manager.id, createdById: manager.id, createdAt: at(month, 2 + i % 23) }; });
    await batchCreate(tx.otherIncome, otherIncome);

    const employees = Array.from({ length: TARGETS.employees }, (_, i) => ({ name: `${PREFIX}Employee ${pad(i + 1)} - ${names[i % names.length]}`, phoneNumber: `+2547${String(55000000 + i * 1741).slice(-8)}`, email: `analytics.demo.employee.${pad(i + 1)}@example.test`, jobTitle: jobTitles[i % jobTitles.length], jobDescription: `${MARKER} organization-scoped employee; no property assignment`, salaryAmount: money(24000 + (i % 12) * 6500), paymentFrequency: ['MONTHLY', 'MONTHLY', 'MONTHLY', 'BI_WEEKLY'][i % 4], createdAt: monthAt(i % 12), createdById: manager.id, status: ['ACTIVE', 'ACTIVE', 'ACTIVE', 'ON_LEAVE', 'INACTIVE', 'TERMINATED'][i % 6] }));
    await tx.employee.createMany({ data: employees });
    const createdEmployees = await tx.employee.findMany({ where: { createdById: manager.id, email: { startsWith: 'analytics.demo.employee.' } }, orderBy: { email: 'asc' } });
    const salaryPayments = [];
    for (let e = 0; e < createdEmployees.length; e += 1) for (let m = 0; m < 10; m += 1) { const month = monthAt(m + 2), employee = createdEmployees[e], status = (e + m) % 11 === 0 ? 'UNPAID' : (e + m) % 7 === 0 ? 'PARTIAL' : 'PAID'; salaryPayments.push({ employeeId: employee.id, amount: status === 'PARTIAL' ? money(employee.salaryAmount * .6) : status === 'UNPAID' ? 0 : employee.salaryAmount, paymentDate: at(month, 25 + (e % 3)), paymentPeriod: `${month.getUTCFullYear()}-${pad(month.getUTCMonth() + 1, 2)}`, paymentMethod: ['BANK_TRANSFER', 'MPESA', 'CHEQUE', 'CASH'][e % 4], transactionRef: `ANDEMO-SAL-${pad(e + 1)}-${pad(m + 1, 2)}`, notes: `${MARKER} salary payment`, status, recordedById: manager.id, createdAt: at(month, 25 + (e % 3)) }); }
    await batchCreate(tx.salaryPayment, salaryPayments);

    return { landlords: landlords.length, properties: properties.length, units: units.length, occupiedUnits: occupied.length, vacantUnits: units.length - occupied.length, tenants: tenants.length, invoices: invoices.length, paymentReports: payments.length, bills: bills.length, billInvoices: billInvoices.length, serviceProviders: providers.length, commissions: commissions.length, demandLetters: demandLetters.length, otherIncome: otherIncome.length, employees: employees.length, salaryPayments: salaryPayments.length };
  }, { maxWait: 30000, timeout: 300000 });
  console.log('Analytics V2 seed completed:', summary);
  console.log(`All property-supported records belong to demo properties managed by ${manager.email}. Other Income and Employees remain manager scoped.`);
}

seed().catch(error => { console.error(`Analytics seed failed: ${error.message}`); process.exitCode = 1; }).finally(async () => prisma.$disconnect());
