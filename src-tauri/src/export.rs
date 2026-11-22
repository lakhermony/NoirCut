use crate::lut_bake::{bake_color_grade_to_cube_rayon, is_neutral_grade_json};
use crate::{AppState, EngineInfo, ExportResult, MediaItem};
use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::io::{BufRead, BufReader};
use std::path::Path;
use std::process::{Command, Stdio};
use std::sync::Arc;
use std::time::Instant;
use tauri::{AppHandle, Emitter};

const MIN_DB: f64 = -60.0;

fn db_to_gain(db: f64) -> f64 {
  if db <= MIN_DB {
    0.0
  } else {
    10.0_f64.powf(db / 20.0)
  }
}

fn effective_speed_factor(c: &Value) -> f64 {
  if let Some(arr) = c["speedRamp"].as_array() {
    if !arr.is_empty() {
      let sum: f64 = arr
        .iter()
        .map(|p| (p["speed"].as_f64().unwrap_or(100.0) / 100.0).clamp(0.25, 4.0))
        .sum();
      return (sum / arr.len() as f64).clamp(0.25, 4.0);
    }
  }
  (c["speed"].as_f64().unwrap_or(100.0) / 100.0).clamp(0.25, 4.0)
}

fn build_gain_filter(c: &Value) -> String {
  if let Some(arr) = c["gainKeyframes"].as_array() {
    if !arr.is_empty() {
      let mut pts: Vec<(f64, f64)> = arr
        .iter()
        .map(|p| (p["time"].as_f64().unwrap_or(0.0), p["db"].as_f64().unwrap_or(0.0)))
        .collect();
      pts.sort_by(|a, b| a.0.partial_cmp(&b.0).unwrap_or(std::cmp::Ordering::Equal));
      let mut expr = format!("{:.5}", db_to_gain(pts.last().unwrap().1));
      for i in (0..pts.len().saturating_sub(1)).rev() {
        let (t0, d0) = pts[i];
        let (t1, d1) = pts[i + 1];
        let g0 = db_to_gain(d0);
        let g1 = db_to_gain(d1);
        let span = (t1 - t0).max(0.001);
        let seg = format!("{:.5}+({:.5})*((t-{:.3})/{:.3})", g0, g1 - g0, t0, span);
        expr = format!("if(lt(t,{:.3}),{},{})", t1, seg, expr);
      }
      if pts[0].0 > 0.001 {
        expr = format!("if(lt(t,{:.3}),{:.5},{})", pts[0].0, db_to_gain(pts[0].1), expr);
      }
      return format!("volume='{}':eval=frame", expr);
    }
  }
  format!("volume={:.6}", db_to_gain(c["gainDb"].as_f64().unwrap_or(0.0)))
}

fn lane_number(lane: &str) -> u32 {
  lane[1..].parse::<u32>().unwrap_or(1)
}

fn is_video_lane(lane: &str) -> bool {
  lane.starts_with('V')
}

fn is_audio_lane(lane: &str) -> bool {
  lane.starts_with('A')
}

fn is_credit_clip(clip: &Value) -> bool {
  clip["credit"].is_object() || clip["mediaId"].as_str() == Some("__credit__")
}

fn is_lane_audible(lanes: &Value, lane_id: &str) -> bool {
  let st = &lanes[lane_id];
  if st["hidden"].as_bool().unwrap_or(false) {
    return false;
  }
  if st["muted"].as_bool().unwrap_or(false) {
    return false;
  }
  let mut any_solo = false;
  if let Some(obj) = lanes.as_object() {
    for (_, v) in obj {
      if v["solo"].as_bool().unwrap_or(false) {
        any_solo = true;
        break;
      }
    }
  }
  if any_solo {
    return st["solo"].as_bool().unwrap_or(false);
  }
  true
}

fn project_end(clips: &[Value]) -> f64 {
  let mut end = 0.0_f64;
  for c in clips {
    let s = c["start"].as_f64().unwrap_or(0.0);
    let d = c["duration"].as_f64().unwrap_or(0.0);
    if s + d > end {
      end = s + d;
    }
  }
  end
}

fn flatten_nested_clips(raw: &[Value], visited: &mut HashSet<String>, depth: usize) -> Vec<Value> {
  if depth > 8 {
    return raw.to_vec();
  }
  let mut out = Vec::new();
  for c in raw {
    let cid = c["id"].as_str().unwrap_or("").to_string();
    if let Some(nested) = c["nestedClips"].as_array() {
      if !nested.is_empty() && !visited.contains(&cid) {
        visited.insert(cid.clone());
        let inner = flatten_nested_clips(nested, visited, depth + 1);
        visited.remove(&cid);
        if inner.is_empty() {
          out.push(c.clone());
          continue;
        }
        let inner_min_start = inner
          .iter()
          .map(|nc| nc["start"].as_f64().unwrap_or(0.0))
          .fold(f64::INFINITY, f64::min);
        let container_in = c["in"].as_f64().unwrap_or(0.0).max(0.0);
        let container_dur = c["duration"].as_f64().unwrap_or(0.05).max(0.05);
        let container_start = c["start"].as_f64().unwrap_or(0.0);

        for nc in inner {
          let nc_start = nc["start"].as_f64().unwrap_or(0.0);
          let nc_dur = nc["duration"].as_f64().unwrap_or(0.0);
          let rel_start = nc_start - inner_min_start;
          let rel_end = rel_start + nc_dur;
          let vis_start = rel_start.max(container_in);
          let vis_end = rel_end.min(container_in + container_dur);
          let vis_dur = vis_end - vis_start;
          if vis_dur <= 0.02 {
            continue;
          }
          let head_cut = (vis_start - rel_start).max(0.0);
          let spd = (nc["speed"].as_f64().unwrap_or(100.0) / 100.0).clamp(0.25, 4.0);
          let mut child = nc.clone();
          child["id"] = json!(format!("{}::{}", cid, nc["id"].as_str().unwrap_or("x")));
          child["start"] = json!(container_start + (vis_start - container_in));
          child["in"] = json!(nc["in"].as_f64().unwrap_or(0.0) + head_cut * spd);
          child["duration"] = json!(vis_dur);
          child["fadeIn"] = json!((nc["fadeIn"].as_f64().unwrap_or(0.0) - head_cut).max(0.0));
          child["fadeOut"] = json!((nc["fadeOut"].as_f64().unwrap_or(0.0) - (rel_end - vis_end).max(0.0)).max(0.0));
          child.as_object_mut().map(|m| m.remove("nestedClips"));
          out.push(child);
        }
        continue;
      }
    }
    out.push(c.clone());
  }
  out
}

fn slice_clips_to_range(
  raw_clips: &[Value],
  range_start: Option<f64>,
  range_end: Option<f64>,
) -> (Vec<Value>, f64, f64) {
  let mut visited = HashSet::new();
  let flat = flatten_nested_clips(raw_clips, &mut visited, 0);
  let full_total = project_end(&flat);
  let r_start = range_start.unwrap_or(0.0).max(0.0);
  let r_end = match range_end {
    Some(re) if re > r_start + 0.05 => re.min(full_total),
    _ => full_total,
  };

  if r_start <= 0.001 && r_end >= full_total - 0.001 {
    return (flat, full_total, 0.0);
  }

  let mut sliced = Vec::new();
  for c in flat {
    let cs = c["start"].as_f64().unwrap_or(0.0);
    let cd = c["duration"].as_f64().unwrap_or(0.0);
    let ce = cs + cd;
    if ce <= r_start + 0.02 || cs >= r_end - 0.02 {
      continue;
    }
    let ov_start = cs.max(r_start);
    let ov_end = ce.min(r_end);
    let dur = ov_end - ov_start;
    if dur <= 0.02 {
      continue;
    }
    let head_cut = (ov_start - cs).max(0.0);
    let spd = effective_speed_factor(&c);
    let mut nc = c.clone();
    nc["start"] = json!(ov_start - r_start);
    nc["in"] = json!(c["in"].as_f64().unwrap_or(0.0) + head_cut * spd);
    nc["duration"] = json!(dur);
    nc["fadeIn"] = json!((c["fadeIn"].as_f64().unwrap_or(0.0) - head_cut).max(0.0));
    nc["fadeOut"] = json!((c["fadeOut"].as_f64().unwrap_or(0.0) - (ce - ov_end).max(0.0)).max(0.0));
    sliced.push(nc);
  }
  (sliced, (r_end - r_start).max(0.0), r_start)
}

fn default_param_val(param: &str, tf: &Value) -> f64 {
  match param {
    "scale" => tf["scale"].as_f64().unwrap_or(100.0),
    "posX" => tf["posX"].as_f64().unwrap_or(0.0),
    "posY" => tf["posY"].as_f64().unwrap_or(0.0),
    "rotation" => tf["rotation"].as_f64().unwrap_or(0.0),
    "opacity" => tf["opacity"].as_f64().unwrap_or(100.0),
    _ => 0.0,
  }
}

fn get_param_keyframes(clip: &Value, param: &str) -> Vec<(f64, f64, String)> {
  let Some(arr) = clip["keyframes"].as_array() else {
    return vec![];
  };
  let mut kfs: Vec<(f64, f64, String)> = arr
    .iter()
    .filter(|k| k["param"].as_str() == Some(param))
    .filter_map(|k| {
      Some((
        k["time"].as_f64()?,
        k["value"].as_f64()?,
        k["easing"].as_str().unwrap_or("linear").to_string(),
      ))
    })
    .collect();
  kfs.sort_by(|a, b| a.0.partial_cmp(&b.0).unwrap_or(std::cmp::Ordering::Equal));
  kfs
}

fn build_ffmpeg_keyframe_expr(clip: &Value, param: &str, time_var: &str) -> String {
  let kfs = get_param_keyframes(clip, param);
  if kfs.is_empty() {
    return format!("{:.4}", default_param_val(param, &clip["transform"]));
  }
  if kfs.len() == 1 {
    return format!("{:.4}", kfs[0].1);
  }
  let clip_easing = clip["keyframeEasing"].as_str().unwrap_or("linear");
  let mut expr = format!("{:.4}", kfs.last().unwrap().1);
  for i in (0..(kfs.len() - 1)).rev() {
    let a = &kfs[i];
    let b = &kfs[i + 1];
    let t0 = format!("{:.4}", a.0);
    let t1 = format!("{:.4}", b.0);
    let dt = format!("{:.4}", (b.0 - a.0).max(0.001));
    let v0 = format!("{:.4}", a.1);
    let dv = format!("{:.4}", b.1 - a.1);
    let u_expr = format!("(({}-{})/{})", time_var, t0, dt);
    let seg_mode = if a.2.is_empty() { clip_easing } else { a.2.as_str() };
    let eased_expr = if seg_mode == "ease-in-out" {
      format!("(pow({},2)*(3-2*{}))", u_expr, u_expr)
    } else {
      u_expr
    };
    let seg_val = format!("({}+({})*{})", v0, dv, eased_expr);
    expr = format!("if(lte({},{}),{},{})", time_var, t1, seg_val, expr);
  }
  let first_t = format!("{:.4}", kfs[0].0);
  let first_v = format!("{:.4}", kfs[0].1);
  format!("if(lte({},{}),{},{})", time_var, first_t, first_v, expr)
}

fn get_ordered_video_lanes_asc(lanes: &Value, clips: &[Value]) -> Vec<String> {
  let mut set: HashSet<String> = HashSet::new();
  if let Some(obj) = lanes.as_object() {
    for k in obj.keys() {
      if is_video_lane(k) {
        set.insert(k.clone());
      }
    }
  }
  for c in clips {
    if let Some(l) = c["lane"].as_str() {
      if is_video_lane(l) {
        set.insert(l.to_string());
      }
    }
  }
  let mut list: Vec<String> = set.into_iter().collect();
  list.sort_by_key(|l| lane_number(l));
  list
}

fn hex_to_rgb01(hex: &str) -> (f64, f64, f64) {
  let clean = hex.trim().trim_start_matches('#');
  if clean.len() < 6 {
    return (1.0, 0.85, 0.7);
  }
  let r = u8::from_str_radix(&clean[0..2], 16).unwrap_or(255) as f64 / 255.0;
  let g = u8::from_str_radix(&clean[2..4], 16).unwrap_or(217) as f64 / 255.0;
  let b = u8::from_str_radix(&clean[4..6], 16).unwrap_or(178) as f64 / 255.0;
  (r, g, b)
}

fn escape_filter_path(p: &str) -> String {
  p.replace('\\', "/").replace(':', "\\:").replace('\'', "\\'")
}

fn resolution_dims(res: &str) -> (u32, u32) {
  match res {
    "4k" => (3840, 2160),
    "vertical" => (1080, 1920),
    _ => (1920, 1080),
  }
}

pub fn run_full_export(
  app: &AppHandle,
  state: &Arc<AppState>,
  engine: &EngineInfo,
  req: &Value,
) -> ExportResult {
  let settings = &req["settings"];
  let res_key = settings["resolution"].as_str().unwrap_or("1080p");
  let (width, height) = resolution_dims(res_key);
  let fps = settings["fps"].as_u64().unwrap_or(30).max(1) as u32;
  let ext = if settings["format"].as_str() == Some("mov") {
    "mov"
  } else {
    "mp4"
  };
  let quality = settings["quality"].as_str().unwrap_or("high");
  let crf = match quality {
    "high" => "17",
    "low" => "26",
    _ => "21",
  };
  let preset = match quality {
    "high" => "faster",
    "low" => "ultrafast",
    _ => "veryfast",
  };

  let raw_clips = req["clips"].as_array().cloned().unwrap_or_default();
  let range_start = req["rangeStart"].as_f64();
  let range_end = req["rangeEnd"].as_f64();
  let (clips, total, range_offset) = slice_clips_to_range(&raw_clips, range_start, range_end);
  if clips.is_empty() || total <= 0.05 {
    return ExportResult {
      ok: false,
      canceled: None,
      path: None,
      error: Some("Dışa aktarılacak klip bulunamadı.".into()),
    };
  }

  let out_path = if let Some(p) = req["outputPath"].as_str().filter(|s| !s.is_empty()) {
    p.to_string()
  } else {
    let Some(file) = rfd::FileDialog::new()
      .set_title(&format!("Videoyu Dışa Aktar ({})", ext.to_uppercase()))
      .set_file_name(&format!("NoirCut-Export.{}", ext))
      .add_filter(&ext.to_uppercase(), &[ext])
      .save_file()
    else {
      return ExportResult {
        ok: false,
        canceled: Some(true),
        path: None,
        error: None,
      };
    };
    file.to_string_lossy().to_string()
  };

  // Medya havuzundan kullanılan tüm dosyaları topla
  let reg_snapshot: HashMap<String, MediaItem> = state.media_registry.lock().unwrap().clone();
  let mut image_max_dur: HashMap<String, f64> = HashMap::new();
  for c in &clips {
    if is_credit_clip(c) {
      continue;
    }
    let mid = c["mediaId"].as_str().unwrap_or("");
    if let Some(m) = reg_snapshot.get(mid) {
      if m.media_kind == "image" {
        let spd = effective_speed_factor(&c);
        let need = (c["duration"].as_f64().unwrap_or(5.0) * spd + 1.0).max(1.0);
        let cur = image_max_dur.get(mid).copied().unwrap_or(0.0);
        image_max_dur.insert(mid.to_string(), cur.max(need));
      }
    }
  }

  let mut input_args: Vec<String> = Vec::new();
  let mut media_input_idx: HashMap<String, usize> = HashMap::new();
  let mut next_input_idx: usize = 0;

  for c in &clips {
    if is_credit_clip(c) {
      continue;
    }
    let mid = c["mediaId"].as_str().unwrap_or("");
    if !media_input_idx.contains_key(mid) {
      let Some(m) = reg_snapshot.get(mid) else {
        return ExportResult {
          ok: false,
          canceled: None,
          path: None,
          error: Some(format!("Medya bulunamadı: {}", c["name"].as_str().unwrap_or(mid))),
        };
      };
      media_input_idx.insert(mid.to_string(), next_input_idx);
      next_input_idx += 1;
      if m.media_kind == "image" {
        let loop_dur = image_max_dur.get(mid).copied().unwrap_or(10.0).max(5.0);
        input_args.extend(["-loop".into(), "1".into(), "-t".into(), format!("{:.2}", loop_dur), "-i".into(), m.path.clone()]);
      } else {
        input_args.extend(["-i".into(), m.path.clone()]);
      }
    }
  }

  let temp_dir = std::env::temp_dir().join(format!("noircut-rs-exp-{}-{}", std::process::id(), chrono::Utc::now().timestamp_millis()));
  let _ = fs::create_dir_all(&temp_dir);

  let mut filter_parts: Vec<String> = Vec::new();
  let mut baked_lut_cache: HashMap<String, String> = HashMap::new();
  let custom_luts = &req["customLuts"];
  let lanes = &req["lanes"];

  let build_clip_graded = |c: &Value,
                           seg_id: usize,
                           filter_parts: &mut Vec<String>,
                           baked_lut_cache: &mut HashMap<String, String>|
   -> (String, Vec<String>) {
    let mid = c["mediaId"].as_str().unwrap_or("");
    let media_item = reg_snapshot.get(mid);
    let in_idx = media_input_idx[mid];
    let spd = effective_speed_factor(&c);
    let dur = c["duration"].as_f64().unwrap_or(1.0);
    let src_dur = (dur * spd).max(0.05);
    let is_img = media_item.map(|m| m.media_kind == "image").unwrap_or(false);
    let clip_in = if is_img { 0.0 } else { c["in"].as_f64().unwrap_or(0.0) };

    let mut v_chain = vec![
      format!("trim=start={:.4}:duration={:.4}", clip_in, src_dur),
      format!("setpts=(PTS-STARTPTS)/{:.4}", spd),
    ];
    if c["reverse"].as_bool().unwrap_or(false) && !is_img {
      v_chain.push("reverse".into());
    }
    v_chain.extend([
      format!("fps={}", fps),
      format!("scale={}:{}:force_original_aspect_ratio=decrease", width, height),
      format!("pad={}:{}:(ow-iw)/2:(oh-ih)/2:black", width, height),
      "setsar=1".into(),
    ]);

    let mut fx_out_label: Option<String> = None;
    let grade = &c["grade"];
    if grade.is_object() && !is_neutral_grade_json(grade) {
      let grade_key = serde_json::to_string(grade).unwrap_or_default();
      let cube_name = if let Some(cached_name) = baked_lut_cache.get(&grade_key) {
        cached_name.clone()
      } else {
        let name = format!("grade-{}.cube", seg_id);
        let cube_str = bake_color_grade_to_cube_rayon(grade, custom_luts, 33);
        let _ = fs::write(temp_dir.join(&name), cube_str);
        baked_lut_cache.insert(grade_key, name.clone());
        name
      };
      v_chain.push("format=rgb24".into());
      v_chain.push(format!("lut3d=file='{}':interp=trilinear", escape_filter_path(&cube_name)));

      let nf = &grade["noirFilm"];
      let nf_int = (nf["lookIntensity"].as_f64().unwrap_or(100.0) / 100.0).clamp(0.0, 1.0);
      let halation = grade["halation"].as_f64().unwrap_or(0.0).clamp(0.0, 100.0);
      let mist = grade["mist"].as_f64().unwrap_or(0.0).clamp(0.0, 100.0);

      let nf_hal = &nf["lightEffects"]["halation"];
      let nf_blm = &nf["lightEffects"]["bloom"];
      let nf_dif = &nf["lightEffects"]["diffusion"];
      let nf_mst = &nf["lightEffects"]["mist"];
      let has_nf_hal = nf_hal["enabled"].as_bool().unwrap_or(false) && nf_hal["intensity"].as_f64().unwrap_or(0.0) > 0.5 && nf_int > 0.01;
      let has_nf_blm = nf_blm["enabled"].as_bool().unwrap_or(false) && nf_blm["intensity"].as_f64().unwrap_or(0.0) > 0.5 && nf_int > 0.01;
      let has_nf_dif = nf_dif["enabled"].as_bool().unwrap_or(false) && nf_dif["strength"].as_f64().unwrap_or(0.0) > 0.5 && nf_int > 0.01;
      let has_nf_mst = nf_mst["enabled"].as_bool().unwrap_or(false) && nf_mst["intensity"].as_f64().unwrap_or(0.0) > 0.5 && nf_int > 0.01;

      if halation > 0.5 || mist > 0.5 || has_nf_hal || has_nf_blm || has_nf_dif || has_nf_mst {
        let mut cur = format!("fxin{}", seg_id);
        filter_parts.push(format!("[{}:v]{}[{}]", in_idx, v_chain.join(","), cur));
        v_chain.clear();

        if halation > 0.5 {
          let (a, b, g, out) = (format!("hal_a{}", seg_id), format!("hal_b{}", seg_id), format!("hal_g{}", seg_id), format!("hal_o{}", seg_id));
          let sigma = height as f64 * (0.008 + 0.014 * (halation / 100.0));
          let opacity = 0.15 + 0.85 * (halation / 100.0) * 0.8;
          filter_parts.push(format!("[{}]split=2[{}][{}]", cur, a, b));
          filter_parts.push(format!("[{}]curves=all='0/0 0.55/0 1/1',gblur=sigma={:.2},colorchannelmixer=rr=1:gg=0.30:bb=0.04[{}]", b, sigma, g));
          filter_parts.push(format!("[{}][{}]blend=all_mode=screen:all_opacity={:.3},format=rgb24[{}]", a, g, opacity, out));
          cur = out;
        }
        if mist > 0.5 {
          let (a, b, g, out) = (format!("mist_a{}", seg_id), format!("mist_b{}", seg_id), format!("mist_g{}", seg_id), format!("mist_o{}", seg_id));
          let sigma = height as f64 * (0.01 + 0.025 * (mist / 100.0));
          let opacity = (mist / 100.0) * 0.42;
          filter_parts.push(format!("[{}]split=2[{}][{}]", cur, a, b));
          filter_parts.push(format!("[{}]gblur=sigma={:.2}[{}]", b, sigma, g));
          filter_parts.push(format!("[{}][{}]blend=all_mode=screen:all_opacity={:.3},format=rgb24[{}]", a, g, opacity, out));
          cur = out;
        }
        if has_nf_hal {
          let (a, b, g, out) = (format!("nfh_a{}", seg_id), format!("nfh_b{}", seg_id), format!("nfh_g{}", seg_id), format!("nfh_o{}", seg_id));
          let (tr, tg, tb) = hex_to_rgb01(nf_hal["tint"].as_str().unwrap_or("#FF3B1F"));
          let thr = (nf_hal["threshold"].as_f64().unwrap_or(72.0) / 100.0).clamp(0.15, 0.96);
          let sigma = height as f64 * (0.006 + 0.02 * (nf_hal["radius"].as_f64().unwrap_or(50.0) / 100.0));
          let opacity = (0.12 + 0.72 * (nf_hal["intensity"].as_f64().unwrap_or(0.0) / 100.0) * nf_int).min(0.88);
          filter_parts.push(format!("[{}]split=2[{}][{}]", cur, a, b));
          filter_parts.push(format!("[{}]curves=all='0/0 {:.2}/0 1/1',gblur=sigma={:.2},colorchannelmixer=rr={:.3}:gg={:.3}:bb={:.3}[{}]", b, thr, sigma, tr, tg, tb, g));
          filter_parts.push(format!("[{}][{}]blend=all_mode=screen:all_opacity={:.3},format=rgb24[{}]", a, g, opacity, out));
          cur = out;
        }
        if has_nf_blm {
          let (a, b, g, out) = (format!("nfb_a{}", seg_id), format!("nfb_b{}", seg_id), format!("nfb_g{}", seg_id), format!("nfb_o{}", seg_id));
          let thr = (nf_blm["threshold"].as_f64().unwrap_or(70.0) / 100.0).clamp(0.15, 0.96);
          let sigma = height as f64 * (0.008 + 0.022 * (nf_blm["radius"].as_f64().unwrap_or(50.0) / 100.0));
          let opacity = (0.1 + 0.6 * (nf_blm["intensity"].as_f64().unwrap_or(0.0) / 100.0) * nf_int).min(0.8);
          filter_parts.push(format!("[{}]split=2[{}][{}]", cur, a, b));
          filter_parts.push(format!("[{}]curves=all='0/0 {:.2}/0 1/1',gblur=sigma={:.2}[{}]", b, thr, sigma, g));
          filter_parts.push(format!("[{}][{}]blend=all_mode=screen:all_opacity={:.3},format=rgb24[{}]", a, g, opacity, out));
          cur = out;
        }
        if has_nf_dif || has_nf_mst {
          let (a, b, g, out) = (format!("nfm_a{}", seg_id), format!("nfm_b{}", seg_id), format!("nfm_g{}", seg_id), format!("nfm_o{}", seg_id));
          let amt = (if has_nf_dif { nf_dif["strength"].as_f64().unwrap_or(0.0) } else { 0.0 })
            .max(if has_nf_mst { nf_mst["intensity"].as_f64().unwrap_or(0.0) } else { 0.0 }) / 100.0 * nf_int;
          let sigma = height as f64 * (0.008 + 0.024 * amt);
          let opacity = (amt * 0.45).min(0.65);
          filter_parts.push(format!("[{}]split=2[{}][{}]", cur, a, b));
          filter_parts.push(format!("[{}]gblur=sigma={:.2}[{}]", b, sigma, g));
          filter_parts.push(format!("[{}][{}]blend=all_mode=screen:all_opacity={:.3},format=rgb24[{}]", a, g, opacity, out));
          cur = out;
        }
        fx_out_label = Some(cur);
      }

      let tex = &nf["texture"];
      let nf_grain = if tex["enabled"].as_bool().unwrap_or(false) && tex["amount"].as_f64().unwrap_or(0.0) > 0.5 && nf_int > 0.01 {
        (((tex["amount"].as_f64().unwrap_or(0.0) / 100.0) * (0.5 + tex["strength"].as_f64().unwrap_or(50.0) / 100.0) * nf_int * 20.0).round()) as i32
      } else {
        0
      };
      let fg = grade["filmGrain"].as_f64().unwrap_or(0.0);
      let base_grain = if fg > 0.5 { ((fg.min(100.0) / 100.0) * 26.0).round().max(1.0) as i32 } else { 0 };
      let combined_grain = base_grain.max(nf_grain);
      if combined_grain > 0 {
        let flags = if tex["colorGrain"].as_f64().unwrap_or(0.0) > 30.0 { "t+u" } else { "t" };
        v_chain.push(format!("noise=alls={}:allf={}", combined_grain, flags));
      }

      let ck = &nf["chromaKey"];
      if ck["enabled"].as_bool().unwrap_or(false) {
        let hex_clean = ck["keyColor"].as_str().unwrap_or("#00B140").trim_start_matches('#');
        let sim = (ck["tolerance"].as_f64().unwrap_or(30.0) / 100.0).clamp(0.01, 0.85);
        let bln = (ck["edgeSoftness"].as_f64().unwrap_or(15.0) / 100.0).clamp(0.0, 0.6);
        v_chain.push(format!("colorkey=0x{}:{:.3}:{:.3}", hex_clean, sim, bln));
        if c["lane"].as_str() == Some("V1") {
          let bg_hex = ck["bgColor"].as_str().unwrap_or("#0B0D12").trim_start_matches('#');
          let (ck_pre, ck_fg, ck_bg0, ck_bg, ck_out) = (
            format!("vck_pre_{}", seg_id),
            format!("vck_fg_{}", seg_id),
            format!("vck_bg0_{}", seg_id),
            format!("vck_bg_{}", seg_id),
            format!("vck_out_{}", seg_id),
          );
          let src_lbl = fx_out_label.as_ref().map(|l| format!("[{}]", l)).unwrap_or_else(|| format!("[{}:v]", in_idx));
          filter_parts.push(format!("{}{},format=rgba[{}]", src_lbl, v_chain.join(","), ck_pre));
          v_chain.clear();
          filter_parts.push(format!("[{}]split=2[{}][{}]", ck_pre, ck_fg, ck_bg0));
          filter_parts.push(format!("[{}]drawbox=x=0:y=0:w=iw:h=ih:color=0x{}:t=fill,format=rgba[{}]", ck_bg0, bg_hex, ck_bg));
          filter_parts.push(format!("[{}][{}]overlay=x=0:y=0:format=auto[{}]", ck_bg, ck_fg, ck_out));
          fx_out_label = Some(ck_out);
        }
      }
    }

    let out_lbl = fx_out_label.map(|l| format!("[{}]", l)).unwrap_or_else(|| format!("[{}:v]", in_idx));
    (out_lbl, v_chain)
  };

  // 1) V1 Taban Video Akışı
  let v1_audible = is_lane_audible(lanes, "V1");
  let mut v_clips: Vec<&Value> = if v1_audible {
    clips
      .iter()
      .filter(|c| c["lane"].as_str() == Some("V1") && !is_credit_clip(c) && c["duration"].as_f64().unwrap_or(0.0) > 0.02)
      .collect()
  } else {
    vec![]
  };
  v_clips.sort_by(|a, b| a["start"].as_f64().unwrap_or(0.0).partial_cmp(&b["start"].as_f64().unwrap_or(0.0)).unwrap_or(std::cmp::Ordering::Equal));

  let mut v_seg_labels: Vec<String> = Vec::new();
  let mut cursor = 0.0_f64;
  let mut seg_counter: usize = 0;
  let min_gap_sec = (0.95 / fps as f64).max(0.045);

  for c in v_clips {
    let cs = c["start"].as_f64().unwrap_or(0.0);
    let cd = c["duration"].as_f64().unwrap_or(0.0);
    if cs > cursor + min_gap_sec {
      let gap = cs - cursor;
      let lbl = format!("vseg{}", seg_counter);
      seg_counter += 1;
      filter_parts.push(format!("color=c=black:s={}x{}:r={}:d={:.4},format=yuv420p[{}]", width, height, fps, gap, lbl));
      v_seg_labels.push(format!("[{}]", lbl));
    }
    let seg_id = seg_counter;
    seg_counter += 1;
    let lbl = format!("vseg{}", seg_id);
    let (mut stream_label, mut v_chain) = build_clip_graded(c, seg_id, &mut filter_parts, &mut baked_lut_cache);

    let has_kfs = c["keyframes"].as_array().map(|a| !a.is_empty()).unwrap_or(false);
    let tf = &c["transform"];

    if has_kfs {
      let pre_lbl = format!("vpre{}", seg_id);
      let joined = if v_chain.is_empty() { "null".to_string() } else { v_chain.join(",") };
      filter_parts.push(format!("{}{}[{}]", stream_label, joined, pre_lbl));
      v_chain.clear();

      let (bg0, fg0, bg, fg, ov) = (format!("vbg0_{}", seg_id), format!("vfg0_{}", seg_id), format!("vbg_{}", seg_id), format!("vfg_{}", seg_id), format!("vov_kf_{}", seg_id));
      filter_parts.push(format!("[{}]split=2[{}][{}]", pre_lbl, bg0, fg0));
      filter_parts.push(format!("[{}]drawbox=x=0:y=0:w=iw:h=ih:color=black:t=fill[{}]", bg0, bg));

      let scale_expr = build_ffmpeg_keyframe_expr(c, "scale", "t");
      let pos_x_expr = build_ffmpeg_keyframe_expr(c, "posX", "t");
      let pos_y_expr = build_ffmpeg_keyframe_expr(c, "posY", "t");
      let rot_expr = build_ffmpeg_keyframe_expr(c, "rotation", "t");
      let has_rot = !get_param_keyframes(c, "rotation").is_empty() || tf["rotation"].as_f64().unwrap_or(0.0).abs() > 0.25;

      let mut fg_chain = vec![
        "format=rgba".to_string(),
        format!("scale=w='max(16,trunc({}*clip(({})/100,0.1,4.0)/2)*2)':h='max(16,trunc({}*clip(({})/100,0.1,4.0)/2)*2)':eval=frame", width, scale_expr, height, scale_expr),
      ];
      if has_rot {
        fg_chain.push(format!("rotate=a='(({})*PI/180)':ow=iw:oh=ih:c=0x00000000", rot_expr));
      }
      filter_parts.push(format!("[{}]{}[{}]", fg0, fg_chain.join(","), fg));
      filter_parts.push(format!("[{}][{}]overlay=x='(W-w)/2+(W*({})/100)':y='(H-h)/2+(H*({})/100)':eval=frame:format=auto[{}]", bg, fg, pos_x_expr, pos_y_expr, ov));
      stream_label = format!("[{}]", ov);

      if !get_param_keyframes(c, "opacity").is_empty() {
        let op_expr = build_ffmpeg_keyframe_expr(c, "opacity", "T");
        let (opa, opb0, opb, opout) = (format!("vopa_{}", seg_id), format!("vopb0_{}", seg_id), format!("vopb_{}", seg_id), format!("vopout_{}", seg_id));
        filter_parts.push(format!("{}format=rgb24,split=2[{}][{}]", stream_label, opa, opb0));
        filter_parts.push(format!("[{}]drawbox=x=0:y=0:w=iw:h=ih:color=black:t=fill[{}]", opb0, opb));
        filter_parts.push(format!("[{}][{}]blend=all_expr='A*clip(({})/100,0,1)'[{}]", opa, opb, op_expr, opout));
        stream_label = format!("[{}]", opout);
      } else if tf["opacity"].as_f64().unwrap_or(100.0) < 99.5 {
        let op = (tf["opacity"].as_f64().unwrap_or(100.0) / 100.0).clamp(0.0, 1.0);
        v_chain.push(format!("colorchannelmixer=rr={:.3}:gg={:.3}:bb={:.3}", op, op, op));
      }
    } else if tf.is_object() {
      let sc = (tf["scale"].as_f64().unwrap_or(100.0) / 100.0).clamp(0.1, 4.0);
      let px = (tf["posX"].as_f64().unwrap_or(0.0) / 100.0) * width as f64;
      let py = (tf["posY"].as_f64().unwrap_or(0.0) / 100.0) * height as f64;
      let rot_rad = tf["rotation"].as_f64().unwrap_or(0.0) * std::f64::consts::PI / 180.0;
      let op = (tf["opacity"].as_f64().unwrap_or(100.0) / 100.0).clamp(0.0, 1.0);

      if (sc - 1.0).abs() > 0.01 || px.abs() > 0.5 || py.abs() > 0.5 {
        let sw = (((width as f64 * sc) / 2.0).round() as i32 * 2).max(16);
        let sh = (((height as f64 * sc) / 2.0).round() as i32 * 2).max(16);
        v_chain.push(format!("scale={}:{}", sw, sh));
        if sc >= 1.0 {
          let cx = (((sw - width as i32) as f64 / 2.0 - px).round() as i32).clamp(0, (sw - width as i32).max(0));
          let cy = (((sh - height as i32) as f64 / 2.0 - py).round() as i32).clamp(0, (sh - height as i32).max(0));
          v_chain.push(format!("crop={}:{}:{}:{}", width, height, cx, cy));
        } else {
          let pad_x = (((width as i32 - sw) as f64 / 2.0 + px).round() as i32).clamp(0, (width as i32 - sw).max(0));
          let pad_y = (((height as i32 - sh) as f64 / 2.0 + py).round() as i32).clamp(0, (height as i32 - sh).max(0));
          v_chain.push(format!("pad={}:{}:{}:{}:black", width, height, pad_x, pad_y));
        }
      }
      if rot_rad.abs() > 0.005 {
        v_chain.push(format!("rotate={:.4}:ow={}:oh={}:c=black", rot_rad, width, height));
      }
      if op < 0.995 {
        v_chain.push(format!("colorchannelmixer=rr={:.3}:gg={:.3}:bb={:.3}", op, op, op));
      }
    }

    let tr_type = c["transitionType"].as_str().unwrap_or("none");
    let tr_dur_raw = c["transitionDuration"].as_f64().unwrap_or(0.8);
    if tr_type != "none" && tr_dur_raw > 0.05 {
      let tr_dur = tr_dur_raw.min(cd * 0.48);
      let fo_start = (cd - tr_dur).max(0.0);
      if tr_type == "wipe-left" {
        v_chain.push(format!("drawbox=x='iw*(t/{:.4})':y=0:w=iw:h=ih:color=black:t=fill:enable='lt(t,{:.4})'", tr_dur, tr_dur));
        v_chain.push(format!("drawbox=x=0:y=0:w='iw*((t-{:.4})/{:.4})':h=ih:color=black:t=fill:enable='gt(t,{:.4})'", fo_start, tr_dur, fo_start));
      } else if tr_type == "film-burn" {
        v_chain.push(format!(
          "eq=brightness='if(lt(t,{:.4}),0.45*(1-t/{:.4}),if(gt(t,{:.4}),0.45*((t-{:.4})/{:.4}),0))':saturation='if(lt(t,{:.4}),1+0.8*(1-t/{:.4}),if(gt(t,{:.4}),1+0.8*((t-{:.4})/{:.4}),1))':eval=frame",
          tr_dur, tr_dur, fo_start, fo_start, tr_dur, tr_dur, tr_dur, fo_start, fo_start, tr_dur
        ));
        v_chain.push(format!("fade=t=in:st=0:d={:.4}:color=white", tr_dur));
        v_chain.push(format!("fade=t=out:st={:.4}:d={:.4}:color=white", fo_start, tr_dur));
      } else if tr_type == "zoom-in" {
        v_chain.push(format!("scale=w='trunc(iw*(1+0.35*max(0,1-t/{:.4}))/2)*2':h='trunc(ih*(1+0.35*max(0,1-t/{:.4}))/2)*2':eval=frame", tr_dur, tr_dur));
        v_chain.push(format!("crop={}:{}", width, height));
        v_chain.push(format!("fade=t=in:st=0:d={:.4}:color=black", tr_dur));
        v_chain.push(format!("fade=t=out:st={:.4}:d={:.4}:color=black", fo_start, tr_dur));
      } else {
        v_chain.push(format!("fade=t=in:st=0:d={:.4}:color=black", tr_dur));
        v_chain.push(format!("fade=t=out:st={:.4}:d={:.4}:color=black", fo_start, tr_dur));
      }
    }

    let mut mask_handled = false;
    if c["mask"]["enabled"].as_bool().unwrap_or(false) {
      let mode = c["mask"]["mode"].as_str().unwrap_or("blur");
      let strength = c["mask"]["strength"].as_f64().unwrap_or(65.0).clamp(5.0, 100.0);
      if mode == "vignette" {
        v_chain.push(format!("vignette=angle={:.3}", (strength / 100.0) * 1.25));
      } else {
        let mw = c["mask"]["w"].as_f64().unwrap_or(32.0).clamp(5.0, 100.0);
        let mh = c["mask"]["h"].as_f64().unwrap_or(32.0).clamp(5.0, 100.0);
        let mx = c["mask"]["x"].as_f64().unwrap_or(50.0).clamp(0.0, 100.0);
        let my = c["mask"]["y"].as_f64().unwrap_or(50.0).clamp(0.0, 100.0);
        let cw = ((((mw / 100.0) * width as f64).round() as u32).max(16)) & !1;
        let ch = ((((mh / 100.0) * height as f64).round() as u32).max(16)) & !1;
        let cx = (((mx / 100.0) * width as f64 - cw as f64 / 2.0).round() as i64)
          .clamp(0, (width.saturating_sub(cw)) as i64);
        let cy = (((my / 100.0) * height as f64 - ch as f64 / 2.0).round() as i64)
          .clamp(0, (height.saturating_sub(ch)) as i64);
        let pre = format!("mpre{}", seg_counter);
        let bg = format!("mbg{}", seg_counter);
        let fg = format!("mfg{}", seg_counter);
        let fx = format!("mfx{}", seg_counter);
        v_chain.extend([format!("trim=duration={:.4}", cd), "setpts=PTS-STARTPTS".into(), "format=yuv420p".into()]);
        filter_parts.push(format!("{}{}[{}]", stream_label, v_chain.join(","), pre));
        let blur_f = if mode == "mosaic" {
          let div = ((strength / 4.0).round() as u32).max(4);
          let sw = (cw / div).max(4);
          format!("scale=w={}:h=-1:flags=neighbor,scale={}:{}:flags=neighbor", sw, cw, ch)
        } else {
          let rad = ((strength / 100.0) * 28.0).round() as u32;
          format!("boxblur={}:2", rad.max(2))
        };
        filter_parts.push(format!("[{}]split[{}][{}]", pre, bg, fg));
        filter_parts.push(format!("[{}]crop={}:{}:{}:{},{}[{}]", fg, cw, ch, cx, cy, blur_f, fx));
        filter_parts.push(format!("[{}][{}]overlay={}:{}[{}]", bg, fx, cx, cy, lbl));
        mask_handled = true;
      }
    }

    if !mask_handled {
      v_chain.extend([format!("trim=duration={:.4}", cd), "setpts=PTS-STARTPTS".into(), "format=yuv420p".into()]);
      filter_parts.push(format!("{}{}[{}]", stream_label, v_chain.join(","), lbl));
    }
    v_seg_labels.push(format!("[{}]", lbl));
    cursor = cs + cd;
  }

  if total > cursor + 0.02 || v_seg_labels.is_empty() {
    let tail = (total - cursor).max(0.05);
    let lbl = format!("vseg{}", seg_counter);
    seg_counter += 1;
    filter_parts.push(format!("color=c=black:s={}x{}:r={}:d={:.4},format=yuv420p[{}]", width, height, fps, tail, lbl));
    v_seg_labels.push(format!("[{}]", lbl));
  }

  if v_seg_labels.len() == 1 {
    filter_parts.push(format!("{}null[vbase]", v_seg_labels[0]));
  } else {
    filter_parts.push(format!("{}concat=n={}:v=1:a=0[vbase]", v_seg_labels.join(""), v_seg_labels.len()));
  }

  // 1b) Üst Video Kanalları (V2, V3...)
  let mut current_v_label = "[vbase]".to_string();
  let mut ov_counter = 0usize;
  for lane_id in get_ordered_video_lanes_asc(lanes, &clips) {
    if lane_id == "V1" || !is_lane_audible(lanes, &lane_id) {
      continue;
    }
    let mut lane_clips: Vec<&Value> = clips
      .iter()
      .filter(|c| c["lane"].as_str() == Some(lane_id.as_str()) && !is_credit_clip(c) && c["duration"].as_f64().unwrap_or(0.0) > 0.02)
      .collect();
    lane_clips.sort_by(|a, b| a["start"].as_f64().unwrap_or(0.0).partial_cmp(&b["start"].as_f64().unwrap_or(0.0)).unwrap_or(std::cmp::Ordering::Equal));

    for c in lane_clips {
      let seg_id = seg_counter;
      seg_counter += 1;
      let (stream_label, pending_chain) = build_clip_graded(c, seg_id, &mut filter_parts, &mut baked_lut_cache);
      let ov_idx = ov_counter;
      ov_counter += 1;
      let fg_lbl = format!("vupper{}", ov_idx);
      let next_v_label = format!("[vcomp{}]", ov_idx);

      let cs = c["start"].as_f64().unwrap_or(0.0);
      let cd = c["duration"].as_f64().unwrap_or(0.0);
      let has_kfs = c["keyframes"].as_array().map(|a| !a.is_empty()).unwrap_or(false);
      let tf = &c["transform"];

      let mut chain = pending_chain;
      chain.push(format!("trim=duration={:.4}", cd));
      chain.push("format=rgba".into());

      if has_kfs {
        let scale_expr = build_ffmpeg_keyframe_expr(c, "scale", "t");
        let rot_expr = build_ffmpeg_keyframe_expr(c, "rotation", "t");
        chain.push(format!("scale=w='max(16,trunc({}*clip(({})/100,0.1,4.0)/2)*2)':h='max(16,trunc({}*clip(({})/100,0.1,4.0)/2)*2)':eval=frame", width, scale_expr, height, scale_expr));
        if !get_param_keyframes(c, "rotation").is_empty() || tf["rotation"].as_f64().unwrap_or(0.0).abs() > 0.25 {
          chain.push(format!("rotate=a='(({})*PI/180)':ow=iw:oh=ih:c=0x00000000", rot_expr));
        }
      } else if tf.is_object() {
        let sc = (tf["scale"].as_f64().unwrap_or(100.0) / 100.0).clamp(0.1, 4.0);
        if (sc - 1.0).abs() > 0.01 {
          let sw = (((width as f64 * sc) / 2.0).round() as i32 * 2).max(16);
          let sh = (((height as f64 * sc) / 2.0).round() as i32 * 2).max(16);
          chain.push(format!("scale={}:{}", sw, sh));
        }
        let rot_rad = tf["rotation"].as_f64().unwrap_or(0.0) * std::f64::consts::PI / 180.0;
        if rot_rad.abs() > 0.005 {
          chain.push(format!("rotate={:.4}:ow=iw:oh={}:c=0x00000000", rot_rad, height));
        }
        let op = (tf["opacity"].as_f64().unwrap_or(100.0) / 100.0).clamp(0.0, 1.0);
        if op < 0.995 {
          chain.push(format!("colorchannelmixer=aa={:.3}", op));
        }
      }

      chain.push(format!("setpts=PTS-STARTPTS+{:.4}/TB", cs));
      filter_parts.push(format!("{}{}[{}]", stream_label, chain.join(","), fg_lbl));

      let start_s = format!("{:.4}", cs);
      let end_s = format!("{:.4}", cs + cd);
      if has_kfs {
        let px_expr = build_ffmpeg_keyframe_expr(c, "posX", &format!("(t-{})", start_s));
        let py_expr = build_ffmpeg_keyframe_expr(c, "posY", &format!("(t-{})", start_s));
        filter_parts.push(format!("{}[{}]overlay=x='(W-w)/2+(W*({})/100)':y='(H-h)/2+(H*({})/100)':eof_action=pass:enable='between(t,{},{})':format=auto{}", current_v_label, fg_lbl, px_expr, py_expr, start_s, end_s, next_v_label));
      } else {
        let px = (tf["posX"].as_f64().unwrap_or(0.0) / 100.0) * width as f64;
        let py = (tf["posY"].as_f64().unwrap_or(0.0) / 100.0) * height as f64;
        filter_parts.push(format!("{}[{}]overlay=x='(W-w)/2+({:.2})':y='(H-h)/2+({:.2})':eof_action=pass:enable='between(t,{},{})':format=auto{}", current_v_label, fg_lbl, px, py, start_s, end_s, next_v_label));
      }
      current_v_label = next_v_label;
    }
  }

  // 1c) Jenerik / Metin PNG Overlay Katmanı
  let credit_overlays = &req["creditOverlays"];
  let mut v2_clips: Vec<&Value> = clips
    .iter()
    .filter(|c| {
      let cid = c["id"].as_str().unwrap_or("");
      let lane = c["lane"].as_str().unwrap_or("");
      is_video_lane(lane)
        && is_credit_clip(c)
        && is_lane_audible(lanes, lane)
        && c["duration"].as_f64().unwrap_or(0.0) > 0.02
        && credit_overlays[cid].is_object()
    })
    .collect();
  v2_clips.sort_by_key(|c| lane_number(c["lane"].as_str().unwrap_or("V2")));

  for (idx, c) in v2_clips.iter().enumerate() {
    let cid = c["id"].as_str().unwrap_or("");
    let ov = &credit_overlays[cid];
    let b64 = ov["pngDataUrl"].as_str().unwrap_or("").trim_start_matches("data:image/png;base64,");
    if let Ok(bytes) = BASE64.decode(b64) {
      let png_path = temp_dir.join(format!("credit-{}.png", idx));
      let _ = fs::write(&png_path, bytes);
      let in_idx = next_input_idx;
      next_input_idx += 1;
      input_args.extend(["-loop".into(), "1".into(), "-t".into(), format!("{:.4}", total), "-i".into(), png_path.to_string_lossy().to_string()]);

      let cs = c["start"].as_f64().unwrap_or(0.0);
      let cd = c["duration"].as_f64().unwrap_or(1.0);
      let cr_lbl = format!("cr{}", idx);
      let next_v = format!("[vov{}]", idx);
      if ov["mode"].as_str() == Some("rolling") {
        filter_parts.push(format!("[{}:v]format=rgba[{}]", in_idx, cr_lbl));
        filter_parts.push(format!("{}[{}]overlay=x=0:y='H-(t-{:.4})/{:.4}*(H+h)':enable='between(t,{:.4},{:.4})'{}", current_v_label, cr_lbl, cs, cd, cs, cs + cd, next_v));
      } else {
        let fade_d = (cd * 0.18).min(0.6);
        let fo_st = (cs + cd - fade_d).max(cs);
        filter_parts.push(format!("[{}:v]format=rgba,fade=t=in:st={:.4}:d={:.4}:alpha=1,fade=t=out:st={:.4}:d={:.4}:alpha=1[{}]", in_idx, cs, fade_d, fo_st, fade_d, cr_lbl));
        filter_parts.push(format!("{}[{}]overlay=x=0:y=0:enable='between(t,{:.4},{:.4})'{}", current_v_label, cr_lbl, cs, cs + cd, next_v));
      }
      current_v_label = next_v;
    }
  }

  // 1d) Altyazı (Burn-In Subtitles) PNG Katmanları
  if settings["burnInSubtitles"].as_bool().unwrap_or(true) {
    if let Some(sub_arr) = req["subtitleOverlays"].as_array() {
      for (idx, sub) in sub_arr.iter().enumerate() {
        let start_sec = (sub["start"].as_f64().unwrap_or(0.0) - range_offset).max(0.0);
        let end_sec = (sub["end"].as_f64().unwrap_or(0.0) - range_offset).min(total);
        if end_sec <= start_sec + 0.02 {
          continue;
        }
        let b64 = sub["pngDataUrl"].as_str().unwrap_or("").trim_start_matches("data:image/png;base64,");
        if let Ok(bytes) = BASE64.decode(b64) {
          let png_path = temp_dir.join(format!("sub-{}.png", idx));
          let _ = fs::write(&png_path, bytes);
          let in_idx = next_input_idx;
          next_input_idx += 1;
          input_args.extend(["-loop".into(), "1".into(), "-t".into(), format!("{:.4}", total), "-i".into(), png_path.to_string_lossy().to_string()]);
          let sub_lbl = format!("sub{}", idx);
          let next_v = format!("[vsub{}]", idx);
          filter_parts.push(format!("[{}:v]format=rgba[{}]", in_idx, sub_lbl));
          filter_parts.push(format!("{}[{}]overlay=x=0:y=0:enable='between(t,{:.4},{:.4})'{}", current_v_label, sub_lbl, start_sec, end_sec, next_v));
          current_v_label = next_v;
        }
      }
    }
  }

  filter_parts.push(format!("{}format=yuv420p[vout]", current_v_label));

  // 2) Çok Kanallı Ses Akışı + Audio DSP Zinciri + Auto-Ducking + Master Bus
  let audible_clips: Vec<&Value> = clips
    .iter()
    .filter(|c| {
      let lane = c["lane"].as_str().unwrap_or("");
      if is_credit_clip(c) || c["duration"].as_f64().unwrap_or(0.0) <= 0.02 || c["gainDb"].as_f64().unwrap_or(0.0) <= MIN_DB {
        return false;
      }
      if is_video_lane(lane) && c["audioDetached"].as_bool().unwrap_or(false) {
        return false;
      }
      if !is_lane_audible(lanes, lane) {
        return false;
      }
      let mid = c["mediaId"].as_str().unwrap_or("");
      reg_snapshot.get(mid).map(|m| m.has_audio).unwrap_or(false)
    })
    .collect();

  let auto_ducking = req["autoDucking"].as_bool().unwrap_or(false);
  let dialog_clips: Vec<&Value> = if auto_ducking {
    audible_clips
      .iter()
      .copied()
      .filter(|c| {
        let l = c["lane"].as_str().unwrap_or("");
        is_video_lane(l) || l == "A1"
      })
      .collect()
  } else {
    vec![]
  };

  filter_parts.push(format!("anullsrc=r=48000:cl=stereo,atrim=0:{:.4},asetpts=PTS-STARTPTS[abase]", total));
  let mut a_labels = vec!["[abase]".to_string()];

  for (idx, c) in audible_clips.iter().enumerate() {
    let mid = c["mediaId"].as_str().unwrap_or("");
    let in_idx = media_input_idx[mid];
    let spd = effective_speed_factor(&c);
    let dur = c["duration"].as_f64().unwrap_or(1.0);
    let src_dur = (dur * spd).max(0.05);
    let c_in = c["in"].as_f64().unwrap_or(0.0);
    let c_start = c["start"].as_f64().unwrap_or(0.0);

    let mut chain = vec![
      format!("atrim=start={:.4}:duration={:.4}", c_in, src_dur),
      "asetpts=PTS-STARTPTS".into(),
    ];
    if c["reverse"].as_bool().unwrap_or(false) {
      chain.push("areverse".into());
    }
    if (spd - 1.0).abs() > 0.01 {
      let mut rem = spd;
      while rem < 0.5 {
        chain.push("atempo=0.5".into());
        rem /= 0.5;
      }
      while rem > 2.0 {
        chain.push("atempo=2.0".into());
        rem /= 2.0;
      }
      if (rem - 1.0).abs() > 0.01 {
        chain.push(format!("atempo={:.4}", rem));
      }
    }
    chain.extend([
      "aresample=48000".into(),
      "aformat=sample_fmts=fltp:channel_layouts=stereo".into(),
      build_gain_filter(c),
    ]);

    let pan_val = c["pan"].as_f64().unwrap_or(0.0).clamp(-100.0, 100.0) / 100.0;
    if pan_val.abs() > 0.01 {
      let l_gain = if pan_val > 0.0 { 1.0 - pan_val } else { 1.0 };
      let r_gain = if pan_val < 0.0 { 1.0 + pan_val } else { 1.0 };
      chain.push(format!("pan=stereo|c0={:.3}*c0|c1={:.3}*c1", l_gain, r_gain));
    }

    let preset_str = c["audioPreset"].as_str().unwrap_or("none");
    let fx = &c["audioEffects"];
    if preset_str == "denoise" || fx["noiseReduction"].as_bool().unwrap_or(false) {
      chain.extend(["highpass=f=85".into(), "lowpass=f=11500".into()]);
    } else if preset_str == "bass-boost" {
      chain.push("bass=g=7:f=100:w=0.6".into());
    }
    if fx.is_object() {
      let eq_l = fx["eqLowDb"].as_f64().unwrap_or(0.0);
      let eq_m = fx["eqMidDb"].as_f64().unwrap_or(0.0);
      let eq_h = fx["eqHighDb"].as_f64().unwrap_or(0.0);
      if eq_l.abs() > 0.1 {
        chain.push(format!("equalizer=f=100:t=h:w=120:g={:.1}", eq_l));
      }
      if eq_m.abs() > 0.1 {
        chain.push(format!("equalizer=f=1000:t=q:w=1.2:g={:.1}", eq_m));
      }
      if eq_h.abs() > 0.1 {
        chain.push(format!("equalizer=f=8000:t=h:w=2500:g={:.1}", eq_h));
      }
      if fx["compressorEnabled"].as_bool().unwrap_or(false) {
        let th = 10.0_f64.powf(fx["compressorThresholdDb"].as_f64().unwrap_or(-18.0) / 20.0).clamp(0.01, 1.0);
        let rat = fx["compressorRatio"].as_f64().unwrap_or(3.0).clamp(1.0, 20.0);
        chain.push(format!("acompressor=threshold={:.4}:ratio={:.1}:attack=15:release=180", th, rat));
      }
      let rev = fx["reverbMix"].as_f64().unwrap_or(0.0);
      if rev > 1.0 {
        let out_g = (1.0 - (rev / 100.0) * 0.35).max(0.3);
        let dec = ((rev / 100.0) * 0.65).clamp(0.05, 0.85);
        chain.push(format!("aecho=0.8:{:.2}:60|110:{:.2}|{:.2}", out_g, dec, dec * 0.7));
      }
      if fx["limiterEnabled"].as_bool().unwrap_or(false) {
        let lim = 10.0_f64.powf(fx["limiterCeilingDb"].as_f64().unwrap_or(-1.0) / 20.0).clamp(0.1, 1.0);
        chain.push(format!("alimiter=limit={:.4}:level=disabled", lim));
      }
    }

    let fi = c["fadeIn"].as_f64().unwrap_or(0.0);
    if fi > 0.005 {
      chain.push(format!("afade=t=in:st=0:d={:.4}:curve=tri", fi.min(dur)));
    }
    let fo = c["fadeOut"].as_f64().unwrap_or(0.0);
    if fo > 0.005 {
      let fod = fo.min(dur);
      let st = (dur - fod).max(0.0);
      chain.push(format!("afade=t=out:st={:.4}:d={:.4}:curve=tri", st, fod));
    }
    if c_start > 0.001 {
      chain.push(format!("adelay={}:all=1", (c_start * 1000.0).round() as u64));
    }
    chain.push(format!("apad=whole_dur={:.4}", total));

    let lane = c["lane"].as_str().unwrap_or("");
    if is_audio_lane(lane) && lane != "A1" && !dialog_clips.is_empty() {
      let terms: Vec<String> = dialog_clips
        .iter()
        .map(|dc| {
          let ds = dc["start"].as_f64().unwrap_or(0.0);
          let dd = dc["duration"].as_f64().unwrap_or(0.0);
          format!("between(t,{:.4},{:.4})", ds, ds + dd)
        })
        .collect();
      chain.push(format!("volume=volume='if(gt({},0),0.28,1.0)':eval=frame", terms.join("+")));
    }

    let lbl = format!("aud{}", idx);
    filter_parts.push(format!("[{}:a]{}[{}]", in_idx, chain.join(","), lbl));
    a_labels.push(format!("[{}]", lbl));
  }

  let master_db = req["masterGainDb"].as_f64().unwrap_or(0.0);
  let master_gain = if master_db.abs() > 0.05 { db_to_gain(master_db) } else { 1.0 };
  let master_vol = if (master_gain - 1.0).abs() > 0.01 {
    format!(",volume={:.4}", master_gain)
  } else {
    String::new()
  };

  if a_labels.len() == 1 {
    filter_parts.push(format!("[abase]anull{}[aout]", master_vol));
  } else {
    filter_parts.push(format!("{}amix=inputs={}:duration=first:dropout_transition=0:normalize=0{}[aout]", a_labels.join(""), a_labels.len(), master_vol));
  }

  // Kodlayıcı seçimi
  let avail = &engine.available_encoders;
  let req_enc = settings["encoder"].as_str().unwrap_or("auto");
  let want_hevc_codec = settings["codec"].as_str() == Some("h265");
  let hw_encoder: String = if req_enc == "auto" {
    if want_hevc_codec {
      avail.iter().find(|e| e.as_str() == "hevc_nvenc")
        .or_else(|| avail.iter().find(|e| e.as_str() == "libx265"))
        .cloned()
        .unwrap_or_else(|| "libx264".into())
    } else {
      avail.iter()
        .find(|e| matches!(e.as_str(), "h264_nvenc" | "h264_vaapi" | "h264_qsv" | "h264_amf"))
        .cloned()
        .unwrap_or_else(|| "libx264".into())
    }
  } else if avail.iter().any(|e| e == req_enc) {
    req_enc.to_string()
  } else {
    "libx264".into()
  };

  let temp_out = format!("{}.part-{}-{}.{}", out_path, std::process::id(), chrono::Utc::now().timestamp_millis(), ext);

  let run_pass = |enc: &str| -> Result<(), String> {
    let _ = fs::remove_file(&temp_out);
    let is_vaapi = enc == "h264_vaapi";
    let mut parts = filter_parts.clone();
    if is_vaapi {
      parts.push("[vout]format=nv12,hwupload[vout_hw]".into());
    }
    let v_map = if is_vaapi { "[vout_hw]" } else { "[vout]" };
    let bin = if enc != "libx264" {
      engine.gpu_ffmpeg_path.clone().unwrap_or_else(|| engine.ffmpeg_path.clone())
    } else {
      engine.ffmpeg_path.clone()
    };

    let mut args: Vec<String> = vec!["-y".into(), "-v".into(), "error".into(), "-progress".into(), "pipe:1".into(), "-nostats".into()];
    if is_vaapi {
      args.extend(["-vaapi_device".into(), "/dev/dri/renderD128".into()]);
    }
    args.extend(input_args.clone());
    args.extend(["-filter_complex".into(), parts.join(";"), "-map".into(), v_map.into(), "-map".into(), "[aout]".into(), "-t".into(), format!("{:.4}", total)]);

    let mut v_br: Vec<String> = Vec::new();
    if let Some(mbps) = settings["videoBitrateMbps"].as_f64() {
      if mbps > 0.0 {
        v_br.extend([
          "-b:v".into(), format!("{}M", mbps as u32),
          "-maxrate".into(), format!("{}M", (mbps * 1.35).round() as u32),
          "-bufsize".into(), format!("{}M", (mbps * 2.0).round() as u32),
        ]);
      }
    }
    let a_br = format!("{}k", settings["audioBitrateKbps"].as_u64().unwrap_or(192));
    let cpu_threads = std::thread::available_parallelism().map(|n| n.get().saturating_sub(2).max(2)).unwrap_or(2).to_string();

    let want_hevc = want_hevc_codec || enc == "libx265" || enc == "hevc_nvenc";
    match enc {
      "hevc_nvenc" => args.extend(["-c:v".into(), "hevc_nvenc".into(), "-preset".into(), "p4".into(), "-cq".into(), crf.into()]),
      "libx265" => args.extend(["-c:v".into(), "libx265".into(), "-preset".into(), preset.into(), "-crf".into(), crf.into(), "-threads".into(), cpu_threads]),
      "h264_nvenc" if want_hevc => args.extend(["-c:v".into(), "hevc_nvenc".into(), "-preset".into(), "p4".into(), "-cq".into(), crf.into()]),
      "h264_nvenc" => args.extend(["-c:v".into(), "h264_nvenc".into(), "-preset".into(), "p4".into(), "-cq".into(), crf.into()]),
      "h264_vaapi" => args.extend(["-c:v".into(), "h264_vaapi".into(), "-qp".into(), crf.into()]),
      "h264_qsv" => args.extend(["-c:v".into(), "h264_qsv".into(), "-global_quality".into(), crf.into()]),
      "h264_amf" => args.extend(["-c:v".into(), "h264_amf".into(), "-quality".into(), "balanced".into(), "-qp_i".into(), crf.into(), "-qp_p".into(), crf.into()]),
      _ if want_hevc => args.extend(["-c:v".into(), "libx265".into(), "-preset".into(), preset.into(), "-crf".into(), crf.into(), "-threads".into(), cpu_threads]),
      _ => args.extend(["-c:v".into(), "libx264".into(), "-preset".into(), preset.into(), "-crf".into(), crf.into(), "-threads".into(), cpu_threads]),
    }
    args.extend(v_br);
    if !is_vaapi {
      args.extend(["-pix_fmt".into(), "yuv420p".into()]);
    }
    args.extend(["-c:a".into(), "aac".into(), "-b:a".into(), a_br, "-ar".into(), "48000".into(), "-movflags".into(), "+faststart".into(), "-f".into(), if ext == "mov" { "mov".into() } else { "mp4".into() }, temp_out.clone()]);

    let mut child = Command::new(&bin)
      .args(&args)
      .current_dir(&temp_dir)
      .stdout(Stdio::piped())
      .stderr(Stdio::piped())
      .spawn()
      .map_err(|e| format!("FFmpeg başlatılamadı: {}", e))?;

    *state.active_export_pid.lock().unwrap() = Some(child.id());

    if let Some(stdout) = child.stdout.take() {
      let reader = BufReader::new(stdout);
      let mut last_emit = Instant::now();
      let mut last_pct: i32 = -1;
      for line in reader.lines().map_while(Result::ok) {
        if let Some(us_str) = line.strip_prefix("out_time_us=").or_else(|| line.strip_prefix("out_time_ms=")) {
          if let Ok(us) = us_str.trim().parse::<f64>() {
            let pct = (((us / 1_000_000.0) / total) * 100.0).round().clamp(0.0, 99.0) as i32;
            if pct != last_pct && last_emit.elapsed().as_millis() >= 140 {
              last_pct = pct;
              last_emit = Instant::now();
              let _ = app.emit("export:progress", pct);
            }
          }
        }
      }
    }

    let out = child.wait_with_output().map_err(|e| e.to_string())?;
    *state.active_export_pid.lock().unwrap() = None;

    if out.status.success() && Path::new(&temp_out).exists() {
      Ok(())
    } else {
      let _ = fs::remove_file(&temp_out);
      let err_msg = String::from_utf8_lossy(&out.stderr).trim().to_string();
      Err(if err_msg.is_empty() { format!("FFmpeg çıkış kodu: {:?}", out.status.code()) } else { err_msg })
    }
  };

  let _ = app.emit("export:progress", 0);
  let mut result = run_pass(&hw_encoder);
  if result.is_err() && hw_encoder != "libx264" {
    result = run_pass("libx264");
  }

  let final_res = match result {
    Ok(_) => {
      if fs::rename(&temp_out, &out_path).is_err() {
        let _ = fs::copy(&temp_out, &out_path);
        let _ = fs::remove_file(&temp_out);
      }
      let _ = app.emit("export:progress", 100);
      ExportResult {
        ok: true,
        canceled: None,
        path: Some(out_path),
        error: None,
      }
    }
    Err(err) => {
      let _ = fs::remove_file(&temp_out);
      ExportResult {
        ok: false,
        canceled: None,
        path: None,
        error: Some(err),
      }
    }
  };

  let _ = fs::remove_dir_all(&temp_dir);
  final_res
}
