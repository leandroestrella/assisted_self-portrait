/**
 * imageCropper.js
 * Detects face landmarks in portrait photos and crops specific face regions.
 * Uses face-api.js (SSD MobilenetV1 + 68-point landmarks).
 */

const ImageCropper = (function () {
  let modelsLoaded = false;

  const MAX_IMG_WIDTH = 800; // Downscale large images for performance

  // Crop region definitions.
  // Each returns { x, y, w, h } in image pixel coordinates.
  const CROP_REGIONS = {
    leftEye(landmarks, box) {
      // Landmarks 36-41 = subject's right eye (appears LEFT in image)
      return regionFromLandmarks(landmarks, [36,37,38,39,40,41, 17,18,19,20,21], 0.5);
    },

    rightEye(landmarks, box) {
      // Landmarks 42-47 = subject's left eye (appears RIGHT in image)
      return regionFromLandmarks(landmarks, [42,43,44,45,46,47, 22,23,24,25,26], 0.5);
    },

    nose(landmarks, box) {
      return regionFromLandmarks(landmarks, [27,28,29,30,31,32,33,34,35], 0.4);
    },

    mouth(landmarks, box) {
      return regionFromLandmarks(landmarks, [48,49,50,51,52,53,54,55,56,57,58,59,60,61,62,63,64,65,66,67], 0.4);
    },

    chin(landmarks, box) {
      // Jawline bottom (landmarks 5-11) + extend downward
      const region = regionFromLandmarks(landmarks, [5,6,7,8,9,10,11], 0.3);
      // Extend bottom to include chin below landmarks
      const extend = region.h * 0.6;
      region.h += extend;
      return region;
    },

    leftEar(landmarks, box) {
      // No ear landmarks — crop region to the LEFT of the face box
      const earWidth = box.width * 0.35;
      const earHeight = box.height * 0.45;
      return {
        x: box.x - earWidth * 0.8,
        y: box.y + box.height * 0.15,
        w: earWidth,
        h: earHeight
      };
    },

    rightEar(landmarks, box) {
      // Region to the RIGHT of the face box
      const earWidth = box.width * 0.35;
      const earHeight = box.height * 0.45;
      return {
        x: box.x + box.width - earWidth * 0.2,
        y: box.y + box.height * 0.15,
        w: earWidth,
        h: earHeight
      };
    },

    leftForehead(landmarks, box) {
      // Above left eyebrow (17-21), up to top of face box
      const browRegion = regionFromLandmarks(landmarks, [17,18,19,20,21], 0.2);
      return {
        x: browRegion.x - browRegion.w * 0.15,
        y: box.y,
        w: browRegion.w * 1.3,
        h: browRegion.y - box.y + browRegion.h * 0.3
      };
    },

    rightForehead(landmarks, box) {
      // Above right eyebrow (22-26), up to top of face box
      const browRegion = regionFromLandmarks(landmarks, [22,23,24,25,26], 0.2);
      return {
        x: browRegion.x - browRegion.w * 0.15,
        y: box.y,
        w: browRegion.w * 1.3,
        h: browRegion.y - box.y + browRegion.h * 0.3
      };
    }
  };

  // Compute bounding box around specific landmark indices, with padding
  function regionFromLandmarks(landmarks, indices, padding) {
    const points = landmarks.positions;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

    for (const i of indices) {
      const p = points[i];
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }

    const w = maxX - minX;
    const h = maxY - minY;
    const padX = w * padding;
    const padY = h * padding;

    return {
      x: minX - padX,
      y: minY - padY,
      w: w + padX * 2,
      h: h + padY * 2
    };
  }

  // Load image, optionally downscale
  function loadImage(url) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('Image load failed'));
      img.src = url;
    });
  }

  // Downscale an image if needed, return canvas
  function prepareImage(img) {
    const canvas = document.createElement('canvas');
    const scale = img.width > MAX_IMG_WIDTH ? MAX_IMG_WIDTH / img.width : 1;
    canvas.width = Math.round(img.width * scale);
    canvas.height = Math.round(img.height * scale);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas;
  }

  // Crop a region from the source image and return as data URL
  function cropRegion(sourceCanvas, region) {
    // Clamp to image bounds
    const x = Math.max(0, Math.round(region.x));
    const y = Math.max(0, Math.round(region.y));
    const w = Math.min(Math.round(region.w), sourceCanvas.width - x);
    const h = Math.min(Math.round(region.h), sourceCanvas.height - y);

    if (w <= 0 || h <= 0) return null;

    const cropCanvas = document.createElement('canvas');
    cropCanvas.width = w;
    cropCanvas.height = h;
    const ctx = cropCanvas.getContext('2d');
    ctx.drawImage(sourceCanvas, x, y, w, h, 0, 0, w, h);
    return cropCanvas.toDataURL('image/jpeg', 0.85);
  }

  return {
    async init() {
      await faceapi.nets.ssdMobilenetv1.loadFromUri('/models');
      await faceapi.nets.faceLandmark68Net.loadFromUri('/models');
      modelsLoaded = true;
      console.log('Image cropper models loaded');
    },

    /**
     * Load a portrait image, detect face, crop a specific part.
     * @param {string} imageUrl - URL of the portrait photo
     * @param {string} partName - e.g. 'leftEye', 'nose', 'rightEar'
     * @returns {Promise<{dataUrl: string, title: string}|null>} cropped image or null if failed
     */
    async cropPart(imageUrl, partName) {
      if (!modelsLoaded) return null;

      const cropFn = CROP_REGIONS[partName];
      if (!cropFn) return null;

      try {
        const img = await loadImage(imageUrl);
        const sourceCanvas = prepareImage(img);

        const detections = await faceapi
          .detectAllFaces(sourceCanvas)
          .withFaceLandmarks();

        if (detections.length === 0) return null;

        const detection = detections[0];
        const region = cropFn(detection.landmarks, detection.detection.box);
        const dataUrl = cropRegion(sourceCanvas, region);

        return dataUrl ? { dataUrl } : null;
      } catch (err) {
        console.warn('Crop failed for', partName, err.message);
        return null;
      }
    },

    isReady() {
      return modelsLoaded;
    }
  };
})();
