/**
 * PWA / ブラウザ向け: 端末のヘルスケア／歩数アプリを開いて確認するだけの導線。
 * 歩数の取得・保存・連携済みフラグは一切行わない。
 * Capacitor ネイティブ API は使わない。
 *
 * Android（特にホーム画面のスタンドアロン PWA）では intent:// を
 * 同一ウィンドウや <a> で開くと本体が再読み込みされ、ダイアログに到達できない。
 * そのため Android は必ず確認ダイアログを先に出し、キャンセルなら即中止する。
 * 起動・ストアは window.open(..., '_blank') の https のみ使う。
 */

const IOS_HEALTH_URL = 'x-apple-health://'
const ANDROID_GOOGLE_FIT_STORE_URL =
  'https://play.google.com/store/apps/details?id=com.google.android.apps.fitness'

export const openDeviceStepsAppForCheck = () => {
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : ''
  const isIOS = /iPhone|iPad|iPod/i.test(ua)
  const isAndroid = /Android/i.test(ua)

  if (isIOS) {
    openByAnchor(IOS_HEALTH_URL)
    return
  }

  if (isAndroid) {
    openAndroidStepsGuide()
    return
  }

  window.alert(
    'スマホのヘルスケア／歩数アプリで今日の歩数を確認し、この入力欄に数字を入れて「記録」を押してください。\n'
    + '（このボタンだけでは歩数は保存されません）',
  )
}

const openByAnchor = (url) => {
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.rel = 'noopener noreferrer'
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
}

const openInNewTab = (url) => {
  const opened = window.open(url, '_blank', 'noopener,noreferrer')
  if (opened) return true
  // ポップアップブロック時は同一タブにせず、案内のみ（再起動防止）
  window.alert(
    'ページを開けませんでした。ポップアップがブロックされていないか確認するか、'
    + 'Play ストアで「Google Fit」または「Health Connect」を検索してください。',
  )
  return false
}

/**
 * Android PWA:
 * 1. 確認ダイアログ（キャンセル＝中止）
 * 2. OK なら Google Fit のストアページを新しいタブで開く
 *    （インストール済みならストアの「開く」から起動し、歩数を確認できる）
 *
 * intent:// は使わない（スタンドアロン PWA の再起動原因になるため）。
 */
const openAndroidStepsGuide = () => {
  const proceed = window.confirm(
    '歩数を確認するには、Google Fit または Health Connect が必要です。\n\n'
    + '優先: Google Fit\n'
    + '次点: Health Connect\n\n'
    + '「OK」で Google Fit のページを開きます。\n'
    + '（インストール済みの場合はストア画面の「開く」から起動し、今日の歩数を確認してください）\n\n'
    + '「キャンセル」で中止します。\n\n'
    + '※この操作だけでは歩数は保存されません。確認後、入力欄に入れて「記録」を押してください。',
  )
  if (!proceed) return

  openInNewTab(ANDROID_GOOGLE_FIT_STORE_URL)
}
