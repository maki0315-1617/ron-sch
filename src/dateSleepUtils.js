export const formatDateKey = (date) => {
  const d = new Date(date)
  const year = d.getFullYear()
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export const addDays = (date, amount) => {
  const next = new Date(date)
  next.setDate(next.getDate() + amount)
  return next
}

export const parseTimeValue = (time = '09:00') => {
  const [hourText = '9', minuteText = '0'] = String(time).split(':')
  return Number(hourText || 0) * 60 + Number(minuteText || 0)
}

export const getSleepDurationMinutes = (record, previousRecord) => {
  if (!record?.wakeTime || !previousRecord?.bedtime) return null
  let minutes = parseTimeValue(record.wakeTime) - parseTimeValue(previousRecord.bedtime)
  if (minutes <= 0) minutes += 24 * 60
  return minutes
}

export const getSleepAdviceLevel = (averageMinutes) => {
  if (averageMinutes === null) return null
  if (averageMinutes <= 5 * 60) return 'short'
  if (averageMinutes <= 7 * 60) return 'moderate'
  if (averageMinutes <= 8 * 60) return 'good'
  return 'long'
}
