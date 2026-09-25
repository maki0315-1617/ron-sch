/**
 * PWA / ブラウザ向け: 端末のヘルスケア／歩数アプリを開いて確認するだけの導線。
 * 歩数の取得・保存・連携済みフラグは一切行わない。
 * Capacitor ネイティブ API は使わない。
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

/**
 * Play ストアへ自動遷移させないよう、失敗時は同一ページへ戻す fallback を付ける。
 */
const androidAppIntent = (packageName) => {
  const stayHere = `${window.location.origin}${window.location.pathname}${window.location.search}#steps-app-fallback`
  const fallback = encodeURIComponent(stayHere)
  return `intent://#Intent;scheme=android-app;package=${packageName};S.browser_fallback_url=${fallback};end`
}

/**
 * 優先: Google Fit → Health Connect。
 * ページが背面に回った（visible→hidden）＝起動成功とみなす。
 * どちらも起動できなければ確認ダイアログ。キャンセルなら中止。
 */
const openAndroidStepsAppWithFallback = () => {
  const candidates = [
    ANDROID_GOOGLE_FIT_PACKAGE,
    ANDROID_HEALTH_CONNECT_PACKAGE,
  ]
  let index = 0
  let settled = false
  let timerId = 0
  let activeFrame = null

  const cleanup = () => {
    document.removeEventListener('visibilitychange', onVisibilityChange)
    if (timerId) window.clearTimeout(timerId)
    if (activeFrame && activeFrame.parentNode) {
      try {
        activeFrame.parentNode.removeChild(activeFrame)
      } catch {
        // ignore
      }
    }
    activeFrame = null
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
    const url = androidAppIntent(packageName)
    // メインページを Play ストアへ飛ばさないよう iframe で試行
    const iframe = document.createElement('iframe')
    iframe.setAttribute('aria-hidden', 'true')
    iframe.tabIndex = -1
    iframe.style.cssText = 'position:fixed;width:0;height:0;opacity:0;pointer-events:none;border:0;left:-9999px;top:0'
    iframe.src = url
    document.body.appendChild(iframe)
    activeFrame = iframe
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
      if (activeFrame && activeFrame.parentNode) {
        try {
          activeFrame.parentNode.removeChild(activeFrame)
        } catch {
          // ignore
        }
      }
      activeFrame = null
      tryNext()
    }, ANDROID_OPEN_TIMEOUT_MS)
  }

  document.addEventListener('visibilitychange', onVisibilityChange)
  tryNext()
}
