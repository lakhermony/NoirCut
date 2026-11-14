import { FONT_MAP, type CreditConfig } from '../../../shared/credits'
import type { CreditExportOverlay } from '../../../shared/timeline'

function drawSpacedText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  spacing: number,
  align: 'left' | 'center' | 'right'
): void {
  if (!text) return
  if (spacing <= 0.1) {
    ctx.textAlign = align
    ctx.fillText(text, x, y)
    return
  }
  const chars = Array.from(text)
  const widths = chars.map((ch) => ctx.measureText(ch).width)
  const totalW = widths.reduce((a, b) => a + b, 0) + spacing * Math.max(0, chars.length - 1)

  let cursorX = x
  if (align === 'center') cursorX = x - totalW / 2
  else if (align === 'right') cursorX = x - totalW

  ctx.textAlign = 'left'
  for (let i = 0; i < chars.length; i++) {
    ctx.fillText(chars[i], cursorX, y)
    cursorX += widths[i] + spacing
  }
}

/**
 * Jenerik / metin klibini FFmpeg overlay filtresi için şeffaf PNG'ye dönüştürür.
 */
export function renderCreditToPng(
  credit: CreditConfig,
  targetW = 1280,
  targetH = 720
): CreditExportOverlay {
  const W = targetW
  const H = targetH
  const scale = Math.min(W / 1280, H / 720)
  const scaledFont = Math.round(credit.fontSize * scale)
  const scaledSpacing = credit.letterSpacing * scale
  const fontFamily = FONT_MAP[credit.font]?.css ?? FONT_MAP.sans.css
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')!

  if (credit.templateId === 'rolling-credits') {
    const titleH = credit.title.trim() ? scaledFont + Math.round(48 * scale) : 0
    const rowStep = Math.max(Math.round(44 * scale), Math.round(scaledFont * 1.35))
    const totalH = Math.max(Math.round(360 * scale), titleH + credit.rows.length * rowStep + Math.round(80 * scale))

    canvas.width = W
    canvas.height = totalH
    ctx.clearRect(0, 0, W, totalH)
    ctx.fillStyle = credit.color
    ctx.textBaseline = 'middle'

    let y = Math.round(40 * scale)
    if (credit.title.trim()) {
      ctx.font = `700 ${scaledFont}px ${fontFamily}`
      drawSpacedText(ctx, credit.title.toUpperCase(), W / 2, y + scaledFont / 2, scaledSpacing, 'center')
      y += titleH
    }

    const rowSize = Math.round(scaledFont * 0.72)
    for (const row of credit.rows) {
      ctx.save()
      ctx.globalAlpha = 0.65
      ctx.font = `600 ${rowSize}px ${fontFamily}`
      drawSpacedText(
        ctx,
        row.role.toUpperCase(),
        W / 2 - Math.round(22 * scale),
        y + rowStep / 2,
        Math.max(1, scaledSpacing * 0.7),
        'right'
      )
      ctx.restore()

      ctx.font = `500 ${rowSize}px ${fontFamily}`
      drawSpacedText(
        ctx,
        row.name,
        W / 2 + Math.round(22 * scale),
        y + rowStep / 2,
        Math.max(0.5, scaledSpacing * 0.35),
        'left'
      )
      y += rowStep
    }

    return { pngDataUrl: canvas.toDataURL('image/png'), mode: 'rolling' }
  }

  canvas.width = W
  canvas.height = H
  ctx.clearRect(0, 0, W, H)
  ctx.textBaseline = 'middle'

  if (credit.templateId === 'lower-third') {
    const titleSize = Math.round(scaledFont * 0.78)
    const subSize = Math.max(Math.round(14 * scale), Math.round(scaledFont * 0.45))
    const boxX = Math.round(W * 0.06)
    const boxY = H - Math.round(150 * scale)
    const boxH = credit.subtitle.trim() ? titleSize + subSize + Math.round(36 * scale) : titleSize + Math.round(28 * scale)

    ctx.font = `700 ${titleSize}px ${fontFamily}`
    const titleW = ctx.measureText(credit.title.toUpperCase()).width + credit.title.length * scaledSpacing
    ctx.font = `400 ${subSize}px ${fontFamily}`
    const subW = ctx.measureText(credit.subtitle).width + credit.subtitle.length * scaledSpacing * 0.4
    const boxW = Math.max(Math.round(240 * scale), Math.min(W - boxX * 2, Math.max(titleW, subW) + Math.round(56 * scale)))

    ctx.fillStyle = 'rgba(0, 0, 0, 0.62)'
    ctx.fillRect(boxX, boxY, boxW, boxH)
    ctx.fillStyle = '#F5A623'
    ctx.fillRect(boxX, boxY, Math.max(4, Math.round(5 * scale)), boxH)

    ctx.fillStyle = credit.color
    ctx.font = `700 ${titleSize}px ${fontFamily}`
    drawSpacedText(
      ctx,
      credit.title.toUpperCase(),
      boxX + Math.round(22 * scale),
      boxY + Math.round(20 * scale) + titleSize / 2,
      scaledSpacing,
      'left'
    )
    if (credit.subtitle.trim()) {
      ctx.save()
      ctx.globalAlpha = 0.82
      ctx.font = `400 ${subSize}px ${fontFamily}`
      drawSpacedText(
        ctx,
        credit.subtitle,
        boxX + Math.round(22 * scale),
        boxY + Math.round(28 * scale) + titleSize + subSize / 2,
        Math.max(0.5, scaledSpacing * 0.4),
        'left'
      )
      ctx.restore()
    }
    return { pngDataUrl: canvas.toDataURL('image/png'), mode: 'fade' }
  }

  // noir-opening veya chapter-card
  ctx.fillStyle = credit.color
  ctx.shadowColor = 'rgba(0,0,0,0.85)'
  ctx.shadowBlur = Math.round(24 * scale)
  ctx.font = `700 ${scaledFont}px ${fontFamily}`
  const centerY = credit.subtitle.trim() ? H / 2 - Math.round(22 * scale) : H / 2
  drawSpacedText(ctx, credit.title.toUpperCase(), W / 2, centerY, scaledSpacing, 'center')

  if (credit.templateId === 'chapter-card') {
    ctx.save()
    ctx.globalAlpha = 0.45
    const ruleW = Math.round(140 * scale)
    ctx.fillRect(W / 2 - ruleW / 2, centerY + scaledFont * 0.55 + Math.round(10 * scale), ruleW, Math.max(2, Math.round(2 * scale)))
    ctx.restore()
  }

  if (credit.subtitle.trim()) {
    const subSize =
      credit.templateId === 'chapter-card'
        ? Math.max(Math.round(16 * scale), Math.round(scaledFont * 0.42))
        : Math.max(Math.round(14 * scale), Math.round(scaledFont * 0.3))
    ctx.save()
    ctx.globalAlpha = 0.8
    ctx.font = `${credit.templateId === 'chapter-card' ? 'italic ' : ''}400 ${subSize}px ${fontFamily}`
    const subText =
      credit.templateId === 'chapter-card' ? credit.subtitle : credit.subtitle.toUpperCase()
    drawSpacedText(
      ctx,
      subText,
      W / 2,
      centerY + scaledFont * 0.55 + Math.round((credit.templateId === 'chapter-card' ? 36 : 28) * scale),
      Math.max(1, scaledSpacing * 0.5),
      'center'
    )
    ctx.restore()
  }

  return { pngDataUrl: canvas.toDataURL('image/png'), mode: 'fade' }
}
