/* eslint-disable @typescript-eslint/no-explicit-any */

const CAR_FRAGMENT_SHADER = `precision highp float;
varying vec3 a;
varying vec3 eyeDirection;
uniform vec4 b;
uniform float f;
uniform sampler2D g;
void main() {
    vec2 texCoord = a.xy / a.z;
    vec4 color = vec4(texture2D(g, texCoord).rgb, f);
    vec2 direction = eyeDirection.xy / a.z;
    direction.x = abs(direction.x * 4.0 - 2.0);
    direction.x = smoothstep(0.0, 1.0, direction.x > 1.0 ? 2.0 - direction.x : direction.x);
    float carMask = step(direction.y, mix(0.6, 0.7, direction.x));
    color.rgb = mix(vec3(0.6), color.rgb, carMask);
    gl_FragColor = color;
}`;

const CAR_VERTEX_SHADER = `varying vec3 a;
varying vec3 eyeDirection;
uniform vec4 b;
attribute vec3 c;
attribute vec2 d;
uniform mat4 e;
void main() {
    vec4 g = vec4(c, 1.0);
    gl_Position = e * g;
    eyeDirection = vec3(d.x, d.y, 1.0) * length(c);
    a = vec3(d.xy * b.xy + b.zw, 1.0);
    a *= length(c);
}`;

const SCENE_SHADER_MARKER = 'texture2DProj(g,a)';
const UNIFORM_FUNCTIONS = [
  'uniform1f', 'uniform1fv', 'uniform1i', 'uniform1iv',
  'uniform2f', 'uniform2fv', 'uniform2i', 'uniform2iv',
  'uniform3f', 'uniform3fv', 'uniform3i', 'uniform3iv',
  'uniform4f', 'uniform4fv', 'uniform4i', 'uniform4iv',
  'uniformMatrix2fv', 'uniformMatrix3fv', 'uniformMatrix4fv'
] as const;

type UniformCall = { fn: (...args: any[]) => void; args: any[] };

let hidden = false;
let installed = false;
const hookedContexts = new WeakSet<object>();
const hookedCanvases = new WeakSet<HTMLCanvasElement>();

function refreshPanoramas() {
  if (typeof document === 'undefined' || typeof requestAnimationFrame === 'undefined') return;
  const redraw = () => {
    for (const canvas of document.querySelectorAll<HTMLCanvasElement>('canvas')) {
      if (!hookedCanvases.has(canvas)) continue;
      canvas.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, cancelable: true }));
    }
  };
  requestAnimationFrame(() => {
    redraw();
    requestAnimationFrame(redraw);
  });
}

export function setCarHidden(value: boolean) {
  if (hidden === value) return;
  hidden = value;
  refreshPanoramas();
}

function compileCarProgram(
  gl: WebGLRenderingContext,
  shaderSource: WebGLRenderingContext['shaderSource'],
  attachShader: WebGLRenderingContext['attachShader']
) {
  const vertex = gl.createShader(gl.VERTEX_SHADER);
  const fragment = gl.createShader(gl.FRAGMENT_SHADER);
  const program = gl.createProgram();
  if (!vertex || !fragment || !program) return null;

  shaderSource(vertex, CAR_VERTEX_SHADER);
  gl.compileShader(vertex);
  shaderSource(fragment, CAR_FRAGMENT_SHADER);
  gl.compileShader(fragment);
  attachShader(program, vertex);
  attachShader(program, fragment);
  gl.linkProgram(program);
  const linked = gl.getProgramParameter(program, gl.LINK_STATUS);
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);
  if (linked) return program;
  console.warn('[street-view] hide-car shader failed to link');
  gl.deleteProgram(program);
  return null;
}

function installShaderHooks(gl: WebGLRenderingContext) {
  if (hookedContexts.has(gl)) return;
  hookedContexts.add(gl);

  const originalShaderSource = gl.shaderSource.bind(gl);
  const originalAttachShader = gl.attachShader.bind(gl);
  const originalGetUniformLocation = gl.getUniformLocation.bind(gl);
  const originalUseProgram = gl.useProgram.bind(gl);
  const carProgram = compileCarProgram(gl, originalShaderSource, originalAttachShader);
  if (!carProgram) return;

  const sceneShaders = new WeakSet<WebGLShader>();
  const scenePrograms = new WeakSet<WebGLProgram>();
  const locationInfo = new WeakMap<WebGLUniformLocation, { program: WebGLProgram; name: string }>();
  const locations = new WeakMap<WebGLProgram, Map<string, WebGLUniformLocation | null>>();
  const savedUniforms = new WeakMap<WebGLProgram, Map<string, UniformCall>>();
  let currentProgram: WebGLProgram | null = null;
  let activeProgram: WebGLProgram | null = null;
  let appliedHidden = false;

  const locationFor = (program: WebGLProgram, name: string) => {
    let cache = locations.get(program);
    if (!cache) {
      cache = new Map();
      locations.set(program, cache);
    }
    if (!cache.has(name)) cache.set(name, originalGetUniformLocation(program, name));
    return cache.get(name) ?? null;
  };

  const replayUniforms = (source: WebGLProgram, target: WebGLProgram) => {
    for (const [name, call] of savedUniforms.get(source) ?? []) {
      const location = locationFor(target, name);
      if (location) call.fn(location, ...call.args);
    }
  };

  gl.shaderSource = ((shader: WebGLShader, source: string) => {
    if (source.includes(SCENE_SHADER_MARKER)) sceneShaders.add(shader);
    originalShaderSource(shader, source);
  }) as typeof gl.shaderSource;

  gl.attachShader = ((program: WebGLProgram, shader: WebGLShader) => {
    if (sceneShaders.has(shader)) scenePrograms.add(program);
    originalAttachShader(program, shader);
  }) as typeof gl.attachShader;

  gl.getUniformLocation = ((program: WebGLProgram, name: string) => {
    const location = originalGetUniformLocation(program, name);
    if (scenePrograms.has(program)) {
      let cache = locations.get(program);
      if (!cache) {
        cache = new Map();
        locations.set(program, cache);
      }
      cache.set(name, location);
      if (location) locationInfo.set(location, { program, name });
    }
    return location;
  }) as typeof gl.getUniformLocation;

  gl.useProgram = ((program: WebGLProgram | null) => {
    currentProgram = program;
    if (!program || !scenePrograms.has(program)) {
      activeProgram = program;
      originalUseProgram(program);
      return;
    }

    const target = hidden ? carProgram : program;
    originalUseProgram(target);
    activeProgram = target;
    if (appliedHidden !== hidden) {
      appliedHidden = hidden;
      replayUniforms(program, target);
    }
  }) as typeof gl.useProgram;

  const methods = gl as unknown as Record<string, (...args: any[]) => void>;
  for (const name of UNIFORM_FUNCTIONS) {
    const original = methods[name].bind(gl);
    methods[name] = (...args: any[]) => {
      const location = args[0] as WebGLUniformLocation | null;
      const info = location ? locationInfo.get(location) : undefined;
      if (info && currentProgram === info.program) {
        let saved = savedUniforms.get(info.program);
        if (!saved) {
          saved = new Map();
          savedUniforms.set(info.program, saved);
        }
        saved.set(info.name, { fn: original, args: args.slice(1) });

        if (activeProgram === carProgram) {
          const translated = locationFor(carProgram, info.name);
          if (!translated) return;
          args[0] = translated;
        } else if (activeProgram !== info.program) {
          return;
        }
      }
      original(...args);
    };
  }
}

export function installCarMask() {
  if (installed || typeof HTMLCanvasElement === 'undefined') return;
  installed = true;
  const getContext = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, ...args: any[]) {
    const context = getContext.apply(this, args as any);
    const type = args[0];
    const attributes = args[1];
    if (context && typeof type === 'string' && type.startsWith('webgl') &&
        attributes && typeof attributes === 'object' && 'preserveDrawingBuffer' in attributes &&
        !this.classList.contains('maplibregl-canvas')) {
      hookedCanvases.add(this);
      installShaderHooks(context as WebGLRenderingContext);
    }
    return context;
  } as typeof getContext;
}
