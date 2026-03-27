<?php
$USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

$imageUrl = isset($_GET['url']) ? $_GET['url'] : '';
if ($imageUrl === '') {
    header('Content-Type: application/json');
    http_response_code(400);
    echo json_encode(['error' => 'Missing query parameter "url"']);
    exit;
}

// Only proxy HTTP(S) URLs to prevent SSRF against local services
if (strpos($imageUrl, 'http://') !== 0 && strpos($imageUrl, 'https://') !== 0) {
    header('Content-Type: application/json');
    http_response_code(400);
    echo json_encode(['error' => 'Only HTTP(S) URLs are allowed']);
    exit;
}

$ch = curl_init($imageUrl);
curl_setopt_array($ch, [
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_FOLLOWLOCATION => true,
    CURLOPT_USERAGENT      => $USER_AGENT,
    CURLOPT_HTTPHEADER     => ['Accept: image/*'],
    CURLOPT_TIMEOUT        => 15,
    CURLOPT_SSL_VERIFYPEER => true,
]);
$body = curl_exec($ch);
$code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
$contentType = curl_getinfo($ch, CURLINFO_CONTENT_TYPE) ?: 'image/jpeg';
$err = curl_error($ch);
curl_close($ch);

if ($body === false || $code >= 400) {
    header('Content-Type: application/json');
    http_response_code($code ?: 500);
    echo json_encode(['error' => 'Failed to fetch image']);
    exit;
}

header('Content-Type: ' . $contentType);
header('Cache-Control: public, max-age=3600');
echo $body;
