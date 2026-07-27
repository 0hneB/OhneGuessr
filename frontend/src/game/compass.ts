// Shared heading state for the horizontal bar and classic needle.
import type { CompassStyle } from '../types.js';

const CONFIG = {
  size: { w: 240, h: 32 },
  bar: { x: 0, y: 0, w: 240, h: 32, r: 16 },
  pxPerDegree: 2.4,
  tick: {
    step: 4.5,
    y1: 10,
    y2: 21,
    width: 1.25,
    color: '202, 210, 221',
    alpha: 0.78,
    edgeAlpha: 0.38,
    edgeFade: 7,
    labelGap: 7
  },
  label: {
    font: '800 12px "Manrope", system-ui, sans-serif',
    color: '#fbfbfd',
    shadow: 'rgba(15, 21, 32, .55)',
    shadowBlur: 1,
    shadowOffsetY: 1,
    overscan: 28
  },
  marker: {
    x: 120,
    width: 2
  },
  fill: 'rgba(0, 0, 0, .6)'
} as const;

const LABELS = [
  [0, 'N'], [45, 'NE'], [90, 'E'], [135, 'SE'],
  [180, 'S'], [225, 'SW'], [270, 'W'], [315, 'NW']
] as const;

const wrap = (degrees: number) => ((degrees % 360) + 360) % 360;
const signedAngle = (to: number, from: number) => ((to - from + 540) % 360) - 180;

interface VisibleLabel {
  text: string;
  x: number;
}

export class CompassHUD {
  private readonly canvas: HTMLCanvasElement;
  private readonly needle: HTMLElement;
  private readonly ctx: CanvasRenderingContext2D;
  private heading = 0;
  private style: CompassStyle;

  constructor(canvas: HTMLCanvasElement, needle: HTMLElement, style: CompassStyle) {
    this.canvas = canvas;
    this.needle = needle;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('2D canvas is unavailable');
    this.ctx = context;
    this.style = style;
    document.documentElement.dataset.compassStyle = this.style;
    this.resize = this.resize.bind(this);
    this.resize();
    void document.fonts.load(CONFIG.label.font).then(() => this.render());
    window.addEventListener('resize', this.resize);
  }

  setStyle(style: CompassStyle) {
    this.style = style;
    document.documentElement.dataset.compassStyle = this.style;
    this.render();
  }

  setHeading(heading: number) {
    this.heading = wrap(heading);
    this.render();
  }

  render() {
    if (this.style !== 'classic') this.draw();
    if (this.style !== 'bar') this.rotateNeedle();
  }

  rotateNeedle() {
    this.needle.style.transform = `rotate(${-this.heading}deg)`;
  }

  resize() {
    const { w, h } = CONFIG.size;
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.canvas.style.width = w + 'px';
    this.canvas.style.height = h + 'px';
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.render();
  }

  draw() {
    const { ctx } = this;
    const { w, h } = CONFIG.size;
    ctx.clearRect(0, 0, w, h);
    ctx.save();
    this.pathBar();
    ctx.fillStyle = CONFIG.fill;
    ctx.fill();
    ctx.clip();
    ctx.font = CONFIG.label.font;
    const labels = this.visibleLabels();
    this.drawTicks(labels);
    this.drawLabels(labels);
    this.drawMarker();
    ctx.restore();
  }

  drawTicks(labels: VisibleLabel[]) {
    const { ctx } = this;
    const { bar, tick } = CONFIG;
    const firstTick = Math.floor((this.heading - 70) / tick.step) * tick.step;
    const lastTick = this.heading + 70;
    ctx.lineCap = 'butt';
    ctx.lineWidth = tick.width;
    for (let angle = firstTick; angle <= lastTick; angle += tick.step) {
      const x = this.xForAngle(wrap(angle));
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

  drawLabels(labels: VisibleLabel[]) {
    const { ctx } = this;
    const { bar, label } = CONFIG;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = label.color;
    ctx.shadowColor = label.shadow;
    ctx.shadowBlur = label.shadowBlur;
    ctx.shadowOffsetY = label.shadowOffsetY;
    const bounds = ctx.measureText('NESW');
    const y = bar.y + (
      bar.h + bounds.actualBoundingBoxAscent - bounds.actualBoundingBoxDescent
    ) / 2;
    for (const item of labels) ctx.fillText(item.text, Math.round(item.x), y);
    ctx.shadowColor = 'transparent';
  }

  drawMarker() {
    const { ctx } = this;
    const { bar, marker } = CONFIG;
    const fade = ctx.createLinearGradient(0, bar.y, 0, bar.y + bar.h);
    fade.addColorStop(0, 'rgba(232, 235, 240, .75)');
    fade.addColorStop(0.18, 'rgba(158, 167, 179, .36)');
    fade.addColorStop(0.48, 'rgba(158, 167, 179, 0)');
    fade.addColorStop(0.78, 'rgba(158, 167, 179, .22)');
    fade.addColorStop(1, 'rgba(232, 235, 240, .72)');
    ctx.strokeStyle = fade;
    ctx.lineWidth = marker.width;
    ctx.beginPath();
    ctx.moveTo(marker.x, bar.y);
    ctx.lineTo(marker.x, bar.y + bar.h);
    ctx.stroke();
  }

  visibleLabels() {
    const { bar, label } = CONFIG;
    return LABELS
      .map(([angle, text]) => ({ text, x: this.xForAngle(angle) }))
      .filter((item) => item.x >= bar.x - label.overscan && item.x <= bar.x + bar.w + label.overscan);
  }

  tickHitsLabel(x: number, labels: VisibleLabel[]) {
    return labels.some((label) =>
      Math.abs(x - label.x) < this.ctx.measureText(label.text).width / 2 + CONFIG.tick.labelGap
    );
  }

  xForAngle(angle: number) {
    const { bar, pxPerDegree } = CONFIG;
    return bar.x + bar.w / 2 + signedAngle(angle, this.heading) * pxPerDegree;
  }

  pathBar() {
    const { x, y, w, h, r } = CONFIG.bar;
    this.ctx.beginPath();
    this.ctx.roundRect(x, y, w, h, r);
  }
}
