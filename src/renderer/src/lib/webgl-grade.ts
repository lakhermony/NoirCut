/**
 * WebGL2 gerçek zamanlı renk düzenleme motoru.
 * Video karesini GPU dokusuna yükler; Lift/Gamma/Gain/Offset, Exposure, Contrast,
 * Highlights/Shadows, Temperature/Tint, Custom RGB & Luma Curves, Hue vs Sat / Hue vs Hue,
 * Vibrance, Saturation, 3D LUT (trilineer), Vignette, Film Grain ve Split-Screen Wipe uygular.
 */
import {
  areCurvesNeutral,
  areHueBandsNeutral,
  buildCurveLut256,
  cameraProfileIndex,
  defaultHueBands,
  neutralWheel,
  wheelToRgbOffset,
  type ColorGrade
} from '../../../shared/color'
import type { Lut3D } from '../../../shared/lut'
import { hexToRgb01 } from '../../../shared/noirfilm'
import {
  HALATION_GAIN,
  HALATION_TINT,
  analogGrainParams,
  analogHalationParams,
  defaultAnalogFilm,
  isAnalogFilmActive,
  isAnalogGrainActive,
  isAnalogHalationActive
} from '../../../shared/analog-film'

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
uniform sampler2D u_curves;

uniform float u_exposure;
uniform float u_contrast;
uniform float u_highlights;
uniform float u_shadows;
uniform float u_temperature;
uniform float u_tint;
uniform float u_vibrance;
uniform float u_saturation;
uniform float u_vignette;
uniform float u_filmGrain;
uniform float u_time;
uniform vec3 u_lift;
uniform vec3 u_gamma;
uniform vec3 u_gain;
uniform vec3 u_offset;
uniform float u_hasCurves;
uniform float u_hasHueVs;
uniform float u_hueVsSat[6];
uniform float u_hueVsHue[6];
uniform float u_hasLut;
uniform float u_lutIntensity;
uniform float u_split;
uniform float u_wipe;
uniform float u_profile;
uniform float u_halation;
uniform float u_mist;
uniform float u_falseColor;
uniform vec2 u_texel;

// NoirFilm uniforms
uniform float u_nfIntensity;
uniform float u_nfEmuEnabled;
uniform float u_nfEmuFormat;
uniform vec4 u_nfEmu1;
uniform vec4 u_nfEmu2;
uniform vec3 u_nfEmuHiTint;
uniform vec3 u_nfEmuShTint;
uniform vec4 u_nfHalation;
uniform vec3 u_nfHalationColor;
uniform float u_nfHalationBlend;
uniform vec4 u_nfBloom;
uniform float u_nfBloomHi;
uniform vec4 u_nfDiffusion;
uniform vec4 u_nfMist;
uniform vec4 u_nfGrain1;
uniform vec4 u_nfGrain2;
uniform float u_compareMode;
uniform vec4 u_ckParams; // x: enabled, y: tolerance, z: edgeSoftness, w: spillSuppression
uniform vec3 u_ckColor;
uniform vec3 u_ckBgColor;
uniform vec2 u_ckModes; // x: mattePreview, y: opacity01

float logLinear(float x, int p) {
  if (p == 1) {
    return x >= 0.100537775
      ? (pow(10.0, (x - 0.790453) / 0.344676) - 0.009468) / 0.555556
      : (x - 0.092864) / 8.735631;
  }
  if (p == 2) {
    return x >= 0.100686685
      ? (pow(10.0, (x - 0.384316) / 0.245281) - 0.064829) / 5.555556
      : (x - 0.092864) / 8.799461;
  }
  if (p == 3) {
    return x >= 171.2102946929 / 1023.0
      ? pow(10.0, (x * 1023.0 - 420.0) / 261.5) * 0.19 - 0.01
      : ((x * 1023.0 - 95.0) * 0.01125) / (171.2102946929 - 95.0);
  }
  if (p == 4) {
    return x > 0.14
      ? (pow(10.0, 3.89616 * x - 2.27752) - 0.0929) / 0.9892
      : (x - 0.0929) / 6.025;
  }
  return x;
}

float rec709Oetf(float l) {
  float v = clamp(l, 0.0, 1.0);
  return v < 0.018 ? 4.5 * v : 1.099 * pow(v, 0.45) - 0.099;
}

vec3 applyProfile(vec3 c) {
  int p = int(u_profile + 0.5);
  if (p == 0) return c;
  return vec3(
    rec709Oetf(logLinear(c.r, p)),
    rec709Oetf(logLinear(c.g, p)),
    rec709Oetf(logLinear(c.b, p))
  );
}

// Parlak bölgeleri toplayan disk örnekleyici (Halation: kırmızı ton, Mist: nötr)
void gatherGlow(vec2 uv, float radiusPx, out vec3 hal, out vec3 mist) {
  hal = vec3(0.0);
  mist = vec3(0.0);
  float wsum = 0.0;
  for (int ring = 1; ring <= 3; ring++) {
    float rr = radiusPx * float(ring) / 3.0;
    for (int i = 0; i < 8; i++) {
      float a = 6.2831853 * (float(i) + 0.5 * float(ring)) / 8.0;
      vec2 off = vec2(cos(a), sin(a)) * rr * u_texel;
      vec3 s = applyProfile(texture(u_video, uv + off).rgb);
      float l = dot(s, vec3(0.2126, 0.7152, 0.0722));
      float w = 1.0 / float(ring);
      hal += s * smoothstep(0.62, 0.95, l) * w;
      mist += s * smoothstep(0.35, 0.9, l) * w;
      wsum += w;
    }
  }
  hal /= wsum;
  mist /= wsum;
}

vec3 falseColorMap(vec3 c) {
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  vec3 g = vec3(l * 0.85 + 0.05);
  if (l < 0.04) return vec3(0.42, 0.12, 0.78);
  if (l < 0.10) return mix(vec3(0.42, 0.12, 0.78), vec3(0.15, 0.35, 0.90), (l - 0.04) / 0.06);
  if (l >= 0.40 && l < 0.44) return vec3(0.13, 0.78, 0.35);
  if (l >= 0.52 && l < 0.68) return vec3(0.96, 0.45, 0.70);
  if (l >= 0.94 && l < 0.98) return vec3(0.98, 0.80, 0.10);
  if (l >= 0.98) return vec3(0.93, 0.15, 0.12);
  return g;
}

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

vec3 rgb2hsv(vec3 c) {
  vec4 K = vec4(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
  vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
  vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
  float d = q.x - min(q.w, q.y);
  float e = 1.0e-10;
  return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + e)) * 360.0, d / (q.x + e), q.x);
}

vec3 hsv2rgb(vec3 c) {
  vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
  vec3 p = abs(fract(vec3(c.x / 360.0) + K.xyz) * 6.0 - K.www);
  return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
}

vec3 applyFilmEmulation(vec3 cIn) {
  if (u_nfEmuEnabled < 0.5 || u_nfIntensity <= 0.001) return cIn;
  vec3 c = cIn;
  float fmt = u_nfEmuFormat;
  float fmtContrast = fmt > 1.5 ? 0.14 : (fmt > 0.5 ? 0.08 : 0.04);
  float fmtRoll = fmt > 1.5 ? 0.22 : (fmt > 0.5 ? 0.18 : 0.12);

  float temp = u_nfEmu2.y * 0.14;
  c.r = clamp(c.r + temp, 0.0, 1.0);
  c.b = clamp(c.b - temp, 0.0, 1.0);

  float sh = u_nfEmu1.z;
  float resp = u_nfEmu2.z;
  vec3 toe = sh * 0.12 * (1.0 - c) * (1.0 - c);
  vec3 mid = resp * 0.14 * c * (1.0 - c) * (c - 0.5) * -4.0;
  c = clamp(c + toe + mid, 0.0, 1.0);

  float k = 1.0 + u_nfEmu1.x * 0.7 + fmtContrast;
  c = clamp((c - 0.5) * k + 0.5, 0.0, 1.0);

  float roll = clamp(u_nfEmu1.y + fmtRoll, 0.0, 1.0);
  if (roll > 0.001) {
    float knee = 0.62 - roll * 0.18;
    float denom = max(0.001, 1.0 - knee);
    float eDenom = 1.0 - exp(-(1.0 + roll * 1.4));
    vec3 over = max(vec3(0.0), c - knee);
    vec3 t = over / denom;
    vec3 comp = knee + denom * (1.0 - exp(-t * (1.0 + roll * 1.4))) / eDenom;
    vec3 mask = step(vec3(knee), c);
    c = clamp(mix(c, mix(c, comp, roll), mask), 0.0, 1.0);
  }

  float density = u_nfEmu2.x;
  if (abs(density) > 0.001) {
    float maxC = max(c.r, max(c.g, c.b));
    float minC = min(c.r, min(c.g, c.b));
    float chroma = maxC - minC;
    c = clamp(c * (1.0 - density * 0.24 * chroma), 0.0, 1.0);
  }
  float luma2 = dot(c, vec3(0.2126, 0.7152, 0.0722));
  float effSat = max(0.0, u_nfEmu1.w * (1.0 + density * 0.22));
  c = clamp(mix(vec3(luma2), c, effSat), 0.0, 1.0);

  float hiW = pow(clamp(luma2, 0.0, 1.0), 1.6) * 0.22;
  float shW = pow(clamp(1.0 - luma2, 0.0, 1.0), 1.8) * 0.24;
  c = clamp(c + (u_nfEmuHiTint - 0.95) * hiW + (u_nfEmuShTint - 0.08) * shW, 0.0, 1.0);

  return mix(cIn, c, u_nfIntensity);
}

vec3 sampleGlowAt(vec2 uv, float radiusPx, float threshold) {
  vec3 acc = vec3(0.0);
  float wsum = 0.0;
  for (int ring = 1; ring <= 3; ring++) {
    float rr = radiusPx * float(ring) / 3.0;
    for (int i = 0; i < 8; i++) {
      float a = 6.2831853 * (float(i) + 0.5 * float(ring)) / 8.0;
      vec2 off = vec2(cos(a), sin(a)) * rr * u_texel;
      vec3 s = applyProfile(texture(u_video, clamp(uv + off, 0.001, 0.999)).rgb);
      float l = dot(s, vec3(0.2126, 0.7152, 0.0722));
      float w = 1.0 / float(ring);
      acc += s * smoothstep(threshold - 0.15, min(0.99, threshold + 0.28), l) * w;
      wsum += w;
    }
  }
  return acc / max(0.001, wsum);
}

void main() {
  vec2 sampleUv = v_uv;
  if (u_compareMode > 2.5 && u_compareMode < 3.5) {
    sampleUv.x = fract(v_uv.x * 2.0);
  }
  vec4 texel = texture(u_video, sampleUv);
  vec3 raw = texel.rgb;

  if (u_ckParams.x > 0.5) {
    float dist = distance(raw, u_ckColor);
    float tol = max(0.01, u_ckParams.y);
    float soft = max(0.005, u_ckParams.z);
    float mask = smoothstep(tol, tol + soft, dist);
    if (u_ckModes.x > 0.5) {
      outColor = vec4(vec3(mask), 1.0);
      return;
    }
    float spill = u_ckParams.w;
    if (spill > 0.001) {
      float avgRB = 0.5 * (raw.r + raw.b);
      float avgRG = 0.5 * (raw.r + raw.g);
      if (u_ckColor.g > u_ckColor.b && raw.g > avgRB) {
        raw.g = mix(raw.g, avgRB, spill * (1.0 - mask * 0.5));
      } else if (u_ckColor.b > u_ckColor.g && raw.b > avgRG) {
        raw.b = mix(raw.b, avgRG, spill * (1.0 - mask * 0.5));
      }
    }
    raw = mix(u_ckBgColor, raw, mask * u_ckModes.y);
  }

  if (u_compareMode > 3.5) {
    outColor = vec4(raw, 1.0);
    return;
  }
  if (u_compareMode > 2.5 && v_uv.x < 0.5) {
    outColor = vec4(raw, 1.0);
    return;
  }
  if ((u_compareMode > 0.5 && u_compareMode < 1.5 && v_uv.x < u_wipe) ||
      (u_compareMode > 1.5 && u_compareMode < 2.5 && v_uv.y < u_wipe) ||
      (u_split > 0.5 && v_uv.x < u_wipe)) {
    outColor = vec4(raw, 1.0);
    return;
  }

  vec3 c = applyProfile(raw);

  // 1) Exposure
  c *= exp2(u_exposure);

  // 2) Temperature & Tint
  c.r += u_temperature * 0.12 + u_tint * 0.05;
  c.g -= u_tint * 0.10;
  c.b += -u_temperature * 0.12 + u_tint * 0.05;

  // 3) Contrast
  float contrast = 1.0 + u_contrast * 0.65;
  c = (c - 0.5) * contrast + 0.5;

  // 3b) Shadows & Highlights
  if (abs(u_shadows) > 0.001 || abs(u_highlights) > 0.001) {
    float l = clamp(dot(c, vec3(0.2126, 0.7152, 0.0722)), 0.0, 1.0);
    float sMask = pow(1.0 - l, 1.6);
    float hMask = pow(l, 1.6);
    c += vec3(u_shadows * 0.28 * sMask + u_highlights * 0.28 * hMask);
  }

  // 4) Lift / Gain / Gamma / Offset
  c = clamp(c, 0.0, 1.0);
  c = c + u_lift * (1.0 - c);
  c = clamp(c * (1.0 + u_gain), 0.0, 1.0);
  c = pow(c, 1.0 / max(vec3(0.2), 1.0 + u_gamma));
  c = clamp(c + u_offset, 0.0, 1.0);

  // 4b) Custom RGB & Luma Curves (256x1 RGBA LUT)
  if (u_hasCurves > 0.5) {
    float rC = texture(u_curves, vec2(c.r, 0.5)).r;
    float gC = texture(u_curves, vec2(c.g, 0.5)).g;
    float bC = texture(u_curves, vec2(c.b, 0.5)).b;
    c.r = texture(u_curves, vec2(rC, 0.5)).a;
    c.g = texture(u_curves, vec2(gC, 0.5)).a;
    c.b = texture(u_curves, vec2(bC, 0.5)).a;
  }

  // 4c) Selective Color Curves (Hue vs Sat & Hue vs Hue)
  if (u_hasHueVs > 0.5) {
    vec3 hsv = rgb2hsv(c);
    if (hsv.y > 0.02 && hsv.z > 0.02) {
      float centers[6] = float[6](0.0, 30.0, 60.0, 120.0, 180.0, 240.0);
      float widths[6]  = float[6](38.0, 32.0, 42.0, 65.0, 65.0, 75.0);
      float satDelta = 0.0;
      float hueDelta = 0.0;
      for (int i = 0; i < 6; i++) {
        float diff = abs(hsv.x - centers[i]);
        if (diff > 180.0) diff = 360.0 - diff;
        if (diff < widths[i]) {
          float w = 0.5 * (1.0 + cos(3.14159265 * (diff / widths[i])));
          satDelta += w * u_hueVsSat[i];
          hueDelta += w * u_hueVsHue[i] * 45.0;
        }
      }
      hsv.x = mod(hsv.x + hueDelta + 360.0, 360.0);
      hsv.y = clamp(hsv.y * max(0.0, 1.0 + satDelta), 0.0, 1.0);
      c = hsv2rgb(hsv);
    }
  }

  // 5) Vibrance (Skin-Tone Protected) + Saturation
  float luma = dot(c, vec3(0.2126, 0.7152, 0.0722));
  float effSat = u_saturation;
  if (abs(u_vibrance) > 0.001) {
    float maxC = max(c.r, max(c.g, c.b));
    float minC = min(c.r, min(c.g, c.b));
    float chroma = maxC - minC;
    float skinProtect = 1.0;
    if (u_vibrance > 0.0 && c.r > c.g && c.g > c.b && maxC > 0.08) {
      vec3 hsv = rgb2hsv(c);
      float dist = abs(hsv.x - 26.0);
      if (dist < 28.0) {
        skinProtect = 1.0 - 0.55 * (1.0 - dist / 28.0);
      }
    }
    float vibFactor = 1.0 + u_vibrance * (1.0 - chroma * chroma) * skinProtect;
    effSat *= max(0.0, vibFactor);
  }
  c = clamp(mix(vec3(luma), c, effSat), 0.0, 1.0);

  // 6) 3D LUT + Intensity
  if (u_hasLut > 0.5 && u_lutIntensity > 0.001) {
    vec3 lutColor = texture(u_lut, c).rgb;
    c = mix(c, lutColor, u_lutIntensity);
  }

  // 6a) NoirFilm Dijital Film Emülasyonu
  c = applyFilmEmulation(c);

  // 6b) Sinema Lens Fiziği: Klasik + NoirFilm Işık Efektleri
  float sizeScale = max(1.0, 1.0 / (u_texel.y * 1080.0));
  if (u_halation > 0.001 || u_mist > 0.001) {
    float rad = (6.0 + 22.0 * max(u_halation, u_mist)) * sizeScale;
    vec3 hal;
    vec3 mst;
    gatherGlow(sampleUv, rad, hal, mst);
    vec3 halTint = vec3(1.0, 0.30, 0.05) * dot(hal, vec3(0.2126, 0.7152, 0.0722)) * 2.2;
    c = 1.0 - (1.0 - c) * (1.0 - clamp(halTint * u_halation, 0.0, 1.0));
    c = 1.0 - (1.0 - c) * (1.0 - clamp(mst * u_mist * 0.75, 0.0, 1.0));
    c = mix(c, c * 0.92 + 0.04, u_mist * 0.5);
  }

  if (u_nfIntensity > 0.001) {
    if (u_nfHalation.x > 0.001) {
      float rad = (5.0 + 28.0 * u_nfHalation.z + 12.0 * u_nfHalation.w) * sizeScale;
      vec3 g = sampleGlowAt(sampleUv, rad, u_nfHalation.y);
      float gl = dot(g, vec3(0.2126, 0.7152, 0.0722));
      vec3 halCol = u_nfHalationColor * gl * (1.6 + u_nfHalation.w * 1.4);
      vec3 screened = 1.0 - (1.0 - c) * (1.0 - clamp(halCol * u_nfHalation.x * u_nfIntensity, 0.0, 1.0));
      c = mix(c, screened, u_nfHalationBlend);
    }
    if (u_nfBloom.x > 0.001) {
      float rad = (4.0 + 26.0 * u_nfBloom.z) * sizeScale;
      vec3 g = sampleGlowAt(sampleUv, rad, u_nfBloom.y);
      vec3 bloomAdd = g * (0.7 + u_nfBloomHi * 1.4) * (0.6 + u_nfBloom.w * 0.5);
      c = 1.0 - (1.0 - c) * (1.0 - clamp(bloomAdd * u_nfBloom.x * u_nfIntensity, 0.0, 1.0));
    }
    if (u_nfDiffusion.x > 0.001) {
      float rad = (3.0 + 16.0 * u_nfDiffusion.z) * sizeScale;
      vec3 g = sampleGlowAt(sampleUv, rad, 0.42 - u_nfDiffusion.y * 0.2);
      vec3 diffused = mix(c, max(c, g * (0.7 + u_nfDiffusion.y * 0.6)), u_nfDiffusion.x * 0.65 * u_nfIntensity);
      c = mix(diffused, mix(diffused, c, 0.35 * u_nfDiffusion.w), 0.35);
    }
    if (u_nfMist.x > 0.001) {
      float rad = (6.0 + 24.0 * u_nfMist.y) * sizeScale;
      vec3 g = sampleGlowAt(sampleUv, rad, 0.35);
      c = 1.0 - (1.0 - c) * (1.0 - clamp(g * u_nfMist.x * (0.55 + u_nfMist.z * 0.4) * u_nfIntensity, 0.0, 1.0));
      c = mix(c, c * (1.0 - 0.14 * u_nfMist.w) + 0.07 * u_nfMist.w, u_nfMist.x * 0.5 * u_nfIntensity);
    }
  }

  // 7) Optical Vignette
  if (u_vignette > 0.001) {
    vec2 d = (sampleUv - 0.5) * vec2(1.35, 1.0);
    float distSq = dot(d, d);
    float vig = 1.0 - smoothstep(0.12, 0.68, distSq) * (u_vignette * 0.88);
    c *= vig;
  }

  // 8) Organic 35mm Film Grain + NoirFilm Texture
  if (u_filmGrain > 0.001) {
    float n = hash12(sampleUv * vec2(1280.0, 720.0) + vec2(u_time * 37.0, u_time * 19.0)) - 0.5;
    float midWeight = 1.0 - abs(dot(c, vec3(0.333)) - 0.5) * 1.4;
    c += n * u_filmGrain * 0.16 * max(0.25, midWeight);
  }
  if (u_nfGrain1.x > 0.5 && u_nfGrain1.y > 0.001 && u_nfIntensity > 0.001) {
    float grainPx = mix(1.0, 3.2, u_nfGrain1.z);
    vec2 gCoord = floor((sampleUv * vec2(1280.0, 720.0)) / grainPx);
    float nLuma = hash12(gCoord + vec2(u_time * 43.0, u_time * 23.0)) - 0.5;
    float nR = hash12(gCoord + vec2(u_time * 31.0 + 17.0, u_time * 13.0)) - 0.5;
    float nG = hash12(gCoord + vec2(u_time * 29.0, u_time * 41.0 + 11.0)) - 0.5;
    float nB = hash12(gCoord + vec2(u_time * 53.0 + 7.0, u_time * 19.0)) - 0.5;
    float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
    float toneWeight = max(0.22, 1.0 - abs(l - u_nfGrain2.y) * 1.45);
    float amp = u_nfGrain1.y * (0.08 + u_nfGrain1.w * 0.14) * (1.0 - u_nfGrain2.x * 0.35) * u_nfIntensity;
    vec3 grainVec = vec3(nLuma) * u_nfGrain2.z + vec3(nR, nG, nB) * (u_nfGrain2.w * 0.65);
    c += grainVec * amp * toneWeight;
  }

  if (u_falseColor > 0.5) {
    outColor = vec4(falseColorMap(clamp(c, 0.0, 1.0)), 1.0);
    return;
  }

  outColor = vec4(clamp(c, 0.0, 1.0), 1.0);
}`

const FBO_VERT_SRC = `#version 300 es
in vec2 a_pos;
out vec2 v_uv;
void main() {
  v_uv = a_pos * 0.5 + 0.5;
  gl_Position = vec4(a_pos, 0.0, 1.0);
}`

const BLUR_FRAG_SRC = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 outColor;
uniform sampler2D u_tex;
uniform vec2 u_texelDir;
uniform float u_extract;
uniform float u_threshold;

vec3 sampleSrc(vec2 uv) {
  vec3 c = texture(u_tex, clamp(uv, 0.0, 1.0)).rgb;
  if (u_extract > 0.5) {
    float luma = dot(c, vec3(0.2126, 0.7152, 0.0722));
    float hi = max(luma - u_threshold, 0.0) / max(0.02, 1.0 - u_threshold);
    return c * hi;
  }
  return c;
}

void main() {
  float w[5] = float[5](0.227027, 0.1945946, 0.1216216, 0.054054, 0.016216);
  vec3 sum = sampleSrc(v_uv) * w[0];
  for (int i = 1; i < 5; i++) {
    vec2 off = u_texelDir * float(i);
    sum += sampleSrc(v_uv + off) * w[i];
    sum += sampleSrc(v_uv - off) * w[i];
  }
  outColor = vec4(sum, 1.0);
}`

const POST_FRAG_SRC = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 outColor;
uniform sampler2D u_gradeTex;
uniform sampler2D u_halTex;
uniform sampler2D u_stillTex;
uniform float u_halActive;
uniform float u_halIntensity;
uniform vec3 u_halTint;
uniform float u_grainActive;
uniform float u_grainAmp;
uniform float u_grainCell;
uniform float u_grainRoughness;
uniform vec2 u_res;
uniform float u_time;
uniform float u_hasStill;
uniform float u_compareMode;
uniform float u_wipe;

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

void main() {
  // Referans kare (FBO_Still) ile bölünmüş ekran karşılaştırması
  if (u_hasStill > 0.5) {
    float yTopDown = 1.0 - v_uv.y;
    if (u_compareMode > 2.5 && u_compareMode < 3.5 && v_uv.x < 0.5) {
      outColor = texture(u_stillTex, vec2(v_uv.x * 2.0, v_uv.y));
      return;
    }
    if ((u_compareMode > 0.5 && u_compareMode < 1.5 && v_uv.x < u_wipe) ||
        (u_compareMode > 1.5 && u_compareMode < 2.5 && yTopDown < u_wipe)) {
      outColor = texture(u_stillTex, v_uv);
      return;
    }
  }

  vec3 c = texture(u_gradeTex, v_uv).rgb;

  // 1) Fiziksel Halation (ayrılabilir Gauss blur + kırmızı-turuncu tint + screen blend)
  if (u_halActive > 0.5) {
    vec3 hal = texture(u_halTex, v_uv).rgb * u_halTint;
    vec3 screened = 1.0 - (1.0 - c) * (1.0 - clamp(hal * u_halIntensity, 0.0, 1.0));
    c = clamp(screened, 0.0, 1.0);
  }

  // 2) Parlaklığa duyarlı prosedürel film greni (gölge/orta ton güçlü, highlight zayıf)
  if (u_grainActive > 0.5 && u_grainAmp > 0.0005) {
    vec2 cellPx = floor((v_uv * u_res) / max(1.0, u_grainCell));
    float seed = floor(u_time * 24.0);
    float n0 = hash12(cellPx + vec2(seed * 17.3, seed * 31.7)) - 0.5;
    float n1 = hash12(cellPx * 1.7 + vec2(seed * 9.1, seed * 47.2)) - 0.5;
    float n = mix(n1 * 0.65, n0, 0.35 + 0.65 * u_grainRoughness) * 2.0;
    float luma = dot(c, vec3(0.2126, 0.7152, 0.0722));
    float toneWeight = max(0.08, 1.0 - 0.92 * luma * luma);
    c = clamp(c + vec3(n * u_grainAmp * toneWeight), 0.0, 1.0);
  }

  outColor = vec4(c, 1.0);
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

export type PlaybackQuality = 1 | 0.5 | 0.25

export class WebGLColorEngine {
  private gl: WebGL2RenderingContext
  private program: WebGLProgram
  private blurProg: WebGLProgram
  private postProg: WebGLProgram
  private videoTex: WebGLTexture
  private lutTex: WebGLTexture
  private curveTex: WebGLTexture
  private fboGrade: WebGLFramebuffer | null = null
  private texGrade: WebGLTexture | null = null
  private fboBlurH: WebGLFramebuffer | null = null
  private texBlurH: WebGLTexture | null = null
  private fboBlurV: WebGLFramebuffer | null = null
  private texBlurV: WebGLTexture | null = null
  private fboW = 0
  private fboH = 0
  private stillTex: WebGLTexture | null = null
  private hasStill = false
  private vao: WebGLVertexArrayObject
  private vbo: WebGLBuffer
  private uploadedLutKey = ''
  private uploadedCurveKey = ''
  private hasUploadedFrame = false
  private texW = 0
  private texH = 0
  private lastSourceEl: HTMLVideoElement | HTMLImageElement | null = null
  private lastUploadedVideoTime = -1

  private loc: Record<string, WebGLUniformLocation | null>
  private blurLoc: Record<string, WebGLUniformLocation | null>
  private postLoc: Record<string, WebGLUniformLocation | null>

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

    this.curveTex = gl.createTexture()!
    gl.bindTexture(gl.TEXTURE_2D, this.curveTex)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)

    const names = [
      'u_video',
      'u_lut',
      'u_curves',
      'u_exposure',
      'u_contrast',
      'u_highlights',
      'u_shadows',
      'u_temperature',
      'u_tint',
      'u_vibrance',
      'u_saturation',
      'u_vignette',
      'u_filmGrain',
      'u_time',
      'u_lift',
      'u_gamma',
      'u_gain',
      'u_offset',
      'u_hasCurves',
      'u_hasHueVs',
      'u_hueVsSat[0]',
      'u_hueVsHue[0]',
      'u_hasLut',
      'u_lutIntensity',
      'u_split',
      'u_wipe',
      'u_profile',
      'u_halation',
      'u_mist',
      'u_falseColor',
      'u_texel',
      'u_nfIntensity',
      'u_nfEmuEnabled',
      'u_nfEmuFormat',
      'u_nfEmu1',
      'u_nfEmu2',
      'u_nfEmuHiTint',
      'u_nfEmuShTint',
      'u_nfHalation',
      'u_nfHalationColor',
      'u_nfHalationBlend',
      'u_nfBloom',
      'u_nfBloomHi',
      'u_nfDiffusion',
      'u_nfMist',
      'u_nfGrain1',
      'u_nfGrain2',
      'u_compareMode',
      'u_ckParams',
      'u_ckColor',
      'u_ckBgColor',
      'u_ckModes'
    ]
    this.loc = {}
    for (const n of names) {
      this.loc[n] = gl.getUniformLocation(prog, n)
    }

    const linkPass = (fragSrc: string): WebGLProgram => {
      const fvs = compileShader(gl, gl.VERTEX_SHADER, FBO_VERT_SRC)
      const ffs = compileShader(gl, gl.FRAGMENT_SHADER, fragSrc)
      const p = gl.createProgram()!
      gl.attachShader(p, fvs)
      gl.attachShader(p, ffs)
      gl.linkProgram(p)
      gl.deleteShader(fvs)
      gl.deleteShader(ffs)
      if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
        throw new Error(`Post shader link hatası: ${gl.getProgramInfoLog(p)}`)
      }
      const pLoc = gl.getAttribLocation(p, 'a_pos')
      if (pLoc >= 0) {
        gl.enableVertexAttribArray(pLoc)
        gl.vertexAttribPointer(pLoc, 2, gl.FLOAT, false, 0, 0)
      }
      return p
    }

    this.blurProg = linkPass(BLUR_FRAG_SRC)
    this.blurLoc = {
      u_tex: gl.getUniformLocation(this.blurProg, 'u_tex'),
      u_texelDir: gl.getUniformLocation(this.blurProg, 'u_texelDir'),
      u_extract: gl.getUniformLocation(this.blurProg, 'u_extract'),
      u_threshold: gl.getUniformLocation(this.blurProg, 'u_threshold')
    }

    this.postProg = linkPass(POST_FRAG_SRC)
    this.postLoc = {
      u_gradeTex: gl.getUniformLocation(this.postProg, 'u_gradeTex'),
      u_halTex: gl.getUniformLocation(this.postProg, 'u_halTex'),
      u_stillTex: gl.getUniformLocation(this.postProg, 'u_stillTex'),
      u_halActive: gl.getUniformLocation(this.postProg, 'u_halActive'),
      u_halIntensity: gl.getUniformLocation(this.postProg, 'u_halIntensity'),
      u_halTint: gl.getUniformLocation(this.postProg, 'u_halTint'),
      u_grainActive: gl.getUniformLocation(this.postProg, 'u_grainActive'),
      u_grainAmp: gl.getUniformLocation(this.postProg, 'u_grainAmp'),
      u_grainCell: gl.getUniformLocation(this.postProg, 'u_grainCell'),
      u_grainRoughness: gl.getUniformLocation(this.postProg, 'u_grainRoughness'),
      u_res: gl.getUniformLocation(this.postProg, 'u_res'),
      u_time: gl.getUniformLocation(this.postProg, 'u_time'),
      u_hasStill: gl.getUniformLocation(this.postProg, 'u_hasStill'),
      u_compareMode: gl.getUniformLocation(this.postProg, 'u_compareMode'),
      u_wipe: gl.getUniformLocation(this.postProg, 'u_wipe')
    }
  }

  private createFboPair(w: number, h: number): { fbo: WebGLFramebuffer; tex: WebGLTexture } {
    const gl = this.gl
    const tex = gl.createTexture()!
    gl.bindTexture(gl.TEXTURE_2D, tex)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null)
    const fbo = gl.createFramebuffer()!
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo)
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0)
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    return { fbo, tex }
  }

  private disposePostFbos(): void {
    const gl = this.gl
    if (this.fboGrade) gl.deleteFramebuffer(this.fboGrade)
    if (this.texGrade) gl.deleteTexture(this.texGrade)
    if (this.fboBlurH) gl.deleteFramebuffer(this.fboBlurH)
    if (this.texBlurH) gl.deleteTexture(this.texBlurH)
    if (this.fboBlurV) gl.deleteFramebuffer(this.fboBlurV)
    if (this.texBlurV) gl.deleteTexture(this.texBlurV)
    this.fboGrade = null
    this.texGrade = null
    this.fboBlurH = null
    this.texBlurH = null
    this.fboBlurV = null
    this.texBlurV = null
    this.fboW = 0
    this.fboH = 0
  }

  private ensurePostFbos(w: number, h: number): void {
    if (this.fboW === w && this.fboH === h && this.fboGrade) return
    this.disposePostFbos()
    const g = this.createFboPair(w, h)
    const bh = this.createFboPair(w, h)
    const bv = this.createFboPair(w, h)
    this.fboGrade = g.fbo
    this.texGrade = g.tex
    this.fboBlurH = bh.fbo
    this.texBlurH = bh.tex
    this.fboBlurV = bv.fbo
    this.texBlurV = bv.tex
    this.fboW = w
    this.fboH = h
  }

  /** Aktif çizili kareyi kalıcı FBO_Still dokusuna yakalar. */
  captureStillFromCanvas(): boolean {
    const gl = this.gl
    const canvas = gl.canvas as HTMLCanvasElement
    if (!canvas || canvas.width <= 0 || canvas.height <= 0) return false
    if (!this.stillTex) {
      this.stillTex = gl.createTexture()!
      gl.bindTexture(gl.TEXTURE_2D, this.stillTex)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    } else {
      gl.bindTexture(gl.TEXTURE_2D, this.stillTex)
    }
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas)
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false)
    this.hasStill = true
    return true
  }

  clearStill(): void {
    if (this.stillTex) {
      this.gl.deleteTexture(this.stillTex)
      this.stillTex = null
    }
    this.hasStill = false
  }

  hasStillTexture(): boolean {
    return this.hasStill && this.stillTex !== null
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

  private ensureCurves(grade: ColorGrade): boolean {
    const hasCurves = Boolean(grade.curves && !areCurvesNeutral(grade.curves))
    if (!hasCurves) return false
    const key = JSON.stringify(grade.curves)
    const gl = this.gl
    gl.activeTexture(gl.TEXTURE2)
    gl.bindTexture(gl.TEXTURE_2D, this.curveTex)
    if (key !== this.uploadedCurveKey) {
      this.uploadedCurveKey = key
      const data = buildCurveLut256(grade.curves)
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1)
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 256, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, data)
    }
    return true
  }

  render(
    source: HTMLVideoElement | HTMLImageElement,
    grade: ColorGrade,
    lut: Lut3D | null,
    split: boolean,
    wipePercent: number,
    falseColor = false,
    compareMode: 'none' | 'v-wipe' | 'h-wipe' | 'side-by-side' | 'original' = 'none',
    isPlaying = false,
    qualityScale: PlaybackQuality = 1,
    forceUpload = false
  ): boolean {
    const isVideo = 'videoWidth' in source
    const srcW = isVideo ? source.videoWidth : source.naturalWidth
    const srcH = isVideo ? source.videoHeight : source.naturalHeight
    const ready = isVideo ? source.readyState >= 2 : source.complete
    const canUpload = ready && srcW > 0 && srcH > 0
    if (!canUpload && !this.hasUploadedFrame) return false
    const gl = this.gl
    const canvas = gl.canvas as HTMLCanvasElement
    const targetW = Math.max(16, Math.round(srcW * qualityScale))
    const targetH = Math.max(16, Math.round(srcH * qualityScale))
    if (canUpload && (canvas.width !== targetW || canvas.height !== targetH)) {
      canvas.width = targetW
      canvas.height = targetH
    }

    gl.viewport(0, 0, canvas.width, canvas.height)
    gl.useProgram(this.program)
    gl.bindVertexArray(this.vao)

    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, this.videoTex)
    if (canUpload) {
      const sourceChanged = this.lastSourceEl !== source
      const curVideoTime = isVideo ? source.currentTime : 0
      const frameTimeChanged =
        !isVideo ||
        sourceChanged ||
        forceUpload ||
        Math.abs(curVideoTime - this.lastUploadedVideoTime) > 1e-5

      if (this.texW !== srcW || this.texH !== srcH) {
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source)
        this.texW = srcW
        this.texH = srcH
        this.lastSourceEl = source
        this.lastUploadedVideoTime = curVideoTime
        this.hasUploadedFrame = true
      } else if (frameTimeChanged) {
        gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, source)
        this.lastSourceEl = source
        this.lastUploadedVideoTime = curVideoTime
        this.hasUploadedFrame = true
      }
    }

    this.ensureLut(lut)
    const hasCurves = this.ensureCurves(grade)
    const hasHueVs =
      !areHueBandsNeutral(grade.hueVsSat) || !areHueBandsNeutral(grade.hueVsHue)

    const lift = wheelToRgbOffset(grade.lift, 0.55, 0.35)
    const gamma = wheelToRgbOffset(grade.gamma, 0.75, 0.6)
    const gain = wheelToRgbOffset(grade.gain, 0.75, 0.6)
    const offset = wheelToRgbOffset(grade.offset ?? neutralWheel(), 0.45, 0.35)

    const hSat = (grade.hueVsSat ?? defaultHueBands()).map((v) => v / 100)
    const hHue = (grade.hueVsHue ?? defaultHueBands()).map((v) => v / 100)

    gl.uniform1i(this.loc['u_video'], 0)
    gl.uniform1i(this.loc['u_lut'], 1)
    gl.uniform1i(this.loc['u_curves'], 2)
    gl.uniform1f(this.loc['u_exposure'], grade.exposure)
    gl.uniform1f(this.loc['u_contrast'], grade.contrast / 100)
    gl.uniform1f(this.loc['u_highlights'], (grade.highlights ?? 0) / 100)
    gl.uniform1f(this.loc['u_shadows'], (grade.shadows ?? 0) / 100)
    gl.uniform1f(this.loc['u_temperature'], grade.temperature / 100)
    gl.uniform1f(this.loc['u_tint'], grade.tint / 100)
    gl.uniform1f(this.loc['u_vibrance'], (grade.vibrance ?? 0) / 100)
    gl.uniform1f(this.loc['u_saturation'], grade.saturation / 100)
    gl.uniform1f(this.loc['u_vignette'], (grade.vignette ?? 0) / 100)
    gl.uniform1f(this.loc['u_filmGrain'], (grade.filmGrain ?? 0) / 100)
    gl.uniform1f(this.loc['u_time'], (performance.now() % 10000) / 1000)
    gl.uniform3f(this.loc['u_lift'], lift[0], lift[1], lift[2])
    gl.uniform3f(this.loc['u_gamma'], gamma[0], gamma[1], gamma[2])
    gl.uniform3f(this.loc['u_gain'], gain[0], gain[1], gain[2])
    gl.uniform3f(this.loc['u_offset'], offset[0], offset[1], offset[2])
    gl.uniform1f(this.loc['u_hasCurves'], hasCurves ? 1 : 0)
    gl.uniform1f(this.loc['u_hasHueVs'], hasHueVs ? 1 : 0)
    gl.uniform1fv(this.loc['u_hueVsSat[0]'], new Float32Array(hSat))
    gl.uniform1fv(this.loc['u_hueVsHue[0]'], new Float32Array(hHue))
    gl.uniform1f(this.loc['u_hasLut'], lut ? 1 : 0)
    gl.uniform1f(this.loc['u_lutIntensity'], grade.lutIntensity / 100)
    gl.uniform1f(this.loc['u_split'], split ? 1 : 0)
    gl.uniform1f(this.loc['u_wipe'], wipePercent / 100)
    gl.uniform1f(this.loc['u_profile'], cameraProfileIndex(grade.cameraProfile))
    gl.uniform1f(this.loc['u_halation'], (grade.halation ?? 0) / 100)
    gl.uniform1f(this.loc['u_mist'], (grade.mist ?? 0) / 100)
    gl.uniform1f(this.loc['u_falseColor'], falseColor ? 1 : 0)
    gl.uniform2f(this.loc['u_texel'], 1 / canvas.width, 1 / canvas.height)

    // NoirFilm uniformları
    const nf = grade.noirFilm
    const nfInt = (nf?.lookIntensity ?? 100) / 100
    const emu = nf?.filmEmulation
    const fmtNum = emu?.format === '8mm' ? 2 : emu?.format === '16mm' ? 1 : 0
    const hiTint = hexToRgb01(emu?.highlightTint ?? '#FFF8EE')
    const shTint = hexToRgb01(emu?.shadowTint ?? '#0D141C')
    const hal = nf?.lightEffects?.halation
    const halCol = hexToRgb01(hal?.color ?? '#FF4B1F')
    const blm = nf?.lightEffects?.bloom
    const dif = nf?.lightEffects?.diffusion
    const mst = nf?.lightEffects?.mist
    const tex = nf?.texture
    const grainActive = Boolean(tex?.enabled && (!isPlaying || tex?.playbackPreview !== false))
    const cmpVal =
      compareMode === 'v-wipe'
        ? 1
        : compareMode === 'h-wipe'
          ? 2
          : compareMode === 'side-by-side'
            ? 3
            : compareMode === 'original'
              ? 4
              : 0

    gl.uniform1f(this.loc['u_nfIntensity'], nfInt)
    gl.uniform1f(this.loc['u_nfEmuEnabled'], emu?.enabled ? 1 : 0)
    gl.uniform1f(this.loc['u_nfEmuFormat'], fmtNum)
    gl.uniform4f(
      this.loc['u_nfEmu1'],
      (emu?.contrast ?? 0) / 100,
      (emu?.highlightRolloff ?? 35) / 100,
      (emu?.shadowResponse ?? 0) / 100,
      (emu?.saturation ?? 100) / 100
    )
    gl.uniform4f(
      this.loc['u_nfEmu2'],
      (emu?.colorDensity ?? 0) / 100,
      (emu?.temperature ?? 0) / 100,
      (emu?.filmResponse ?? 0) / 100,
      0
    )
    gl.uniform3f(this.loc['u_nfEmuHiTint'], hiTint[0], hiTint[1], hiTint[2])
    gl.uniform3f(this.loc['u_nfEmuShTint'], shTint[0], shTint[1], shTint[2])

    gl.uniform4f(
      this.loc['u_nfHalation'],
      hal?.enabled ? (hal.intensity ?? 0) / 100 : 0,
      (hal?.threshold ?? 62) / 100,
      (hal?.radius ?? 45) / 100,
      (hal?.spread ?? 50) / 100
    )
    gl.uniform3f(this.loc['u_nfHalationColor'], halCol[0], halCol[1], halCol[2])
    gl.uniform1f(this.loc['u_nfHalationBlend'], (hal?.blend ?? 65) / 100)

    gl.uniform4f(
      this.loc['u_nfBloom'],
      blm?.enabled ? (blm.intensity ?? 0) / 100 : 0,
      (blm?.threshold ?? 65) / 100,
      (blm?.radius ?? 50) / 100,
      (blm?.softness ?? 55) / 100
    )
    gl.uniform1f(this.loc['u_nfBloomHi'], (blm?.highlightStrength ?? 60) / 100)

    gl.uniform4f(
      this.loc['u_nfDiffusion'],
      dif?.enabled ? (dif.strength ?? 0) / 100 : 0,
      (dif?.highlightDiffusion ?? 55) / 100,
      (dif?.softness ?? 50) / 100,
      (dif?.contrastPreservation ?? 70) / 100
    )

    gl.uniform4f(
      this.loc['u_nfMist'],
      mst?.enabled ? (mst.intensity ?? 0) / 100 : 0,
      (mst?.highlightSpread ?? 55) / 100,
      (mst?.atmosphericSoftness ?? 50) / 100,
      (mst?.contrastReduction ?? 25) / 100
    )

    gl.uniform4f(
      this.loc['u_nfGrain1'],
      grainActive ? 1 : 0,
      (tex?.amount ?? 0) / 100,
      (tex?.size ?? 38) / 100,
      (tex?.strength ?? 45) / 100
    )
    gl.uniform4f(
      this.loc['u_nfGrain2'],
      (tex?.softness ?? 35) / 100,
      (tex?.distribution ?? 50) / 100,
      (tex?.luminanceGrain ?? 75) / 100,
      (tex?.colorGrain ?? 25) / 100
    )
    const ck = nf?.chromaKey
    const ckCol = hexToRgb01(ck?.keyColor ?? '#00B140')
    const ckBg = hexToRgb01(ck?.bgColor ?? '#0B0D12')
    gl.uniform4f(
      this.loc['u_ckParams'],
      ck?.enabled ? 1 : 0,
      (ck?.tolerance ?? 32) / 100,
      (ck?.edgeSoftness ?? 18) / 100,
      (ck?.spillSuppression ?? 45) / 100
    )
    gl.uniform3f(this.loc['u_ckColor'], ckCol[0], ckCol[1], ckCol[2])
    gl.uniform3f(this.loc['u_ckBgColor'], ckBg[0], ckBg[1], ckBg[2])
    gl.uniform2f(
      this.loc['u_ckModes'],
      ck?.mattePreview ? 1 : 0,
      (ck?.opacity ?? 100) / 100
    )

    const analog = grade.analog ?? defaultAnalogFilm()
    const useStillCompare = this.hasStill && cmpVal > 0.5 && cmpVal < 3.5
    const usePostPass = isAnalogFilmActive(analog) || useStillCompare

    if (!usePostPass) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null)
      gl.uniform1f(this.loc['u_compareMode'], cmpVal)
      gl.drawArrays(gl.TRIANGLES, 0, 6)
      return true
    }

    // Pass 1: Renk derecelendirme + LUT + LGG -> texGrade
    this.ensurePostFbos(canvas.width, canvas.height)
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fboGrade)
    gl.uniform1f(this.loc['u_compareMode'], useStillCompare ? 0 : cmpVal)
    gl.drawArrays(gl.TRIANGLES, 0, 6)

    const halOn = isAnalogHalationActive(analog)
    const hp = analogHalationParams(analog)
    if (halOn) {
      const stepPx = Math.max(1, canvas.height * hp.sigmaFrac * 0.45)
      gl.useProgram(this.blurProg)
      // Pass 2a: Eşik üstü parlak alanlar + Yatay Gauss Blur -> texBlurH
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.fboBlurH)
      gl.activeTexture(gl.TEXTURE0)
      gl.bindTexture(gl.TEXTURE_2D, this.texGrade)
      gl.uniform1i(this.blurLoc['u_tex'], 0)
      gl.uniform2f(this.blurLoc['u_texelDir'], stepPx / canvas.width, 0)
      gl.uniform1f(this.blurLoc['u_extract'], 1)
      gl.uniform1f(this.blurLoc['u_threshold'], hp.threshold)
      gl.drawArrays(gl.TRIANGLES, 0, 6)

      // Pass 2b: Dikey Gauss Blur -> texBlurV
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.fboBlurV)
      gl.bindTexture(gl.TEXTURE_2D, this.texBlurH)
      gl.uniform2f(this.blurLoc['u_texelDir'], 0, stepPx / canvas.height)
      gl.uniform1f(this.blurLoc['u_extract'], 0)
      gl.drawArrays(gl.TRIANGLES, 0, 6)
    }

    // Pass 3: Halation screen + Luminance-Aware Film Grain + Still Wipe -> Ekran
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    gl.useProgram(this.postProg)
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, this.texGrade)
    gl.uniform1i(this.postLoc['u_gradeTex'], 0)

    gl.activeTexture(gl.TEXTURE1)
    gl.bindTexture(gl.TEXTURE_2D, halOn ? this.texBlurV : this.texGrade)
    gl.uniform1i(this.postLoc['u_halTex'], 1)

    gl.activeTexture(gl.TEXTURE2)
    gl.bindTexture(gl.TEXTURE_2D, useStillCompare ? this.stillTex : this.texGrade)
    gl.uniform1i(this.postLoc['u_stillTex'], 2)

    const gp = analogGrainParams(analog)
    const grainOn = isAnalogGrainActive(analog)
    gl.uniform1f(this.postLoc['u_halActive'], halOn ? 1 : 0)
    gl.uniform1f(this.postLoc['u_halIntensity'], hp.opacity)
    gl.uniform3f(
      this.postLoc['u_halTint'],
      HALATION_TINT[0] * HALATION_GAIN,
      HALATION_TINT[1] * HALATION_GAIN,
      HALATION_TINT[2] * HALATION_GAIN
    )
    gl.uniform1f(this.postLoc['u_grainActive'], grainOn ? 1 : 0)
    gl.uniform1f(this.postLoc['u_grainAmp'], gp.amplitude)
    gl.uniform1f(this.postLoc['u_grainCell'], Math.max(1, gp.cellPx1080 * (canvas.height / 1080)))
    gl.uniform1f(this.postLoc['u_grainRoughness'], gp.roughness)
    gl.uniform2f(this.postLoc['u_res'], canvas.width, canvas.height)
    gl.uniform1f(this.postLoc['u_time'], (performance.now() % 10000) / 1000)
    gl.uniform1f(this.postLoc['u_hasStill'], useStillCompare ? 1 : 0)
    gl.uniform1f(this.postLoc['u_compareMode'], cmpVal)
    gl.uniform1f(this.postLoc['u_wipe'], wipePercent / 100)
    gl.drawArrays(gl.TRIANGLES, 0, 6)
    return true
  }

  dispose(): void {
    const gl = this.gl
    this.disposePostFbos()
    this.clearStill()
    gl.deleteTexture(this.videoTex)
    gl.deleteTexture(this.lutTex)
    gl.deleteTexture(this.curveTex)
    gl.deleteBuffer(this.vbo)
    gl.deleteVertexArray(this.vao)
    gl.deleteProgram(this.program)
    gl.deleteProgram(this.blurProg)
    gl.deleteProgram(this.postProg)
  }
}
