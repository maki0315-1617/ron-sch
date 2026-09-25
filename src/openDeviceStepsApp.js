/**
 * PWA / ブラウザ向け: 端末のヘルスケア／歩数アプリを開いて確認するだけの導線。
 * 歩数の取得・保存・連携済みフラグは一切行わない。
 * Capacitor ネイティブ API は使わない。
 *
 * Android（スタンドアロン PWA）:
 * - 同一ウィンドウでの intent / 自サイトへの fallback は再起動の原因 → 使わない
 * - window.open(..., '_blank') で起動を試し、未インストール時の fallback は Play ストア URL のみ
 * - インストール済みならアプリが前面に出る（ダイアログは出さない）
 * - 起動できず画面が残った場合のみ確認ダイアログ（キャンセル＝中止）
 */

const IOS_HEALTH_URL = 'x-apple-health://'
const ANDROID_GOOGLE_FIT_PACKAGE = 'com.google.android.apps.fitness'
const ANDROID_HEALTH_CONNECT_PACKAGE = 'com.google.android.apps.healthdata'
const ANDROID_GOOGLE_FIT_STORE_URL =
  'https://play.google.com/store/apps/details?id=com.google.android.apps.fitness'

const ANDROID_OPEN_TIMEOUT_MS = 2200

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

/**
 * インストール済み → アプリ起動
 * 未インストール → 新しいタブで Play ストア（自 PWA には戻さない）
 */
const androidLaunchOrStoreIntent = (packageName) => {
  const storeUrl = encodeURIComponent(
    `https://play.google.com/store/apps/details?id=${packageName}`,
  )
  return (
    'intent:#Intent;'
    + 'action=android.intent.action.MAIN;'
    + 'category=android.intent.category.LAUNCHER;'
    + `package=${packageName};`
    + `S.browser_fallback_url=${storeUrl};`
    + 'end'
  )
}

const openAndroidStepsAppWithFallback = () => {
  const candidates = [
    ANDROID_GOOGLE_FIT_PACKAGE,
    ANDROID_HEALTH_CONNECT_PACKAGE,
  ]
  let candidateIndex = 0
  let settled = false
  let timerId = 0

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
    // アプリ or ストアが前面に出ると hidden になる
    if (document.visibilityState === 'hidden') markOpened()
  }

  const onPageHide = () => {
    markOpened()
  }

  const showInstallGuide = () => {
    if (settled) return
    settled = true
    cleanup()

    const openFitStore = window.confirm(
      'Google Fit / Health Connect を起動できませんでした。\n\n'
      + '「OK」で Google Fit のストアページを開きます。\n'
      + 'インストール済みの場合は、ストアの「開く」またはホーム画面から Google Fit を起動し、歩数を確認してください。\n\n'
      + '「キャンセル」で中止します。\n\n'
      + '※この操作だけでは歩数は保存されません。確認後、入力欄に入れて「記録」してください。',
    )
    if (!openFitStore) return
    window.open(ANDROID_GOOGLE_FIT_STORE_URL, '_blank', 'noopener,noreferrer')
  }

  const tryOpenPackage = (packageName) => {
    const url = androidLaunchOrStoreIntent(packageName)
    // 本体を壊さないよう必ず新しいタブ／外部へ
    const win = window.open(url, '_blank', 'noopener,noreferrer')
    if (!win) {
      // ポップアップブロック時は次候補へ（最後にダイアログ）
      console.warn('歩数アプリの window.open がブロックされました:', packageName)
    }
  }

  const tryNext = () => {
    if (settled) return
    if (candidateIndex >= candidates.length) {
      // まだこの PWA が前面なら起動失敗とみなす
      if (document.visibilityState === 'visible') showInstallGuide()
      else markOpened()
      return
    }

    const packageName = candidates[candidateIndex]
    candidateIndex += 1
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
  window.addEventListener('pagehide', onPageHide)
  tryNext()
}
