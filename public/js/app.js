/**
 * app.js
 * Main orchestration: start webcam, load images, init face tracker, wire up overlays.
 */

(function () {
  const loadingScreen = document.getElementById('loading-screen');
  const loadingStatus = document.getElementById('loading-status');
  const loadingBarFill = document.getElementById('loading-bar-fill');
  const arView = document.getElementById('ar-view');
  const video = document.getElementById('webcam');
  const zoomWrapper = document.getElementById('zoom-wrapper');

  let loadedImages = null;

  const TARGET_FACE_RATIO = 0.28;
  const MAX_ZOOM = 1.8;
  const MIN_ZOOM = 1.0;
  const ZOOM_SMOOTH = 0.92;
  let currentZoom = 1.0;
  let currentTx = 0;
  let currentTy = 0;

  async function startWebcam() {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: false
    });
    video.srcObject = stream;
    await video.play();
  }

  const MAX_LOAD_RETRIES = 3;

  async function loadModelsAndImages(attempt) {
    attempt = attempt || 1;
    loadingStatus.textContent = 'Loading AI models...';
    loadingBarFill.style.width = '0%';

    try {
      await ImageCropper.init();
      loadingBarFill.style.width = '10%';
    } catch (err) {
      console.warn('Cropper init failed:', err);
    }

    loadingStatus.textContent = 'Searching for images...';

    try {
      loadedImages = await ImageSearch.fetchAll((loaded, total) => {
        const pct = 10 + Math.round((loaded / total) * 90);
        loadingBarFill.style.width = pct + '%';
        loadingStatus.textContent = `Loading images... (${loaded}/${total})`;
      });

      loadingBarFill.style.width = '100%';
      loadingStatus.textContent = 'Starting camera...';
    } catch (err) {
      console.error('Image loading error:', err);
      if (attempt >= MAX_LOAD_RETRIES) {
        loadingStatus.textContent = 'Failed to load images. Please reload.';
        return;
      }
      loadingStatus.textContent = `Error loading images. Retrying (${attempt}/${MAX_LOAD_RETRIES})...`;
      await new Promise((r) => setTimeout(r, 2000));
      return loadModelsAndImages(attempt + 1);
    }
  }

  function updateZoom(faceData) {
    if (!faceData) return;

    const vw = video.clientWidth;
    const vh = video.clientHeight;

    // Same object-fit:cover mapping as overlayManager.videoToDisplay,
    // kept inline here to avoid coupling zoom logic to the overlay module
    const videoAspect = video.videoWidth / video.videoHeight;
    const displayAspect = vw / vh;
    let scale;
    if (videoAspect > displayAspect) {
      scale = vh / video.videoHeight;
    } else {
      scale = vw / video.videoWidth;
    }

    const displayCx = (video.videoWidth - faceData.centerX) * scale +
      (vw - video.videoWidth * scale) / 2;
    const displayCy = faceData.centerY * scale +
      (vh - video.videoHeight * scale) / 2;

    const faceCxNorm = displayCx / vw;
    const faceCyNorm = displayCy / vh;

    const targetZoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM,
      TARGET_FACE_RATIO / faceData.scale
    ));

    currentZoom = currentZoom * ZOOM_SMOOTH + targetZoom * (1 - ZOOM_SMOOTH);

    const targetTx = -(faceCxNorm - 0.5) * vw * (currentZoom - 1);
    const targetTy = -(faceCyNorm - 0.5) * vh * (currentZoom - 1);

    currentTx = currentTx * ZOOM_SMOOTH + targetTx * (1 - ZOOM_SMOOTH);
    currentTy = currentTy * ZOOM_SMOOTH + targetTy * (1 - ZOOM_SMOOTH);

    zoomWrapper.style.transform =
      `translate(${currentTx}px, ${currentTy}px) scale(${currentZoom})`;
  }

  function hideLoader() {
    loadingScreen.style.opacity = '0';
    setTimeout(() => { loadingScreen.style.display = 'none'; }, 400);
  }

  async function boot() {
    arView.style.display = 'block';

    // Start webcam immediately (shows behind loader)
    try {
      await startWebcam();
    } catch (err) {
      console.error('Webcam failed:', err);
      alert('Could not start camera. Please allow camera access and reload.');
      return;
    }

    // Load models + images in parallel with webcam
    await loadModelsAndImages();

    // Init overlays
    OverlayManager.init(loadedImages, video);

    // Init face tracker (starts detection loop)
    try {
      await FaceTracker.init(video, function (positions) {
        if (positions && positions._face) {
          updateZoom(positions._face);
        }
        OverlayManager.update(positions);
      });
    } catch (err) {
      console.error('Face tracker init failed:', err);
    }

    hideLoader();
  }

  boot();
})();
