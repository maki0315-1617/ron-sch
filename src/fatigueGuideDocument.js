import { fatigueScoringReference } from './fatigueScore'

const escapeHtml = (value) =>
  String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')

const bandRowsHtml = (bands, lang) => {
  let previousMax = 0
  return bands
    .map((band) => {
      const from = previousMax + 1
      const to = band.max
      previousMax = band.max
      const range = from === to ? `${to}` : `${from}〜${to}`
      const label = lang === 'en' ? band.labelEn : band.label
      return `<tr><td>${range}</td><td>${escapeHtml(label)}</td><td><code>${escapeHtml(band.id)}</code></td></tr>`
    })
    .join('')
}

const content = {
  ja: {
    htmlLang: 'ja',
    title: '「疲れ」表示の見方と判定のしくみ',
    subtitle: 'ロン君のスケジュール — 画面下部の「健康生活カウント」フッターに表示される疲れスコア（0〜100）の説明です。',
    saveLabel: 'PDFとして保存 / 印刷',
    closeLabel: '閉じる',
    footer: () => `作成日: ${new Date().toLocaleDateString('ja-JP', { year: 'numeric', month: 'long', day: 'numeric' })}`,
    disclaimerTitle: '重要：医療上の判断ではありません',
    disclaimerBody:
      '「疲れ」スコアとメッセージは、睡眠記録と予定データから算出した<strong>生活・予定管理の目安</strong>です。病気の診断、治療、服薬の判断、メンタルヘルスや睡眠障害の評価には使用できません。体調に不安がある場合は、医療機関など専門家に相談してください。',
    sections: [
      {
        heading: '1. どこに表示されるか',
        body: '設定メニューの「健康生活カウント表示」をオンにすると、<strong>ホーム画面の末尾</strong>（予定リストの下）にセクションが表示されます。初期状態はオフです。見出しをタップして開閉できます（月カレンダーと同様）。',
        points: [
          '「今日」と「この日」は、選択した日付が本日かどうかで切り替わります。',
          '1行目: 帯域・スコア・未完了件数。2行目: 睡眠・予定の内訳点数（各最大50）。',
          '予定の負荷は<strong>未完了の予定のみ</strong>を数えます。',
          '達成（連続日数・週バッジ）は選択日の<strong>予定カードの直下</strong>に表示されます。',
          '表示オフ時は疲れスコアの計算を行いません（省電力）。',
        ],
      },
      {
        heading: '2. スコアと帯域（ラベル）',
        body: '睡眠側（最大50点）と予定側（最大50点）を足した合計がスコア（0〜100）です。数字が高いほど「予定・睡眠の面で無理しやすい日」と捉えてください。',
        points: [
          '帯域ラベル（軽め／普通／疲れ気味／無理しない日）は、下表のスコア範囲で決まります。',
          'スコアの数字は予定や睡眠記録を変えると細かく変わります。',
        ],
      },
      {
        heading: '3. 睡眠側（最大50点）',
        body: `目標睡眠時間は${fatigueScoringReference.targetSleepHours}時間です。直近${fatigueScoringReference.recentSleepDays}日平均は、フッターに表示される値と同じ集計期間です（睡眠記録表示がオンのとき）。`,
        points: [
          '昨夜の睡眠：前日の就寝時刻と、選択日の起床時刻から睡眠時間を計算。目標より短いほど加点（最大30点）。記録がない場合は小さな固定加点。',
          '直近平均：3日分の平均が短い・やや短い・長めなどに応じて加点（最大15点）。記録が少ない場合は固定加点。',
          '朝の間隔：起床時刻から最初の未完了予定開始まで30分未満の場合、最大5点を追加。',
        ],
      },
      {
        heading: '4. 予定側（最大50点）',
        body: '選択日の未完了予定だけを対象に、占有時間・件数・重要度・連続ブロック・夜間（21時以降）などから加点します。',
        points: [
          '占有時間：未完了予定の開始〜終了の合計が長いほど加点（最大20点）。',
          '件数：未完了が多いほど加点（最大10点）。',
          '重要：重要度「重要」の件数に応じて加点（最大12点）。',
          `連続：予定の間隔が${fatigueScoringReference.minGapMinutes}分未満は同じブロックとみなし、長い連続時間で加点（最大10点）。`,
          `夜間：${fatigueScoringReference.eveningStartHour}時以降に始まる未完了予定の時間で加点（最大8点）。`,
        ],
      },
      {
        heading: '5. 免責と説明PDF',
        body: 'セクション内の1行に、医療上の診断・治療の代わりにならない旨と、本PDFへのリンクが表示されます。',
        points: [
          '体調に不安がある場合は専門家に相談してください。',
        ],
      },
      {
        heading: '6. 歩数（連携状態）',
        body: '歩数は端末連携の有無を確認して表示します。未連携のときは「歩数: 未連携」、連携済みでデータがない日は「本日のデータなし」、連携済みで取得できた場合は歩数を表示します（ネイティブ連携は順次対応）。',
        points: [
          '現時点では多くの環境で未連携表示になります。',
          '将来、疲れスコアへの反映を検討する場合も、医療判断には用いません。',
        ],
      },
      {
        heading: '7. 健康生活カウント（今後の拡張）',
        body: '同一セクションに睡眠・予定・歩数などを載せる「健康生活カウント」として拡張します。',
        points: [
          '疲れスコアと平均睡眠が中心の指標です。',
        ],
      },
    ],
    bandTableTitle: '帯域一覧',
    bandTableHeaders: ['スコア', '表示ラベル', '内部ID'],
    noteTitle: 'データが少ないとき',
    note: '睡眠記録がない日は睡眠側が「不明」扱いになり、スコアが高めに出やすくなります。睡眠記録を続けると、より自分のリズムに近い目安になります。',
  },
  en: {
    htmlLang: 'en',
    title: 'How the Fatigue Score Works',
    subtitle: 'Ron’s Schedule — explains the 0–100 fatigue score in the fixed footer “Healthy Life Count” area.',
    saveLabel: 'Save / Print as PDF',
    closeLabel: 'Close',
    footer: () => `Created on: ${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}`,
    disclaimerTitle: 'Important: Not a medical assessment',
    disclaimerBody:
      'The fatigue score and messages are a <strong>planning and self-management guide</strong> based on your sleep records and schedule. They are not a diagnosis, treatment advice, medication guidance, or evaluation of sleep or mental health conditions. If you have health concerns, consult a qualified professional.',
    sections: [
      {
        heading: '1. Where it appears',
        body: 'Turn on “Show Healthy Life Count” in Settings to show a section at the <strong>bottom of Home</strong> (below your schedule list). It is off by default. Tap the heading to expand or collapse, like the month calendar.',
        points: [
          '“Today” vs “This day” depends on the selected date.',
          'Line 1: band, score, incomplete count. Line 2: sleep/schedule subscores (max 50 each).',
          'Only incomplete tasks count toward schedule load.',
          'Streak and weekly badge appear <strong>below the schedule cards</strong> for the selected day.',
          'When hidden, fatigue score is not calculated.',
        ],
      },
      {
        heading: '2. Score and bands',
        body: 'Sleep (max 50) + schedule (max 50) = total score (0–100). Higher scores suggest a busier or shorter-sleep day in app terms—not a clinical measure.',
        points: [
          'Band labels follow the table below.',
          'The numeric score updates as you edit data.',
        ],
      },
      {
        heading: '3. Sleep portion (max 50)',
        body: `Target sleep is ${fatigueScoringReference.targetSleepHours} hours. The recent ${fatigueScoringReference.recentSleepDays}-day average matches the footer when sleep records are enabled.`,
        points: [
          'Last night: from previous bedtime to selected-day wake time; shorter vs target adds points (up to 30). Missing data adds a small fixed amount.',
          'Recent average: short or moderate averages add points (up to 15). Few records add a small fixed amount.',
          'Morning gap: if first incomplete task starts within 30 minutes of wake time, up to 5 points.',
        ],
      },
      {
        heading: '4. Schedule portion (max 50)',
        body: 'Incomplete tasks on the selected day: duration, count, high priority, long blocks, and evening load.',
        points: [
          'Duration: total scheduled minutes (up to 20 points).',
          'Count: more incomplete tasks (up to 10 points).',
          'High priority: “High” tasks (up to 12 points).',
          `Continuous blocks: gaps under ${fatigueScoringReference.minGapMinutes} minutes merge (up to 10 points).`,
          `Evening: tasks starting at ${fatigueScoringReference.eveningStartHour}:00 or later (up to 8 points).`,
        ],
      },
      {
        heading: '5. Disclaimer and PDF',
        body: 'One line in the section states this is not medical advice, with a link to this PDF.',
        points: ['Consult a professional if you have health concerns.'],
      },
      {
        heading: '6. Steps (link status)',
        body: 'Steps show as unlinked, linked with no data today, or linked with a step count once native integration is available.',
        points: [
          'Most environments show “Steps: Not linked” until integration ships.',
        ],
      },
      {
        heading: '7. Healthy Life Count (planned)',
        body: 'Sleep, schedule load, and steps will live in one optional Home section.',
        points: ['Fatigue and sleep average are the main metrics today.'],
      },
    ],
    bandTableTitle: 'Score bands',
    bandTableHeaders: ['Score', 'Label', 'ID'],
    noteTitle: 'When data is sparse',
    note: 'Without sleep records, the sleep portion is estimated as unknown and scores may read higher. Regular sleep logging improves personal relevance.',
  },
}

const bandsWithEn = fatigueScoringReference.bands.map((band) => ({
  ...band,
  labelEn:
    band.id === 'light'
      ? 'Light'
      : band.id === 'normal'
        ? 'Normal'
        : band.id === 'tired'
          ? 'Tired'
          : 'Take it easy',
}))

export const buildFatigueGuideHtml = (lang = 'ja') => {
  const doc = content[lang] || content.ja
  const sectionsHtml = doc.sections
    .map(
      (section) => `
      <section class="card">
        <h2>${escapeHtml(section.heading)}</h2>
        <p>${section.body}</p>
        <ul>${section.points.map((point) => `<li>${point}</li>`).join('')}</ul>
      </section>`
    )
    .join('')

  return `<!doctype html>
<html lang="${doc.htmlLang}">
<head>
  <meta charset="UTF-8" />
  <title>${escapeHtml(doc.title)}</title>
  <style>
    @page { size: A4 portrait; margin: 12mm; }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      background: #f8fafc;
      color: #172033;
      font-family: "Noto Sans JP", "Segoe UI", "Yu Gothic", Meiryo, sans-serif;
    }
    .page { max-width: 820px; margin: 0 auto; padding: 24px 20px 40px; }
    .actions { display: flex; justify-content: flex-end; gap: 10px; margin-bottom: 12px; }
    button {
      border: 0; border-radius: 10px; background: #0f766e; color: white;
      padding: 12px 20px; font-size: 15px; cursor: pointer;
    }
    button.close-button { background: #64748b; }
    h1 { margin: 0 0 8px; font-size: 24px; color: #0f172a; }
    .subtitle { margin: 0 0 16px; color: #475569; font-size: 14px; line-height: 1.7; }
    .disclaimer {
      background: #fff7ed; border: 2px solid #fb923c; border-radius: 12px;
      padding: 14px 16px; margin-bottom: 20px;
    }
    .disclaimer h2 { margin: 0 0 8px; font-size: 15px; color: #9a3412; }
    .disclaimer p { margin: 0; font-size: 13px; line-height: 1.75; color: #7c2d12; }
    .card {
      background: #fff; border: 1px solid #e2e8f0; border-radius: 12px;
      padding: 16px 18px; margin-top: 16px;
    }
    .card h2 { margin: 0 0 8px; font-size: 17px; color: #0f766e; }
    p, li { font-size: 13px; line-height: 1.75; color: #334155; }
    ul { margin: 10px 0 0; padding-left: 20px; }
    table {
      width: 100%; border-collapse: collapse; margin-top: 12px; font-size: 13px;
    }
    th, td { border: 1px solid #cbd5e1; padding: 8px 10px; text-align: left; }
    th { background: #f1f5f9; color: #0f172a; }
    .tip {
      margin-top: 20px; background: #ecfdf5; border: 1px solid #99f6e4;
      border-radius: 12px; padding: 14px 16px;
    }
    .tip-title { font-weight: 800; color: #115e59; margin-bottom: 6px; font-size: 14px; }
    .footer { margin-top: 20px; color: #64748b; font-size: 12px; text-align: right; }
    @media print { .actions { display: none; } }
  </style>
</head>
<body>
  <div class="page">
    <div class="actions">
      <button type="button" onclick="window.print()">${escapeHtml(doc.saveLabel)}</button>
      <button type="button" class="close-button" onclick="window.close()">${escapeHtml(doc.closeLabel)}</button>
    </div>
    <h1>${escapeHtml(doc.title)}</h1>
    <p class="subtitle">${escapeHtml(doc.subtitle)}</p>
    <div class="disclaimer" role="note">
      <h2>${escapeHtml(doc.disclaimerTitle)}</h2>
      <p>${doc.disclaimerBody}</p>
    </div>
    ${sectionsHtml}
    <section class="card">
      <h2>${escapeHtml(doc.bandTableTitle)}</h2>
      <table>
        <thead><tr>${doc.bandTableHeaders.map((h) => `<th>${escapeHtml(h)}</th>`).join('')}</tr></thead>
        <tbody>${bandRowsHtml(bandsWithEn, lang)}</tbody>
      </table>
    </section>
    <div class="tip">
      <div class="tip-title">${escapeHtml(doc.noteTitle)}</div>
      <div>${escapeHtml(doc.note)}</div>
    </div>
    <div class="footer">${escapeHtml(doc.footer())}</div>
  </div>
</body>
</html>`
}
