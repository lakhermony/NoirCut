/** Saniyeyi SS:KK:SS:KR (kare) zaman koduna çevirir. */
export function fmt(t: number, fps = 25): string {
  const s = Math.floor(t)
  const f = Math.floor((t - s) * fps)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(Math.floor(s / 3600))}:${p(Math.floor(s / 60) % 60)}:${p(s % 60)}:${p(f)}`
}

/** Kartlarda gösterilen süre: 3:07 veya 1:02:33 */
export function fmtDuration(sec: number): string {
  const s = Math.round(sec)
  const h = Math.floor(s / 3600)
  const m = Math.floor(s / 60) % 60
  const ss = String(s % 60).padStart(2, '0')
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`
}
