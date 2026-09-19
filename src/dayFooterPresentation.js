/**
 * ホーム「健康生活カウント」セクション用（歩数スロット含む）。
 */

const HEALTH_METRIC_IDS = {
  fatigue: 'fatigue',
  sleepAverage: 'sleepAverage',
  steps: 'steps',
}

/**
 * @param {object} params
 * @param {ReturnType<import('./fatigueScore').computeFatigueScore>} params.fatigue
 * @param {{ averageMinutes: number|null, recordedDays: number, level: string|null }} params.recentSleepSummary
 * @param {(minutes: number|null) => string} params.formatSleepDuration
 * @param {boolean} params.sleepRecordEnabled
 */
export const buildHealthLifeCountPresentation = ({
  fatigue,
  recentSleepSummary,
  formatSleepDuration,
  sleepRecordEnabled,
}) => {
  const sleepPoints = fatigue.breakdown.sleep.points
  const sleepMax = fatigue.breakdown.sleep.max
  const schedulePoints = fatigue.breakdown.schedule.points
  const scheduleMax = fatigue.breakdown.schedule.max

  const fatigueLine1 = `${fatigue.dayLabel}の疲れ: ${fatigue.bandLabel}（${fatigue.score}） · 未完了 ${fatigue.breakdown.schedule.itemCount}件`
  const fatigueLine2 = `内訳 睡眠 ${sleepPoints}/${sleepMax} · 予定 ${schedulePoints}/${scheduleMax}（未完了ベース）`

  let sleepAverageLabel = null
  if (sleepRecordEnabled) {
    if (recentSleepSummary.level && recentSleepSummary.averageMinutes !== null) {
      sleepAverageLabel = `最近3日平均: ${formatSleepDuration(recentSleepSummary.averageMinutes)}（${recentSleepSummary.recordedDays}/3日）`
    } else {
      sleepAverageLabel = '最近3日平均: 記録なし'
    }
  }

  return {
    healthMetrics: [
      { id: HEALTH_METRIC_IDS.fatigue, available: true },
      { id: HEALTH_METRIC_IDS.sleepAverage, available: sleepRecordEnabled },
      { id: HEALTH_METRIC_IDS.steps, available: true },
    ],
    fatigueLine1,
    fatigueLine2,
    sleepAverageLabel,
    sleepBarRatio: sleepMax > 0 ? sleepPoints / sleepMax : 0,
    scheduleBarRatio: scheduleMax > 0 ? schedulePoints / scheduleMax : 0,
    band: fatigue.band,
    ariaLabel: `${fatigue.dayLabel}の疲れ ${fatigue.bandLabel} スコア${fatigue.score}`,
  }
}

/** @deprecated use buildHealthLifeCountPresentation */
export const buildFooterDayPresentation = buildHealthLifeCountPresentation

export { HEALTH_METRIC_IDS }
