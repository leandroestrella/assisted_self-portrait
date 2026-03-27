<?php
header('Content-Type: application/json');

$USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
$CACHE_DIR = sys_get_temp_dir() . '/asp_cache';
$CACHE_TTL = 300; // 5 minutes

$query = isset($_GET['q']) ? trim($_GET['q']) : '';
if ($query === '') {
    http_response_code(400);
    echo json_encode(['error' => 'Missing query parameter "q"']);
    exit;
}

// File-based cache since PHP doesn't persist memory across requests
if (!is_dir($CACHE_DIR)) @mkdir($CACHE_DIR, 0755, true);
$cacheFile = $CACHE_DIR . '/' . md5($query) . '.json';
if (file_exists($cacheFile) && (time() - filemtime($cacheFile)) < $CACHE_TTL) {
    readfile($cacheFile);
    exit;
}

function curlGet($url, $headers = []) {
    global $USER_AGENT;
    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_FOLLOWLOCATION => true,
        CURLOPT_USERAGENT      => $USER_AGENT,
        CURLOPT_HTTPHEADER     => $headers,
        CURLOPT_TIMEOUT        => 15,
        CURLOPT_SSL_VERIFYPEER => true,
    ]);
    $body = curl_exec($ch);
    $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $err  = curl_error($ch);
    curl_close($ch);
    if ($body === false) throw new Exception("cURL error: $err");
    return ['body' => $body, 'code' => $code];
}

try {
    // DuckDuckGo requires a per-session anti-CSRF token
    $tokenUrl = 'https://duckduckgo.com/?q=' . urlencode($query) . '&iax=images&ia=images';
    $tokenRes = curlGet($tokenUrl);
    if (!preg_match('/vqd=["\']([^"\']+)["\']/', $tokenRes['body'], $m)) {
        if (!preg_match('/vqd=([\d-]+)/', $tokenRes['body'], $m)) {
            throw new Exception('Could not extract search token');
        }
    }
    $vqd = $m[1];

    $params = http_build_query([
        'l'   => 'us-en',
        'o'   => 'json',
        'q'   => $query,
        'vqd' => $vqd,
        'f'   => ',,,,license:Share,',
        'p'   => '1',
    ]);
    $searchRes = curlGet("https://duckduckgo.com/i.js?$params", ['Referer: https://duckduckgo.com/']);
    if ($searchRes['code'] !== 200) {
        throw new Exception('DuckDuckGo returned ' . $searchRes['code']);
    }

    $data = json_decode($searchRes['body'], true);
    $raw = isset($data['results']) ? $data['results'] : [];

    $results = [];
    foreach ($raw as $r) {
        // Filter out tiny images
        if (isset($r['width'], $r['height']) && ($r['width'] < 150 || $r['height'] < 150)) {
            continue;
        }
        $results[] = [
            'url'       => isset($r['image']) ? $r['image'] : '',
            'thumbnail' => isset($r['thumbnail']) ? $r['thumbnail'] : '',
            'title'     => isset($r['title']) ? $r['title'] : '',
            'source'    => isset($r['source']) ? $r['source'] : '',
        ];
    }

    $output = json_encode(['results' => $results]);
    @file_put_contents($cacheFile, $output);
    echo $output;

} catch (Exception $e) {
    http_response_code(500);
    echo json_encode(['error' => 'Image search failed', 'details' => $e->getMessage()]);
}
