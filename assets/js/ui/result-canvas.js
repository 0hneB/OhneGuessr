const GUESS_IMAGE = 'assets/icons/pin-guess.svg';
const CORRECT_IMAGE = 'assets/images/correct-location.webp';
const GUESS_SIZE = { width: 44, height: 56, anchorX: 22, anchorY: 48 };
const CORRECT_SIZE = { width: 28, height: 28, anchorX: 14, anchorY: 14 };
const SPRITE_PADDING = 12;
const ANSWER_HIT_RADIUS = 18;
const DEFAULT_MARKER_FILTER = [
  'drop-shadow(0 0 1px #fff)',
  'drop-shadow(0 0 1px #fff)',
  'drop-shadow(0 0 1px #fff)',
  'drop-shadow(0 0 1px #fff)',
  'drop-shadow(0 3px 4px rgba(0, 0, 0, 0.4))'
].join(' ');
let markerImagesPromise = null;
let sharedSpriteKey = '';
let sharedSprites = null;

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.decoding = 'async';
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`Could not load ${src}`));
    image.src = src;
  });
}

function loadMarkerImages() {
  markerImagesPromise ||= Promise.all([
    loadImage(GUESS_IMAGE),
    loadImage(CORRECT_IMAGE)
  ]).then(([guess, correct]) => ({ guess, correct }));
  return markerImagesPromise;
}

function colorize(image, width, height, color, pixelRatio) {
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(width * pixelRatio);
  canvas.height = Math.ceil(height * pixelRatio);
  const ctx = canvas.getContext('2d');
  ctx.scale(pixelRatio, pixelRatio);
  ctx.drawImage(image, 0, 0, width, height);
  ctx.globalCompositeOperation = 'source-in';
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, width, height);
  return canvas;
}

// Rasterize each styled marker once, then reuse the cached pixels for every
// round and frame. This matches the DOM marker treatment without repeatedly
// evaluating its stacked CSS drop shadows while the map moves.
function createSprite(image, size, pixelRatio, filter, color = null) {
  const { width, height, anchorX, anchorY } = size;
  const source = color
    ? colorize(image, width, height, color, pixelRatio)
    : image;
  const cssWidth = width + SPRITE_PADDING * 2;
  const cssHeight = height + SPRITE_PADDING * 2;
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(cssWidth * pixelRatio);
  canvas.height = Math.ceil(cssHeight * pixelRatio);
  const ctx = canvas.getContext('2d');
  ctx.scale(pixelRatio, pixelRatio);

  const x = SPRITE_PADDING;
  const y = SPRITE_PADDING;
  if ('filter' in ctx) {
    ctx.filter = filter;
    ctx.drawImage(source, x, y, width, height);
    ctx.filter = 'none';
  } else {
    ctx.shadowColor = 'rgba(0, 0, 0, 0.4)';
    ctx.shadowBlur = 4;
    ctx.shadowOffsetY = 3;
    ctx.drawImage(source, x, y, width, height);

    ctx.shadowColor = '#ffffff';
    ctx.shadowBlur = 1;
    ctx.shadowOffsetY = 0;
    for (let i = 0; i < 4; i++) ctx.drawImage(source, x, y, width, height);

    ctx.shadowColor = 'transparent';
    ctx.shadowBlur = 0;
    ctx.drawImage(source, x, y, width, height);
  }
  return {
    canvas,
    width: cssWidth,
    height: cssHeight,
    offsetX: -anchorX - SPRITE_PADDING,
    offsetY: -anchorY - SPRITE_PADDING
  };
}

function markerStyle() {
  const style = getComputedStyle(document.documentElement);
  return {
    accent: style.getPropertyValue('--accent').trim() || '#22c55e',
    filter: style.getPropertyValue('--result-marker-filter').trim() || DEFAULT_MARKER_FILTER
  };
}

const isPoint = (value) =>
  Number.isFinite(value?.lat) && Number.isFinite(value?.lng);

// Shared renderer for one or many result pairs. Marker artwork is cached and
// every visible pair is batched into one canvas regardless of round count.
export class ResultCanvas {
  constructor(map, { onAnswerClick = null } = {}) {
    this.map = map;
    this.onAnswerClick = onAnswerClick;
    this.results = [];
    this.visible = false;
    this.frame = 0;
    this.center = null;
    this.zoom = null;
    this.sprites = null;
    this.images = null;

    this.canvas = document.createElement('canvas');
    this.canvas.className = 'result-markers-canvas leaflet-zoom-animated';
    this.canvas.hidden = true;
    this.canvas.setAttribute('aria-hidden', 'true');
    const pane = this.map.getPane('resultMarkersPane') ||
      this.map.createPane('resultMarkersPane');
    pane.style.zIndex = '650';
    pane.style.pointerEvents = 'none';
    pane.appendChild(this.canvas);

    this.scheduleDraw = this.scheduleDraw.bind(this);
    this.handleZoom = this.handleZoom.bind(this);
    this.handleZoomAnimation = this.handleZoomAnimation.bind(this);
    this.handleClick = this.handleClick.bind(this);
    this.handleMouseMove = this.handleMouseMove.bind(this);
    this.handleMouseOut = this.handleMouseOut.bind(this);
    this.map.on('moveend zoomend resize viewreset', this.scheduleDraw);
    this.map.on('zoom', this.handleZoom);
    this.map.on('zoomanim', this.handleZoomAnimation);
    this.map.on('click', this.handleClick);
    this.map.on('mousemove', this.handleMouseMove);
    this.map.on('mouseout', this.handleMouseOut);
    new MutationObserver(this.scheduleDraw).observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['style']
    });

    loadMarkerImages()
      .then((images) => {
        this.images = images;
        this.scheduleDraw();
      })
      .catch(() => { /* keep the map usable if a marker asset is unavailable */ });
  }

  show(results) {
    this.results = results.filter((result) => isPoint(result?.actual));
    this.visible = this.results.length > 0;
    this.canvas.hidden = true;
    this.scheduleDraw();
  }

  hide() {
    this.visible = false;
    this.results = [];
    this.center = null;
    this.zoom = null;
    this.canvas.hidden = true;
    this.map.getContainer().classList.remove('result-answer-hover');
    if (this.frame) cancelAnimationFrame(this.frame);
    this.frame = 0;
  }

  scheduleDraw() {
    if (!this.visible || this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.draw();
    });
  }

  ensureSprites(pixelRatio) {
    if (!this.images) return false;
    const style = markerStyle();
    const key = `${style.accent}:${style.filter}:${pixelRatio}`;
    if (key !== sharedSpriteKey) {
      const sprites = {
        guess: createSprite(
          this.images.guess, GUESS_SIZE, pixelRatio, style.filter, style.accent
        ),
        correct: createSprite(
          this.images.correct, CORRECT_SIZE, pixelRatio, style.filter
        )
      };
      sharedSpriteKey = key;
      sharedSprites = sprites;
    }
    this.sprites = sharedSprites;
    return true;
  }

  resizeCanvas(pixelRatio) {
    const size = this.map.getSize();
    const width = Math.max(1, Math.round(size.x));
    const height = Math.max(1, Math.round(size.y));
    const renderWidth = Math.ceil(width * pixelRatio);
    const renderHeight = Math.ceil(height * pixelRatio);
    if (this.canvas.width !== renderWidth || this.canvas.height !== renderHeight) {
      this.canvas.width = renderWidth;
      this.canvas.height = renderHeight;
      this.canvas.style.width = `${width}px`;
      this.canvas.style.height = `${height}px`;
    }
    return { width, height };
  }

  drawSprite(ctx, sprite, point) {
    ctx.drawImage(
      sprite.canvas,
      point.x + sprite.offsetX,
      point.y + sprite.offsetY,
      sprite.width,
      sprite.height
    );
  }

  draw() {
    if (!this.visible) return;
    const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
    L.DomUtil.setPosition(
      this.canvas,
      this.map.containerPointToLayerPoint([0, 0]).round()
    );
    this.center = this.map.getCenter();
    this.zoom = this.map.getZoom();
    const size = this.resizeCanvas(pixelRatio);
    const ctx = this.canvas.getContext('2d');
    ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    ctx.clearRect(0, 0, size.width, size.height);

    const projected = this.results.map((result) => ({
      result,
      actual: this.map.latLngToContainerPoint(result.actual),
      guess: isPoint(result.guess)
        ? this.map.latLngToContainerPoint(result.guess)
        : null
    }));
    ctx.save();
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 2;
    ctx.globalAlpha = 0.85;
    ctx.setLineDash([3, 9]);
    for (const item of projected) {
      if (!item.guess) continue;
      ctx.beginPath();
      ctx.moveTo(item.guess.x, item.guess.y);
      ctx.lineTo(item.actual.x, item.actual.y);
      ctx.stroke();
    }
    ctx.restore();

    if (!this.ensureSprites(pixelRatio)) return;
    for (const item of projected) this.drawSprite(ctx, this.sprites.correct, item.actual);
    for (const item of projected) {
      if (item.guess) this.drawSprite(ctx, this.sprites.guess, item.guess);
    }
    this.canvas.hidden = false;
  }

  answerAt(point) {
    const maxDistanceSq = ANSWER_HIT_RADIUS ** 2;
    let nearest = null;
    let nearestDistanceSq = maxDistanceSq;
    for (const result of this.results) {
      const projected = this.map.latLngToContainerPoint(result.actual);
      const dx = projected.x - point.x;
      const dy = projected.y - point.y;
      const distanceSq = dx * dx + dy * dy;
      if (distanceSq <= nearestDistanceSq) {
        nearest = result.actual;
        nearestDistanceSq = distanceSq;
      }
    }
    return nearest;
  }

  updateTransform(center, zoom) {
    if (!this.visible || !this.center || this.zoom == null) return;
    const scale = this.map.getZoomScale(zoom, this.zoom);
    const viewHalf = this.map.getSize().multiplyBy(0.5);
    const currentCenterPoint = this.map.project(this.center, zoom);
    const offset = viewHalf.multiplyBy(-scale)
      .add(currentCenterPoint)
      .subtract(this.map._getNewPixelOrigin(center, zoom));
    if (L.Browser.any3d) L.DomUtil.setTransform(this.canvas, offset, scale);
    else L.DomUtil.setPosition(this.canvas, offset);
  }

  handleZoom() {
    this.updateTransform(this.map.getCenter(), this.map.getZoom());
  }

  handleZoomAnimation(event) {
    this.updateTransform(event.center, event.zoom);
  }

  handleClick(event) {
    if (!this.visible || !this.onAnswerClick) return;
    const actual = this.answerAt(event.containerPoint);
    if (actual) this.onAnswerClick(actual);
  }

  handleMouseMove(event) {
    if (!this.visible || this.map.dragging.moving()) return;
    const hovering = !!this.answerAt(event.containerPoint);
    this.map.getContainer().classList.toggle('result-answer-hover', hovering);
  }

  handleMouseOut() {
    this.map.getContainer().classList.remove('result-answer-hover');
  }
}
