/**
 * overlayManager.js
 * Creates and positions browser-window overlays for each face part.
 * With MediaPipe, positions come directly from landmark coordinates.
 */

const OverlayManager = (function () {
  const container = () => document.getElementById('overlay-container');
  const elements = {}; // name -> DOM element
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

  // Reference to the video element for coordinate mapping
  let videoEl = null;

  // Smoothing state for each part
  const smoothState = {};
  const SMOOTH_FACTOR = 0.5; // 0 = no smoothing, 1 = frozen

  function createWindowElement(name, imageUrl, title) {
    const win = document.createElement('div');
    win.className = 'browser-window';
    win.id = 'part-' + name;

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
    win.style.zIndex = (DEPTH_ORDER[name] || 0) + 1;
    container().appendChild(win);
    elements[name] = win;
    return win;
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  // Map coordinates from video space to display space
  // The video is mirrored and may be scaled to cover the viewport
  function videoToDisplay(vx, vy, vw, vh) {
    const displayEl = videoEl;
    const dw = displayEl.clientWidth;
    const dh = displayEl.clientHeight;

    // Video covers the display area (object-fit: cover)
    const videoAspect = vw / vh;
    const displayAspect = dw / dh;

    let scale, offsetX, offsetY;
    if (videoAspect > displayAspect) {
      // Video is wider — height fits, width is cropped
      scale = dh / vh;
      offsetX = (dw - vw * scale) / 2;
      offsetY = 0;
    } else {
      // Video is taller — width fits, height is cropped
      scale = dw / vw;
      offsetX = 0;
      offsetY = (dh - vh * scale) / 2;
    }

    // Mirror X (video is displayed with scaleX(-1))
    const mirroredX = vw - vx;

    return {
      x: mirroredX * scale + offsetX,
      y: vy * scale + offsetY,
      scale: scale
    };
  }

  function updatePositions(positions) {
    if (!positions || !videoEl) {
      for (const el of Object.values(elements)) {
        el.style.display = 'none';
      }
      return;
    }

    const vw = videoEl.videoWidth;
    const vh = videoEl.videoHeight;
    if (!vw || !vh) return;

    for (const [name, pos] of Object.entries(positions)) {
      const el = elements[name];
      if (!el || name === '_face') continue;

      el.style.display = 'block';

      // Map from video coords to display coords
      const center = videoToDisplay(pos.x, pos.y, vw, vh);
      const sizeScale = center.scale;

      const width = pos.width * sizeScale;
      const height = pos.height * sizeScale;
      const totalHeight = height + TITLE_BAR_HEIGHT;

      const left = center.x - width / 2;
      const top = center.y - totalHeight / 2;
      const rzDeg = (-pos.rz * 180 / Math.PI);

      // Smooth positions to reduce jitter
      if (!smoothState[name]) {
        smoothState[name] = { left, top, width, totalHeight, rzDeg };
      } else {
        const s = smoothState[name];
        s.left = s.left * SMOOTH_FACTOR + left * (1 - SMOOTH_FACTOR);
        s.top = s.top * SMOOTH_FACTOR + top * (1 - SMOOTH_FACTOR);
        s.width = s.width * SMOOTH_FACTOR + width * (1 - SMOOTH_FACTOR);
        s.totalHeight = s.totalHeight * SMOOTH_FACTOR + totalHeight * (1 - SMOOTH_FACTOR);
        s.rzDeg = s.rzDeg * SMOOTH_FACTOR + rzDeg * (1 - SMOOTH_FACTOR);
      }

      const s = smoothState[name];

      el.style.width = s.width + 'px';
      el.style.height = s.totalHeight + 'px';

      const contentEl = el.querySelector('.window-content');
      if (contentEl) {
        contentEl.style.height = (s.totalHeight - TITLE_BAR_HEIGHT) + 'px';
      }

      // Translate to center, rotate around center, then offset back
      const cx = s.left + s.width / 2;
      const cy = s.top + s.totalHeight / 2;
      el.style.transform =
        `translate(${cx}px, ${cy}px) rotate(${s.rzDeg}deg) translate(${-s.width / 2}px, ${-s.totalHeight / 2}px)`;
    }
  }

  return {
    init(images, video) {
      videoEl = video;
      const c = container();
      c.innerHTML = '';

      for (const [name, img] of Object.entries(images)) {
        createWindowElement(name, img.url, img.title);
      }
    },

    update: updatePositions
  };
})();
