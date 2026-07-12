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

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.decoding = 'async';
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`Could not load ${src}`));
    image.src = src;
  });
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
    filter: style.getPropertyValue('--map-marker-filter').trim() || DEFAULT_MARKER_FILTER
  };
}

const isPoint = (value) =>
  Number.isFinite(value?.lat) && Number.isFinite(value?.lng);

// End-of-game renderer for many result pairs. Leaflet's regular markers remain
// ideal for one round; this batches the same artwork into one canvas for the
// all-round overview so pan and zoom cost does not grow with the DOM layer count.
export class SummaryCanvas {
  constructor(map, { onAnswerClick = null } = {}) {
    this.map = map;
    this.onAnswerClick = onAnswerClick;
    this.results = [];
    this.visible = false;
    this.frame = 0;
    this.sprites = null;
    this.spriteKey = '';
    this.images = null;

    this.canvas = document.createElement('canvas');
    this.canvas.className = 'summary-results-canvas leaflet-zoom-animated';
    this.canvas.hidden = true;
    this.canvas.setAttribute('aria-hidden', 'true');
    const pane = this.map.getPane('summaryResultsPane') ||
      this.map.createPane('summaryResultsPane');
    pane.style.zIndex = '650';
    pane.style.pointerEvents = 'none';
    pane.appendChild(this.canvas);

    this.scheduleDraw = this.scheduleDraw.bind(this);
    this.handleZoomAnimation = this.handleZoomAnimation.bind(this);
    this.handleClick = this.handleClick.bind(this);
    this.handleMouseMove = this.handleMouseMove.bind(this);
    this.handleMouseOut = this.handleMouseOut.bind(this);
    this.map.on('moveend zoomend resize viewreset', this.scheduleDraw);
    this.map.on('zoomanim', this.handleZoomAnimation);
    this.map.on('click', this.handleClick);
    this.map.on('mousemove', this.handleMouseMove);
    this.map.on('mouseout', this.handleMouseOut);

    Promise.all([loadImage(GUESS_IMAGE), loadImage(CORRECT_IMAGE)])
      .then(([guess, correct]) => {
        this.images = { guess, correct };
        this.scheduleDraw();
      })
      .catch(() => { /* regular round markers remain available */ });
  }

  show(results) {
    this.results = results.filter((result) => isPoint(result?.actual));
    this.visible = this.results.length > 0;
    this.canvas.hidden = !this.visible;
    this.scheduleDraw();
  }

  hide() {
    this.visible = false;
    this.results = [];
    this.canvas.hidden = true;
    this.map.getContainer().classList.remove('summary-answer-hover');
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
    if (key === this.spriteKey) return true;
    this.spriteKey = key;
    this.sprites = {
      guess: createSprite(
        this.images.guess, GUESS_SIZE, pixelRatio, style.filter, style.accent
      ),
      correct: createSprite(
        this.images.correct, CORRECT_SIZE, pixelRatio, style.filter
      )
    };
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
      this.map.containerPointToLayerPoint([0, 0])
    );
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

  handleZoomAnimation(event) {
    if (!this.visible) return;
    const scale = this.map.getZoomScale(event.zoom);
    const offset = this.map._latLngToNewLayerPoint(
      this.map.getBounds().getNorthWest(),
      event.zoom,
      event.center
    );
    L.DomUtil.setTransform(this.canvas, offset, scale);
  }

  handleClick(event) {
    if (!this.visible || !this.onAnswerClick) return;
    const actual = this.answerAt(event.containerPoint);
    if (actual) this.onAnswerClick(actual);
  }

  handleMouseMove(event) {
    if (!this.visible) return;
    const hovering = !!this.answerAt(event.containerPoint);
    this.map.getContainer().classList.toggle('summary-answer-hover', hovering);
  }

  handleMouseOut() {
    this.map.getContainer().classList.remove('summary-answer-hover');
  }
}
