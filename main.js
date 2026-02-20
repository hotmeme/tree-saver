const canvas = document.getElementById('scene');
const ctx = canvas.getContext('2d', { alpha: false });

const ui = {
  intro: document.getElementById('intro'),
  start: document.getElementById('startExperience'),
  toggleRun: document.getElementById('toggleRun'),
  toggleAudio: document.getElementById('toggleAudio'),
  toggleFullscreen: document.getElementById('toggleFullscreen'),
  speed: document.getElementById('speed'),
  restart: document.getElementById('restart'),
};

const LOOP_MS = 5 * 60 * 1000;
let width = 0;
let height = 0;
let dpr = 1;

let running = true;
let started = false;
let speed = 1;
let startTime = performance.now();
let pausedAt = null;

let tree = null;
let petals = [];
let motes = [];
let sceneConfig = null;
let pondRipples = [];
let nextPondRippleAt = 0;

class SeededRandom {
  constructor(seed = 1) {
    this.seed = seed >>> 0;
  }

  next() {
    this.seed = (1664525 * this.seed + 1013904223) >>> 0;
    return this.seed / 4294967296;
  }

  range(min, max) {
    return min + (max - min) * this.next();
  }
}

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function quadPoint(p0, p1, p2, t) {
  const u = 1 - t;
  const tt = t * t;
  const uu = u * u;
  return {
    x: uu * p0.x + 2 * u * t * p1.x + tt * p2.x,
    y: uu * p0.y + 2 * u * t * p1.y + tt * p2.y,
  };
}

function easeOutCubic(t) {
  return 1 - (1 - t) ** 3;
}

function buildSceneConfig(seed) {
  const rng = new SeededRandom(seed);
  const stones = [
    { x: rng.range(0.72, 0.79), y: rng.range(0.75, 0.79), scale: rng.range(1.0, 1.16), rot: rng.range(-0.36, -0.22) },
    { x: rng.range(0.81, 0.88), y: rng.range(0.8, 0.84), scale: rng.range(0.78, 0.92), rot: rng.range(-0.16, -0.06) },
  ].map((stone) => ({
    ...stone,
    speckles: Array.from({ length: 10 }, () => ({
      x: rng.range(-0.62, 0.62),
      y: rng.range(-0.44, 0.44),
      r: rng.range(0.018, 0.05),
      tone: rng.next(),
    })),
  }));

  return {
    seed,
    treeBaseX: rng.range(0.46, 0.56),
    treeBaseY: rng.range(0.75, 0.81),
    trunkScale: rng.range(0.17, 0.22),
    maxDepth: Math.floor(rng.range(8.2, 11.2)),
    leafHueBase: rng.range(108, 134),
    leafHueSpan: rng.range(22, 36),
    pondX: rng.range(0.22, 0.36),
    pondY: rng.range(0.77, 0.85),
    pondW: rng.range(0.3, 0.43),
    pondH: rng.range(0.075, 0.12),
    skyShift: rng.range(-8, 12),
    toriiX: rng.range(0.09, 0.17),
    toriiScale: rng.range(0.95, 1.25),
    cloudPhase: rng.range(0, Math.PI * 2),
    stones,
  };
}

function resetPondRipples(nowSec = performance.now() * 0.001) {
  pondRipples = [];
  nextPondRippleAt = nowSec + 1.2 + Math.random() * 2.2;
}

function randomizeScene(seed = (Math.random() * 4294967295) >>> 0) {
  sceneConfig = buildSceneConfig(seed);
  tree = makeTree(seed ^ 0x9e3779b9);
  resetParticles(seed ^ 0xa341316c);
  resetPondRipples();
}

function makeTree(seed = 20260220) {
  const rng = new SeededRandom(seed);
  const baseX = width * sceneConfig.treeBaseX;
  const baseY = height * sceneConfig.treeBaseY;
  const trunkLength = Math.min(width, height) * sceneConfig.trunkScale;
  const maxDepth = sceneConfig.maxDepth;

  const branches = [];
  const leaves = [];
  const matureLeaves = [];

  function addLeafCluster(x, y, depthN, appearBase, density = 1) {
    const burst = Math.floor(rng.range(5, 11) * density);
    for (let i = 0; i < burst; i += 1) {
      leaves.push({
        x: x + rng.range(-12, 12),
        y: y + rng.range(-10, 10),
        appear: clamp(appearBase + rng.range(0.01, 0.13), 0.07, 0.9),
        size: rng.range(9, 21) * (1 - depthN * 0.17),
        tone: rng.next(),
        sway: rng.range(0.5, 1.7),
        blossom: rng.next() > 0.9,
        hue: sceneConfig.leafHueBase + rng.range(0, sceneConfig.leafHueSpan),
        sat: rng.range(45, 74),
        light: rng.range(30, 48),
      });
    }

    const matureBurst = Math.max(3, Math.floor(rng.range(4, 9) * density * 1.1));
    for (let i = 0; i < matureBurst; i += 1) {
      matureLeaves.push({
        x: x + rng.range(-16, 16),
        y: y + rng.range(-14, 14),
        delay: rng.range(0.0, 0.45),
        size: rng.range(8, 16) * (1 - depthN * 0.12),
        tone: rng.next(),
        sway: rng.range(0.5, 1.7),
        blossom: rng.next() > 0.93,
        hue: sceneConfig.leafHueBase + rng.range(0, sceneConfig.leafHueSpan),
        sat: rng.range(46, 74),
        light: rng.range(29, 47),
      });
    }
  }

  function spawnBranch(node) {
    branches.push(node);

    const depthN = node.depth / maxDepth;
    const isTerminal = node.depth >= maxDepth || node.length < rng.range(10, 16);

    if (isTerminal) {
      addLeafCluster(node.x2, node.y2, depthN, node.end + 0.005, 1.7);
      return;
    }

    if (node.depth >= 2 && node.depth <= maxDepth - 2 && rng.next() > 0.52) {
      addLeafCluster(node.x2, node.y2, depthN, node.end + 0.01, 0.9);
    }

    const childCount = node.depth < 2 ? 2 : node.depth < 5 ? (rng.next() > 0.12 ? 2 : 1) : (rng.next() > 0.42 ? 2 : 1);

    for (let i = 0; i < childCount; i += 1) {
      const sideBias = i === 0 ? -1 : 1;
      const spread = rng.range(0.25, 0.74) * sideBias;
      const randomTurn = rng.range(-0.24, 0.24);
      const nextAngle = node.angle + spread + randomTurn;
      const lenFactor = node.depth <= 2 ? rng.range(0.63, 0.79) : rng.range(0.56, 0.74);
      const nextLen = node.length * lenFactor;
      let x2 = node.x2 + Math.cos(nextAngle) * nextLen;
      let y2 = node.y2 + Math.sin(nextAngle) * nextLen;

      if (y2 < height * 0.12) {
        const corrected = height * 0.12;
        const compress = clamp((corrected - y2) / corrected, 0.15, 0.6);
        x2 = lerp(node.x2, x2, 1 - compress);
        y2 = corrected;
      }

      const midT = rng.range(0.32, 0.68);
      const mx = lerp(node.x2, x2, midT);
      const my = lerp(node.y2, y2, midT);
      const npx = -(y2 - node.y2);
      const npy = x2 - node.x2;
      const norm = Math.hypot(npx, npy) || 1;
      const curveAmount = rng.range(-12, 12) * (1 + node.depth * 0.16);

      const childStart = clamp(node.start + (node.end - node.start) * rng.range(0.34, 0.6), 0, 1);
      const childDuration = clamp(0.16 - node.depth * 0.011 + rng.range(-0.02, 0.02), 0.03, 0.22);
      const childEnd = clamp(childStart + childDuration, 0, 1);

      spawnBranch({
        x1: node.x2,
        y1: node.y2,
        x2,
        y2,
        cx: mx + (npx / norm) * curveAmount,
        cy: my + (npy / norm) * curveAmount,
        angle: nextAngle,
        length: nextLen,
        width: Math.max(0.68, node.width * rng.range(0.69, 0.83)),
        depth: node.depth + 1,
        start: childStart,
        end: childEnd,
      });
    }
  }

  const root = {
    x1: baseX,
    y1: baseY,
    x2: baseX,
    y2: baseY - trunkLength,
    cx: baseX - width * rng.range(0.015, 0.045),
    cy: baseY - trunkLength * 0.56,
    angle: -Math.PI / 2,
    length: trunkLength,
    width: Math.min(width, height) * 0.02,
    depth: 0,
    start: 0,
    end: 0.19,
  };

  spawnBranch(root);
  return { branches, leaves, matureLeaves, baseX, baseY };
}

function resetParticles(seed = 72211) {
  const rng = new SeededRandom(seed);
  petals = Array.from({ length: Math.floor(72 + width / 34) }, () => ({
    x: rng.range(0, width),
    y: rng.range(-height * 0.6, height),
    z: rng.range(0.3, 1.0),
    drift: rng.range(4, 14),
    sway: rng.range(0.3, 1.2),
    spin: rng.range(0, Math.PI * 2),
    size: rng.range(2.5, 7.5),
    hue: rng.next() > 0.5 ? '#f0c8c4' : '#e8d9cb',
  }));

  motes = Array.from({ length: Math.floor(70 + width / 45) }, () => ({
    x: rng.range(0, width),
    y: rng.range(0, height),
    r: rng.range(0.8, 2.6),
    speed: rng.range(0.08, 0.28),
    phase: rng.range(0, Math.PI * 2),
    cool: rng.next() > 0.58,
  }));
}

function resize() {
  dpr = Math.min(2, window.devicePixelRatio || 1);
  width = Math.floor(window.innerWidth);
  height = Math.floor(window.innerHeight);
  canvas.width = Math.floor(width * dpr);
  canvas.height = Math.floor(height * dpr);
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  randomizeScene();
}

function drawBackground(t) {
  const shift = sceneConfig.skyShift;

  const grd = ctx.createLinearGradient(0, 0, 0, height);
  grd.addColorStop(0, `hsl(${204 + shift * 0.12}, 34%, 86%)`);
  grd.addColorStop(0.52, `hsl(${46 + shift * 0.07}, 33%, 83%)`);
  grd.addColorStop(1, `hsl(${40 + shift * 0.05}, 30%, 72%)`);
  ctx.fillStyle = grd;
  ctx.fillRect(0, 0, width, height);

  const sunX = width * 0.82;
  const sunY = height * 0.2;
  const halo = ctx.createRadialGradient(sunX, sunY, 10, sunX, sunY, width * 0.4);
  halo.addColorStop(0, 'rgba(255, 243, 215, 0.62)');
  halo.addColorStop(1, 'rgba(255, 243, 215, 0)');
  ctx.fillStyle = halo;
  ctx.fillRect(0, 0, width, height);

  const cloudBaseY = height * 0.2;
  const cloudDrift = Math.sin(t * 0.018 + sceneConfig.cloudPhase) * width * 0.03;
  const clouds = [
    { x: width * 0.2 + cloudDrift, y: cloudBaseY, w: width * 0.18, h: height * 0.06, a: 0.08 },
    { x: width * 0.43 - cloudDrift * 0.6, y: cloudBaseY + height * 0.05, w: width * 0.2, h: height * 0.07, a: 0.06 },
    { x: width * 0.67 + cloudDrift * 0.4, y: cloudBaseY - height * 0.04, w: width * 0.16, h: height * 0.055, a: 0.07 },
  ];
  for (const c of clouds) {
    ctx.fillStyle = `rgba(246, 248, 249, ${c.a})`;
    ctx.beginPath();
    ctx.ellipse(c.x, c.y, c.w * 0.45, c.h * 0.5, 0.02, 0, Math.PI * 2);
    ctx.ellipse(c.x - c.w * 0.18, c.y + c.h * 0.1, c.w * 0.28, c.h * 0.4, -0.12, 0, Math.PI * 2);
    ctx.ellipse(c.x + c.w * 0.22, c.y + c.h * 0.04, c.w * 0.26, c.h * 0.36, 0.12, 0, Math.PI * 2);
    ctx.fill();
  }

  // Slow line-cloud motifs for a lightly stylized sky.
  ctx.lineCap = 'round';
  ctx.strokeStyle = 'rgba(243, 248, 251, 0.22)';
  ctx.lineWidth = Math.max(1.2, height * 0.0018);
  const motifDrift = (t * width * 0.0026) % (width * 1.4);
  for (const offset of [-width * 0.2, width * 0.42]) {
    const mx = (offset + motifDrift) % (width * 1.2) - width * 0.1;
    const my = height * 0.15 + Math.sin(t * 0.08 + offset * 0.001) * height * 0.015;
    ctx.beginPath();
    ctx.moveTo(mx - width * 0.06, my);
    ctx.bezierCurveTo(mx - width * 0.02, my - height * 0.02, mx + width * 0.04, my - height * 0.02, mx + width * 0.08, my);
    ctx.bezierCurveTo(mx + width * 0.12, my + height * 0.02, mx + width * 0.18, my + height * 0.02, mx + width * 0.22, my);
    ctx.stroke();
  }

  const gardenTop = height * 0.64;
  ctx.fillStyle = 'rgba(202, 183, 149, 0.74)';
  ctx.fillRect(0, gardenTop, width, height - gardenTop);

  ctx.strokeStyle = 'rgba(114, 93, 66, 0.23)';
  ctx.lineWidth = 1;
  const lineCount = Math.floor((height - gardenTop) / 8);
  for (let i = 0; i < lineCount; i += 1) {
    const y = gardenTop + i * 8;
    ctx.beginPath();
    for (let x = 0; x <= width; x += 14) {
      const ripple = Math.sin((x * 0.008) + i * 0.55 + t * 0.4) * 1.6;
      const pull = Math.sin((x * 0.003) + t * 0.13) * 0.8;
      if (x === 0) {
        ctx.moveTo(x, y + ripple + pull);
      } else {
        ctx.lineTo(x, y + ripple + pull);
      }
    }
    ctx.stroke();
  }

  const pondX = width * sceneConfig.pondX;
  const pondY = height * sceneConfig.pondY;
  const pondW = width * sceneConfig.pondW;
  const pondH = height * sceneConfig.pondH;

  if (t >= nextPondRippleAt) {
    pondRipples.push({
      x: pondX + (Math.random() * 2 - 1) * pondW * 0.24,
      y: pondY + (Math.random() * 2 - 1) * pondH * 0.2,
      start: t,
      duration: 2 + Math.random() * 2.3,
      maxRadius: Math.min(pondW, pondH) * (0.2 + Math.random() * 0.25),
    });
    if (Math.random() > 0.72) {
      pondRipples.push({
        x: pondX + (Math.random() * 2 - 1) * pondW * 0.18,
        y: pondY + (Math.random() * 2 - 1) * pondH * 0.16,
        start: t + 0.16,
        duration: 1.7 + Math.random() * 1.8,
        maxRadius: Math.min(pondW, pondH) * (0.16 + Math.random() * 0.18),
      });
    }
    nextPondRippleAt = t + 1.2 + Math.random() * 2.6;
  }

  ctx.save();
  ctx.beginPath();
  ctx.ellipse(pondX, pondY, pondW * 0.5, pondH * 0.5, -0.18, 0, Math.PI * 2);
  ctx.clip();

  const water = ctx.createLinearGradient(pondX, pondY - pondH, pondX, pondY + pondH);
  water.addColorStop(0, 'rgba(155, 198, 219, 0.9)');
  water.addColorStop(0.5, 'rgba(99, 162, 192, 0.84)');
  water.addColorStop(1, 'rgba(67, 126, 155, 0.86)');
  ctx.fillStyle = water;
  ctx.fillRect(pondX - pondW, pondY - pondH, pondW * 2, pondH * 2);

  ctx.fillStyle = 'rgba(220, 241, 248, 0.07)';
  ctx.fillRect(pondX - pondW, pondY - pondH * 0.08, pondW * 2, pondH * 0.36);

  const activeRipples = [];
  for (const ripple of pondRipples) {
    const age = (t - ripple.start) / ripple.duration;
    if (age < 0) {
      activeRipples.push(ripple);
      continue;
    }
    if (age > 1) {
      continue;
    }
    activeRipples.push(ripple);

    const radius = 3 + ripple.maxRadius * age;
    const alpha = (1 - age) * (1 - age) * 0.42;
    ctx.strokeStyle = `rgba(236, 249, 255, ${alpha})`;
    ctx.lineWidth = 1.8 - age * 0.8;
    ctx.beginPath();
    ctx.arc(ripple.x, ripple.y, radius, 0, Math.PI * 2);
    ctx.stroke();

    ctx.strokeStyle = `rgba(190, 225, 242, ${alpha * 0.6})`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(ripple.x, ripple.y, radius * 0.6, 0, Math.PI * 2);
    ctx.stroke();
  }
  pondRipples = activeRipples;
  ctx.restore();

  ctx.strokeStyle = 'rgba(88, 110, 108, 0.4)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.ellipse(pondX, pondY, pondW * 0.5, pondH * 0.5, -0.18, 0, Math.PI * 2);
  ctx.stroke();

  for (const stone of sceneConfig.stones) {
    const sx = width * stone.x;
    const sy = height * stone.y;
    const s = Math.min(width, height) * 0.075 * stone.scale;
    ctx.save();
    ctx.translate(sx, sy);
    ctx.rotate(stone.rot);

    ctx.fillStyle = 'rgba(52, 45, 39, 0.2)';
    ctx.beginPath();
    ctx.ellipse(0, s * 0.22, s * 0.84, s * 0.28, 0, 0, Math.PI * 2);
    ctx.fill();

    const g = ctx.createLinearGradient(-s, -s * 0.6, s, s * 0.6);
    g.addColorStop(0, 'rgba(150, 147, 139, 0.92)');
    g.addColorStop(0.45, 'rgba(124, 121, 113, 0.95)');
    g.addColorStop(1, 'rgba(93, 91, 84, 0.95)');
    ctx.fillStyle = g;

    ctx.beginPath();
    ctx.moveTo(-s * 0.9, -s * 0.02);
    ctx.bezierCurveTo(-s * 0.74, -s * 0.46, -s * 0.24, -s * 0.58, s * 0.24, -s * 0.45);
    ctx.bezierCurveTo(s * 0.76, -s * 0.28, s * 0.92, s * 0.06, s * 0.72, s * 0.28);
    ctx.bezierCurveTo(s * 0.38, s * 0.52, -s * 0.24, s * 0.58, -s * 0.72, s * 0.33);
    ctx.bezierCurveTo(-s * 0.9, s * 0.2, -s * 0.96, s * 0.06, -s * 0.9, -s * 0.02);
    ctx.closePath();
    ctx.fill();

    ctx.strokeStyle = 'rgba(73, 69, 63, 0.48)';
    ctx.lineWidth = 1.2;
    ctx.stroke();

    for (const speckle of stone.speckles) {
      const px = speckle.x * s;
      const py = speckle.y * s;
      const r = s * speckle.r;
      ctx.fillStyle = speckle.tone > 0.5 ? 'rgba(168, 164, 157, 0.35)' : 'rgba(88, 85, 79, 0.26)';
      ctx.beginPath();
      ctx.arc(px, py, r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  const horizonY = height * 0.64;
  ctx.strokeStyle = 'rgba(106, 94, 73, 0.24)';
  ctx.lineWidth = 1.35;
  ctx.beginPath();
  ctx.moveTo(0, horizonY);
  ctx.lineTo(width, horizonY);
  ctx.stroke();

  // Distant torii gate on the left.
  const tx = width * sceneConfig.toriiX;
  const ty = horizonY + height * 0.02;
  const ts = Math.min(width, height) * 0.12 * sceneConfig.toriiScale;
  const postW = ts * 0.12;
  const clearW = ts * 0.58;
  const gateW = clearW + postW * 2;
  const postH = ts * 0.9;
  const leftPostX = tx;
  const rightPostX = tx + postW + clearW;

  ctx.fillStyle = 'rgba(185, 52, 42, 0.42)';
  ctx.fillRect(leftPostX, ty - postH, postW, postH);
  ctx.fillRect(rightPostX, ty - postH, postW, postH);

  // Kasagi + shimaki (top lintels)
  ctx.fillRect(leftPostX - ts * 0.07, ty - postH - ts * 0.08, gateW + ts * 0.14, ts * 0.08);
  ctx.fillStyle = 'rgba(148, 41, 34, 0.35)';
  ctx.fillRect(leftPostX - ts * 0.02, ty - postH - ts * 0.16, gateW + ts * 0.04, ts * 0.06);

}

function drawPot() {
  const cx = tree.baseX;
  const w = Math.min(width * 0.22, 520);
  const h = Math.min(height * 0.1, 220);
  const y = tree.baseY - h * 0.08;

  const body = ctx.createLinearGradient(cx - w / 2, y, cx + w / 2, y + h);
  body.addColorStop(0, '#7c5f45');
  body.addColorStop(0.58, '#5a4638');
  body.addColorStop(1, '#8a6b50');

  ctx.fillStyle = body;
  ctx.beginPath();
  ctx.moveTo(cx - w * 0.52, y);
  ctx.lineTo(cx + w * 0.52, y);
  ctx.lineTo(cx + w * 0.42, y + h);
  ctx.lineTo(cx - w * 0.42, y + h);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = 'rgba(186, 209, 208, 0.2)';
  ctx.fillRect(cx - w * 0.46, y + h * 0.18, w * 0.92, h * 0.07);

  ctx.fillStyle = 'rgba(32, 24, 20, 0.34)';
  ctx.beginPath();
  ctx.ellipse(cx, y + h, w * 0.49, h * 0.14, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = 'rgba(65, 49, 36, 0.88)';
  ctx.beginPath();
  ctx.ellipse(cx, y + h * 0.08, w * 0.44, h * 0.12, 0, 0, Math.PI * 2);
  ctx.fill();

  // Root collar shadow so the trunk reads as planted into soil.
  ctx.fillStyle = 'rgba(38, 28, 20, 0.42)';
  ctx.beginPath();
  ctx.ellipse(cx, tree.baseY + h * 0.01, w * 0.075, h * 0.05, 0, 0, Math.PI * 2);
  ctx.fill();

  // Small hanko-style red seal on the pot.
  ctx.fillStyle = 'rgba(153, 39, 34, 0.45)';
  ctx.fillRect(cx + w * 0.21, y + h * 0.47, w * 0.07, h * 0.2);
}

function drawBranch(branch, p, t) {
  const local = clamp((p - branch.start) / (branch.end - branch.start || 1), 0, 1);
  if (local <= 0) {
    return;
  }

  const tGrow = easeOutCubic(local);
  const sway = Math.sin(t * 0.8 + branch.depth * 0.65 + branch.x1 * 0.01) * (1.2 + branch.depth * 0.1);

  const p0 = { x: branch.x1, y: branch.y1 };
  const p1 = { x: branch.cx + sway * 0.35, y: branch.cy };
  const p2 = { x: branch.x2 + sway, y: branch.y2 };

  const segments = 24;
  const drawTo = Math.max(2, Math.floor(segments * tGrow));
  const points = [];
  for (let i = 0; i <= drawTo; i += 1) {
    const tt = i / segments;
    points.push(quadPoint(p0, p1, p2, tt));
  }

  const fade = clamp((p - branch.start) / 0.08, 0, 1);
  const baseAlpha = 0.35 + 0.62 * fade;
  const baseWidth = branch.width * (0.8 + 0.2 * tGrow);

  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1];
    const b = points[i];
    const tip = i / (points.length - 1);
    const rough = 0.9 + 0.16 * Math.sin(i * 1.18 + branch.depth * 0.9 + branch.x1 * 0.006);
    const segWidth = Math.max(0.68, baseWidth * (1 - tip * 0.18) * rough);

    ctx.lineCap = 'round';
    ctx.lineWidth = segWidth;
    ctx.strokeStyle = `rgba(53, 41, 29, ${baseAlpha})`;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }

  // Highlight stroke for subtle bark volume.
  for (let i = 2; i < points.length; i += 2) {
    const a = points[i - 1];
    const b = points[i];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len;
    const ny = dx / len;
    const offset = baseWidth * 0.14;

    ctx.lineCap = 'round';
    ctx.lineWidth = Math.max(0.52, baseWidth * 0.26);
    ctx.strokeStyle = `rgba(126, 102, 72, ${0.13 + 0.12 * fade})`;
    ctx.beginPath();
    ctx.moveTo(a.x + nx * offset, a.y + ny * offset);
    ctx.lineTo(b.x + nx * offset, b.y + ny * offset);
    ctx.stroke();
  }

  // Sparse bark marks to avoid perfectly smooth cylinders.
  if (baseWidth > 2) {
    const step = Math.max(4, 10 - branch.depth);
    for (let i = step; i < points.length - 1; i += step) {
      const a = points[i - 1];
      const b = points[i];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const len = Math.hypot(dx, dy) || 1;
      const nx = -dy / len;
      const ny = dx / len;
      const mark = Math.max(1.2, baseWidth * 0.22);
      const jitter = Math.sin(i * 0.7 + branch.depth) * 0.6;

      ctx.strokeStyle = `rgba(35, 26, 18, ${0.14 + 0.1 * fade})`;
      ctx.lineWidth = Math.max(0.6, baseWidth * 0.08);
      ctx.beginPath();
      ctx.moveTo(a.x - nx * (mark + jitter), a.y - ny * (mark + jitter));
      ctx.lineTo(a.x + nx * (mark * 0.6), a.y + ny * (mark * 0.6));
      ctx.stroke();
    }
  }
}

function drawLeaves(progress, t, matureBoost) {
  function drawLeaf(leaf, bloom, alphaScale = 1) {
    const swayX = Math.sin(t * 1.25 * leaf.sway + leaf.x * 0.04) * 2.6;
    const swayY = Math.cos(t * 1.05 * leaf.sway + leaf.y * 0.03) * 1.2;
    const size = leaf.size * bloom;
    const blossom = leaf.blossom;

    ctx.save();
    ctx.translate(leaf.x + swayX, leaf.y + swayY);
    ctx.rotate(leaf.tone * Math.PI * 1.8 + t * 0.05);

    if (blossom) {
      ctx.fillStyle = `rgba(247, 216, 222, ${0.85 * alphaScale})`;
      for (let p = 0; p < 5; p += 1) {
        ctx.rotate((Math.PI * 2) / 5);
        ctx.beginPath();
        ctx.ellipse(size * 0.38, 0, size * 0.45, size * 0.24, 0.2, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = `rgba(245, 236, 186, ${0.9 * alphaScale})`;
      ctx.beginPath();
      ctx.arc(0, 0, size * 0.18, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.fillStyle = `hsla(${leaf.hue}, ${leaf.sat}%, ${leaf.light}%, ${0.9 * alphaScale})`;
      ctx.beginPath();
      ctx.ellipse(0, 0, size * 0.96, size * 0.56, 0.28, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = `hsla(${leaf.hue + 12}, ${leaf.sat + 6}%, ${leaf.light + 10}%, ${0.3 * alphaScale})`;
      ctx.beginPath();
      ctx.ellipse(-size * 0.12, -size * 0.08, size * 0.5, size * 0.24, 0.28, 0, Math.PI * 2);
      ctx.fill();

      ctx.strokeStyle = `rgba(242, 232, 206, ${0.35 * alphaScale})`;
      ctx.lineWidth = 0.8;
      ctx.beginPath();
      ctx.moveTo(-size * 0.65, 0);
      ctx.lineTo(size * 0.65, 0);
      ctx.stroke();
    }

    ctx.restore();
  }

  for (const leaf of tree.leaves) {
    const local = clamp((progress - leaf.appear) / 0.2, 0, 1);
    if (local <= 0) {
      continue;
    }
    drawLeaf(leaf, easeOutCubic(local), 1);
  }

  for (const leaf of tree.matureLeaves) {
    const local = clamp((matureBoost - leaf.delay) / 0.45, 0, 1);
    if (local <= 0) {
      continue;
    }
    drawLeaf(leaf, easeOutCubic(local), 0.92);
  }
}

function drawMist(t) {
  for (let i = 0; i < 3; i += 1) {
    const y = height * (0.24 + i * 0.1);
    const amp = 15 + i * 10;
    const speedF = 0.08 + i * 0.04;
    const alpha = 0.08 - i * 0.015;

    ctx.beginPath();
    for (let x = 0; x <= width; x += 18) {
      const yy = y + Math.sin(x * 0.006 + t * speedF + i) * amp;
      if (x === 0) {
        ctx.moveTo(x, yy);
      } else {
        ctx.lineTo(x, yy);
      }
    }
    ctx.lineTo(width, y + 120);
    ctx.lineTo(0, y + 120);
    ctx.closePath();
    ctx.fillStyle = `rgba(234, 242, 240, ${alpha})`;
    ctx.fill();
  }
}

function drawParticles(t, dt) {
  for (const mote of motes) {
    mote.y -= mote.speed * speed * 0.55;
    if (mote.y < -8) {
      mote.y = height + 8;
      mote.x = Math.random() * width;
    }

    const twinkle = 0.4 + 0.6 * Math.sin(t + mote.phase);
    ctx.fillStyle = mote.cool
      ? `rgba(201, 230, 246, ${0.12 + twinkle * 0.25})`
      : `rgba(255, 244, 217, ${0.16 + twinkle * 0.28})`;
    ctx.beginPath();
    ctx.arc(mote.x + Math.sin(t * 0.45 + mote.phase) * 0.6, mote.y, mote.r, 0, Math.PI * 2);
    ctx.fill();
  }

  for (const petal of petals) {
    petal.x += (petal.drift * 0.045 + Math.sin(t * petal.sway + petal.spin) * 0.16) * speed;
    petal.y += (0.12 + petal.z * 0.42) * speed;
    petal.spin += 0.0024 * petal.z * speed;

    if (petal.y > height + 12 || petal.x > width + 20) {
      petal.x = Math.random() * width;
      petal.y = -16 - Math.random() * height * 0.35;
    }

    ctx.save();
    ctx.translate(petal.x, petal.y);
    ctx.rotate(petal.spin);
    ctx.scale(1, 0.78);
    ctx.fillStyle = petal.hue;
    ctx.globalAlpha = 0.33 + petal.z * 0.22;
    ctx.beginPath();
    ctx.ellipse(0, 0, petal.size, petal.size * 0.68, 0.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  void dt;
}

let lastFrame = performance.now();

function getLoopProgress(now) {
  if (pausedAt !== null) {
    now = pausedAt;
  }
  const elapsed = (now - startTime) * speed;
  return clamp(elapsed / LOOP_MS, 0, 1);
}

function getMatureBoost(now) {
  if (pausedAt !== null) {
    now = pausedAt;
  }
  const elapsed = (now - startTime) * speed;
  const extra = elapsed - LOOP_MS;
  return clamp(extra / (2.0 * 60 * 1000), 0, 1);
}

function render(now) {
  const dt = Math.min(64, now - lastFrame);
  lastFrame = now;

  const t = now * 0.001;
  const progress = getLoopProgress(now);
  const matureBoost = getMatureBoost(now);

  drawBackground(t);
  drawMist(t);
  drawPot();

  const branchOrder = tree.branches.slice().sort((a, b) => a.depth - b.depth);
  for (const branch of branchOrder) {
    drawBranch(branch, progress, t);
  }

  drawLeaves(progress, t, matureBoost);
  drawParticles(t, dt);

  if (running) {
    requestAnimationFrame(render);
  }
}

function restartCycle() {
  randomizeScene();
  startTime = performance.now();
  if (!running) {
    pausedAt = startTime;
  }
}

function toggleRun() {
  running = !running;
  if (running) {
    if (pausedAt !== null) {
      const pauseDuration = performance.now() - pausedAt;
      startTime += pauseDuration;
      pausedAt = null;
    }
    ui.toggleRun.textContent = '⏸ 一時停止';
    lastFrame = performance.now();
    requestAnimationFrame(render);
  } else {
    pausedAt = performance.now();
    ui.toggleRun.textContent = '▶ 再生';
  }
}

class AmbientAudio {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.enabled = false;
    this.noiseSource = null;
    this.chimeTimer = null;
    // Jazz-leaning Japanese color: D insen-inspired set with tasteful extensions.
    this.chimeScale = [293.66, 311.13, 392.0, 440.0, 523.25, 587.33, 698.46];
  }

  async init() {
    if (this.ctx) {
      return;
    }

    this.ctx = new AudioContext();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0;
    this.master.connect(this.ctx.destination);

    const noiseBuffer = this.ctx.createBuffer(1, this.ctx.sampleRate * 2, this.ctx.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < data.length; i += 1) {
      data[i] = Math.random() * 2 - 1;
    }

    const noise = this.ctx.createBufferSource();
    noise.buffer = noiseBuffer;
    noise.loop = true;

    const band = this.ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.frequency.value = 290;
    band.Q.value = 0.45;

    const low = this.ctx.createBiquadFilter();
    low.type = 'lowpass';
    low.frequency.value = 920;

    const windGain = this.ctx.createGain();
    windGain.gain.value = 0.07;

    noise.connect(band);
    band.connect(low);
    low.connect(windGain);
    windGain.connect(this.master);

    noise.start();
    this.noiseSource = noise;

    this.chimeTimer = setInterval(() => {
      if (!this.enabled || !this.ctx) {
        return;
      }
      if (Math.random() < 0.52) {
        return;
      }
      const now = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      const pan = this.ctx.createStereoPanner();

      osc.type = 'sine';
      const octave = Math.random() < 0.18 ? 0.5 : Math.random() > 0.86 ? 2 : 1;
      osc.frequency.value = this.chimeScale[Math.floor(Math.random() * this.chimeScale.length)] * octave;
      pan.pan.value = (Math.random() * 2 - 1) * 0.48;

      gain.gain.setValueAtTime(0, now);
      gain.gain.linearRampToValueAtTime(0.065, now + 0.06);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 3.8 + Math.random() * 2.2);

      osc.connect(pan);
      pan.connect(gain);
      gain.connect(this.master);

      osc.start(now);
      osc.stop(now + 4.4 + Math.random() * 1.8);
    }, 3800);
  }

  async toggle() {
    await this.init();

    if (this.ctx.state === 'suspended') {
      await this.ctx.resume();
    }

    this.enabled = !this.enabled;
    const t = this.ctx.currentTime;
    this.master.gain.cancelScheduledValues(t);
    this.master.gain.linearRampToValueAtTime(this.enabled ? 0.28 : 0, t + 1.2);
    ui.toggleAudio.textContent = this.enabled ? '♪ 音: 入' : '♪ 音: 切';
  }
}

const ambient = new AmbientAudio();

ui.start.addEventListener('click', async () => {
  started = true;
  ui.intro.classList.remove('visible');
  if (!running) {
    toggleRun();
  }
  if (!ambient.enabled) {
    await ambient.toggle();
  }
});

ui.toggleRun.addEventListener('click', () => {
  if (!started) {
    ui.intro.classList.remove('visible');
    started = true;
  }
  toggleRun();
});

ui.toggleAudio.addEventListener('click', async () => {
  if (!started) {
    ui.intro.classList.remove('visible');
    started = true;
  }
  await ambient.toggle();
});

ui.toggleFullscreen.addEventListener('click', async () => {
  if (!document.fullscreenElement) {
    await document.documentElement.requestFullscreen();
  } else {
    await document.exitFullscreen();
  }
});

ui.speed.addEventListener('input', () => {
  const old = speed;
  speed = Number(ui.speed.value);

  if (pausedAt === null) {
    const now = performance.now();
    const elapsed = now - startTime;
    startTime = now - elapsed * (old / speed);
  }
});

ui.restart.addEventListener('click', () => {
  restartCycle();
});

window.addEventListener('resize', resize, { passive: true });
window.addEventListener('keydown', (ev) => {
  if (ev.code === 'Space') {
    ev.preventDefault();
    toggleRun();
  }
  if (ev.key.toLowerCase() === 'f') {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen().catch(() => {});
    }
  }
  if (ev.key.toLowerCase() === 'r') {
    restartCycle();
  }
  if (ev.key.toLowerCase() === 'm') {
    ambient.toggle();
  }
});

resize();
requestAnimationFrame(render);
