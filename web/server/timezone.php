<?php



class TimeZone {
    var $_dataDir;
    var $_latitude;
    var $_longitude;

    function __construct($dir = "data/") {
        $this->_dataDir = $dir;
    }

    function TimeZone($dir = "data/") {
        $this->__construct($dir);
    }

    function get($latitude, $longitude) {
        $this->_latitude = $latitude;
        $this->_longitude = $longitude;

        $path = $this->getPath();
        $files = new FilesystemIterator($path);

        $tz = null;

        foreach($files as $file) {
            if($file->isFile()) {
                $baseName = $file->getBaseName();

                if($this->checkByName($baseName)) {
                    $realPath = $file->getPathname();
                    $content = file_get_contents($realPath);
                    $json = json_decode($content);
                    $bbox = $json->bbox;

                    if($this->checkByBBox($bbox)) {
                        $type = $json->type;
                        $coordinates = $json->coordinates;

                        switch(strtolower($type)) {
                        case "multipolygon":
                            if($this->inMultipolygon($coordinates))
                                $tz = $json->tz;
                            break;
                        case "polygon":
                            if($this->inPolygon($coordinates))
                                $tz = $json->tz;
                            break;
                        default:
                            //throw new Exception("invalid geometry type: " . $type);
                            break;
                        }

                        if(isset($tz))
                            break;
                    }
                }
            }
        }

        if(!isset($tz))
            $tz = $this->getETCZone();

        return $tz;
    }

    function getDataVersion() {
        $name = $this->_dataDir . "version";
        $version = file_get_contents($name);

        return $version;
    }


    private function getPath() {
        $path = $this->_dataDir;

        if($this->_latitude >= 0)
            $path .= "/N";
        else
            $path .= "/S";

        if($this->_longitude >= 0)
            $path .= "/E";
        else
            $path .= "/W";

        return $path;
    }

    private function checkByName($name) {
        $lat = intval($this->_latitude);
        $lng = intval($this->_longitude);
        list($minLngH, $minLng,
             $minLatH, $minLat,
             $maxLngH, $maxLng,
             $maxLatH, $maxLat) = sscanf($name, "%c%d%c%d%c%d%c%d");

        if($minLngH == 'W')
            $minLng = -$minLng;
        if($minLatH == 'S')
            $minLat = -$minLat;
        if($maxLngH == 'W')
            $maxLng = -$maxLng;
        if($maxLatH == 'S')
            $maxLat = -$maxLat;

        return ($lat >= $minLat && $lat <= $maxLat &&
                $lng >= $minLng && $lng <= $maxLng);
    }

    private function checkByBBox($bbox) {
        return ($this->_latitude >= $bbox[1] && $this->_latitude <= $bbox[3] &&
                $this->_longitude >= $bbox[0] && $this->_longitude <= $bbox[2]);
    }

    private function getETCZone() {
        $lng = $this->_longitude;
        $sign = '-';
        $tz = new stdClass();

        if($this->_longitude < 0) {
            $lng = -$this->_longitude;
            $sign = '+';
        }

        $offset = intval(($lng - 7.5) / 15.0 + 1.0);
        $name = "Etc/GMT" . $sign . $offset;

        $tz->name = $name;
        $dstRules["abbrs"] = array($name);
        $dstRules["offsets"] = array($offset * ($sign == '-' ? 3600 : -3600));
        $dstRules["change"] = array();
        $tz->dstRules = $dstRules;

        return $tz;
    }

    private function inMultipolygon($multiPolygon) {
        $inside = false;

        foreach($multiPolygon as $polygon) {
            $inside = $this->inPolygon($polygon);

            if($inside)
                break;
        }

        return $inside;
    }

    private function inPolygon($polygon) {
        $inside = false;
        $nLines = count($polygon);
        $line = $polygon[0];

        if($this->inRing($line)) {
            $inHole = false;
            $k = 1;

            while($k < $nLines && !$inHole) {
                $line = $polygon[$k];

                if($this->inRing($line))
                    $inHole = true;

                $k++;
            }

            if(!$inHole)
                $inside = true;
        }

        return $inside;
    }

    private function inRing($line) {
        $inside = false;
        $nPoints = count($line);

        for($i = 0, $j = $nPoints - 1; $i < $nPoints; $j = $i++) {
            $p1 = $line[$i];
            $p2 = $line[$j];
            $xi = $p1[0];
            $yi = $p1[1];
            $xj = $p2[0];
            $yj = $p2[1];

            if((($yi > $this->_latitude) != ($yj > $this->_latitude)) &&
               ($this->_longitude < ($xj - $xi) * ($this->_latitude - $yi) / ($yj - $yi) + $xi ))
                $inside = !$inside;
        }

        return $inside;
    }
}

?>
