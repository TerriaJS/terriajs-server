/* jshint node: true */
"use strict";

var express = require('express');
var compression = require('compression');
var path = require('path');
var cors = require('cors');
var cluster = require('cluster');
var fs = require('fs');
var exists = require('./exists');

function portInUse(port, host, callback) {
    var server = require('net').createServer();

    server.listen(port, host);
    server.on('error', function () {
        callback(true);
    });
    server.on('listening', function () {
        server.close();
        callback(false);
    });
}


function getFilePath(fileName) {
    if (exists(fileName)) {
        return fileName;
    }
}

function getConfigFile(argFileName, defaultFileName) {
    return argFileName ?  getFilePath(argFileName) : getFilePath(defaultFileName);
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
function getConfig(filePath, configFileType, failureConsequence) {
    var config;

    try {
        var fileContents = fs.readFileSync(filePath, 'utf8');
        // Strip comments formatted as lines starting with a #.
        config = JSON.parse(fileContents.replace(/^\s*#.*$/mg,''));
        if (cluster.isMaster) {
            console.log('Using ' + configFileType + ' file "' + fs.realpathSync(filePath) + '".');
        }
    } catch (e) {
        if (cluster.isMaster) {
            var loggedFilePath = filePath ? ' "' + filePath + '"' : '';
            console.warn('Warning: Can\'t open ' + configFileType + ' file' + loggedFilePath + '. ' + failureConsequence + '.\n');
        }
        config = {};
    }

    return config;
}

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
    'proxy-auth-file' : {
        'description' : 'File containing auth information for proxied domains. See proxyauth.json.example'
    },
    'help' : {
        'alias' : 'h',
        'type' : 'boolean',
        'description' : 'Show this help.'
    }
});

var argv = yargs.argv;
if (cluster.isMaster) {
    console.log ('TerriaJS Server ' + require('../package.json').version);
}
if (argv.help) {
    return yargs.showHelp();
}

var wwwroot = argv._.length > 0 ? argv._[0] : process.cwd() + '/wwwroot';
var serveWwwRoot = exists(wwwroot + '/index.html');
var listenHost = argv.public ? undefined : 'localhost';
var configFile = getConfigFile(argv.configFile, 'serverconfig.json');
var configSettings = getConfig(configFile, 'config', 'ALL proxy requests will be accepted.');
var proxyAuthFile = getConfigFile(argv.proxyAuth, 'proxyauth.json');
var proxyAuth = getConfig(proxyAuthFile, 'proxyAuth', 'Proxying to servers that require authentication will fail');
var port = argv.port || configSettings.port || 3001;

// The master process just spins up a few workers and quits.
if (cluster.isMaster) {
    if (fs.existsSync('terriajs.pid')) {
        console.log('Warning: TerriaJS-Server seems to already be running.');
    }
    portInUse(port, listenHost, function(inUse) {
        function handleExit() {
            console.log('(TerriaJS-Server exiting.)');
            if (fs.existsSync('terriajs.pid')) {
                fs.unlinkSync('terriajs.pid');
            }
            process.exit(0);
        }

        var cpuCount = require('os').cpus().length;
        if (inUse) {
            console.error('Error: Port ' + port + ' is in use. Exiting.');
            process.exit(1);
        } else {
            console.log('Serving directory "' + wwwroot + '" on port ' + port + '.');
            require('./convert').testGdal();

            if (!exists(wwwroot)) {
                console.warn('Warning: "' + wwwroot + '" does not exist.');
            } else if (!exists(wwwroot + '/index.html')) {
                console.warn('Warning: "' + wwwroot + '" is not a TerriaJS wwwroot directory.');
            } else if (!exists(wwwroot + '/build')) {
                console.warn('Warning: "' + wwwroot + '" has not been built. You should do this:\n\n' +
                    '> cd ' + wwwroot + '/..\n' +
                    '> gulp\n');
            }

            if (typeof configSettings.allowProxyFor === 'undefined') {
                console.log('Warning: The configuration does not contain a "allowProxyFor" list.  The server will proxy _any_ request.');
            }

            process.on('SIGTERM', handleExit);

            // Listen for dying workers
            cluster.on('exit', function (worker) {
                if (!worker.suicide) {
                    // Replace the dead worker if not a startup error like port in use.
                    console.log('Worker ' + worker.id + ' died. Replacing it.');
                    cluster.fork();
                }
            });

            fs.writeFileSync('terriajs.pid', process.pid.toString());
            console.log('(TerriaJS-Server running with pid ' + process.pid + ')');

            console.log('Launching ' +  cpuCount + ' worker processes.');

            // Create a worker for each CPU
            for (var i = 0; i < cpuCount; i += 1) {
                cluster.fork();
            }

        }
    });
    return;
}

configSettings.proxyAllDomains = configSettings.proxyAllDomains || typeof configSettings.allowProxyFor === 'undefined';

// eventually this mime type configuration will need to change
// https://github.com/visionmedia/send/commit/d2cb54658ce65948b0ed6e5fb5de69d022bef941
var mime = express.static.mime;
mime.define({
    'application/json' : ['czml', 'json', 'geojson'],
    'text/plain' : ['glsl']
});

// initialise app with standard middlewares
var app = express();
app.use(compression());
app.use(cors());
app.disable('etag');

if (typeof configSettings.trustProxy !== 'undefined') {
    app.set('trust proxy', configSettings.trustProxy);
}

var show404 = serveWwwRoot && exists(wwwroot + '/404.html');
var show500 = serveWwwRoot && exists(wwwroot + '/500.html');

if (configSettings.basicAuthentication && configSettings.basicAuthentication.username && configSettings.basicAuthentication.password) {
    app.use(express.basicAuth(configSettings.basicAuthentication.username, configSettings.basicAuthentication.password));
}

// Serve the bulk of our application as a static web directory.
if (serveWwwRoot) {
    app.use(express.static(wwwroot));
}

// Proxy for servers that don't support CORS

var bypassUpstreamProxyHostsMap = (configSettings.bypassUpstreamProxyHosts || []).reduce(function(map, host) {
        if (host !== '') {
            map[host.toLowerCase()] = true;
        }
        return map;
    }, {});
app.use('/proxy', require('./proxy')({
    proxyableDomains: configSettings.allowProxyFor,
    proxyAllDomains: configSettings.proxyAllDomains,
    proxyAuth: proxyAuth,
    upstreamProxy: configSettings.upstreamProxy,
    bypassUpstreamProxyHosts: bypassUpstreamProxyHostsMap,
}));

app.use('/proj4def', require('./proj4lookup'));            // Proj4def lookup service, to avoid downloading all definitions into the client.
app.use('/convert', require('./convert'));                 // OGR2OGR wrapper to allow supporting file types like Shapefile.
app.use('/proxyabledomains', require('./proxydomains')({   // Returns JSON list of domains we're willing to proxy for
    proxyableDomains: configSettings.allowProxyFor,
    proxyAllDomains: !!configSettings.proxyAllDomains,
}));
app.get('/ping', function(req, res){
  res.status(200).send('OK');
});

var errorPage = require('./errorpage');
var error404 = errorPage.error404(show404, wwwroot, serveWwwRoot);
var error500 = errorPage.error500(show500, wwwroot);
var initPaths = configSettings.initPaths || [];
if (serveWwwRoot) {
    initPaths.push(path.join(wwwroot, 'init'));
}

app.use('/init', require('./initfile')(initPaths, error404, path.dirname(configFile)));
/*
// For testing, simply reflects stuff back at the caller. Uncomment if needed.
app.get('/reflect', function(req, res){
    res.status(200).send(req.headers);
});
var bodyParser = require('body-parser');
app.post('/reflect', bodyParser.urlencoded({extended: true, type: function() { return true; }}), function(req, res) {
    var response = {
        body: req.body,
        headers: req.headers
    };

    res.status(200).send(response);
});
*/

var feedbackService = require('./feedback')(configSettings.feedback);
if (feedbackService) {
    app.use('/feedback', feedbackService);
}

app.use(error404);
app.use(error500);

app.listen(port, listenHost);
process.on('uncaughtException', function(err) {
    console.error(err.stack ? err.stack : err);
    process.exit(1);
});

/*
//sample simple NM service. To use, uncomment and move above the fallback redirection.
app.post('/nm_service_1', function(req, res, next) {
    var formidable = require('formidable');
    //receive the posted object
    var form = new formidable.IncomingForm();
    form.parse(req, function(err, fields, files) {
        //create a layer for NM to display
        var obj = {
            name: 'Bikes Available',
            type: 'DATA',
            proxy: false,
            url: 'http://nationalmap.nicta.com.au/test/bike_racks.geojson'
        };
        //send a response with the object and display text
        res.json({ displayHtml: 'Here are the available bike racks.', layer: obj});
    });
});
*/

