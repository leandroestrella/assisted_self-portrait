/**
 * app.js
 * Main orchestration: start webcam, init face tracker with default images,
 * then swap in searched images when they're ready.
 */

(function () {
  const arView = document.getElementById('ar-view');
  const video = document.getElementById('webcam');
  const zoomWrapper = document.getElementById('zoom-wrapper');
  const emojiLoader = document.getElementById('emoji-loader');

  // Bundled face-part images for instant display before search results load
  const DEFAULT_IMAGES = {
    leftEye:       { url: 'img/eye-lx.png',      title: 'assisted_self-portrait' },
    rightEye:      { url: 'img/eye-rx.png',       title: 'assisted_self-portrait' },
    nose:          { url: 'img/nose.png',          title: 'assisted_self-portrait' },
    mouth:         { url: 'img/mouth.png',         title: 'assisted_self-portrait' },
    chin:          { url: 'img/chin.png',          title: 'assisted_self-portrait' },
    leftEar:       { url: 'img/ear-lx.png',        title: 'assisted_self-portrait' },
    rightEar:      { url: 'img/ear-rx.png',        title: 'assisted_self-portrait' },
    leftForehead:  { url: 'img/forehead-lx.png',   title: 'assisted_self-portrait' },
    rightForehead: { url: 'img/forehead-rx.png',    title: 'assisted_self-portrait' },
  };

  const TARGET_FACE_RATIO = 0.28;
  const MAX_ZOOM = 1.8;
  const MIN_ZOOM = 1.0;
  const ZOOM_SMOOTH = 0.92;
  let currentZoom = 1.0;
  let currentTx = 0;
  let currentTy = 0;

  // Track which face indices are loading images to avoid duplicate fetches
  const loadingFaces = new Set();

  async function startWebcam() {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: false
    });
    video.srcObject = stream;
    await video.play();
  }

  const MAX_LOAD_RETRIES = 3;

  // Runs in background — loads AI models + searches for real portrait images
  async function loadAndSwapImages(attempt) {
    attempt = attempt || 1;

    try {
      await ImageCropper.init();
    } catch (err) {
      console.warn('Cropper init failed:', err);
    }

    try {
      const images = await ImageSearch.fetchAll(null);
      // Swap images in-place to preserve window positions and smooth state
      OverlayManager.updateImages(0, images);
    } catch (err) {
      console.error('Image loading error:', err);
      if (attempt < MAX_LOAD_RETRIES) {
        await new Promise((r) => setTimeout(r, 2000));
        return loadAndSwapImages(attempt + 1);
      }
      // On failure, keep the default images — filter still works
    }

    // Hide loader regardless of success or failure
    if (emojiLoader) {
      emojiLoader.style.opacity = '0';
      setTimeout(function () { emojiLoader.style.display = 'none'; }, 300);
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

  function onFacesDetected(facesArray) {
    if (!facesArray || facesArray.length === 0) {
      OverlayManager.update(null);
      return;
    }

    // Zoom follows the first face
    if (facesArray[0] && facesArray[0]._face) {
      updateZoom(facesArray[0]._face);
    }

    // Spawn image loading for newly detected faces
    for (let i = 1; i < facesArray.length; i++) {
      if (!OverlayManager.hasFaceSet(i) && !loadingFaces.has(i)) {
        loadingFaces.add(i);
        const faceIndex = i;
        ImageSearch.fetchForNewFace().then(function (images) {
          OverlayManager.addFaceSet(faceIndex, images);
          loadingFaces.delete(faceIndex);
        }).catch(function (err) {
          console.warn('Failed to load images for face ' + faceIndex, err);
          loadingFaces.delete(faceIndex);
        });
      }
    }

    OverlayManager.update(facesArray);
  }

  async function boot() {
    arView.style.display = 'block';

    try {
      await startWebcam();
    } catch (err) {
      console.error('Webcam failed:', err);
      alert('Could not start camera. Please allow camera access and reload.');
      return;
    }

    // Start immediately with bundled default images
    OverlayManager.init(DEFAULT_IMAGES, video);

    try {
      await FaceTracker.init(video, onFacesDetected);
    } catch (err) {
      console.error('Face tracker init failed:', err);
    }

    // Search for real images in the background — swaps them in when ready
    loadAndSwapImages();
  }

  boot();
})();
