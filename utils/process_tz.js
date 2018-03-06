

var fs = require('fs');
var path = require('path');
var util = require('util');
var mkdirp = require('mkdirp');
var asynclib = require('async');
var nodedir = require('node-dir');
var geohash = require('ngeohash');
var bbox = require('geojson-bbox');
var tc = require('timezonecomplete');
var momentTZ = require('moment-timezone');

var tzDb = tc.TzDatabase.instance();

var args = process.argv.slice(2);

var outDir = './out/';

var currentYear = new Date().getFullYear();


var saveGeometry = function(feature, callback) {
    var properties = feature['properties'];
    var geometry = feature['geometry'];
    var tzId = properties['tzid'];
    var fileName = path.join(outDir, tzId.replace(/\//g, '__') + '.json');
    console.log('saving', tzId);

    fs.writeFile(fileName, JSON.stringify(geometry), callback);
};

var scanDir = function(dir, callback) {
    nodedir.readFiles(dir, {
	recursive:  false,
	match:      /.json$/
    }, function(err, content, file, next) {
	var json = JSON.parse(content);
	processGeoJSON(file, json);
	next();
    }, callback);
};

var processGeoJSON = function(file, data) {
    var baseName = path.basename(file, '.json');
    var bounds = bbox(data);
    var tzId = baseName.replace(/__/g, '/');
    var tzData = getTZData(tzId);

    data['bbox'] = bounds;
    data['tz'] = tzData;

    saveFile(file, data);
};

var saveFile = function(file, data) {
    var bounds = data['bbox'];
    var minLng = bounds[0];
    var minLat = bounds[1];
    var maxLng = bounds[2];
    var maxLat = bounds[3];
    var part1 = Math.abs(parseInt(minLng)) + 1;
    var part2 = Math.abs(parseInt(minLat)) + 1;
    var part3 = Math.abs(parseInt(maxLng)) + 1;
    var part4 = Math.abs(parseInt(maxLat)) + 1;
    var fileName = util.format('%s%s%s%s%s%s%s%s',
			       minLng >= 0 ? 'E' : 'W', zeroPad(part1, 3),
			       minLat >= 0 ? 'N' : 'S', zeroPad(part2, 2),
			       maxLng >= 0 ? 'E' : 'W', zeroPad(part3, 3),
			       maxLat >= 0 ? 'N' : 'S', zeroPad(part4, 2));

    var SW = geohash.encode(minLat, minLng, 4);
    var NE = geohash.encode(maxLat, maxLng, 4);
    var hashFileName = SW + NE;
    var centerLat = (bounds[1] + bounds[3]) / 2;
    var centerLng = (bounds[0] + bounds[2]) / 2;
    var hash = geohash.encode(centerLat, centerLng);

    var paths = getPath(minLat, maxLat, minLng, maxLng);
    console.log('save', file, bounds, ' to ', paths, ' / ', fileName, hashFileName);

    for(var i = 0, l = paths.length; i < l; i++) {
	var dir = paths[i];

	dir = path.join(outDir, dir);

	mkdirp.mkdirp.sync(dir);

	var newPath = path.join(dir, fileName);

	fs.writeFileSync(file, JSON.stringify(data));
	fs.renameSync(file, newPath);
    }
};

var getPath = function(minLat, maxLat, minLng, maxLng) {
    var path = [];

    if(minLat >= 0 && maxLat >= 0) {
	// north hemisphere
	if(minLng >= 0 && maxLng >= 0) {
	    // east hemisphere
	    path.push('N/E');
	} else if(minLng < 0 && maxLng < 0) {
	    // west hemisphere
	    path.push('N/W');
	} else {
	    // both hemispheres
	    path.push('N/E', 'N/W');
	}
    } else if(minLat < 0 && maxLat < 0) {
	// south hemisphere
	if(minLng >= 0 && maxLng >= 0) {
	    // east hemisphere
	    path.push('S/E');
	} else if(minLng < 0 && maxLng < 0) {
	    // west hemisphere
	    path.push('S/W');
	} else {
	    // both hemispheres
	    path.push('S/E', 'S/W');
	}
    } else {
	// both hemispheres
	if(minLng >= 0 && maxLng >= 0) {
	    // east hemisphere
	    path.push('N/E', 'S/E');
	} else if(minLng < 0 && maxLng < 0) {
	    // west hemisphere
	    path.push('N/W', 'S/W');
	} else {
	    // both hemispheres
	    path.push('N/E', 'S/E', 'S/E', 'S/W');
	}
    }

    return path;
};


var getTZData = function(tzId) {
    var zoneInfo = momentTZ.tz.zone(tzId);
    var wTime = momentTZ([currentYear, 01, 01]).tz(tzId);
    var sTime = momentTZ([currentYear, 07, 01]).tz(tzId);
    var dstOffAbbr = wTime.zoneAbbr();
    var dstOnAbbr = sTime.zoneAbbr();
    var dstOffOffset = parseInt(wTime.utcOffset()) * 60;
    var abbrs = [dstOffAbbr];
    var offsets = [dstOffOffset];
    var change = [];

    if(dstOffAbbr !== dstOnAbbr) {
	abbrs.push(dstOnAbbr);
	offsets.push(parseInt(sTime.utcOffset()) * 60);

	try {
	    change.push(tzDb.nextDstChange(tzId, wTime.utc().valueOf()) / 1000,
			tzDb.nextDstChange(tzId, sTime.utc().valueOf()) / 1000);
	} catch (e) {
	    console.log(tzId + ':', e);
	}
    }

    return {
	name:  tzId,
	dstRules: {
	    abbrs:    abbrs,
	    offsets:  offsets,
	    change:   change
	}
    };
};


var safeMkdir = function(dirname, callback) {
    fs.mkdir(dirname, function(err) {
	if(err && err.code === 'EEXIST') {
	    callback();
	} else {
	    callback(err);
	}
    })
};

var writeVersion = function(callback) {
    var fileName = path.join(outDir, 'version');
    var date = momentTZ().format('YYYYMMDD');

    fs.writeFile(fileName, date, callback);
};


var zeroPad = function(num, size) {
    return ('000000000' + num).substr(-size);
};



//=======================================================================

asynclib.auto({
    createDir: function(cb) {
	console.log('create directory...');
	safeMkdir(outDir, cb);
    },
    splitGeoJSON: ['createDir', function(results, cb) {
	console.log('split GeoJSON...');
	var combinedGeoJson = require('./dist/combined.json');
	asynclib.eachSeries(combinedGeoJson['features'], saveGeometry, cb)
    }],
    processGeojson: ['splitGeoJSON', function(results, cb) {
	console.log('process TZ data files...');
	scanDir(outDir, cb);
    }],
    saveVersion: ['processGeojson', function(results, cb) {
	console.log('write version...');
	writeVersion(cb);
    }]
}, function(err) {
    console.log('complete.');

    if(err) {
	console.log(err);
	return;
    }
});

