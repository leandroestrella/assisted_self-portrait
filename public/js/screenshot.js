/**
 * screenshot.js
 * Captures the AR view (video + overlay windows + "le" watermark) to a canvas
 * and saves/shares the result. Works on desktop and mobile browsers.
 */

const Screenshot = (function () {
  const TITLE_BAR_HEIGHT = 20;

  function getVideoCoverCrop(video, canvasW, canvasH) {
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    const videoAspect = vw / vh;
    const canvasAspect = canvasW / canvasH;

    let sx, sy, sw, sh;
    if (videoAspect > canvasAspect) {
      // video wider than canvas — crop sides
      sh = vh;
      sw = vh * canvasAspect;
      sx = (vw - sw) / 2;
      sy = 0;
    } else {
      // video taller than canvas — crop top/bottom
      sw = vw;
      sh = vw / canvasAspect;
      sx = 0;
      sy = (vh - sh) / 2;
    }
    return { sx, sy, sw, sh };
  }

  function parseTransform(el) {
    const t = el.style.transform || '';
    // Extract translate and rotate values from the inline transform string
    const translates = [];
    const rotateMatch = t.match(/rotate\(([^)]+)deg\)/);
    const rotateDeg = rotateMatch ? parseFloat(rotateMatch[1]) : 0;

    const translateRegex = /translate\(([^,]+),\s*([^)]+)\)/g;
    let m;
    while ((m = translateRegex.exec(t)) !== null) {
      translates.push({ x: parseFloat(m[1]), y: parseFloat(m[2]) });
    }

    return { translates, rotateDeg };
  }

  function drawTitleBar(ctx, x, y, w, h) {
    // Background gradient approximation
    ctx.fillStyle = '#ddd';
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = '#999';
    ctx.lineWidth = 1;
    ctx.strokeRect(x, y, w, h);

    // Traffic light dots
    const dotY = y + h / 2;
    const dotR = 3.5;
    const colors = ['#ff5f57', '#febc2e', '#28c840'];
    for (let i = 0; i < 3; i++) {
      ctx.beginPath();
      ctx.arc(x + 10 + i * 12, dotY, dotR, 0, Math.PI * 2);
      ctx.fillStyle = colors[i];
      ctx.fill();
    }
  }

  async function capture() {
    const video = document.getElementById('webcam');
    const arView = document.getElementById('ar-view');
    if (!video || !arView) return;

    const canvasW = arView.clientWidth;
    const canvasH = arView.clientHeight;
    const canvas = document.createElement('canvas');
    canvas.width = canvasW;
    canvas.height = canvasH;
    const ctx = canvas.getContext('2d');

    // Read zoom transform from the wrapper
    const zoomWrapper = document.getElementById('zoom-wrapper');
    const wrapperTransform = zoomWrapper.style.transform || '';
    let zoomTx = 0, zoomTy = 0, zoomScale = 1;
    const zoomMatch = wrapperTransform.match(
      /translate\(([^,]+),\s*([^)]+)\)\s*scale\(([^)]+)\)/
    );
    if (zoomMatch) {
      zoomTx = parseFloat(zoomMatch[1]);
      zoomTy = parseFloat(zoomMatch[2]);
      zoomScale = parseFloat(zoomMatch[3]);
    }

    // Apply zoom transform to canvas
    ctx.save();
    ctx.translate(zoomTx, zoomTy);
    ctx.scale(zoomScale, zoomScale);

    // Draw video frame (mirrored, object-fit:cover)
    const crop = getVideoCoverCrop(video, canvasW, canvasH);
    ctx.save();
    ctx.translate(canvasW, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(video, crop.sx, crop.sy, crop.sw, crop.sh, 0, 0, canvasW, canvasH);
    ctx.restore();

    // Draw each overlay window
    const windows = document.querySelectorAll('.browser-window');
    for (const win of windows) {
      if (win.style.display === 'none') continue;

      const w = parseFloat(win.style.width);
      const h = parseFloat(win.style.height);
      if (!w || !h) continue;

      const { translates, rotateDeg } = parseTransform(win);

      // Reconstruct the center-pivot transform:
      // translate(cx, cy) rotate(deg) translate(-w/2, -h/2)
      const cx = translates[0] ? translates[0].x : 0;
      const cy = translates[0] ? translates[0].y : 0;

      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(rotateDeg * Math.PI / 180);
      ctx.translate(-w / 2, -h / 2);

      drawTitleBar(ctx, 0, 0, w, TITLE_BAR_HEIGHT);

      // Title text
      const titleText = win.querySelector('.title-text');
      if (titleText) {
        ctx.fillStyle = '#555';
        ctx.font = '9px Roboto, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const maxTextW = w - 60;
        let text = titleText.textContent;
        if (ctx.measureText(text).width > maxTextW) {
          while (text.length > 3 && ctx.measureText(text + '...').width > maxTextW) {
            text = text.slice(0, -1);
          }
          text += '...';
        }
        ctx.fillText(text, w / 2, TITLE_BAR_HEIGHT / 2);
      }

      // Image content
      const img = win.querySelector('.window-content img');
      if (img && img.naturalWidth) {
        const contentH = h - TITLE_BAR_HEIGHT;
        // object-fit: cover for the image
        const imgAspect = img.naturalWidth / img.naturalHeight;
        const boxAspect = w / contentH;
        let drawSx, drawSy, drawSw, drawSh;
        if (imgAspect > boxAspect) {
          drawSh = img.naturalHeight;
          drawSw = img.naturalHeight * boxAspect;
          drawSx = (img.naturalWidth - drawSw) / 2;
          drawSy = 0;
        } else {
          drawSw = img.naturalWidth;
          drawSh = img.naturalWidth / boxAspect;
          drawSx = 0;
          drawSy = (img.naturalHeight - drawSh) / 2;
        }
        ctx.drawImage(img, drawSx, drawSy, drawSw, drawSh, 0, TITLE_BAR_HEIGHT, w, contentH);
      }

      // Border + rounded corners
      ctx.strokeStyle = '#999';
      ctx.lineWidth = 1;
      ctx.strokeRect(0, 0, w, h);

      ctx.restore();
    }

    ctx.restore(); // zoom transform

    // Draw "le" watermark (always in screen space, not zoomed)
    ctx.fillStyle = '#fff';
    ctx.font = '48px sans-serif';
    ctx.textBaseline = 'bottom';
    ctx.textAlign = 'left';
    ctx.fillText('le', 16, canvasH - 16);

    // Export
    const filename = generateFilename();
    canvas.toBlob(function (blob) {
      if (!blob) return;

      // Mobile: try Web Share API first
      if (navigator.share && navigator.canShare) {
        const file = new File([blob], filename, { type: 'image/png' });
        if (navigator.canShare({ files: [file] })) {
          navigator.share({ files: [file] }).catch(function () {
            downloadBlob(blob, filename);
          });
          return;
        }
      }

      downloadBlob(blob, filename);
    }, 'image/png');
  }

  function generateFilename() {
    const now = new Date();
    const ts = now.getFullYear().toString() +
      String(now.getMonth() + 1).padStart(2, '0') +
      String(now.getDate()).padStart(2, '0') +
      String(now.getHours()).padStart(2, '0') +
      String(now.getMinutes()).padStart(2, '0') +
      String(now.getSeconds()).padStart(2, '0');
    return 'assisted_self-portrait_' + ts + '.png';
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  return { capture: capture };
})();
