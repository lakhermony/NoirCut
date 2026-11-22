use std::f64::consts::PI;

struct LcgRng(u32);

impl LcgRng {
  fn next_bipolar(&mut self) -> f64 {
    self.0 = self.0.wrapping_mul(1664525).wrapping_add(1013904223);
    (self.0 as f64 / u32::MAX as f64) * 2.0 - 1.0
  }
}

fn pack_stereo_wav(mix_l: &[f32], mix_r: &[f32], sample_rate: u32) -> Vec<u8> {
  let total_samples = mix_l.len();
  let data_bytes = (total_samples * 4) as u32;
  let mut buf = Vec::with_capacity(44 + data_bytes as usize);

  buf.extend_from_slice(b"RIFF");
  buf.extend_from_slice(&(36 + data_bytes).to_le_bytes());
  buf.extend_from_slice(b"WAVE");
  buf.extend_from_slice(b"fmt ");
  buf.extend_from_slice(&16u32.to_le_bytes());
  buf.extend_from_slice(&1u16.to_le_bytes()); // PCM
  buf.extend_from_slice(&2u16.to_le_bytes()); // Stereo
  buf.extend_from_slice(&sample_rate.to_le_bytes());
  buf.extend_from_slice(&(sample_rate * 4).to_le_bytes());
  buf.extend_from_slice(&4u16.to_le_bytes());
  buf.extend_from_slice(&16u16.to_le_bytes());
  buf.extend_from_slice(b"data");
  buf.extend_from_slice(&data_bytes.to_le_bytes());

  for i in 0..total_samples {
    let l = ((mix_l[i] as f64).tanh() * 32767.0)
      .round()
      .clamp(-32768.0, 32767.0) as i16;
    let r = ((mix_r[i] as f64).tanh() * 32767.0)
      .round()
      .clamp(-32768.0, 32767.0) as i16;
    buf.extend_from_slice(&l.to_le_bytes());
    buf.extend_from_slice(&r.to_le_bytes());
  }
  buf
}

fn compute_peaks(mix_l: &[f32], mix_r: &[f32], duration: f64, sample_rate: u32, per_sec: u32) -> Vec<u8> {
  let bucket_size = (sample_rate / per_sec.max(1)).max(1) as usize;
  let total_buckets = ((duration * per_sec as f64).ceil() as usize).max(1);
  let mut peaks = vec![0u8; total_buckets];
  for (b_idx, p) in peaks.iter_mut().enumerate() {
    let start = b_idx * bucket_size;
    let end = (start + bucket_size).min(mix_l.len());
    let mut mx = 0.0_f32;
    for i in start..end {
      mx = mx.max(mix_l[i].abs()).max(mix_r[i].abs());
    }
    *p = (mx.min(1.0) * 255.0).round() as u8;
  }
  peaks
}

pub fn synthesize_soundscape(preset_id: &str) -> (&'static str, f64, Vec<u8>, Vec<u8>) {
  let sr: u32 = 48000;
  let (label, dur) = match preset_id {
    "tension-riser" => ("Gerilim Riser", 3.5),
    "sub-drop" => ("Düşük Bas / Sub Drop", 3.0),
    "film-projector" => ("Film Projektörü", 4.0),
    _ => ("Gece Yağmuru", 5.0),
  };

  let n = (dur * sr as f64).ceil() as usize;
  let mut mix_l = vec![0.0_f32; n];
  let mut mix_r = vec![0.0_f32; n];
  let mut rng = LcgRng(9090);

  match preset_id {
    "tension-riser" => {
      let mut lp = 0.0_f64;
      for i in 0..n {
        let t = i as f64 / sr as f64;
        let prog = (t / dur).clamp(0.0, 1.0);
        let freq = 65.0 + 380.0 * prog.powf(2.1);
        let env = prog.powf(1.4) * (1.0 - ((t - (dur - 0.12)).max(0.0) / 0.12).min(1.0));
        lp = lp * 0.85 + rng.next_bipolar() * 0.15;
        let osc = (2.0 * PI * freq * t).sin() * 0.55 + (2.0 * PI * freq * 1.5 * t).sin() * 0.25;
        let s = ((osc + lp * 0.45) * env * 0.72) as f32;
        mix_l[i] = s;
        mix_r[i] = s;
      }
    }
    "sub-drop" => {
      for i in 0..n {
        let t = i as f64 / sr as f64;
        let freq = 110.0 * (-t * 2.2).exp() + 34.0;
        let env = (-t * 1.35).exp() * (t / 0.015).min(1.0);
        let s = ((2.0 * PI * freq * t).sin() * env * 0.85) as f32;
        mix_l[i] = s;
        mix_r[i] = s;
      }
    }
    "film-projector" => {
      let frame_period = sr as f64 / 24.0;
      let mut lp = 0.0_f64;
      for i in 0..n {
        let t = i as f64 / sr as f64;
        let edge = (t / 0.25).min(1.0) * ((dur - t) / 0.25).min(1.0);
        let hum = ((2.0 * PI * 58.0 * t).sin() * 0.55 + (2.0 * PI * 116.0 * t).sin() * 0.25) * 0.22;
        let phase = i as f64 % frame_period;
        let tick_env = if phase < sr as f64 * 0.008 {
          (-(phase / sr as f64) * 420.0).exp()
        } else {
          0.0
        };
        lp = lp * 0.72 + rng.next_bipolar() * 0.28;
        let s = ((hum + lp * tick_env * 0.45) * edge) as f32;
        mix_l[i] = s;
        mix_r[i] = s;
      }
    }
    _ => {
      // night-rain
      let mut lp_l = 0.0_f64;
      let mut lp_r = 0.0_f64;
      for i in 0..n {
        let t = i as f64 / sr as f64;
        let edge = (t / 0.4).min(1.0) * ((dur - t) / 0.4).min(1.0);
        lp_l = lp_l * 0.90 + rng.next_bipolar() * 0.10;
        lp_r = lp_r * 0.89 + rng.next_bipolar() * 0.11;
        let swell = 0.78 + 0.22 * (2.0 * PI * 0.35 * t).sin();
        mix_l[i] = (lp_l * swell * edge * 0.85) as f32;
        mix_r[i] = (lp_r * swell * edge * 0.85) as f32;
      }
    }
  }

  let wav = pack_stereo_wav(&mix_l, &mix_r, sr);
  let peaks = compute_peaks(&mix_l, &mix_r, dur, sr, 50);
  (label, dur, wav, peaks)
}
