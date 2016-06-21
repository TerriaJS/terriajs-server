var exists = require('./exists');
var fs = require('fs');
var config = {};

function getFilePath(fileName, warn) {
    if (exists(fileName)) {
        return fileName;
    } else if (warn) {
        console.warn("Warning: Can\'t open '" + fileName + "'.");
    }
}

function getConfigFile(argFileName, defaultFileName) {
    return argFileName ?  getFilePath(argFileName, true) : getFilePath(defaultFileName);
}


/**
 * Gets a config file using require, logging a warning and defaulting to a backup value in the event of a failure.
 *
 * @param filePath The path to look for the config file.
 * @param configFileType What kind of config file is this? E.g. config, auth etc.
 * @param failureConsequence The consequence of using the defaultValue when this file fails to load - this will be logged
 *        as part of the warning
 * @returns {*} The config, either from the filePath or a default.
 */
function getConfig(filePath, configFileType, failureConsequence, quiet) {
    var config;

    try {
        var fileContents = fs.readFileSync(filePath, 'utf8');
        // Strip comments formatted as lines starting with a #.
        config = JSON.parse(fileContents.replace(/^\s*#.*$/mg,''));
        if (!quiet) {
            console.log('Using ' + configFileType + ' file "' + fs.realpathSync(filePath) + '".');
        }
    } catch (e) {
        if (!quiet) {
            var loggedFilePath = filePath ? ' "' + filePath + '"' : '';
            if (!(loggedFilePath === '' && configFileType === 'proxyAuth')) {
                console.warn('Warning: Can\'t open ' + configFileType + ' file' + loggedFilePath + '. ' + failureConsequence + '.\n');
            }
        }
        config = {};
    }

    return config;
}

function loadCommandLine() {
    var yargs = require('yargs')
        .usage('$0 [options] [path/to/wwwroot]')
        .options({
        'port' : {
            'description' : 'Port to listen on.                [default: 3001]'
        },
        'public' : {
            'type' : 'boolean',
            'default' : true,
            'description' : 'Run a public server that listens on all interfaces.'
        },
        'config-file' : {
            'description' : 'File containing settings such as allowed domains to proxy. See serverconfig.json.example'
        },
        'proxy-auth' : {
            'description' : 'File containing auth information for proxied domains. See proxyauth.json.example'
        },
        'help' : {
            'alias' : 'h',
            'type' : 'boolean',
            'description' : 'Show this help.'
        }
    });
    if (yargs.argv.help) {
        return yargs.showHelp();
    }

    return yargs.argv;
}


config.init = function(quiet) {
    var argv = loadCommandLine();

    this.listenHost = argv.public ? undefined : 'localhost';
    this.configFile = getConfigFile(argv.configFile, 'serverconfig.json');
    this.settings = getConfig(this.configFile, 'config', 'ALL proxy requests will be accepted.', quiet);
    this.proxyAuthFile = getConfigFile(argv.proxyAuth, 'proxyauth.json');
    this.proxyAuth = getConfig(this.proxyAuthFile, 'proxyAuth', 'Proxying to servers that require authentication will fail', quiet);
    this.port = argv.port || this.settings.port || 3001;
    this.wwwroot = argv._.length > 0 ? argv._[0] : process.cwd() + '/wwwroot';

    this.settings.proxyAllDomains = this.settings.proxyAllDomains || typeof this.settings.allowProxyFor === 'undefined';
}

module.exports = config;