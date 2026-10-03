import { doc, getDoc } from 'firebase/firestore'
import { db } from './firebase'
import {
  CONDITION_SCORE_LABELS,
  getConditionLevelLabel,
  getConditionScore,
  normalizeConditionLevel,
  normalizeConditionNote,
} from './medicationUtils'

const escapeHtml = (value) => String(value ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')

const pad2 = (n) => String(n).padStart(2, '0')

/** YYYY-MM の日一覧 */
export const listDateKeysInMonth = (monthKey) => {
  const match = /^(\d{4})-(\d{2})$/.exec(String(monthKey || ''))
  if (!match) return []
  const year = Number(match[1])
  const month = Number(match[2])
  if (!year || month < 1 || month > 12) return []
  const lastDay = new Date(year, month, 0).getDate()
  const keys = []
  for (let day = 1; day <= lastDay; day += 1) {
    keys.push(`${year}-${pad2(month)}-${pad2(day)}`)
  }
  return keys
}

/** 見守り人向け: 対象者の1か月分を get のみで取得（list は使わない） */
export const loadConditionMonthForUser = async (userId, monthKey) => {
  if (!db || !userId) return []
  const dateKeys = listDateKeysInMonth(monthKey)
  const rows = await Promise.all(dateKeys.map(async (dateKey) => {
    try {
      const snap = await getDoc(doc(db, 'medication_records', `${userId}_${dateKey}`))
      if (!snap.exists()) {
        return { dateKey, score: null, level: '', levelLabel: '', note: '' }
      }
      const data = snap.data() || {}
      const level = normalizeConditionLevel(data.conditionLevel)
      const score = getConditionScore(level)
      return {
        dateKey,
        score,
        level,
        levelLabel: getConditionLevelLabel(level),
        note: normalizeConditionNote(data.conditionNote),
      }
    } catch (error) {
      console.warn('体調記録の取得に失敗:', dateKey, error)
      return { dateKey, score: null, level: '', levelLabel: '', note: '', error: true }
    }
  }))
  return rows
}

const buildConditionChartSvg = (rows) => {
  const chartWidth = 760
  const chartHeight = 280
  const paddingLeft = 56
  const paddingRight = 16
  const paddingTop = 20
  const paddingBottom = 36
  const plotWidth = chartWidth - paddingLeft - paddingRight
  const plotHeight = chartHeight - paddingTop - paddingBottom
  const count = rows.length
  if (!count) return '<p class="empty">対象月のデータがありません</p>'

  const toX = (index) => (count <= 1
    ? paddingLeft + plotWidth / 2
    : paddingLeft + (plotWidth * index) / (count - 1))
  const toY = (score) => paddingTop + plotHeight - ((score - 1) / 4) * plotHeight

  const scored = rows
    .map((row, index) => (
      Number.isFinite(row.score)
        ? { ...row, index, x: toX(index), y: toY(row.score) }
        : null
    ))
    .filter(Boolean)

  const grid = [1, 2, 3, 4, 5].map((score) => {
    const y = toY(score)
    const isNormal = score === 3
    return `
      <line x1="${paddingLeft}" y1="${y}" x2="${chartWidth - paddingRight}" y2="${y}"
        stroke="${isNormal ? '#f97316' : '#e2e8f0'}"
        stroke-width="${isNormal ? 1.5 : 1}"
        stroke-dasharray="${isNormal ? '6 4' : '0'}" />
      <text x="${paddingLeft - 8}" y="${y + 4}" font-size="10" fill="${isNormal ? '#c2410c' : '#94a3b8'}" text-anchor="end">${score}:${CONDITION_SCORE_LABELS[score]}</text>
    `
  }).join('')

  // 連続する記録日だけをつないだ折れ線（未記録は線を切る）
  const segments = []
  let current = []
  scored.forEach((point) => {
    if (!current.length || point.index === current[current.length - 1].index + 1) {
      current.push(point)
      return
    }
    if (current.length) segments.push(current)
    current = [point]
  })
  if (current.length) segments.push(current)

  const polylines = segments.map((segment) => {
    const points = segment.map((p) => `${p.x},${p.y}`).join(' ')
    return `<polyline points="${points}" fill="none" stroke="#2563eb" stroke-width="2.5" />`
  }).join('')

  const dots = scored.map((p) => (
    `<circle cx="${p.x}" cy="${p.y}" r="3.5" fill="#2563eb" />`
  )).join('')

  const dayLabels = rows.map((row, index) => {
    const day = Number(row.dateKey.slice(8))
    if (day !== 1 && day % 2 === 0 && day !== rows.length) return ''
    return `<text x="${toX(index)}" y="${chartHeight - 12}" text-anchor="middle" font-size="9" fill="#64748b">${day}</text>`
  }).join('')

  return `<svg viewBox="0 0 ${chartWidth} ${chartHeight}" width="100%" style="max-width:${chartWidth}px" role="img" aria-label="体調の折れ線グラフ">
    ${grid}
    ${polylines}
    ${dots}
    ${dayLabels}
  </svg>`
}

const buildConditionReportHtml = ({
  person,
  monthKey,
  rows,
  includeActions = true,
}) => {
  const chartSvg = buildConditionChartSvg(rows)
  const noteRows = rows.filter((row) => Number.isFinite(row.score) || Boolean(row.note))
  const noteTable = noteRows.length
    ? noteRows.map((row) => `
        <tr>
          <td>${escapeHtml(row.dateKey)}</td>
          <td>${Number.isFinite(row.score) ? `${row.score}（${escapeHtml(row.levelLabel)}）` : '—'}</td>
          <td class="note">${escapeHtml(row.note || '—')}</td>
        </tr>
      `).join('')
    : '<tr><td colspan="3" class="empty">この月の体調記録はありません</td></tr>'

  const outputDate = new Date().toLocaleDateString('ja-JP', { year: 'numeric', month: 'long', day: 'numeric' })
  // 別窓表示時のみ操作ボタンを付ける。画面内プレビューでは親モーダル側で操作する
  const actionsHtml = includeActions
    ? `<div class="actions">
          <button type="button" onclick="window.print()">PDFとして保存 / 印刷</button>
          <button type="button" class="close-button" onclick="window.close()">閉じる</button>
        </div>`
    : ''

  return `<!doctype html>
    <html lang="ja">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>体調グラフ ${escapeHtml(person)} ${escapeHtml(monthKey)}</title>
        <style>
          @page { size: A4 portrait; margin: 12mm; }
          * { box-sizing: border-box; }
          body { margin: 0; padding: 16px; color: #172033; font-family: "Noto Sans JP", "Yu Gothic", Meiryo, sans-serif; }
          h1 { margin: 0 0 6px; font-size: 22px; }
          h2 { margin: 20px 0 8px; font-size: 16px; color: #1e3a8a; }
          .meta { color: #475569; font-size: 13px; margin-bottom: 14px; line-height: 1.6; }
          .chart-box { border: 1px solid #e2e8f0; border-radius: 10px; padding: 12px; background: #f8fafc; }
          .legend { margin: 8px 0 0; font-size: 11px; color: #64748b; line-height: 1.5; }
          table { width: 100%; border-collapse: collapse; font-size: 12px; margin-top: 8px; }
          th, td { border: 1px solid #cbd5e1; padding: 7px 8px; text-align: left; vertical-align: top; }
          th { background: #e8f0ff; color: #1e3a8a; }
          td.note { white-space: pre-wrap; word-break: break-word; }
          .empty { text-align: center; color: #64748b; padding: 18px; }
          .actions { display: flex; justify-content: flex-end; flex-wrap: wrap; gap: 10px; margin-bottom: 12px; }
          button { border: 0; border-radius: 10px; background: #2563eb; color: white; padding: 12px 20px; font-size: 15px; font-weight: 700; cursor: pointer; }
          .close-button { background: #64748b; }
          @media print { .actions { display: none; } }
        </style>
      </head>
      <body>
        ${actionsHtml}
        <h1>体調グラフ（見守り）</h1>
        <div class="meta">
          対象: ${escapeHtml(person)}<br />
          対象月: ${escapeHtml(monthKey)}<br />
          出力日: ${escapeHtml(outputDate)}<br />
          数値: 1大変悪い 〜 5大変良い（3=普通）
        </div>
        <h2>折れ線グラフ</h2>
        <div class="chart-box">
          ${chartSvg}
          <p class="legend">青線: 体調（未記録日は線を切ります）／ オレンジ点線: 普通（3）</p>
        </div>
        <h2>体調についての一言（日別）</h2>
        <table>
          <thead><tr><th style="width:22%">日付</th><th style="width:22%">体調</th><th>一言</th></tr></thead>
          <tbody>${noteTable}</tbody>
        </table>
      </body>
    </html>`
}

/** 画面内表示から印刷ダイアログを開く（iframe.print はスマホで失敗しやすい） */
export const printConditionReportHtml = (html) => {
  if (!html) return false
  let popup = null
  try {
    popup = window.open('', '_blank', 'width=1000,height=750')
  } catch {
    popup = null
  }
  if (!popup || popup.closed || popup === window) return false

  const printable = String(html).includes('class="actions"')
    ? html
    : html.replace(
      '<body>',
      `<body>
        <div class="actions">
          <button type="button" onclick="window.print()">PDFとして保存 / 印刷</button>
          <button type="button" class="close-button" onclick="window.close()">閉じる</button>
        </div>`
    )

  const blobUrl = URL.createObjectURL(new Blob([printable], { type: 'text/html;charset=utf-8' }))
  popup.location.href = blobUrl
  window.setTimeout(() => {
    try {
      if (!popup.closed) {
        popup.focus()
        popup.print()
      }
    } catch { /* ignore */ }
  }, 450)
  window.setTimeout(() => URL.revokeObjectURL(blobUrl), 60000)
  return true
}

const isUsableReportWindow = (targetWindow) => {
  try {
    // 一部スマホは window.open 失敗時に自窓を返す → 自窓へ書き込むとアプリが壊れる
    return Boolean(targetWindow && !targetWindow.closed && targetWindow !== window)
  } catch {
    return false
  }
}

const navigateReportWindow = (targetWindow, html) => {
  if (!isUsableReportWindow(targetWindow)) {
    throw new Error('印刷画面が閉じられました。もう一度お試しください。')
  }
  // about:blank + document.write は端末によって URL が「?-」など異常表示になるため blob で遷移する
  const blobUrl = URL.createObjectURL(new Blob([html], { type: 'text/html;charset=utf-8' }))
  targetWindow.location.href = blobUrl
  window.setTimeout(() => URL.revokeObjectURL(blobUrl), 60000)
}

const LOADING_REPORT_HTML = `<!doctype html><html lang="ja"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>体調グラフを準備中</title>
<style>body{font-family:"Noto Sans JP","Yu Gothic",Meiryo,sans-serif;text-align:center;padding:48px;color:#172033}
.track{max-width:460px;height:12px;margin:24px auto;background:#e2e8f0;border-radius:6px;overflow:hidden}
.bar{height:100%;width:40%;background:#2563eb;animation:load 1.2s ease-in-out infinite alternate}
@keyframes load{from{width:15%}to{width:85%}}</style></head>
<body><h1>体調グラフを準備しています</h1><div class="track"><div class="bar"></div></div></body></html>`

/** スマホでは別タブの URL 異常・ブロックが多いので画面内表示を優先 */
export const preferInAppConditionReport = () => {
  if (typeof window === 'undefined') return true
  try {
    const coarse = window.matchMedia('(pointer: coarse)').matches
    const narrow = window.matchMedia('(max-width: 900px)').matches
    return Boolean(coarse || narrow)
  } catch {
    return true
  }
}

/**
 * @param {object} params
 * @param {string} params.requesterUid
 * @param {string} [params.requesterName]
 * @param {string} params.monthKey
 * @param {Window|null} [params.reportWindow] クリック直後に開いた窓（PC向け）
 * @returns {Promise<{ mode: 'popup'|'html', html?: string }>}
 */
export const openWatchConditionMonthReport = async ({
  requesterUid,
  requesterName,
  monthKey,
  reportWindow = null,
}) => {
  if (!requesterUid || !monthKey) {
    throw new Error('対象者と対象月が必要です。')
  }

  let popup = isUsableReportWindow(reportWindow) ? reportWindow : null
  if (popup) {
    try {
      navigateReportWindow(popup, LOADING_REPORT_HTML)
    } catch {
      popup = null
    }
  }

  const rows = await loadConditionMonthForUser(requesterUid, monthKey)
  const person = requesterName || '依頼人'
  const popupHtml = buildConditionReportHtml({ person, monthKey, rows, includeActions: true })
  const embedHtml = buildConditionReportHtml({ person, monthKey, rows, includeActions: false })

  if (isUsableReportWindow(popup)) {
    try {
      // 既存帳票と同様、初期化完了後に blob へ遷移
      await new Promise((resolve) => window.setTimeout(resolve, 0))
      if (!isUsableReportWindow(popup)) {
        return { mode: 'html', html: embedHtml }
      }
      navigateReportWindow(popup, popupHtml)
      try { popup.focus() } catch { /* ignore */ }
      return { mode: 'popup' }
    } catch {
      // フォールバックへ
    }
  }

  // スマホ等: 別窓が使えない／異常になる場合はアプリ内表示
  return { mode: 'html', html: embedHtml }
}

/** クリック直後に呼ぶ（ユーザー操作の同一タイミングで窓を開く） */
export const openReportWindowSync = () => {
  try {
    const popup = window.open('', '_blank', 'width=1000,height=750')
    return isUsableReportWindow(popup) ? popup : null
  } catch {
    return null
  }
}
