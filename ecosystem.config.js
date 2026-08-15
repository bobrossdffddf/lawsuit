/**
 * PM2 process definition for the FLGOV judicial bot.
 *
 *   pm2 start ecosystem.config.js
 *   pm2 save
 *   pm2 startup systemd     # then run the line it prints
 *
 * Run it from the project directory — PM2 resolves `script` and `cwd`
 * relative to this file, so the same config works wherever you put the repo.
 */
module.exports = {
  apps: [
    {
      name: 'flgov-bot',
      script: 'src/index.js',
      cwd: __dirname,

      // A Discord gateway bot must be a SINGLE process. Cluster mode would
      // open one gateway connection per instance and every interaction would
      // be handled twice.
      instances: 1,
      exec_mode: 'fork',

      autorestart: true,
      restart_delay: 5000,
      // Back off instead of hammering Discord if the token is bad.
      max_restarts: 10,
      min_uptime: '30s',
      exp_backoff_restart_delay: 1000,

      // Never enable watch: SQLite's WAL files change constantly and would
      // put the bot into a restart loop.
      watch: false,

      max_memory_restart: '400M',

      env: {
        NODE_ENV: 'production',
      },

      // Timestamped logs, merged into one pair of files.
      time: true,
      merge_logs: true,
      out_file: './logs/out.log',
      error_file: './logs/error.log',
    },
  ],
};
