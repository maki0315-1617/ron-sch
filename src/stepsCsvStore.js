import { Capacitor } from '@capacitor/core'
import {
  STEPS_CSV_FILENAME,
  STEPS_CSV_HEADER,
  parseStepsCsv,
  rowWins,
  serializeStepsCsv,
  upsertStepsRow,
} from './stepsCsv'

/** WAP: 同一 origin の localStorage（ネイティブ Filesystem と同じ論理ファイル） */
export const STEPS_CSV_WEB_STORAGE_KEY = 'ron-sch-steps-daily-csv'

const emptyCsv = () => `${STEPS_CSV_HEADER}\n`

export async function readStepsCsvText() {
  if (Capacitor.isNativePlatform()) {
    try {
      const { Filesystem, Directory, Encoding } = await import('@capacitor/filesystem')
      const result = await Filesystem.readFile({
        path: STEPS_CSV_FILENAME,
        directory: Directory.Data,
        encoding: Encoding.UTF8,
      })
      return typeof result.data === 'string' ? result.data : ''
    } catch {
      return null
    }
  }

  if (typeof window === 'undefined') return null
  return window.localStorage.getItem(STEPS_CSV_WEB_STORAGE_KEY)
}

async function writeStepsCsvTextNative(csvText) {
  const { Filesystem, Directory, Encoding } = await import('@capacitor/filesystem')
  const tmpPath = `${STEPS_CSV_FILENAME}.tmp`
  await Filesystem.writeFile({
    path: tmpPath,
    directory: Directory.Data,
    encoding: Encoding.UTF8,
    data: csvText,
    recursive: true,
  })
  try {
    await Filesystem.deleteFile({ path: STEPS_CSV_FILENAME, directory: Directory.Data })
  } catch {
    /* 初回は存在しない */
  }
  await Filesystem.rename({
    from: tmpPath,
    to: STEPS_CSV_FILENAME,
    directory: Directory.Data,
  })
}

export async function writeStepsCsvText(csvText) {
  if (Capacitor.isNativePlatform()) {
    await writeStepsCsvTextNative(csvText)
    return
  }
  if (typeof window === 'undefined') return
  window.localStorage.setItem(STEPS_CSV_WEB_STORAGE_KEY, csvText)
}

/** @returns {Promise<Map<string, import('./stepsCsv').parseStepsCsv extends (...args: any) => infer R ? R : never>>} */
export async function loadStepsByDate() {
  const text = await readStepsCsvText()
  if (!text) return new Map()
  try {
    return parseStepsCsv(text)
  } catch (error) {
    console.error('歩数CSV parse error:', error)
    return new Map()
  }
}

export async function saveStepsByDate(byDate) {
  await writeStepsCsvText(serializeStepsCsv(byDate))
}

/**
 * @param {{ date: string, steps: number, source: 'device'|'manual', is_final?: boolean, updated_at?: string }} row
 */
export async function upsertStepsCsvRow(row) {
  const current = await loadStepsByDate()
  const next = upsertStepsRow(current, row)
  await saveStepsByDate(next)
  return next
}

export async function importStepsCsvText(rawText, { replace = false } = {}) {
  const imported = parseStepsCsv(rawText)
  if (replace) {
    await saveStepsByDate(imported)
    return imported
  }
  const current = await loadStepsByDate()
  let merged = new Map(current)
  imported.forEach((row, date) => {
    const prev = merged.get(date)
    if (!prev || rowWins(row, prev)) merged.set(date, row)
  })
  await saveStepsByDate(merged)
  return merged
}

export async function clearStepsCsvWebOnly() {
  if (Capacitor.isNativePlatform()) return
  if (typeof window === 'undefined') return
  window.localStorage.removeItem(STEPS_CSV_WEB_STORAGE_KEY)
}

export { emptyCsv }
