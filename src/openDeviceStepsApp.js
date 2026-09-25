/**
 * PWA / ブラウザ向け: 端末のヘルスケア／歩数アプリを開いて確認するだけの導線。
 * 歩数の取得・保存・連携済みフラグは一切行わない。
 * Capacitor ネイティブ API は使わない。
 *
 * Android（スタンドアロン PWA）:
 * - intent の S.browser_fallback_url に Play ストアを付けると、
 *   Fit が入っていても Chrome がストアを開く → 絶対に付けない
 * - 同一ウィンドウの intent / 自サイト fallback は再起動の原因 → 使わない
 * - window.open(..., '_blank') で Fit → Health Connect の起動のみ試す
 * - 起動できず画面が残った場合のみ確認ダイアログ（OK でストア、キャンセルで中止）
 */

const IOS_HEALTH_URL = 'x-apple-health://'
const ANDROID_GOOGLE_FIT_STORE_URL =
  'https://play.google.com/store/apps/details?id=com.google.android.apps.fitness'

const ANDROID_OPEN_TIMEOUT_MS = 2000

/** Play ストア誘導なし。インストール済みアプリ起動用 URL のみ（優先順） */
const ANDROID_LAUNCH_ATTEMPTS = [
  'android-app://com.google.android.apps.fitness',
  'intent:#Intent;action=android.intent.action.MAIN;category=android.intent.category.LAUNCHER;package=com.google.android.apps.fitness;end',
  'intent://#Intent;scheme=android-app;package=com.google.android.apps.fitness;end',
  'android-app://com.google.android.apps.healthdata',
  'intent:#Intent;action=android.intent.action.MAIN;category=android.intent.category.LAUNCHER;package=com.google.android.apps.healthdata;end',
]

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

const openAndroidStepsAppWithFallback = () => {
  let attemptIndex = 0
  let settled = false
  let timerId = 0
  let openedWindow = null

  const cleanup = () => {
    document.removeEventListener('visibilitychange', onVisibilityChange)
    window.removeEventListener('pagehide', onPageHide)
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

  const onPageHide = () => {
    markOpened()
  }

  const showInstallGuide = () => {
    if (settled) return
    settled = true
    cleanup()
    try {
      openedWindow?.close()
    } catch {
      // ignore
    }
    openedWindow = null

    const openFitStore = window.confirm(
      'Google Fit / Health Connect を起動できませんでした。\n\n'
      + '「OK」で Google Fit のストアページを開きます。\n'
      + 'インストール済みの場合は、ホーム画面から Google Fit を開いて歩数を確認してください。\n\n'
      + '「キャンセル」で中止します。\n\n'
      + '※この操作だけでは歩数は保存されません。確認後、入力欄に入れて「記録」してください。',
    )
    if (!openFitStore) return
    window.open(ANDROID_GOOGLE_FIT_STORE_URL, '_blank', 'noopener,noreferrer')
  }

  const tryOpenUrl = (url) => {
    try {
      openedWindow = window.open(url, '_blank', 'noopener,noreferrer')
    } catch (error) {
      console.warn('歩数アプリ起動に失敗:', url, error)
      openedWindow = null
    }
  }

  const tryNext = () => {
    if (settled) return
    if (attemptIndex >= ANDROID_LAUNCH_ATTEMPTS.length) {
      if (document.visibilityState === 'visible') showInstallGuide()
      else markOpened()
      return
    }

    const url = ANDROID_LAUNCH_ATTEMPTS[attemptIndex]
    attemptIndex += 1
    tryOpenUrl(url)

    timerId = window.setTimeout(() => {
      if (settled) return
      if (document.visibilityState === 'hidden') {
        markOpened()
        return
      }
      try {
        openedWindow?.close()
      } catch {
        // ignore
      }
      openedWindow = null
      tryNext()
    }, ANDROID_OPEN_TIMEOUT_MS)
  }

  document.addEventListener('visibilitychange', onVisibilityChange)
  window.addEventListener('pagehide', onPageHide)
  tryNext()
}
