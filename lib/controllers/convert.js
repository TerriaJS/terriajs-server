/* jshint node: true */
"use strict";
var express = require('express');
var fs = require('fs');
var ogr2ogr = require('ogr2ogr');
var request = require('request');
var formidable = require('formidable');

var convert = {};

convert.testGdal = function() {
    // test doing 'something' with an empty GeoJSON object. It will either fail with ENOENT, or fail with OGR2OGR output.
    ogr2ogr({}).exec(function(error) {
        if ((error !== undefined) && error.message.match(/ENOENT/)) {
            console.log('Convert warning: ogr2ogr (gdal) is not installed or inaccessible, so the format conversion service will fail.');
        } else {
            // GDAL is installed ok.
        }
    });
};

function tooBigError(request, response) {
    response.status(413) // Payload Too Large
            .send('This file is too big to convert. Maximum allowed size: ' + convert.maxConversionSize + ' bytes');
    console.log('Convert: uploaded file exceeds limit of ' + convert.maxConversionSize + ' bytes. Aborting.');
}

// Extract file name and path out of the provided HTTP POST form
function parseForm(req, res, callback) {
    var form = new formidable.IncomingForm();
    form.parse(req, function(err, fields, files) {
        var fname, fpath;

        if (fields.input_url !== undefined) {
            if (fields.input_url.indexOf('http') === 0) {
                callback(fields.input_url, fields.input_url);
            }
        } else if (files.input_file !== undefined) {
            if (files.input_file.size <= convert.maxConversionSize) {
                callback(files.input_file.path, files.input_file.name);
            } else {
                return tooBigError(req, res);
            }
        }
    });
}

// Pass a stream to the OGR2OGR library, returning a GeoJSON result.
function convertStream(stream, req, res, hint) {
    var ogr = ogr2ogr(stream, hint)
                    .skipfailures()
                    .options(['-t_srs', 'EPSG:4326']);

    ogr.exec(function (er, data) {
        if (er) {
            console.error('Convert error: ' + er);
        }
        if (data !== undefined) {
            res.status(200).send(JSON.stringify(data));
        } else {
            res.status(415). // Unsupported Media Type
                send('Unable to convert this data file. For a list of formats supported by Terria, see http://www.gdal.org/ogr_formats.html .');
        }
    });
}

function handleContent (fpath, fname) {
    if (!fpath) {
        return res.status(400).send('No file provided to convert.');            
    }
    console.log('Convert: receiving file named ', fname);

    var hint = '';
    //simple hint for now, might need to crack zip files going forward
    if (fname.match(/\.zip$/)) {
        hint = 'shp';
    }        
    if (fpath.indexOf('http') === 0) {
        var httpStream, abort = false;
        // Read file content by opening the URL given to us
        httpStream = request.get({url: fpath}).on('response', function(response) {
            var request = this, len = 0;
            response.on('data', function (chunk) {
                len += chunk.length;
                if (!abort && len > convert.maxConversionSize) {
                    tooBigError(request, res);
                    abort = true;
                    httpStream.abort(); // avoid fetching the entire file once we know it's too big. We'll probably get one or two chunks too many.
                }
            });
            response.on('end', function() {
                console.log('Convert: received file of ' + len + ' bytes' + (abort ? ' (which we\'re discarding).' : '.'));
                if (!abort) {
                    // Receive the whole file before processing. Tiny bit of latency, but cleaner aborting if the file is too big.
                    convertStream(httpStream, req, res, hint);
                }
            });
        });
    } else {
        // Read file content embedded directly in POST data
        convertStream(fs.createReadStream(fpath), req, res, hint); 
    }
}

// provide conversion to geojson service
// reguires install of gdal on server: 
//   sudo apt-get install gdal-bin
convert.router = express.Router().post('/',  function(req, res) { 
    parseForm(req, res, handleContent); 
});


module.exports = function(options) {
    if (options) {
        convert.maxConversionSize = options.settings.maxConversionSize || 1000000;
    }
    return convert;
}