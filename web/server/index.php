<?php

require_once("timezone.php");



$request_method = $_SERVER['REQUEST_METHOD'];

switch($request_method) {
case 'GET':
    $request = &$_GET;
    break;
default:
    header("HTTP/1.1 405 method not allowed");
    http_response_code(405);
    exit(1);
}


header('Content-Type: application/json');


$tzDir = "data/";

$latitude = $request["lat"];
$longitude = $request["lng"];

if(isset($latitude) && isset($longitude)) {
    if(abs($latitude) <= 90 && abs($longitude) <= 180) {
        $timeZone = new TimeZone($tzDir);

        try {
            $response = $timeZone->get($latitude, $longitude);
        } catch (Exception $e) {
            $response["error"] = $e->getMessage();
        }
    } else {
        $response["error"] = "range error";
    }
} else {
    $response["error"] = "missing parameters";
}

echo json_encode($response, JSON_UNESCAPED_SLASHES);

exit(0);

?>
