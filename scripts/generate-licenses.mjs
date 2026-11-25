import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const ROOT = resolve(import.meta.dirname, '..')
const LOCK_PATH = join(ROOT, 'package-lock.json')
const OUT_PATH = join(ROOT, 'THIRD-PARTY-LICENSES.txt')

function detectBinaryVersion(binPath) {
  if (!existsSync(binPath)) return null
  try {
    const out = execFileSync(binPath, ['-version'], { encoding: 'utf8', timeout: 5000 })
    const lines = out.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
    const verLine = lines.find((l) => /^(ffmpeg|ffprobe) version /i.test(l)) ?? lines[0] ?? ''
    const cfgLine = lines.find((l) => /^configuration:/i.test(l)) ?? ''
    return { verLine, cfgLine }
  } catch {
    return null
  }
}

function main() {
  if (!existsSync(LOCK_PATH)) {
    throw new Error('package-lock.json bulunamadı')
  }
  const lock = JSON.parse(readFileSync(LOCK_PATH, 'utf8'))
  const packages = lock.packages || {}

  const prodDeps = []
  for (const [pkgPath, meta] of Object.entries(packages)) {
    if (!pkgPath || meta.dev) continue
    const name = pkgPath.replace(/^node_modules\//, '')
    let license = meta.license
    let repository = ''
    try {
      const pjPath = join(ROOT, pkgPath, 'package.json')
      if (existsSync(pjPath)) {
        const pj = JSON.parse(readFileSync(pjPath, 'utf8'))
        if (!license) {
          license = pj.license || (pj.licenses && pj.licenses.map((x) => x.type || x).join(' OR '))
        }
        if (typeof pj.repository === 'string') repository = pj.repository
        else if (pj.repository?.url) repository = pj.repository.url
      }
    } catch {
      // yoksay
    }
    const licStr =
      typeof license === 'object' ? (license.type || JSON.stringify(license)) : String(license || 'UNKNOWN')
    prodDeps.push({
      name,
      version: meta.version || '',
      license: licStr,
      repository: repository.replace(/^git\+/, '').replace(/\.git$/, '')
    })
  }

  prodDeps.sort((a, b) => a.name.localeCompare(b.name))

  const linuxFfmpeg = detectBinaryVersion(join(ROOT, 'node_modules/ffmpeg-static/ffmpeg'))
  const linuxFfprobe = detectBinaryVersion(
    join(ROOT, 'node_modules/ffprobe-static/bin/linux/x64/ffprobe')
  )

  const lines = [
    '================================================================================',
    'NOIRCUT STUDIO — THIRD-PARTY SOFTWARE & LICENSE NOTICES',
    '================================================================================',
    '',
    'NoirCut Studio source code is licensed under GNU General Public License v3.0',
    '(GPL-3.0-only). See the accompanying LICENSE file for the complete GPL v3 text.',
    'The NoirCut name and custom logo/branding assets remain the exclusive property',
    'of NoirCut Studio.',
    '',
    '--------------------------------------------------------------------------------',
    '1. BUNDLED FFMPEG & FFPROBE NOTICE (GNU GPL v3 SECTION 6)',
    '--------------------------------------------------------------------------------',
    '',
    'NoirCut Studio bundles unmodified static builds of FFmpeg and FFprobe compiled',
    'with GNU GPL v3 flags (--enable-gpl --enable-version3 --enable-static) and',
    'without --enable-nonfree:',
    '',
    `  * Linux (ffmpeg-static): ${linuxFfmpeg?.verLine || 'ffmpeg version 7.0.2-static (https://johnvansickle.com/ffmpeg/)'}`,
    `    Flags: ${linuxFfmpeg?.cfgLine || 'configuration: --enable-gpl --enable-version3 --enable-static'}`,
    '',
    `  * Linux (ffprobe-static): ${linuxFfprobe?.verLine || 'ffprobe version 4.0.2-static (https://johnvansickle.com/ffmpeg/)'}`,
    `    Flags: ${linuxFfprobe?.cfgLine || 'configuration: --enable-gpl --enable-version3 --enable-static'}`,
    '',
    '  * Windows (resources/bin/win/ffmpeg.exe): ffmpeg version 6.1.1-essentials_build-www.gyan.dev',
    '    Flags: --enable-gpl --enable-version3 --enable-static (https://www.gyan.dev/ffmpeg/builds/)',
    '',
    'Corresponding Source Disclosure (GPL v3 Section 6):',
    '  - Upstream FFmpeg Source: https://ffmpeg.org/download.html',
    '  - NoirCut Releases & Source Archives: https://github.com/lakhermony/NoirCut/releases',
    '  - 3-Year Written Offer: For any distributed binary build, you may request a',
    '    complete machine-readable copy of the corresponding source code for at least',
    '    three (3) years from the date of distribution by contacting:',
    '    lakhermony@users.noreply.github.com',
    '',
    'Trademark Attribution:',
    '  FFmpeg is a trademark of Fabrice Bellard, originator of the FFmpeg project.',
    '',
    '--------------------------------------------------------------------------------',
    `2. PRODUCTION NPM DEPENDENCIES (${prodDeps.length} PACKAGES)`,
    '--------------------------------------------------------------------------------',
    ''
  ]

  for (const dep of prodDeps) {
    lines.push(`- ${dep.name}@${dep.version} [${dep.license}]${dep.repository ? ` — ${dep.repository}` : ''}`)
  }

  lines.push(
    '',
    '--------------------------------------------------------------------------------',
    '3. RUNTIME PLATFORM NOTICES',
    '--------------------------------------------------------------------------------',
    '- Electron (MIT): See LICENSE.electron.txt in the application root directory.',
    '- Chromium & Third-Party Libraries: See LICENSES.chromium.html in the application root directory.',
    ''
  )

  writeFileSync(OUT_PATH, lines.join('\n'), 'utf8')
  console.log(`Generated ${OUT_PATH} (${prodDeps.length} production npm dependencies + FFmpeg GPLv3 notice)`)
}

main()
