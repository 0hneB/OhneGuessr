import { afterEach, describe, expect, it, vi } from 'vitest';

const UNIFORM_FUNCTIONS = [
  'uniform1f', 'uniform1fv', 'uniform1i', 'uniform1iv',
  'uniform2f', 'uniform2fv', 'uniform2i', 'uniform2iv',
  'uniform3f', 'uniform3fv', 'uniform3i', 'uniform3iv',
  'uniform4f', 'uniform4fv', 'uniform4i', 'uniform4iv',
  'uniformMatrix2fv', 'uniformMatrix3fv', 'uniformMatrix4fv'
];

function fakeWebGl() {
  const programs: object[] = [];
  const useProgram = vi.fn();
  const uniform1f = vi.fn();
  const gl: Record<string, unknown> = {
    VERTEX_SHADER: 0x8b31,
    FRAGMENT_SHADER: 0x8b30,
    LINK_STATUS: 0x8b82,
    createShader: vi.fn((type: number) => ({ type })),
    createProgram: vi.fn(() => {
      const program = { id: programs.length };
      programs.push(program);
      return program;
    }),
    shaderSource: vi.fn(),
    compileShader: vi.fn(),
    attachShader: vi.fn(),
    linkProgram: vi.fn(),
    getProgramParameter: vi.fn(() => true),
    deleteShader: vi.fn(),
    deleteProgram: vi.fn(),
    getUniformLocation: vi.fn((program: object, name: string) => ({ program, name })),
    useProgram
  };
  for (const name of UNIFORM_FUNCTIONS) gl[name] = name === 'uniform1f' ? uniform1f : vi.fn();
  return { gl, programs, useProgram, uniform1f };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('Street View car mask', () => {
  it('switches programs live and keeps mid-frame uniforms on the bound program', async () => {
    const canvases: FakeCanvas[] = [];
    class FakeCanvas {
      classList = { contains: (name: string) => name === this.className };
      dispatchEvent = vi.fn();
      constructor(readonly gl: Record<string, unknown>, readonly className = '') { canvases.push(this); }
      getContext(_type?: string, _attributes?: object) { return this.gl; }
    }

    vi.stubGlobal('HTMLCanvasElement', FakeCanvas);
    vi.stubGlobal('MouseEvent', class {});
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    vi.stubGlobal('document', { querySelectorAll: () => canvases });

    const { installCarMask, setCarHidden } = await import('./car-mask.js');
    const first = fakeWebGl();
    const canvas = new FakeCanvas(first.gl);
    installCarMask();
    canvas.getContext('webgl', { preserveDrawingBuffer: false });

    const map = fakeWebGl();
    new FakeCanvas(map.gl, 'maplibregl-canvas')
      .getContext('webgl', { preserveDrawingBuffer: false });
    expect(map.programs).toHaveLength(0);

    const carProgram = first.programs[0];
    const sceneProgram = { id: 'scene' };
    const sceneShader = { id: 'fragment' };
    const gl = first.gl as Record<string, (...args: any[]) => any>;
    gl.shaderSource(sceneShader, 'void main(){texture2DProj(g,a);}');
    gl.attachShader(sceneProgram, sceneShader);
    const alpha = gl.getUniformLocation(sceneProgram, 'f');

    gl.useProgram(sceneProgram);
    gl.uniform1f(alpha, 1);
    expect(first.useProgram).toHaveBeenLastCalledWith(sceneProgram);

    setCarHidden(true);
    gl.useProgram(sceneProgram);
    expect(first.useProgram).toHaveBeenLastCalledWith(carProgram);

    setCarHidden(false);
    gl.uniform1f(alpha, 0.5);
    expect(first.uniform1f.mock.lastCall?.[0]).toMatchObject({ program: carProgram, name: 'f' });
    gl.useProgram(sceneProgram);
    expect(first.useProgram).toHaveBeenLastCalledWith(sceneProgram);

    setCarHidden(true);
    const second = fakeWebGl();
    const secondCanvas = new FakeCanvas(second.gl);
    secondCanvas.getContext('webgl', { preserveDrawingBuffer: false });
    const secondScene = { id: 'second-scene' };
    const secondShader = { id: 'second-fragment' };
    const secondGl = second.gl as Record<string, (...args: any[]) => any>;
    secondGl.shaderSource(secondShader, 'void main(){texture2DProj(g,a);}');
    secondGl.attachShader(secondScene, secondShader);
    secondGl.useProgram(secondScene);
    expect(second.useProgram).toHaveBeenLastCalledWith(second.programs[0]);
  });
});
