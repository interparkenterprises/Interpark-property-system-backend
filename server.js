import 'dotenv/config';
import app from './src/app.js';

const PORT = process.env.PORT || 5000;

// Cron jobs are handled by the separate scheduler process
// No need to initialize them here

const server = app.listen(PORT, () => {
  console.log(`🚀 Server running in ${process.env.NODE_ENV || 'development'} mode on port ${PORT}`);
  console.log('💡 Note: Payment reminders are handled by the scheduler process');
  console.log('   Run "npm run scheduler" to start the reminder service');
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM signal received: closing HTTP server');
  server.close(() => {
    console.log('HTTP server closed');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('SIGINT signal received: closing HTTP server');
  server.close(() => {
    console.log('HTTP server closed');
    process.exit(0);
  });
});

export default server;