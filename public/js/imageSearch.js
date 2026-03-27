/**
 * imageSearch.js
 * Searches for portrait photos, then crops face regions using ImageCropper.
 * Each face part comes from a different person's portrait.
 */

const ImageSearch = (function () {
  // Queries targeting close-up face portraits so the cropper reliably detects faces
  const PORTRAIT_QUERIES = [
    'close up face portrait woman studio',
    'man face close up portrait photo',
    'woman face frontal portrait headshot',
    'person face close up studio portrait',
    'face portrait close up natural light person',
    'frontal face portrait close up ears showing',
    'person face portrait headshot frontal ears',
    'woman face close up portrait frontal',
    'man face close up portrait frontal headshot',
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

  // The webcam display is mirrored, so the crop from the source portrait
  // needs to be flipped: MediaPipe "leftEye" appears on the RIGHT of screen,
  // so it should show a right-looking eye from the portrait.
  const MIRROR_CROP_MAP = {
    leftEye: 'rightEye',
    rightEye: 'leftEye',
    leftEar: 'rightEar',
    rightEar: 'leftEar',
    leftForehead: 'rightForehead',
    rightForehead: 'leftForehead',
  };

  const MAX_ATTEMPTS = 10;

  async function fetchOneFaceSet(onProgress) {
    const parts = Object.entries(PART_ASSIGNMENTS);
    const total = parts.length;
    let loaded = 0;
    const images = {};

    const promises = parts.map(async ([partName, queryIndex]) => {
      const query = PORTRAIT_QUERIES[queryIndex];

      const res = await fetch(
        `/api/search-images?q=${encodeURIComponent(query)}`
      );
      if (!res.ok) throw new Error(`Search failed for "${query}"`);
      const data = await res.json();
      const results = data.results || [];

      if (results.length === 0) {
        throw new Error(`No results for "${query}"`);
      }

      // Shuffle top results for variety
      const pool = results.slice(0, 15);
      for (let i = pool.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [pool[i], pool[j]] = [pool[j], pool[i]];
      }

      const attempts = Math.min(MAX_ATTEMPTS, pool.length);
      let fallbackUrl = null;

      for (let i = 0; i < attempts; i++) {
        const pick = pool[i];
        const imageUrl = `/api/proxy-image?url=${encodeURIComponent(pick.url)}`;

        if (i === 0) {
          fallbackUrl = `/api/proxy-image?url=${encodeURIComponent(pick.thumbnail || pick.url)}`;
        }

        try {
          const cropName = MIRROR_CROP_MAP[partName] || partName;
          const result = await ImageCropper.cropPart(imageUrl, cropName);
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

  return {
    fetchAll: fetchOneFaceSet,
    fetchForNewFace: function () {
      return fetchOneFaceSet(null);
    }
  };
})();
