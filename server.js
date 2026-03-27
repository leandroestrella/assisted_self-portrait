const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, 'public')));

// --- Shared constants ---

const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

// --- Image Search API (DuckDuckGo scraping) ---

const searchCache = new Map();
const CACHE_TTL = 5 * 60 * 1000;

// Prevent unbounded cache growth
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of searchCache) {
    if (now - entry.timestamp > CACHE_TTL) searchCache.delete(key);
  }
}, CACHE_TTL);

// DuckDuckGo requires a per-session anti-CSRF token for image search
async function fetchSearchToken(query) {
  const res = await fetch(`https://duckduckgo.com/?q=${encodeURIComponent(query)}&iax=images&ia=images`, {
    headers: { 'User-Agent': USER_AGENT }
  });
  const text = await res.text();
  const match = text.match(/vqd=["']([^"']+)["']/) || text.match(/vqd=([\d-]+)/);
  if (!match) throw new Error('Could not extract search token');
  return match[1];
}

async function searchImages(query) {
  const cached = searchCache.get(query);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.results;
  }

  const token = await fetchSearchToken(query);
  const params = new URLSearchParams({
    l: 'us-en',
    o: 'json',
    q: query,
    vqd: token,
    f: ',,,,license:Share,',
    p: '1'
  });

  const res = await fetch(`https://duckduckgo.com/i.js?${params}`, {
    headers: {
      'User-Agent': USER_AGENT,
      'Referer': 'https://duckduckgo.com/'
    }
  });

  if (!res.ok) throw new Error(`DuckDuckGo returned ${res.status}`);

  const data = await res.json();
  const results = (data.results || [])
    .filter(r => {
      if (r.width && r.height) {
        return r.width >= 150 && r.height >= 150;
      }
      return true;
    })
    .map(r => ({
      url: r.image,
      thumbnail: r.thumbnail,
      title: r.title,
      source: r.source
    }));

  searchCache.set(query, { results, timestamp: Date.now() });
  return results;
}

app.get('/api/search-images', async (req, res) => {
  const query = req.query.q;
  if (!query) return res.status(400).json({ error: 'Missing query parameter "q"' });

  try {
    const results = await searchImages(query);
    res.json({ results });
  } catch (err) {
    console.error('Image search error:', err.message);
    res.status(500).json({ error: 'Image search failed', details: err.message });
  }
});

// --- Image Proxy ---

app.get('/api/proxy-image', async (req, res) => {
  const imageUrl = req.query.url;
  if (!imageUrl) return res.status(400).json({ error: 'Missing query parameter "url"' });

  // Only proxy HTTP(S) URLs to prevent SSRF against local services
  if (!imageUrl.startsWith('http://') && !imageUrl.startsWith('https://')) {
    return res.status(400).json({ error: 'Only HTTP(S) URLs are allowed' });
  }

  try {
    const response = await fetch(imageUrl, {
      headers: {
        'User-Agent': USER_AGENT,
        'Accept': 'image/*'
      },
      redirect: 'follow'
    });

    if (!response.ok) {
      return res.status(response.status).json({ error: 'Failed to fetch image' });
    }

    const contentType = response.headers.get('content-type') || 'image/jpeg';
    res.set('Content-Type', contentType);
    res.set('Cache-Control', 'public, max-age=3600');

    const buffer = Buffer.from(await response.arrayBuffer());
    res.send(buffer);
  } catch (err) {
    console.error('Image proxy error:', err.message);
    res.status(500).json({ error: 'Image proxy failed' });
  }
});

app.listen(PORT, () => {
  console.log(`assisted_self-portrait running at http://localhost:${PORT}`);
});
