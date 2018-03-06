/*
 * app.js  v1.0
 */


var tzLookup = {
    mapContainer:  null,
    map:           null,
    layerControl:  null,
    boundary:      null,
    mapCenter:     L.latLng(0, 0),
    zoom:          2,

    tzServiceUrl:  '/tz/',


    init: function(mapElId) {
	this.mapContainer = document.getElementById(mapElId);
	this.createMap(mapElId);
    },

    createMap: function(mapElementId) {
	var me = this;

	this.map = L.map(mapElementId, {
	    center:  this.mapCenter,
	    zoom:    this.zoom,
	    minZoom: 1,
	    maxZoom: 18
	});

	this.map.on('click', this.onMapClick, this);

	this.layerControl = L.control.layers().addTo(this.map);
	this.boundary = L.geoJSON().addTo(this.map);

	var osm = L.tileLayer('http://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
	    attribution: '&copy; <a href="http://openstreetmap.org/copyright">OpenStreetMap</a> contributors,' +
                '  <a href="http://creativecommons.org/licenses/by-sa/2.0/">CC-BY-SA</a>'
	}).addTo(this.map);
	this.layerControl.addBaseLayer(osm, 'OpenStreetMap');

	L.control.scale({
            imperial:  false
	}).addTo(this.map);
    },

    getTZ: function(e, callback, scope) {
	var url = this.tzServiceUrl + '?' +
	    'lat=' + e.latlng.lat +
	    '&lng=' + e.latlng.lng;
	var xhr = new XMLHttpRequest();
	var popup = L.popup()
	    .setLatLng(e.latlng)
	    .setContent('<h3>' + this.dd2dms(e.latlng.lat, 'NS') +
			'<br>' + this.dd2dms(e.latlng.lng, 'EW') + '</h3>')
	    .openOn(this.map);

	xhr.onload = function() {
	    if(this.status >= 200 && this.status < 400) {
		var json = null;

		try {
		    json = JSON.parse(this.response);
		} catch (exception) {
		    console.error('parse exception:', exception);
		    return;
		}

		callback && callback.call(scope, json, popup);
	    }
	};

	xhr.open('GET', url, true);
	xhr.send(null);
    },

    processTZ: function(result, popup) {
	var content = popup.getContent();

	if('error' in result) {
	    content += '<hr><h3 style="color:#f00;">' + result['error'] + '</h3>';
	    popup.setContent(content);
	    return;
	}

	var tzName = result.name;
	var dstRules = result.dstRules;
	var abbrs = dstRules.abbrs;
	var offsets = dstRules.offsets;
	var change = dstRules.change;

	content += '<hr>';
	content += '<div style="font-size:130%;font-weight:bold;">' + tzName + '</div>';

	content += '<ul style="margin:0;font-size:120%;font-weight:bold;">';
	for(var i = 0, l = abbrs.length; i < l; i++) {
	    var abbr = abbrs[i];
	    var offset = offsets[i];

	    content += '<li style="padding-left:0;">' + abbr +
		       '&nbsp;' + this.s2hm(offset) + '</li>';
	}
	content += '</ul>';

	popup.setContent(content);
    },

    dd2dms: function(dd, hemisphere) {
	var h = dd < 0 ? hemisphere.charAt(1) : hemisphere.charAt(0);

	dd = Math.abs(dd);

        var d = Math.floor(dd);
        var m = Math.floor((dd - d) * 60);
        var s = Math.round((dd - d - m / 60) * 3600 * 1000) / 1000;

        return h + ' ' + d + '\u00B0 ' + m + '\u0027 ' + s + '\u0022';
    },

    s2hm: function(seconds) {
	var sign = seconds < 0 ? '-' : '+';
	seconds = Math.abs(seconds);
	var h = seconds / 3600;
	var m = (seconds / 60) % 60;

	if(h < 10)
	    h = '0' + h;
	if(m < 10)
	    m = '0' + m;

	return sign + h + ':' + m;
    },

    onMapClick: function(e) {
	console.debug('click:', e);
	this.getTZ(e, this.processTZ, this);
    }
};

