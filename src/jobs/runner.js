import 'dotenv/config';
import { startBackgroundJobs, stopBackgroundJobs } from './index.js';

startBackgroundJobs();

const shutdown = () => {
  console.log('[runner] shutting down...');
  stopBackgroundJobs();
  process.exit(0);
};
process.on('SIGTERM', shutdown);
process.on('SIGINT',  shutdown);