/**
 * WebGL2 gerçek zamanlı renk düzenleme motoru.
 * Video karesini GPU dokusuna yükler, Lift/Gamma/Gain, Exposure, Contrast,
 * Temperature, Tint, Saturation ve 3D LUT (trilineer) + Split-Screen Wipe uygular.
 */
import { wheelToRgbOffset, type ColorGrade } from '../../../shared/color'
import type { Lut3D } from '../../../shared/lut'

const VERT_SRC = `#version 300 es
in vec2 a_pos;
out vec2 v_uv;
void main() {
  v_uv = vec2(a_pos.x * 0.5 + 0.5, 1.0 - (a_pos.y * 0.5 + 0.5));
  gl_Position = vec4(a_pos, 0.0, 1.0);
}`

const FRAG_SRC = `#version 300 es
precision highp float;
precision highp sampler3D;

in vec2 v_uv;
out vec4 outColor;

uniform sampler2D u_video;
uniform sampler3D u_lut;

uniform float u_exposure;
uniform float u_contrast;
uniform float u_temperature;
uniform float u_tint;
uniform float u_saturation;
uniform vec3 u_lift;
uniform vec3 u_gamma;
uniform vec3 u_gain;
uniform float u_hasLut;
uniform float u_lutIntensity;
uniform float u_split;
uniform float u_wipe;

void main() {
  vec4 texel = texture(u_video, v_uv);
  vec3 raw = texel.rgb;

  if (u_split > 0.5 && v_uv.x < u_wipe) {
    outColor = vec4(raw, 1.0);
    return;
  }

  vec3 c = raw;

  // 1) Exposure
  c *= exp2(u_exposure);

  // 2) Temperature & Tint
  c.r += u_temperature * 0.12 + u_tint * 0.05;
  c.g -= u_tint * 0.10;
  c.b += -u_temperature * 0.12 + u_tint * 0.05;

  // 3) Contrast
  float contrast = 1.0 + u_contrast * 0.65;
  c = (c - 0.5) * contrast + 0.5;

  // 4) Lift / Gain / Gamma
  c = clamp(c, 0.0, 1.0);
  c = c + u_lift * (1.0 - c);
  c = clamp(c * (1.0 + u_gain), 0.0, 1.0);
  c = pow(c, 1.0 / max(vec3(0.2), 1.0 + u_gamma));

  // 5) Saturation
  float luma = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c = clamp(mix(vec3(luma), c, u_saturation), 0.0, 1.0);

  // 6) 3D LUT + Intensity
  if (u_hasLut > 0.5 && u_lutIntensity > 0.001) {
    vec3 lutColor = texture(u_lut, c).rgb;
    c = mix(c, lutColor, u_lutIntensity);
  }

  outColor = vec4(clamp(c, 0.0, 1.0), 1.0);
}`

function compileShader(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader {
  const s = gl.createShader(type)
  if (!s) throw new Error('WebGL shader oluşturulamadı')
  gl.shaderSource(s, src)
  gl.compileShader(s)
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(s)
    gl.deleteShader(s)
    throw new Error(`Shader derleme hatası: ${log}`)
  }
  return s
}

export class WebGLColorEngine {
  private gl: WebGL2RenderingContext
  private program: WebGLProgram
  private videoTex: WebGLTexture
  private lutTex: WebGLTexture
  private vao: WebGLVertexArrayObject
  private vbo: WebGLBuffer
  private uploadedLutKey = ''

  private loc: Record<string, WebGLUniformLocation | null>

  constructor(canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl2', {
      alpha: false,
      antialias: false,
      powerPreference: 'high-performance'
    })
    if (!gl) throw new Error('WebGL2 desteklenmiyor')
    this.gl = gl

    const vs = compileShader(gl, gl.VERTEX_SHADER, VERT_SRC)
    const fs = compileShader(gl, gl.FRAGMENT_SHADER, FRAG_SRC)
    const prog = gl.createProgram()!
    gl.attachShader(prog, vs)
    gl.attachShader(prog, fs)
    gl.linkProgram(prog)
    gl.deleteShader(vs)
    gl.deleteShader(fs)
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      throw new Error(`Program link hatası: ${gl.getProgramInfoLog(prog)}`)
    }
    this.program = prog

    const vao = gl.createVertexArray()!
    gl.bindVertexArray(vao)
    this.vao = vao

    const vbo = gl.createBuffer()!
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo)
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
      gl.STATIC_DRAW
    )
    this.vbo = vbo

    const posLoc = gl.getAttribLocation(prog, 'a_pos')
    gl.enableVertexAttribArray(posLoc)
    gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0)

    this.videoTex = gl.createTexture()!
    gl.bindTexture(gl.TEXTURE_2D, this.videoTex)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)

    this.lutTex = gl.createTexture()!
    gl.bindTexture(gl.TEXTURE_3D, this.lutTex)
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_R, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)

    const names = [
      'u_video',
      'u_lut',
      'u_exposure',
      'u_contrast',
      'u_temperature',
      'u_tint',
      'u_saturation',
      'u_lift',
      'u_gamma',
      'u_gain',
      'u_hasLut',
      'u_lutIntensity',
      'u_split',
      'u_wipe'
    ]
    this.loc = {}
    for (const n of names) {
      this.loc[n] = gl.getUniformLocation(prog, n)
    }
  }

  private ensureLut(lut: Lut3D | null): void {
    const key = lut ? `${lut.id}:${lut.size}` : 'none'
    if (key === this.uploadedLutKey) return
    this.uploadedLutKey = key

    const gl = this.gl
    gl.activeTexture(gl.TEXTURE1)
    gl.bindTexture(gl.TEXTURE_3D, this.lutTex)
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1)

    if (!lut) {
      // 2x2x2 birim LUT
      const id = new Uint8Array([
        0, 0, 0, 255, 0, 0, 0, 255, 0, 255, 255, 0,
        0, 0, 255, 255, 0, 255, 0, 255, 255, 255, 255, 255
      ])
      gl.texImage3D(gl.TEXTURE_3D, 0, gl.RGB8, 2, 2, 2, 0, gl.RGB, gl.UNSIGNED_BYTE, id)
      return
    }

    const bytes = new Uint8Array(lut.data.length)
    for (let i = 0; i < lut.data.length; i++) {
      const v = lut.data[i]
      bytes[i] = v <= 0 ? 0 : v >= 1 ? 255 : Math.round(v * 255)
    }
    gl.texImage3D(
      gl.TEXTURE_3D,
      0,
      gl.RGB8,
      lut.size,
      lut.size,
      lut.size,
      0,
      gl.RGB,
      gl.UNSIGNED_BYTE,
      bytes
    )
  }

  render(
    video: HTMLVideoElement,
    grade: ColorGrade,
    lut: Lut3D | null,
    split: boolean,
    wipePercent: number
  ): boolean {
    if (video.readyState < 2 || video.videoWidth === 0 || video.videoHeight === 0) return false
    const gl = this.gl
    const canvas = gl.canvas as HTMLCanvasElement
    if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
      canvas.width = video.videoWidth
      canvas.height = video.videoHeight
    }

    gl.viewport(0, 0, canvas.width, canvas.height)
    gl.useProgram(this.program)
    gl.bindVertexArray(this.vao)

    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, this.videoTex)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, video)

    this.ensureLut(lut)

    const lift = wheelToRgbOffset(grade.lift, 0.55, 0.35)
    const gamma = wheelToRgbOffset(grade.gamma, 0.75, 0.6)
    const gain = wheelToRgbOffset(grade.gain, 0.75, 0.6)

    gl.uniform1i(this.loc['u_video'], 0)
    gl.uniform1i(this.loc['u_lut'], 1)
    gl.uniform1f(this.loc['u_exposure'], grade.exposure)
    gl.uniform1f(this.loc['u_contrast'], grade.contrast / 100)
    gl.uniform1f(this.loc['u_temperature'], grade.temperature / 100)
    gl.uniform1f(this.loc['u_tint'], grade.tint / 100)
    gl.uniform1f(this.loc['u_saturation'], grade.saturation / 100)
    gl.uniform3f(this.loc['u_lift'], lift[0], lift[1], lift[2])
    gl.uniform3f(this.loc['u_gamma'], gamma[0], gamma[1], gamma[2])
    gl.uniform3f(this.loc['u_gain'], gain[0], gain[1], gain[2])
    gl.uniform1f(this.loc['u_hasLut'], lut ? 1 : 0)
    gl.uniform1f(this.loc['u_lutIntensity'], grade.lutIntensity / 100)
    gl.uniform1f(this.loc['u_split'], split ? 1 : 0)
    gl.uniform1f(this.loc['u_wipe'], wipePercent / 100)

    gl.drawArrays(gl.TRIANGLES, 0, 6)
    return true
  }

  dispose(): void {
    const gl = this.gl
    gl.deleteTexture(this.videoTex)
    gl.deleteTexture(this.lutTex)
    gl.deleteBuffer(this.vbo)
    gl.deleteVertexArray(this.vao)
    gl.deleteProgram(this.program)
  }
}
