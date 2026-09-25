import { Capacitor } from '@capacitor/core'

/**
 * 端末のヘルスケア／歩数アプリを開いて「今日の歩数」を確認するためだけの導線。
 * 歩数の取得・保存・連携済みフラグは一切行わない。
 */
export const openDeviceStepsAppForCheck = () => {
  const platform = Capacitor.getPlatform()

  if (platform === 'ios') {
    // Apple ヘルスケア
    window.location.href = 'x-apple-health://'
    return
  }

  if (platform === 'android') {
    // Health Connect（無い場合は端末側のエラー表示）
    window.location.href =
      'intent://#Intent;scheme=android-app;package=com.google.android.apps.healthdata;end'
    return
  }

  window.alert(
    'スマホのヘルスケア／歩数アプリで今日の歩数を確認し、この入力欄に数字を入れて「記録」を押してください。\n（このボタンだけでは歩数は保存されません）',
  )
}
