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
    subtitle: 'ロン君のスケジュール — 選択中の日の下に表示されるスコア（0〜100）の説明です。',
    saveLabel: 'PDFとして保存 / 印刷',
    closeLabel: '閉じる',
    footer: () => `作成日: ${new Date().toLocaleDateString('ja-JP', { year: 'numeric', month: 'long', day: 'numeric' })}`,
    disclaimerTitle: '重要：医療上の判断ではありません',
    disclaimerBody:
      '「疲れ」スコアとメッセージは、睡眠記録と予定データから算出した<strong>生活・予定管理の目安</strong>です。病気の診断、治療、服薬の判断、メンタルヘルスや睡眠障害の評価には使用できません。体調に不安がある場合は、医療機関など専門家に相談してください。',
    sections: [
      {
        heading: '1. どこに表示されるか',
        body: 'ホーム画面で「選択中の日」のすぐ下に、「今日の疲れ」または「この日の疲れ」として帯域・スコア・短いメッセージが表示されます。カレンダーで日付を変えると、その日のデータで再計算されます。',
        points: [
          '「今日」と「この日」は、選択した日付が本日かどうかで切り替わります。',
          '2行目には未完了予定件数と、睡眠・予定それぞれの加点（最大50点ずつ）を表示します。',
          '予定の負荷は<strong>未完了の予定のみ</strong>を数えます。完了にすると予定側の点数が下がります。',
        ],
      },
      {
        heading: '2. スコアと帯域（ラベル）',
        body: '睡眠側（最大50点）と予定側（最大50点）を足した合計がスコア（0〜100）です。数字が高いほど「予定・睡眠の面で無理しやすい日」と捉えてください。',
        points: [
          '帯域ラベル（軽め／普通／疲れ気味／無理しない日）は、下表のスコア範囲で決まります。',
          'スコアの数字は予定や睡眠記録を変えると細かく変わりますが、<strong>メッセージは帯域が変わったとき</strong>を中心に切り替わります。',
        ],
      },
      {
        heading: '3. 睡眠側（最大50点）',
        body: `目標睡眠時間は${fatigueScoringReference.targetSleepHours}時間です。直近${fatigueScoringReference.recentSleepDays}日平均は、睡眠記録パネルの「最近3日間の平均」と同じ集計期間です。`,
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
        heading: '5. メッセージ（ロン君の一言）の決め方',
        body: '表示される短文はランダムではなく、帯域と睡眠・予定のどちらが強いかで次のいずれかが選ばれます。',
        points: [
          '無理しない日：「予定を少なめに…」（今日／この日で文言が変わる）。',
          '疲れ気味・予定側が強い：「予定が詰まっています…」。',
          '疲れ気味・睡眠側が同程度以上：「睡眠が少し足りません…」。',
          '普通：「バランスは普通です…」。',
          '軽め：「コンディションは軽めです…」。',
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
    subtitle: 'Ron’s Schedule — explains the 0–100 score shown below the selected date.',
    saveLabel: 'Save / Print as PDF',
    closeLabel: 'Close',
    footer: () => `Created on: ${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}`,
    disclaimerTitle: 'Important: Not a medical assessment',
    disclaimerBody:
      'The fatigue score and messages are a <strong>planning and self-management guide</strong> based on your sleep records and schedule. They are not a diagnosis, treatment advice, medication guidance, or evaluation of sleep or mental health conditions. If you have health concerns, consult a qualified professional.',
    sections: [
      {
        heading: '1. Where it appears',
        body: 'On Home, directly under “Selected date”, you see “Today’s fatigue” or “This day’s fatigue” with a band label, score, and short message. Changing the calendar date recalculates for that day.',
        points: [
          '“Today” vs “This day” depends on whether the selected date is the current calendar day.',
          'The second line shows incomplete task count and sleep/schedule subscores (max 50 each).',
          'Only <strong>incomplete</strong> tasks count toward schedule load. Completing tasks lowers the schedule portion.',
        ],
      },
      {
        heading: '2. Score and bands',
        body: 'Sleep (max 50) + schedule (max 50) = total score (0–100). Higher scores suggest a busier or shorter-sleep day in app terms—not a clinical measure.',
        points: [
          'Band labels follow the table below.',
          'The numeric score updates as you edit data; the <strong>message mainly changes when the band changes</strong>.',
        ],
      },
      {
        heading: '3. Sleep portion (max 50)',
        body: `Target sleep is ${fatigueScoringReference.targetSleepHours} hours. The recent ${fatigueScoringReference.recentSleepDays}-day average uses the same window as the sleep panel summary.`,
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
        heading: '5. How the short message is chosen',
        body: 'Messages are fixed by band (not random):',
        points: [
          'Heavy band: take it easier today / this day.',
          'Tired + schedule-heavy: crowded schedule hint.',
          'Tired + sleep-heavy: short sleep hint.',
          'Normal: balanced day hint.',
          'Light: lighter load hint.',
        ],
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
