import prisma from '../src/lib/prisma.js';
import { hashPassword } from '../src/utils/hashPassword.js';

// Extract all unique permission codes from the permissionService.js mapping
const getAllPermissionCodesFromService = () => {
  const mapping = {
    // Property permissions
    property: {
      view: 'VIEW_PROPERTIES',
      create: 'CREATE_PROPERTY',
      edit: 'EDIT_PROPERTY',
      delete: 'DELETE_PROPERTY',
      assignManager: 'ASSIGN_MANAGER_TO_PROPERTY'
    },
    // Unit permissions
    unit: {
      view: 'VIEW_UNITS',
      create: 'CREATE_UNIT',
      edit: 'EDIT_UNIT',
      delete: 'DELETE_UNIT',
      updateStatus: 'UPDATE_UNIT_STATUS'
    },
    // Tenant permissions
    tenant: {
      view: 'VIEW_TENANTS',
      create: 'CREATE_TENANT',
      edit: 'EDIT_TENANT',
      delete: 'DELETE_TENANT',
      viewFinancials: 'VIEW_TENANT_FINANCIALS'
    },
    // Invoice permissions
    invoice: {
      view: 'VIEW_INVOICES',
      create: 'CREATE_INVOICES',
      edit: 'EDIT_INVOICES',
      delete: 'DELETE_INVOICES',
      download: 'DOWNLOAD_INVOICES'
    },
    // Bill permissions (utility)
    bill: {
      view: 'VIEW_BILLS',
      create: 'CREATE_BILLS',
      edit: 'EDIT_BILLS',
      delete: 'DELETE_BILLS',
      pay: 'PAY_BILLS',
      recordMeterReading: 'RECORD_METER_READINGS'
    },
    // Bill Invoice permissions
    billInvoice: {
      view: 'VIEW_BILL_INVOICES',
      create: 'CREATE_BILL_INVOICE',
      edit: 'EDIT_BILL_INVOICE_PAYMENT',
      delete: 'DELETE_BILL_INVOICE',
      download: 'DOWNLOAD_BILL_INVOICE'
    },
    // Maintenance permissions
    maintenance: {
      view: 'VIEW_MAINTENANCE_REQUESTS',
      create: 'CREATE_MAINTENANCE_REQUESTS',
      edit: 'UPDATE_MAINTENANCE_REQUESTS',
      delete: 'DELETE_MAINTENANCE_REQUESTS',
      assign: 'ASSIGN_MAINTENANCE_TASKS'
    },
    // Report permissions
    report: {
      view: 'VIEW_DAILY_REPORTS',
      create: 'CREATE_DAILY_REPORTS',
      edit: 'EDIT_DAILY_REPORTS',
      delete: 'DELETE_DAILY_REPORTS',
      approve: 'APPROVE_DAILY_REPORTS',
      submit: 'SUBMIT_DAILY_REPORTS'
    },
    // Payment Report permissions
    paymentReport: {
      view: 'VIEW_PAYMENT_REPORTS',
      create: 'RECORD_PAYMENTS',
      edit: 'EDIT_PAYMENT_RECORDS',
      delete: 'DELETE_PAYMENT_RECORDS',
      download: 'DOWNLOAD_PAYMENT_RECEIPT',
      preview: 'PREVIEW_PAYMENTS',
      viewArrears: 'VIEW_ARREARS'
    },
    // Receipt permissions
    receipt: {
      view: 'VIEW_RECEIPTS',
      download: 'DOWNLOAD_RECEIPTS',
      generate: 'GENERATE_RECEIPTS'
    },
    // Document permissions
    offerLetter: {
      view: 'VIEW_OFFER_LETTERS',
      create: 'CREATE_OFFER_LETTERS',
      edit: 'EDIT_OFFER_LETTERS',
      delete: 'DELETE_OFFER_LETTERS'
    },
    demandLetter: {
      view: 'VIEW_DEMAND_LETTERS',
      create: 'CREATE_DEMAND_LETTER',
      autoGenerate: 'AUTO_GENERATE_DEMAND_LETTER',
      batchGenerate: 'BATCH_GENERATE_DEMAND_LETTERS',
      edit: 'EDIT_DEMAND_LETTER_STATUS',
      delete: 'DELETE_DEMAND_LETTER',
      download: 'DOWNLOAD_DEMAND_LETTER',
      send: 'SEND_DEMAND_LETTERS'
    },
    // Overdue invoice permissions
    overdueInvoice: {
      view: 'VIEW_OVERDUE_INVOICES'
    },
    // Lead permissions
    lead: {
      view: 'VIEW_LEADS',
      create: 'CREATE_LEAD',
      edit: 'EDIT_LEAD',
      delete: 'DELETE_LEAD'
    },
    // Landlord permissions
    landlord: {
      view: 'VIEW_LANDLORDS',
      create: 'CREATE_LANDLORD',
      edit: 'EDIT_LANDLORD',
      delete: 'DELETE_LANDLORD'
    },
    // Service provider permissions
    serviceProvider: {
      view: 'VIEW_SERVICE_PROVIDERS',
      create: 'CREATE_SERVICE_PROVIDER',
      edit: 'EDIT_SERVICE_PROVIDER',
      delete: 'DELETE_SERVICE_PROVIDER'
    },
    // Activation request permissions
    activationRequest: {
      view: 'VIEW_ACTIVATION_REQUESTS',
      create: 'CREATE_ACTIVATION_REQUEST',
      edit: 'EDIT_ACTIVATION_REQUEST',
      delete: 'DELETE_ACTIVATION_REQUEST',
      approve: 'APPROVE_ACTIVATION_REQUEST'
    },
    // Commission permissions
    commission: {
      view: 'VIEW_COMMISSIONS',
      generate: 'GENERATE_COMMISSION_INVOICES',
      process: 'PROCESS_COMMISSIONS',
      approve: 'APPROVE_COMMISSIONS'
    },
    // User management permissions
    user: {
      view: 'VIEW_ALL_USERS',
      create: 'CREATE_USER',
      delete: 'DELETE_USER',
      editRole: 'EDIT_USER_ROLE',
      viewAuditLogs: 'VIEW_AUDIT_LOGS',
      approveManager: 'APPROVE_MANAGER'
    },
    // Additional permissions for employee management
    employee: {
      view: 'VIEW_EMPLOYEES',
      create: 'CREATE_EMPLOYEE',
      edit: 'EDIT_EMPLOYEE',
      delete: 'DELETE_EMPLOYEE'
    }
  };

  const permissionCodes = new Set();
  
  // Extract all values from the mapping
  for (const resource in mapping) {
    for (const operation in mapping[resource]) {
      const code = mapping[resource][operation];
      if (code) {
        permissionCodes.add(code);
      }
    }
  }

  return Array.from(permissionCodes).sort();
};

// Define permission details with categories
const PERMISSIONS = [
  // Property permissions
  { code: 'VIEW_PROPERTIES', name: 'View Properties', category: 'PROPERTY', scope: 'PROPERTY' },
  { code: 'CREATE_PROPERTY', name: 'Create Property', category: 'PROPERTY', scope: 'PROPERTY' },
  { code: 'EDIT_PROPERTY', name: 'Edit Property', category: 'PROPERTY', scope: 'PROPERTY' },
  { code: 'DELETE_PROPERTY', name: 'Delete Property', category: 'PROPERTY', scope: 'PROPERTY' },
  { code: 'ASSIGN_MANAGER_TO_PROPERTY', name: 'Assign Manager to Property', category: 'PROPERTY', scope: 'PROPERTY' },
  
  // Unit permissions
  { code: 'VIEW_UNITS', name: 'View Units', category: 'UNIT', scope: 'PROPERTY' },
  { code: 'CREATE_UNIT', name: 'Create Unit', category: 'UNIT', scope: 'PROPERTY' },
  { code: 'EDIT_UNIT', name: 'Edit Unit', category: 'UNIT', scope: 'PROPERTY' },
  { code: 'DELETE_UNIT', name: 'Delete Unit', category: 'UNIT', scope: 'PROPERTY' },
  { code: 'UPDATE_UNIT_STATUS', name: 'Update Unit Status', category: 'UNIT', scope: 'PROPERTY' },
  
  // Tenant permissions
  { code: 'VIEW_TENANTS', name: 'View Tenants', category: 'TENANT', scope: 'PROPERTY' },
  { code: 'CREATE_TENANT', name: 'Create Tenant', category: 'TENANT', scope: 'PROPERTY' },
  { code: 'EDIT_TENANT', name: 'Edit Tenant', category: 'TENANT', scope: 'PROPERTY' },
  { code: 'DELETE_TENANT', name: 'Delete Tenant', category: 'TENANT', scope: 'PROPERTY' },
  { code: 'VIEW_TENANT_FINANCIALS', name: 'View Tenant Financials', category: 'TENANT', scope: 'PROPERTY' },
  
  // Invoice permissions
  { code: 'VIEW_INVOICES', name: 'View Invoices', category: 'INVOICE', scope: 'PROPERTY' },
  { code: 'CREATE_INVOICES', name: 'Create Invoices', category: 'INVOICE', scope: 'PROPERTY' },
  { code: 'EDIT_INVOICES', name: 'Edit Invoices', category: 'INVOICE', scope: 'PROPERTY' },
  { code: 'DELETE_INVOICES', name: 'Delete Invoices', category: 'INVOICE', scope: 'PROPERTY' },
  { code: 'DOWNLOAD_INVOICES', name: 'Download Invoices', category: 'INVOICE', scope: 'PROPERTY' },
  
  // Bill permissions
  { code: 'VIEW_BILLS', name: 'View Bills', category: 'BILL', scope: 'PROPERTY' },
  { code: 'CREATE_BILLS', name: 'Create Bills', category: 'BILL', scope: 'PROPERTY' },
  { code: 'EDIT_BILLS', name: 'Edit Bills', category: 'BILL', scope: 'PROPERTY' },
  { code: 'DELETE_BILLS', name: 'Delete Bills', category: 'BILL', scope: 'PROPERTY' },
  { code: 'RECORD_METER_READINGS', name: 'Record Meter Readings', category: 'BILL', scope: 'PROPERTY' },
  
  // Bill Invoice permissions
  { code: 'VIEW_BILL_INVOICES', name: 'View Bill Invoices', category: 'BILL_INVOICE', scope: 'PROPERTY' },
  { code: 'CREATE_BILL_INVOICE', name: 'Create Bill Invoice', category: 'BILL_INVOICE', scope: 'PROPERTY' },
  { code: 'EDIT_BILL_INVOICE_PAYMENT', name: 'Edit Bill Invoice Payment', category: 'BILL_INVOICE', scope: 'PROPERTY' },
  { code: 'DELETE_BILL_INVOICE', name: 'Delete Bill Invoice', category: 'BILL_INVOICE', scope: 'PROPERTY' },
  { code: 'PAY_BILLS', name: 'Pay Bills', category: 'BILL', scope: 'PROPERTY' },
  { code: 'DOWNLOAD_BILL_INVOICE', name: 'Download Bill Invoice', category: 'BILL_INVOICE', scope: 'PROPERTY' },
  
  // Maintenance permissions
  { code: 'VIEW_MAINTENANCE_REQUESTS', name: 'View Maintenance Requests', category: 'MAINTENANCE', scope: 'PROPERTY' },
  { code: 'CREATE_MAINTENANCE_REQUESTS', name: 'Create Maintenance Requests', category: 'MAINTENANCE', scope: 'PROPERTY' },
  { code: 'UPDATE_MAINTENANCE_REQUESTS', name: 'Update Maintenance Requests', category: 'MAINTENANCE', scope: 'PROPERTY' },
  { code: 'DELETE_MAINTENANCE_REQUESTS', name: 'Delete Maintenance Requests', category: 'MAINTENANCE', scope: 'PROPERTY' },
  { code: 'ASSIGN_MAINTENANCE_TASKS', name: 'Assign Maintenance Tasks', category: 'MAINTENANCE', scope: 'PROPERTY' },
  
  // Report permissions
  { code: 'VIEW_DAILY_REPORTS', name: 'View Daily Reports', category: 'REPORT', scope: 'PROPERTY' },
  { code: 'CREATE_DAILY_REPORTS', name: 'Create Daily Reports', category: 'REPORT', scope: 'PROPERTY' },
  { code: 'EDIT_DAILY_REPORTS', name: 'Edit Daily Reports', category: 'REPORT', scope: 'PROPERTY' },
  { code: 'DELETE_DAILY_REPORTS', name: 'Delete Daily Reports', category: 'REPORT', scope: 'PROPERTY' },
  { code: 'APPROVE_DAILY_REPORTS', name: 'Approve Daily Reports', category: 'REPORT', scope: 'PROPERTY' },
  { code: 'SUBMIT_DAILY_REPORTS', name: 'Submit Daily Reports', category: 'REPORT', scope: 'PROPERTY' },
  
  // Payment Report permissions
  { code: 'VIEW_PAYMENT_REPORTS', name: 'View Payment Reports', category: 'PAYMENT_REPORT', scope: 'PROPERTY' },
  { code: 'RECORD_PAYMENTS', name: 'Record Payments', category: 'PAYMENT_REPORT', scope: 'PROPERTY' },
  { code: 'EDIT_PAYMENT_RECORDS', name: 'Edit Payment Records', category: 'PAYMENT_REPORT', scope: 'PROPERTY' },
  { code: 'DELETE_PAYMENT_RECORDS', name: 'Delete Payment Records', category: 'PAYMENT_REPORT', scope: 'PROPERTY' },
  { code: 'DOWNLOAD_PAYMENT_RECEIPT', name: 'Download Payment Receipt', category: 'PAYMENT_REPORT', scope: 'PROPERTY' },
  { code: 'PREVIEW_PAYMENTS', name: 'Preview Payments', category: 'PAYMENT_REPORT', scope: 'PROPERTY' },
  { code: 'VIEW_ARREARS', name: 'View Arrears', category: 'PAYMENT_REPORT', scope: 'PROPERTY' },
  
  // Receipt permissions
  { code: 'VIEW_RECEIPTS', name: 'View Receipts', category: 'RECEIPT', scope: 'PROPERTY' },
  { code: 'DOWNLOAD_RECEIPTS', name: 'Download Receipts', category: 'RECEIPT', scope: 'PROPERTY' },
  { code: 'GENERATE_RECEIPTS', name: 'Generate Receipts', category: 'RECEIPT', scope: 'PROPERTY' },
  
  // Document permissions - Offer Letters
  { code: 'VIEW_OFFER_LETTERS', name: 'View Offer Letters', category: 'DOCUMENT', scope: 'PROPERTY' },
  { code: 'CREATE_OFFER_LETTERS', name: 'Create Offer Letters', category: 'DOCUMENT', scope: 'PROPERTY' },
  { code: 'EDIT_OFFER_LETTERS', name: 'Edit Offer Letters', category: 'DOCUMENT', scope: 'PROPERTY' },
  { code: 'DELETE_OFFER_LETTERS', name: 'Delete Offer Letters', category: 'DOCUMENT', scope: 'PROPERTY' },
  
  // Document permissions - Demand Letters
  { code: 'VIEW_DEMAND_LETTERS', name: 'View Demand Letters', category: 'DOCUMENT', scope: 'PROPERTY' },
  { code: 'CREATE_DEMAND_LETTER', name: 'Create Demand Letter', category: 'DOCUMENT', scope: 'PROPERTY' },
  { code: 'AUTO_GENERATE_DEMAND_LETTER', name: 'Auto Generate Demand Letter', category: 'DOCUMENT', scope: 'PROPERTY' },
  { code: 'BATCH_GENERATE_DEMAND_LETTERS', name: 'Batch Generate Demand Letters', category: 'DOCUMENT', scope: 'PROPERTY' },
  { code: 'EDIT_DEMAND_LETTER_STATUS', name: 'Edit Demand Letter Status', category: 'DOCUMENT', scope: 'PROPERTY' },
  { code: 'DELETE_DEMAND_LETTER', name: 'Delete Demand Letter', category: 'DOCUMENT', scope: 'PROPERTY' },
  { code: 'DOWNLOAD_DEMAND_LETTER', name: 'Download Demand Letter', category: 'DOCUMENT', scope: 'PROPERTY' },
  { code: 'SEND_DEMAND_LETTERS', name: 'Send Demand Letters', category: 'DOCUMENT', scope: 'PROPERTY' },
  
  // Overdue Invoice permissions
  { code: 'VIEW_OVERDUE_INVOICES', name: 'View Overdue Invoices', category: 'INVOICE', scope: 'PROPERTY' },
  
  // Lead permissions
  { code: 'VIEW_LEADS', name: 'View Leads', category: 'LEAD', scope: 'PROPERTY' },
  { code: 'CREATE_LEAD', name: 'Create Lead', category: 'LEAD', scope: 'PROPERTY' },
  { code: 'EDIT_LEAD', name: 'Edit Lead', category: 'LEAD', scope: 'PROPERTY' },
  { code: 'DELETE_LEAD', name: 'Delete Lead', category: 'LEAD', scope: 'PROPERTY' },
  
  // Landlord permissions
  { code: 'VIEW_LANDLORDS', name: 'View Landlords', category: 'LANDLORD', scope: 'PROPERTY' },
  { code: 'CREATE_LANDLORD', name: 'Create Landlord', category: 'LANDLORD', scope: 'PROPERTY' },
  { code: 'EDIT_LANDLORD', name: 'Edit Landlord', category: 'LANDLORD', scope: 'PROPERTY' },
  { code: 'DELETE_LANDLORD', name: 'Delete Landlord', category: 'LANDLORD', scope: 'PROPERTY' },
  
  // Service Provider permissions
  { code: 'VIEW_SERVICE_PROVIDERS', name: 'View Service Providers', category: 'SERVICE_PROVIDER', scope: 'PROPERTY' },
  { code: 'CREATE_SERVICE_PROVIDER', name: 'Create Service Provider', category: 'SERVICE_PROVIDER', scope: 'PROPERTY' },
  { code: 'EDIT_SERVICE_PROVIDER', name: 'Edit Service Provider', category: 'SERVICE_PROVIDER', scope: 'PROPERTY' },
  { code: 'DELETE_SERVICE_PROVIDER', name: 'Delete Service Provider', category: 'SERVICE_PROVIDER', scope: 'PROPERTY' },
  
  // Activation Request permissions
  { code: 'VIEW_ACTIVATION_REQUESTS', name: 'View Activation Requests', category: 'ACTIVATION', scope: 'PROPERTY' },
  { code: 'CREATE_ACTIVATION_REQUEST', name: 'Create Activation Request', category: 'ACTIVATION', scope: 'PROPERTY' },
  { code: 'EDIT_ACTIVATION_REQUEST', name: 'Edit Activation Request', category: 'ACTIVATION', scope: 'PROPERTY' },
  { code: 'DELETE_ACTIVATION_REQUEST', name: 'Delete Activation Request', category: 'ACTIVATION', scope: 'PROPERTY' },
  { code: 'APPROVE_ACTIVATION_REQUEST', name: 'Approve Activation Request', category: 'ACTIVATION', scope: 'PROPERTY' },
  
  // Commission permissions
  { code: 'VIEW_COMMISSIONS', name: 'View Commissions', category: 'COMMISSION', scope: 'PROPERTY' },
  { code: 'GENERATE_COMMISSION_INVOICES', name: 'Generate Commission Invoices', category: 'COMMISSION', scope: 'PROPERTY' },
  { code: 'PROCESS_COMMISSIONS', name: 'Process Commissions', category: 'COMMISSION', scope: 'PROPERTY' },
  { code: 'APPROVE_COMMISSIONS', name: 'Approve Commissions', category: 'COMMISSION', scope: 'PROPERTY' },
  
  // User management permissions
  { code: 'VIEW_ALL_USERS', name: 'View All Users', category: 'USER_MANAGEMENT', scope: 'GLOBAL' },
  { code: 'CREATE_USER', name: 'Create User', category: 'USER_MANAGEMENT', scope: 'GLOBAL' },
  { code: 'DELETE_USER', name: 'Delete User', category: 'USER_MANAGEMENT', scope: 'GLOBAL' },
  { code: 'EDIT_USER_ROLE', name: 'Edit User Role', category: 'USER_MANAGEMENT', scope: 'GLOBAL' },
  { code: 'VIEW_AUDIT_LOGS', name: 'View Audit Logs', category: 'USER_MANAGEMENT', scope: 'GLOBAL' },
  { code: 'APPROVE_MANAGER', name: 'Approve Manager', category: 'USER_MANAGEMENT', scope: 'GLOBAL' },
  
  // Employee permissions
  { code: 'VIEW_EMPLOYEES', name: 'View Employees', category: 'EMPLOYEE', scope: 'GLOBAL' },
  { code: 'CREATE_EMPLOYEE', name: 'Create Employee', category: 'EMPLOYEE', scope: 'GLOBAL' },
  { code: 'EDIT_EMPLOYEE', name: 'Edit Employee', category: 'EMPLOYEE', scope: 'GLOBAL' },
  { code: 'DELETE_EMPLOYEE', name: 'Delete Employee', category: 'EMPLOYEE', scope: 'GLOBAL' }
];

async function seedPermissions() {
  console.log('🌱 Starting permission seeding...\n');
  
  // Get all valid permission codes from the service
  const validCodes = getAllPermissionCodesFromService();
  console.log(`📋 Found ${validCodes.length} valid permission codes from service\n`);
  
  // Get existing permissions from database
  const existingPermissions = await prisma.permission.findMany({
    select: { code: true, id: true }
  });
  
  const existingCodes = existingPermissions.map(p => p.code);
  
  // Find permissions to remove (exist in DB but not in service)
  const codesToRemove = existingCodes.filter(code => !validCodes.includes(code));
  
  if (codesToRemove.length > 0) {
    console.log(`⚠️  Found ${codesToRemove.length} deprecated permissions to remove...`);
    console.log(`   Deprecated codes: ${codesToRemove.join(', ')}\n`);
    
    // For each deprecated permission, manually delete from join tables first
    for (const code of codesToRemove) {
      const permission = await prisma.permission.findUnique({
        where: { code },
        select: { id: true }
      });
      
      if (permission) {
        // Delete from CustomRolePermission (custom roles)
        await prisma.customRolePermission.deleteMany({
          where: { permissionId: permission.id }
        });
        
        console.log(`   Removed references for "${code}"`);
      }
    }
    
    // Now delete the deprecated permissions
    await prisma.permission.deleteMany({
      where: { code: { in: codesToRemove } }
    });
    
    console.log(`✅ Removed ${codesToRemove.length} deprecated permissions\n`);
  } else {
    console.log('✅ No deprecated permissions found\n');
  }
  
  // Update or create permissions
  console.log(`📝 Syncing ${PERMISSIONS.length} permissions...`);
  
  let created = 0;
  let updated = 0;
  
  for (const perm of PERMISSIONS) {
    const existing = await prisma.permission.findUnique({
      where: { code: perm.code }
    });
    
    if (!existing) {
      // Create new permission
      await prisma.permission.create({
        data: perm
      });
      created++;
      
      if (created % 10 === 0) {
        console.log(`   ✓ ${created} new permissions created`);
      }
    } else if (existing.name !== perm.name || existing.category !== perm.category || existing.scope !== perm.scope) {
      // Update existing permission if details changed
      await prisma.permission.update({
        where: { code: perm.code },
        data: {
          name: perm.name,
          category: perm.category,
          scope: perm.scope
        }
      });
      updated++;
      
      if (updated % 10 === 0) {
        console.log(`   ✓ ${updated} permissions updated`);
      }
    }
  }
  
  if (created % 10 !== 0 && created > 0) {
    console.log(`   ✓ ${created} new permissions created`);
  }
  if (updated % 10 !== 0 && updated > 0) {
    console.log(`   ✓ ${updated} permissions updated`);
  }
  
  console.log(`\n✅ Permission sync completed!`);
  console.log(`📊 Summary:`);
  console.log(`   - Total permissions in system: ${PERMISSIONS.length}`);
  console.log(`   - New permissions created: ${created}`);
  console.log(`   - Permissions updated: ${updated}`);
  console.log(`   - Deprecated removed: ${codesToRemove.length}`);
  
  // Verify all expected permissions exist
  const finalPermissions = await prisma.permission.findMany({
    select: { code: true }
  });
  const finalCodes = finalPermissions.map(p => p.code);
  const missingCodes = validCodes.filter(code => !finalCodes.includes(code));
  
  if (missingCodes.length > 0) {
    console.log(`\n⚠️  Warning: ${missingCodes.length} expected permissions missing from service mapping:`);
    missingCodes.forEach(code => console.log(`   - ${code}`));
  } else {
    console.log(`\n✅ All ${validCodes.length} expected permissions are present!`);
  }
}

async function seedAdminUser() {
  console.log('\n👤 Setting up admin user...');
  
  const adminEmail = 'admin@example.com';
  const existingAdmin = await prisma.user.findUnique({
    where: { email: adminEmail }
  });

  if (!existingAdmin) {
    const hashedPassword = await hashPassword('Admin@123');
    await prisma.user.create({
      data: {
        name: 'Super Admin',
        email: adminEmail,
        password: hashedPassword,
        role: 'ADMIN',
        isApproved: true
      }
    });
    console.log('✅ Admin user created:');
    console.log('   Email: admin@example.com');
    console.log('   Password: Admin@123');
  } else {
    console.log('✅ Admin user already exists');
  }
}

async function main() {
  try {
    await seedPermissions();
    await seedAdminUser();
    
    console.log('\n🎉 Seeding completed successfully!');
    console.log('\n📋 What you can do now:');
    console.log('   1. Login with admin@example.com / Admin@123');
    console.log('   2. Create properties as a MANAGER');
    console.log('   3. Create custom roles via POST /api/rbac/roles');
    console.log('   4. Assign roles to managed users');
    console.log(`\n📊 Total permission codes in service: ${getAllPermissionCodesFromService().length}`);
  } catch (error) {
    console.error('\n❌ Seeding failed:', error);
    process.exit(1);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });