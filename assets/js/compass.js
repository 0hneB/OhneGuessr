// Canvas compass HUD: a horizontal heading bar, driven by setHeading().

const CONFIG = {
  size: { w: 240, h: 32 },
  bar: { x: 0, y: 0, w: 240, h: 32, r: 16 },
  pxPerDegree: 2.4,
  tick: {
    step: 4.5,
    offsetX: 0,
    y1: 8,
    y2: 23,
    width: 1.25,
    color: '202, 210, 221',
    alpha: 0.78,
    edgeAlpha: 0.38,
    edgeFade: 7,
    labelGap: 7
  },
  label: {
    font: '800 11px "Helvetica Neue", Helvetica, Arial, sans-serif',
    tracking: 0,
    y: 19,
    color: '#fbfbfd',
    shadow: 'rgba(15, 21, 32, .55)',
    shadowBlur: 1,
    shadowOffsetY: 1,
    overscan: 28
  },
  marker: {
    x: 120,
    width: 2,
    stops: [
      [0.00, 'rgba(232, 235, 240, .75)'],
      [0.18, 'rgba(158, 167, 179, .36)'],
      [0.48, 'rgba(158, 167, 179, .00)'],
      [0.78, 'rgba(158, 167, 179, .22)'],
      [1.00, 'rgba(232, 235, 240, .72)']
    ]
  },
  fillStops: [
    [0.00, 'rgba(0, 0, 0, .58)'],
    [0.32, 'rgba(0, 0, 0, .60)'],
    [0.50, 'rgba(0, 0, 0, .54)'],
    [0.72, 'rgba(0, 0, 0, .62)'],
    [1.00, 'rgba(0, 0, 0, .68)']
  ],
  shadeStops: [
    [0.00, 'rgba(255,255,255,.12)'],
    [0.32, 'rgba(255,255,255,0)'],
    [0.72, 'rgba(0,0,0,.06)'],
    [1.00, 'rgba(0,0,0,.16)']
  ]
};

const LABELS = [
  [0, 'N'], [45, 'NE'], [90, 'E'], [135, 'SE'],
  [180, 'S'], [225, 'SW'], [270, 'W'], [315, 'NW']
];

const wrap = (d) => ((d % 360) + 360) % 360;
const signedAngle = (to, from) => ((to - from + 540) % 360) - 180;

export class CompassHUD {
  constructor(canvas, config = CONFIG) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.config = config;
    this.heading = 0;
    this.resize = this.resize.bind(this);
    this.resize();
    window.addEventListener('resize', this.resize);
  }

  setHeading(value) {
    const h = Number(value);
    if (!Number.isFinite(h)) return;
    this.heading = wrap(h);
    this.draw();
  }

  resize() {
    const { w, h } = this.config.size;
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.canvas.style.width = w + 'px';
    this.canvas.style.height = h + 'px';
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.draw();
  }

  draw() {
    const { w, h } = this.config.size;
    this.ctx.clearRect(0, 0, w, h);
    this.drawBar();
    this.withBarClip(() => {
      const labels = this.visibleLabels();
      this.drawTicks(labels);
      this.drawLabels(labels);
      this.drawMarker();
    });
  }

  drawBar() {
    const { ctx } = this;
    const { bar, fillStops, shadeStops } = this.config;
    this.pathBar();
    ctx.save();
    ctx.clip();
    ctx.fillStyle = this.gradient(fillStops, bar.x, 0, bar.x + bar.w, 0);
    ctx.fillRect(bar.x, bar.y, bar.w, bar.h);
    ctx.fillStyle = this.gradient(shadeStops, 0, bar.y, 0, bar.y + bar.h);
    ctx.fillRect(bar.x, bar.y, bar.w, bar.h);
    ctx.restore();
  }

  drawTicks(labels) {
    const { ctx } = this;
    const { bar, tick } = this.config;
    const firstTick = Math.floor((this.heading - 70) / tick.step) * tick.step;
    const lastTick = this.heading + 70;
    ctx.lineCap = 'butt';
    ctx.lineWidth = tick.width;
    for (let angle = firstTick; angle <= lastTick; angle += tick.step) {
      const x = this.xForAngle(wrap(angle), tick.offsetX);
      if (x < bar.x - 2 || x > bar.x + bar.w + 2) continue;
      if (this.tickHitsLabel(x, labels)) continue;
      const nearEdge = x < bar.x + tick.edgeFade || x > bar.x + bar.w - tick.edgeFade;
      const alpha = nearEdge ? tick.edgeAlpha : tick.alpha;
      ctx.strokeStyle = `rgba(${tick.color}, ${alpha})`;
      ctx.beginPath();
      ctx.moveTo(Math.round(x) + 0.5, tick.y1);
      ctx.lineTo(Math.round(x) + 0.5, tick.y2);
      ctx.stroke();
    }
  }

  drawLabels(labels) {
    const { ctx } = this;
    const { label } = this.config;
    ctx.font = label.font;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = label.color;
    ctx.shadowColor = label.shadow;
    ctx.shadowBlur = label.shadowBlur;
    ctx.shadowOffsetY = label.shadowOffsetY;
    for (const item of labels) {
      this.drawTrackedText(item.text, Math.round(item.x), label.y);
    }
    ctx.shadowColor = 'transparent';
    ctx.shadowBlur = 0;
    ctx.shadowOffsetY = 0;
  }

  drawMarker() {
    const { ctx } = this;
    const { bar, marker } = this.config;
    ctx.strokeStyle = this.gradient(marker.stops, 0, bar.y, 0, bar.y + bar.h);
    ctx.lineWidth = marker.width;
    ctx.beginPath();
    ctx.moveTo(marker.x, bar.y);
    ctx.lineTo(marker.x, bar.y + bar.h);
    ctx.stroke();
  }

  visibleLabels() {
    const { ctx } = this;
    const { bar, label } = this.config;
    ctx.font = label.font;
    return LABELS
      .map(([angle, text]) => ({ text, x: this.xForAngle(angle) }))
      .filter((item) => item.x >= bar.x - label.overscan && item.x <= bar.x + bar.w + label.overscan);
  }

  tickHitsLabel(x, labels) {
    const { tick } = this.config;
    return labels.some((label) => {
      const halfWidth = this.measureTrackedText(label.text) / 2;
      return Math.abs(x - label.x) < halfWidth + tick.labelGap;
    });
  }

  drawTrackedText(text, x, y) {
    const chars = [...text];
    const width = this.measureTrackedText(text);
    let cursor = x - width / 2;
    for (const char of chars) {
      const charWidth = this.ctx.measureText(char).width;
      this.ctx.fillText(char, cursor + charWidth / 2, y);
      cursor += charWidth + this.config.label.tracking;
    }
  }

  measureTrackedText(text) {
    const chars = [...text];
    const textWidth = chars.reduce((total, char) => total + this.ctx.measureText(char).width, 0);
    return textWidth + Math.max(0, chars.length - 1) * this.config.label.tracking;
  }

  xForAngle(angle, offset = 0) {
    const { bar, pxPerDegree } = this.config;
    return bar.x + bar.w / 2 + signedAngle(angle, this.heading) * pxPerDegree + offset;
  }

  withBarClip(drawInside) {
    this.ctx.save();
    this.pathBar();
    this.ctx.clip();
    drawInside();
    this.ctx.restore();
  }

  pathBar() {
    const { ctx } = this;
    const { x, y, w, h, r } = this.config.bar;
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  gradient(stops, x0, y0, x1, y1) {
    const g = this.ctx.createLinearGradient(x0, y0, x1, y1);
    for (const [position, color] of stops) g.addColorStop(position, color);
    return g;
  }
}
