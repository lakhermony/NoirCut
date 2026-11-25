import { useEffect, useRef, useState, type ChangeEvent } from 'react'
import {
  CINEMATIC_FONTS,
  CREDIT_FONT_CATEGORIES,
  FONT_MAP,
  isAsciiRecommendedFont,
  type CreditConfig,
  type CreditFontCategory,
  type CreditTextAlign,
  type CreditTextPosition
} from '../../../../shared/credits'
import {
  importCustomFontFile,
  loadStoredCustomFonts,
  registerCustomFontFace,
  removeStoredCustomFont,
  type CustomFontAsset
} from '../../lib/custom-fonts'
import { Accordion, Slider, SoftToggle } from './RightPanelControls'

export function RightPanelCreditsTab({
  credit,
  onCredit,
  onAddCreditToTimeline
}: {
  credit: CreditConfig
  onCredit: (c: CreditConfig) => void
  onAddCreditToTimeline: () => void
}) {
  const [customFonts, setCustomFonts] = useState<CustomFontAsset[]>(() => loadStoredCustomFonts())
  const [fontCategoryFilter, setFontCategoryFilter] = useState<'ALL' | CreditFontCategory>('ALL')
  const [fontUploadError, setFontUploadError] = useState<string | null>(null)
  const fontFileInputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    for (const f of customFonts) {
      void registerCustomFontFace(f)
    }
  }, [customFonts])

  const handleUploadCustomFont = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setFontUploadError(null)
    try {
      const asset = await importCustomFontFile(file)
      const next = loadStoredCustomFonts()
      setCustomFonts(next)
      onCredit({
        ...credit,
        font: 'custom',
        customFont: {
          id: asset.id,
          name: asset.name,
          dataUrl: asset.dataUrl,
          fileName: asset.fileName
        }
      })
    } catch (err) {
      setFontUploadError(err instanceof Error ? err.message : 'Font yüklenemedi')
    }
  }

  const addCreditRow = () => {
    onCredit({
      ...credit,
      rows: [
        ...credit.rows,
        { id: `row-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`, role: 'ROL', name: 'İSİM' }
      ]
    })
  }

  const updateRow = (id: string, patch: { role?: string; name?: string }) => {
    onCredit({
      ...credit,
      rows: credit.rows.map((r) => (r.id === id ? { ...r, ...patch } : r))
    })
  }

  const removeRow = (id: string) => {
    onCredit({ ...credit, rows: credit.rows.filter((r) => r.id !== id) })
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2 px-1">
        <span className="panel-title">Jenerik Editörü</span>
        <button
          data-testid="add-credit-btn"
          onClick={onAddCreditToTimeline}
          className="rounded-full bg-[var(--accent)] px-3.5 py-1.5 text-[10px] font-bold text-[var(--accent-fg)] shadow-[0_2px_10px_var(--accent-glow)] transition duration-150 hover:bg-[var(--accent-hover)] active:scale-95"
        >
          + Timeline'a Ekle
        </button>
      </div>

      <Accordion title="İçerik & Satırları" defaultOpen>
        {credit.templateId === 'rolling-credits' ? (
          <div className="space-y-2.5">
            <div>
              <div className="mb-1 text-[10px] text-white/50">Üst Başlık (Opsiyonel)</div>
              <input
                value={credit.title}
                onChange={(e) => onCredit({ ...credit, title: e.target.value })}
                placeholder="Örn: NOIRCUT SUNAR"
                className="w-full rounded-md border border-[#71717A]/25 bg-black/40 px-2.5 py-1.5 text-xs text-white outline-none focus:border-[#71717A]"
              />
            </div>

            <div className="flex items-center justify-between">
              <span className="text-[10px] text-white/50">Kadro Satırları (Rol — İsim)</span>
              <button
                data-testid="add-credit-row-btn"
                onClick={addCreditRow}
                className="chip !py-0.5 !text-[10px]"
              >
                + Yeni Satır Ekle
              </button>
            </div>

            <div className="max-h-[150px] space-y-1.5 overflow-y-auto pr-0.5">
              {credit.rows.map((row) => (
                <div key={row.id} className="flex items-center gap-1.5">
                  <input
                    value={row.role}
                    onChange={(e) => updateRow(row.id, { role: e.target.value })}
                    placeholder="Rol"
                    className="w-1/2 rounded border border-[#71717A]/25 bg-black/40 px-2 py-1 text-[11px] text-white/85 outline-none focus:border-[#71717A]"
                  />
                  <input
                    value={row.name}
                    onChange={(e) => updateRow(row.id, { name: e.target.value })}
                    placeholder="İsim"
                    className="w-1/2 rounded border border-[#71717A]/25 bg-black/40 px-2 py-1 text-[11px] text-white outline-none focus:border-[#71717A]"
                  />
                  <button
                    onClick={() => removeRow(row.id)}
                    title="Satırı sil"
                    className="shrink-0 rounded px-1.5 py-1 text-[11px] text-white/40 hover:bg-[#71717A]/25 hover:text-white"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          </div>
        ) : credit.templateId === 'standard-text' ? (
          <div className="space-y-2.5">
            <div>
              <div className="mb-1 flex items-center justify-between text-[10px] text-white/50">
                <span>Standart Metin (Çok Satırlı)</span>
                <label className="flex cursor-pointer items-center gap-1 text-[9.5px] text-white/65">
                  <input
                    type="checkbox"
                    checked={Boolean(credit.uppercase)}
                    onChange={(e) => onCredit({ ...credit, uppercase: e.target.checked })}
                    className="accent-[var(--accent)]"
                  />
                  Büyük Harf
                </label>
              </div>
              <textarea
                data-testid="credit-standard-textarea"
                rows={3}
                value={credit.title}
                onChange={(e) => onCredit({ ...credit, title: e.target.value })}
                placeholder="Ekranda görünecek standart metni yazın..."
                className="w-full resize-y rounded border border-[color:var(--border-subtle)] bg-black/45 px-2.5 py-1.5 text-xs text-white outline-none focus:border-[var(--accent)]"
              />
            </div>
            <div>
              <div className="mb-1 text-[10px] text-white/50">Alt Metin (Opsiyonel)</div>
              <input
                data-testid="credit-subtitle-input"
                value={credit.subtitle}
                onChange={(e) => onCredit({ ...credit, subtitle: e.target.value })}
                placeholder="İkincil satır veya açıklama..."
                className="w-full rounded border border-[color:var(--border-subtle)] bg-black/45 px-2.5 py-1.5 text-xs text-white outline-none focus:border-[var(--accent)]"
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <div className="mb-1 text-[9.5px] text-white/50">Yatay Hizalama</div>
                <div className="grid grid-cols-3 gap-1">
                  {(
                    [
                      ['left', 'Sol'],
                      ['center', 'Orta'],
                      ['right', 'Sağ']
                    ] as Array<[CreditTextAlign, string]>
                  ).map(([al, lbl]) => (
                    <button
                      key={al}
                      type="button"
                      onClick={() => onCredit({ ...credit, textAlign: al })}
                      className={`rounded border py-1 text-[9.5px] font-medium transition ${
                        (credit.textAlign ?? 'center') === al
                          ? 'border-[var(--accent)] bg-[var(--accent)]/15 text-[var(--accent)]'
                          : 'border-[color:var(--border-subtle)] text-white/60 hover:text-white'
                      }`}
                    >
                      {lbl}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <div className="mb-1 text-[9.5px] text-white/50">Dikey Konum</div>
                <div className="grid grid-cols-3 gap-1">
                  {(
                    [
                      ['top', 'Üst'],
                      ['center', 'Orta'],
                      ['bottom', 'Alt']
                    ] as Array<[CreditTextPosition, string]>
                  ).map(([pos, lbl]) => (
                    <button
                      key={pos}
                      type="button"
                      onClick={() => onCredit({ ...credit, textPosition: pos })}
                      className={`rounded border py-1 text-[9.5px] font-medium transition ${
                        (credit.textPosition ?? 'center') === pos
                          ? 'border-[var(--accent)] bg-[var(--accent)]/15 text-[var(--accent)]'
                          : 'border-[color:var(--border-subtle)] text-white/60 hover:text-white'
                      }`}
                    >
                      {lbl}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className="space-y-2.5">
            <div>
              <div className="mb-1 text-[10px] text-white/50">Ana Başlık</div>
              <input
                data-testid="credit-title-input"
                value={credit.title}
                onChange={(e) => onCredit({ ...credit, title: e.target.value })}
                className="w-full rounded-md border border-[#71717A]/25 bg-black/40 px-3 py-1.5 text-xs text-white outline-none focus:border-[#71717A]"
              />
            </div>
            <div>
              <div className="mb-1 text-[10px] text-white/50">Alt Başlık</div>
              <input
                data-testid="credit-subtitle-input"
                value={credit.subtitle}
                onChange={(e) => onCredit({ ...credit, subtitle: e.target.value })}
                className="w-full rounded-md border border-[#71717A]/25 bg-black/40 px-3 py-1.5 text-xs text-white outline-none focus:border-[#71717A]"
              />
            </div>
          </div>
        )}
      </Accordion>

      <Accordion title="Tipografi ve Süre" defaultOpen>
        <div className="space-y-2.5">
          <input
            ref={fontFileInputRef}
            type="file"
            accept=".ttf,.otf,.woff,.woff2"
            onChange={handleUploadCustomFont}
            className="hidden"
            data-testid="custom-font-file-input"
          />
          <div className="flex items-center justify-between gap-2 text-[10px] text-white/50">
            <span>Kült Sinema &amp; Korku (20+ Font)</span>
            <button
              type="button"
              data-testid="upload-custom-font-btn"
              onClick={() => fontFileInputRef.current?.click()}
              className="rounded-full border border-[var(--accent)]/45 bg-[var(--accent)]/12 px-2.5 py-0.5 text-[9.5px] font-semibold text-[var(--accent)] transition hover:border-[var(--accent)] hover:bg-[var(--accent)]/22 active:scale-95"
              title="Bilgisayarınızdan .ttf, .otf veya .woff2 font dosyası yükleyin"
            >
              + .ttf / .otf Font Yükle
            </button>
          </div>

          {fontUploadError && (
            <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-2 py-1 text-[9.5px] text-red-300">
              {fontUploadError}
            </div>
          )}

          <div className="flex items-center justify-between rounded-xl border border-white/[0.06] bg-black/30 px-2.5 py-1.5 text-[9.5px]">
            <span className="text-white/50">Seçili Font</span>
            <span className="truncate font-mono font-semibold text-[var(--accent)]">
              {credit.font === 'custom'
                ? credit.customFont?.fileName || credit.customFont?.name || 'Özel Font'
                : FONT_MAP[credit.font]?.label}
            </span>
          </div>

          <div className="space-y-1">
            <label className="flex cursor-pointer items-center justify-between rounded-xl border border-white/[0.08] bg-black/30 px-2.5 py-1.5 text-[10px] text-white/85 transition hover:border-[var(--accent)]/45">
              <div className="flex flex-col">
                <span className="font-medium">TR -&gt; EN Harf Dönüştür</span>
                <span className="text-[8.5px] text-white/45">Ğ→G, Ü→U, Ş→S, İ→I, Ö→O, Ç→C</span>
              </div>
              <SoftToggle
                testId="credit-auto-ascii-toggle"
                checked={Boolean(credit.autoAscii)}
                onChange={(v) => onCredit({ ...credit, autoAscii: v })}
              />
            </label>
            {!credit.autoAscii && isAsciiRecommendedFont(credit.font) && (
              <div className="flex items-center justify-between rounded-lg border border-amber-400/25 bg-amber-400/10 px-2 py-1 text-[8.5px] text-amber-200">
                <span>Bu afiş fontu İngilizce odaklıdır (tofu kutusu önleme önerisi).</span>
                <button
                  type="button"
                  onClick={() => onCredit({ ...credit, autoAscii: true })}
                  className="ml-1.5 shrink-0 font-semibold underline hover:text-white"
                >
                  Dönüştür
                </button>
              </div>
            )}
          </div>

          {customFonts.length > 0 && (
            <div className="space-y-1">
              <div className="text-[8.5px] font-semibold uppercase tracking-wider text-[var(--accent)]/80">
                Özel Yüklenen Fontlar ({customFonts.length})
              </div>
              <div className="grid grid-cols-2 gap-1.5">
                {customFonts.map((cf) => {
                  const active = credit.font === 'custom' && credit.customFont?.id === cf.id
                  return (
                    <div
                      key={cf.id}
                      className={`group flex items-center justify-between rounded-xl border px-2 py-1.5 transition ${
                        active
                          ? 'border-[var(--accent)] bg-[var(--accent)]/15 text-white'
                          : 'border-[color:var(--border-subtle)] bg-black/25 text-white/75 hover:border-white/30'
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() =>
                          onCredit({
                            ...credit,
                            font: 'custom',
                            customFont: {
                              id: cf.id,
                              name: cf.name,
                              dataUrl: cf.dataUrl,
                              fileName: cf.fileName
                            }
                          })
                        }
                        className="min-w-0 flex-1 text-left"
                        title={cf.fileName || cf.label}
                      >
                        <div
                          className="truncate text-[11px] font-semibold leading-tight"
                          style={{ fontFamily: `"${cf.name}", "Inter", sans-serif` }}
                        >
                          {cf.label}
                        </div>
                        <div className="truncate text-[8px] text-white/45">Özel TTF/OTF</div>
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          const next = removeStoredCustomFont(cf.id)
                          setCustomFonts(next)
                          if (credit.font === 'custom' && credit.customFont?.id === cf.id) {
                            onCredit({ ...credit, font: 'bebas', customFont: undefined })
                          }
                        }}
                        title="Özel fontu kaldır"
                        className="ml-1 shrink-0 rounded px-1 text-[10px] text-white/35 opacity-0 transition hover:text-red-300 group-hover:opacity-100"
                      >
                        ×
                      </button>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          <div className="flex flex-wrap gap-1">
            {(
              [
                ['ALL', 'Tümü'],
                ['Horror, Slasher & Occult', 'Horror / Occult'],
                ['Noir, Pulp & Dedektif Afişleri', 'Noir / Pulp'],
                ['Klasik Sinema & Sanatsal Başlıklar', 'Klasik'],
                ['Senaryo, Daktilo & Analog Kayıt', 'Senaryo / VHS']
              ] as Array<['ALL' | CreditFontCategory, string]>
            ).map(([catKey, catLbl]) => (
              <button
                key={catKey}
                type="button"
                onClick={() => setFontCategoryFilter(catKey)}
                className={`rounded-full border px-2 py-0.5 text-[8.5px] font-semibold transition ${
                  fontCategoryFilter === catKey
                    ? 'border-[var(--accent)] bg-[var(--accent)]/18 text-[var(--accent)]'
                    : 'border-white/[0.08] bg-black/25 text-white/55 hover:text-white'
                }`}
              >
                {catLbl}
              </button>
            ))}
          </div>

          <div className="max-h-[260px] space-y-2 overflow-y-auto pr-0.5">
            {CREDIT_FONT_CATEGORIES.filter(
              (cat) => fontCategoryFilter === 'ALL' || fontCategoryFilter === cat
            ).map((cat) => (
              <div key={cat} className="space-y-1">
                <div className="text-[8.5px] font-semibold uppercase tracking-wider text-white/40">
                  {cat}
                </div>
                <div className="grid grid-cols-2 gap-1.5">
                  {CINEMATIC_FONTS.filter((f) => f.category === cat).map((f) => {
                    const active = credit.font === f.id
                    return (
                      <button
                        key={f.id}
                        type="button"
                        data-testid={`credit-font-${f.id}`}
                        onClick={() => onCredit({ ...credit, font: f.id })}
                        title={`${f.label} — ${f.role}`}
                        className={`flex flex-col items-start rounded-xl border px-2.5 py-1.5 text-left transition duration-150 ${
                          active
                            ? 'border-[var(--accent)] bg-[var(--accent-soft)] text-white shadow-[0_0_10px_var(--accent-glow)]'
                            : 'border-[color:var(--border-subtle)] bg-black/25 text-white/75 hover:border-white/30 hover:text-white'
                        }`}
                      >
                        <div className="flex w-full items-center justify-between gap-1">
                          <span
                            className="truncate text-[11.5px] font-semibold leading-tight"
                            style={{ fontFamily: f.css }}
                          >
                            {f.label}
                          </span>
                          <span
                            className={`shrink-0 rounded px-1 py-0 text-[7.5px] font-mono ${
                              f.trSupport === 'ascii'
                                ? 'bg-amber-400/15 text-amber-300'
                                : 'bg-[var(--accent)]/15 text-[var(--accent)]'
                            }`}
                          >
                            {f.trSupport === 'ascii' ? 'EN' : 'TR'}
                          </span>
                        </div>
                        <span className="mt-0.5 truncate text-[8px] text-white/45">{f.role}</span>
                      </button>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div>
          <div className="mb-1 flex items-center justify-between text-[10px] text-white/50">
            <span>Metin Rengi</span>
            <span className="font-mono text-[#71717A]">{credit.color}</span>
          </div>
          <div className="flex items-center gap-2">
            <input
              type="color"
              value={credit.color}
              onChange={(e) => onCredit({ ...credit, color: e.target.value })}
              className="h-6 w-8 cursor-pointer rounded border border-[#71717A]/30 bg-transparent"
            />
            {['#FFFFFF', '#E4E4E7', '#EF4444', '#F59E0B', '#B7E36A'].map((sw) => (
              <button
                key={sw}
                onClick={() => onCredit({ ...credit, color: sw })}
                className={`h-5 w-5 rounded-full border transition ${
                  credit.color.toUpperCase() === sw ? 'scale-110 border-white' : 'border-white/20'
                }`}
                style={{ background: sw }}
                title={sw}
              />
            ))}
          </div>
        </div>

        <Slider
          label="Yazı Boyutu"
          value={credit.fontSize}
          min={16}
          max={96}
          step={1}
          defaultValue={40}
          unit="px"
          onChange={(fontSize) => onCredit({ ...credit, fontSize })}
        />
        <Slider
          label="Harf Aralığı (Tracking)"
          testId="credit-letter-spacing-slider"
          value={credit.letterSpacing}
          min={0}
          max={20}
          step={0.5}
          defaultValue={2}
          unit="px"
          onChange={(letterSpacing) => onCredit({ ...credit, letterSpacing })}
        />
        <div className="grid grid-cols-2 gap-2.5">
          <Slider
            label="Satır Yüksekliği"
            testId="credit-line-height-slider"
            value={credit.lineHeight ?? 1.25}
            min={0.85}
            max={2.4}
            step={0.05}
            defaultValue={1.25}
            unit="x"
            onChange={(lineHeight) => onCredit({ ...credit, lineHeight })}
          />
          <Slider
            label="Metin Gölgesi / Glow"
            testId="credit-text-shadow-slider"
            value={credit.textShadow ?? 45}
            min={0}
            max={100}
            step={1}
            defaultValue={45}
            unit="%"
            onChange={(textShadow) => onCredit({ ...credit, textShadow })}
          />
        </div>

        <div>
          <div className="mb-1 flex items-center justify-between text-[10px] text-white/50">
            <span>Neon Glow Rengi</span>
            <span className="font-mono text-[#71717A]">
              {credit.glowColor && credit.glowColor.toLowerCase() !== '#000000'
                ? credit.glowColor
                : 'Klasik Gölge'}
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <input
              type="color"
              value={credit.glowColor || '#000000'}
              onChange={(e) => onCredit({ ...credit, glowColor: e.target.value })}
              className="h-6 w-8 cursor-pointer rounded border border-[#71717A]/30 bg-transparent"
              title="Özel Neon Glow Rengi"
            />
            {(
              [
                ['#000000', 'Klasik Koyu Gölge'],
                ['#EF4444', 'Kan Kırmızısı Neon'],
                ['#B7E36A', 'Noir Lime Glow'],
                ['#22D3EE', 'Siber Cyan Neon'],
                ['#F59E0B', 'Tungsten Amber']
              ] as const
            ).map(([sw, title]) => (
              <button
                key={sw}
                type="button"
                onClick={() => onCredit({ ...credit, glowColor: sw })}
                className={`h-5 w-5 rounded-full border transition ${
                  (credit.glowColor || '#000000').toUpperCase() === sw
                    ? 'scale-110 border-white'
                    : 'border-white/25'
                }`}
                style={{
                  background: sw,
                  boxShadow: sw !== '#000000' ? `0 0 8px ${sw}` : undefined
                }}
                title={title}
              />
            ))}
          </div>
        </div>
        <Slider
          label="Toplam Akış Süresi"
          value={credit.duration}
          min={2}
          max={30}
          step={0.5}
          defaultValue={5}
          unit="s"
          onChange={(duration) => onCredit({ ...credit, duration })}
        />
      </Accordion>

      <Accordion title="Efektler & Foley Ses" defaultOpen>
        <label className="flex cursor-pointer items-center justify-between rounded-2xl border border-white/[0.06] bg-black/25 px-3 py-2 text-[11px] text-white/85 transition duration-150 hover:border-[var(--accent)]/40">
          <span>Daktilo Efekti (Typewriter)</span>
          <SoftToggle
            testId="credit-typewriter-toggle"
            checked={credit.typewriter}
            onChange={(v) => onCredit({ ...credit, typewriter: v })}
          />
        </label>

        <label className="flex cursor-pointer items-center justify-between rounded-2xl border border-white/[0.06] bg-black/25 px-3 py-2 text-[11px] text-white/85 transition duration-150 hover:border-[var(--accent)]/40">
          <span>Film Titremesi (Gate Weave)</span>
          <SoftToggle
            testId="credit-weave-toggle"
            checked={credit.filmWeave}
            onChange={(v) => onCredit({ ...credit, filmWeave: v })}
          />
        </label>

        <label className="flex cursor-pointer items-center justify-between rounded-2xl border border-white/[0.06] bg-black/25 px-3 py-2 text-[11px] text-white/85 transition duration-150 hover:border-[var(--accent)]/40">
          <span>Efekt Sesi Ekle (Foley SFX)</span>
          <SoftToggle
            testId="credit-sfx-toggle"
            checked={credit.sfxEnabled}
            onChange={(v) => onCredit({ ...credit, sfxEnabled: v })}
          />
        </label>

        {credit.sfxEnabled && (
          <Slider
            label="Foley Ses Seviyesi"
            value={credit.sfxVolume}
            min={0}
            max={100}
            step={1}
            unit="%"
            onChange={(sfxVolume) => onCredit({ ...credit, sfxVolume })}
          />
        )}
      </Accordion>
    </div>
  )
}
