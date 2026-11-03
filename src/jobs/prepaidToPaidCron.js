import cron from 'node-cron';
import { runPrepaidToPaidTransition } from '../services/prepaidTransitionService.js';
import { APP_TIMEZONE } from '../services/billingPeriodUtils.js';

export const PREPAID_CRON_EXPRESSION = process.env.PREPAID_CRON_EXPRESSION || '5 * * * *';
const isEnabled = () => String(process.env.PREPAID_TRANSITION_ENABLED || 'true').toLowerCase() !== 'false';
const GENERATE_PDF = String(process.env.PREPAID_CRON_GENERATE_PDF || 'false').toLowerCase() === 'true';
const GENERATE_RECEIPT = String(process.env.PREPAID_CRON_GENERATE_RECEIPT || 'true').toLowerCase() === 'true'; 

let task = null;
let running = false;

export async function executePrepaidTransition(trigger = 'cron') {
  if (running) {
    console.warn(`[prepaid-transition] (${trigger}) skipped — previous run still in progress`);
    return null;
  }
  running = true;
  try {
    return await runPrepaidToPaidTransition({ generatePdf: GENERATE_PDF,
        generateReceipt: GENERATE_RECEIPT, trigger
    });
  } catch (error) {
    console.error(`[prepaid-transition] (${trigger}) run failed:`, error);
    return null;
  } finally {
    running = false;
  }
}

export function startPrepaidToPaidCron() {
  if (!isEnabled()) {
    console.log('[prepaid-transition] disabled via PREPAID_TRANSITION_ENABLED=false');
    return null;
  }
  if (task) {
    console.log('[prepaid-transition] cron already registered — ignoring duplicate start');
    return task;
  }
  if (!cron.validate(PREPAID_CRON_EXPRESSION)) {
    console.error(`[prepaid-transition] invalid cron expression "${PREPAID_CRON_EXPRESSION}" — job not started`);
    return null;
  }

  task = cron.schedule(
    PREPAID_CRON_EXPRESSION,
    () => { void executePrepaidTransition('cron'); },
    { scheduled: true, timezone: APP_TIMEZONE }
  );

  console.log(`[prepaid-transition] cron registered "${PREPAID_CRON_EXPRESSION}" (${APP_TIMEZONE}) pdf=${GENERATE_PDF ? 'on' : 'off'}`);

  if (String(process.env.PREPAID_TRANSITION_RUN_ON_START || 'true').toLowerCase() !== 'false') {
    setTimeout(() => { void executePrepaidTransition('startup'); }, 10_000).unref?.();
  }
  return task;
}

export function stopPrepaidToPaidCron() {
  if (!task) return false;
  task.stop();
  task = null;
  console.log('[prepaid-transition] cron stopped');
  return true;
}

export default { startPrepaidToPaidCron, stopPrepaidToPaidCron, executePrepaidTransition };
