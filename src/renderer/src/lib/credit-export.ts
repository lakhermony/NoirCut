import {
  formatCreditText,
  resolveCreditFontCss,
  type CreditConfig
} from '../../../shared/credits'
import type { CreditExportOverlay } from '../../../shared/timeline'

function drawSpacedText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  spacing: number,
  align: 'left' | 'center' | 'right',
  neonGlowColor?: string | null,
  neonGlowBlur = 0
): void {
  if (!text) return

  const drawPass = () => {
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

  if (neonGlowColor && neonGlowBlur > 0.5) {
    ctx.save()
    ctx.shadowColor = neonGlowColor
    ctx.shadowBlur = neonGlowBlur
    ctx.shadowOffsetX = 0
    ctx.shadowOffsetY = 0
    drawPass()
    ctx.restore()
  }
  drawPass()
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
  const lineHeightMul = Math.max(0.85, Math.min(2.4, credit.lineHeight ?? 1.25))
  const shadowAmt = Math.max(0, Math.min(100, credit.textShadow ?? 45)) / 100
  const glowHex =
    credit.glowColor && credit.glowColor.toLowerCase() !== '#000000' ? credit.glowColor : null
  const neonBlur = shadowAmt > 0.01 && glowHex ? Math.round((8 + shadowAmt * 30) * scale) : 0
  const applyTextShadow = () => {
    if (shadowAmt <= 0.01) {
      ctx.shadowColor = 'transparent'
      ctx.shadowBlur = 0
      ctx.shadowOffsetY = 0
    } else {
      ctx.shadowColor = `rgba(0,0,0,${(0.35 + shadowAmt * 0.6).toFixed(2)})`
      ctx.shadowBlur = Math.round((6 + shadowAmt * 24) * scale)
      ctx.shadowOffsetY = Math.round((2 + shadowAmt * 4) * scale)
    }
  }
  const fontFamily = resolveCreditFontCss(credit)
  const rawTitle = credit.title
  const rawSubtitle = credit.subtitle
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')!

  if (credit.templateId === 'rolling-credits') {
    const titleStr = formatCreditText(rawTitle, credit.autoAscii, true)
    const titleH = titleStr.trim() ? Math.round(scaledFont * lineHeightMul + 32 * scale) : 0
    const rowStep = Math.max(Math.round(40 * scale), Math.round(scaledFont * 1.08 * lineHeightMul))
    const totalH = Math.max(Math.round(360 * scale), titleH + credit.rows.length * rowStep + Math.round(80 * scale))

    canvas.width = W
    canvas.height = totalH
    ctx.clearRect(0, 0, W, totalH)
    ctx.fillStyle = credit.color
    ctx.textBaseline = 'middle'
    applyTextShadow()

    let y = Math.round(40 * scale)
    if (titleStr.trim()) {
      ctx.font = `700 ${scaledFont}px ${fontFamily}`
      drawSpacedText(ctx, titleStr, W / 2, y + scaledFont / 2, scaledSpacing, 'center', glowHex, neonBlur)
      y += titleH
    }

    const rowSize = Math.round(scaledFont * 0.72)
    for (const row of credit.rows) {
      const roleStr = formatCreditText(row.role, credit.autoAscii, true)
      const nameStr = formatCreditText(row.name, credit.autoAscii)
      ctx.save()
      ctx.globalAlpha = 0.65
      ctx.font = `600 ${rowSize}px ${fontFamily}`
      drawSpacedText(
        ctx,
        roleStr,
        W / 2 - Math.round(22 * scale),
        y + rowStep / 2,
        Math.max(1, scaledSpacing * 0.7),
        'right',
        glowHex,
        neonBlur * 0.65
      )
      ctx.restore()

      ctx.font = `500 ${rowSize}px ${fontFamily}`
      drawSpacedText(
        ctx,
        nameStr,
        W / 2 + Math.round(22 * scale),
        y + rowStep / 2,
        Math.max(0.5, scaledSpacing * 0.35),
        'left',
        glowHex,
        neonBlur * 0.65
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
    const titleStr = formatCreditText(rawTitle, credit.autoAscii, true)
    const subStr = formatCreditText(rawSubtitle, credit.autoAscii)
    const titleSize = Math.round(scaledFont * 0.78)
    const subSize = Math.max(Math.round(14 * scale), Math.round(scaledFont * 0.45))
    const boxX = Math.round(W * 0.06)
    const boxY = H - Math.round(150 * scale)
    const boxH = subStr.trim() ? titleSize + subSize + Math.round(36 * scale) : titleSize + Math.round(28 * scale)

    ctx.font = `700 ${titleSize}px ${fontFamily}`
    const titleW = ctx.measureText(titleStr).width + titleStr.length * scaledSpacing
    ctx.font = `400 ${subSize}px ${fontFamily}`
    const subW = ctx.measureText(subStr).width + subStr.length * scaledSpacing * 0.4
    const boxW = Math.max(Math.round(240 * scale), Math.min(W - boxX * 2, Math.max(titleW, subW) + Math.round(56 * scale)))

    ctx.fillStyle = 'rgba(0, 0, 0, 0.62)'
    ctx.fillRect(boxX, boxY, boxW, boxH)
    ctx.fillStyle = '#F5A623'
    ctx.fillRect(boxX, boxY, Math.max(4, Math.round(5 * scale)), boxH)

    ctx.fillStyle = credit.color
    applyTextShadow()
    ctx.font = `700 ${titleSize}px ${fontFamily}`
    drawSpacedText(
      ctx,
      titleStr,
      boxX + Math.round(22 * scale),
      boxY + Math.round(20 * scale) + titleSize / 2,
      scaledSpacing,
      'left',
      glowHex,
      neonBlur * 0.8
    )
    if (subStr.trim()) {
      ctx.save()
      ctx.globalAlpha = 0.82
      ctx.font = `400 ${subSize}px ${fontFamily}`
      drawSpacedText(
        ctx,
        subStr,
        boxX + Math.round(22 * scale),
        boxY + Math.round(28 * scale) + titleSize + subSize / 2,
        Math.max(0.5, scaledSpacing * 0.4),
        'left',
        glowHex,
        neonBlur * 0.5
      )
      ctx.restore()
    }
    return { pngDataUrl: canvas.toDataURL('image/png'), mode: 'fade' }
  }

  if (credit.templateId === 'standard-text') {
    const align = credit.textAlign ?? 'center'
    const pos = credit.textPosition ?? 'center'
    const padX = Math.round(80 * scale)
    const padY = Math.round(72 * scale)
    const xPos = align === 'left' ? padX : align === 'right' ? W - padX : W / 2
    const rawLines = formatCreditText(rawTitle, credit.autoAscii, credit.uppercase).split('\n')
    const lineHeight = Math.round(scaledFont * lineHeightMul)
    const subTextFormatted = formatCreditText(rawSubtitle, credit.autoAscii)
    const subLines = subTextFormatted.trim() ? subTextFormatted.split('\n') : []
    const subSize = Math.max(Math.round(14 * scale), Math.round(scaledFont * 0.48))
    const subLineHeight = Math.round(subSize * lineHeightMul)
    const blockHeight = rawLines.length * lineHeight + (subLines.length > 0 ? Math.round(12 * scale) + subLines.length * subLineHeight : 0)

    let startY = H / 2 - blockHeight / 2 + lineHeight * 0.5
    if (pos === 'top') startY = padY + lineHeight * 0.5
    else if (pos === 'bottom') startY = H - padY - blockHeight + lineHeight * 0.5

    ctx.fillStyle = credit.color
    applyTextShadow()
    ctx.font = `600 ${scaledFont}px ${fontFamily}`
    rawLines.forEach((line, i) => {
      drawSpacedText(ctx, line, xPos, startY + i * lineHeight, scaledSpacing, align, glowHex, neonBlur)
    })

    if (subLines.length > 0) {
      ctx.save()
      ctx.globalAlpha = 0.8
      ctx.font = `400 ${subSize}px ${fontFamily}`
      const subStartY = startY + rawLines.length * lineHeight + Math.round(8 * scale)
      subLines.forEach((line, i) => {
        drawSpacedText(
          ctx,
          line,
          xPos,
          subStartY + i * subLineHeight,
          Math.max(0, scaledSpacing * 0.4),
          align,
          glowHex,
          neonBlur * 0.6
        )
      })
      ctx.restore()
    }
    return { pngDataUrl: canvas.toDataURL('image/png'), mode: 'fade' }
  }

  // noir-opening veya chapter-card
  const mainTitle = formatCreditText(rawTitle, credit.autoAscii, true)
  const subRaw = formatCreditText(rawSubtitle, credit.autoAscii)
  ctx.fillStyle = credit.color
  applyTextShadow()
  ctx.font = `700 ${scaledFont}px ${fontFamily}`
  const centerY = subRaw.trim() ? H / 2 - Math.round(18 * scale * lineHeightMul) : H / 2
  drawSpacedText(ctx, mainTitle, W / 2, centerY, scaledSpacing, 'center', glowHex, neonBlur)

  if (credit.templateId === 'chapter-card') {
    ctx.save()
    ctx.globalAlpha = 0.45
    const ruleW = Math.round(140 * scale)
    ctx.fillRect(W / 2 - ruleW / 2, centerY + scaledFont * 0.52 * lineHeightMul + Math.round(8 * scale), ruleW, Math.max(2, Math.round(2 * scale)))
    ctx.restore()
  }

  if (subRaw.trim()) {
    const subSize =
      credit.templateId === 'chapter-card'
        ? Math.max(Math.round(16 * scale), Math.round(scaledFont * 0.42))
        : Math.max(Math.round(14 * scale), Math.round(scaledFont * 0.3))
    ctx.save()
    ctx.globalAlpha = 0.8
    ctx.font = `${credit.templateId === 'chapter-card' ? 'italic ' : ''}400 ${subSize}px ${fontFamily}`
    const subText =
      credit.templateId === 'chapter-card' ? subRaw : formatCreditText(rawSubtitle, credit.autoAscii, true)
    drawSpacedText(
      ctx,
      subText,
      W / 2,
      centerY + scaledFont * 0.5 * lineHeightMul + Math.round((credit.templateId === 'chapter-card' ? 32 : 24) * scale * lineHeightMul),
      Math.max(1, scaledSpacing * 0.5),
      'center',
      glowHex,
      neonBlur * 0.65
    )
    ctx.restore()
  }

  return { pngDataUrl: canvas.toDataURL('image/png'), mode: 'fade' }
}
