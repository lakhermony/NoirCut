use rayon::prelude::*;
use serde_json::Value;

#[derive(Clone, Debug)]
struct Lut3DData {
  size: usize,
  data: Vec<f32>, // size * size * size * 3
}

fn clamp01(x: f64) -> f64 {
  x.clamp(0.0, 1.0)
}

fn srgb_luma(r: f64, g: f64, b: f64) -> f64 {
  0.2126 * r + 0.7152 * g + 0.0722 * b
}

fn log_to_linear(profile: &str, v: f64) -> f64 {
  match profile {
    "slog3" => {
      if v >= 171.2102946929 / 1023.0 {
        10.0_f64.powf((v * 1023.0 - 420.0) / 261.5) * (0.18 + 0.01) - 0.01
      } else {
        (v * 1023.0 - 95.0) * 0.01125000 / (171.2102946929 - 95.0)
      }
    }
    "clog3" => {
      if v < 0.09746547 {
        -(10.0_f64.powf((0.12512219 - v) / 0.36726845) - 1.0) / 14.98325
      } else {
        (10.0_f64.powf((v - 0.12512219) / 0.36726845) - 1.0) / 14.98325
      }
    }
    "vlog" => {
      if v < 0.181 {
        (v - 0.125) / 5.6
      } else {
        10.0_f64.powf((v - 0.598206) / 0.241514) - 0.00873
      }
    }
    "logc3" => {
      if v > 0.1496582 {
        (10.0_f64.powf((v - 0.385537) / 0.2471896) - 0.052272) / 5.555556
      } else {
        (v - 0.092809) / 5.367655
      }
    }
    _ => v,
  }
}

fn oetf_rec709(lin: f64) -> f64 {
  let v = clamp01(lin);
  if v < 0.018 {
    4.5 * v
  } else {
    1.099 * v.powf(0.45) - 0.099
  }
}

fn apply_camera_profile(profile: &str, r: f64, g: f64, b: f64) -> [f64; 3] {
  if profile == "rec709" || profile.is_empty() {
    return [r, g, b];
  }
  [
    oetf_rec709(log_to_linear(profile, r)),
    oetf_rec709(log_to_linear(profile, g)),
    oetf_rec709(log_to_linear(profile, b)),
  ]
}

fn wheel_rgb_offset(wheel: &Value) -> [f64; 3] {
  let x = wheel["x"].as_f64().unwrap_or(0.0);
  let y = wheel["y"].as_f64().unwrap_or(0.0);
  let l = wheel["l"].as_f64().unwrap_or(0.0);
  let r = l + x * 0.85 - y * 0.25;
  let g = l - x * 0.40 + y * 0.70;
  let b = l - x * 0.45 - y * 0.55;
  [r, g, b]
}

fn eval_curve(pts: &[(f64, f64)], x: f64) -> f64 {
  if pts.len() < 2 {
    return x;
  }
  let xc = clamp01(x);
  if xc <= pts[0].0 {
    return clamp01(pts[0].1);
  }
  let last = pts[pts.len() - 1];
  if xc >= last.0 {
    return clamp01(last.1);
  }
  for i in 0..(pts.len() - 1) {
    let (x0, y0) = pts[i];
    let (x1, y1) = pts[i + 1];
    if xc >= x0 && xc <= x1 {
      let span = (x1 - x0).max(1e-6);
      let t = (xc - x0) / span;
      return clamp01(y0 + (y1 - y0) * t);
    }
  }
  xc
}

fn parse_curve_points(val: &Value) -> Vec<(f64, f64)> {
  let Some(arr) = val.as_array() else {
    return vec![(0.0, 0.0), (1.0, 1.0)];
  };
  let mut pts: Vec<(f64, f64)> = arr
    .iter()
    .filter_map(|p| Some((p["x"].as_f64()?, p["y"].as_f64()?)))
    .collect();
  if pts.len() < 2 {
    return vec![(0.0, 0.0), (1.0, 1.0)];
  }
  pts.sort_by(|a, b| a.0.partial_cmp(&b.0).unwrap_or(std::cmp::Ordering::Equal));
  pts
}

fn sample_lut_trilinear(lut: &Lut3DData, r: f64, g: f64, b: f64) -> [f64; 3] {
  let n = lut.size;
  if n < 2 || lut.data.len() < n * n * n * 3 {
    return [r, g, b];
  }
  let max_i = (n - 1) as f64;
  let rx = clamp01(r) * max_i;
  let gx = clamp01(g) * max_i;
  let bx = clamp01(b) * max_i;

  let r0 = (rx.floor() as usize).min(n - 1);
  let g0 = (gx.floor() as usize).min(n - 1);
  let b0 = (bx.floor() as usize).min(n - 1);
  let r1 = (r0 + 1).min(n - 1);
  let g1 = (g0 + 1).min(n - 1);
  let b1 = (b0 + 1).min(n - 1);

  let fr = rx - r0 as f64;
  let fg = gx - g0 as f64;
  let fb = bx - b0 as f64;

  let at = |ri: usize, gi: usize, bi: usize| -> [f64; 3] {
    let idx = (bi * n * n + gi * n + ri) * 3;
    [
      lut.data[idx] as f64,
      lut.data[idx + 1] as f64,
      lut.data[idx + 2] as f64,
    ]
  };

  let c000 = at(r0, g0, b0);
  let c100 = at(r1, g0, b0);
  let c010 = at(r0, g1, b0);
  let c110 = at(r1, g1, b0);
  let c001 = at(r0, g0, b1);
  let c101 = at(r1, g0, b1);
  let c011 = at(r0, g1, b1);
  let c111 = at(r1, g1, b1);

  let mut out = [0.0; 3];
  for ch in 0..3 {
    let c00 = c000[ch] + (c100[ch] - c000[ch]) * fr;
    let c10 = c010[ch] + (c110[ch] - c010[ch]) * fr;
    let c01 = c001[ch] + (c101[ch] - c001[ch]) * fr;
    let c11 = c011[ch] + (c111[ch] - c011[ch]) * fr;
    let c0 = c00 + (c10 - c00) * fg;
    let c1 = c01 + (c11 - c01) * fg;
    out[ch] = clamp01(c0 + (c1 - c0) * fb);
  }
  out
}

fn parse_lut_from_json(lut_val: &Value) -> Option<Lut3DData> {
  let size = lut_val["size"].as_u64()? as usize;
  let data_arr = lut_val["data"].as_array()?;
  let data: Vec<f32> = data_arr
    .iter()
    .map(|v| v.as_f64().unwrap_or(0.0) as f32)
    .collect();
  if size >= 2 && data.len() >= size * size * size * 3 {
    Some(Lut3DData { size, data })
  } else {
    None
  }
}

pub fn is_neutral_grade_json(grade: &Value) -> bool {
  if grade.is_null() {
    return true;
  }
  let cam = grade["cameraProfile"].as_str().unwrap_or("rec709");
  if cam != "rec709" {
    return false;
  }
  if grade["lutId"].as_str().is_some() {
    return false;
  }
  let near_zero = |k: &str| grade[k].as_f64().unwrap_or(0.0).abs() < 0.05;
  let sat = grade["saturation"].as_f64().unwrap_or(100.0);
  if (sat - 100.0).abs() > 0.5
    || !near_zero("exposure")
    || !near_zero("contrast")
    || !near_zero("highlights")
    || !near_zero("shadows")
    || !near_zero("temperature")
    || !near_zero("tint")
    || !near_zero("vibrance")
    || !near_zero("vignette")
    || !near_zero("filmGrain")
    || !near_zero("halation")
    || !near_zero("mist")
  {
    return false;
  }
  for w in ["lift", "gamma", "gain", "offset"] {
    let wh = &grade[w];
    if wh["x"].as_f64().unwrap_or(0.0).abs() > 0.003
      || wh["y"].as_f64().unwrap_or(0.0).abs() > 0.003
      || wh["l"].as_f64().unwrap_or(0.0).abs() > 0.003
    {
      return false;
    }
  }
  let nf = &grade["noirFilm"];
  if nf.is_object() {
    if nf["filmEmulation"]["enabled"].as_bool().unwrap_or(false)
      || nf["texture"]["enabled"].as_bool().unwrap_or(false)
      || nf["chromaKey"]["enabled"].as_bool().unwrap_or(false)
      || nf["lightEffects"]["halation"]["enabled"].as_bool().unwrap_or(false)
      || nf["lightEffects"]["bloom"]["enabled"].as_bool().unwrap_or(false)
      || nf["lightEffects"]["diffusion"]["enabled"].as_bool().unwrap_or(false)
      || nf["lightEffects"]["mist"]["enabled"].as_bool().unwrap_or(false)
    {
      return false;
    }
  }
  for ch in ["master", "red", "green", "blue"] {
    let pts = parse_curve_points(&grade["curves"][ch]);
    if pts.len() > 2
      || (pts[0].0).abs() > 1e-3
      || (pts[0].1).abs() > 1e-3
      || (pts[1].0 - 1.0).abs() > 1e-3
      || (pts[1].1 - 1.0).abs() > 1e-3
    {
      return false;
    }
  }
  true
}

/// Rayon Çok Çekirdekli Paralel 33³ `.cube` 3D LUT Üreticisi
pub fn bake_color_grade_to_cube_rayon(
  grade: &Value,
  custom_luts: &Value,
  size: usize,
) -> String {
  let cam = grade["cameraProfile"].as_str().unwrap_or("rec709");
  let exp_mul = 2.0_f64.powf(grade["exposure"].as_f64().unwrap_or(0.0));
  let contrast = 1.0 + grade["contrast"].as_f64().unwrap_or(0.0) / 100.0;
  let highlights = grade["highlights"].as_f64().unwrap_or(0.0) / 100.0;
  let shadows = grade["shadows"].as_f64().unwrap_or(0.0) / 100.0;
  let temp = grade["temperature"].as_f64().unwrap_or(0.0) / 100.0;
  let tint = grade["tint"].as_f64().unwrap_or(0.0) / 100.0;
  let vibrance = grade["vibrance"].as_f64().unwrap_or(0.0) / 100.0;
  let sat = grade["saturation"].as_f64().unwrap_or(100.0) / 100.0;

  let lift = wheel_rgb_offset(&grade["lift"]);
  let gamma_w = wheel_rgb_offset(&grade["gamma"]);
  let gain_w = wheel_rgb_offset(&grade["gain"]);
  let offset_w = wheel_rgb_offset(&grade["offset"]);

  let c_master = parse_curve_points(&grade["curves"]["master"]);
  let c_red = parse_curve_points(&grade["curves"]["red"]);
  let c_green = parse_curve_points(&grade["curves"]["green"]);
  let c_blue = parse_curve_points(&grade["curves"]["blue"]);

  let lut_id = grade["lutId"].as_str();
  let lut_int = clamp01(grade["lutIntensity"].as_f64().unwrap_or(100.0) / 100.0);
  let active_lut = lut_id.and_then(|id| parse_lut_from_json(&custom_luts[id]));

  let total = size * size * size;
  let max_i = (size - 1) as f64;

  // Rayon paralel iterasyonu: tüm 3D LUT düğümlerini çekirdeklere bölerek hesapla
  let lines: Vec<String> = (0..total)
    .into_par_iter()
    .map(|idx| {
      let b_i = idx / (size * size);
      let rem = idx % (size * size);
      let g_i = rem / size;
      let r_i = rem % size;

      let r_in = r_i as f64 / max_i;
      let g_in = g_i as f64 / max_i;
      let b_in = b_i as f64 / max_i;

      let [mut r, mut g, mut b] = apply_camera_profile(cam, r_in, g_in, b_in);

      // Exposure + Temp/Tint
      r = clamp01(r * exp_mul * (1.0 + temp * 0.16 + tint * 0.04));
      g = clamp01(g * exp_mul * (1.0 - tint * 0.14));
      b = clamp01(b * exp_mul * (1.0 - temp * 0.16 + tint * 0.04));

      // Lift / Gamma / Gain / Offset
      for (ch, val) in [&mut r, &mut g, &mut b].into_iter().enumerate() {
        let mut x = *val;
        x = x + lift[ch] * (1.0 - x) * 0.65;
        let g_pow = (1.0 - gamma_w[ch] * 0.55).clamp(0.35, 2.2);
        x = clamp01(x).powf(g_pow);
        x = x * (1.0 + gain_w[ch] * 0.75);
        x = x + offset_w[ch] * 0.35;
        *val = clamp01(x);
      }

      // Contrast
      r = clamp01((r - 0.5) * contrast + 0.5);
      g = clamp01((g - 0.5) * contrast + 0.5);
      b = clamp01((b - 0.5) * contrast + 0.5);

      // Shadows & Highlights
      let lum = srgb_luma(r, g, b);
      let sh_mask = (1.0 - lum).powf(1.8);
      let hi_mask = lum.powf(1.8);
      let tone_delta = shadows * 0.28 * sh_mask + highlights * 0.28 * hi_mask;
      r = clamp01(r + tone_delta);
      g = clamp01(g + tone_delta);
      b = clamp01(b + tone_delta);

      // Curves
      r = eval_curve(&c_red, eval_curve(&c_master, r));
      g = eval_curve(&c_green, eval_curve(&c_master, g));
      b = eval_curve(&c_blue, eval_curve(&c_master, b));

      // Vibrance + Saturation
      let l = srgb_luma(r, g, b);
      let max_c = r.max(g).max(b);
      let min_c = r.min(g).min(b);
      let chroma = max_c - min_c;
      let vib_boost = 1.0 + vibrance * (1.0 - chroma);
      let eff_sat = sat * vib_boost;
      r = clamp01(l + (r - l) * eff_sat);
      g = clamp01(l + (g - l) * eff_sat);
      b = clamp01(l + (b - l) * eff_sat);

      // Optional custom 3D LUT trilinear blend
      if let Some(ref lut) = active_lut {
        let [lr, lg, lb] = sample_lut_trilinear(lut, r, g, b);
        r = clamp01(r + (lr - r) * lut_int);
        g = clamp01(g + (lg - g) * lut_int);
        b = clamp01(b + (lb - b) * lut_int);
      }

      format!("{:.6} {:.6} {:.6}\n", r, g, b)
    })
    .collect();

  let mut out = String::with_capacity(64 + total * 28);
  out.push_str("TITLE \"NoirCut-Grade\"\n");
  out.push_str(&format!("LUT_3D_SIZE {}\n", size));
  out.push_str("DOMAIN_MIN 0.0 0.0 0.0\n");
  out.push_str("DOMAIN_MAX 1.0 1.0 1.0\n");
  for line in lines {
    out.push_str(&line);
  }
  out
}

#[cfg(test)]
mod tests {
  use super::*;
  use serde_json::json;

  #[test]
  fn test_rayon_cube_lut_33_size_and_neutral() {
    let neutral = json!({
      "cameraProfile": "rec709",
      "saturation": 100.0,
      "exposure": 0.0,
      "contrast": 0.0
    });
    assert!(is_neutral_grade_json(&neutral));

    let graded = json!({
      "cameraProfile": "rec709",
      "saturation": 110.0,
      "exposure": 0.35,
      "contrast": 15.0
    });
    assert!(!is_neutral_grade_json(&graded));
    let cube = bake_color_grade_to_cube_rayon(&graded, &json!({}), 33);
    assert!(cube.contains("LUT_3D_SIZE 33"));
    let data_lines: Vec<&str> = cube
      .lines()
      .filter(|l| !l.starts_with("TITLE") && !l.starts_with("LUT_3D_SIZE") && !l.starts_with("DOMAIN_"))
      .collect();
    assert_eq!(data_lines.len(), 33 * 33 * 33);
  }
}
