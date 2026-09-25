/**
 * PWA / ブラウザ向け: 端末のヘルスケア／歩数アプリを開いて確認するだけの導線。
 * 歩数の取得・保存・連携済みフラグは一切行わない。
 * Capacitor ネイティブ API は使わない。
 *
 * Android 注意:
 * - intent に S.browser_fallback_url で自サイトを指定すると、未インストール時に
 *   PWA が再読み込み（再起動に見える）され、確認ダイアログに到達できない。
 * - window.location への intent 代入もメイン文書を壊しやすいので使わない。
 */

const IOS_HEALTH_URL = 'x-apple-health://'
const ANDROID_GOOGLE_FIT_PACKAGE = 'com.google.android.apps.fitness'
const ANDROID_HEALTH_CONNECT_PACKAGE = 'com.google.android.apps.healthdata'
const ANDROID_GOOGLE_FIT_STORE_URL =
  'https://play.google.com/store/apps/details?id=com.google.android.apps.fitness'

const ANDROID_OPEN_TIMEOUT_MS = 1600

export const openDeviceStepsAppForCheck = () => {
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : ''
  const isIOS = /iPhone|iPad|iPod/i.test(ua)
  const isAndroid = /Android/i.test(ua)

  if (isIOS) {
    openByAnchor(IOS_HEALTH_URL)
    return
  }

  if (isAndroid) {
    openAndroidStepsAppWithFallback()
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

/** Play ストア自動遷移・自サイト再読込を避けるため fallback URL は付けない */
const androidAppIntent = (packageName) => (
  `intent://#Intent;scheme=android-app;package=${packageName};end`
)

/**
 * 優先: Google Fit → Health Connect。
 * ページが背面に回った（visible→hidden）＝起動成功とみなす。
 * どちらも起動できなければ確認ダイアログ（キャンセル＝中止）。
 */
const openAndroidStepsAppWithFallback = () => {
  const candidates = [
    ANDROID_GOOGLE_FIT_PACKAGE,
    ANDROID_HEALTH_CONNECT_PACKAGE,
  ]
  let index = 0
  let settled = false
  let timerId = 0

  const cleanup = () => {
    document.removeEventListener('visibilitychange', onVisibilityChange)
    if (timerId) window.clearTimeout(timerId)
  }

  const markOpened = () => {
    if (settled) return
    settled = true
    cleanup()
  }

  const onVisibilityChange = () => {
    if (document.visibilityState === 'hidden') markOpened()
  }

  const showInstallGuide = () => {
    if (settled) return
    settled = true
    cleanup()
    const openFitStore = window.confirm(
      '歩数を確認するには、Google Fit または Health Connect のインストールが必要です。\n\n'
      + '優先: Google Fit\n'
      + '次点: Health Connect\n\n'
      + '「OK」で Google Fit のインストールページを開きます。\n'
      + '「キャンセル」で中止します。\n\n'
      + '（この操作だけでは歩数は保存されません。確認後、入力欄に入れて「記録」してください）',
    )
    if (!openFitStore) return
    window.open(ANDROID_GOOGLE_FIT_STORE_URL, '_blank', 'noopener,noreferrer')
  }

  const tryOpenPackage = (packageName) => {
    // メイン文書を遷移させない（再起動防止）
    const anchor = document.createElement('a')
    anchor.href = androidAppIntent(packageName)
    anchor.rel = 'noopener noreferrer'
    anchor.style.display = 'none'
    document.body.appendChild(anchor)
    anchor.click()
    document.body.removeChild(anchor)
  }

  const tryNext = () => {
    if (settled) return
    if (index >= candidates.length) {
      if (document.visibilityState === 'visible') showInstallGuide()
      else cleanup()
      return
    }

    const packageName = candidates[index]
    index += 1
    try {
      tryOpenPackage(packageName)
    } catch (error) {
      console.warn('歩数アプリ起動に失敗:', packageName, error)
    }

    timerId = window.setTimeout(() => {
      if (settled) return
      if (document.visibilityState === 'hidden') {
        markOpened()
        return
      }
      tryNext()
    }, ANDROID_OPEN_TIMEOUT_MS)
  }

  document.addEventListener('visibilitychange', onVisibilityChange)
  tryNext()
}
