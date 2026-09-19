/** 本番ネイティブ / WAP 共通: steps_daily.csv スキーマ v1 */

export const STEPS_CSV_HEADER = 'date,steps,source,is_final,updated_at'
export const STEPS_CSV_FILENAME = 'steps_daily.csv'
export const STEPS_CSV_MAX_STEP_POINTS = 15

const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/

const linearPoints = (value, start, end, maxPoints) => {
  if (value <= start) return 0
  if (value >= end) return maxPoints
  return Math.round(((value - start) / (end - start)) * maxPoints)
}

export const rowWins = (a, b) => {
  if (a.source === 'manual' && b.source !== 'manual') return true
  if (b.source === 'manual' && a.source !== 'manual') return false
  return (a.updated_at || '') > (b.updated_at || '')
}

/**
 * @param {string} text
 * @returns {Map<string, { date: string, steps: number, source: 'device'|'manual', is_final: boolean, updated_at: string }>}
 */
export const parseStepsCsv = (text) => {
  const byDate = new Map()
  if (!text || !String(text).trim()) return byDate

  const lines = String(text).trim().split(/\r?\n/).filter((line) => line.trim() && !line.startsWith('#'))
  if (lines.length === 0) return byDate

  const header = lines[0].trim()
  if (header !== STEPS_CSV_HEADER) {
    throw new Error(`歩数CSVのヘッダが不正です。先頭行は「${STEPS_CSV_HEADER}」である必要があります。`)
  }

  for (let index = 1; index < lines.length; index += 1) {
    const parts = lines[index].split(',')
    if (parts.length < 5) continue
    const [date, stepsRaw, source, isFinalRaw, ...updatedRest] = parts
    const updated_at = updatedRest.join(',')
    const steps = Number(stepsRaw)
    if (!DATE_KEY_PATTERN.test(date.trim()) || !Number.isFinite(steps) || steps < 0) continue
    if (source !== 'device' && source !== 'manual') continue
    const row = {
      date: date.trim(),
      steps: Math.round(steps),
      source,
      is_final: isFinalRaw === 'true',
      updated_at: updated_at.trim(),
    }
    const prev = byDate.get(row.date)
    if (!prev || rowWins(row, prev)) byDate.set(row.date, row)
  }
  return byDate
}

export const serializeStepsCsv = (byDate) => {
  const rows = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date))
  const lines = [STEPS_CSV_HEADER, ...rows.map((row) => (
    `${row.date},${row.steps},${row.source},${row.is_final ? 'true' : 'false'},${row.updated_at}`
  ))]
  return `${lines.join('\n')}\n`
}

/**
 * @param {Map} byDate
 * @param {{ date: string, steps: number, source: 'device'|'manual', is_final?: boolean, updated_at?: string }} row
 */
export const upsertStepsRow = (byDate, row) => {
  const next = new Map(byDate)
  const updated_at = row.updated_at || new Date().toISOString()
  const entry = {
    date: row.date,
    steps: Math.round(row.steps),
    source: row.source,
    is_final: row.is_final !== false,
    updated_at,
  }
  const prev = next.get(entry.date)
  if (!prev || rowWins(entry, prev)) next.set(entry.date, entry)
  return next
}

/** 疲れ判定に使う歩数（行なし / 未確定 → null → 現行判定のまま） */
export const getStepsForScoring = (byDate, dateKey) => {
  const row = byDate.get(dateKey)
  if (!row || !row.is_final) return null
  return row.steps
}

/** 表示用（確定前も件数表示） */
export const getStepsForDisplay = (byDate, dateKey) => {
  const row = byDate.get(dateKey)
  if (!row) return null
  return row
}

/**
 * 2-A: 6000–9000 帯内0、4000未満・12000超で加点（最大15）
 * @param {number} steps
 */
export const computeStepFatiguePoints = (steps) => {
  const details = []
  let points = 0

  if (steps < 4000) {
    const deficiencyPts = linearPoints(4000 - Math.max(0, steps), 0, 4000, 8)
    if (deficiencyPts > 0) {
      details.push({ key: 'lowSteps', points: deficiencyPts, note: `${steps.toLocaleString('ja-JP')}歩（不足）` })
      points += deficiencyPts
    }
  }

  if (steps > 12000) {
    const capped = Math.min(steps, 18000)
    const excessPts = linearPoints(capped - 12000, 0, 6000, 7)
    if (excessPts > 0) {
      details.push({ key: 'highSteps', points: excessPts, note: `${steps.toLocaleString('ja-JP')}歩（多め）` })
      points += excessPts
    }
  }

  points = Math.min(STEPS_CSV_MAX_STEP_POINTS, points)
  return { points, details, max: STEPS_CSV_MAX_STEP_POINTS }
}

export const formatJstIsoTimestamp = (date = new Date()) => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(date)
  const get = (type) => parts.find((part) => part.type === type)?.value ?? '00'
  return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}:${get('second')}+09:00`
}
