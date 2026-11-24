import {
  formatCreditText,
  resolveCreditFontCss,
  type CreditConfig
} from '../../../shared/credits'
import { computeSubtitleAnimationFrames } from '../../../shared/subtitles'
import type {
  CreditExportOverlay,
  SubtitleExportOverlay,
  SubtitleSegment,
  SubtitleStyleConfig
} from '../../../shared/timeline'

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

/**
 * Altyazı dilimlerini (SubtitleSegment) kullanıcının seçtiği SubtitleStyleConfig ile
 * hedef export çözünürlüğünde şeffaf PNG katmanlarına dönüştürür (burn-in altyazı).
 */
export function renderSubtitlesToPngOverlays(
  subtitles: SubtitleSegment[],
  style: SubtitleStyleConfig,
  targetW = 1920,
  targetH = 1080
): SubtitleExportOverlay[] {
  const out: SubtitleExportOverlay[] = []
  if (!subtitles || subtitles.length === 0) return out
  const scale = Math.min(targetW / 1280, targetH / 720)
  const fontSize = Math.max(16, Math.round((style.fontSize || 26) * scale))
  const lineHeight = Math.round(fontSize * 1.32)
  const padX = Math.round(18 * scale)
  const padY = Math.round(10 * scale)
  const fontFamily =
    style.fontFamily === 'cinzel'
      ? '"Cinzel", Georgia, serif'
      : style.fontFamily === 'mono'
        ? '"JetBrains Mono", monospace'
        : '"Inter", system-ui, sans-serif'

  const anim = style.animation ?? 'none'
  const hiColor = style.highlightColor || '#FACC15'
  const baseTextColor = style.textColor || '#F4F4F6'

  for (const seg of subtitles) {
    const raw = (seg.text ?? '').trim()
    if (!raw || seg.end <= seg.start + 0.01) continue
    const frames = computeSubtitleAnimationFrames(seg, style)

    for (const frame of frames) {
      const canvas = document.createElement('canvas')
      canvas.width = targetW
      canvas.height = targetH
      const ctx = canvas.getContext('2d')!
      ctx.clearRect(0, 0, targetW, targetH)

      const displayRaw =
        anim === 'typewriter'
          ? raw.slice(0, frame.visibleCharCount)
          : anim === 'hormozi'
            ? raw.toUpperCase()
            : raw

      const lines = displayRaw.split('\n').map((l) => l.trim()).filter(Boolean)
      if (lines.length === 0) continue

      const weight = anim === 'hormozi' ? 900 : 600
      ctx.font = `${weight} ${fontSize}px ${fontFamily}`
      ctx.textBaseline = 'middle'
      ctx.textAlign = 'center'

      let maxLineW = 0
      for (const line of lines) {
        const w = ctx.measureText(line).width
        if (w > maxLineW) maxLineW = w
      }

      const boxW = Math.min(targetW - Math.round(64 * scale), Math.round(maxLineW + padX * 2))
      const boxH = Math.round(lines.length * lineHeight + padY * 2)
      const centerX = targetW / 2
      let boxY = targetH - Math.round(targetH * 0.08) - boxH
      if (style.position === 'top') {
        boxY = Math.round(targetH * 0.07)
      } else if (style.position === 'center') {
        boxY = Math.round((targetH - boxH) / 2)
      }

      const bgOpacity = Math.max(0, Math.min(1, (style.backgroundOpacity ?? 68) / 100))
      if (bgOpacity > 0.01) {
        const hex = (style.backgroundColor || '#08090C').replace('#', '')
        const r = parseInt(hex.slice(0, 2) || '08', 16)
        const g = parseInt(hex.slice(2, 4) || '09', 16)
        const b = parseInt(hex.slice(4, 6) || '0C', 16)
        ctx.save()
        ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${bgOpacity.toFixed(2)})`
        const rx = Math.round(centerX - boxW / 2)
        const radius = Math.round(8 * scale)
        ctx.beginPath()
        ctx.roundRect(rx, boxY, boxW, boxH, radius)
        ctx.fill()
        ctx.restore()
      }

      if (anim === 'karaoke' || anim === 'hormozi') {
        let globalWordIdx = 0
        for (let i = 0; i < lines.length; i++) {
          const ly = boxY + padY + lineHeight * (i + 0.5)
          const lineWords = lines[i].split(/\s+/).filter(Boolean)
          const spaceW = ctx.measureText(' ').width
          const wordWidths = lineWords.map((w) => ctx.measureText(w).width)
          const totalW =
            wordWidths.reduce((a, b) => a + b, 0) + Math.max(0, lineWords.length - 1) * spaceW
          let cursorX = centerX - totalW / 2

          ctx.textAlign = 'left'
          for (let wi = 0; wi < lineWords.length; wi++) {
            const word = lineWords[wi]
            const wWidth = wordWidths[wi]
            const isCurrent = globalWordIdx === frame.activeWordIdx
            const isPast = globalWordIdx < frame.activeWordIdx
            const wordColor =
              anim === 'hormozi'
                ? isCurrent
                  ? hiColor
                  : baseTextColor
                : isCurrent || isPast
                  ? hiColor
                  : baseTextColor

            ctx.save()
            if (anim === 'hormozi' && isCurrent) {
              const cx = cursorX + wWidth / 2
              ctx.translate(cx, ly)
              ctx.scale(1.12, 1.12)
              ctx.translate(-cx, -ly)
            }
            ctx.lineJoin = 'round'
            ctx.lineWidth = Math.max(2, Math.round(3.2 * scale))
            ctx.strokeStyle = 'rgba(0, 0, 0, 0.78)'
            ctx.strokeText(word, cursorX, ly)
            ctx.fillStyle = wordColor
            ctx.fillText(word, cursorX, ly)
            ctx.restore()

            cursorX += wWidth + spaceW
            globalWordIdx++
          }
        }
      } else {
        for (let i = 0; i < lines.length; i++) {
          const ly = boxY + padY + lineHeight * (i + 0.5)
          ctx.save()
          ctx.lineJoin = 'round'
          ctx.lineWidth = Math.max(2, Math.round(3.2 * scale))
          ctx.strokeStyle = 'rgba(0, 0, 0, 0.78)'
          ctx.strokeText(lines[i], centerX, ly)
          ctx.restore()
          ctx.fillStyle = baseTextColor
          ctx.fillText(lines[i], centerX, ly)
        }
      }

      out.push({
        id: frame.id,
        start: frame.start,
        end: frame.end,
        pngDataUrl: canvas.toDataURL('image/png')
      })
    }
  }
  return out
}

