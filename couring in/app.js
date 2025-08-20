// ===== Canvas + SVG base =====
const DPR = Math.max(1, window.devicePixelRatio || 1);
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d', { willReadFrequently: true });
const hint = document.getElementById('hint');

// Size canvas backing store to match CSS size * DPR
function fitCanvas() {
  const cssW = canvas.clientWidth;
  const cssH = canvas.clientHeight;
  canvas.width = Math.round(cssW * DPR);
  canvas.height = Math.round(cssH * DPR);
}
fitCanvas();

// Load your SVG and draw it to the canvas
const birdImg = new Image();
let svgURL;

// Fetch the SVG file text and make a blob URL (works perfectly with Live Server)
fetch('Asset 1.svg')
  .then(r => r.text())
  .then(svgText => {
    const blob = new Blob([svgText], { type: 'image/svg+xml;charset=utf-8' });
    svgURL = URL.createObjectURL(blob);
    birdImg.onload = () => {
      drawBase();
      URL.revokeObjectURL(svgURL); // cleanup once drawn
    };
    birdImg.src = svgURL;
  })
  .catch(() => {
    hint.textContent = 'Open with a local server (e.g., VS Code “Live Server”) so the SVG can load.';
  });

function drawBase() {
  ctx.save();
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  // clear + white background
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  // draw the svg scaled to canvas
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(birdImg, 0, 0, canvas.width, canvas.height);
  ctx.restore();
}

// Handle resize
window.addEventListener('resize', () => { fitCanvas(); drawBase(); });

// ===== Palette =====
let currentColor = '#ff1f1f';
const swatches = Array.from(document.querySelectorAll('.swatch'));
swatches.forEach((s, i) => {
  if (i === 0) s.classList.add('active');
  s.addEventListener('click', () => {
    currentColor = getComputedStyle(s).getPropertyValue('--c').trim();
    swatches.forEach(x => x.classList.remove('active'));
    s.classList.add('active');
  });
});

// ===== History (Undo/Redo) =====
const undoStack = [];
const redoStack = [];
function snapshot() {
  undoStack.push(canvas.toDataURL());
  if (undoStack.length > 30) undoStack.shift();
  redoStack.length = 0;
}
document.getElementById('undoBtn').addEventListener('click', () => {
  if (!undoStack.length) return;
  const prev = undoStack.pop();
  redoStack.push(canvas.toDataURL());
  restore(prev);
});
document.getElementById('redoBtn').addEventListener('click', () => {
  if (!redoStack.length) return;
  const next = redoStack.pop();
  undoStack.push(canvas.toDataURL());
  restore(next);
});
function restore(url) {
  const im = new Image();
  im.onload = () => { ctx.setTransform(1,0,0,1,0,0); ctx.clearRect(0,0,canvas.width,canvas.height); ctx.drawImage(im,0,0); };
  im.src = url;
}
document.getElementById('resetBtn').addEventListener('click', () => { snapshot(); drawBase(); });

// Keyboard shortcuts
window.addEventListener('keydown', (e) => {
  const cmd = e.ctrlKey || e.metaKey;
  if (cmd && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) redoBtn.click(); else undoBtn.click(); }
  if (cmd && e.key.toLowerCase() === 'y') { e.preventDefault(); redoBtn.click(); }
});

// ===== Save PNG =====
document.getElementById('saveBtn').addEventListener('click', () => {
  const link = document.createElement('a');
  link.download = 'my-coloured-bird.png';
  link.href = canvas.toDataURL('image/png');
  link.click();
});

// ===== Flood Fill (paint bucket) =====
function hexToRgba(hex) {
  const v = hex.replace('#', '');
  const full = v.length === 3 ? v.split('').map(x => x + x).join('') : v;
  const n = parseInt(full, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 255];
}
function matchAt(data, idx, target, tol) {
  return Math.abs(data[idx]   - target[0]) <= tol &&
         Math.abs(data[idx+1] - target[1]) <= tol &&
         Math.abs(data[idx+2] - target[2]) <= tol &&
         Math.abs(data[idx+3] - target[3]) <= tol;
}
function setAt(data, idx, rgba) {
  data[idx] = rgba[0]; data[idx+1] = rgba[1]; data[idx+2] = rgba[2]; data[idx+3] = 255;
}

canvas.addEventListener('click', (e) => {
  // capture state for undo
  snapshot();

  // canvas coords in device pixels
  const rect = canvas.getBoundingClientRect();
  const x = Math.floor((e.clientX - rect.left) * DPR);
  const y = Math.floor((e.clientY - rect.top) * DPR);

  // read pixels
  const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = imgData.data, w = imgData.width, h = imgData.height;

  const startIdx = (y * w + x) * 4;
  const startColor = [data[startIdx], data[startIdx+1], data[startIdx+2], data[startIdx+3]];
  const fillCol = hexToRgba(currentColor);

  // Don’t fill outlines (treat very dark pixels as walls)
  const isWall = startColor[0] < 40 && startColor[1] < 40 && startColor[2] < 40;
  if (isWall) return;

  // If same colour, skip
  if (fillCol[0] === startColor[0] && fillCol[1] === startColor[1] && fillCol[2] === startColor[2] && startColor[3] === 255) {
    return;
  }

  // Tolerance helps with anti-aliasing fuzz near black lines
  const tol = 24;

  // Scanline flood fill
  const stack = [[x, y]];
  const visited = new Uint8Array(w * h);

  while (stack.length) {
    const [cx, cy] = stack.pop();
    let sx = cx;
    // move left until boundary
    while (sx >= 0) {
      const i = (cy * w + sx) * 4;
      if (!matchAt(data, i, startColor, tol)) break;
      sx--;
    }
    sx++;
    let spanUp = false, spanDown = false;
    while (sx < w) {
      const i = (cy * w + sx) * 4;
      if (!matchAt(data, i, startColor, tol)) break;

      setAt(data, i, fillCol);
      visited[cy * w + sx] = 1;

      // up
      if (cy > 0) {
        const iu = ((cy - 1) * w + sx) * 4;
        if (!visited[(cy - 1) * w + sx] && matchAt(data, iu, startColor, tol)) {
          if (!spanUp) { stack.push([sx, cy - 1]); spanUp = true; }
        } else if (spanUp) { spanUp = false; }
      }
      // down
      if (cy < h - 1) {
        const id = ((cy + 1) * w + sx) * 4;
        if (!visited[(cy + 1) * w + sx] && matchAt(data, id, startColor, tol)) {
          if (!spanDown) { stack.push([sx, cy + 1]); spanDown = true; }
        } else if (spanDown) { spanDown = false; }
      }

      sx++;
    }
  }

  ctx.putImageData(imgData, 0, 0);
});
