

var fs = require('fs');
var path = require('path');

var args = process.argv.slice(2);

var baseDir = './out/';


var scanDir = function(dir, latitude, longitude) {
    fs.readdir(dir, function(err, files) {
	if(err) {
	    console.log('read dir error:', err);
	    return;
	}

	files.map(function(file) {
	    return path.join(dir, file);
	}).filter(function(file) {
	    return fs.statSync(file).isFile();
	}).forEach(function(file) {
	    readFile(file, latitude, longitude);
	});
    });
};

var readFile = function(file, latitude, longitude) {
    var baseName = path.basename(file, '.json');
    var lat = parseInt(latitude);
    var lng = parseInt(longitude);
    var minLngHemi = baseName.substr(0, 1);
    var minLng = parseInt(baseName.substr(1, 3)) * (minLngHemi === 'E' ? 1 : -1);
    var minLatHemi = baseName.substr(4, 1);
    var minLat = parseInt(baseName.substr(5, 2)) * (minLatHemi === 'N' ? 1 : -1);
    var maxLngHemi = baseName.substr(7, 1);
    var maxLng = parseInt(baseName.substr(8, 3)) * (maxLngHemi === 'E' ? 1 : -1);
    var maxLatHemi = baseName.substr(11, 1);
    var maxLat = parseInt(baseName.substr(12, 2)) * (maxLatHemi === 'N' ? 1 : -1);

    if(lat >= minLat && lat <= maxLat &&
       lng >= minLng && lng <= maxLng) {
	fs.readFile(file, 'utf8', function(err, data) {
	    var json = JSON.parse(data);
	    console.log('pass 1:', file, json.tz.name);
	    processFile(json, latitude, longitude);
	});
    }
};

var processFile = function(data, latitude, longitude) {
    var lat = parseFloat(latitude);
    var lng = parseFloat(longitude);
    var bbox = data['bbox'];
    var minLng = parseFloat(bbox[0]);
    var minLat = parseFloat(bbox[1]);
    var maxLng = parseFloat(bbox[2]);
    var maxLat = parseFloat(bbox[3]);

    if(lat >= minLat && lat <= maxLat &&
       lng >= minLng && lng <= maxLng) {
	console.log('pass 2:', data.tz.name);
	var pnp = pointInPolygon([lng, lat], {
	    type:      'feature',
	    geometry:  data
	})

	pnp && console.log('found time zone:', data['tz']);
    }
};


var getTimeZone = function(latitude, longitude) {
    var dir = baseDir;

    if(latitude >= 0)
	dir = path.join(dir, 'N');
    else
	dir = path.join(dir, 'S');

    if(longitude >= 0)
	dir = path.join(dir, 'E');
    else
	dir = path.join(dir, 'W');

    scanDir(dir, latitude, longitude);
};


var pointInPolygon = function(point, polygon) {
    var polys = polygon.geometry.coordinates;

    if(polygon.geometry.type === 'Polygon')
	polys = [polys];

    for(var i = 0, insidePoly = false; i < polys.length && !insidePoly; i++) {
        if(inRing(point, polys[i][0])) {
            var inHole = false;
            var k = 1;

            while(k < polys[i].length && !inHole) {
                if(inRing(point, polys[i][k])) {
                    inHole = true;
                }
                k++;
            }

            if(!inHole)
		insidePoly = true;
        }
    }

    return insidePoly;
};

var inRing = function(pt, ring) {
    var isInside = false;

    for(var i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        var xi = ring[i][0], yi = ring[i][1];
        var xj = ring[j][0], yj = ring[j][1];
        var intersect = ((yi > pt[1]) !== (yj > pt[1])) &&
            (pt[0] < (xj - xi) * (pt[1] - yi) / (yj - yi) + xi);

        if(intersect)
	    isInside = !isInside;
    }

    return isInside;
};



//=======================================================================

if(args.length != 2) {
    console.log('usage:',
		path.basename(process.argv[1]),
		'<latitude> <longitude>');
    return;
}

fs.stat(baseDir, function(err, stat) {
    if(err) {
	console.log(err);
	return;
    }

    getTimeZone(args[0], args[1]);
});

