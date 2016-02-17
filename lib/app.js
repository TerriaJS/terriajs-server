/* jshint node: true */
"use strict";

var express = require('express');
var compression = require('compression');
var path = require('path');
var cors = require('cors');
var cluster = require('cluster');
var proxy = require('./proxy');
var proj4lookup = require('./proj4lookup');
var convert = require('./convert');
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

var yargs = require('yargs')
    .usage('$0 [options] [path/to/wwwroot]')
    .options({
    'port' : {
        'default' : 3001,
        'description' : 'Port to listen on.'
    },
    'public' : {
        'type' : 'boolean',
        'default' : true,
        'description' : 'Run a public server that listens on all interfaces.'
    },
    'config-file' : {
        'description' : 'File containing { "proxyDomains": ["foo.com"] }'
    },
    'proxy-auth-file' : {
        'description' : 'File containing { "www.some.remote.service.example.com": { "authorization": "Basic dGVzdHVzZXI6dGVzdHBhc3MK" }}'
    },
    'upstream-proxy' : {
        'description' : 'A standard proxy server that will be used to retrieve data.  Specify a URL including port, e.g. "http://proxy:8000".'
    },
    'bypass-upstream-proxy-hosts' : {
        'description' : 'A comma separated list of hosts that will bypass the specified upstream_proxy, e.g. "lanhost1,lanhost2"'
    },
    'help' : {
        'alias' : 'h',
        'type' : 'boolean',
        'description' : 'Show this help.'
    }
});

var argv = yargs.argv;
if (argv.help) {
    return yargs.showHelp();
}

var wwwroot = argv._.length > 0 ? argv._[0] : process.cwd() + '/wwwroot';
var serveWwwRoot = exists(wwwroot + '/index.html');
var listenHost = argv.public ? undefined : 'localhost';
var configFile = getConfigFile(wwwroot, argv.configFile, 'config.json');
var configSettings = getConfig(configFile, 'config', 'ALL proxy requests will be accepted.');
var proxyAuthFile = getConfigFile(wwwroot, argv.proxyAuth, 'proxyAuth.json');
var proxyAuth = getConfig(proxyAuthFile, 'proxyAuth', 'Proxying to servers that require authentication will fail');

// The master process just spins up a few workers and quits.
if (cluster.isMaster) {
    var packagejson = require('../package.json');
    console.log ('TerriaJS Server ' + packagejson.version);

    portInUse(argv.port, listenHost, function(inUse) {
        var cpuCount = require('os').cpus().length;
        if (inUse) {
            console.error('Error: Port ' + argv.port + ' is in use. Exiting.');
            process.exit(1);
        } else {
            console.log('Serving directory "' + wwwroot + '" on port ' + argv.port + '.');
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

            console.log('Launching ' +  cpuCount + ' worker processes.');

            // Create a worker for each CPU
            for (var i = 0; i < cpuCount; i += 1) {
                cluster.fork();
            }

            // Listen for dying workers
            cluster.on('exit', function (worker) {
                if (!worker.suicide) {
                    // Replace the dead worker if not a startup error like port in use.
                    console.log('Worker ' + worker.id + ' died. Replacing it.');
                    cluster.fork();
                }
            });
    
        }
    });
    return;
}

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

var show404 = serveWwwRoot && exists(wwwroot + '/404.html');

// Serve the bulk of our application as a static web directory.
if (serveWwwRoot) {
    app.use(express.static(wwwroot));   
}

// Proxy for servers that don't support CORS
var bypassUpstreamHosts = argv['bypass-upstream-proxy-hosts'];
app.use('/proxy', proxy({
    proxyDomains: configSettings.proxyDomains,
    proxyAllDomains: configSettings.proxyAllDomains,
    upstreamProxy: argv['upstream-proxy'],
    bypassUpstreamProxyHosts: bypassUpstreamHosts ? bypassUpstreamHosts.split(',').reduce(function(map, host) {
        map[host.toLowerCase()] = true;
        return map;
    }, {}) : {},
    proxyAuth: proxyAuth
}));

app.use('/proj4def', proj4lookup);     // Proj4def lookup service, to avoid downloading all definitions into the client.
app.use('/convert', convert);  // OGR2OGR wrapper to allow supporting file types like Shapefile.
app.get('/ping', function(req, res){
  res.status(200).send('OK');
});

app.use(function(req, res, next) {
    if (show404) {
        res.status(404).sendFile(wwwroot + '/404.html');
    } else if (serveWwwRoot) {
        // Redirect unknown pages back home.
        res.redirect(303, '/');
    } else {
        res.status(404).send('No TerriaJS website here.');
    }
});

app.listen(argv.port, listenHost);
process.on('uncaughtException', function(err) {
    console.log(err);
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


function getFilePath(wwwroot, fileName) {
    if (exists(path.join(wwwroot, fileName))) { // if unspecified, we should look in the wwwroot for a Terria config file
        return path.join(wwwroot, fileName);
    } else if (exists(path.join(wwwroot, '../', fileName))) { // else in the root directory.
        return path.join(wwwroot, '../', fileName);
    } else {
        if (cluster.isMaster) {
            console.warn('Could not find file ' + fileName + ' in ' + wwwroot + ' or ' + __dirname);
        }
    }
}

function getConfigFile(wwwroot, argFileName, defaultFileName) {
    return argFileName ?  getFilePath(wwwroot, argFileName) : getFilePath(wwwroot, defaultFileName);
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
        config = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        if (cluster.isMaster) {
            console.log('Using ' + configFileType + ' file "' + filePath + '".');
        }
    } catch (e) {
        if (cluster.isMaster) {
            console.warn('Warning: Can\'t open ' + configFileType + ' file "' + filePath + '". ' + failureConsequence + '.\n');
        }
    }

    return config;
}