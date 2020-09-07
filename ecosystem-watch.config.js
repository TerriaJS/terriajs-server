const dev = require('./ecosystem.config.js');

const devApp = dev.apps[0];

module.exports = {
    apps: [
        {
            ...devApp,
            watch: ['dist']
        }
    ]
};
