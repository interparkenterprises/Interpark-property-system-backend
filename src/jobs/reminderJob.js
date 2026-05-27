import 'dotenv/config';
import cron from 'node-cron';
import EmployeeService from '../services/employee.service.js';

const employeeService = new EmployeeService();

const TIMEZONE = 'Africa/Nairobi';

console.log('🚀 Payment Reminder Scheduler Started');
console.log('=====================================');
console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
console.log(`Timezone: ${TIMEZONE}`);
console.log(`Started at: ${new Date().toISOString()}`);
console.log('=====================================\n');

// Run reminder checks daily at 9:00 AM Kenyan Time
cron.schedule(
  '0 9 * * *',
  async () => {
    console.log(
      `[${new Date().toISOString()}] 📧 Running daily payment reminder check...`
    );

    try {
      await employeeService.checkAndSendPaymentReminders();

      console.log(
        `[${new Date().toISOString()}] ✅ Daily reminders sent successfully`
      );
    } catch (error) {
      console.error(
        `[${new Date().toISOString()}] ❌ Error sending daily reminders:`,
        error.message
      );
    }
  },
  {
    timezone: TIMEZONE,
  }
);

// Run at 12:00 PM Kenyan Time for urgent reminders
cron.schedule(
  '0 12 * * *',
  async () => {
    console.log(
      `[${new Date().toISOString()}] 🔔 Running urgent payment reminder check...`
    );

    try {
      await employeeService.checkAndSendPaymentReminders();

      console.log(
        `[${new Date().toISOString()}] ✅ Urgent reminders sent successfully`
      );
    } catch (error) {
      console.error(
        `[${new Date().toISOString()}] ❌ Error sending urgent reminders:`,
        error.message
      );
    }
  },
  {
    timezone: TIMEZONE,
  }
);

// Weekly summary on Mondays at 10:00 AM Kenyan Time
cron.schedule(
  '0 10 * * 1',
  async () => {
    console.log(
      `[${new Date().toISOString()}] 📊 Running weekly payment summary...`
    );

    try {
      await employeeService.checkAndSendPaymentReminders();

      console.log(
        `[${new Date().toISOString()}] ✅ Weekly summary sent successfully`
      );
    } catch (error) {
      console.error(
        `[${new Date().toISOString()}] ❌ Error sending weekly summary:`,
        error.message
      );
    }
  },
  {
    timezone: TIMEZONE,
  }
);

console.log('Scheduled Reminders:');
console.log('   - Daily reminder: 9:00 AM (Kenyan Time)');
console.log('   - Urgent reminder: 12:00 PM (Kenyan Time)');
console.log('   - Weekly summary: Monday 10:00 AM (Kenyan Time)');
console.log('📌 Timezone:', TIMEZONE);
console.log('✅ Scheduler is running. Press Ctrl+C to stop.');

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('🛑 SIGTERM received, shutting down gracefully...');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('🛑 SIGINT received, shutting down gracefully...');
  process.exit(0);
});