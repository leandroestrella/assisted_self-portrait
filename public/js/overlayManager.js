/**
 * overlayManager.js
 * Creates and positions browser-window overlays for each face part.
 * Supports multiple faces — each face gets its own set of overlay elements.
 */

const OverlayManager = (function () {
  const container = () => document.getElementById('overlay-container');
  const TITLE_BAR_HEIGHT = 20;

  // Fixed depth order: farthest (lowest z) to closest (highest z)
  const DEPTH_ORDER = {
    leftEar: 0,
    rightEar: 0,
    chin: 1,
    leftForehead: 2,
    rightForehead: 2,
    mouth: 3,
    nose: 4,
    leftEye: 5,
    rightEye: 5
  };

  let videoEl = null;
  const SMOOTH_FACTOR = 0.5;

  // Each face set: { elements: {name→DOM}, smoothState: {name→state}, images: {...} }
  const faceSets = [];

  function createWindowElement(name, imageUrl, title, faceIndex) {
    const win = document.createElement('div');
    win.className = 'browser-window';
    win.id = 'part-' + faceIndex + '-' + name;

    win.innerHTML = `
      <div class="title-bar">
        <span class="window-buttons"><span></span><span></span><span></span></span>
        <span class="title-text">${escapeHtml(title)}</span>
      </div>
      <div class="window-content">
        <img src="${escapeHtml(imageUrl)}" alt="${escapeHtml(name)}" crossorigin="anonymous">
      </div>
    `;

    win.style.display = 'none';
    win.style.zIndex = (DEPTH_ORDER[name] || 0) + 1 + faceIndex * 10;
    container().appendChild(win);
    return win;
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  function createFaceSet(faceIndex, images) {
    const elements = {};
    for (const [name, img] of Object.entries(images)) {
      elements[name] = createWindowElement(name, img.url, img.title, faceIndex);
    }
    const set = { elements: elements, smoothState: {}, images: images };
    faceSets[faceIndex] = set;
    return set;
  }

  // Map coordinates from video space to display space
  function videoToDisplay(vx, vy, vw, vh) {
    const dw = videoEl.clientWidth;
    const dh = videoEl.clientHeight;

    const videoAspect = vw / vh;
    const displayAspect = dw / dh;

    let scale, offsetX, offsetY;
    if (videoAspect > displayAspect) {
      scale = dh / vh;
      offsetX = (dw - vw * scale) / 2;
      offsetY = 0;
    } else {
      scale = dw / vw;
      offsetX = 0;
      offsetY = (dh - vh * scale) / 2;
    }

    const mirroredX = vw - vx;

    return {
      x: mirroredX * scale + offsetX,
      y: vy * scale + offsetY,
      scale: scale
    };
  }

  function updateFaceSet(set, positions) {
    if (!positions || !videoEl) {
      for (const el of Object.values(set.elements)) {
        el.style.display = 'none';
      }
      return;
    }

    const vw = videoEl.videoWidth;
    const vh = videoEl.videoHeight;
    if (!vw || !vh) return;

    for (const [name, pos] of Object.entries(positions)) {
      const el = set.elements[name];
      if (!el || name === '_face') continue;

      el.style.display = 'block';

      const center = videoToDisplay(pos.x, pos.y, vw, vh);
      const sizeScale = center.scale;

      const width = pos.width * sizeScale;
      const height = pos.height * sizeScale;
      const totalHeight = height + TITLE_BAR_HEIGHT;

      const left = center.x - width / 2;
      const top = center.y - totalHeight / 2;
      const rzDeg = (-pos.rz * 180 / Math.PI);

      if (!set.smoothState[name]) {
        set.smoothState[name] = { left, top, width, totalHeight, rzDeg };
      } else {
        const s = set.smoothState[name];
        s.left = s.left * SMOOTH_FACTOR + left * (1 - SMOOTH_FACTOR);
        s.top = s.top * SMOOTH_FACTOR + top * (1 - SMOOTH_FACTOR);
        s.width = s.width * SMOOTH_FACTOR + width * (1 - SMOOTH_FACTOR);
        s.totalHeight = s.totalHeight * SMOOTH_FACTOR + totalHeight * (1 - SMOOTH_FACTOR);
        s.rzDeg = s.rzDeg * SMOOTH_FACTOR + rzDeg * (1 - SMOOTH_FACTOR);
      }

      const s = set.smoothState[name];

      el.style.width = s.width + 'px';
      el.style.height = s.totalHeight + 'px';

      const contentEl = el.querySelector('.window-content');
      if (contentEl) {
        contentEl.style.height = (s.totalHeight - TITLE_BAR_HEIGHT) + 'px';
      }

      const cx = s.left + s.width / 2;
      const cy = s.top + s.totalHeight / 2;
      el.style.transform =
        `translate(${cx}px, ${cy}px) rotate(${s.rzDeg}deg) translate(${-s.width / 2}px, ${-s.totalHeight / 2}px)`;
    }
  }

  function removeFaceSet(faceIndex) {
    const set = faceSets[faceIndex];
    if (!set) return;
    for (const el of Object.values(set.elements)) {
      if (el.parentNode) el.parentNode.removeChild(el);
    }
    faceSets[faceIndex] = null;
  }

  return {
    init(images, video) {
      videoEl = video;
      const c = container();
      c.innerHTML = '';
      faceSets.length = 0;
      createFaceSet(0, images);
    },

    // facesArray: array of position objects, one per detected face, or null
    update(facesArray) {
      if (!facesArray) {
        // Hide all face sets
        for (const set of faceSets) {
          if (set) updateFaceSet(set, null);
        }
        return;
      }

      for (let i = 0; i < facesArray.length; i++) {
        if (faceSets[i]) {
          updateFaceSet(faceSets[i], facesArray[i]);
        }
        // If no face set exists for this index, app.js will handle loading images
      }

      // Hide face sets beyond the detected count
      for (let i = facesArray.length; i < faceSets.length; i++) {
        if (faceSets[i]) updateFaceSet(faceSets[i], null);
      }
    },

    addFaceSet(faceIndex, images) {
      if (faceSets[faceIndex]) removeFaceSet(faceIndex);
      createFaceSet(faceIndex, images);
    },

    hasFaceSet(faceIndex) {
      return !!faceSets[faceIndex];
    }
  };
})();
