import {
  addDays,
  formatDateKey,
  getSleepAdviceLevel,
  getSleepDurationMinutes,
  parseTimeValue,
} from './dateSleepUtils'

const FATIGUE_CONFIG = {
  targetSleepMinutes: 7 * 60,
  recentSleepDays: 3,
  minGapMinutes: 15,
  eveningStartMinutes: 21 * 60,
  heavyDayStartMinutes: 8 * 60,
  maxSleepPoints: 50,
  maxSchedulePoints: 50,
  bands: [
    { max: 30, id: 'light', label: '軽め' },
    { max: 55, id: 'normal', label: '普通' },
    { max: 75, id: 'tired', label: '疲れ気味' },
    { max: 100, id: 'heavy', label: '無理しない日' },
  ],
}

const clamp = (min, max, value) => Math.min(max, Math.max(min, value))

const linearPoints = (value, start, end, maxPoints) => {
  if (value <= start) return 0
  if (value >= end) return maxPoints
  return Math.round(((value - start) / (end - start)) * maxPoints)
}

const resolveBand = (score) => {
  const hit = FATIGUE_CONFIG.bands.find((band) => score <= band.max) || FATIGUE_CONFIG.bands[FATIGUE_CONFIG.bands.length - 1]
  return { band: hit.id, bandLabel: hit.label }
}

const getLastNightSleepMinutes = (selectedDate, sleepRecordMap) => {
  const dateKey = formatDateKey(selectedDate)
  const previousKey = formatDateKey(addDays(selectedDate, -1))
  return getSleepDurationMinutes(sleepRecordMap[dateKey], sleepRecordMap[previousKey])
}

/** recentSleepSummary（App）と同じ: 選択日の前1〜3日の起床分 */
const getRecentSleepAverageMinutes = (selectedDate, sleepRecordMap, days = FATIGUE_CONFIG.recentSleepDays) => {
  const samples = []
  for (let index = 0; index < days; index += 1) {
    const dateKey = formatDateKey(addDays(selectedDate, -(index + 1)))
    const previousDateKey = formatDateKey(addDays(selectedDate, -(index + 2)))
    const minutes = getSleepDurationMinutes(sleepRecordMap[dateKey], sleepRecordMap[previousDateKey])
    if (minutes !== null) samples.push(minutes)
  }
  if (samples.length === 0) return { averageMinutes: null, recordedDays: 0 }
  const averageMinutes = Math.round(samples.reduce((sum, minutes) => sum + minutes, 0) / samples.length)
  return { averageMinutes, recordedDays: samples.length }
}

const computeSleepFatiguePoints = (selectedDate, sleepRecordMap) => {
  const { targetSleepMinutes, maxSleepPoints } = FATIGUE_CONFIG
  const details = []
  let points = 0

  const lastNightMinutes = getLastNightSleepMinutes(selectedDate, sleepRecordMap)
  const { averageMinutes, recordedDays } = getRecentSleepAverageMinutes(selectedDate, sleepRecordMap)

  if (lastNightMinutes === null) {
    details.push({ key: 'lastNightUnknown', points: 8, note: '昨夜の睡眠記録なし' })
    points += 8
  } else {
    const deficit = Math.max(0, targetSleepMinutes - lastNightMinutes)
    const lastNightPts = linearPoints(deficit, 0, targetSleepMinutes, 30)
    if (lastNightPts > 0) {
      details.push({
        key: 'lastNightDeficit',
        points: lastNightPts,
        note: `昨夜 ${Math.floor(lastNightMinutes / 60)}時間${lastNightMinutes % 60}分`,
      })
      points += lastNightPts
    }
  }

  if (averageMinutes !== null) {
    const level = getSleepAdviceLevel(averageMinutes)
    const chronicPts = level === 'short' ? 15 : level === 'moderate' ? 8 : level === 'long' ? 3 : 0
    if (chronicPts > 0) {
      details.push({
        key: 'recentAverage',
        points: chronicPts,
        note: `直近${recordedDays}日平均 ${Math.floor(averageMinutes / 60)}時間${averageMinutes % 60}分`,
      })
      points += chronicPts
    }
  } else {
    details.push({ key: 'recentUnknown', points: 5, note: '直近の睡眠記録が少ない' })
    points += 5
  }

  const wakeKey = formatDateKey(selectedDate)
  const wakeRecord = sleepRecordMap[wakeKey]
  const wakeMinutes = wakeRecord?.wakeTime ? parseTimeValue(wakeRecord.wakeTime) : null

  points = clamp(0, maxSleepPoints, points)
  return { points, details, lastNightMinutes, averageMinutes, wakeMinutes }
}

const computeScheduleLoadMetrics = (items) => {
  const sorted = [...(items || [])]
    .filter((item) => item.completed !== true)
    .sort((a, b) => parseTimeValue(a.time) - parseTimeValue(b.time))

  let totalMinutes = 0
  let highCount = 0
  let eveningMinutes = 0
  let firstStart = null

  for (const item of sorted) {
    const start = parseTimeValue(item.time || '09:00')
    const end = parseTimeValue(item.endTime || '10:00')
    const duration = Math.max(0, end - start)
    totalMinutes += duration
    if (item.priority === 'high') highCount += 1
    if (start >= FATIGUE_CONFIG.eveningStartMinutes) eveningMinutes += duration
    if (firstStart === null) firstStart = start
  }

  let maxBlock = 0
  if (sorted.length > 0) {
    let blockStart = parseTimeValue(sorted[0].time || '09:00')
    let blockEnd = parseTimeValue(sorted[0].endTime || '10:00')
    maxBlock = blockEnd - blockStart

    for (let i = 1; i < sorted.length; i += 1) {
      const start = parseTimeValue(sorted[i].time || '09:00')
      const end = parseTimeValue(sorted[i].endTime || '10:00')
      const gap = start - blockEnd
      if (gap < FATIGUE_CONFIG.minGapMinutes) {
        blockEnd = Math.max(blockEnd, end)
      } else {
        maxBlock = Math.max(maxBlock, blockEnd - blockStart)
        blockStart = start
        blockEnd = end
      }
    }
    maxBlock = Math.max(maxBlock, blockEnd - blockStart)
  }

  return {
    itemCount: sorted.length,
    totalMinutes,
    highCount,
    eveningMinutes,
    maxContinuousMinutes: maxBlock,
    firstStartMinutes: firstStart,
  }
}

const computeScheduleFatiguePoints = (metrics) => {
  const { maxSchedulePoints, heavyDayStartMinutes } = FATIGUE_CONFIG
  const details = []
  let points = 0

  const durationPts = linearPoints(metrics.totalMinutes, heavyDayStartMinutes, heavyDayStartMinutes + 4 * 60, 20)
  if (durationPts > 0) {
    details.push({
      key: 'duration',
      points: durationPts,
      note: `未完了 ${Math.floor(metrics.totalMinutes / 60)}時間${metrics.totalMinutes % 60}分`,
    })
    points += durationPts
  }

  const countPts = linearPoints(metrics.itemCount, 4, 8, 10)
  if (countPts > 0) {
    details.push({ key: 'count', points: countPts, note: `${metrics.itemCount}件` })
    points += countPts
  }

  const highPts = clamp(0, 12, metrics.highCount * 4)
  if (highPts > 0) {
    details.push({ key: 'highPriority', points: highPts, note: `重要 ${metrics.highCount}件` })
    points += highPts
  }

  const blockPts = linearPoints(metrics.maxContinuousMinutes, 3 * 60, 5 * 60, 10)
  if (blockPts > 0) {
    details.push({
      key: 'continuous',
      points: blockPts,
      note: `最長 ${Math.floor(metrics.maxContinuousMinutes / 60)}時間${metrics.maxContinuousMinutes % 60}分`,
    })
    points += blockPts
  }

  const eveningPts = linearPoints(metrics.eveningMinutes, 60, 3 * 60, 8)
  if (eveningPts > 0) {
    details.push({ key: 'evening', points: eveningPts, note: `21時以降 ${metrics.eveningMinutes}分` })
    points += eveningPts
  }

  points = clamp(0, maxSchedulePoints, points)
  return { points, details, metrics }
}

const buildPrimaryHint = (band, sleepPoints, schedulePoints, isToday) => {
  const dayWord = isToday ? '今日' : 'この日'
  if (band === 'heavy') return `${dayWord}は予定を少なめに。ロン君と無理のないペースで。`
  if (band === 'tired' && schedulePoints > sleepPoints) return '予定が詰まっています。休憩の空きを意識しましょう。'
  if (band === 'tired' && sleepPoints >= schedulePoints) return '睡眠が少し足りません。ペースを落として進めましょう。'
  if (band === 'normal') return 'バランスは普通です。水分と短い休憩を忘れずに。'
  return 'コンディションは軽めです。大事な予定から進めましょう。'
}

/**
 * @param {Date} selectedDate
 * @param {Record<string, object>} sleepRecordMap
 * @param {Record<string, Array>} scheduleMap
 * @param {{ isToday?: boolean }} [options]
 */
export const computeFatigueScore = (selectedDate, sleepRecordMap, scheduleMap, options = {}) => {
  const { isToday = true } = options
  const dateKey = formatDateKey(selectedDate)
  const dayItems = scheduleMap[dateKey] || []

  const sleepPart = computeSleepFatiguePoints(selectedDate, sleepRecordMap)
  const scheduleMetrics = computeScheduleLoadMetrics(dayItems)
  const schedulePart = computeScheduleFatiguePoints(scheduleMetrics)

  let rushPts = 0
  if (sleepPart.wakeMinutes !== null && scheduleMetrics.firstStartMinutes !== null) {
    const buffer = scheduleMetrics.firstStartMinutes - sleepPart.wakeMinutes
    if (buffer >= 0 && buffer < 30) {
      rushPts = linearPoints(30 - buffer, 0, 30, 5)
      sleepPart.details.push({ key: 'morningRush', points: rushPts, note: `起床後 ${buffer}分で最初の予定` })
    }
  }

  const sleepPoints = clamp(0, FATIGUE_CONFIG.maxSleepPoints, sleepPart.points + rushPts)
  const schedulePoints = schedulePart.points
  const score = clamp(0, 100, sleepPoints + schedulePoints)
  const { band, bandLabel } = resolveBand(score)

  return {
    score,
    band,
    bandLabel,
    breakdown: {
      sleep: {
        points: sleepPoints,
        max: FATIGUE_CONFIG.maxSleepPoints,
        lastNightMinutes: sleepPart.lastNightMinutes,
        averageMinutes: sleepPart.averageMinutes,
        details: sleepPart.details,
      },
      schedule: {
        points: schedulePoints,
        max: FATIGUE_CONFIG.maxSchedulePoints,
        itemCount: scheduleMetrics.itemCount,
        totalMinutes: scheduleMetrics.totalMinutes,
        highCount: scheduleMetrics.highCount,
        details: schedulePart.details,
      },
    },
    primaryHint: buildPrimaryHint(band, sleepPoints, schedulePoints, isToday),
    dayLabel: isToday ? '今日' : 'この日',
  }
}

export const fatigueBandColors = {
  light: { border: '#22c55e', background: '#f0fdf4', color: '#166534' },
  normal: { border: '#14b8a6', background: '#f0fdfa', color: '#115e59' },
  tired: { border: '#f59e0b', background: '#fffbeb', color: '#92400e' },
  heavy: { border: '#ef4444', background: '#fef2f2', color: '#991b1b' },
}

/** ヘルプPDFなどユーザー向け説明用（ロジックと同期） */
export const fatigueScoringReference = {
  bands: FATIGUE_CONFIG.bands,
  targetSleepHours: FATIGUE_CONFIG.targetSleepMinutes / 60,
  recentSleepDays: FATIGUE_CONFIG.recentSleepDays,
  maxSleepPoints: FATIGUE_CONFIG.maxSleepPoints,
  maxSchedulePoints: FATIGUE_CONFIG.maxSchedulePoints,
  minGapMinutes: FATIGUE_CONFIG.minGapMinutes,
  eveningStartHour: FATIGUE_CONFIG.eveningStartMinutes / 60,
}
