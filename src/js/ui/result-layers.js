const GUESS_ASSET = 'icons/pin-guess.svg';
const CORRECT_ASSET = 'images/correct-location.webp';
const GUESS_IMAGE_ID = 'result-guess-marker';
const CORRECT_IMAGE_ID = 'result-correct-marker';
const RESULT_SOURCE = 'result-data';
const ACTUAL_LAYER = 'result-actual-markers';
const GUESS_LAYER = 'result-guess-markers';
const LIGHT_MAP_LINK_COLOR = '#000000';
const SPRITE_SCALE = 2;
const SPRITE_PADDING = 12;

const emptyCollection = () => ({ type: 'FeatureCollection', features: [] });
const isPoint = (value) =>
  Number.isFinite(value?.lat) && Number.isFinite(value?.lng);
const coordinates = ({ lat, lng }) => [lng, lat];
const feature = (kind, geometry, properties = {}) => ({
  type: 'Feature',
  properties: { kind, ...properties },
  geometry
});

function unwrapLine(points) {
  const line = [];
  for (const point of points) {
    const coordinate = coordinates(point);
    const previousLng = line.at(-1)?.[0];
    if (previousLng != null) {
      while (coordinate[0] - previousLng > 180) coordinate[0] -= 360;
      while (coordinate[0] - previousLng < -180) coordinate[0] += 360;
    }
    line.push(coordinate);
  }
  return line;
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.decoding = 'async';
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`Could not load ${src}`));
    image.src = src;
  });
}

const markerAssets = Promise.all([loadImage(GUESS_ASSET), loadImage(CORRECT_ASSET)]);
let spriteCache = null;
let correctSpritePromise = null;

function colorize(image, width, height, color) {
  const canvas = document.createElement('canvas');
  canvas.width = width * SPRITE_SCALE;
  canvas.height = height * SPRITE_SCALE;
  const context = canvas.getContext('2d');
  context.scale(SPRITE_SCALE, SPRITE_SCALE);
  context.drawImage(image, 0, 0, width, height);
  context.globalCompositeOperation = 'source-in';
  context.fillStyle = color;
  context.fillRect(0, 0, width, height);
  return canvas;
}

function drawMarker(context, source, x, y, width, height, filter) {
  if ('filter' in context) {
    context.filter = filter;
    context.drawImage(source, x, y, width, height);
    context.filter = 'none';
    return;
  }

  context.shadowColor = 'rgba(0, 0, 0, 0.4)';
  context.shadowBlur = 4;
  context.shadowOffsetY = 3;
  context.drawImage(source, x, y, width, height);

  context.shadowColor = '#ffffff';
  context.shadowBlur = 1;
  context.shadowOffsetY = 0;
  for (let index = 0; index < 4; index++) {
    context.drawImage(source, x, y, width, height);
  }

  context.shadowColor = 'transparent';
  context.shadowBlur = 0;
  context.drawImage(source, x, y, width, height);
}

function createSprite(image, { width, height }, filter, color = null) {
  const source = color ? colorize(image, width, height, color) : image;
  const spriteWidth = width + SPRITE_PADDING * 2;
  const spriteHeight = height + SPRITE_PADDING * 2;
  const canvas = document.createElement('canvas');
  canvas.width = spriteWidth * SPRITE_SCALE;
  canvas.height = spriteHeight * SPRITE_SCALE;
  const context = canvas.getContext('2d');
  context.scale(SPRITE_SCALE, SPRITE_SCALE);
  drawMarker(
    context,
    source,
    SPRITE_PADDING,
    SPRITE_PADDING,
    width,
    height,
    filter
  );
  return context.getImageData(0, 0, canvas.width, canvas.height);
}

function markerSprites(accent) {
  const filter = getComputedStyle(document.documentElement)
    .getPropertyValue('--result-marker-filter').trim();
  const cacheKey = `${accent}:${filter}`;
  if (spriteCache?.key === cacheKey) return spriteCache.promise;

  correctSpritePromise ||= markerAssets.then(([, correct]) =>
    createSprite(correct, { width: 28, height: 28 }, filter));
  const promise = Promise.all([
    markerAssets.then(([guess]) =>
      createSprite(guess, { width: 44, height: 56 }, filter, accent)),
    correctSpritePromise
  ]).then(([guess, correct]) => ({ guess, correct }));
  spriteCache = { key: cacheKey, promise };
  return promise;
}

function addSource(map, id, data) {
  if (!map.getSource(id)) map.addSource(id, { type: 'geojson', data });
}

function addLayer(map, layer) {
  if (!map.getLayer(layer.id)) map.addLayer(layer);
}

// Native MapLibre layers keep one or one hundred result pairs equally cheap:
// one GeoJSON source, five GPU-drawn layers, and two cached marker sprites.
export class ResultLayers {
  constructor(map, onAnswerClick, accent, dark = false) {
    this.map = map;
    this.onAnswerClick = onAnswerClick;
    this.accent = accent;
    this.dark = dark;
    this.results = [];
    this.data = emptyCollection();
    this.installRevision = 0;
    this.dragging = false;

    map.on('dragstart', () => {
      this.dragging = true;
      map.getCanvas().style.cursor = 'grabbing';
    });
    map.on('dragend', () => {
      this.dragging = false;
      this.updateCursor();
    });
    map.on('mousemove', (event) => this.updateCursor(event.point));
    map.on('mouseout', () => this.setCursor('crosshair'));
    map.on('click', (event) => {
      const actual = this.answerAt(event.point);
      if (actual) this.onAnswerClick(actual);
    });
  }

  install() {
    const revision = ++this.installRevision;
    addSource(this.map, RESULT_SOURCE, this.data);

    addLayer(this.map, {
      id: 'result-links',
      type: 'line',
      source: RESULT_SOURCE,
      filter: ['==', ['get', 'kind'], 'link'],
      paint: {
        'line-color': this.linkColor(),
        'line-width': 2,
        'line-opacity': 1,
        'line-dasharray': [1.5, 2.25]
      }
    });
    addLayer(this.map, {
      id: 'movement-trail',
      type: 'line',
      source: RESULT_SOURCE,
      filter: ['==', ['get', 'kind'], 'trail'],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': this.accent,
        'line-width': 3,
        'line-opacity': 0.9
      }
    });
    addLayer(this.map, {
      id: 'movement-trail-end',
      type: 'circle',
      source: RESULT_SOURCE,
      filter: ['==', ['get', 'kind'], 'trail-end'],
      paint: {
        'circle-radius': 4,
        'circle-color': '#ffffff',
        'circle-stroke-color': this.accent,
        'circle-stroke-width': 2
      }
    });

    this.currentMarkerSprites().then((sprites) => {
      if (revision !== this.installRevision || !this.map.getSource(RESULT_SOURCE)) return;
      this.putImage(CORRECT_IMAGE_ID, sprites.correct);
      this.putImage(GUESS_IMAGE_ID, sprites.guess);
      addLayer(this.map, {
        id: ACTUAL_LAYER,
        type: 'symbol',
        source: RESULT_SOURCE,
        filter: ['==', ['get', 'kind'], 'actual'],
        layout: {
          'icon-image': CORRECT_IMAGE_ID,
          'icon-allow-overlap': true,
          'icon-ignore-placement': true
        }
      });
      addLayer(this.map, {
        id: GUESS_LAYER,
        type: 'symbol',
        source: RESULT_SOURCE,
        filter: ['==', ['get', 'kind'], 'guess'],
        layout: {
          'icon-image': GUESS_IMAGE_ID,
          'icon-offset': [0, -20],
          'icon-allow-overlap': true,
          'icon-ignore-placement': true
        }
      });
    }).catch(() => { /* keep results usable if marker artwork cannot load */ });
  }

  invalidate() {
    this.installRevision++;
  }

  async currentMarkerSprites() {
    const accent = this.accent;
    const sprites = await markerSprites(accent);
    return accent === this.accent ? sprites : this.currentMarkerSprites();
  }

  putImage(id, data) {
    if (this.map.hasImage(id)) this.map.updateImage(id, data);
    else this.map.addImage(id, data, { pixelRatio: SPRITE_SCALE });
  }

  setResults(results, trail = null) {
    this.results = results.filter((result) => isPoint(result?.actual));
    const features = [];

    this.results.forEach(({ actual, guess }, index) => {
      features.push(feature(
        'actual',
        { type: 'Point', coordinates: coordinates(actual) },
        { index }
      ));
      if (!isPoint(guess)) return;
      features.push(feature(
        'guess',
        { type: 'Point', coordinates: coordinates(guess) },
        { index }
      ));
      features.push(feature(
        'link',
        {
          type: 'LineString',
          coordinates: unwrapLine([guess, actual])
        }
      ));
    });

    const trailLines = (trail || [])
      .map((segment) => unwrapLine(segment.filter(isPoint)))
      .filter((segment) => segment.length);
    const showTrail = trailLines.some((segment) => segment.length > 1);
    if (showTrail) {
      for (const line of trailLines.filter((item) => item.length > 1)) {
        features.push(feature('trail', { type: 'LineString', coordinates: line }));
      }
      features.push(feature('trail-end', {
        type: 'Point', coordinates: trailLines.at(-1).at(-1)
      }));
    }

    this.data = { type: 'FeatureCollection', features };
    this.map.getSource(RESULT_SOURCE)?.setData(this.data);
  }

  setAccent(accent) {
    if (accent === this.accent) return;
    this.accent = accent;
    if (this.dark && this.map.getLayer('result-links')) {
      this.map.setPaintProperty('result-links', 'line-color', accent);
    }
    if (this.map.getLayer('movement-trail')) {
      this.map.setPaintProperty('movement-trail', 'line-color', accent);
      this.map.setPaintProperty('movement-trail-end', 'circle-stroke-color', accent);
    }
    markerSprites(accent).then(({ guess }) => {
      if (accent === this.accent && this.map.hasImage(GUESS_IMAGE_ID)) {
        this.map.updateImage(GUESS_IMAGE_ID, guess);
      }
    }).catch(() => {});
  }

  linkColor() {
    return this.dark ? this.accent : LIGHT_MAP_LINK_COLOR;
  }

  setDark(dark) {
    if (dark === this.dark) return;
    this.dark = dark;
    if (this.map.getLayer('result-links')) {
      this.map.setPaintProperty('result-links', 'line-color', this.linkColor());
    }
  }

  answerAt(point) {
    if (!point || !this.map.getLayer(ACTUAL_LAYER)) return null;
    const feature = this.map.queryRenderedFeatures(point, { layers: [ACTUAL_LAYER] })[0];
    const index = Number(feature?.properties?.index);
    return Number.isInteger(index) ? this.results[index]?.actual || null : null;
  }

  updateCursor(point = null) {
    if (this.dragging) return;
    this.setCursor(this.answerAt(point) ? 'pointer' : 'crosshair');
  }

  setCursor(cursor) {
    this.map.getCanvas().style.cursor = cursor;
  }
}
