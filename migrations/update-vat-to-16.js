// migrations/update-vat-to-16.js
import prisma from '../src/lib/prisma.js';
import fs from 'fs';

async function updateVATForExistingInvoices() {
  console.log('Starting VAT update migration...');
  console.log('Setting VAT rate to 16% for all tenants and recalculating invoices...');
  
  try {
    // First, update all tenants to have 16% VAT rate (only for those with VAT applicable)
    console.log('\n=== STEP 1: Updating tenant VAT rates to 16% ===');
    const updatedTenants = await prisma.tenant.updateMany({
      where: {
        OR: [
          { vatType: 'INCLUSIVE' },
          { vatType: 'EXCLUSIVE' }
        ]
      },
      data: {
        vatRate: 16
      }
    });
    
    console.log(`✓ Updated ${updatedTenants.count} tenants to 16% VAT rate`);
    
    // Now recalculate all existing invoices
    console.log('\n=== STEP 2: Recalculating all existing invoices ===');
    
    // Get total count first
    const totalInvoices = await prisma.invoice.count();
    console.log(`Found ${totalInvoices} invoices to update`);
    
    // Process in smaller batches to avoid memory issues
    const batchSize = 50;
    let processedCount = 0;
    let updatedCount = 0;
    let errors = [];
    
    while (processedCount < totalInvoices) {
      const invoices = await prisma.invoice.findMany({
        skip: processedCount,
        take: batchSize,
        include: {
          tenant: {
            select: {
              vatRate: true,
              vatType: true,
              rent: true,
              serviceCharge: true
            }
          }
        },
        orderBy: { createdAt: 'asc' }
      });
      
      if (invoices.length === 0) break;
      
      for (const invoice of invoices) {
        try {
          const tenant = invoice.tenant;
          const vatRate = 16; // Always use 16%
          
          // Skip if tenant has no VAT
          if (tenant.vatType === 'NOT_APPLICABLE') {
            processedCount++;
            continue;
          }
          
          // Calculate new values
          const rent = invoice.rent;
          const serviceCharge = invoice.serviceCharge;
          const subtotal = rent + serviceCharge;
          
          let vat = 0;
          
          if (tenant.vatType === 'INCLUSIVE') {
            // Extract VAT from subtotal
            vat = subtotal - (subtotal / (1 + vatRate / 100));
          } else if (tenant.vatType === 'EXCLUSIVE') {
            // Add VAT on top
            vat = (subtotal * vatRate) / 100;
          }
          
          // Calculate total based on VAT type
          let totalDue;
          if (tenant.vatType === 'INCLUSIVE') {
            totalDue = subtotal;
          } else {
            totalDue = subtotal + vat;
          }
          
          // Recalculate balance
          const balance = totalDue - invoice.amountPaid;
          
          // Determine new status
          let status = invoice.status;
          if (invoice.amountPaid >= totalDue) {
            status = 'PAID';
          } else if (invoice.amountPaid > 0) {
            status = 'PARTIAL';
          } else {
            status = 'UNPAID';
          }
          
          // Update invoice
          await prisma.invoice.update({
            where: { id: invoice.id },
            data: {
              vat,
              totalDue,
              balance,
              status
            }
          });
          
          updatedCount++;
          
        } catch (error) {
          errors.push({
            invoiceId: invoice.id,
            invoiceNumber: invoice.invoiceNumber,
            error: error.message
          });
          console.error(`  ✗ Error updating invoice ${invoice.id}: ${error.message}`);
        }
        
        processedCount++;
        
        // Progress indicator
        if (processedCount % 100 === 0) {
          console.log(`  Processed ${processedCount}/${totalInvoices} invoices...`);
        }
      }
    }
    
    // Update payment reports
    console.log('\n=== STEP 3: Updating payment reports ===');
    const totalReports = await prisma.paymentReport.count();
    console.log(`Found ${totalReports} payment reports to update`);
    
    let processedReports = 0;
    let updatedReports = 0;
    
    while (processedReports < totalReports) {
      const reports = await prisma.paymentReport.findMany({
        skip: processedReports,
        take: batchSize,
        include: {
          tenant: {
            select: {
              vatType: true
            }
          }
        },
        orderBy: { createdAt: 'asc' }
      });
      
      if (reports.length === 0) break;
      
      for (const report of reports) {
        try {
          const tenant = report.tenant;
          
          // Skip if tenant has no VAT
          if (tenant.vatType === 'NOT_APPLICABLE') {
            processedReports++;
            continue;
          }
          
          const vatRate = 16;
          
          // Calculate new VAT for payment report
          let vat = 0;
          const subtotal = report.rent + (report.serviceCharge || 0);
          
          if (tenant.vatType === 'INCLUSIVE') {
            vat = subtotal - (subtotal / (1 + vatRate / 100));
          } else if (tenant.vatType === 'EXCLUSIVE') {
            vat = (subtotal * vatRate) / 100;
          }
          
          // Recalculate arrears
          let totalDue;
          if (tenant.vatType === 'INCLUSIVE') {
            totalDue = subtotal;
          } else {
            totalDue = subtotal + vat;
          }
          
          const arrears = totalDue - report.amountPaid;
          
          // Update status
          let status = report.status;
          if (report.amountPaid >= totalDue) {
            status = 'PAID';
          } else if (report.amountPaid > 0) {
            status = 'PARTIAL';
          } else {
            status = 'UNPAID';
          }
          
          await prisma.paymentReport.update({
            where: { id: report.id },
            data: {
              vat,
              totalDue,
              arrears,
              status
            }
          });
          
          updatedReports++;
          
        } catch (error) {
          errors.push({
            paymentReportId: report.id,
            error: error.message
          });
          console.error(`  ✗ Error updating payment report ${report.id}: ${error.message}`);
        }
        
        processedReports++;
        
        if (processedReports % 100 === 0) {
          console.log(`  Processed ${processedReports}/${totalReports} payment reports...`);
        }
      }
    }
    
    console.log('\n=== MIGRATION COMPLETE ===');
    console.log(`✓ Updated ${updatedCount} invoices with 16% VAT`);
    console.log(`✓ Updated ${updatedReports} payment reports with 16% VAT`);
    
    if (errors.length > 0) {
      console.log(`\n⚠️  ${errors.length} errors occurred during migration:`);
      
      // Save errors to file
      fs.writeFileSync(
        'vat-migration-errors.json',
        JSON.stringify(errors, null, 2)
      );
      console.log('  Detailed errors saved to vat-migration-errors.json');
    } else {
      console.log('✓ No errors encountered');
    }
    
    console.log('\n✅ VAT migration completed successfully!');
    
  } catch (error) {
    console.error('\n❌ Migration failed with error:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

// Handle unhandled rejections
process.on('unhandledRejection', (error) => {
  console.error('Unhandled promise rejection:', error);
  process.exit(1);
});

// Run the migration
updateVATForExistingInvoices()
  .then(() => {
    console.log('Migration script execution finished');
    process.exit(0);
  })
  .catch(error => {
    console.error('Migration script failed to execute:', error);
    process.exit(1);
});