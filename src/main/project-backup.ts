/**
 * Otomatik Kayıt (Autosave), Çökme Kurtarma ve Sürüm Anlık Görüntüleri.
 */
import { app } from 'electron'
import { existsSync, mkdirSync, writeFileSync } from 'fs'
import { mkdir, readdir, readFile, rename, rm, writeFile } from 'fs/promises'
import { join } from 'path'
import type { NoirCutProject } from '../shared/project'
import { projectEnd } from '../shared/timeline'
import type { AutosaveEntry, AutosaveStatus } from '../shared/types'

interface SessionState {
  active: boolean
  updatedAt: string
  activeSnapshotId: string | null
}

interface SnapshotFile {
  meta: AutosaveEntry
  project: NoirCutProject
}

const MAX_SNAPSHOTS = 10

function getAutosaveDirs() {
  const base = join(app.getPath('userData'), 'autosaves')
  const snaps = join(base, 'snapshots')
  return {
    base,
    snaps,
    sessionFile: join(base, 'session.json')
  }
}

async function ensureDirs(): Promise<ReturnType<typeof getAutosaveDirs>> {
  const dirs = getAutosaveDirs()
  await mkdir(dirs.snaps, { recursive: true })
  return dirs
}

async function readSession(sessionFile: string): Promise<SessionState | null> {
  try {
    if (!existsSync(sessionFile)) return null
    const raw = await readFile(sessionFile, 'utf-8')
    return JSON.parse(raw) as SessionState
  } catch {
    return null
  }
}

async function atomicWriteJson(target: string, data: unknown): Promise<void> {
  const tmp = `${target}.tmp-${process.pid}-${Date.now()}`
  await writeFile(tmp, JSON.stringify(data), 'utf-8')
  await rename(tmp, target)
}

export async function writeAutosaveSnapshot(
  project: NoirCutProject,
  label = 'Otomatik Yedek'
): Promise<{ ok: boolean; entry?: AutosaveEntry }> {
  try {
    const dirs = await ensureDirs()
    const now = new Date()
    const id = `snap-${now.getTime()}-${Math.random().toString(36).slice(2, 6)}`
    const entry: AutosaveEntry = {
      id,
      savedAt: now.toISOString(),
      clipCount: project.clips?.length ?? 0,
      duration: Number(projectEnd(project.clips ?? []).toFixed(2)),
      label
    }
    const payload: SnapshotFile = { meta: entry, project }
    await atomicWriteJson(join(dirs.snaps, `${id}.json`), payload)

    const session: SessionState = {
      active: entry.clipCount > 0 || (project.markers?.length ?? 0) > 0,
      updatedAt: entry.savedAt,
      activeSnapshotId: id
    }
    await atomicWriteJson(dirs.sessionFile, session)

    // En fazla MAX_SNAPSHOTS adet eski anlık görüntüyü tut
    const files = (await readdir(dirs.snaps))
      .filter((f) => f.endsWith('.json'))
      .sort()
      .reverse()
    for (const oldFile of files.slice(MAX_SNAPSHOTS)) {
      await rm(join(dirs.snaps, oldFile), { force: true })
    }
    return { ok: true, entry }
  } catch {
    return { ok: false }
  }
}

export async function getAutosaveStatus(): Promise<AutosaveStatus> {
  try {
    const dirs = await ensureDirs()
    const [session, files] = await Promise.all([
      readSession(dirs.sessionFile),
      readdir(dirs.snaps)
    ])
    const jsonFiles = files.filter((f) => f.endsWith('.json'))
    const entries: AutosaveEntry[] = []
    for (const file of jsonFiles) {
      try {
        const raw = await readFile(join(dirs.snaps, file), 'utf-8')
        const parsed = JSON.parse(raw) as SnapshotFile
        if (parsed?.meta?.id) entries.push(parsed.meta)
      } catch {
        // bozuk anlık görüntüyü atla
      }
    }
    entries.sort((a, b) => (a.savedAt < b.savedAt ? 1 : -1))
    const latest = entries[0] ?? null
    const hasUncleanExit = Boolean(session?.active && latest && latest.clipCount > 0)
    return { hasUncleanExit, latest, snapshots: entries }
  } catch {
    return { hasUncleanExit: false, latest: null, snapshots: [] }
  }
}

export async function readAutosaveSnapshot(snapshotId: string): Promise<NoirCutProject | null> {
  try {
    const safeId = snapshotId.replace(/[^a-zA-Z0-9_-]/g, '')
    if (!safeId) return null
    const dirs = await ensureDirs()
    const target = join(dirs.snaps, `${safeId}.json`)
    if (!existsSync(target)) return null
    const raw = await readFile(target, 'utf-8')
    const parsed = JSON.parse(raw) as SnapshotFile
    return parsed?.project ?? null
  } catch {
    return null
  }
}

export async function dismissAutosaveRecovery(): Promise<void> {
  try {
    const dirs = await ensureDirs()
    const prev = await readSession(dirs.sessionFile)
    const next: SessionState = {
      active: false,
      updatedAt: new Date().toISOString(),
      activeSnapshotId: prev?.activeSnapshotId ?? null
    }
    await atomicWriteJson(dirs.sessionFile, next)
  } catch {
    // sessiz geç
  }
}

export function markCleanExitSync(): void {
  try {
    const dirs = getAutosaveDirs()
    if (!existsSync(dirs.base)) mkdirSync(dirs.base, { recursive: true })
    const next: SessionState = {
      active: false,
      updatedAt: new Date().toISOString(),
      activeSnapshotId: null
    }
    writeFileSync(dirs.sessionFile, JSON.stringify(next), 'utf-8')
  } catch {
    // sessiz geç
  }
}
