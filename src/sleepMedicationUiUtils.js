import { addDays, formatDateKey, parseTimeValue } from './dateSleepUtils'
import { MEDICATION_SLOT_KEYS, getMedicationSlotAlert, isMedicationSlotEnabled } from './medicationUtils'

/** 0:00〜1:59 の就寝操作はカレンダー上「前日」に帰属 */
export const BEDTIME_PREVIOUS_DAY_HOUR_LIMIT = 2

export const resolveBedtimeDateKey = (now = new Date()) => {
  if (now.getHours() < BEDTIME_PREVIOUS_DAY_HOUR_LIMIT) {
    return formatDateKey(addDays(now, -1))
  }
  return formatDateKey(now)
}

/** いまより後の最初の起床予定日（同日内で未到来なら当日、過ぎていれば翌日） */
export const resolveNextWakeDateKey = (plannedWakeTime, now = new Date()) => {
  const nowMinutes = now.getHours() * 60 + now.getMinutes()
  const wakeMinutes = parseTimeValue(plannedWakeTime)
  if (wakeMinutes > nowMinutes) return formatDateKey(now)
  return formatDateKey(addDays(now, 1))
}

export const normalizeSleepAlarmState = (data = {}) => ({
  active: data.active === true,
  bedtimeDate: data.bedtimeDate || '',
  bedtime: data.bedtime || '',
  plannedWakeDate: data.plannedWakeDate || '',
  plannedWakeTime: data.plannedWakeTime || '',
  notifyEnabled: data.notifyEnabled !== false,
})

/** 起床予定が保存済み（未開始でも可） */
export const hasSleepAlarmPlan = (state = {}) =>
  Boolean(state.bedtimeDate && state.plannedWakeDate && state.plannedWakeTime)

/** 「目覚まし開始（寝る）」済み＝就寝記録あり・通知対象 */
export const isSleepAlarmStarted = (state = {}) =>
  state.active === true && Boolean(state.bedtime)

/**
 * 順序ロック B:
 * - 服薬あり & 点滅帯内のみ操作可
 * - より前の「服薬あり・点滅中・未完了」枠がある間は後続不可
 * - 重なり時も操作は1枠（先頭のみ）
 */
export const getMedicationSlotActionState = ({
  slotKey,
  settings,
  slots,
  isSelectedToday,
  nowMs,
}) => {
  const enabled = isMedicationSlotEnabled(settings, slotKey)
  const slot = slots?.[slotKey] || { completed: false, takenAt: null }
  const completed = slot.completed === true
  const scheduledTime = settings?.[slotKey]
  const inWindow = getMedicationSlotAlert({
    scheduledTime,
    completed: false,
    enabled,
    isSelectedToday,
    nowMs,
  }) === 'due'

  if (!enabled) {
    return { enabled: false, inWindow: false, completed, clickable: false, reason: 'disabled' }
  }
  if (!isSelectedToday) {
    return { enabled: true, inWindow: false, completed, clickable: false, reason: 'past' }
  }
  if (!inWindow) {
    return { enabled: true, inWindow: false, completed, clickable: false, reason: 'outside' }
  }

  const earlierBlocking = MEDICATION_SLOT_KEYS.some((key) => {
    if (key === slotKey) return false
    const order = MEDICATION_SLOT_KEYS.indexOf(key)
    if (order >= MEDICATION_SLOT_KEYS.indexOf(slotKey)) return false
    if (!isMedicationSlotEnabled(settings, key)) return false
    const earlier = slots?.[key] || { completed: false }
    if (earlier.completed) return false
    const earlierDue = getMedicationSlotAlert({
      scheduledTime: settings?.[key],
      completed: false,
      enabled: true,
      isSelectedToday: true,
      nowMs,
    }) === 'due'
    return earlierDue
  })

  if (earlierBlocking) {
    return { enabled: true, inWindow: true, completed, clickable: false, reason: 'locked' }
  }

  return { enabled: true, inWindow: true, completed, clickable: true, reason: 'ok' }
}
