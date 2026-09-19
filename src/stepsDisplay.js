/** 歩数連携が成功したときのみ true にする（HealthKit / Health Connect 連携後に設定） */
export const STEPS_LINKED_STORAGE_KEY = 'ron-sch-steps-linked'

/**
 * @returns {{ status: 'unlinked'|'linked_no_data'|'linked'|'provisional', label: string, value?: number }}
 */
export const getStepsDisplayState = (options = {}) => {
  const { stepRow = null, csvHasAnyRow = false } = options
  const linked =
    typeof window !== 'undefined' && window.localStorage.getItem(STEPS_LINKED_STORAGE_KEY) === 'true'

  const effectivelyLinked = linked || csvHasAnyRow

  if (!effectivelyLinked) {
    return { status: 'unlinked', label: '歩数: 未連携' }
  }
  if (!stepRow) {
    return { status: 'linked_no_data', label: '歩数: この日のデータなし' }
  }
  if (!stepRow.is_final) {
    return {
      status: 'provisional',
      label: `歩数: ${Number(stepRow.steps).toLocaleString('ja-JP')}歩（確定前・判定未反映）`,
      value: stepRow.steps,
    }
  }
  return {
    status: 'linked',
    label: `歩数: ${Number(stepRow.steps).toLocaleString('ja-JP')}歩`,
    value: stepRow.steps,
  }
}
