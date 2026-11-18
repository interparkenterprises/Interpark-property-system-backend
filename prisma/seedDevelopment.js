import bcrypt from 'bcryptjs';

const PREFIX = 'DEV6M';
const SAFE_DATABASE = 'interpark_personnel_test';
const rawDatabaseUrl = process.env.DATABASE_URL;

if (!rawDatabaseUrl) {
  throw new Error('DATABASE_URL must be provided explicitly; the team .env is not used by this seed.');
}

const parsedDatabaseUrl = new URL(rawDatabaseUrl);
const databaseName = parsedDatabaseUrl.pathname.replace(/^\//, '');
const isLoopback = ['127.0.0.1', 'localhost', '::1'].includes(parsedDatabaseUrl.hostname);

if (!isLoopback || databaseName !== SAFE_DATABASE) {
  throw new Error(
    `Refusing to seed unsafe database host=${parsedDatabaseUrl.hostname} database=${databaseName}`
  );
}

const { default: prisma } = await import('../src/lib/prisma.js');

const date = (year, month, day, hour = 12) => new Date(Date.UTC(year, month - 1, day, hour));
const months = [
  { key: '2026-05', label: 'May 2026', month: 5 },
  { key: '2026-06', label: 'June 2026', month: 6 },
  { key: '2026-07', label: 'July 2026', month: 7 },
  { key: '2026-08', label: 'August 2026', month: 8 },
  { key: '2026-09', label: 'September 2026', month: 9 },
  { key: '2026-10', label: 'October 2026', month: 10 },
  { key: '2026-11', label: 'November 2026', month: 11 }
];

let randomState = 20261116;
const random = () => {
  randomState = (randomState * 1664525 + 1013904223) >>> 0;
  return randomState / 4294967296;
};
const vary = (base, spread = 0.08) => Math.round(base * (1 + (random() * 2 - 1) * spread));
const id = (...parts) => [PREFIX, ...parts].join('-');

const landlords = [
  ['Amina Wanjiku', 'amina.wanjiku@dev.interpark.test', '+254711100001', 'Kilimani, Nairobi'],
  ['David Kiprono', 'david.kiprono@dev.interpark.test', '+254711100002', 'Elgon View, Eldoret'],
  ['Grace Naliaka', 'grace.naliaka@dev.interpark.test', '+254711100003', 'Milimani, Kisumu'],
  ['Peter Mwangi', 'peter.mwangi@dev.interpark.test', '+254711100004', 'Nyali, Mombasa']
];

const properties = [
  ['Kilimani Heights', 'Argwings Kodhek Road, Kilimani, Nairobi', 'LR-DEV-001', 'APARTMENT', 'RESIDENTIAL'],
  ['Westlands Business Court', 'Muthangari Drive, Westlands, Nairobi', 'LR-DEV-002', 'OFFICE', 'COMMERCIAL'],
  ['Riverside Gardens', 'Riverside Drive, Nairobi', 'LR-DEV-003', 'APARTMENT', 'MIXED_USE'],
  ['Mombasa Road Warehouses', 'Mombasa Road, Nairobi', 'LR-DEV-004', 'WAREHOUSE', 'INDUSTRIAL'],
  ['Kisumu Lakeview Apartments', 'Oginga Odinga Road, Kisumu', 'LR-DEV-005', 'APARTMENT', 'RESIDENTIAL'],
  ['Nyali Retail Centre', 'Links Road, Nyali, Mombasa', 'LR-DEV-006', 'RETAIL_CENTER', 'COMMERCIAL']
];

const tenantNames = [
  'Brian Otieno', 'Faith Wambui', 'Kevin Mutiso', 'Mercy Chebet', 'Samuel Maina',
  'Linda Achieng', 'Dennis Kamau', 'Purity Njeri', 'Joseph Barasa', 'Esther Jepkoech',
  'Martin Ouma', 'Caroline Nyambura', 'Eric Kiplagat', 'Naomi Atieno', 'Victor Musyoka',
  'Irene Wairimu', 'George Wafula', 'Lucy Moraa', 'Allan Kiptoo', 'Sharon Muthoni',
  'Collins Odhiambo', 'Beatrice Wangari', 'Daniel Karanja', 'Rose Nanjala', 'James Mwangi',
  'Agnes Cherono', 'Patrick Muli', 'Diana Awino', 'Michael Njuguna', 'Susan Wekesa'
];

const employeeDefinitions = [
  ['Jane Muthoni', 'Property Operations Manager', 185000],
  ['John Kibet', 'Senior Caretaker', 68000],
  ['Alice Wanjiru', 'Maintenance Technician', 75000],
  ['Moses Ochieng', 'Plumber', 62000],
  ['Ruth Chepkemoi', 'Electrician', 65000],
  ['Peter Omondi', 'Landscaping Supervisor', 58000],
  ['Mary Njeri', 'Waste Management Coordinator', 52000],
  ['Ahmed Salim', 'Facilities Officer', 72000],
  ['Lydia Wambui', 'Accounts Assistant', 85000],
  ['George Mutua', 'Leasing Officer', 90000]
];

const providerDefinitions = [
  ['Secure Kenya Services', 'Security services', 145000],
  ['Safisha Professional Cleaners', 'Cleaning services', 88000],
  ['GreenScape Kenya', 'Landscaping services', 62000],
  ['MajiFlow Plumbing', 'Plumbing services', 54000],
  ['PowerPoint Electricals', 'Electrical services', 59000],
  ['EcoCollect Waste Services', 'Waste management', 48000],
  ['Watchtower Guards', 'Security services', 132000],
  ['Sparkle Facility Care', 'Cleaning services', 79000],
  ['Jenga Maintenance Works', 'Maintenance services', 96000],
  ['Coastline Security', 'Security services', 125000],
  ['Lake Basin Cleaners', 'Cleaning services', 72000],
  ['Urban Gardeners Kenya', 'Landscaping services', 57000]
];

const personnelCategories = [
  'CARETAKING', 'MAINTENANCE', 'PLUMBING', 'ELECTRICAL', 'LANDSCAPING', 'WASTE_MANAGEMENT'
];
const providerCategories = [
  'SECURITY', 'CLEANING', 'LANDSCAPING', 'PLUMBING', 'ELECTRICAL', 'WASTE_MANAGEMENT',
  'SECURITY', 'CLEANING', 'MAINTENANCE', 'SECURITY', 'CLEANING', 'LANDSCAPING'
];

async function seed() {
  console.log(`Seeding ${SAFE_DATABASE} on ${parsedDatabaseUrl.hostname} with fixed seed ${randomState}`);
  const password = await bcrypt.hash('InterparkDev2026!', 10);

  const users = [
    { id: id('USER', 'ADMIN'), name: 'Interpark Development Admin', email: 'admin.dev@interpark.test', role: 'ADMIN' },
    { id: id('USER', 'MANAGER'), name: 'Ken Development Manager', email: 'manager.dev@interpark.test', role: 'MANAGER' },
    { id: id('USER', 'STAFF'), name: 'Operations Development User', email: 'operations.dev@interpark.test', role: 'USER', isManagedUser: true, createdByManagerId: id('USER', 'MANAGER') }
  ];
  for (const user of users) {
    await prisma.user.upsert({
      where: { id: user.id },
      update: { name: user.name, email: user.email, password, role: user.role, isApproved: true, canManagerLogin: true, isManagedUser: user.isManagedUser || false, createdByManagerId: user.createdByManagerId || null },
      create: { ...user, password, isApproved: true, canManagerLogin: true }
    });
  }

  for (let index = 0; index < landlords.length; index += 1) {
    const [name, email, phone, address] = landlords[index];
    await prisma.landlord.upsert({
      where: { id: id('LANDLORD', index + 1) },
      update: { name, email, phone, address, idNumber: `DEV-KRA-L${String(index + 1).padStart(3, '0')}` },
      create: { id: id('LANDLORD', index + 1), name, email, phone, address, idNumber: `DEV-KRA-L${String(index + 1).padStart(3, '0')}` }
    });
  }

  for (let index = 0; index < properties.length; index += 1) {
    const [name, address, lrNumber, form, usage] = properties[index];
    await prisma.property.upsert({
      where: { id: id('PROPERTY', index + 1) },
      update: { name, address, lrNumber, form, usage, landlordId: id('LANDLORD', (index % landlords.length) + 1), managerId: id('USER', 'MANAGER'), commissionFee: 7.5 },
      create: {
        id: id('PROPERTY', index + 1), name, address, lrNumber, form, usage,
        landlordId: id('LANDLORD', (index % landlords.length) + 1),
        managerId: id('USER', 'MANAGER'), commissionFee: 7.5,
        accountName: `${name} Rent Collection`, accountNo: `01120${String(index + 1).padStart(4, '0')}`,
        bank: index % 2 ? 'KCB Bank Kenya' : 'Equity Bank Kenya', branch: 'Nairobi', branchCode: '001'
      }
    });
    if (index < 2) {
      await prisma.propertyAccess.upsert({
        where: { userId_propertyId: { userId: id('USER', 'STAFF'), propertyId: id('PROPERTY', index + 1) } },
        update: { isActive: true, canView: true, canEdit: true, canExport: true },
        create: {
          id: id('ACCESS', 'STAFF', index + 1), userId: id('USER', 'STAFF'),
          propertyId: id('PROPERTY', index + 1), grantedBy: id('USER', 'MANAGER'),
          isActive: true, canView: true, canEdit: true, canDelete: false, canExport: true,
          customPermissions: {
            VIEW_SERVICE_PROVIDERS: true,
            CREATE_SERVICE_PROVIDER: true,
            EDIT_SERVICE_PROVIDER: true,
            VIEW_PROPERTIES: true,
            EDIT_PROPERTY: true
          }
        }
      });
    }
  }

  const activeTenants = [];
  for (let propertyIndex = 0; propertyIndex < properties.length; propertyIndex += 1) {
    const occupiedCount = propertyIndex % 2 === 0 ? 5 : 4;
    for (let unitIndex = 0; unitIndex < 6; unitIndex += 1) {
      const unitId = id('UNIT', propertyIndex + 1, unitIndex + 1);
      const commercial = ['COMMERCIAL', 'INDUSTRIAL'].includes(properties[propertyIndex][4]);
      const rentAmount = commercial ? 85000 + unitIndex * 7500 : 38000 + propertyIndex * 2500 + unitIndex * 1800;
      await prisma.unit.upsert({
        where: { id: unitId },
        update: { status: unitIndex < occupiedCount ? 'OCCUPIED' : 'VACANT', rentAmount },
        create: {
          id: unitId, propertyId: id('PROPERTY', propertyIndex + 1), bedrooms: commercial ? null : 2,
          bathrooms: commercial ? null : 2, sizeSqFt: commercial ? 1200 + unitIndex * 150 : 850 + unitIndex * 50,
          type: commercial ? 'Commercial Suite' : 'Two Bedroom', status: unitIndex < occupiedCount ? 'OCCUPIED' : 'VACANT',
          rentType: 'MONTHLY', rentAmount, floor: String(Math.floor(unitIndex / 2) + 1),
          unitNo: `${propertyIndex + 1}${String(unitIndex + 1).padStart(2, '0')}`,
          unitType: commercial ? 'COMMERCIAL' : 'RESIDENTIAL', usage: properties[propertyIndex][4]
        }
      });

      if (unitIndex < occupiedCount) {
        const tenantIndex = activeTenants.length;
        const tenantId = id('TENANT', tenantIndex + 1);
        const fullName = tenantNames[tenantIndex];
        await prisma.tenant.upsert({
          where: { id: tenantId },
          update: { unitId, rent: rentAmount, status: 'ACTIVE', leftAt: null, leftReason: null },
          create: {
            id: tenantId, unitId, leaseTerm: '12 months', rent: rentAmount,
            termStart: date(2026, 1 + (tenantIndex % 4), 1), rentStart: date(2026, 1 + (tenantIndex % 4), 1),
            deposit: rentAmount * 2, contact: `+25472${String(1000000 + tenantIndex).slice(-7)}`,
            fullName, KRAPin: `P${String(260000000 + tenantIndex)}X`, POBox: `${1000 + tenantIndex}-00100 Nairobi`,
            paymentPolicy: 'MONTHLY', escalationFrequency: 'ANNUALLY', escalationRate: 5,
            vatType: commercial ? 'EXCLUSIVE' : 'NOT_APPLICABLE', vatRate: commercial ? 16 : 0,
            email: `tenant${tenantIndex + 1}@dev.interpark.test`, status: 'ACTIVE'
          }
        });
        await prisma.serviceCharge.upsert({
          where: { tenantId },
          update: { type: 'FIXED', fixedAmount: commercial ? 12000 : 4500, vatType: commercial ? 'EXCLUSIVE' : 'NOT_APPLICABLE', vatRate: commercial ? 16 : 0 },
          create: { tenantId, type: 'FIXED', fixedAmount: commercial ? 12000 : 4500, vatType: commercial ? 'EXCLUSIVE' : 'NOT_APPLICABLE', vatRate: commercial ? 16 : 0 }
        });
        activeTenants.push({ tenantId, unitId, propertyIndex, rentAmount, commercial });
      }
    }
  }

  for (let index = 0; index < 3; index += 1) {
    const source = activeTenants[index];
    await prisma.tenant.upsert({
      where: { id: id('TENANT', 'LEFT', index + 1) },
      update: { status: 'LEFT', leftAt: date(2026, 4 + index, 25), leftReason: index === 2 ? 'NON_PAYMENT' : 'LEASE_EXPIRED' },
      create: {
        id: id('TENANT', 'LEFT', index + 1), unitId: source.unitId, leaseTerm: '12 months', rent: source.rentAmount,
        termStart: date(2025, 4 + index, 1), rentStart: date(2025, 4 + index, 1), deposit: source.rentAmount * 2,
        contact: `+25473300000${index}`, fullName: tenantNames[27 + index], KRAPin: `P${270000000 + index}X`,
        paymentPolicy: 'MONTHLY', email: `lefttenant${index + 1}@dev.interpark.test`, status: 'LEFT',
        leftAt: date(2026, 4 + index, 25), leftReason: index === 2 ? 'NON_PAYMENT' : 'LEASE_EXPIRED'
      }
    });
  }

  for (let index = 0; index < employeeDefinitions.length; index += 1) {
    const [name, jobTitle, salaryAmount] = employeeDefinitions[index];
    const employeeId = id('EMPLOYEE', index + 1);
    await prisma.employee.upsert({
      where: { id: employeeId },
      update: { name, jobTitle, salaryAmount, status: index === 9 ? 'ON_LEAVE' : 'ACTIVE' },
      create: {
        id: employeeId, name, phoneNumber: `+25471020${String(index).padStart(4, '0')}`,
        email: `employee${index + 1}@dev.interpark.test`, jobTitle,
        jobDescription: `${jobTitle} supporting Interpark development properties`, salaryAmount,
        paymentFrequency: 'MONTHLY', createdById: id('USER', 'MANAGER'), status: index === 9 ? 'ON_LEAVE' : 'ACTIVE'
      }
    });
    for (const period of months) {
      const salaryStatus = period.month === 11 && index % 4 === 0 ? 'UNPAID' : 'PAID';
      await prisma.salaryPayment.upsert({
        where: { id: id('SALARY', index + 1, period.key) },
        update: { amount: salaryAmount, status: salaryStatus },
        create: {
          id: id('SALARY', index + 1, period.key), employeeId, amount: salaryAmount,
          paymentDate: date(2026, period.month, 28), paymentPeriod: period.label,
          paymentMethod: index % 3 === 0 ? 'MPESA' : 'BANK_TRANSFER',
          transactionRef: `${PREFIX}-SAL-${index + 1}-${period.key}`, status: salaryStatus,
          recordedById: id('USER', 'MANAGER')
        }
      });
    }
  }

  for (let index = 0; index < providerDefinitions.length; index += 1) {
    const [name, contract, chargeAmount] = providerDefinitions[index];
    await prisma.serviceProvider.upsert({
      where: { id: id('PROVIDER', index + 1) },
      update: { name, serviceContract: contract, chargeAmount },
      create: {
        id: id('PROVIDER', index + 1), propertyId: id('PROPERTY', (index % properties.length) + 1),
        name, contact: `+25470930${String(index).padStart(4, '0')}`, contractPeriod: '1 May 2026 - 30 April 2027',
        serviceContract: contract, chargeAmount, chargeFrequency: 'MONTHLY'
      }
    });
  }

  const assignmentIds = [];
  for (let index = 0; index < 6; index += 1) {
    const personnelId = id('PERSONNEL', 'INTERNAL', index + 1);
    const category = personnelCategories[index];
    await prisma.servicePersonnel.upsert({
      where: { id: personnelId },
      update: { status: 'ACTIVE', jobRole: employeeDefinitions[index + 1][1] },
      create: {
        id: personnelId, personnelType: 'INTERNAL', employeeId: id('EMPLOYEE', index + 2),
        name: employeeDefinitions[index + 1][0], phoneNumber: `+25471020${String(index + 1).padStart(4, '0')}`,
        email: `employee${index + 2}@dev.interpark.test`, jobRole: employeeDefinitions[index + 1][1],
        status: 'ACTIVE', createdById: id('USER', 'MANAGER')
      }
    });
    const assignmentId = id('ASSIGNMENT', 'INTERNAL', index + 1, 'CURRENT');
    await prisma.propertyServiceAssignment.upsert({
      where: { id: assignmentId },
      update: { status: 'ACTIVE', endDate: null, serviceCategory: category },
      create: {
        id: assignmentId, personnelId, propertyId: id('PROPERTY', (index % properties.length) + 1),
        serviceCategory: category, jobRole: employeeDefinitions[index + 1][1], startDate: date(2026, 7, 1),
        status: 'ACTIVE', notes: 'Current development assignment', createdById: id('USER', 'MANAGER')
      }
    });
    assignmentIds.push({ assignmentId, category, active: true });

    if (index < 2) {
      const historicalId = id('ASSIGNMENT', 'INTERNAL', index + 1, 'HISTORY');
      await prisma.propertyServiceAssignment.upsert({
        where: { id: historicalId },
        update: { status: 'INACTIVE', endDate: date(2026, 6, 30) },
        create: {
          id: historicalId, personnelId, propertyId: id('PROPERTY', ((index + 4) % properties.length) + 1),
          serviceCategory: category, jobRole: employeeDefinitions[index + 1][1], startDate: date(2026, 5, 1),
          endDate: date(2026, 6, 30), status: 'INACTIVE', notes: 'Historical transfer assignment',
          createdById: id('USER', 'MANAGER')
        }
      });
      assignmentIds.push({ assignmentId: historicalId, category, active: false });
    }
  }

  const sharedAssignmentId = id('ASSIGNMENT', 'INTERNAL', 1, 'SHARED');
  await prisma.propertyServiceAssignment.upsert({
    where: { id: sharedAssignmentId },
    update: { status: 'ACTIVE', endDate: null },
    create: {
      id: sharedAssignmentId, personnelId: id('PERSONNEL', 'INTERNAL', 1), propertyId: id('PROPERTY', 2),
      serviceCategory: 'CARETAKING', jobRole: 'Relief Caretaker', startDate: date(2026, 9, 1), status: 'ACTIVE',
      notes: 'Multi-property relief coverage', createdById: id('USER', 'MANAGER')
    }
  });
  assignmentIds.push({ assignmentId: sharedAssignmentId, category: 'CARETAKING', active: true });

  for (let index = 0; index < providerDefinitions.length; index += 1) {
    const personnelId = id('PERSONNEL', 'EXTERNAL', index + 1);
    const category = providerCategories[index];
    await prisma.servicePersonnel.upsert({
      where: { id: personnelId },
      update: { status: index === 11 ? 'INACTIVE' : 'ACTIVE' },
      create: {
        id: personnelId, personnelType: 'EXTERNAL', serviceProviderId: id('PROVIDER', index + 1),
        name: `${providerDefinitions[index][0]} Officer ${index + 1}`,
        phoneNumber: `+25470840${String(index).padStart(4, '0')}`,
        email: `provider.personnel${index + 1}@dev.interpark.test`,
        jobRole: `${category.replaceAll('_', ' ')} Officer`, status: index === 11 ? 'INACTIVE' : 'ACTIVE',
        createdById: id('USER', 'MANAGER')
      }
    });
    const assignmentId = id('ASSIGNMENT', 'EXTERNAL', index + 1);
    const active = index !== 11;
    await prisma.propertyServiceAssignment.upsert({
      where: { id: assignmentId },
      update: { status: active ? 'ACTIVE' : 'INACTIVE', endDate: active ? null : date(2026, 9, 30) },
      create: {
        id: assignmentId, personnelId, propertyId: id('PROPERTY', (index % properties.length) + 1),
        serviceCategory: category, jobRole: `${category.replaceAll('_', ' ')} Officer`, startDate: date(2026, 5, 1),
        endDate: active ? null : date(2026, 9, 30), status: active ? 'ACTIVE' : 'INACTIVE',
        notes: active ? 'Active contracted personnel' : 'Contract assignment completed',
        createdById: id('USER', 'MANAGER')
      }
    });
    assignmentIds.push({ assignmentId, category, active });
  }

  for (const assignment of assignmentIds) {
    const shifts = assignment.active
      ? assignment.category === 'SECURITY'
        ? [['MONDAY', 'DAY', '06:00', '18:00'], ['TUESDAY', 'NIGHT', '18:00', '06:00'], ['SATURDAY', 'CUSTOM', '08:00', '14:00']]
        : [['MONDAY', 'DAY', '06:00', '18:00'], ['WEDNESDAY', 'DAY', '06:00', '18:00'], ['FRIDAY', 'CUSTOM', '07:30', '16:30']]
      : [['MONDAY', 'DAY', '06:00', '18:00']];
    for (let shiftIndex = 0; shiftIndex < shifts.length; shiftIndex += 1) {
      const [dayOfWeek, shiftType, startTime, endTime] = shifts[shiftIndex];
      await prisma.personnelSchedule.upsert({
        where: { id: id('SCHEDULE', assignment.assignmentId, shiftIndex + 1) },
        update: { dayOfWeek, shiftType, startTime, endTime, isActive: assignment.active },
        create: {
          id: id('SCHEDULE', assignment.assignmentId, shiftIndex + 1), assignmentId: assignment.assignmentId,
          dayOfWeek, shiftType, startTime, endTime, effectiveFrom: date(2026, assignment.active ? 7 : 5, 1),
          effectiveTo: assignment.active ? null : date(2026, 6, 30), isActive: assignment.active,
          notes: assignment.active ? 'Current roster' : 'Historical roster', createdById: id('USER', 'MANAGER')
        }
      });
    }
  }

  const overdueInvoices = [];
  for (let tenantIndex = 0; tenantIndex < activeTenants.length; tenantIndex += 1) {
    const tenant = activeTenants[tenantIndex];
    const serviceCharge = tenant.commercial ? 12000 : 4500;
    for (let monthIndex = 0; monthIndex < months.length; monthIndex += 1) {
      const period = months[monthIndex];
      const totalDue = tenant.rentAmount + serviceCharge + (tenant.commercial ? Math.round((tenant.rentAmount + serviceCharge) * 0.16) : 0);
      const selector = (tenantIndex * 7 + monthIndex * 3) % 20;
      let status = selector < 12 ? 'PAID' : selector < 15 ? 'PARTIAL' : selector < 19 ? (period.month === 11 ? 'UNPAID' : 'OVERDUE') : 'CANCELLED';
      if (period.month === 11 && status === 'PAID' && tenantIndex % 5 === 0) status = 'PARTIAL';
      const amountPaid = status === 'PAID' ? totalDue : status === 'PARTIAL' ? Math.round(totalDue * (0.45 + random() * 0.35)) : 0;
      const balance = status === 'CANCELLED' ? 0 : totalDue - amountPaid;
      let paymentReportId = null;
      if (['PAID', 'PARTIAL'].includes(status)) {
        paymentReportId = id('PAYMENT', tenantIndex + 1, period.key);
        await prisma.paymentReport.upsert({
          where: { id: paymentReportId },
          update: { amountPaid, arrears: balance, status, totalDue },
          create: {
            id: paymentReportId, tenantId: tenant.tenantId, datePaid: date(2026, period.month, 3 + (tenantIndex % 10)),
            notes: `${PREFIX} deterministic rent collection`, amountPaid, arrears: balance,
            paymentPeriod: date(2026, period.month, 1), rent: tenant.rentAmount, serviceCharge,
            status, totalDue, vat: tenant.commercial ? Math.round((tenant.rentAmount + serviceCharge) * 0.16) : 0,
            receiptUrl: `/dev-receipts/${paymentReportId}.pdf`
          }
        });
      }
      const invoiceId = id('INVOICE', tenantIndex + 1, period.key);
      await prisma.invoice.upsert({
        where: { id: invoiceId },
        update: { totalDue, amountPaid, balance, status, paymentReportId },
        create: {
          id: invoiceId, invoiceNumber: `${PREFIX}-INV-${String(tenantIndex + 1).padStart(3, '0')}-${period.key}`,
          tenantId: tenant.tenantId, paymentReportId, issueDate: date(2026, period.month, 1),
          dueDate: date(2026, period.month, 5), paymentPeriod: period.label, rent: tenant.rentAmount,
          serviceCharge, vat: tenant.commercial ? Math.round((tenant.rentAmount + serviceCharge) * 0.16) : 0,
          totalDue, amountPaid, balance, status, paymentPolicy: 'MONTHLY',
          notes: `${PREFIX} six-month development invoice`
        }
      });
      if (status === 'OVERDUE') overdueInvoices.push({ invoiceId, tenant, totalDue, balance, period });
    }
  }

  for (let index = 0; index < overdueInvoices.length; index += 3) {
    const item = overdueInvoices[index];
    await prisma.demandLetter.upsert({
      where: { id: id('DEMAND', index + 1) },
      update: { outstandingAmount: item.balance, status: index % 2 === 0 ? 'SENT' : 'ACKNOWLEDGED' },
      create: {
        id: id('DEMAND', index + 1), letterNumber: `${PREFIX}-DL-${String(index + 1).padStart(4, '0')}`,
        tenantId: item.tenant.tenantId, propertyId: id('PROPERTY', item.tenant.propertyIndex + 1),
        landlordId: id('LANDLORD', (item.tenant.propertyIndex % landlords.length) + 1), unitId: item.tenant.unitId,
        invoiceId: item.invoiceId, generatedById: id('USER', 'MANAGER'), issueDate: date(2026, Math.min(item.period.month + 1, 11), 10),
        outstandingAmount: item.balance, rentalPeriod: item.period.label, dueDate: date(2026, item.period.month, 5),
        demandPeriod: '14 days', tenantContact: `Development tenant ${item.tenant.tenantId}`,
        status: index % 2 === 0 ? 'SENT' : 'ACKNOWLEDGED', notes: `${PREFIX} development demand letter`
      }
    });
  }

  for (let index = 0; index < 6; index += 1) {
    const tenant = activeTenants[index];
    for (const period of months) {
      const billType = (index + period.month) % 2 ? 'WATER' : 'ELECTRICITY';
      const previousReading = 1000 + index * 120 + period.month * 15;
      const units = 18 + ((index * 3 + period.month) % 25);
      const chargePerUnit = billType === 'WATER' ? 110 : 34;
      const totalAmount = units * chargePerUnit;
      const vatAmount = billType === 'ELECTRICITY' ? Math.round(totalAmount * 0.16) : 0;
      const grandTotal = totalAmount + vatAmount;
      const paid = (index + period.month) % 4 !== 0;
      const billId = id('BILL', index + 1, period.key);
      await prisma.bill.upsert({
        where: { id: billId },
        update: { totalAmount, grandTotal, amountPaid: paid ? grandTotal : 0, status: paid ? 'PAID' : period.month === 11 ? 'UNPAID' : 'OVERDUE' },
        create: {
          id: billId, tenantId: tenant.tenantId, type: billType, description: `${billType} usage for ${period.label}`,
          previousReading, currentReading: previousReading + units, units, chargePerUnit, totalAmount,
          vatRate: billType === 'ELECTRICITY' ? 16 : 0, vatAmount, grandTotal,
          status: paid ? 'PAID' : period.month === 11 ? 'UNPAID' : 'OVERDUE', issuedAt: date(2026, period.month, 2),
          dueDate: date(2026, period.month, 12), paidAt: paid ? date(2026, period.month, 8) : null,
          amountPaid: paid ? grandTotal : 0, notes: `${PREFIX} metered utility bill`
        }
      });
      await prisma.billInvoice.upsert({
        where: { id: id('BILLINVOICE', index + 1, period.key) },
        update: { amountPaid: paid ? grandTotal : 0, balance: paid ? 0 : grandTotal, status: paid ? 'PAID' : period.month === 11 ? 'UNPAID' : 'OVERDUE' },
        create: {
          id: id('BILLINVOICE', index + 1, period.key), invoiceNumber: `${PREFIX}-BILL-${index + 1}-${period.key}`,
          billId, billReferenceNumber: `${PREFIX}-METER-${index + 1}`, billReferenceDate: date(2026, period.month, 1),
          tenantId: tenant.tenantId, issueDate: date(2026, period.month, 2), dueDate: date(2026, period.month, 12),
          billType, previousReading, currentReading: previousReading + units, units, chargePerUnit,
          totalAmount, vatRate: billType === 'ELECTRICITY' ? 16 : 0, vatAmount, grandTotal,
          amountPaid: paid ? grandTotal : 0, balance: paid ? 0 : grandTotal,
          status: paid ? 'PAID' : period.month === 11 ? 'UNPAID' : 'OVERDUE', notes: `${PREFIX} utility invoice`
        }
      });
    }
  }

  for (let propertyIndex = 0; propertyIndex < properties.length; propertyIndex += 1) {
    for (const period of months) {
      const monthlyIncome = vary(240000 + propertyIndex * 65000 + period.month * 3000);
      await prisma.income.upsert({
        where: { id: id('INCOME', propertyIndex + 1, period.key) },
        update: { amount: monthlyIncome },
        create: { id: id('INCOME', propertyIndex + 1, period.key), propertyId: id('PROPERTY', propertyIndex + 1), amount: monthlyIncome, frequency: 'MONTHLY', createdAt: date(2026, period.month, 15) }
      });
      await prisma.managerCommission.upsert({
        where: { id: id('COMMISSION', propertyIndex + 1, period.key) },
        update: { incomeAmount: monthlyIncome, originalIncomeAmount: monthlyIncome, commissionAmount: Math.round(monthlyIncome * 0.075) },
        create: {
          id: id('COMMISSION', propertyIndex + 1, period.key), propertyId: id('PROPERTY', propertyIndex + 1),
          managerId: id('USER', 'MANAGER'), commissionFee: 7.5, incomeAmount: monthlyIncome,
          originalIncomeAmount: monthlyIncome, commissionAmount: Math.round(monthlyIncome * 0.075),
          periodStart: date(2026, period.month, 1), periodEnd: date(2026, period.month, 28),
          status: period.month < 11 ? 'PAID' : 'PENDING', paidDate: period.month < 11 ? date(2026, period.month, 28) : null,
          notes: `${PREFIX} development commission`
        }
      });
      await prisma.dailyReport.upsert({
        where: { id: id('REPORT', propertyIndex + 1, period.key) },
        update: { occupancyLevel: propertyIndex % 2 === 0 ? 83 : 67 },
        create: {
          id: id('REPORT', propertyIndex + 1, period.key), propertyId: id('PROPERTY', propertyIndex + 1),
          managerId: id('USER', 'MANAGER'), reportDate: date(2026, period.month, 20), day: 'Wednesday',
          timeSubmitted: date(2026, period.month, 20, 17), preparedBy: 'Ken Development Manager',
          securityProvider: providerDefinitions[propertyIndex * 2]?.[0] || providerDefinitions[0][0],
          shiftCoverage: 'Day and night shifts covered', securityIncidents: propertyIndex % 3 === 0 ? 'One access-control incident resolved' : 'No incidents',
          cleaningContractor: providerDefinitions[propertyIndex * 2 + 1]?.[0] || providerDefinitions[1][0],
          areasCleaned: ['Common areas', 'Parking', 'Washrooms'], cleanlinessStandard: 'Good',
          preventiveTasks: [{ task: 'Fire equipment inspection', status: 'completed' }],
          repairs: [{ task: propertyIndex % 2 ? 'Lighting repair' : 'Water pump service', status: period.month === 11 ? 'pending' : 'completed' }],
          tenantComplaints: propertyIndex % 2 ? [{ issue: 'Intermittent water pressure', status: 'resolved' }] : [],
          occupancyLevel: propertyIndex % 2 === 0 ? 83 : 67, waterStatus: 'NORMAL', electricityStatus: 'NORMAL',
          otherServicesStatus: 'NORMAL', status: period.month === 11 ? 'SUBMITTED' : 'REVIEWED'
        }
      });
    }
  }

  const otherIncomeCategories = ['CONSULTANCY', 'LEASING', 'INSPECTION', 'DOCUMENTATION', 'PROJECT_MANAGEMENT', 'REFERRAL', 'TRAINING'];
  for (let index = 0; index < 14; index += 1) {
    const period = months[index % months.length];
    const amount = 45000 + index * 6500;
    const taxable = index % 3 !== 0;
    const vatAmount = taxable ? Math.round(amount * 0.16) : 0;
    const paid = index % 4 !== 0;
    await prisma.otherIncome.upsert({
      where: { id: id('OTHERINCOME', index + 1) },
      update: { amount, vatAmount, totalAmount: amount + vatAmount, status: paid ? 'PAID' : 'UNPAID' },
      create: {
        id: id('OTHERINCOME', index + 1), invoiceNumber: `${PREFIX}-OI-${String(index + 1).padStart(4, '0')}`,
        title: `${otherIncomeCategories[index % otherIncomeCategories.length].replaceAll('_', ' ')} service`,
        description: `${PREFIX} organization-level development income`, amount, vatRate: taxable ? 16 : 0,
        vatAmount, vatType: taxable ? 'EXCLUSIVE' : 'NOT_APPLICABLE', totalAmount: amount + vatAmount,
        category: otherIncomeCategories[index % otherIncomeCategories.length], clientName: `Development Client ${index + 1}`,
        clientEmail: `client${index + 1}@dev.interpark.test`, issueDate: date(2026, period.month, 6),
        dueDate: date(2026, period.month, 20), status: paid ? 'PAID' : 'UNPAID',
        paidDate: paid ? date(2026, period.month, 15) : null, paymentMethod: paid ? 'BANK_TRANSFER' : null,
        transactionRef: paid ? `${PREFIX}-OI-REF-${index + 1}` : null, managerId: id('USER', 'MANAGER'),
        createdById: id('USER', 'MANAGER')
      }
    });
  }

  for (let index = 0; index < 18; index += 1) {
    const property = properties[index % properties.length][0];
    const status = index % 5 === 0 ? 'COMPLETED' : index % 4 === 0 ? 'IN_PROGRESS' : 'PENDING';
    await prisma.toDo.upsert({
      where: { id: id('TODO', index + 1) },
      update: { status },
      create: {
        id: id('TODO', index + 1), userId: id('USER', 'STAFF'),
        title: `${PREFIX}: ${index % 2 ? 'Inspect plumbing' : 'Complete preventive maintenance'} at ${property}`,
        description: 'Development operational task representing supported maintenance workflow', status,
        priority: index % 6 === 0 ? 'URGENT' : index % 3 === 0 ? 'HIGH' : 'MEDIUM',
        dueDate: date(2026, 11, 5 + (index % 20)), assignedById: id('USER', 'MANAGER'),
        requiresApproval: index % 3 === 0, completedAt: status === 'COMPLETED' ? date(2026, 11, 8 + (index % 10)) : null
      }
    });
  }

  await prisma.news.upsert({
    where: { id: id('NEWS', 1) },
    update: { title: 'Property Services Personnel development environment ready' },
    create: { id: id('NEWS', 1), title: 'Property Services Personnel development environment ready', content: 'Local deterministic development data is available for testing.' }
  });

  const counts = {
    users: await prisma.user.count({ where: { id: { startsWith: PREFIX } } }),
    landlords: await prisma.landlord.count({ where: { id: { startsWith: PREFIX } } }),
    properties: await prisma.property.count({ where: { id: { startsWith: PREFIX } } }),
    units: await prisma.unit.count({ where: { id: { startsWith: PREFIX } } }),
    tenants: await prisma.tenant.count({ where: { id: { startsWith: PREFIX } } }),
    invoices: await prisma.invoice.count({ where: { id: { startsWith: PREFIX } } }),
    paymentReports: await prisma.paymentReport.count({ where: { id: { startsWith: PREFIX } } }),
    bills: await prisma.bill.count({ where: { id: { startsWith: PREFIX } } }),
    billInvoices: await prisma.billInvoice.count({ where: { id: { startsWith: PREFIX } } }),
    employees: await prisma.employee.count({ where: { id: { startsWith: PREFIX } } }),
    salaryPayments: await prisma.salaryPayment.count({ where: { id: { startsWith: PREFIX } } }),
    providers: await prisma.serviceProvider.count({ where: { id: { startsWith: PREFIX } } }),
    personnel: await prisma.servicePersonnel.count({ where: { id: { startsWith: PREFIX } } }),
    assignments: await prisma.propertyServiceAssignment.count({ where: { id: { startsWith: PREFIX } } }),
    schedules: await prisma.personnelSchedule.count({ where: { id: { startsWith: PREFIX } } }),
    dailyReports: await prisma.dailyReport.count({ where: { id: { startsWith: PREFIX } } }),
    commissions: await prisma.managerCommission.count({ where: { id: { startsWith: PREFIX } } }),
    otherIncome: await prisma.otherIncome.count({ where: { id: { startsWith: PREFIX } } }),
    demandLetters: await prisma.demandLetter.count({ where: { id: { startsWith: PREFIX } } }),
    tasks: await prisma.toDo.count({ where: { id: { startsWith: PREFIX } } })
  };

  console.log(JSON.stringify({ fixedRandomSeed: 20261116, period: 'May-November 2026', counts }, null, 2));
}

try {
  await seed();
} finally {
  await prisma.$disconnect();
}
