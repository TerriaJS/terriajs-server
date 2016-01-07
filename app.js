/* jshint node: true */
"use strict";

/**
 * Terria server, used to run NationalMap. It is primarily a static web app, but there are a couple of helper functions
 * that run server-side.
 */
var fs = require('fs');
var yargs = require('yargs')
    .usage('$0 [options] [path-to-wwwroot]')
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

argv.wwwroot = argv._.length > 0 ? argv._[0] : process.cwd() + '/wwwroot'; // is there a way to name a positional argument with yarg? I can't find it.

try {
    fs.accessSync(argv.wwwroot + '/index.html', fs.F_OK);
} catch (e) {
    console.log(argv.wwwroot + ' does not appear to be a TerriaJS wwwroot directory.');
    process.exit(1);
}

var cluster = require('cluster');

// The master process just spins up a few workers and quits.
if (cluster.isMaster) {
    var cpuCount = require('os').cpus().length;
    console.log('Launching ' +  cpuCount + ' workers; listening on port ' + argv.port + '.');

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
    return;
}

/*jshint es3:false*/

var express = require('express');
var compression = require('compression');
var path = require('path');
var cors = require('cors');

var proxy = require('./proxy');
var crs = require('./crs');
var convert = require('./convert');


var po = proxy._proxyOptions = {};
po.upstreamProxy = argv['upstream-proxy'];
po.bypassUpstreamProxyHosts = {};

if (argv['bypass-upstream-proxy-hosts']) {
    argv['bypass-upstream-proxy-hosts'].split(',').forEach(function(host) {
        po.bypassUpstreamProxyHosts[host.toLowerCase()] = true;
    });
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

// Serve the bulk of our application as a static web directory.
app.use(express.static(argv.wwwroot));

app.use('/proxy', proxy);      // Proxy for servers that don't support CORS
app.use('/proj4def', crs);     // Proj4def lookup service, to avoid downloading all definitions into the client.
app.use('/convert', convert);  // OGR2OGR wrapper to allow supporting file types like Shapefile.
app.get('/ping', function(req, res){
  res.status(200).send('OK');
});

// Redirect unknown pages back home. We don't actually have a 404 page, for starters.
app.use(function(req, res, next) {
    res.redirect(303, '/');
});

app.listen(argv.port, argv.public ? undefined : 'localhost');
process.on('uncaughtException', function(err) {
    if(err.errno === 'EADDRINUSE') {
        if (cluster.worker.id === 1) { // we don't need to see this message 8 times
            console.log('Port ' + argv.port + ' is in use - exiting.');
        }
        cluster.worker.kill(); // sets "suicide" so the worker isn't replaced.
    } else {
         console.log(err);
         process.exit(1);
    }
    
});     

//

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
