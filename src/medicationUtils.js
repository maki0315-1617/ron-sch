import { parseTimeValue } from './dateSleepUtils'

export const MEDICATION_SLOT_KEYS = ['morning', 'noon', 'evening', 'bedtime']

export const MEDICATION_SLOT_LABELS = {
  morning: '朝',
  noon: '昼',
  evening: '夜',
  bedtime: '寝る前',
}

export const DEFAULT_MEDICATION_TIMES = {
  morning: '08:00',
  noon: '12:30',
  evening: '18:00',
  bedtime: '22:00',
}

/** 指定時刻の前後何分を服薬ウィンドウとするか */
export const MEDICATION_WINDOW_MINUTES = 30

export const createEmptyMedicationSlots = () => (
  MEDICATION_SLOT_KEYS.reduce((acc, key) => {
    acc[key] = { completed: false, takenAt: null }
    return acc
  }, {})
)

const slotEnabledKey = (slotKey) => `${slotKey}Enabled`

export const isMedicationSlotEnabled = (settings, slotKey) => {
  if (!settings) return true
  return settings[slotEnabledKey(slotKey)] !== false
}

export const normalizeMedicationSettings = (data = {}) => {
  const next = {
    morning: data.morning || DEFAULT_MEDICATION_TIMES.morning,
    noon: data.noon || DEFAULT_MEDICATION_TIMES.noon,
    evening: data.evening || DEFAULT_MEDICATION_TIMES.evening,
    bedtime: data.bedtime || DEFAULT_MEDICATION_TIMES.bedtime,
    notifyEnabled: data.notifyEnabled !== false,
  }
  MEDICATION_SLOT_KEYS.forEach((key) => {
    // 未設定は「服薬あり」。明示的に false のみなし扱い
    next[slotEnabledKey(key)] = data[slotEnabledKey(key)] !== false
  })
  return next
}

export const normalizeMedicationRecordSlots = (slots = {}) => {
  const next = createEmptyMedicationSlots()
  MEDICATION_SLOT_KEYS.forEach((key) => {
    const slot = slots[key]
    if (!slot) return
    next[key] = {
      completed: slot.completed === true,
      takenAt: slot.takenAt || null,
    }
  })
  return next
}

/**
 * 今日の選択日で、指定時刻を過ぎて未完了なら注意対象。
 * 服薬なしスロットは対象外。
 * 点滅開始: scheduled - 30分以降（未完了）
 * @returns {'none' | 'due'}
 */
export const getMedicationSlotAlert = ({
  scheduledTime,
  completed,
  enabled = true,
  isSelectedToday,
  nowMs,
}) => {
  if (!enabled || completed || !isSelectedToday || !scheduledTime) return 'none'
  const now = new Date(nowMs)
  const nowMinutes = now.getHours() * 60 + now.getMinutes()
  const scheduledMinutes = parseTimeValue(scheduledTime)
  const windowStart = scheduledMinutes - MEDICATION_WINDOW_MINUTES
  if (nowMinutes < windowStart) return 'none'
  return 'due'
}

/** 通知用: 指定時刻の offset 分前が到来したか（予定リマインダーと同ロジック） */
export const isMedicationReminderDue = (scheduledTime, nowTime, offsetMinutes, graceMinutes = 5) => {
  const reminderMinutes = parseTimeValue(scheduledTime) - offsetMinutes
  const nowMinutes = parseTimeValue(nowTime)
  return nowMinutes >= reminderMinutes && nowMinutes - reminderMinutes <= graceMinutes
}
