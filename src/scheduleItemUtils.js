import { parseTimeValue } from './dateSleepUtils'

/** @param {{ isTask?: boolean }} item */
export const isScheduleTask = (item) => item?.isTask === true

/** Firestore ドキュメント ID からアプリ内 item.id を復元 */
export const resolveScheduleItemIdFromDoc = (data, docSnapId) => {
  if (data?.id) return data.id
  if (!docSnapId) return ''
  if (data?.user_id && data?.date) {
    const prefix = `${data.user_id}_${data.date}_`
    if (docSnapId.startsWith(prefix)) return docSnapId.slice(prefix.length)
  }
  const parts = String(docSnapId).split('_')
  if (parts.length >= 3) return parts.slice(2).join('_')
  return docSnapId
}

/**
 * relatedPrev / relatedNext のスナップショットから当日マップ上の予定を探す
 * @param {Record<string, Array>} scheduleMap
 */
export const findRelatedScheduleItem = (scheduleMap, relation) => {
  if (!relation?.date) return null
  const list = scheduleMap[relation.date] || []
  if (relation.id) {
    const byId = list.find((entry) => entry.id === relation.id)
    if (byId) return byId
    const resolved = resolveRelationItemId(relation)
    if (resolved && resolved !== relation.id) {
      const byResolved = list.find((entry) => entry.id === resolved)
      if (byResolved) return byResolved
    }
  }
  return (
    list.find((entry) => {
      if (isScheduleTask(entry)) return false
      return (
        (entry.title || '予定') === (relation.title || '予定')
        && (entry.time || '09:00') === (relation.time || '09:00')
        && (entry.endTime || '10:00') === (relation.endTime || '10:00')
      )
    }) || null
  )
}

/**
 * Firestore の生データをアプリ内表示用に正規化（既存データは isTask 未設定 = スケジュール）
 * @param {object} item
 * @param {string} [fallbackId]
 */
export const normalizeScheduleItem = (item, fallbackId) => {
  const isTask = item.isTask === true
  return {
    id: resolveScheduleItemIdFromDoc(item, fallbackId),
    title: item.title || '予定',
    isTask,
    time: isTask ? item.time || null : item.time || '09:00',
    endTime: isTask ? item.endTime || null : item.endTime || '10:00',
    details: item.details || '',
    completed: item.completed === true,
    priority: item.priority || 'normal',
    date: item.date,
    relatedPrev: isTask ? null : item.relatedPrev || null,
    relatedNext: isTask ? null : item.relatedNext || null,
  }
}

/** その日: 上 = 時刻順スケジュール、下 = タスク（ID順） */
export const sortDayScheduleItems = (items) => {
  const list = items || []
  const schedules = list.filter((entry) => !isScheduleTask(entry))
  const tasks = list.filter((entry) => isScheduleTask(entry))
  schedules.sort((a, b) => parseTimeValue(a.time || '09:00') - parseTimeValue(b.time || '09:00'))
  tasks.sort((a, b) => String(a.id || '').localeCompare(String(b.id || '')))
  return [...schedules, ...tasks]
}

/** 疲れ・集計・通知など時刻あり予定のみ */
export const filterTimedSchedules = (items) => (items || []).filter((entry) => !isScheduleTask(entry))

export const formatScheduleTimeRange = (item) => {
  if (isScheduleTask(item)) return ''
  return `${item.time || '09:00'} - ${item.endTime || '10:00'}`
}

export const formatScheduleRelationLine = (relation) => {
  if (!relation?.date) return ''
  const timePart = relation.time && relation.endTime
    ? `${relation.time}-${relation.endTime}`
    : `${relation.time || '09:00'}-${relation.endTime || '10:00'}`
  return `${relation.date} ${timePart} ${relation.title || '予定'}`
}

/** relatedPrev/relatedNext スナップショット内の id を Firestore 用に正規化 */
export const resolveRelationItemId = (relation, userId) => {
  if (!relation?.id) return null
  const raw = String(relation.id)
  if (userId && relation.date) {
    const prefix = `${userId}_${relation.date}_`
    if (raw.startsWith(prefix)) return raw.slice(prefix.length)
  }
  return raw
}

/** relatedNext が item を指しているか */
export const scheduleRelationPointsToItem = (ref, item, userId) => {
  if (!ref?.date || !item?.date) return false
  if (ref.date !== item.date) return false
  if (ref.id && item.id) {
    if (ref.id === item.id) return true
    const resolvedRef = resolveRelationItemId(ref, userId)
    if (resolvedRef && resolvedRef === item.id) return true
    if (userId && ref.date) {
      const fullId = `${userId}_${ref.date}_${item.id}`
      if (ref.id === fullId) return true
    }
  }
  return (
    (ref.title || '予定') === (item.title || '予定')
    && (ref.time || '09:00') === (item.time || '09:00')
    && (ref.endTime || '10:00') === (item.endTime || '10:00')
  )
}

/** relatedPrev / relatedNext のスナップショットを時刻判定用の最小 item に変換 */
export const scheduleItemFromRelationSnapshot = (relation) => {
  if (!relation?.date) return null
  return {
    id: relation.id || '',
    date: relation.date,
    title: relation.title || '予定',
    time: relation.time || '09:00',
    endTime: relation.endTime || '10:00',
  }
}

/** item の「このあと完了待ち」側の予定（relatedNext または relatedPrev の逆引き） */
export const findDependentScheduleItem = (scheduleMap, item, userId) => {
  if (!item?.date || isScheduleTask(item)) return null
  if (item.relatedNext?.date) {
    const fromNext = findRelatedScheduleItem(scheduleMap, item.relatedNext)
    if (fromNext) return fromNext
  }
  for (const dateKey of Object.keys(scheduleMap || {})) {
    for (const entry of scheduleMap[dateKey] || []) {
      if (isScheduleTask(entry) || !entry.relatedPrev?.date) continue
      if (scheduleRelationPointsToItem(entry.relatedPrev, item, userId)) return entry
    }
  }
  return null
}

/**
 * 完了前に終わっている必要がある「先」の予定（relatedPrev または relatedNext の逆引き）
 * @param {Record<string, Array>} scheduleMap
 */
export const findPriorScheduleBlockingComplete = (scheduleMap, item, userId) => {
  if (!item?.date || isScheduleTask(item)) return null

  if (item.relatedPrev?.date) {
    const fromPrev = findRelatedScheduleItem(scheduleMap, item.relatedPrev)
    if (fromPrev) return fromPrev
  }

  for (const dateKey of Object.keys(scheduleMap || {})) {
    const list = scheduleMap[dateKey] || []
    for (const entry of list) {
      if (isScheduleTask(entry) || !entry.relatedNext?.date) continue
      if (scheduleRelationPointsToItem(entry.relatedNext, item, userId)) return entry
    }
  }

  return null
}

export const scheduleItemHasOrderRelation = (scheduleMap, item) => {
  if (!item || isScheduleTask(item)) return false
  if (item.relatedPrev || item.relatedNext) return true
  for (const dateKey of Object.keys(scheduleMap || {})) {
    const list = scheduleMap[dateKey] || []
    for (const entry of list) {
      if (isScheduleTask(entry) || !entry.relatedNext?.date) continue
      if (scheduleRelationPointsToItem(entry.relatedNext, item)) return true
    }
  }
  return false
}

/** 候補が selected の「先に終わらせる」予定として成立するか */
export const isRelatablePreviousSchedule = (candidate, selected) => {
  if (isScheduleTask(candidate) || isScheduleTask(selected)) return false
  if (candidate.date === selected.date) {
    return parseTimeValue(candidate.endTime || '10:00') < parseTimeValue(selected.time || '09:00')
  }
  return candidate.date < selected.date
}

/** 日付（YYYY-MM-DD）→ 時刻（HH:mm）の前後。日付が同じなら時刻で比較 */
export const compareScheduleDateTime = (dateA, timeA, dateB, timeB) => {
  const dateCompare = String(dateA || '').localeCompare(String(dateB || ''))
  if (dateCompare !== 0) return dateCompare
  return parseTimeValue(timeA || '09:00') - parseTimeValue(timeB || '09:00')
}

const buildRelationOrderBlockLine = (edited, related, role) => {
  const line = formatScheduleRelationLine(related)
  if (!related?.date || !edited?.date) {
    return `関連予定（${line}）と順番が矛盾します。`
  }
  if (edited.date === related.date) {
    return role === 'next'
      ? `「このあと完了待ち」の予定（${line}）と、同日の時刻の順番が矛盾します。`
      : `先に終わらせる予定（${line}）と、同日の時刻の順番が矛盾します。`
  }
  if (role === 'next' && edited.date > related.date) {
    return `「このあと完了待ち」の予定（${line}）より前の日付には変更できません（日付の順番が矛盾しています）。`
  }
  if (role === 'prior' && related.date > edited.date) {
    return `先に終わらせる予定（${line}）より前の日付には変更できません（日付の順番が矛盾しています）。`
  }
  return role === 'next'
    ? `「このあと完了待ち」の予定（${line}）と、日付の順番が矛盾しています。`
    : `先に終わらせる予定（${line}）と、日付の順番が矛盾しています。`
}

/** 移動先などで item が関連予定と順番として両立するか（別日は日付のみ、同日は時刻） */
export const scheduleItemRelationsValidAt = (item, targetDate, { priorItem, nextItem } = {}) => {
  if (!item || isScheduleTask(item) || !targetDate) return true
  const edited = { ...item, date: targetDate }
  const effectivePrior = priorItem || (item.relatedPrev ? scheduleItemFromRelationSnapshot(item.relatedPrev) : null)
  const effectiveNext = nextItem || (item.relatedNext ? scheduleItemFromRelationSnapshot(item.relatedNext) : null)
  if (effectivePrior && !isRelatablePreviousSchedule(effectivePrior, edited)) return false
  if (effectiveNext && !isRelatablePreviousSchedule(edited, effectiveNext)) return false
  return true
}

export const collectScheduleRelationConflictLines = (item, targetDate, priorItem, nextItem) => {
  if (!item || isScheduleTask(item) || !targetDate) return []
  const edited = { ...item, date: targetDate, time: item.time, endTime: item.endTime }
  const lines = []
  const effectivePrior = priorItem || (item.relatedPrev ? scheduleItemFromRelationSnapshot(item.relatedPrev) : null)
  const effectiveNext = nextItem || (item.relatedNext ? scheduleItemFromRelationSnapshot(item.relatedNext) : null)
  if (effectivePrior && !isRelatablePreviousSchedule(effectivePrior, edited)) {
    lines.push(buildRelationOrderBlockLine(edited, effectivePrior, 'prior'))
  }
  if (effectiveNext && !isRelatablePreviousSchedule(edited, effectiveNext)) {
    lines.push(buildRelationOrderBlockLine(edited, effectiveNext, 'next'))
  }
  return [...new Set(lines)]
}

/**
 * 順番指定がある予定の時刻変更時の確認内容
 * @returns {{ warningLines: string[], blockLines: string[] }}
 */
export const buildScheduleRelationTimeChangeConfirm = ({
  item,
  newStart,
  newEnd,
  originalStart,
  originalEnd,
  newDate,
  originalDate,
  priorItem,
  nextItem,
}) => {
  const warningLines = []
  const blockLines = []
  if (!item?.date || isScheduleTask(item)) {
    return { warningLines, blockLines }
  }

  const oStart = originalStart || '09:00'
  const oEnd = originalEnd || '10:00'
  const oDate = originalDate || item.date
  const nDate = newDate || item.date
  const edited = {
    ...item,
    date: nDate,
    time: newStart,
    endTime: newEnd,
  }
  const dateMovedEarlier = nDate < oDate
  const sameDayStartEarlier = nDate === oDate && parseTimeValue(newStart) < parseTimeValue(oStart)
  const sameDayEndEarlier = nDate === oDate && parseTimeValue(newEnd) < parseTimeValue(oEnd)

  const effectiveNext = nextItem || scheduleItemFromRelationSnapshot(item.relatedNext)
  const effectivePrior = priorItem || scheduleItemFromRelationSnapshot(item.relatedPrev)

  if (item.relatedNext || effectiveNext) {
    const sameDayAsNext = effectiveNext && nDate === effectiveNext.date
    if (sameDayAsNext) {
      if (sameDayStartEarlier || sameDayEndEarlier) {
        warningLines.push('「このあと完了待ち」の予定があるため、元の時刻より前へ変更します。')
      }
    } else if (effectiveNext && dateMovedEarlier) {
      warningLines.push('「このあと完了待ち」の予定があるため、元の日付より前へ変更します。')
    }
    if (effectiveNext && !isRelatablePreviousSchedule(edited, effectiveNext)) {
      blockLines.push(buildRelationOrderBlockLine(edited, effectiveNext, 'next'))
    }
  }

  if (item.relatedPrev || effectivePrior) {
    const sameDayAsPrior = effectivePrior && nDate === effectivePrior.date
    if (sameDayAsPrior) {
      if (sameDayStartEarlier) {
        warningLines.push('先に終わらせる予定があるため、開始を元より前へ変更します。')
      }
    } else if (effectivePrior && dateMovedEarlier) {
      warningLines.push('先に終わらせる予定があるため、元の日付より前へ変更します。')
    }
    if (effectivePrior && !isRelatablePreviousSchedule(effectivePrior, edited)) {
      blockLines.push(buildRelationOrderBlockLine(edited, effectivePrior, 'prior'))
    }
  }

  return {
    warningLines: [...new Set(warningLines)],
    blockLines: [...new Set(blockLines)],
  }
}

/** @deprecated 互換用。警告とブロックを連結した配列 */
export const buildScheduleRelationTimeChangeConfirmLines = (options) => {
  const { warningLines, blockLines } = buildScheduleRelationTimeChangeConfirm(options)
  return [...warningLines, ...blockLines]
}

/** 同日で「先に終わらせる」おすすめ（終了が早い順候補の先頭） */
export const pickSameDayRecommendedPrevious = (candidates, selectedItem) => {
  if (!selectedItem || isScheduleTask(selectedItem)) return null
  const sameDay = (candidates || []).filter((c) => c.date === selectedItem.date && !isScheduleTask(c))
  return sameDay.length > 0 ? sameDay[0] : null
}
