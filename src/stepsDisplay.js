/** 歩数連携が成功したときのみ true にする（HealthKit / Health Connect 連携後に設定） */
export const STEPS_LINKED_STORAGE_KEY = 'ron-sch-steps-linked'

/**
 * @returns {{ status: 'unlinked'|'linked_no_data'|'linked', label: string, value?: number }}
 */
export const getStepsDisplayState = (options = {}) => {
  const { stepCount = null } = options
  const linked =
    typeof window !== 'undefined' && window.localStorage.getItem(STEPS_LINKED_STORAGE_KEY) === 'true'

  if (!linked) {
    return { status: 'unlinked', label: '歩数: 未連携' }
  }
  if (stepCount === null || stepCount === undefined) {
    return { status: 'linked_no_data', label: '歩数: 本日のデータなし' }
  }
  return {
    status: 'linked',
    label: `歩数: ${Number(stepCount).toLocaleString('ja-JP')}歩`,
    value: stepCount,
  }
}
