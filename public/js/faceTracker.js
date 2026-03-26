/**
 * faceTracker.js
 * Uses MediaPipe Face Mesh (468 landmarks) for real-time face tracking.
 * Each face part is positioned directly from landmark coordinates.
 */

const FaceTracker = (function () {
  // MediaPipe landmark indices for each face part.
  // Landmarks are used ONLY for centering. Sizes are fixed proportions of eyeDist.
  // offsetX/offsetY push the center in video space (before mirror) by N * eyeDist.
  const FACE_PARTS = {
    leftEye: {
      indices: [33, 7, 163, 144, 145, 153, 154, 155, 133, 157, 158, 159, 160, 161, 246],
      widthFactor: 0.8, heightFactor: 0.5
    },
    rightEye: {
      indices: [362, 382, 381, 380, 374, 373, 390, 249, 263, 384, 385, 386, 387, 388, 466],
      widthFactor: 0.8, heightFactor: 0.5
    },
    nose: {
      indices: [1, 2, 4, 5, 19, 94, 195, 197, 248],
      widthFactor: 0.55, heightFactor: 0.65
    },
    mouth: {
      indices: [0, 13, 14, 17, 61, 78, 80, 81, 82, 87, 88, 91,
               267, 269, 270, 291, 308, 310, 311, 312, 317, 318, 321, 375, 402, 405],
      widthFactor: 0.9, heightFactor: 0.4
    },
    chin: {
      indices: [152, 149, 176, 148, 377, 400, 378],
      widthFactor: 0.9, heightFactor: 0.35
    },
    leftEar: {
      indices: [234, 127, 162, 21],
      widthFactor: 0.35, heightFactor: 0.55,
      offsetX: -0.15
    },
    rightEar: {
      indices: [454, 356, 389, 251],
      widthFactor: 0.35, heightFactor: 0.55,
      offsetX: 0.15
    },
    leftForehead: {
      indices: [71, 68, 104, 69, 108, 151, 10, 338, 109],
      widthFactor: 0.8, heightFactor: 0.35
    },
    rightForehead: {
      indices: [301, 298, 333, 299, 337, 151, 10, 109, 338],
      widthFactor: 0.8, heightFactor: 0.35
    }
  };

  let faceLandmarker = null;
  let videoEl = null;
  let onTrackCallback = null;
  let _isReady = false;
  let animFrameId = null;

  function computePartPositions(landmarks, vw, vh) {
    const positions = {};

    // Compute reference measurements first
    const leftEyeOuter = landmarks[33];
    const rightEyeOuter = landmarks[263];
    const eyeDist = Math.hypot(
      (rightEyeOuter.x - leftEyeOuter.x) * vw,
      (rightEyeOuter.y - leftEyeOuter.y) * vh
    );
    const faceRoll = Math.atan2(
      (rightEyeOuter.y - leftEyeOuter.y) * vh,
      (rightEyeOuter.x - leftEyeOuter.x) * vw
    );

    // For each part: centroid from landmarks, size from eyeDist factors
    for (const [name, part] of Object.entries(FACE_PARTS)) {
      let sumX = 0, sumY = 0;

      for (const idx of part.indices) {
        const lm = landmarks[idx];
        sumX += lm.x * vw;
        sumY += lm.y * vh;
      }

      const count = part.indices.length;

      positions[name] = {
        x: sumX / count + (part.offsetX || 0) * eyeDist,
        y: sumY / count + (part.offsetY || 0) * eyeDist,
        width: eyeDist * part.widthFactor,
        height: eyeDist * part.heightFactor,
        rz: faceRoll
      };
    }

    // Compute face center and scale for zoom
    let faceSumX = 0, faceSumY = 0;
    for (const lm of landmarks) {
      faceSumX += lm.x * vw;
      faceSumY += lm.y * vh;
    }

    positions._face = {
      centerX: faceSumX / landmarks.length,
      centerY: faceSumY / landmarks.length,
      scale: eyeDist / vw * 2.5
    };

    return positions;
  }

  function detectLoop() {
    if (!faceLandmarker || !videoEl || videoEl.readyState < 2) {
      animFrameId = requestAnimationFrame(detectLoop);
      return;
    }

    const results = faceLandmarker.detectForVideo(videoEl, performance.now());

    if (results.faceLandmarks && results.faceLandmarks.length > 0) {
      const vw = videoEl.videoWidth;
      const vh = videoEl.videoHeight;
      const positions = computePartPositions(results.faceLandmarks[0], vw, vh);
      if (onTrackCallback) onTrackCallback(positions);
    } else {
      if (onTrackCallback) onTrackCallback(null);
    }

    animFrameId = requestAnimationFrame(detectLoop);
  }

  return {
    async init(video, onTrack) {
      videoEl = video;
      onTrackCallback = onTrack;

      const { FaceLandmarker, FilesetResolver } = await import(
        'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/vision_bundle.mjs'
      );

      const vision = await FilesetResolver.forVisionTasks(
        'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm'
      );

      faceLandmarker = await FaceLandmarker.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath:
            'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task',
          delegate: 'GPU'
        },
        runningMode: 'VIDEO',
        numFaces: 1
      });

      _isReady = true;
      console.log('MediaPipe Face Mesh ready');

      // Start detection loop
      detectLoop();
    },

    isReady() {
      return _isReady;
    },

    stop() {
      if (animFrameId) cancelAnimationFrame(animFrameId);
    }
  };
})();
