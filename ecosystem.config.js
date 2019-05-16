/*global __dirname*/
const path = require('path');

// This is a PM2 "ecosystem file", intended for a development environment.
// For documentation on options, see https://pm2.io/doc/en/runtime/reference/ecosystem-file/


// Pass through additional arguments that might ultimately have come from
// something like `npm run start -- --port 3009`
const argpos = process.argv.indexOf('--');
const args = argpos > -1 ? process.argv.slice(argpos + 1) : [];

module.exports = {
  apps : [{
    name: path.basename(__dirname),
    script: 'lib/app.js',

    // passed to app, so any valid arguments in options.js are allowed.
    args: args.join(' '),

    // Increase the number of instances to support more concurrent users.
    instances: 1,
    autorestart: true,

    // rather than setting watch:true here, use `npm run watch`
    watch: false,
    max_memory_restart: '1G',

    env: {
      NODE_ENV: 'development'
    },
    // If the script is called with `--env production`, this environment variable gets set.
    env_production: {
      NODE_ENV: 'production'
    }
  }]
};
