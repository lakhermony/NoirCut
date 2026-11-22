// Prevents additional console window on Windows in release
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod export;
mod foley;
mod lut_bake;

use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use rayon::prelude::*;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha1::{Digest, Sha1};
use std::collections::{HashMap, HashSet};
use std::fs::{self, File};
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::{Arc, Mutex};
use tauri::{
  http::{header, Response, StatusCode},
  AppHandle, Emitter, State,
};

#[derive(Clone, Serialize, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct EngineInfo {
  pub ffmpeg_path: String,
  pub ffprobe_path: String,
  pub source: String,
  pub version: Option<String>,
  pub platform: String,
  pub available_encoders: Vec<String>,
  pub gpu_ffmpeg_path: Option<String>,
}

#[derive(Clone, Serialize, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct MediaItem {
  pub id: String,
  pub path: String,
  pub name: String,
  pub media_kind: String,
  pub duration: f64,
  pub width: u32,
  pub height: u32,
  pub codec: String,
  pub fps: f64,
  pub has_audio: bool,
  pub audio_codec: Option<String>,
  pub thumbnail: Option<String>,
  pub url: String,
  pub needs_proxy: bool,
  pub proxy_state: String,
  pub proxy_progress: f64,
  pub proxy_url: Option<String>,
}

#[derive(Clone, Serialize, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ProxyUpdate {
  pub id: String,
  pub state: String,
  pub progress: f64,
  pub proxy_url: Option<String>,
  pub error: Option<String>,
}

#[derive(Clone, Serialize, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ProxyConfig {
  pub resolution_scale: String,
  pub playback_mode: String,
  pub proxy_dir: String,
}

#[derive(Clone, Serialize, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct PeaksPayload {
  pub peaks: Vec<u8>,
  pub per_second: u32,
}

#[derive(Clone, Serialize, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ImportResult {
  pub items: Vec<MediaItem>,
  pub errors: Vec<String>,
  pub canceled: bool,
}

#[derive(Clone, Serialize, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ExportResult {
  pub ok: bool,
  pub canceled: Option<bool>,
  pub path: Option<String>,
  pub error: Option<String>,
}

pub struct AppState {
  pub engine: Mutex<Option<EngineInfo>>,
  pub approved_paths: Mutex<HashSet<String>>,
  pub media_registry: Mutex<HashMap<String, MediaItem>>,
  pub peaks_cache: Mutex<HashMap<String, PeaksPayload>>,
  pub proxy_config: Mutex<ProxyConfig>,
  pub active_export_pid: Mutex<Option<u32>>,
}

impl AppState {
  pub fn new() -> Self {
    let default_proxy_dir = std::env::temp_dir()
      .join("noircut-proxies")
      .to_string_lossy()
      .to_string();
    let _ = fs::create_dir_all(&default_proxy_dir);
    Self {
      engine: Mutex::new(None),
      approved_paths: Mutex::new(HashSet::new()),
      media_registry: Mutex::new(HashMap::new()),
      peaks_cache: Mutex::new(HashMap::new()),
      proxy_config: Mutex::new(ProxyConfig {
        resolution_scale: "1/2".to_string(),
        playback_mode: "auto".to_string(),
        proxy_dir: default_proxy_dir,
      }),
      active_export_pid: Mutex::new(None),
    }
  }
}

fn media_url(file_path: &str) -> String {
  format!("noircut-media://localhost/{}", urlencoding::encode(file_path))
}

fn mime_for_path(path: &str) -> &'static str {
  let ext = Path::new(path)
    .extension()
    .and_then(|e| e.to_str())
    .unwrap_or("")
    .to_ascii_lowercase();
  match ext.as_str() {
    "mp4" | "m4v" => "video/mp4",
    "mov" => "video/quicktime",
    "mkv" => "video/x-matroska",
    "webm" => "video/webm",
    "mp3" => "audio/mpeg",
    "wav" => "audio/wav",
    "aac" => "audio/aac",
    "flac" => "audio/flac",
    "ogg" => "audio/ogg",
    "m4a" => "audio/mp4",
    "png" => "image/png",
    "jpg" | "jpeg" => "image/jpeg",
    "webp" => "image/webp",
    _ => "application/octet-stream",
  }
}

fn detect_engine() -> EngineInfo {
  let cwd = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
  let embedded_ffmpeg = cwd.join("node_modules/ffmpeg-static/ffmpeg");
  let embedded_ffprobe = cwd
    .join("node_modules/ffprobe-static/bin/linux/x64/ffprobe");

  let (ffmpeg_path, ffprobe_path, mut source) = if embedded_ffmpeg.exists() {
    (
      embedded_ffmpeg.to_string_lossy().to_string(),
      if embedded_ffprobe.exists() {
        embedded_ffprobe.to_string_lossy().to_string()
      } else {
        "ffprobe".to_string()
      },
      "embedded".to_string(),
    )
  } else {
    ("ffmpeg".to_string(), "ffprobe".to_string(), "system".to_string())
  };

  let ver_out = Command::new(&ffmpeg_path).arg("-version").output().ok();
  let version = ver_out.and_then(|o| {
    let s = String::from_utf8_lossy(&o.stdout);
    s.lines().next().and_then(|line| {
      line
        .split_whitespace()
        .skip_while(|&w| w != "version")
        .nth(1)
        .map(|v| v.to_string())
    })
  });
  if version.is_none() {
    source = "missing".to_string();
  }

  let mut available_encoders = vec!["libx264".to_string()];
  if let Ok(enc_out) = Command::new(&ffmpeg_path)
    .args(["-hide_banner", "-encoders"])
    .output()
  {
    let text = String::from_utf8_lossy(&enc_out.stdout);
    if text.contains("libx265") {
      available_encoders.push("libx265".to_string());
    }
  }

  let mut gpu_ffmpeg_path: Option<String> = None;
  let candidate_bins = if source == "embedded" {
    vec![ffmpeg_path.clone(), "ffmpeg".to_string()]
  } else {
    vec![ffmpeg_path.clone()]
  };

  let hw_candidates = ["h264_nvenc", "hevc_nvenc", "h264_vaapi", "h264_qsv", "h264_amf"];
  for bin in candidate_bins {
    let Ok(out) = Command::new(&bin).args(["-hide_banner", "-encoders"]).output() else {
      continue;
    };
    let enc_text = String::from_utf8_lossy(&out.stdout);
    for &hw in &hw_candidates {
      if available_encoders.contains(&hw.to_string()) || !enc_text.contains(hw) {
        continue;
      }
      let test_ok = if hw == "h264_vaapi" {
        Command::new(&bin)
          .args([
            "-v",
            "error",
            "-vaapi_device",
            "/dev/dri/renderD128",
            "-f",
            "lavfi",
            "-i",
            "color=c=black:s=64x64:d=0.04",
            "-vf",
            "format=nv12,hwupload",
            "-frames:v",
            "1",
            "-c:v",
            hw,
            "-f",
            "null",
            "-",
          ])
          .status()
          .map(|st| st.success())
          .unwrap_or(false)
      } else {
        Command::new(&bin)
          .args([
            "-v",
            "error",
            "-f",
            "lavfi",
            "-i",
            "color=c=black:s=64x64:d=0.04",
            "-frames:v",
            "1",
            "-c:v",
            hw,
            "-f",
            "null",
            "-",
          ])
          .status()
          .map(|st| st.success())
          .unwrap_or(false)
      };
      if test_ok {
        available_encoders.push(hw.to_string());
        if bin != ffmpeg_path && gpu_ffmpeg_path.is_none() {
          gpu_ffmpeg_path = Some(bin.clone());
        }
      }
    }
  }

  let platform = if cfg!(target_os = "linux") {
    "linux"
  } else if cfg!(target_os = "windows") {
    "win32"
  } else {
    "darwin"
  }
  .to_string();

  EngineInfo {
    ffmpeg_path,
    ffprobe_path,
    source,
    version,
    platform,
    available_encoders,
    gpu_ffmpeg_path,
  }
}

fn get_or_init_engine(state: &AppState) -> EngineInfo {
  let mut guard = state.engine.lock().unwrap();
  if let Some(ref info) = *guard {
    return info.clone();
  }
  let info = detect_engine();
  *guard = Some(info.clone());
  info
}

fn parse_fps(rate: &str) -> f64 {
  let parts: Vec<&str> = rate.split('/').collect();
  if parts.len() == 2 {
    let n: f64 = parts[0].parse().unwrap_or(0.0);
    let d: f64 = parts[1].parse().unwrap_or(0.0);
    if d > 0.0 {
      return n / d;
    }
  }
  rate.parse().unwrap_or(0.0)
}

/// Fast Input-Seek (-ss before -i) + In-Memory Pipe Thumbnail Generator in Rust
fn make_thumbnail_fast(ffmpeg_bin: &str, file_path: &str, at_sec: f64, is_image: bool) -> Option<String> {
  let mut cmd = Command::new(ffmpeg_bin);
  cmd.arg("-v").arg("error");
  if !is_image && at_sec > 0.05 {
    cmd.arg("-ss").arg(format!("{:.2}", at_sec));
  }
  let out = cmd
    .args([
      "-i",
      file_path,
      "-frames:v",
      "1",
      "-vf",
      "scale=320:-2",
      "-q:v",
      "5",
      "-f",
      "image2pipe",
      "-vcodec",
      "mjpeg",
      "pipe:1",
    ])
    .output()
    .ok()?;
  if !out.status.success() || out.stdout.is_empty() {
    return None;
  }
  Some(format!("data:image/jpeg;base64,{}", BASE64.encode(&out.stdout)))
}

/// Rayon Multi-Core Parallel PCM Peak Extractor
fn extract_peaks_rayon(ffmpeg_bin: &str, file_path: &str, duration: f64, per_second: u32) -> PeaksPayload {
  let sample_rate: u32 = 4000;
  let samples_per_bucket = (sample_rate / per_second.max(1)).max(1) as usize;
  let total_buckets = ((duration * per_second as f64).ceil() as usize).max(1);

  let out = Command::new(ffmpeg_bin)
    .args([
      "-v",
      "error",
      "-threads",
      "2",
      "-i",
      file_path,
      "-vn",
      "-ac",
      "1",
      "-ar",
      &sample_rate.to_string(),
      "-f",
      "s16le",
      "pipe:1",
    ])
    .output();

  let Ok(output) = out else {
    return PeaksPayload {
      peaks: vec![0; total_buckets],
      per_second,
    };
  };

  let raw = output.stdout;
  let chunk_bytes = samples_per_bucket * 2;
  let mut computed: Vec<u8> = raw
    .par_chunks(chunk_bytes)
    .map(|chunk| {
      let mut max_val: i32 = 0;
      for pair in chunk.chunks_exact(2) {
        let sample = i16::from_le_bytes([pair[0], pair[1]]) as i32;
        let abs = sample.abs();
        if abs > max_val {
          max_val = abs;
        }
      }
      ((max_val as f64 / 32768.0) * 255.0).round().clamp(0.0, 255.0) as u8
    })
    .collect();

  computed.resize(total_buckets, 0);
  PeaksPayload {
    peaks: computed,
    per_second,
  }
}

fn spawn_background_proxy(app: AppHandle, state_arc: Arc<AppState>, item: MediaItem, scale: String) {
  std::thread::spawn(move || {
    let engine = get_or_init_engine(&state_arc);
    let proxy_dir = {
      let cfg = state_arc.proxy_config.lock().unwrap();
      cfg.proxy_dir.clone()
    };
    let _ = fs::create_dir_all(&proxy_dir);

    let scale_tag = match scale.as_str() {
      "1/8" => "s8",
      "1/4" => "s4",
      _ => "s2",
    };
    let out_path = Path::new(&proxy_dir)
      .join(format!("{}-smartproxy-{}.mp4", item.id, scale_tag))
      .to_string_lossy()
      .to_string();

    let src_w = if item.width > 0 { item.width } else { 1920 };
    let max_safe_w = ((src_w / 2) * 2).max(2);
    let divisor = match scale.as_str() {
      "1/8" => 8,
      "1/4" => 4,
      _ => 2,
    };
    let scaled_w = src_w / divisor;
    let clamped_w = scaled_w.max(max_safe_w.min(160)).min(max_safe_w);
    let target_w = ((clamped_w / 2) * 2).max(2);

    let has_vaapi = engine.available_encoders.contains(&"h264_vaapi".to_string());
    let bin = if has_vaapi {
      engine.gpu_ffmpeg_path.clone().unwrap_or(engine.ffmpeg_path.clone())
    } else {
      engine.ffmpeg_path.clone()
    };

    let mut args: Vec<String> = vec![
      "-y".into(),
      "-v".into(),
      "error".into(),
    ];
    if has_vaapi {
      args.extend(["-vaapi_device".into(), "/dev/dri/renderD128".into()]);
    } else {
      args.extend(["-threads".into(), "2".into()]);
    }
    args.extend(["-i".into(), item.path.clone()]);
    if has_vaapi {
      args.extend([
        "-vf".into(),
        format!("scale={}:-2,format=nv12,hwupload", target_w),
        "-c:v".into(),
        "h264_vaapi".into(),
        "-qp".into(),
        "24".into(),
        "-g".into(),
        "1".into(),
      ]);
    } else {
      args.extend([
        "-vf".into(),
        format!("scale={}:-2,format=yuv420p", target_w),
        "-c:v".into(),
        "libx264".into(),
        "-preset".into(),
        "ultrafast".into(),
        "-tune".into(),
        "fastdecode".into(),
        "-crf".into(),
        "24".into(),
        "-g".into(),
        "1".into(),
        "-pix_fmt".into(),
        "yuv420p".into(),
        "-threads".into(),
        "2".into(),
      ]);
    }
    if item.has_audio {
      args.extend([
        "-c:a".into(),
        "aac".into(),
        "-b:a".into(),
        "128k".into(),
        "-ac".into(),
        "2".into(),
        "-ar".into(),
        "48000".into(),
      ]);
    } else {
      args.push("-an".into());
    }
    args.extend(["-movflags".into(), "+faststart".into(), out_path.clone()]);

    let status = Command::new(&bin).args(&args).status();
    if status.map(|s| s.success()).unwrap_or(false) && Path::new(&out_path).exists() {
      state_arc.approved_paths.lock().unwrap().insert(out_path.clone());
      let p_url = media_url(&out_path);
      if let Some(m) = state_arc.media_registry.lock().unwrap().get_mut(&item.id) {
        m.proxy_state = "ready".to_string();
        m.proxy_progress = 1.0;
        m.proxy_url = Some(p_url.clone());
      }
      let _ = app.emit(
        "media:proxy-update",
        ProxyUpdate {
          id: item.id,
          state: "ready".to_string(),
          progress: 1.0,
          proxy_url: Some(p_url),
          error: None,
        },
      );
    }
  });
}

fn build_media_item(
  app: &AppHandle,
  state_arc: &Arc<AppState>,
  raw_path: &str,
) -> Result<MediaItem, String> {
  let canonical = fs::canonicalize(raw_path)
    .unwrap_or_else(|_| PathBuf::from(raw_path))
    .to_string_lossy()
    .to_string();
  let engine = get_or_init_engine(state_arc);

  let out = Command::new(&engine.ffprobe_path)
    .args([
      "-v",
      "quiet",
      "-print_format",
      "json",
      "-show_format",
      "-show_streams",
      &canonical,
    ])
    .output()
    .map_err(|e| format!("ffprobe çalıştırılamadı: {}", e))?;

  let info: Value = serde_json::from_slice(&out.stdout)
    .map_err(|e| format!("ffprobe JSON okunamadı: {}", e))?;

  let streams = info["streams"].as_array().cloned().unwrap_or_default();
  let video_stream = streams.iter().find(|s| s["codec_type"] == "video");
  let audio_stream = streams.iter().find(|s| s["codec_type"] == "audio");

  let ext = Path::new(&canonical)
    .extension()
    .and_then(|e| e.to_str())
    .unwrap_or("")
    .to_ascii_lowercase();
  let is_image = matches!(ext.as_str(), "png" | "jpg" | "jpeg" | "webp");

  let media_kind = if is_image {
    "image"
  } else if video_stream.is_some() {
    "video"
  } else if audio_stream.is_some() {
    "audio"
  } else {
    return Err("Dosyada video veya ses akışı bulunamadı".to_string());
  };

  let duration = if is_image {
    5.0
  } else {
    info["format"]["duration"]
      .as_str()
      .and_then(|s| s.parse::<f64>().ok())
      .or_else(|| {
        video_stream
          .and_then(|v| v["duration"].as_str())
          .and_then(|s| s.parse::<f64>().ok())
      })
      .unwrap_or(5.0)
  };

  let width = video_stream
    .and_then(|v| v["width"].as_u64())
    .unwrap_or(0) as u32;
  let height = video_stream
    .and_then(|v| v["height"].as_u64())
    .unwrap_or(0) as u32;
  let codec = video_stream
    .and_then(|v| v["codec_name"].as_str())
    .unwrap_or("none")
    .to_string();
  let fps = video_stream
    .and_then(|v| v["avg_frame_rate"].as_str())
    .map(parse_fps)
    .filter(|&f| f > 0.0)
    .unwrap_or(25.0);
  let has_audio = audio_stream.is_some();
  let audio_codec = audio_stream
    .and_then(|a| a["codec_name"].as_str())
    .map(|s| s.to_string());

  state_arc
    .approved_paths
    .lock()
    .unwrap()
    .insert(canonical.clone());

  let thumbnail = if media_kind == "audio" {
    None
  } else {
    make_thumbnail_fast(
      &engine.ffmpeg_path,
      &canonical,
      if is_image { 0.0 } else { (duration * 0.1).min(1.0) },
      is_image,
    )
  };

  let mut hasher = Sha1::new();
  hasher.update(canonical.as_bytes());
  let id = format!("{:x}", hasher.finalize())[..12].to_string();

  let needs_proxy = media_kind == "video"
    && (width > 1920 || height > 1088 || ext == "mov" || codec != "h264");

  let (scale, proxy_dir) = {
    let cfg = state_arc.proxy_config.lock().unwrap();
    (cfg.resolution_scale.clone(), cfg.proxy_dir.clone())
  };
  let scale_tag = match scale.as_str() {
    "1/8" => "s8",
    "1/4" => "s4",
    _ => "s2",
  };
  let cached_proxy = Path::new(&proxy_dir)
    .join(format!("{}-smartproxy-{}.mp4", id, scale_tag))
    .to_string_lossy()
    .to_string();
  let has_cached = needs_proxy && Path::new(&cached_proxy).exists();
  if has_cached {
    state_arc
      .approved_paths
      .lock()
      .unwrap()
      .insert(cached_proxy.clone());
  }

  let name = Path::new(&canonical)
    .file_name()
    .and_then(|n| n.to_str())
    .unwrap_or("Media")
    .to_string();

  let item = MediaItem {
    id: id.clone(),
    path: canonical.clone(),
    name,
    media_kind: media_kind.to_string(),
    duration,
    width,
    height,
    codec,
    fps,
    has_audio,
    audio_codec,
    thumbnail,
    url: media_url(&canonical),
    needs_proxy,
    proxy_state: if has_cached {
      "ready".into()
    } else if needs_proxy {
      "building".into()
    } else {
      "none".into()
    },
    proxy_progress: if has_cached { 1.0 } else { 0.0 },
    proxy_url: if has_cached {
      Some(media_url(&cached_proxy))
    } else {
      None
    },
  };

  state_arc
    .media_registry
    .lock()
    .unwrap()
    .insert(id.clone(), item.clone());

  if needs_proxy && !has_cached {
    spawn_background_proxy(app.clone(), state_arc.clone(), item.clone(), scale);
  }

  Ok(item)
}

#[tauri::command]
fn app_version() -> String {
  "1.0.5".to_string()
}

#[tauri::command]
fn engine_info(state: State<'_, Arc<AppState>>) -> EngineInfo {
  get_or_init_engine(&state)
}

#[tauri::command]
fn media_import(app: AppHandle, state: State<'_, Arc<AppState>>) -> ImportResult {
  let files = rfd::FileDialog::new()
    .set_title("Medya Seç (Video, Ses veya Görsel)")
    .add_filter(
      "Tüm Desteklenen Medya",
      &[
        "mp4", "mov", "mkv", "webm", "mp3", "wav", "aac", "flac", "ogg", "m4a", "png", "jpg",
        "jpeg", "webp",
      ],
    )
    .pick_files();

  let Some(paths) = files else {
    return ImportResult {
      items: vec![],
      errors: vec![],
      canceled: true,
    };
  };

  let mut items = Vec::new();
  let mut errors = Vec::new();
  for p in paths {
    let p_str = p.to_string_lossy().to_string();
    match build_media_item(&app, &state, &p_str) {
      Ok(item) => items.push(item),
      Err(e) => errors.push(format!("{}: {}", p_str, e)),
    }
  }
  ImportResult {
    items,
    errors,
    canceled: false,
  }
}

#[tauri::command]
fn media_peaks(state: State<'_, Arc<AppState>>, media_id: String) -> Option<PeaksPayload> {
  if let Some(cached) = state.peaks_cache.lock().unwrap().get(&media_id) {
    return Some(cached.clone());
  }
  let item = state.media_registry.lock().unwrap().get(&media_id)?.clone();
  if !item.has_audio {
    let len = ((item.duration * 50.0).ceil() as usize).max(1);
    return Some(PeaksPayload {
      peaks: vec![0; len],
      per_second: 50,
    });
  }
  let engine = get_or_init_engine(&state);
  let payload = extract_peaks_rayon(&engine.ffmpeg_path, &item.path, item.duration, 50);
  state
    .peaks_cache
    .lock()
    .unwrap()
    .insert(media_id, payload.clone());
  Some(payload)
}

#[tauri::command]
fn proxy_get_config(state: State<'_, Arc<AppState>>) -> ProxyConfig {
  state.proxy_config.lock().unwrap().clone()
}

#[tauri::command]
fn proxy_set_config(state: State<'_, Arc<AppState>>, patch: Value) -> ProxyConfig {
  let mut cfg = state.proxy_config.lock().unwrap();
  if let Some(scale) = patch["resolutionScale"].as_str() {
    cfg.resolution_scale = scale.to_string();
  }
  if let Some(mode) = patch["playbackMode"].as_str() {
    cfg.playback_mode = mode.to_string();
  }
  if let Some(dir) = patch["proxyDir"].as_str() {
    let _ = fs::create_dir_all(dir);
    cfg.proxy_dir = dir.to_string();
  }
  cfg.clone()
}

#[tauri::command]
fn proxy_select_dir(state: State<'_, Arc<AppState>>) -> Option<String> {
  let folder = rfd::FileDialog::new()
    .set_title("Proxy Önbellek Klasörü Seç")
    .pick_folder()?;
  let dir = folder.to_string_lossy().to_string();
  state.proxy_config.lock().unwrap().proxy_dir = dir.clone();
  Some(dir)
}

#[tauri::command]
fn proxy_batch_generate(
  app: AppHandle,
  state: State<'_, Arc<AppState>>,
  media_ids: Option<Vec<String>>,
  scale: Option<String>,
) -> Value {
  let active_scale = {
    let mut cfg = state.proxy_config.lock().unwrap();
    if let Some(ref s) = scale {
      cfg.resolution_scale = s.clone();
    }
    cfg.resolution_scale.clone()
  };

  let targets: Vec<MediaItem> = {
    let reg = state.media_registry.lock().unwrap();
    if let Some(ids) = media_ids {
      ids.iter().filter_map(|id| reg.get(id).cloned()).collect()
    } else {
      reg
        .values()
        .filter(|m| m.media_kind == "video")
        .cloned()
        .collect()
    }
  };

  let mut started = 0;
  for item in targets {
    if item.media_kind == "video" {
      started += 1;
      spawn_background_proxy(app.clone(), (*state).clone(), item, active_scale.clone());
    }
  }
  json!({ "started": started })
}

#[tauri::command]
fn media_reconnect(state: State<'_, Arc<AppState>>, media_id: String) -> Option<MediaItem> {
  let file = rfd::FileDialog::new()
    .set_title("Eksik Medyayı Yeniden Bağla")
    .pick_file()?;
  let new_path = file.to_string_lossy().to_string();
  state
    .approved_paths
    .lock()
    .unwrap()
    .insert(new_path.clone());
  let mut reg = state.media_registry.lock().unwrap();
  let item = reg.get_mut(&media_id)?;
  item.path = new_path.clone();
  item.url = media_url(&new_path);
  Some(item.clone())
}

#[tauri::command]
fn lut_import() -> Value {
  let Some(file) = rfd::FileDialog::new()
    .set_title("3D LUT Dosyası Seç (.cube)")
    .add_filter("3D LUT (.cube)", &["cube"])
    .pick_file()
  else {
    return json!({ "canceled": true });
  };
  match fs::read_to_string(&file) {
    Ok(content) => {
      let name = file
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("Custom LUT")
        .to_string();
      let id = format!("custom-{}", chrono::Utc::now().timestamp_millis());
      json!({ "id": id, "name": name, "content": content })
    }
    Err(e) => json!({ "error": e.to_string() }),
  }
}

#[tauri::command]
fn noirfilm_open_look() -> Value {
  let Some(file) = rfd::FileDialog::new()
    .set_title("Noir Look veya 3D LUT İçe Aktar")
    .add_filter("Noir Look / 3D LUT", &["noirlook", "cube"])
    .pick_file()
  else {
    return json!({ "canceled": true });
  };
  match fs::read_to_string(&file) {
    Ok(content) => {
      let ext = file
        .extension()
        .and_then(|s| s.to_str())
        .unwrap_or("noirlook")
        .to_ascii_lowercase();
      let name = file
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("Look")
        .to_string();
      json!({ "ext": ext, "name": name, "content": content })
    }
    Err(e) => json!({ "error": e.to_string() }),
  }
}

#[tauri::command]
fn file_save_text(
  default_name: String,
  content: String,
  filter_name: String,
  extension: String,
) -> Value {
  let Some(file) = rfd::FileDialog::new()
    .set_title(&format!("{} Dışa Aktar", filter_name))
    .set_file_name(&default_name)
    .add_filter(&filter_name, &[&extension])
    .save_file()
  else {
    return json!({ "ok": false, "canceled": true });
  };
  match fs::write(&file, content) {
    Ok(_) => json!({ "ok": true, "path": file.to_string_lossy().to_string() }),
    Err(e) => json!({ "ok": false, "error": e.to_string() }),
  }
}

#[tauri::command]
fn project_save(project: Value) -> Value {
  let Some(file) = rfd::FileDialog::new()
    .set_title("NoirCut Projesini Kaydet")
    .set_file_name("Proje.noircut")
    .add_filter("NoirCut Projesi (.noircut)", &["noircut"])
    .save_file()
  else {
    return json!({ "ok": false, "canceled": true });
  };
  let data = serde_json::to_string_pretty(&project).unwrap_or_default();
  match fs::write(&file, data) {
    Ok(_) => json!({ "ok": true, "path": file.to_string_lossy().to_string() }),
    Err(e) => json!({ "ok": false, "error": e.to_string() }),
  }
}

fn load_project_from_file(
  app: &AppHandle,
  state: &Arc<AppState>,
  path: &Path,
) -> Value {
  let Ok(raw) = fs::read_to_string(path) else {
    return json!({ "ok": false, "error": "Proje dosyası okunamadı." });
  };
  let Ok(project) = serde_json::from_str::<Value>(&raw) else {
    return json!({ "ok": false, "error": "Geçersiz .noircut JSON formatı." });
  };
  let mut media_items = Vec::new();
  let mut media_errors = Vec::new();
  if let Some(refs) = project["mediaRefs"].as_array() {
    for r in refs {
      if let Some(p) = r["path"].as_str() {
        match build_media_item(app, state, p) {
          Ok(item) => media_items.push(item),
          Err(e) => media_errors.push(format!("{}: {}", p, e)),
        }
      }
    }
  }
  json!({
    "ok": true,
    "project": project,
    "mediaItems": media_items,
    "mediaErrors": media_errors,
    "path": path.to_string_lossy().to_string()
  })
}

#[tauri::command]
fn project_load(app: AppHandle, state: State<'_, Arc<AppState>>) -> Value {
  let Some(file) = rfd::FileDialog::new()
    .set_title("NoirCut Projesi Aç")
    .add_filter("NoirCut Projesi (.noircut)", &["noircut"])
    .pick_file()
  else {
    return json!({ "ok": false, "canceled": true });
  };
  load_project_from_file(&app, &state, &file)
}

#[tauri::command]
fn project_load_path(app: AppHandle, state: State<'_, Arc<AppState>>, file_path: String) -> Value {
  load_project_from_file(&app, &state, Path::new(&file_path))
}

#[tauri::command]
fn export_select_path(format: String, default_name: Option<String>) -> Option<String> {
  let ext = if format == "mov" { "mov" } else { "mp4" };
  let name = default_name.unwrap_or_else(|| format!("NoirCut-Export.{}", ext));
  let file = rfd::FileDialog::new()
    .set_title(&format!("Render Hedefi Seç ({})", ext.to_uppercase()))
    .set_file_name(&name)
    .add_filter(&ext.to_uppercase(), &[ext])
    .save_file()?;
  Some(file.to_string_lossy().to_string())
}

#[tauri::command]
fn shell_reveal(file_path: String) {
  let parent = Path::new(&file_path)
    .parent()
    .unwrap_or_else(|| Path::new(&file_path));
  #[cfg(target_os = "linux")]
  let _ = Command::new("xdg-open").arg(parent).spawn();
  #[cfg(target_os = "windows")]
  let _ = Command::new("explorer").arg("/select,").arg(&file_path).spawn();
}

fn autosave_base_dir() -> PathBuf {
  let base = std::env::temp_dir().join("noircut-autosaves");
  let _ = fs::create_dir_all(base.join("snapshots"));
  base
}

fn atomic_write_json(target: &Path, val: &Value) -> std::io::Result<()> {
  let tmp = target.with_extension(format!("tmp-{}-{}", std::process::id(), chrono::Utc::now().timestamp_millis()));
  fs::write(&tmp, serde_json::to_string(val).unwrap_or_default())?;
  fs::rename(&tmp, target)
}

#[tauri::command]
fn autosave_write(project: Value, label: Option<String>) -> Value {
  let base = autosave_base_dir();
  let snaps_dir = base.join("snapshots");
  let now = chrono::Utc::now();
  let id = format!("snap-{}", now.timestamp_millis());
  let clips = project["clips"].as_array();
  let clip_count = clips.map(|a| a.len()).unwrap_or(0);
  let mut duration = 0.0_f64;
  if let Some(arr) = clips {
    for c in arr {
      let s = c["start"].as_f64().unwrap_or(0.0);
      let d = c["duration"].as_f64().unwrap_or(0.0);
      if s + d > duration {
        duration = s + d;
      }
    }
  }
  let meta = json!({
    "id": id,
    "savedAt": now.to_rfc3339(),
    "clipCount": clip_count,
    "duration": (duration * 100.0).round() / 100.0,
    "label": label.unwrap_or_else(|| "Otomatik Yedek".to_string())
  });
  let payload = json!({ "meta": meta, "project": project });
  let snap_file = snaps_dir.join(format!("{}.json", id));
  if atomic_write_json(&snap_file, &payload).is_err() {
    return json!({ "ok": false });
  }

  let has_markers = project["markers"].as_array().map(|a| !a.is_empty()).unwrap_or(false);
  let session = json!({
    "active": clip_count > 0 || has_markers,
    "updatedAt": now.to_rfc3339(),
    "activeSnapshotId": id
  });
  let _ = atomic_write_json(&base.join("session.json"), &session);

  if let Ok(entries) = fs::read_dir(&snaps_dir) {
    let mut files: Vec<String> = entries
      .filter_map(|e| e.ok())
      .filter_map(|e| e.file_name().into_string().ok())
      .filter(|n| n.ends_with(".json"))
      .collect();
    files.sort();
    files.reverse();
    for old in files.into_iter().skip(10) {
      let _ = fs::remove_file(snaps_dir.join(old));
    }
  }
  json!({ "ok": true })
}

#[tauri::command]
fn autosave_status() -> Value {
  let base = autosave_base_dir();
  let snaps_dir = base.join("snapshots");
  let session_active = fs::read_to_string(base.join("session.json"))
    .ok()
    .and_then(|s| serde_json::from_str::<Value>(&s).ok())
    .and_then(|v| v["active"].as_bool())
    .unwrap_or(false);

  let mut entries: Vec<Value> = Vec::new();
  if let Ok(rd) = fs::read_dir(&snaps_dir) {
    for e in rd.flatten() {
      if let Ok(raw) = fs::read_to_string(e.path()) {
        if let Ok(parsed) = serde_json::from_str::<Value>(&raw) {
          if parsed["meta"]["id"].is_string() {
            entries.push(parsed["meta"].clone());
          }
        }
      }
    }
  }
  entries.sort_by(|a, b| {
    let sa = a["savedAt"].as_str().unwrap_or("");
    let sb = b["savedAt"].as_str().unwrap_or("");
    sb.cmp(sa)
  });
  let latest = entries.first().cloned().unwrap_or(Value::Null);
  let has_unclean = session_active && latest["clipCount"].as_u64().unwrap_or(0) > 0;
  json!({
    "hasUncleanExit": has_unclean,
    "latest": latest,
    "snapshots": entries
  })
}

#[tauri::command]
fn autosave_restore(app: AppHandle, state: State<'_, Arc<AppState>>, snapshot_id: String) -> Value {
  let safe_id: String = snapshot_id
    .chars()
    .filter(|c| c.is_ascii_alphanumeric() || *c == '_' || *c == '-')
    .collect();
  if safe_id.is_empty() {
    return json!({ "ok": false, "error": "Geçersiz yedek kimliği." });
  }
  let target = autosave_base_dir().join("snapshots").join(format!("{}.json", safe_id));
  let Ok(raw) = fs::read_to_string(&target) else {
    return json!({ "ok": false, "error": "Otomatik yedek bulunamadı." });
  };
  let Ok(parsed) = serde_json::from_str::<Value>(&raw) else {
    return json!({ "ok": false, "error": "Otomatik yedek dosyası bozuk." });
  };
  let project = &parsed["project"];
  let mut media_items = Vec::new();
  let mut media_errors = Vec::new();
  if let Some(refs) = project["mediaRefs"].as_array() {
    for r in refs {
      if let Some(p) = r["path"].as_str() {
        match build_media_item(&app, &state, p) {
          Ok(item) => media_items.push(item),
          Err(e) => media_errors.push(format!("{}: {}", p, e)),
        }
      }
    }
  }
  autosave_dismiss();
  json!({
    "ok": true,
    "project": project,
    "mediaItems": media_items,
    "mediaErrors": media_errors
  })
}

#[tauri::command]
fn autosave_dismiss() {
  let base = autosave_base_dir();
  let session = json!({
    "active": false,
    "updatedAt": chrono::Utc::now().to_rfc3339(),
    "activeSnapshotId": Value::Null
  });
  let _ = atomic_write_json(&base.join("session.json"), &session);
}

#[tauri::command]
fn soundscape_generate(state: State<'_, Arc<AppState>>, preset_id: String) -> Option<MediaItem> {
  let (label, dur, wav, peaks) = foley::synthesize_soundscape(&preset_id);
  let sfx_dir = std::env::temp_dir().join("noircut-soundscape");
  let _ = fs::create_dir_all(&sfx_dir);
  let id = format!("sfx-{}", preset_id);
  let out_path = sfx_dir.join(format!("{}.wav", id)).to_string_lossy().to_string();
  if !Path::new(&out_path).exists() {
    let _ = fs::write(&out_path, &wav);
  }
  state.approved_paths.lock().unwrap().insert(out_path.clone());

  let item = MediaItem {
    id: id.clone(),
    path: out_path.clone(),
    name: format!("SFX · {}", label),
    media_kind: "audio".into(),
    duration: dur,
    width: 0,
    height: 0,
    codec: "none".into(),
    fps: 24.0,
    has_audio: true,
    audio_codec: Some("pcm_s16le".into()),
    thumbnail: None,
    url: media_url(&out_path),
    needs_proxy: false,
    proxy_state: "none".into(),
    proxy_progress: 1.0,
    proxy_url: None,
  };
  state.media_registry.lock().unwrap().insert(id.clone(), item.clone());
  state.peaks_cache.lock().unwrap().insert(id, PeaksPayload { peaks, per_second: 50 });
  Some(item)
}

#[tauri::command]
fn export_cancel(state: State<'_, Arc<AppState>>) {
  if let Some(pid) = *state.active_export_pid.lock().unwrap() {
    #[cfg(unix)]
    unsafe {
      libc::kill(pid as i32, libc::SIGTERM);
    }
  }
}

#[tauri::command]
fn export_pause(state: State<'_, Arc<AppState>>) -> bool {
  if let Some(pid) = *state.active_export_pid.lock().unwrap() {
    #[cfg(unix)]
    unsafe {
      return libc::kill(pid as i32, libc::SIGSTOP) == 0;
    }
  }
  false
}

#[tauri::command]
fn export_resume(state: State<'_, Arc<AppState>>) -> bool {
  if let Some(pid) = *state.active_export_pid.lock().unwrap() {
    #[cfg(unix)]
    unsafe {
      return libc::kill(pid as i32, libc::SIGCONT) == 0;
    }
  }
  false
}

#[tauri::command]
fn export_run(app: AppHandle, state: State<'_, Arc<AppState>>, req: Value) -> ExportResult {
  let engine = get_or_init_engine(&state);
  export::run_full_export(&app, &state, &engine, &req)
}

fn main() {
  let app_state = Arc::new(AppState::new());
  let protocol_state = app_state.clone();

  tauri::Builder::default()
    .manage(app_state)
    .register_uri_scheme_protocol("noircut-media", move |_ctx, request| {
      let uri = request.uri().to_string();
      let raw_path = uri
        .strip_prefix("noircut-media://localhost/")
        .or_else(|| uri.strip_prefix("noircut-media://local/"))
        .unwrap_or("");
      let decoded = urlencoding::decode(raw_path)
        .map(|s| s.into_owned())
        .unwrap_or_default();

      if !protocol_state.approved_paths.lock().unwrap().contains(&decoded) {
        return Response::builder()
          .status(StatusCode::FORBIDDEN)
          .body(Vec::new())
          .unwrap();
      }

      let Ok(mut file) = File::open(&decoded) else {
        return Response::builder()
          .status(StatusCode::NOT_FOUND)
          .body(Vec::new())
          .unwrap();
      };
      let file_size = file.metadata().map(|m| m.len()).unwrap_or(0);
      let mime = mime_for_path(&decoded);

      if let Some(range_val) = request.headers().get(header::RANGE) {
        if let Ok(range_str) = range_val.to_str() {
          if let Some(bytes_part) = range_str.strip_prefix("bytes=") {
            let parts: Vec<&str> = bytes_part.split('-').collect();
            let start: u64 = parts.first().and_then(|s| s.parse().ok()).unwrap_or(0);
            let mut end: u64 = parts
              .get(1)
              .and_then(|s| s.parse().ok())
              .unwrap_or(file_size.saturating_sub(1));
            if end >= file_size {
              end = file_size.saturating_sub(1);
            }
            if start <= end && file_size > 0 {
              let chunk_len = (end - start + 1) as usize;
              let mut buf = vec![0u8; chunk_len];
              let _ = file.seek(SeekFrom::Start(start));
              let _ = file.read_exact(&mut buf);
              return Response::builder()
                .status(StatusCode::PARTIAL_CONTENT)
                .header(header::CONTENT_TYPE, mime)
                .header(header::ACCEPT_RANGES, "bytes")
                .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
                .header(
                  header::CONTENT_RANGE,
                  format!("bytes {}-{}/{}", start, end, file_size),
                )
                .header(header::CONTENT_LENGTH, chunk_len.to_string())
                .body(buf)
                .unwrap();
            }
          }
        }
      }

      let mut buf = Vec::with_capacity(file_size as usize);
      let _ = file.read_to_end(&mut buf);
      Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, mime)
        .header(header::ACCEPT_RANGES, "bytes")
        .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
        .header(header::CONTENT_LENGTH, buf.len().to_string())
        .body(buf)
        .unwrap()
    })
    .invoke_handler(tauri::generate_handler![
      app_version,
      engine_info,
      media_import,
      media_peaks,
      proxy_get_config,
      proxy_set_config,
      proxy_select_dir,
      proxy_batch_generate,
      media_reconnect,
      lut_import,
      noirfilm_open_look,
      file_save_text,
      project_save,
      project_load,
      project_load_path,
      export_select_path,
      shell_reveal,
      autosave_write,
      autosave_status,
      autosave_restore,
      autosave_dismiss,
      soundscape_generate,
      export_cancel,
      export_pause,
      export_resume,
      export_run
    ])
    .run(tauri::generate_context!())
    .expect("error while running NoirCut Tauri application");
}
