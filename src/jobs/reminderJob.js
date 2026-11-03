import cron from 'node-cron';
import EmployeeService from '../services/employee.service.js';

const employeeService = new EmployeeService();
const TIMEZONE = 'Africa/Nairobi';

let tasks = [];
let running = false;

async function runReminders(label) {
  if (running) {
    console.warn(`[reminders] (${label}) skipped — previous run in progress`);
    return;
  }
  running = true;
  const ts = new Date().toISOString();
  console.log(`[${ts}] 📧 Running ${label} reminder check...`);
  try {
    await employeeService.checkAndSendPaymentReminders();
    console.log(`[${ts}] ✅ ${label} reminders sent`);
  } catch (error) {
    console.error(`[${ts}] ❌ Error in ${label} reminders:`, error.message);
  } finally {
    running = false;
  }
}

export function startReminderCron() {
  if (tasks.length) return tasks;

  tasks = [
    cron.schedule('0 9 * * *',  () => runReminders('daily'),  { timezone: TIMEZONE }),
    cron.schedule('0 12 * * *', () => runReminders('urgent'), { timezone: TIMEZONE }),
    cron.schedule('0 10 * * 1', () => runReminders('weekly'), { timezone: TIMEZONE }),
  ];

  console.log('[reminders] cron registered (9:00, 12:00, Mon 10:00 EAT)');
  return tasks;
}

export function stopReminderCron() {
  tasks.forEach(t => t.stop());
  tasks = [];
  console.log('[reminders] cron stopped');
}

export default { startReminderCron, stopReminderCron };