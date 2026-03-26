/**
 * imageSearch.js
 * Searches for portrait photos, then crops face regions using ImageCropper.
 * Each face part comes from a different person's portrait.
 */

const ImageSearch = (function () {
  // Different queries so each part gets a unique portrait
  const PORTRAIT_QUERIES = [
    'portrait face close up photography',
    'face portrait studio photography',
    'portrait headshot photography natural',
    'face close up portrait photo woman',
    'portrait photography man face',
    'portrait face with ears visible photo',
    'headshot portrait ears showing photo',
    'face portrait frontal photography woman',
    'portrait face photo man natural light',
  ];

  // Map each face part to a query index
  const PART_ASSIGNMENTS = {
    leftEye:       0,
    rightEye:      1,
    nose:          2,
    mouth:         3,
    chin:          4,
    leftEar:       5,
    rightEar:      6,
    leftForehead:  7,
    rightForehead: 8,
  };

  const MAX_ATTEMPTS = 5;

  return {
    /**
     * Search for portrait photos and crop face parts from them.
     * @param {Function} onProgress - called with (loaded, total)
     * @returns {Object} { partName: { url, title } }
     */
    async fetchAll(onProgress) {
      const parts = Object.entries(PART_ASSIGNMENTS);
      const total = parts.length;
      let loaded = 0;
      const images = {};

      // Process all parts in parallel
      const promises = parts.map(async ([partName, queryIndex]) => {
        const query = PORTRAIT_QUERIES[queryIndex];

        // Fetch search results
        const res = await fetch(
          `/api/search-images?q=${encodeURIComponent(query)}`
        );
        if (!res.ok) throw new Error(`Search failed for "${query}"`);
        const data = await res.json();
        const results = data.results || [];

        if (results.length === 0) {
          throw new Error(`No results for "${query}"`);
        }

        // Shuffle top results
        const pool = results.slice(0, 15);
        for (let i = pool.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [pool[i], pool[j]] = [pool[j], pool[i]];
        }

        // Try candidates until one works
        const attempts = Math.min(MAX_ATTEMPTS, pool.length);
        let fallbackUrl = null;

        for (let i = 0; i < attempts; i++) {
          const pick = pool[i];
          // Use full image for better crop quality
          const imageUrl = `/api/proxy-image?url=${encodeURIComponent(pick.url)}`;

          if (i === 0) {
            // Save thumbnail as fallback
            fallbackUrl = `/api/proxy-image?url=${encodeURIComponent(pick.thumbnail || pick.url)}`;
          }

          try {
            const result = await ImageCropper.cropPart(imageUrl, partName);
            if (result) {
              images[partName] = {
                url: result.dataUrl,
                title: pick.title || query
              };
              loaded++;
              if (onProgress) onProgress(loaded, total);
              return;
            }
          } catch (err) {
            console.warn(`Crop attempt ${i + 1} failed for ${partName}:`, err.message);
          }
        }

        // Fallback: use thumbnail directly
        console.log(`${partName}: no crop succeeded, using thumbnail fallback`);
        images[partName] = {
          url: fallbackUrl || `/api/proxy-image?url=${encodeURIComponent(pool[0].thumbnail || pool[0].url)}`,
          title: pool[0].title || query
        };
        loaded++;
        if (onProgress) onProgress(loaded, total);
      });

      await Promise.all(promises);
      return images;
    }
  };
})();
