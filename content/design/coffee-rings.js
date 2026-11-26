const canvas = document.getElementById('bench');
const ctx = canvas.getContext('2d');
const rings = [];
let mouse = null;

// Sharp on high-density screens: draw at the device's pixel ratio.
function resize() {
  const ratio = Math.min(devicePixelRatio || 1, 2);
  canvas.width = canvas.clientWidth * ratio;
  canvas.height = canvas.clientHeight * ratio;
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
}

const rand = (a, b) => a + Math.random() * (b - a);
const point = (e) => {
  const r = canvas.getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top };
};

canvas.addEventListener('pointermove', (e) => { mouse = point(e); });
canvas.addEventListener('pointerleave', () => { mouse = null; });
canvas.addEventListener('pointerdown', (e) => {
  const p = point(e);
  const R = rand(21, 27);
  // Random gap, size, squash, thickness and an occasional drip: no two rings look the same.
  rings.push({
    x: p.x, y: p.y + 14, R, alpha: rand(0.45, 0.6), rot: rand(0, Math.PI * 2),
    squash: rand(0.9, 1), thick: rand(2, 3.6), gap: rand(0, Math.PI * 2), gapLen: rand(0.15, 0.9),
    drip: Math.random() < 0.45 ? { x: rand(-R, R), y: R + rand(3, 9), r: rand(1.2, 2.6) } : null,
  });
  if (rings.length > 9) rings.shift();
});

function drawRing(r) {
  ctx.save();
  ctx.translate(r.x, r.y);
  ctx.rotate(r.rot);
  ctx.scale(1, r.squash);
  ctx.strokeStyle = `rgba(150, 104, 60, ${r.alpha})`;
  ctx.lineWidth = r.thick;
  ctx.beginPath();
  ctx.arc(0, 0, r.R, r.gap, r.gap + Math.PI * 2 - r.gapLen);
  ctx.stroke();
  if (r.drip) {
    ctx.fillStyle = `rgba(150, 104, 60, ${r.alpha * 0.8})`;
    ctx.beginPath();
    ctx.arc(r.drip.x, r.drip.y, r.drip.r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawMug(m, t) {
  ctx.fillStyle = '#ece6d8';
  ctx.fillRect(m.x - 18, m.y - 26, 36, 40);
  ctx.strokeStyle = '#ece6d8';
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.arc(m.x + 20, m.y - 6, 9, -1.4, 1.4);
  ctx.stroke();
  ctx.fillStyle = '#e8a33d';
  ctx.fillRect(m.x - 18, m.y - 14, 36, 6);
  ctx.strokeStyle = 'rgba(236, 230, 216, .25)';
  ctx.lineWidth = 1.2;
  for (let i = 0; i < 3; i++) { // steam
    const x = m.x - 8 + i * 8;
    ctx.beginPath();
    ctx.moveTo(x, m.y - 30);
    ctx.quadraticCurveTo(x + Math.sin(t * 2 + i) * 5, m.y - 42, x, m.y - 54);
    ctx.stroke();
  }
}

function frame(ms) {
  ctx.clearRect(0, 0, canvas.clientWidth, canvas.clientHeight);
  rings.forEach(drawRing);
  if (mouse) drawMug(mouse, ms / 1000);
  requestAnimationFrame(frame);
}

addEventListener('resize', resize);
resize();
requestAnimationFrame(frame);
