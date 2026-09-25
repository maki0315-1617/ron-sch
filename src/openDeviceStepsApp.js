/**
 * PWA / ブラウザ向け: 歩数確認の案内のみ。
 * 他アプリの自動起動・ストア自動遷移は行わない（PWA では起動が不安定なため）。
 * 歩数の取得・保存・連携済みフラグは一切行わない。
 */

export const openDeviceStepsAppForCheck = () => {
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : ''
  const isIOS = /iPhone|iPad|iPod/i.test(ua)
  const isAndroid = /Android/i.test(ua)

  let appName = 'ヘルスケア／歩数アプリ'
  if (isIOS) appName = 'ヘルスケア'
  if (isAndroid) appName = 'Google Fit（または端末の歩数アプリ）'

  window.alert(
    `【歩数の確認手順】\n\n`
    + `1. ホーム画面から「${appName}」を開く\n`
    + `2. 今日の歩数を確認する\n`
    + `3. このアプリに戻り、入力欄に数字を入れる\n`
    + `4.「記録」を押す\n\n`
    + `※「歩数を確認する」だけでは歩数は保存されません。\n`
    + `※必ず「今日」を選んだ状態で記録してください（別の日を開いていると、その日の記録になります）。`,
  )
}
