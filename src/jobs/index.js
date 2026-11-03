import { startPrepaidToPaidCron, stopPrepaidToPaidCron } from './prepaidToPaidCron.js';
import { startReminderCron, stopReminderCron } from './reminderJob.js';

let started = false;

export function startBackgroundJobs() {
  if (started) {
    console.log('[jobs] already started — ignoring duplicate call');
    return;
  }
  started = true;
  startPrepaidToPaidCron();
  startReminderCron();
  console.log('[jobs] all background jobs started');
}

export function stopBackgroundJobs() {
  stopPrepaidToPaidCron();
  stopReminderCron();
  started = false;
  console.log('[jobs] all background jobs stopped');
}

export default { startBackgroundJobs, stopBackgroundJobs };