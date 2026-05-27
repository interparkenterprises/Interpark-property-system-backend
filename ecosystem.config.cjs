module.exports = {
  apps: [
    {
      name: 'backend',
      script: 'server.js',
    },
    {
      name: 'scheduler',
      script: 'src/jobs/reminderJob.js',
    },
  ],
};