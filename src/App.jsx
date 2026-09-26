import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Capacitor } from '@capacitor/core'
import { auth, db, deleteFcmToken, getFcmToken, subscribeForegroundNotifications } from './firebase'
import {
  EmailAuthProvider,
  createUserWithEmailAndPassword,
  deleteUser,
  onAuthStateChanged,
  reauthenticateWithCredential,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signOut,
} from 'firebase/auth'
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  setDoc,
  deleteField,
  serverTimestamp,
  updateDoc,
  writeBatch,
  where,
} from 'firebase/firestore'
import { AlertTriangle, ArrowUp, Bell, BellOff, CalendarDays, ChartColumn, Check, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, ClipboardList, Clock3, Copy, FileText, HelpCircle, Home, Link2, LogOut, Mail, Menu, MoreHorizontal, PencilLine, Plus, Repeat2, Search, Settings, Trash2, TrendingUp, UserX, X } from 'lucide-react'
import { addDays, formatDateKey, getSleepAdviceLevel, getSleepDurationMinutes, parseTimeValue } from './dateSleepUtils'
import {
  DEFAULT_MEDICATION_TIMES,
  MEDICATION_SLOT_KEYS,
  MEDICATION_SLOT_LABELS,
  createEmptyMedicationSlots,
  getMedicationSlotAlert,
  normalizeMedicationRecordSlots,
  normalizeMedicationSettings,
} from './medicationUtils'
import { computeFatigueScore, fatigueBandColors } from './fatigueScore'
import { buildFatigueGuideHtml } from './fatigueGuideDocument'
import { buildHealthLifeCountPresentation } from './dayFooterPresentation'
import { getStepsDisplayState, STEPS_LINKED_STORAGE_KEY } from './stepsDisplay'
import { formatJstIsoTimestamp, getStepsForDisplay, getStepsForScoring } from './stepsCsv'
import { clearStepsCsvWebOnly, importStepsCsvText, loadStepsByDate, upsertStepsCsvRow } from './stepsCsvStore'
import { openDeviceStepsAppForCheck } from './openDeviceStepsApp'
import {
  buildScheduleRelationTimeChangeConfirm,
  filterTimedSchedules,
  filterTopLevelDayItems,
  findChildTasksForParent,
  findParentScheduleItem,
  findRelatedScheduleItem,
  findPriorScheduleBlockingComplete,
  findDependentScheduleItem,
  formatChildTaskParentLabel,
  formatScheduleTimeRange,
  formatScheduleRelationLine,
  isScheduleChildTask,
  isScheduleTask,
  isRelatablePreviousSchedule,
  normalizeScheduleItem,
  pickSameDayRecommendedPrevious,
  resolveRelationItemId,
  scheduleRelationPointsToItem,
  scheduleItemHasOrderRelation,
  scheduleItemRelationsValidAt,
  sortDayScheduleItems,
} from './scheduleItemUtils'

const dayNames = ['日', '月', '火', '水', '木', '金', '土']

const HELP_SITE_URL = 'https://ron-home-app.vercel.app/'
/** お問い合わせはトップページ内セクション（id=contact）。/contact ルートは無い */
const CONTACT_FORM_URL = 'https://ron-home-app.vercel.app/'
const SUBSCRIPTION_CANCEL_CONTACT_TYPE = 'subscription_cancel'
const HELP_MAIL_ADDRESS = 'ronron201907@gmail.com'
const SLEEP_SHORTCUT_URL = 'https://www.icloud.com/shortcuts/829d308f0a34444fbf032d3d0b5f467c'
const APP_DISPLAY_NAME = 'ロンスケ＋ジュール'
const APP_DISPLAY_NAME_EN = 'Ron Sche+dule'

const buildSubscriptionCancelContactUrl = (email) => {
  const url = new URL(CONTACT_FORM_URL)
  url.searchParams.set('type', SUBSCRIPTION_CANCEL_CONTACT_TYPE)
  if (email) url.searchParams.set('email', email)
  url.hash = 'contact'
  return url.toString()
}

const helpContent = {
  ja: {
    langLabel: '日本語',
    title: 'ヘルプ',
    appInfo: `${APP_DISPLAY_NAME}　Ver1.00`,
    siteLabel: 'ロンAIシステムズ',
    mailLabel: 'お問い合わせメール',
    note: 'なお、誹謗中傷のメールはご遠慮願います。',
    close: '閉じる',
    guideButton: '利用ガイドPDFを開く',
    fatigueGuideButton: '「疲れ」判定の説明PDFを開く',
    fatigueDisclaimer: '「疲れ」のスコアとメッセージは、睡眠記録と予定から算出した生活・予定管理の目安です。医療上の診断・治療・服薬判断の代わりにはなりません。',
    prButton: 'アプリ紹介・PRスライドPDFをダウンロード',
    shortcutButton: 'iPhone用「睡眠記録」ショートカットを取得',
    about: `『${APP_DISPLAY_NAME}』は、日々の予定管理を簡単にし、達成感と継続を支えるためのアプリです。`,
    summary: '予定の登録から通知、進捗確認まで、日々の生活に沿った使い方をサポートします。',
  },
  en: {
    langLabel: 'English',
    title: 'Help',
    appInfo: `${APP_DISPLAY_NAME_EN} Ver1.00`,
    siteLabel: "Black Cat Ron-kun's AI Verification Hub",
    mailLabel: 'Contact Email',
    note: 'Please avoid sending abusive or defamatory emails.',
    close: 'Close',
    guideButton: 'Open User Guide (PDF)',
    fatigueGuideButton: 'Open fatigue score guide (PDF)',
    fatigueDisclaimer: 'The fatigue score is a planning guide from sleep and schedule data. It is not medical diagnosis, treatment, or medication advice.',
    prButton: 'Download App Introduction / PR Slides',
    shortcutButton: 'Get the “Sleep Records” Shortcut for iPhone',
    about: `${APP_DISPLAY_NAME_EN} is a simple planning app designed to make daily scheduling easier and help you stay consistent over time.`,
    summary: 'From adding tasks to checking progress and managing reminders, it supports a smoother daily routine.',
  },
}

const MAX_COMMON_TITLES = 20
const WEEK_CALENDAR_FIXED_KEY = 'ron-sch-week-calendar-fixed'
const WEEK_START_DAY_KEY = 'ron-sch-week-start-day'
const MONTH_CALENDAR_ENABLED_KEY = 'ron-sch-month-calendar-enabled'
const WEEK_CALENDAR_ENABLED_KEY = 'ron-sch-week-calendar-enabled'
const SLEEP_RECORD_ENABLED_KEY = 'ron-sch-sleep-record-enabled'
const MEDICATION_RECORD_ENABLED_KEY = 'ron-sch-medication-record-enabled'
const HEALTH_LIFE_COUNT_ENABLED_KEY = 'ron-sch-health-life-count-enabled'
const DEMO_NOTICE_SEEN_KEY = 'ron-sch-demo-notice-seen'
const DEMO_MAX_PER_DAY = 5
const DEMO_MAX_TOTAL = 20
const SUBSCRIPTION_ACTIVE_STATUS = 'active'

const isSleepShortcutLaunch = () => {
  if (typeof window === 'undefined') return false
  return new URLSearchParams(window.location.search).get('sleep') === '1'
}

const demoNoticeStorageKey = (uid) => `${DEMO_NOTICE_SEEN_KEY}:${uid || 'anon'}`

/**
 * 本番: subscriptions に email 一致かつ status === "active" が1件以上
 * デモ: 該当なし
 * クエリ失敗: 本番扱い（安全側）
 * @returns {Promise<boolean>} true = 本番購読者
 */
const resolveIsProductionSubscriber = async (user) => {
  if (!user?.email || !db) return true
  try {
    const snapshot = await getDocs(query(
      collection(db, 'subscriptions'),
      where('email', '==', user.email),
      where('status', '==', SUBSCRIPTION_ACTIVE_STATUS),
    ))
    return !snapshot.empty
  } catch (error) {
    console.warn('subscriptions 照会に失敗したため本番扱いとします:', error)
    return true
  }
}

const DEMO_LIMIT_REACHED_MSG = (
  `デモ版ではスケジュールを1日${DEMO_MAX_PER_DAY}件・全体${DEMO_MAX_TOTAL}件まで登録できます。上限に達したため追加できません。`
)

const formatCurrentTime = () => {
  const now = new Date()
  return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
}

const sleepAdviceByLevel = {
  short: {
    emoji: '😴',
    messages: ['ロン君からのお知らせです。今日は無理をせず、予定の合間にひと休みしてくださいね。', 'ロン君です。集中する時間を短く区切って、ゆっくり進めましょう。', 'ロン君も心配しています。水分をとって、できる範囲で始めましょう。', '今日は頑張りすぎない日です。ロン君と一緒に、予定を少なめにして過ごしましょう。', '眠気が強いときは安全を優先してくださいね。ロン君との約束です。', 'ロン君から提案です。今夜はいつもより早めにお布団へ向かいましょう。'],
  },
  moderate: {
    emoji: '🌤️',
    messages: ['ロン君です。少し短めなので、今夜はいつもより早めに休みましょう。', '昼間に軽く体を動かすとよさそうです。ロン君も応援しています。', '午後の予定は詰め込みすぎず、余白を残していきましょう。', 'ロン君からひとこと。眠る前は画面を少し早めにお休みさせましょう。', '今日は大事な予定から少しずつ。ロン君と無理のないペースで進めましょう。', '明日の元気は今夜からです。ロン君と一緒に休む準備を始めましょう。'],
  },
  good: {
    emoji: '😊',
    messages: ['ロン君も安心しています。ちょうどよい睡眠なので、今日も無理なくいきましょう。', 'しっかり休めています。ロン君と一緒に大切な予定から取り組みましょう。', 'よい調子です。朝の光を浴びて、ロン君と一日を始めましょう。', 'ロン君から合格サインです。休憩も忘れず、気持ちよく過ごしましょう。', 'よく眠れましたね。ロン君も嬉しいです。今日のペースを大切にしましょう。', '睡眠のリズムが整っています。ロン君と今日の予定を一つずつ進めましょう。'],
  },
  long: {
    emoji: '🛌',
    messages: ['ロン君です。長めに休めています。体調を確認しながら過ごしましょう。', 'よく眠れていますね。ロン君と一緒に生活リズムも意識してみましょう。', '十分な休息です。ロン君も安心しています。気持ちよく始めましょう。', 'ロン君から元気をお届けします。今日は朝の光を浴びて活動しましょう。', 'しっかり休めています。ロン君と、昼寝は短めにして夜へつなげましょう。', 'たくさん眠れましたね。ロン君と体調を確認しながら、ゆったり過ごしましょう。'],
  },
}

const isTimeOverlap = (time1, endTime1, time2, endTime2) => {
  const start1 = parseTimeValue(time1)
  const end1 = parseTimeValue(endTime1)
  const start2 = parseTimeValue(time2)
  const end2 = parseTimeValue(endTime2)
  return start1 < end2 && start2 < end1
}

// 開始時刻までの残り分数から緊急度を判定（5分前=critical, 15分前=warning）
const getScheduleUrgency = (item, nowMs) => {
  if (item.completed || !item.date || isScheduleTask(item)) return 'none'
  const startAt = new Date(`${item.date}T${item.time || '09:00'}:00`)
  if (Number.isNaN(startAt.getTime())) return 'none'
  const minutesUntilStart = (startAt.getTime() - nowMs) / 60000
  if (minutesUntilStart < 0 || minutesUntilStart > 15) return 'none'
  if (minutesUntilStart <= 5) return 'critical'
  return 'warning'
}

const toScheduleRelation = (item) => ({
  id: item.id,
  date: item.date,
  title: item.title || '予定',
  time: item.time || '09:00',
  endTime: item.endTime || '10:00',
})

const isSameScheduleRelation = (a, b) => {
  return Boolean(a && b && a.id === b.id && a.date === b.date)
}

const relationKeyFromItem = (item) => `${item.date}_${item.id}`

const INCOMPLETE_PREVIOUS_SCHEDULE_MSG = '先に終わらせるスケジュールが完了していません'

const TASK_CONVERT_REQUIRES_UNLINK_MSG = '順番の指定を解除してから、タスクに変更してください。'

const TASK_CONVERT_DELETES_CHILDREN_MSG = (count) => (
  `この予定をタスクに変更すると、配下のタスク${count}件が削除されます。よろしいですか？`
)

const SCHEDULE_DELETE_REQUIRES_UNLINK_MSG = '関連する順番指定があるため、予定を削除できません。関連を解除してから削除してください。'

const SCHEDULE_DELETE_HAS_CHILDREN_MSG = '配下のタスクがあるため、予定を削除できません。配下タスクを削除してから削除してください。'

const COMPLETED_SCHEDULE_NOT_EDITABLE_MSG = '完了済みのため、編集できません。'

const CHILD_COMPLETE_LOCKED_BY_PARENT_MSG = '親の予定が完了済みのため、配下タスクの完了状態は変更できません。'

const MOVE_WITH_RELATION_CONFIRM_MSG = '関連付けがある予定を別の日へ移動します。移動先の日付（関連が同日の場合は時刻）が順番と矛盾する場合は、関連付けのみ自動で解除され、予定自体は移動されます。よろしいですか？'

const MOVE_RELATION_STRIPPED_NOTICE = '移動先の日付・時刻と関連の順番が矛盾したため、関連付けを解除して移動しました。'

const FUTURE_FOUR_WEEKS_COPY_DONE_MSG = (count) => `未来4週間に${count}件の予定をコピーしました。`

const INVALID_TIME_RANGE_MSG = '開始時間と終了時間に矛盾があります。終了時間は開始時間より後に設定してください。'

/** type=time の値（秒付き含む）を HH:mm に正規化 */
const normalizeScheduleTimeInput = (value, fallback = '09:00') => {
  const raw = String(value ?? '').trim()
  if (!raw) return fallback
  const parts = raw.split(':')
  const hours = Number(parts[0])
  const minutes = Number(parts[1])
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return fallback
  const h = Math.min(23, Math.max(0, Math.trunc(hours)))
  const m = Math.min(59, Math.max(0, Math.trunc(minutes)))
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

const isValidTimeRange = (startTime, endTime) => {
  const start = normalizeScheduleTimeInput(startTime, '')
  const end = normalizeScheduleTimeInput(endTime, '')
  if (!start || !end) return false
  return parseTimeValue(start) < parseTimeValue(end)
}

const getMonthCalendarDays = (monthDate) => {
  const firstDay = new Date(monthDate.getFullYear(), monthDate.getMonth(), 1)
  const lastDay = new Date(monthDate.getFullYear(), monthDate.getMonth() + 1, 0)
  const leadingDays = firstDay.getDay()
  const daysInMonth = lastDay.getDate()
  const calendarDays = Array.from({ length: leadingDays + daysInMonth }, (_, index) => {
    if (index < leadingDays) return null
    return new Date(monthDate.getFullYear(), monthDate.getMonth(), index - leadingDays + 1)
  })

  while (calendarDays.length % 7 !== 0) calendarDays.push(null)
  return calendarDays
}

const getWeekStart = (date, weekStartDay = 1) => {
  const base = new Date(date)
  base.setHours(0, 0, 0, 0)
  const day = base.getDay()
  const diff = (day - weekStartDay + 7) % 7
  base.setDate(base.getDate() - diff)
  return base
}

// 週の開始曜日設定に合わせて、月初の週から月末の週までを実日付（前後月含む）で埋めた行の配列を返す
const getMonthGridWeeks = (monthDate, weekStartDay = 1) => {
  const firstDay = new Date(monthDate.getFullYear(), monthDate.getMonth(), 1)
  const lastDay = new Date(monthDate.getFullYear(), monthDate.getMonth() + 1, 0)
  const gridStart = getWeekStart(firstDay, weekStartDay)
  const weeks = []
  let cursor = gridStart
  while (cursor <= lastDay) {
    weeks.push(Array.from({ length: 7 }, (_, index) => addDays(cursor, index)))
    cursor = addDays(cursor, 7)
  }
  return weeks
}

const formatWeekTitle = (date) =>
  new Intl.DateTimeFormat('ja-JP', { year: 'numeric', month: 'long', day: 'numeric' }).format(date)

const formatMonthTitle = (date) =>
  new Intl.DateTimeFormat('ja-JP', { year: 'numeric', month: 'long' }).format(date)

const formatDisplayDate = (date) =>
  new Intl.DateTimeFormat('ja-JP', { year: 'numeric', month: 'long', day: 'numeric' }).format(date)

const parseHolidayCsv = (csvText) => {
  const holidays = {}
  csvText.replace(/^\uFEFF/, '').split(/\r?\n/).slice(1).forEach((line) => {
    const match = line.match(/^"(\d{4}-\d{2}-\d{2})","(.*)"$/)
    if (match) holidays[match[1]] = match[2]
  })
  return holidays
}

const escapeHtml = (value = '') => String(value)
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#039;')

const escapeCsvField = (value) => {
  const text = String(value ?? '')
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
}

const loadPublicImageAsDataUrl = async (path, removeLightBackground = false) => {
  const response = await fetch(path)
  if (!response.ok) throw new Error(`画像を読み込めませんでした: ${path}`)
  const buffer = await response.arrayBuffer()
  if (removeLightBackground) {
    const blob = new Blob([buffer], { type: 'image/png' })
    const image = await createImageBitmap(blob)
    const canvas = document.createElement('canvas')
    canvas.width = image.width
    canvas.height = image.height
    const context = canvas.getContext('2d')
    context.drawImage(image, 0, 0)
    const imageData = context.getImageData(0, 0, image.width, image.height)
    for (let offset = 0; offset < imageData.data.length; offset += 4) {
      const red = imageData.data[offset]
      const green = imageData.data[offset + 1]
      const blue = imageData.data[offset + 2]
      const lightness = Math.min(red, green, blue)
      if (lightness >= 238) imageData.data[offset + 3] = 0
      else if (lightness >= 220) imageData.data[offset + 3] = Math.round((238 - lightness) / 18 * 255)
    }
    context.putImageData(imageData, 0, 0)
    image.close()
    return canvas.toDataURL('image/png')
  }
  const bytes = new Uint8Array(buffer)
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000))
  }
  return `data:image/png;base64,${btoa(binary)}`
}

const AGGREGATION_MAX_DAYS = 31

const notificationTokenKey = (userId) => `ron-sch-fcm-token:${userId}`
const FCM_SW_SCOPE = '/firebase-cloud-messaging-push-scope'

const buildPushNotificationTag = (payload) => {
  const data = payload?.data || {}
  const base = data.scheduleItemId && data.date && data.time
    ? `${data.scheduleItemId}-${data.date}-${data.time}`
    : `${data.date || 'd'}-${data.time || 't'}`
  const bodyKey = data.body ? String(data.body).slice(0, 48) : 'body'
  return `ron-sch-${base}-${bodyKey}`.slice(0, 200)
}

const supportsPwaWebPush = () => {
  if (typeof window === 'undefined') return false
  if (Capacitor.isNativePlatform()) return false
  return 'Notification' in window && 'serviceWorker' in navigator
}

const getMessagingServiceWorkerRegistration = async () => {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return null
  return navigator.serviceWorker.getRegistration(FCM_SW_SCOPE)
}

const postMessageToMessagingWorker = async (message) => {
  if (!supportsPwaWebPush()) return false

  let registration = await getMessagingServiceWorkerRegistration()
  if (!registration) {
    registration = await navigator.serviceWorker.register('/firebase-messaging-sw.js', {
      scope: FCM_SW_SCOPE,
    })
  }

  const worker = registration.active || registration.installing || registration.waiting
  if (!worker) return false

  worker.postMessage(message)
  return true
}

const waitForMessagingServiceWorkerActive = (registration, timeoutMs = 15000) => {
  if (registration.active) return Promise.resolve(registration.active)

  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => {
      reject(new Error('FCM Service Worker の起動がタイムアウトしました。'))
    }, timeoutMs)

    const finish = () => {
      window.clearTimeout(timer)
      if (registration.active) {
        resolve(registration.active)
        return
      }
      reject(new Error('FCM Service Worker を起動できませんでした。'))
    }

    const worker = registration.installing || registration.waiting
    if (!worker) {
      finish()
      return
    }

    worker.addEventListener('statechange', () => {
      if (worker.state === 'activated' || registration.active) {
        finish()
      }
    })

    if (worker.state === 'activated' || registration.active) {
      finish()
    }
  })
}

const isIosDevice = () => typeof navigator !== 'undefined' && /iPad|iPhone|iPod/.test(navigator.userAgent)

const isStandaloneDisplay = () => {
  if (typeof window === 'undefined') return false
  return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true
}

const requiresHomeScreenForNotifications = () => isIosDevice() && !isStandaloneDisplay()

const withTimeout = (promise, ms, message) => {
  let timerId = null
  const timeout = new Promise((_, reject) => {
    timerId = window.setTimeout(() => {
      reject(new Error(message))
    }, ms)
  })

  return Promise.race([promise, timeout]).finally(() => {
    if (timerId !== null) {
      window.clearTimeout(timerId)
    }
  })
}

function App() {
  const [session, setSession] = useState(null)
  const [authMode, setAuthMode] = useState('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [authError, setAuthError] = useState('')
  const [selectedDate, setSelectedDate] = useState(new Date())
  const [scheduleMap, setScheduleMap] = useState({})
  const [holidayMap, setHolidayMap] = useState({})
  const [sleepRecord, setSleepRecord] = useState(null)
  const [previousSleepRecord, setPreviousSleepRecord] = useState(null)
  const [sleepRecordMap, setSleepRecordMap] = useState({})
  const [sleepSaving, setSleepSaving] = useState(false)
  const [sleepSaveMessage, setSleepSaveMessage] = useState('')
  const [loading, setLoading] = useState(false)
  const [schedulePreview, setSchedulePreview] = useState(null)
  const [detailDraft, setDetailDraft] = useState(null)
  const [moveCopyDialog, setMoveCopyDialog] = useState(null)
  const [moveCopyCalendarOpen, setMoveCopyCalendarOpen] = useState(false)
  const [moveCopyCalendarMonth, setMoveCopyCalendarMonth] = useState(null)
  const [scheduleSearchQuery, setScheduleSearchQuery] = useState('')
  const [savingDraft, setSavingDraft] = useState(false)
  const [commonTitles, setCommonTitles] = useState([])
  const [commonTitlesExpanded, setCommonTitlesExpanded] = useState(false)
  const [showDoubleTapHint, setShowDoubleTapHint] = useState(false)
  const [doubleTapHintFading, setDoubleTapHintFading] = useState(false)
  const [hintMessageIndex, setHintMessageIndex] = useState(0)
  const [initialScheduleReady, setInitialScheduleReady] = useState(false)
  const doubleTapHintShownRef = useRef(false)
  const [saveAsCommonTitle, setSaveAsCommonTitle] = useState(false)
  const [relationDialog, setRelationDialog] = useState(null)
  const [scheduleActionNotice, setScheduleActionNotice] = useState(null)
  const scheduleRelationTimeConfirmRef = useRef(null)
  const [scheduleRelationTimeConfirm, setScheduleRelationTimeConfirm] = useState(null)
  const scheduleAppConfirmRef = useRef(null)
  const [scheduleAppConfirm, setScheduleAppConfirm] = useState(null)
  const [relatedChainModal, setRelatedChainModal] = useState({ open: false, loading: false, items: [] })
  const [nowTick, setNowTick] = useState(() => Date.now())
  const [notificationEnabled, setNotificationEnabled] = useState(false)
  const [notificationPermission, setNotificationPermission] = useState(
    typeof window !== 'undefined' && 'Notification' in window ? Notification.permission : 'unsupported'
  )
  const [notificationBusy, setNotificationBusy] = useState(false)
  const [notificationHelpOpen, setNotificationHelpOpen] = useState(false)
  const [notificationBadgeCount, setNotificationBadgeCount] = useState(0)
  const [menuOpen, setMenuOpen] = useState(false)
  const [settingsMenuOpen, setSettingsMenuOpen] = useState(false)
  const [deleteAccountModalOpen, setDeleteAccountModalOpen] = useState(false)
  const [subscriptionCancelModalOpen, setSubscriptionCancelModalOpen] = useState(false)
  const [deletePassword, setDeletePassword] = useState('')
  const [deletingAccount, setDeletingAccount] = useState(false)
  const [deleteAccountError, setDeleteAccountError] = useState('')
  const [helpOpen, setHelpOpen] = useState(false)
  const [helpLang, setHelpLang] = useState('ja')
  const [weekCalendarFixed, setWeekCalendarFixed] = useState(() => {
    return typeof window !== 'undefined' && window.localStorage.getItem(WEEK_CALENDAR_FIXED_KEY) === 'true'
  })
  const [weekStartDay, setWeekStartDay] = useState(() => {
    const storedValue = typeof window !== 'undefined' ? Number(window.localStorage.getItem(WEEK_START_DAY_KEY)) : 1
    return Number.isInteger(storedValue) && storedValue >= 0 && storedValue <= 6 ? storedValue : 1
  })
  const [monthCalendarEnabled, setMonthCalendarEnabled] = useState(() => {
    return typeof window === 'undefined' || window.localStorage.getItem(MONTH_CALENDAR_ENABLED_KEY) !== 'false'
  })
  const [weekCalendarEnabled, setWeekCalendarEnabled] = useState(() => {
    return typeof window === 'undefined' || window.localStorage.getItem(WEEK_CALENDAR_ENABLED_KEY) !== 'false'
  })
  const [monthCalendarCollapsed, setMonthCalendarCollapsed] = useState(false)
  const [sleepRecordEnabled, setSleepRecordEnabled] = useState(() => {
    return isSleepShortcutLaunch() || typeof window === 'undefined' || window.localStorage.getItem(SLEEP_RECORD_ENABLED_KEY) !== 'false'
  })
  const [sleepRecordCollapsed, setSleepRecordCollapsed] = useState(false)
  const [medicationRecordEnabled, setMedicationRecordEnabled] = useState(() => {
    return typeof window === 'undefined' || window.localStorage.getItem(MEDICATION_RECORD_ENABLED_KEY) !== 'false'
  })
  const [medicationRecordCollapsed, setMedicationRecordCollapsed] = useState(false)
  const [medicationSettings, setMedicationSettings] = useState(() => normalizeMedicationSettings())
  const [medicationSettingsDraft, setMedicationSettingsDraft] = useState(() => normalizeMedicationSettings())
  const [medicationRecord, setMedicationRecord] = useState(() => ({
    slots: createEmptyMedicationSlots(),
    exists: false,
  }))
  const [medicationRecordMap, setMedicationRecordMap] = useState({})
  const [medicationSaving, setMedicationSaving] = useState(false)
  const [medicationSaveMessage, setMedicationSaveMessage] = useState('')
  const [healthLifeCountEnabled, setHealthLifeCountEnabled] = useState(() => {
    return typeof window !== 'undefined' && window.localStorage.getItem(HEALTH_LIFE_COUNT_ENABLED_KEY) === 'true'
  })
  const [healthLifeCountCollapsed, setHealthLifeCountCollapsed] = useState(false)
  const [stepsByDate, setStepsByDate] = useState(null)
  const [stepManualDraft, setStepManualDraft] = useState('')
  const [stepsCsvBusy, setStepsCsvBusy] = useState(false)
  const stepsCsvFileInputRef = useRef(null)
  const [view, setView] = useState('home')
  const [incompleteItems, setIncompleteItems] = useState([])
  const [incompleteLoading, setIncompleteLoading] = useState(false)
  const [aggregationOpen, setAggregationOpen] = useState(false)
  const [aggStartDate, setAggStartDate] = useState('')
  const [aggEndDate, setAggEndDate] = useState('')
  const [aggFilter, setAggFilter] = useState('all')
  const [aggError, setAggError] = useState('')
  const [aggResult, setAggResult] = useState(null)
  const menuRef = useRef(null)
  const holdTimerRef = useRef(null)
  const lastCardTapRef = useRef({ id: null, time: 0 })
  const scheduleDragRef = useRef(null)
  const scheduleDragMovedRef = useRef(false)
  const scheduleScrollLockRef = useRef(null)
  const [scheduleDrag, setScheduleDrag] = useState(null)
  const notificationRegistrationRef = useRef(null)
  const notificationToggleLockRef = useRef(false)
  const lastForegroundPushRef = useRef({ tag: '', at: 0 })
  const weekSwipeRef = useRef(null)
  const weekTouchRef = useRef(null)
  const daySwipeRef = useRef(null)
  const dayTouchRef = useRef(null)
  const loadedWeeksRef = useRef(new Set())
  const mainRef = useRef(null)
  const scheduleSectionRef = useRef(null)
  const selectedKey = formatDateKey(selectedDate)
  const sleepOnlyMode = isSleepShortcutLaunch()
  // 判定前・失敗時は本番扱い（デモ制限をかけない）
  const [demoMode, setDemoMode] = useState(false)
  const [demoWelcomeOpen, setDemoWelcomeOpen] = useState(false)

  const scrollToTop = () => {
    window.scrollTo({ top: 0, behavior: 'smooth' })
    if (typeof document !== 'undefined') {
      if (document.documentElement) {
        document.documentElement.scrollTo({ top: 0, behavior: 'smooth' })
      }
      if (document.body) {
        document.body.scrollTo({ top: 0, behavior: 'smooth' })
      }
      const scrollableElements = document.querySelectorAll('main, section, div')
      scrollableElements.forEach((el) => {
        if (el.scrollTop > 0) {
          el.scrollTo({ top: 0, behavior: 'smooth' })
        }
      })
    }
    if (mainRef.current) {
      mainRef.current.scrollTo({ top: 0, behavior: 'smooth' })
    }
    if (scheduleSectionRef.current) {
      scheduleSectionRef.current.scrollTo({ top: 0, behavior: 'smooth' })
    }
    // スマホでピンチズームされていた場合に画面サイズを初期表示幅へ戻す
    if (typeof document !== 'undefined') {
      const viewportMeta = document.querySelector('meta[name="viewport"]')
      if (viewportMeta) {
        const originalContent = viewportMeta.getAttribute('content')
        viewportMeta.setAttribute('content', 'width=device-width, initial-scale=1.0, maximum-scale=1.0')
        requestAnimationFrame(() => {
          viewportMeta.setAttribute('content', originalContent)
        })
      }
    }
  }

  useEffect(() => {
    // 予定の緊急度（15分前/5分前）表示を更新するための定期チェック
    const interval = setInterval(() => setNowTick(Date.now()), 15000)
    return () => clearInterval(interval)
  }, [])

  useEffect(() => () => {
    // アンマウント時にスクロールロックが残らないようにする
    if (holdTimerRef.current) {
      clearTimeout(holdTimerRef.current)
      holdTimerRef.current = null
    }
    const lock = scheduleScrollLockRef.current
    if (!lock || typeof document === 'undefined') return
    document.documentElement.classList.remove('schedule-card-reorder-active')
    document.body.style.overflow = lock.bodyOverflow
    document.documentElement.style.overflow = lock.htmlOverflow
    document.removeEventListener('touchmove', lock.preventTouchMove)
    scheduleScrollLockRef.current = null
    scheduleDragRef.current = null
  }, [])

  useEffect(() => {
    if (!auth) return
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setSession(user)
    })
    return () => unsubscribe()
  }, [])

  useEffect(() => {
    let cancelled = false
    if (!session) {
      setDemoMode(false)
      setDemoWelcomeOpen(false)
      return undefined
    }

    // 切り替え直後は一旦本番扱いし、結果がデモのときだけ制限を適用
    setDemoMode(false)
    setDemoWelcomeOpen(false)

    ;(async () => {
      const isProduction = await resolveIsProductionSubscriber(session)
      if (cancelled) return
      const nextDemoMode = !isProduction
      setDemoMode(nextDemoMode)
      if (!nextDemoMode) {
        setDemoWelcomeOpen(false)
        return
      }
      try {
        if (window.sessionStorage.getItem(demoNoticeStorageKey(session.uid)) === '1') {
          setDemoWelcomeOpen(false)
          return
        }
      } catch {
        // ignore
      }
      setDemoWelcomeOpen(true)
    })()

    return () => {
      cancelled = true
    }
  }, [session?.uid, session?.email])

  const dismissDemoWelcome = () => {
    try {
      if (session?.uid) {
        window.sessionStorage.setItem(demoNoticeStorageKey(session.uid), '1')
      }
    } catch {
      // ignore
    }
    setDemoWelcomeOpen(false)
  }

  const countScheduleItemsFromMap = () => {
    let total = 0
    const byDate = {}
    Object.entries(scheduleMap || {}).forEach(([dateKey, list]) => {
      const count = (list || []).length
      total += count
      byDate[dateKey] = (byDate[dateKey] || 0) + count
    })
    return { total, byDate }
  }

  const countScheduleItemsFromFirestore = async () => {
    if (!session) return countScheduleItemsFromMap()
    try {
      const snapshot = await getDocs(query(
        collection(db, 'schedule_items'),
        where('user_id', '==', session.uid),
      ))
      let total = 0
      const byDate = {}
      snapshot.forEach((docSnap) => {
        const dateKey = docSnap.data()?.date
        if (!dateKey) return
        total += 1
        byDate[dateKey] = (byDate[dateKey] || 0) + 1
      })
      return { total, byDate }
    } catch (error) {
      console.warn('デモ件数の取得に失敗したため、表示中データを使います:', error)
      return countScheduleItemsFromMap()
    }
  }

  /** @param {{ dateKey: string, count: number }[]} creates */
  const ensureDemoCanCreateScheduleItems = async (creates) => {
    if (!demoMode || !session) return true
    const additions = (creates || []).filter((entry) => entry?.dateKey && entry.count > 0)
    if (additions.length === 0) return true

    const addTotal = additions.reduce((sum, entry) => sum + entry.count, 0)
    const { total, byDate } = await countScheduleItemsFromFirestore()

    if (total + addTotal > DEMO_MAX_TOTAL) {
      await askScheduleAppConfirm(DEMO_LIMIT_REACHED_MSG, {
        title: 'デモ版の登録上限',
        confirmLabel: 'OK',
        hideCancel: true,
      })
      return false
    }

    for (const { dateKey, count } of additions) {
      if ((byDate[dateKey] || 0) + count > DEMO_MAX_PER_DAY) {
        await askScheduleAppConfirm(DEMO_LIMIT_REACHED_MSG, {
          title: 'デモ版の登録上限',
          confirmLabel: 'OK',
          hideCancel: true,
        })
        return false
      }
    }
    return true
  }

  useEffect(() => {
    let cancelled = false

    fetch('/cao-syukujitsu-data.csv')
      .then((response) => {
        if (!response.ok) throw new Error(`休日データの読み込みに失敗しました: ${response.status}`)
        return response.text()
      })
      .then((csvText) => {
        if (!cancelled) setHolidayMap(parseHolidayCsv(csvText))
      })
      .catch((error) => {
        console.warn('休日データの読み込みに失敗しました:', error)
      })

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    // アクセス時の最初の一回だけ、当日の予定件数が確定してからヒントバナーを表示する
    if (!session || !initialScheduleReady || doubleTapHintShownRef.current) return
    doubleTapHintShownRef.current = true
    setHintMessageIndex(0)
    setShowDoubleTapHint(true)
  }, [session, initialScheduleReady])

  useEffect(() => {
    // アカウント切り替え時は週キャッシュを破棄して再取得させる
    loadedWeeksRef.current = new Set()
    setScheduleMap({})
    setSleepRecord(null)
    setPreviousSleepRecord(null)
    setSleepRecordMap({})
    setSleepSaveMessage('')
    setMedicationSettings(normalizeMedicationSettings())
    setMedicationSettingsDraft(normalizeMedicationSettings())
    setMedicationRecord({ slots: createEmptyMedicationSlots(), exists: false })
    setMedicationRecordMap({})
    setMedicationSaveMessage('')
  }, [session?.uid])

  useEffect(() => {
    if (!session) return

    let cancelled = false
    const loadSleepRecords = async () => {
      try {
        const snapshot = await getDocs(query(collection(db, 'sleep_records'), where('user_id', '==', session.uid)))
        if (cancelled) return
        const nextMap = {}
        snapshot.forEach((docSnap) => {
          const data = docSnap.data()
          if (data.date) nextMap[data.date] = data
        })
        setSleepRecordMap(nextMap)
      } catch (error) {
        console.error('睡眠記録一覧取得エラー:', error)
      }
    }

    loadSleepRecords()
    return () => {
      cancelled = true
    }
  }, [session?.uid])

  useEffect(() => {
    if (!session) return

    let cancelled = false
    setSleepSaveMessage('')
    const loadSleepRecord = async () => {
      try {
        const previousKey = formatDateKey(addDays(selectedDate, -1))
        const [snapshot, previousSnapshot] = await Promise.all([
          getDoc(doc(db, 'sleep_records', `${session.uid}_${selectedKey}`)),
          getDoc(doc(db, 'sleep_records', `${session.uid}_${previousKey}`)),
        ])
        if (cancelled) return
        const data = snapshot.exists() ? snapshot.data() : {}
        const previousData = previousSnapshot.exists() ? previousSnapshot.data() : null
        setSleepRecord({
          bedtime: data.bedtime || formatCurrentTime(),
          wakeTime: data.wakeTime || formatCurrentTime(),
          exists: snapshot.exists(),
        })
        setPreviousSleepRecord(previousData)
      } catch (error) {
        console.error('睡眠記録取得エラー:', error)
        if (!cancelled) {
          setSleepRecord(null)
          setPreviousSleepRecord(null)
        }
      }
    }

    loadSleepRecord()
    return () => {
      cancelled = true
    }
  }, [session?.uid, selectedKey])

  useEffect(() => {
    if (!session) return

    let cancelled = false
    const loadMedicationSettings = async () => {
      try {
        const snap = await getDoc(doc(db, 'medication_settings', session.uid))
        if (cancelled) return
        const next = normalizeMedicationSettings(snap.exists() ? snap.data() : {})
        setMedicationSettings(next)
        setMedicationSettingsDraft(next)
      } catch (error) {
        console.error('服薬設定取得エラー:', error)
      }
    }

    const loadMedicationRecords = async () => {
      try {
        const snapshot = await getDocs(query(collection(db, 'medication_records'), where('user_id', '==', session.uid)))
        if (cancelled) return
        const nextMap = {}
        snapshot.forEach((docSnap) => {
          const data = docSnap.data()
          if (data.date) {
            nextMap[data.date] = {
              ...data,
              slots: normalizeMedicationRecordSlots(data.slots),
            }
          }
        })
        setMedicationRecordMap(nextMap)
      } catch (error) {
        console.error('服薬記録一覧取得エラー:', error)
      }
    }

    loadMedicationSettings()
    loadMedicationRecords()
    return () => {
      cancelled = true
    }
  }, [session?.uid])

  useEffect(() => {
    if (!session) return

    let cancelled = false
    setMedicationSaveMessage('')
    const loadMedicationRecord = async () => {
      try {
        const snapshot = await getDoc(doc(db, 'medication_records', `${session.uid}_${selectedKey}`))
        if (cancelled) return
        const data = snapshot.exists() ? snapshot.data() : {}
        setMedicationRecord({
          slots: normalizeMedicationRecordSlots(data.slots),
          exists: snapshot.exists(),
        })
      } catch (error) {
        console.error('服薬記録取得エラー:', error)
        if (!cancelled) {
          setMedicationRecord({ slots: createEmptyMedicationSlots(), exists: false })
        }
      }
    }

    loadMedicationRecord()
    return () => {
      cancelled = true
    }
  }, [session?.uid, selectedKey])

  useEffect(() => {
    if (!session) {
      setCommonTitles([])
      return
    }

    let cancelled = false

    const loadCommonTitles = async () => {
      try {
        const snap = await getDoc(doc(db, 'common_titles', session.uid))
        if (cancelled) return
        setCommonTitles(snap.exists() && Array.isArray(snap.data().titles) ? snap.data().titles : [])
      } catch (error) {
        console.error('定例タイトル取得エラー:', error)
      }
    }

    loadCommonTitles()
    return () => {
      cancelled = true
    }
  }, [session?.uid])

  useEffect(() => {
    if (!menuOpen) return
    const handlePointerDown = (event) => {
      if (menuRef.current && !menuRef.current.contains(event.target)) setMenuOpen(false)
    }
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') setMenuOpen(false)
    }
    document.addEventListener('mousedown', handlePointerDown)
    document.addEventListener('touchstart', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
      document.removeEventListener('touchstart', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [menuOpen])

  useEffect(() => {
    const handleScheduleActionMenuOutside = (event) => {
      const openDetails = document.querySelectorAll('details.schedule-action-menu[open]')
      if (openDetails.length === 0) return
      openDetails.forEach((details) => {
        if (!details.contains(event.target)) {
          details.removeAttribute('open')
        }
      })
    }
    document.addEventListener('click', handleScheduleActionMenuOutside)
    return () => {
      document.removeEventListener('click', handleScheduleActionMenuOutside)
    }
  }, [])

  useEffect(() => {
    const closeOpenMenus = () => {
      document.querySelectorAll('details.schedule-action-menu[open]').forEach((details) => {
        details.removeAttribute('open')
      })
    }
    window.addEventListener('scroll', closeOpenMenus, true)
    window.addEventListener('resize', closeOpenMenus)
    return () => {
      window.removeEventListener('scroll', closeOpenMenus, true)
      window.removeEventListener('resize', closeOpenMenus)
    }
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined') return
    window.localStorage.setItem(WEEK_CALENDAR_FIXED_KEY, String(weekCalendarFixed))
  }, [weekCalendarFixed])

  useEffect(() => {
    if (typeof window === 'undefined') return
    window.localStorage.setItem(WEEK_START_DAY_KEY, String(weekStartDay))
    loadedWeeksRef.current = new Set()
  }, [weekStartDay])

  useEffect(() => {
    if (typeof window === 'undefined') return
    window.localStorage.setItem(MONTH_CALENDAR_ENABLED_KEY, String(monthCalendarEnabled))
  }, [monthCalendarEnabled])

  useEffect(() => {
    if (typeof window === 'undefined') return
    window.localStorage.setItem(WEEK_CALENDAR_ENABLED_KEY, String(weekCalendarEnabled))
  }, [weekCalendarEnabled])

  useEffect(() => {
    if (typeof window === 'undefined') return
    window.localStorage.setItem(SLEEP_RECORD_ENABLED_KEY, String(sleepRecordEnabled))
  }, [sleepRecordEnabled])

  useEffect(() => {
    if (typeof window === 'undefined') return
    window.localStorage.setItem(MEDICATION_RECORD_ENABLED_KEY, String(medicationRecordEnabled))
  }, [medicationRecordEnabled])

  useEffect(() => {
    if (typeof window === 'undefined') return
    window.localStorage.setItem(HEALTH_LIFE_COUNT_ENABLED_KEY, String(healthLifeCountEnabled))
  }, [healthLifeCountEnabled])

  useEffect(() => {
    if (!session || typeof window === 'undefined') return
    if (!supportsPwaWebPush()) {
      setNotificationEnabled(false)
      setNotificationPermission(Capacitor.isNativePlatform() ? 'unsupported' : (
        typeof window !== 'undefined' && 'Notification' in window ? Notification.permission : 'unsupported'
      ))
      return
    }

    let cancelled = false
    let timerId = null

    const loadNotificationState = async () => {
      setNotificationPermission(Notification.permission)

      if (Notification.permission !== 'granted') {
        if (!cancelled) {
          setNotificationEnabled(false)
          setNotificationBadgeCount(0)
        }
        return
      }

      const storedToken = window.localStorage.getItem(notificationTokenKey(session.uid))
      if (!storedToken) {
        if (!cancelled) {
          setNotificationEnabled(false)
          setNotificationBadgeCount(0)
        }
        return
      }

      const tokenDoc = await getDoc(doc(db, 'fcm_tokens', `${session.uid}_${storedToken}`))
      if (cancelled) return

      if (!tokenDoc.exists()) {
        window.localStorage.removeItem(notificationTokenKey(session.uid))
        setNotificationEnabled(false)
        setNotificationBadgeCount(0)
        return
      }

      const tokenSnapshot = await getDocs(query(collection(db, 'fcm_tokens'), where('user_id', '==', session.uid)))
      if (cancelled) return

      const duplicates = tokenSnapshot.docs
        .map((tokenEntry) => tokenEntry.data().token)
        .filter((token) => token && token !== storedToken)

      if (duplicates.length > 0) {
        const batch = writeBatch(db)
        duplicates.forEach((duplicateToken) => {
          batch.delete(doc(db, 'fcm_tokens', `${session.uid}_${duplicateToken}`))
        })
        await batch.commit()
      }

      setNotificationEnabled(true)
      clearBadgeWhenAppForeground()
    }

    // 初回レンダリングとスケジュール取得を優先するため、通知同期は遅延実行
    timerId = setTimeout(() => {
      loadNotificationState().catch((error) => {
        console.error('通知状態の取得エラー:', error)
      })
    }, 1200)

    return () => {
      cancelled = true
      if (timerId) clearTimeout(timerId)
    }
  }, [session?.uid])

  const getNotificationRegistration = async () => {
    if (notificationRegistrationRef.current) return notificationRegistrationRef.current
    const registration = await navigator.serviceWorker.register('/firebase-messaging-sw.js', {
      scope: FCM_SW_SCOPE,
    })
    notificationRegistrationRef.current = registration
    return registration
  }

  const syncBadgeWithServiceWorker = async (count) => {
    if (!supportsPwaWebPush()) return
    try {
      const posted = await postMessageToMessagingWorker({
        type: 'sync-badge-count',
        count: Math.max(Number(count) || 0, 0),
      })
      if (!posted) {
        console.warn('通知バッジ同期: FCM Service Worker が未起動のためスキップしました。')
      }
    } catch (error) {
      console.warn('通知バッジ同期エラー:', error)
    }
  }

  const setBrowserBadge = async (count) => {
    const safeCount = Math.max(Number(count) || 0, 0)
    if (typeof navigator === 'undefined') return

    if ('setAppBadge' in navigator) {
      if (safeCount > 0) {
        await navigator.setAppBadge(safeCount)
      } else if ('clearAppBadge' in navigator) {
        await navigator.clearAppBadge()
      }
    }

    await syncBadgeWithServiceWorker(safeCount)
  }

  const clearNotificationBadge = async () => {
    setNotificationBadgeCount(0)
    await setBrowserBadge(0)
  }

  // 離れている間の未読バッジは、PWA を前面に出したタイミングで確認済みとして消す
  const clearBadgeWhenAppForeground = () => {
    if (typeof document === 'undefined' || document.visibilityState !== 'visible') return
    clearNotificationBadge().catch((error) => {
      console.error('前面表示時のバッジクリアエラー:', error)
    })
  }

  const enableNotifications = async () => {
    if (!session) return
    if (!supportsPwaWebPush()) {
      if (Capacitor.isNativePlatform()) {
        throw new Error('ネイティブアプリのプッシュ通知は準備中です。現時点ではブラウザでホーム画面に追加したPWAをご利用ください。')
      }
      throw new Error('このブラウザでは通知を利用できません。')
    }

    if (requiresHomeScreenForNotifications()) {
      setNotificationHelpOpen(true)
      throw new Error('iPhoneのSafariではホーム画面に追加したアプリで通知を有効にしてください。')
    }

    let permission = Notification.permission
    setNotificationPermission(permission)

    if (permission !== 'granted') {
      permission = await Notification.requestPermission()
      setNotificationPermission(permission)
      if (permission !== 'granted') {
        setNotificationHelpOpen(true)
        if (permission === 'denied') {
          throw new Error('ブラウザで通知がブロックされています。サイト設定で通知を許可してください。')
        }
        throw new Error('ブラウザ設定で通知を許可してから、もう一度お試しください。')
      }
    }

    const registration = await withTimeout(
      getNotificationRegistration(),
      15000,
      'Service Worker の登録がタイムアウトしました。'
    )
    await withTimeout(
      waitForMessagingServiceWorkerActive(registration),
      15000,
      'FCM Service Worker の起動がタイムアウトしました。'
    )
    const token = await withTimeout(
      getFcmToken(registration),
      15000,
      'FCM トークンの取得がタイムアウトしました。'
    )
    if (!token) {
      throw new Error('FCMトークンを取得できませんでした。')
    }

    window.localStorage.setItem(notificationTokenKey(session.uid), token)

    await withTimeout(setDoc(
      doc(db, 'fcm_tokens', `${session.uid}_${token}`),
      {
        user_id: session.uid,
        user_email: session.email || '',
        token,
        platform: 'web',
        updated_at: serverTimestamp(),
      },
      { merge: true }
    ), 15000, '通知トークンの保存がタイムアウトしました。')

    setNotificationEnabled(true)
    clearBadgeWhenAppForeground()
  }

  const disableNotifications = async () => {
    if (!session) return

    const storedToken = typeof window !== 'undefined'
      ? window.localStorage.getItem(notificationTokenKey(session.uid))
      : ''

    if (storedToken) {
      await deleteDoc(doc(db, 'fcm_tokens', `${session.uid}_${storedToken}`))
      window.localStorage.removeItem(notificationTokenKey(session.uid))
    }

    await deleteFcmToken()
    setNotificationEnabled(false)
    await clearNotificationBadge()
  }

  const toggleNotifications = async () => {
    if (!session || notificationToggleLockRef.current) return
    notificationToggleLockRef.current = true

    setNotificationBusy(true)
    try {
      if (notificationEnabled) {
        await disableNotifications()
      } else {
        await enableNotifications()
      }
    } catch (error) {
      console.error('通知切替エラー:', error)
      alert(`通知設定の切り替えに失敗しました:\n${error.message}`)
    } finally {
      setNotificationBusy(false)
      notificationToggleLockRef.current = false
    }
  }

  const notificationHelpSteps = [
    '鈴ボタンを押して通知をONにします。',
    'ブラウザの確認が出たら「許可」を選びます。',
    'ブロック済みの場合は、鍵アイコンやサイト情報から通知を許可してください。',
  ]

  const safariInstallSteps = isIosDevice()
    ? [
        'Safariの共有ボタンから「ホーム画面に追加」を選びます。',
        '追加したアイコンからアプリを開きます。',
        'アプリ側で鈴ボタンを押して通知をONにします。',
      ]
    : []

  useEffect(() => {
    if (!session || typeof window === 'undefined') return
    if (!supportsPwaWebPush()) return
    if (!('Notification' in window)) return

    let unsubscribe = () => {}
    let active = true
    let timerId = null

    const attachForegroundListener = async () => {
      unsubscribe()
      unsubscribe = await subscribeForegroundNotifications((payload) => {
        if (!active) return
        if (Notification.permission !== 'granted') return
        if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return

        const title = payload.data?.title || payload.notification?.title || 'スケジュール通知'
        const body = payload.data?.body || payload.notification?.body || '開始時間になった予定があります。'
        const tag = buildPushNotificationTag(payload)
        const now = Date.now()
        const last = lastForegroundPushRef.current
        if (last.tag === tag && now - last.at < 8000) return
        lastForegroundPushRef.current = { tag, at: now }

        setNotificationBadgeCount((current) => {
          const next = current + 1
          setBrowserBadge(next).catch((error) => {
            console.error('バッジ設定エラー:', error)
          })
          return next
        })
        const notification = new Notification(title, { body, tag })
        notification.onclick = () => {
          setNotificationBadgeCount((current) => {
            const next = Math.max(current - 1, 0)
            setBrowserBadge(next).catch((error) => {
              console.error('バッジ減算エラー:', error)
            })
            return next
          })
          if (window.focus) {
            window.focus()
          }
          notification.close()
        }
      })
    }

    timerId = setTimeout(() => {
      attachForegroundListener().catch((error) => {
        console.error('フォアグラウンド通知購読エラー:', error)
      })
    }, 1500)

    return () => {
      active = false
      if (timerId) clearTimeout(timerId)
      unsubscribe()
    }
  }, [session?.uid])

  useEffect(() => {
    if (!session || typeof window === 'undefined' || !navigator.serviceWorker) return
    if (!supportsPwaWebPush()) return

    const handleMessage = (event) => {
      if (!event.data) return

      if (event.data.type === 'badge-count') {
        const nextCount = Math.max(Number(event.data.count || 0), 0)
        setNotificationBadgeCount((current) => (current === nextCount ? current : nextCount))
        if ('setAppBadge' in navigator) {
          if (nextCount > 0) {
            navigator.setAppBadge(nextCount).catch((error) => {
              console.error('通知件数同期エラー:', error)
            })
          } else if ('clearAppBadge' in navigator) {
            navigator.clearAppBadge().catch((error) => {
              console.error('通知件数同期エラー:', error)
            })
          }
        }
        return
      }

      if (event.data.type === 'notification-clicked') {
        clearBadgeWhenAppForeground()
      }
    }

    navigator.serviceWorker.addEventListener('message', handleMessage)

    clearBadgeWhenAppForeground()

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        clearBadgeWhenAppForeground()
      }
    }
    document.addEventListener('visibilitychange', handleVisibilityChange)

    return () => {
      navigator.serviceWorker.removeEventListener('message', handleMessage)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [session?.uid])

  useEffect(() => {
    if (!session || typeof document === 'undefined') return
    document.title = notificationBadgeCount > 0
      ? `(${notificationBadgeCount}) ${APP_DISPLAY_NAME}`
      : APP_DISPLAY_NAME
  }, [session?.uid, notificationBadgeCount])

  useEffect(() => {
    if (!session || typeof navigator === 'undefined') return
    if (!('setAppBadge' in navigator) && !('clearAppBadge' in navigator)) return

    setBrowserBadge(notificationBadgeCount).catch((error) => {
      console.error('ホーム画面バッジ更新エラー:', error)
    })
  }, [session?.uid, notificationBadgeCount])

  const weekDates = useMemo(() => {
    const start = getWeekStart(selectedDate, weekStartDay)
    return Array.from({ length: 7 }, (_, index) => addDays(start, index))
  }, [selectedDate, weekStartDay])

  const weekStartKey = useMemo(() => formatDateKey(getWeekStart(selectedDate, weekStartDay)), [selectedDate, weekStartDay])

  // 月カレンダー・週カレンダー・スケジュール検索は selectedDate の月を共通の基準として同期する
  const monthViewDate = useMemo(
    () => new Date(selectedDate.getFullYear(), selectedDate.getMonth(), 1),
    [selectedDate]
  )

  const monthGridWeeks = useMemo(
    () => getMonthGridWeeks(monthViewDate, weekStartDay),
    [monthViewDate, weekStartDay]
  )

  const changeSelectedMonth = (offset) => {
    setSelectedDate((current) => new Date(current.getFullYear(), current.getMonth() + offset, 1))
  }

  const selectedItems = useMemo(() => sortDayScheduleItems(scheduleMap[selectedKey] || []), [scheduleMap, selectedKey])
  const selectedTopLevelItems = useMemo(() => filterTopLevelDayItems(selectedItems), [selectedItems])

  const selectedHolidayName = holidayMap[selectedKey] || ''

  useEffect(() => {
    if (!healthLifeCountEnabled) {
      setStepsByDate(null)
      return undefined
    }
    let cancelled = false
    loadStepsByDate()
      .then((map) => {
        if (!cancelled) setStepsByDate(map)
      })
      .catch((error) => {
        console.error('歩数CSV読込エラー:', error)
        if (!cancelled) setStepsByDate(new Map())
      })
    return () => {
      cancelled = true
    }
  }, [healthLifeCountEnabled])

  useEffect(() => {
    if (!stepsByDate) {
      setStepManualDraft('')
      return
    }
    const row = getStepsForDisplay(stepsByDate, selectedKey)
    setStepManualDraft(row ? String(row.steps) : '')
  }, [selectedKey, stepsByDate])

  const selectedIsToday = useMemo(() => formatDateKey(selectedDate) === formatDateKey(new Date()), [selectedDate])

  const fatigue = useMemo(() => {
    if (!healthLifeCountEnabled) return null
    const stepsForScoring = stepsByDate ? getStepsForScoring(stepsByDate, selectedKey) : null
    return computeFatigueScore(selectedDate, sleepRecordMap, scheduleMap, {
      isToday: selectedIsToday,
      stepsForScoring,
    })
  }, [healthLifeCountEnabled, selectedDate, sleepRecordMap, scheduleMap, selectedIsToday, stepsByDate, selectedKey])

  const recentSleepSummary = useMemo(() => {
    if (!healthLifeCountEnabled) return { averageMinutes: null, recordedDays: 0, level: null }
    const records = Array.from({ length: 3 }, (_, index) => {
      const dateKey = formatDateKey(addDays(selectedDate, -(index + 1)))
      const previousDateKey = formatDateKey(addDays(selectedDate, -(index + 2)))
      return getSleepDurationMinutes(sleepRecordMap[dateKey], sleepRecordMap[previousDateKey])
    })
      .filter((minutes) => minutes !== null)
    if (records.length === 0) return { averageMinutes: null, recordedDays: 0, level: null }
    const averageMinutes = Math.round(records.reduce((sum, minutes) => sum + minutes, 0) / records.length)
    return {
      averageMinutes,
      recordedDays: records.length,
      level: getSleepAdviceLevel(averageMinutes),
    }
  }, [healthLifeCountEnabled, selectedDate, sleepRecordMap])

  const sleepLevelEmoji = useMemo(() => {
    if (!healthLifeCountEnabled || !recentSleepSummary.level) return null
    return sleepAdviceByLevel[recentSleepSummary.level].emoji
  }, [recentSleepSummary.level])

  const formatSleepDuration = (minutes) => {
    if (minutes === null) return '記録なし'
    return `${Math.floor(minutes / 60)}時間${minutes % 60}分`
  }

  const saveSleepTime = async (field, value = formatCurrentTime()) => {
    if (!session || sleepSaving) return

    const time = value || formatCurrentTime()
    const nextRecord = {
      bedtime: sleepRecord?.bedtime || time,
      wakeTime: sleepRecord?.wakeTime || time,
      [field]: time,
      user_id: session.uid,
      date: selectedKey,
    }

    setSleepSaving(true)
    try {
      await setDoc(doc(db, 'sleep_records', `${session.uid}_${selectedKey}`), nextRecord)
      setSleepRecord({ ...nextRecord, exists: true })
      setSleepRecordMap((current) => ({ ...current, [selectedKey]: { ...nextRecord } }))
      setSleepSaveMessage('睡眠記録を保存しました。')
    } catch (error) {
      console.error('睡眠記録保存エラー:', error)
      alert(`睡眠記録の保存に失敗しました:\n${error.message}`)
    } finally {
      setSleepSaving(false)
    }
  }

  const saveMedicationSettings = async () => {
    if (!session || medicationSaving) return
    const next = normalizeMedicationSettings(medicationSettingsDraft)
    setMedicationSaving(true)
    try {
      await setDoc(doc(db, 'medication_settings', session.uid), {
        ...next,
        updatedAt: serverTimestamp(),
      }, { merge: true })
      setMedicationSettings(next)
      setMedicationSettingsDraft(next)
      setMedicationSaveMessage('服薬時刻・通知設定を保存しました。')
    } catch (error) {
      console.error('服薬設定保存エラー:', error)
      alert(`服薬設定の保存に失敗しました:\n${error.message}`)
    } finally {
      setMedicationSaving(false)
    }
  }

  const toggleMedicationNotifyEnabled = async () => {
    if (!session || medicationSaving) return
    const nextEnabled = !(medicationSettingsDraft.notifyEnabled !== false)
    const next = normalizeMedicationSettings({ ...medicationSettingsDraft, notifyEnabled: nextEnabled })
    setMedicationSettingsDraft(next)
    setMedicationSaving(true)
    try {
      await setDoc(doc(db, 'medication_settings', session.uid), {
        ...next,
        updatedAt: serverTimestamp(),
      }, { merge: true })
      setMedicationSettings(next)
      setMedicationSaveMessage(nextEnabled ? '服薬通知をオンにしました。' : '服薬通知をオフにしました。')
    } catch (error) {
      console.error('服薬通知設定エラー:', error)
      alert(`服薬通知の切り替えに失敗しました:\n${error.message}`)
      setMedicationSettingsDraft(medicationSettings)
    } finally {
      setMedicationSaving(false)
    }
  }

  const toggleMedicationSlot = async (slotKey) => {
    if (!session || medicationSaving) return
    const currentSlots = normalizeMedicationRecordSlots(medicationRecord?.slots)
    const current = currentSlots[slotKey] || { completed: false, takenAt: null }
    const nextCompleted = !current.completed
    const nextSlots = {
      ...currentSlots,
      [slotKey]: {
        completed: nextCompleted,
        takenAt: nextCompleted ? formatCurrentTime() : null,
      },
    }
    const nextRecord = {
      user_id: session.uid,
      date: selectedKey,
      slots: nextSlots,
      updatedAt: serverTimestamp(),
    }

    setMedicationSaving(true)
    try {
      await setDoc(doc(db, 'medication_records', `${session.uid}_${selectedKey}`), nextRecord, { merge: true })
      const localRecord = { slots: nextSlots, exists: true }
      setMedicationRecord(localRecord)
      setMedicationRecordMap((prev) => ({
        ...prev,
        [selectedKey]: { user_id: session.uid, date: selectedKey, slots: nextSlots },
      }))
      setMedicationSaveMessage(
        nextCompleted
          ? `${MEDICATION_SLOT_LABELS[slotKey]}の服薬を記録しました。`
          : `${MEDICATION_SLOT_LABELS[slotKey]}の服薬記録を取り消しました。`
      )
    } catch (error) {
      console.error('服薬記録保存エラー:', error)
      alert(`服薬記録の保存に失敗しました:\n${error.message}`)
    } finally {
      setMedicationSaving(false)
    }
  }

  // 0件の日は追加方法のみ、1件以上は編集→追加の順で順次表示する
  const doubleTapHintMessages = useMemo(() => {
    if (selectedItems.length === 0) {
      return [{ icon: Plus, text: '右上の追加ボタンから予定を登録できます' }]
    }
    return [
      { icon: PencilLine, text: '予定カードはダブルタップで編集できます' },
      { icon: Plus, text: '右上の追加ボタンから予定を登録できます' },
    ]
  }, [selectedItems.length])

  useEffect(() => {
    if (!showDoubleTapHint) return
    setDoubleTapHintFading(false)
    const fadeTimer = setTimeout(() => setDoubleTapHintFading(true), 3000)
    const advanceTimer = setTimeout(() => {
      setHintMessageIndex((current) => {
        if (current + 1 >= doubleTapHintMessages.length) {
          setShowDoubleTapHint(false)
          return current
        }
        return current + 1
      })
    }, 3600)
    return () => {
      clearTimeout(fadeTimer)
      clearTimeout(advanceTimer)
    }
  }, [showDoubleTapHint, hintMessageIndex, doubleTapHintMessages])

  const scheduleListItems = useMemo(() => {
    const todayKey = formatDateKey(new Date())
    return weekDates
      .flatMap((date) => {
        const dateKey = formatDateKey(date)
        return (scheduleMap[dateKey] || []).map((item) => ({
          ...item,
          dateKey,
          dayName: dayNames[date.getDay()],
          isPast: dateKey < todayKey,
        }))
      })
      .sort((a, b) => {
        if (a.dateKey !== b.dateKey) return a.dateKey.localeCompare(b.dateKey)
        const aTask = isScheduleTask(a)
        const bTask = isScheduleTask(b)
        if (aTask !== bTask) return aTask ? 1 : -1
        if (aTask && bTask) return String(a.id).localeCompare(String(b.id))
        return parseTimeValue(a.time || '09:00') - parseTimeValue(b.time || '09:00')
      })
  }, [weekDates, scheduleMap])

  // 連続達成日数・週間バッジを予定データから算出
  const achievementStats = useMemo(() => {
    const todayKey = formatDateKey(new Date())

    const isDayAchieved = (dateKey) => {
      const items = scheduleMap[dateKey] || []
      return items.length > 0 && items.every((item) => item.completed === true)
    }

    let streak = 0
    let streakCursor = isDayAchieved(todayKey) ? new Date(`${todayKey}T00:00:00`) : addDays(new Date(`${todayKey}T00:00:00`), -1)
    while (isDayAchieved(formatDateKey(streakCursor))) {
      streak += 1
      streakCursor = addDays(streakCursor, -1)
    }

    const weekItems = weekDates.flatMap((date) => scheduleMap[formatDateKey(date)] || [])
    const weekRate = weekItems.length > 0 ? weekItems.filter((item) => item.completed).length / weekItems.length : null
    let weekBadge = null
    if (weekRate !== null) {
      if (weekRate >= 1) weekBadge = { icon: '🏆', label: '皆勤賞' }
      else if (weekRate >= 0.7) weekBadge = { icon: '🌟', label: 'がんばり屋さん' }
      else if (weekRate >= 0.4) weekBadge = { icon: '👍', label: '順調ペース' }
    }

    return { streak, weekBadge }
  }, [scheduleMap, weekDates])

  const healthLifePresentation = useMemo(() => {
    if (!healthLifeCountEnabled || !fatigue) return null
    return buildHealthLifeCountPresentation({
      fatigue,
      recentSleepSummary,
      formatSleepDuration,
      sleepRecordEnabled,
    })
  }, [healthLifeCountEnabled, fatigue, recentSleepSummary, sleepRecordEnabled])

  const stepsDisplay = useMemo(() => {
    if (!healthLifeCountEnabled) return null
    return getStepsDisplayState({
      stepRow: stepsByDate ? getStepsForDisplay(stepsByDate, selectedKey) : null,
      csvHasAnyRow: Boolean(stepsByDate && stepsByDate.size > 0),
    })
  }, [healthLifeCountEnabled, stepsByDate, selectedKey])

  const healthLifeBandColors = healthLifePresentation
    ? fatigueBandColors[healthLifePresentation.band] || fatigueBandColors.normal
    : fatigueBandColors.normal

  const searchMonthKey = useMemo(() => {
    const year = selectedDate.getFullYear()
    const month = String(selectedDate.getMonth() + 1).padStart(2, '0')
    return `${year}-${month}`
  }, [selectedDate])

  const searchMonthTitle = useMemo(() => {
    return `${selectedDate.getFullYear()}年${selectedDate.getMonth() + 1}月`
  }, [selectedDate])

  const changeSearchMonth = (offset) => changeSelectedMonth(offset)

  const scheduleSearchResults = useMemo(() => {
    const normalizedQuery = scheduleSearchQuery.trim().toLocaleLowerCase('ja-JP')
    if (!normalizedQuery) return []

    const allItems = Object.entries(scheduleMap).flatMap(([dateKey, list]) => {
      if (!dateKey.startsWith(searchMonthKey)) return []
      return (list || []).map((item) => ({ ...item, date: item.date || dateKey }))
    })

    return allItems
      .filter((item) => (item.title || '予定').toLocaleLowerCase('ja-JP').includes(normalizedQuery))
      .sort((a, b) => (a.date || '').localeCompare(b.date || '') || parseTimeValue(a.time || '09:00') - parseTimeValue(b.time || '09:00') || String(a.id).localeCompare(String(b.id)))
  }, [scheduleMap, scheduleSearchQuery, searchMonthKey])

  const fetchWeekSchedule = async () => {
    if (!session) return

    setLoading(true)
    try {
      const q = query(
        collection(db, 'schedule_items'),
        where('user_id', '==', session.uid)
      )

      const snapshot = await getDocs(q)
      const nextMap = {}

      snapshot.forEach((docSnap) => {
        const item = docSnap.data()
        const dateKey = item.date
        if (!dateKey) return

        if (!nextMap[dateKey]) {
          nextMap[dateKey] = []
        }

        nextMap[dateKey].push(normalizeScheduleItem(item, docSnap.id))
      })

      Object.keys(nextMap).forEach((key) => {
        nextMap[key] = sortDayScheduleItems(nextMap[key])
      })

      setScheduleMap(nextMap)
    } catch (error) {
      console.error('週予定取得エラー:', error)
      alert(`スケジュール読み込みエラー:\n${error.message}`)
    } finally {
      setLoading(false)
    }
  }

  // 初期表示を高速化するため、表示中の週だけを先行取得して即座に反映する（全件取得は従来通りバックグラウンドで継続）
  const fetchVisibleRangeSchedule = async () => {
    if (!session || weekDates.length === 0) return
    try {
      const startKey = formatDateKey(weekDates[0])
      const endKey = formatDateKey(weekDates[6])
      const q = query(
        collection(db, 'schedule_items'),
        where('user_id', '==', session.uid),
        where('date', '>=', startKey),
        where('date', '<=', endKey)
      )

      const snapshot = await getDocs(q)
      const partialMap = {}

      snapshot.forEach((docSnap) => {
        const item = docSnap.data()
        const dateKey = item.date
        if (!dateKey) return

        if (!partialMap[dateKey]) {
          partialMap[dateKey] = []
        }

        partialMap[dateKey].push(normalizeScheduleItem(item, docSnap.id))
      })

      Object.keys(partialMap).forEach((key) => {
        partialMap[key] = sortDayScheduleItems(partialMap[key])
      })

      setScheduleMap((current) => ({ ...current, ...partialMap }))
    } catch (error) {
      console.error('表示週の先行取得エラー:', error)
    } finally {
      setInitialScheduleReady(true)
    }
  }

  useEffect(() => {
    if (!session) return
    fetchVisibleRangeSchedule()
    fetchWeekSchedule()
  }, [session?.uid])

  // 画面表示を即時反映するための楽観的更新（Firestore への書き込みは呼び出し側で実施済み）
  const upsertScheduleItemLocal = (item) => {
    setScheduleMap((current) => {
      const next = { ...current }
      const existingList = next[item.date] || []
      const filtered = existingList.filter((entry) => entry.id !== item.id)
      const updatedList = sortDayScheduleItems([...filtered, item])
      next[item.date] = updatedList
      return next
    })
  }

  const invalidateScheduleWeeks = (dateKeys) => {
    const weeks = new Set(
      dateKeys
        .filter(Boolean)
        .map((dateKey) => formatDateKey(getWeekStart(new Date(`${dateKey}T00:00:00`), weekStartDay)))
    )
    weeks.forEach((weekKey) => loadedWeeksRef.current.delete(weekKey))
  }

  const clearScheduleCache = () => {
    loadedWeeksRef.current = new Set()
    setScheduleMap({})
  }

  const removeScheduleItemLocal = (dateKey, itemId) => {
    setScheduleMap((current) => {
      const existingList = current[dateKey]
      if (!existingList) return current
      const next = { ...current }
      next[dateKey] = existingList.filter((entry) => entry.id !== itemId)
      return next
    })
  }

  const handleAuth = async (e) => {
    e.preventDefault()
    setAuthError('')

    try {
      if (authMode === 'signup') {
        await createUserWithEmailAndPassword(auth, email, password)
      } else {
        await signInWithEmailAndPassword(auth, email, password)
      }
    } catch (error) {
      setAuthError(error.message)
    }
  }

  const handleSendPasswordReset = async () => {
    if (!email.trim()) {
      setAuthError('パスワード再設定メールを送信するため、メールアドレスを入力してください。')
      return
    }
    setAuthError('')
    try {
      await sendPasswordResetEmail(auth, email.trim())
      alert(`「${email.trim()}」宛にパスワード再設定用メールを送信しました。\nメール内のリンクから新しいパスワードを設定してください。`)
    } catch (error) {
      console.error('パスワードリセット送信エラー:', error)
      if (error.code === 'auth/user-not-found') {
        setAuthError('登録されていないメールアドレスです。')
      } else if (error.code === 'auth/invalid-email') {
        setAuthError('有効なメールアドレスを入力してください。')
      } else {
        setAuthError(`送信に失敗しました: ${error.message}`)
      }
    }
  }

  const deleteUserData = async (uid) => {
    const collectionsToDelete = ['schedule_items', 'sleep_records', 'medication_records', 'fcm_tokens']
    for (const colName of collectionsToDelete) {
      let hasMore = true
      while (hasMore) {
        const snap = await getDocs(query(collection(db, colName), where('user_id', '==', uid)))
        if (snap.empty) {
          hasMore = false
          break
        }
        const docs = snap.docs
        const batchSize = 400
        for (let i = 0; i < docs.length; i += batchSize) {
          const batch = writeBatch(db)
          const chunk = docs.slice(i, i + batchSize)
          chunk.forEach((d) => batch.delete(d.ref))
          await batch.commit()
        }
        if (docs.length < batchSize) {
          hasMore = false
        }
      }
    }

    try {
      await deleteDoc(doc(db, 'common_titles', uid))
    } catch (e) {
      console.error('common_titles delete error:', e)
    }
    try {
      await deleteDoc(doc(db, 'medication_settings', uid))
    } catch (e) {
      console.error('medication_settings delete error:', e)
    }
    try {
      await deleteDoc(doc(db, 'notification_state', uid))
    } catch (e) {
      console.error('notification_state delete error:', e)
    }
  }

  const openSubscriptionCancelModal = () => {
    setMenuOpen(false)
    setSubscriptionCancelModalOpen(true)
  }

  const proceedSubscriptionCancelContact = () => {
    if (!session?.email) {
      setSubscriptionCancelModalOpen(false)
      return
    }
    const contactUrl = buildSubscriptionCancelContactUrl(session.email)
    setSubscriptionCancelModalOpen(false)
    window.open(contactUrl, '_blank', 'noopener,noreferrer')
  }

  const handleSendResetEmailInDeleteModal = async () => {
    if (!session?.email) return
    try {
      await sendPasswordResetEmail(auth, session.email)
      alert(`「${session.email}」宛にパスワード再設定用のメールを送信しました。\nメールに記載されているリンクからパスワードを再設定したあと、再度アカウント削除を行ってください。`)
    } catch (error) {
      console.error('パスワードリセットメール送信エラー:', error)
      alert(`パスワードリセットメールの送信に失敗しました:\n${error.message}`)
    }
  }

  const handleAccountDelete = async () => {
    if (!session || !auth.currentUser) {
      alert('セッションが切れています。再度ログインしてください。')
      setDeleteAccountModalOpen(false)
      return
    }

    if (!deletePassword) {
      setDeleteAccountError('パスワードを入力してください。')
      return
    }

    setDeleteAccountError('')

    if (!window.confirm('本当にアカウントとすべてのデータを削除しますか？この操作は復旧できません。')) {
      return
    }

    setDeletingAccount(true)
    try {
      const credential = EmailAuthProvider.credential(session.email, deletePassword)
      await reauthenticateWithCredential(auth.currentUser, credential)

      await deleteUserData(session.uid)

      try {
        await deleteFcmToken()
      } catch (e) {
        console.error('FCM token cleanup error:', e)
      }

      const userToDelete = auth.currentUser
      await deleteUser(userToDelete)

      alert('アカウントとすべてのデータが正常に削除されました。')
      setDeleteAccountModalOpen(false)
      setDeletePassword('')
      setSession(null)
      setAuthMode('signup')
      setEmail('')
      setPassword('')
      setScheduleMap({})
      setSleepRecordMap({})
    } catch (error) {
      console.error('アカウント削除エラー:', error)
      if (error.code === 'auth/wrong-password' || error.code === 'auth/invalid-credential') {
        setDeleteAccountError('パスワードが正しくありません。')
      } else if (error.code === 'auth/requires-recent-login') {
        setDeleteAccountError('セキュリティ保護のため、一度ログアウトして再ログイン後に実行してください。')
      } else {
        setDeleteAccountError(`削除に失敗しました: ${error.message}`)
      }
    } finally {
      setDeletingAccount(false)
    }
  }

  const changeWeek = (offset) => {
    setSelectedDate((current) => addDays(current, offset))
  }

  const selectNextWeek = () => {
    setSelectedDate((current) => addDays(getWeekStart(current, weekStartDay), 7))
  }

  const selectPreviousWeek = () => {
    setSelectedDate((current) => addDays(getWeekStart(current, weekStartDay), -7))
  }

  const changeSelectedDay = (offset) => {
    setSelectedDate((current) => addDays(current, offset))
  }

  const goToToday = () => {
    setSelectedDate(new Date())
  }

  const hasScheduleRelation = (item) => {
    const latest = getLatestScheduleItem(item) || item
    return scheduleItemHasOrderRelation(scheduleMap, latest)
  }

  const getDateConflictingItems = async (dateKey, item, ignoreExistingId = null) => {
    if (!session || !item || isScheduleTask(item)) return []

    const targetStart = parseTimeValue(item.time || '09:00')
    const targetEnd = parseTimeValue(item.endTime || '10:00')
    const ignoredIds = new Set()
    if (ignoreExistingId) ignoredIds.add(ignoreExistingId)
    if (item?.id) ignoredIds.add(item.id)

    try {
      const q = query(
        collection(db, 'schedule_items'),
        where('user_id', '==', session.uid),
        where('date', '==', dateKey)
      )
      const snapshot = await getDocs(q)
      const items = []

      snapshot.forEach((docSnap) => {
        const candidate = docSnap.data()
        const candidateId = candidate.id || docSnap.id
        if (ignoredIds.has(candidateId)) return

        const candidateDate = candidate.date || dateKey
        if (candidateDate !== dateKey) return

        if (candidate.isTask === true) return

        const candidateStart = parseTimeValue(candidate.time || '09:00')
        const candidateEnd = parseTimeValue(candidate.endTime || '10:00')

        if (targetStart < candidateEnd && candidateStart < targetEnd) {
          items.push({
            id: candidateId,
            date: candidateDate,
            time: candidate.time || '09:00',
            endTime: candidate.endTime || '10:00',
          })
        }
      })

      return items
    } catch (error) {
      console.warn('対象日の重複確認に失敗しました:', error)
      return []
    }
  }

  const openMoveCopyDialog = async (item) => {
    if (!session || !item) return

    const fallbackItem = { ...item, date: item.date || selectedKey }
    setMoveCopyCalendarOpen(false)
    setMoveCopyDialog({
      dialogId: `move-copy-${Date.now()}`,
      item: fallbackItem,
      targetDate: fallbackItem.date,
      duplicateConflicts: [],
      pendingMode: null,
    })

    try {
      const latestRef = doc(db, 'schedule_items', `${session.uid}_${item.date}_${item.id}`)
      const latestSnap = await getDoc(latestRef)
      const latestItem = latestSnap.exists()
        ? { ...latestSnap.data(), id: latestSnap.data().id || item.id }
        : fallbackItem

      setMoveCopyDialog((current) => ({
        dialogId: current?.dialogId || `move-copy-${Date.now()}`,
        item: latestItem,
        targetDate: current?.targetDate || latestItem.date || fallbackItem.date,
        duplicateConflicts: current?.duplicateConflicts || [],
        pendingMode: current?.pendingMode || null,
      }))
    } catch (error) {
      console.error('予定の最新状態取得エラー:', error)
    }
  }

  const closeMoveCopyDialog = () => {
    setMoveCopyCalendarOpen(false)
    setMoveCopyDialog(null)
  }

  const openMoveCopyCalendar = () => {
    if (!moveCopyDialog) return
    const targetDate = new Date(`${moveCopyDialog.targetDate}T00:00:00`)
    setMoveCopyCalendarMonth(Number.isNaN(targetDate.getTime()) ? new Date() : targetDate)
    setMoveCopyCalendarOpen(true)
  }

  const selectMoveCopyDate = (date) => {
    setMoveCopyDialog((current) => current ? {
      ...current,
      targetDate: formatDateKey(date),
      duplicateConflicts: [],
      pendingMode: null,
    } : current)
    setMoveCopyCalendarOpen(false)
  }

  const proceedMoveOrCopy = async (mode, skipDuplicateCheck = false) => {
    if (!session || !moveCopyDialog) return

    const { item, targetDate } = moveCopyDialog
    if (!targetDate) {
      alert('日付を選択してください。')
      return
    }

    if (mode === 'move') {
      if (targetDate === item.date) {
        alert('移動先の日付は現在の予定日と異なる日付を選択してください。')
        return
      }
    }

    const targetDateKey = formatDateKey(new Date(`${targetDate}T00:00:00`))

    if (mode === 'move' && hasScheduleRelation(item)) {
      if (!(await askScheduleAppConfirm(MOVE_WITH_RELATION_CONFIRM_MSG, {
        title: '移動の確認',
        confirmLabel: '移動する',
      }))) return
    }

    if (!skipDuplicateCheck) {
      const conflictingItems = await getDateConflictingItems(targetDateKey, item, mode === 'move' ? item.id : null)
      if (conflictingItems.length > 0) {
        setMoveCopyDialog((current) => (current ? {
          ...current,
          duplicateConflicts: conflictingItems,
          pendingMode: mode,
        } : current))
        return
      }
    }

    const sourceLatestForLimit = getLatestScheduleItem(item) || item
    const childTasksForLimit = !isScheduleTask(sourceLatestForLimit)
      ? findChildTasksForParent(scheduleMap, sourceLatestForLimit)
      : []
    const bundleCount = 1 + childTasksForLimit.length

    if (mode === 'copy') {
      const allowed = await ensureDemoCanCreateScheduleItems([{ dateKey: targetDateKey, count: bundleCount }])
      if (!allowed) return
    } else if (mode === 'move' && demoMode) {
      const sourceDateKey = sourceLatestForLimit.date || item.date
      // 別日への移動のみ当日上限を見る（同一日内は件数不変）
      if (sourceDateKey !== targetDateKey) {
        const { byDate } = await countScheduleItemsFromFirestore()
        if ((byDate[targetDateKey] || 0) + bundleCount > DEMO_MAX_PER_DAY) {
          await askScheduleAppConfirm(DEMO_LIMIT_REACHED_MSG, {
            title: 'デモ版の登録上限',
            confirmLabel: 'OK',
            hideCancel: true,
          })
          return
        }
      }
    }

    try {
      if (mode === 'copy') {
        const sourceLatest = getLatestScheduleItem(item) || item
        const childTasks = !isScheduleTask(sourceLatest) ? findChildTasksForParent(scheduleMap, sourceLatest) : []
        const newItemId = `s-${Date.now()}`
        const newItem = {
          ...sourceLatest,
          id: newItemId,
          user_id: session.uid,
          date: targetDateKey,
          completed: false,
          relatedPrev: null,
          relatedNext: null,
          parentId: null,
          parentDate: null,
          isTask: isScheduleTask(sourceLatest),
          time: isScheduleTask(sourceLatest) ? null : sourceLatest.time,
          endTime: isScheduleTask(sourceLatest) ? null : sourceLatest.endTime,
        }

        const batch = writeBatch(db)
        batch.set(doc(db, 'schedule_items', `${session.uid}_${targetDateKey}_${newItemId}`), newItem)

        const copiedChildren = childTasks.map((child, index) => {
          const childId = `s-${Date.now()}-c${index}`
          const newChild = {
            id: childId,
            user_id: session.uid,
            title: child.title || 'タスク',
            isTask: true,
            time: null,
            endTime: null,
            details: child.details || '',
            completed: false,
            priority: child.priority || 'normal',
            date: targetDateKey,
            relatedPrev: null,
            relatedNext: null,
            parentId: newItemId,
            parentDate: targetDateKey,
          }
          batch.set(doc(db, 'schedule_items', `${session.uid}_${targetDateKey}_${childId}`), newChild)
          return newChild
        })

        await batch.commit()
        setScheduleMap((current) => {
          const next = { ...current }
          const targetList = next[targetDateKey] || []
          next[targetDateKey] = sortDayScheduleItems([...targetList, newItem, ...copiedChildren])
          return next
        })
        invalidateScheduleWeeks([item.date, targetDateKey])
        clearScheduleCache()
        setSelectedDate(new Date(`${targetDateKey}T00:00:00`))
        closeMoveCopyDialog()
        await fetchWeekSchedule()
        const notes = []
        if (hasScheduleRelation(sourceLatest)) notes.push('関連付けはコピーされていません')
        if (childTasks.length > 0) notes.push(`配下タスク${childTasks.length}件も複製しました`)
        const copiedNote = notes.length > 0 ? `（${notes.join('／')}）` : ''
        alert(`${targetDateKey} に予定を複製しました${copiedNote}`)
        return
      }

      const { latest, priorItem, nextItem } = await loadScheduleRelationNeighbors(item)
      const childTasks = findChildTasksForParent(scheduleMap, latest)
      const relationsValid = scheduleItemRelationsValidAt(latest, targetDateKey, { priorItem, nextItem })
      const relationStripped = hasScheduleRelation(latest) && !relationsValid
      const relatedPrev = relationStripped ? null : (latest.relatedPrev || null)
      const relatedNext = relationStripped ? null : (latest.relatedNext || null)

      const sourceRef = doc(db, 'schedule_items', `${session.uid}_${item.date}_${item.id}`)
      const destRef = doc(db, 'schedule_items', `${session.uid}_${targetDateKey}_${item.id}`)
      const movedItem = {
        ...latest,
        user_id: session.uid,
        date: targetDateKey,
        completed: latest.completed === true,
        relatedPrev,
        relatedNext,
        parentId: null,
        parentDate: null,
      }

      const batch = writeBatch(db)
      batch.set(destRef, movedItem)
      batch.delete(sourceRef)

      const movedChildren = childTasks.map((child) => {
        const sourceChildRef = doc(db, 'schedule_items', `${session.uid}_${child.date}_${child.id}`)
        const destChildRef = doc(db, 'schedule_items', `${session.uid}_${targetDateKey}_${child.id}`)
        const movedChild = {
          ...child,
          user_id: session.uid,
          date: targetDateKey,
          parentId: latest.id,
          parentDate: targetDateKey,
          relatedPrev: null,
          relatedNext: null,
        }
        batch.set(destChildRef, movedChild)
        batch.delete(sourceChildRef)
        return movedChild
      })

      if (relationStripped) {
        await queueDetachScheduleItemRelations(batch, latest, session.uid)
      } else if (hasScheduleRelation(latest)) {
        await queueUpdateRelationSnapshotsAfterMove(batch, movedItem, session.uid, { priorItem, nextItem })
      }

      await batch.commit()
      setScheduleMap((current) => {
        const next = { ...current }
        if (next[item.date]) {
          const removeIds = new Set([item.id, ...childTasks.map((child) => child.id)])
          next[item.date] = next[item.date].filter((entry) => !removeIds.has(entry.id))
        }
        const targetList = next[targetDateKey] || []
        const withoutMoved = targetList.filter((entry) => entry.id !== item.id && !movedChildren.some((child) => child.id === entry.id))
        next[targetDateKey] = sortDayScheduleItems([...withoutMoved, movedItem, ...movedChildren])
        return next
      })
      invalidateScheduleWeeks([item.date, targetDateKey])
      clearScheduleCache()
      setSelectedDate(new Date(`${targetDateKey}T00:00:00`))
      closeMoveCopyDialog()
      await fetchWeekSchedule()
      if (relationStripped) {
        notifyScheduleAction(MOVE_RELATION_STRIPPED_NOTICE)
      } else {
        const childNote = childTasks.length > 0 ? `（配下タスク${childTasks.length}件も移動）` : ''
        alert(`${item.date} から ${targetDateKey} に予定を移動しました${childNote}`)
      }
    } catch (error) {
      console.error('予定の複製/移動エラー:', error)
      alert(`予定の${mode === 'copy' ? '複製' : '移動'}に失敗しました:\n${error.message}`)
    }
  }

  const executeMoveOrCopy = async (mode) => {
    await proceedMoveOrCopy(mode, false)
  }

  const openDetail = (item) => {
    const latest = getLatestScheduleItem(item) || item
    if (latest.completed === true) {
      notifyScheduleAction(COMPLETED_SCHEDULE_NOT_EDITABLE_MSG)
      return
    }
    if (isScheduleChildTask(latest)) {
      const parent = findParentScheduleItem(scheduleMap, latest)
      if (parent?.completed === true) {
        notifyScheduleAction(COMPLETED_SCHEDULE_NOT_EDITABLE_MSG)
        return
      }
    }
    setSaveAsCommonTitle(false)
    setCommonTitlesExpanded(false)
    setDetailDraft({
      id: latest.id,
      title: latest.title || '予定',
      isTask: isScheduleTask(latest),
      time: latest.time || '09:00',
      endTime: latest.endTime || '10:00',
      details: latest.details || '',
      completed: latest.completed === true,
      priority: latest.priority || 'normal',
      date: latest.date || selectedKey,
      relatedPrev: latest.relatedPrev || null,
      relatedNext: latest.relatedNext || null,
      parentId: latest.parentId || null,
      parentDate: latest.parentDate || null,
    })
  }

  const openAddChildTask = (parentItem) => {
    const parent = getLatestScheduleItem(parentItem) || parentItem
    if (!parent || isScheduleTask(parent)) return
    if (parent.completed === true) {
      notifyScheduleAction(COMPLETED_SCHEDULE_NOT_EDITABLE_MSG)
      return
    }
    setSaveAsCommonTitle(false)
    setCommonTitlesExpanded(false)
    setDetailDraft({
      id: `s-${Date.now()}`,
      title: '',
      isTask: true,
      time: '09:00',
      endTime: '10:00',
      details: '',
      completed: false,
      priority: 'normal',
      date: parent.date || selectedKey,
      relatedPrev: null,
      relatedNext: null,
      parentId: parent.id,
      parentDate: parent.date || selectedKey,
    })
  }

  const closeDetail = () => setDetailDraft(null)

  const openRelatedSchedule = async (relationOrItem) => {
    if (!relationOrItem || !session) return
    closeSchedulePreview()
    setRelatedChainModal({ open: true, loading: true, items: [] })

    try {
      const getItem = async (refInfo) => {
        if (!refInfo?.id || !refInfo?.date) return null
        const local = (scheduleMap[refInfo.date] || []).find((entry) => entry.id === refInfo.id)
        if (local) return { ...local, date: refInfo.date }

        const snap = await getDoc(doc(db, 'schedule_items', `${session.uid}_${refInfo.date}_${refInfo.id}`))
        if (snap.exists()) {
          return { id: refInfo.id, date: refInfo.date, ...snap.data() }
        }
        return null
      }

      const startNode = await getItem(relationOrItem)
      if (!startNode) {
        alert('関連する予定が見つかりません。')
        setRelatedChainModal({ open: false, loading: false, items: [] })
        return
      }

      const visited = new Set()
      let headNode = startNode
      visited.add(`${headNode.date}_${headNode.id}`)

      while (headNode.relatedPrev?.id && headNode.relatedPrev?.date) {
        const prevKey = `${headNode.relatedPrev.date}_${headNode.relatedPrev.id}`
        if (visited.has(prevKey)) break
        const prevNode = await getItem(headNode.relatedPrev)
        if (!prevNode) break
        visited.add(prevKey)
        headNode = prevNode
      }

      visited.clear()
      const chain = []
      let currNode = headNode

      while (currNode) {
        const currKey = `${currNode.date}_${currNode.id}`
        if (visited.has(currKey)) break
        visited.add(currKey)
        chain.push(currNode)

        if (currNode.relatedNext?.id && currNode.relatedNext?.date) {
          currNode = await getItem(currNode.relatedNext)
        } else {
          currNode = null
        }
      }

      setRelatedChainModal({ open: true, loading: false, items: chain })
    } catch (error) {
      console.error('関連予定チェーン取得エラー:', error)
      alert(`関連する予定の取得に失敗しました:\n${error.message}`)
      setRelatedChainModal({ open: false, loading: false, items: [] })
    }
  }

  const getLatestScheduleItem = (item) => {
    if (!item?.date || !item?.id) return item
    return (scheduleMap[item.date] || []).find((entry) => entry.id === item.id) || item
  }

  const resolveOrderRelationForItem = async (item) => {
    if (!item) return false
    const latest = getLatestScheduleItem(item) || item
    if (scheduleItemHasOrderRelation(scheduleMap, latest)) return true
    if (!session || !latest.date || !latest.id) return false
    try {
      const snap = await getDoc(doc(db, 'schedule_items', `${session.uid}_${latest.date}_${latest.id}`))
      if (!snap.exists()) return false
      const persisted = normalizeScheduleItem(snap.data(), snap.id)
      return scheduleItemHasOrderRelation(scheduleMap, persisted)
    } catch (error) {
      console.error('順番指定の確認エラー:', error)
      return false
    }
  }

  const notifyScheduleAction = (message) => {
    setScheduleActionNotice(message)
  }

  const askScheduleRelationTimeConfirm = (message, allowProceed = true) => new Promise((resolve) => {
    scheduleRelationTimeConfirmRef.current = resolve
    setScheduleRelationTimeConfirm({ message, allowProceed })
  })

  const finishScheduleRelationTimeConfirm = (confirmed) => {
    const resolve = scheduleRelationTimeConfirmRef.current
    scheduleRelationTimeConfirmRef.current = null
    setScheduleRelationTimeConfirm(null)
    if (typeof resolve === 'function') resolve(confirmed)
  }

  const askScheduleAppConfirm = (message, options = {}) => new Promise((resolve) => {
    scheduleAppConfirmRef.current = resolve
    setScheduleAppConfirm({
      message,
      title: options.title || '確認',
      confirmLabel: options.confirmLabel || 'OK',
      hideCancel: options.hideCancel === true,
    })
  })

  const finishScheduleAppConfirm = (confirmed) => {
    const resolve = scheduleAppConfirmRef.current
    scheduleAppConfirmRef.current = null
    setScheduleAppConfirm(null)
    if (typeof resolve === 'function') resolve(confirmed)
  }

  const closeAllScheduleActionMenus = () => {
    document.querySelectorAll('details.schedule-action-menu[open]').forEach((details) => {
      details.removeAttribute('open')
    })
  }

  const closeOtherScheduleActionMenus = (currentDetails) => {
    document.querySelectorAll('details.schedule-action-menu[open]').forEach((details) => {
      if (details !== currentDetails) details.removeAttribute('open')
    })
  }

  const handleScheduleActionMenuToggle = (event) => {
    const detailsEl = event.currentTarget
    if (detailsEl.open) {
      closeOtherScheduleActionMenus(detailsEl)
    }
  }

  const handleScheduleListPointerDownCapture = (event) => {
    if (!(event.target instanceof Element)) return
    if (event.target.closest('.schedule-actions-mobile, .schedule-action-menu-list')) return
    if (event.target.closest('details.schedule-action-menu[open]')) return
    closeAllScheduleActionMenus()
  }

  const resolveTimedScheduleIndex = (item, timedItems) => {
    if (isScheduleTask(item)) return -1
    let idx = timedItems.findIndex((entry) => entry.id === item.id)
    if (idx >= 0) return idx
    idx = timedItems.findIndex((entry) => (
      entry.id && item.id && String(entry.id) === String(item.id)
    ))
    if (idx >= 0) return idx
    return timedItems.findIndex((entry) => (
      (entry.title || '予定') === (item.title || '予定')
      && (entry.time || '09:00') === (item.time || '09:00')
      && (entry.endTime || '10:00') === (item.endTime || '10:00')
    ))
  }

  const isScheduleSectionSwipeTarget = (target) => {
    if (!(target instanceof Element)) return false
    return Boolean(target.closest(
      'button, summary, details.schedule-action-menu, input, select, textarea, a, label, [role="button"]',
    ))
  }

  const loadScheduleItemFromFirestore = async (dateKey, relation) => {
    if (!session || !dateKey || !relation) return null
    const idsToTry = new Set()
    const resolved = resolveRelationItemId(relation, session.uid)
    if (resolved) idsToTry.add(resolved)
    if (relation.id) idsToTry.add(String(relation.id))

    for (const itemId of idsToTry) {
      try {
        const snap = await getDoc(doc(db, 'schedule_items', `${session.uid}_${dateKey}_${itemId}`))
        if (snap.exists()) {
          return normalizeScheduleItem(snap.data(), snap.id)
        }
      } catch (error) {
        console.error('予定取得エラー:', error)
      }
    }

    if (relation.id && String(relation.id).includes('_')) {
      try {
        const snap = await getDoc(doc(db, 'schedule_items', String(relation.id)))
        if (snap.exists()) {
          return normalizeScheduleItem(snap.data(), snap.id)
        }
      } catch (error) {
        console.error('予定取得エラー:', error)
      }
    }

    return null
  }

  const loadScheduleRelationNeighbors = async (item) => {
    const latestFromMap = getLatestScheduleItem(item) || item
    const latest = {
      ...latestFromMap,
      relatedPrev: latestFromMap.relatedPrev || item.relatedPrev || null,
      relatedNext: latestFromMap.relatedNext || item.relatedNext || null,
    }

    let priorItem = findPriorScheduleBlockingComplete(scheduleMap, latest, session?.uid)
    if (!priorItem && latest.relatedPrev) {
      priorItem = findRelatedScheduleItem(scheduleMap, latest.relatedPrev)
      if (!priorItem) {
        priorItem = await loadScheduleItemFromFirestore(latest.relatedPrev.date, latest.relatedPrev)
      }
    }

    let nextItem = findDependentScheduleItem(scheduleMap, latest, session?.uid)
    if (!nextItem && latest.relatedNext) {
      nextItem = findRelatedScheduleItem(scheduleMap, latest.relatedNext)
      if (!nextItem) {
        nextItem = await loadScheduleItemFromFirestore(latest.relatedNext.date, latest.relatedNext)
      }
    }

    return { latest, priorItem, nextItem }
  }

  const scheduleItemDocRef = (uid, dateKey, relationOrItem) => {
    const rawId = relationOrItem?.id
    if (!uid || !dateKey || !rawId) return null
    const itemId = resolveRelationItemId(relationOrItem, uid) || rawId
    return doc(db, 'schedule_items', `${uid}_${dateKey}_${itemId}`)
  }

  const queueDetachScheduleItemRelations = async (batch, item, uid) => {
    if (!batch || !item || !uid) return
    const itemRelation = toScheduleRelation(item)

    if (item.relatedPrev?.date && item.relatedPrev?.id) {
      const priorRef = scheduleItemDocRef(uid, item.relatedPrev.date, item.relatedPrev)
      if (priorRef) {
        const snap = await getDoc(priorRef)
        if (snap.exists() && isSameScheduleRelation(snap.data().relatedNext, itemRelation)) {
          batch.update(priorRef, { relatedNext: null })
        }
      }
    }

    if (item.relatedNext?.date && item.relatedNext?.id) {
      const nextRef = scheduleItemDocRef(uid, item.relatedNext.date, item.relatedNext)
      if (nextRef) {
        const snap = await getDoc(nextRef)
        if (snap.exists() && isSameScheduleRelation(snap.data().relatedPrev, itemRelation)) {
          batch.update(nextRef, { relatedPrev: null })
        }
      }
    }

    for (const dateKey of Object.keys(scheduleMap || {})) {
      for (const entry of scheduleMap[dateKey] || []) {
        if (isScheduleTask(entry) || !entry.relatedNext?.date) continue
        if (!scheduleRelationPointsToItem(entry.relatedNext, item, uid)) continue
        const entryRef = scheduleItemDocRef(uid, entry.date, entry)
        if (entryRef) batch.update(entryRef, { relatedNext: null })
      }
    }
  }

  const queueUpdateRelationSnapshotsAfterMove = async (batch, movedItem, uid, { priorItem, nextItem }) => {
    if (!batch || !movedItem || !uid) return
    const movedRelation = toScheduleRelation(movedItem)

    const prior = priorItem || (movedItem.relatedPrev
      ? findRelatedScheduleItem(scheduleMap, movedItem.relatedPrev)
      : null)
    if (prior?.date && prior?.id) {
      const priorRef = scheduleItemDocRef(uid, prior.date, prior)
      if (priorRef) batch.update(priorRef, { relatedNext: movedRelation })
    }

    const next = nextItem || (movedItem.relatedNext
      ? findRelatedScheduleItem(scheduleMap, movedItem.relatedNext)
      : null)
    if (next?.date && next?.id) {
      const nextRef = scheduleItemDocRef(uid, next.date, next)
      if (nextRef) batch.update(nextRef, { relatedPrev: movedRelation })
    }

    for (const dateKey of Object.keys(scheduleMap || {})) {
      for (const entry of scheduleMap[dateKey] || []) {
        if (isScheduleTask(entry) || !entry.relatedNext?.date) continue
        if (!scheduleRelationPointsToItem(entry.relatedNext, movedItem, uid)) continue
        const entryRef = scheduleItemDocRef(uid, entry.date, entry)
        if (entryRef) batch.update(entryRef, { relatedNext: movedRelation })
      }
    }
  }

  const confirmScheduleRelationTimeChangeIfNeeded = async (item, newStart, newEnd, newDate) => {
    if (isScheduleTask(item)) return true
    const latestFromMap = getLatestScheduleItem(item) || item
    const latest = {
      ...latestFromMap,
      relatedPrev: latestFromMap.relatedPrev || item.relatedPrev || null,
      relatedNext: latestFromMap.relatedNext || item.relatedNext || null,
    }
    const originalStart = latest.time || '09:00'
    const originalEnd = latest.endTime || '10:00'
    const originalDate = latest.date
    const targetDate = newDate || originalDate
    const timesChanged = newStart !== originalStart || newEnd !== originalEnd
    const dateChanged = targetDate !== originalDate
    if (!timesChanged && !dateChanged) return true
    if (!scheduleItemHasOrderRelation(scheduleMap, latest)) return true

    const { priorItem, nextItem } = await loadScheduleRelationNeighbors(latest)

    const { warningLines, blockLines } = buildScheduleRelationTimeChangeConfirm({
      item: latest,
      newStart,
      newEnd,
      originalStart,
      originalEnd,
      newDate: targetDate,
      originalDate,
      priorItem,
      nextItem,
    })

    if (blockLines.length > 0) {
      await askScheduleRelationTimeConfirm(
        `${blockLines.join('\n\n')}\n\n関連と日時に矛盾があるため、変更できません。`,
        false,
      )
      return false
    }

    if (warningLines.length === 0) return true

    return askScheduleRelationTimeConfirm(
      `${warningLines.join('\n\n')}\n\nこの内容で日時を変更しますか？`,
      true,
    )
  }

  const ensurePriorScheduleCompleteBeforeComplete = async (item, chainItems = []) => {
    if (!session || item.completed || isScheduleTask(item)) return true

    let previousItem = findPriorScheduleBlockingComplete(scheduleMap, item, session?.uid)

    if (!previousItem && chainItems.length > 0) {
      for (const entry of chainItems) {
        if (isScheduleTask(entry) || !entry.relatedNext?.date) continue
        if (scheduleRelationPointsToItem(entry.relatedNext, item)) {
          previousItem = entry
          break
        }
      }
      if (!previousItem && item.relatedPrev?.date) {
        previousItem = chainItems.find((entry) => {
          if (entry.date !== item.relatedPrev.date) return false
          if (item.relatedPrev.id) return entry.id === item.relatedPrev.id
          return (
            (entry.title || '予定') === (item.relatedPrev.title || '予定')
            && (entry.time || '09:00') === (item.relatedPrev.time || '09:00')
          )
        }) || null
      }
    }

    if (!previousItem && item.relatedPrev?.date) {
      previousItem = await loadScheduleItemFromFirestore(item.relatedPrev.date, item.relatedPrev)
    }

    if (!previousItem) return true

    if (previousItem.completed !== true) {
      notifyScheduleAction(INCOMPLETE_PREVIOUS_SCHEDULE_MSG)
      return false
    }
    return true
  }

  const toggleRelatedItemCompleted = async (item) => {
    await toggleCompleted(item)
  }

  const openSchedulePreview = (item) => {
    setSchedulePreview(getLatestScheduleItem(item) || item)
  }

  const closeSchedulePreview = () => setSchedulePreview(null)

  const closeScheduleActionMenu = (event) => {
    event.currentTarget.closest('details')?.removeAttribute('open')
  }

  const editScheduleFromPreview = () => {
    if (!schedulePreview) return
    const latest = getLatestScheduleItem(schedulePreview) || schedulePreview
    if (latest.completed === true) {
      notifyScheduleAction(COMPLETED_SCHEDULE_NOT_EDITABLE_MSG)
      return
    }
    openDetail(latest)
    closeSchedulePreview()
  }

  const persistCommonTitles = async (nextTitles) => {
    if (!session) return
    await setDoc(doc(db, 'common_titles', session.uid), { titles: nextTitles })
    setCommonTitles(nextTitles)
  }

  const addCommonTitle = async (title) => {
    const trimmed = title.trim()
    if (!trimmed || !session) return
    const withoutDup = commonTitles.filter((t) => t !== trimmed)
    const nextTitles = [trimmed, ...withoutDup].slice(0, MAX_COMMON_TITLES)
    try {
      await persistCommonTitles(nextTitles)
    } catch (error) {
      console.error('定例タイトル保存エラー:', error)
      alert(`定例タイトルの保存に失敗しました:\n${error.message}`)
    }
  }

  const removeCommonTitle = async (title) => {
    if (!session) return
    const nextTitles = commonTitles.filter((t) => t !== title)
    try {
      await persistCommonTitles(nextTitles)
    } catch (error) {
      console.error('定例タイトル削除エラー:', error)
      alert(`定例タイトルの削除に失敗しました:\n${error.message}`)
    }
  }

  const saveDetailDraft = async () => {
    if (!session || !detailDraft || savingDraft) return

    if (!detailDraft.title.trim()) {
      alert('タイトルを入力してください。')
      return
    }

    const isTask = detailDraft.isTask === true
    const isChildTask = Boolean(detailDraft.parentId)
    const startTime = normalizeScheduleTimeInput(detailDraft.time, '09:00')
    const endTime = normalizeScheduleTimeInput(detailDraft.endTime, '10:00')
    const isTimedSchedule = !isTask && !isChildTask

    if (isTimedSchedule && !isValidTimeRange(detailDraft.time, detailDraft.endTime)) {
      await askScheduleAppConfirm(INVALID_TIME_RANGE_MSG, {
        title: '時刻の矛盾',
        confirmLabel: 'OK',
        hideCancel: true,
      })
      return
    }

    const itemId = detailDraft.id?.startsWith('new-') ? `s-${Date.now()}` : (detailDraft.id || `s-${Date.now()}`)
    const dateKey = detailDraft.date || selectedKey
    const parentId = isChildTask ? detailDraft.parentId : null
    const parentDate = isChildTask ? (detailDraft.parentDate || dateKey) : null

    if (isChildTask) {
      const parent = findParentScheduleItem(scheduleMap, {
        isTask: true,
        parentId,
        parentDate,
        date: dateKey,
      }) || (scheduleMap[parentDate] || []).find((entry) => entry.id === parentId)
      if (parent?.completed === true) {
        notifyScheduleAction(COMPLETED_SCHEDULE_NOT_EDITABLE_MSG)
        return
      }
    }

    if (isTask && !isChildTask && (await resolveOrderRelationForItem({ ...detailDraft, id: itemId, date: dateKey }))) {
      notifyScheduleAction(TASK_CONVERT_REQUIRES_UNLINK_MSG)
      return
    }

    const existingLatest = getLatestScheduleItem({ id: itemId, date: dateKey }) || null
    const isNewScheduleItem = !(scheduleMap[dateKey] || []).some((entry) => entry.id === itemId)
    if (isNewScheduleItem) {
      const allowed = await ensureDemoCanCreateScheduleItems([{ dateKey, count: 1 }])
      if (!allowed) return
    }

    const convertingScheduleToTask = Boolean(
      isTask
      && !isChildTask
      && existingLatest
      && !isScheduleTask(existingLatest),
    )
    const childTasksToDelete = convertingScheduleToTask
      ? findChildTasksForParent(scheduleMap, existingLatest)
      : []

    if (!isTask) {
      const confirmed = await confirmScheduleRelationTimeChangeIfNeeded(
        { ...detailDraft, id: itemId, date: dateKey },
        startTime,
        endTime,
        dateKey,
      )
      if (!confirmed) return
    }

    setSavingDraft(true)
    try {
      const itemRef = doc(db, 'schedule_items', `${session.uid}_${dateKey}_${itemId}`)

      const baseFields = {
        id: itemId,
        user_id: session.uid,
        title: detailDraft.title.trim(),
        details: detailDraft.details || '',
        completed: detailDraft.completed === true,
        priority: detailDraft.priority || 'normal',
        date: dateKey,
        isTask: isTask || isChildTask,
      }

      const batch = writeBatch(db)

      if (isTask || isChildTask) {
        batch.set(itemRef, {
          ...baseFields,
          isTask: true,
          time: deleteField(),
          endTime: deleteField(),
          relatedPrev: deleteField(),
          relatedNext: deleteField(),
          parentId: parentId || deleteField(),
          parentDate: parentDate || deleteField(),
        }, { merge: true })
      } else {
        batch.set(itemRef, {
          ...baseFields,
          time: startTime,
          endTime: endTime,
          relatedPrev: detailDraft.relatedPrev || null,
          relatedNext: detailDraft.relatedNext || null,
          parentId: deleteField(),
          parentDate: deleteField(),
        }, { merge: true })
      }

      childTasksToDelete.forEach((child) => {
        batch.delete(doc(db, 'schedule_items', `${session.uid}_${child.date}_${child.id}`))
      })

      await batch.commit()

      const localItem = (isTask || isChildTask)
        ? normalizeScheduleItem({
          ...baseFields,
          isTask: true,
          time: null,
          endTime: null,
          relatedPrev: null,
          relatedNext: null,
          parentId,
          parentDate,
        })
        : {
          ...baseFields,
          time: startTime,
          endTime: endTime,
          relatedPrev: detailDraft.relatedPrev || null,
          relatedNext: detailDraft.relatedNext || null,
          parentId: null,
          parentDate: null,
        }

      upsertScheduleItemLocal(localItem)
      childTasksToDelete.forEach((child) => {
        removeScheduleItemLocal(child.date, child.id)
      })
      if (saveAsCommonTitle) {
        await addCommonTitle(localItem.title)
      }
      setSaveAsCommonTitle(false)
      setDetailDraft(null)
      fetchWeekSchedule()
    } catch (error) {
      console.error('予定保存エラー:', error)
      alert(`予定保存に失敗しました:\n${error.message}`)
    } finally {
      setSavingDraft(false)
    }
  }

  const deleteScheduleItem = async (item) => {
    if (!session) return

    const latest = getLatestScheduleItem(item) || item

    if (!isScheduleTask(latest)) {
      const childTasks = findChildTasksForParent(scheduleMap, latest)
      if (childTasks.length > 0) {
        notifyScheduleAction(SCHEDULE_DELETE_HAS_CHILDREN_MSG)
        return
      }
    }

    if (scheduleItemHasOrderRelation(scheduleMap, latest)) {
      notifyScheduleAction(SCHEDULE_DELETE_REQUIRES_UNLINK_MSG)
      return
    }

    const selectedRef = doc(db, 'schedule_items', `${session.uid}_${item.date}_${item.id}`)

    try {
      const selectedSnap = await getDoc(selectedRef)
      if (!selectedSnap.exists()) {
        alert('削除対象の予定が見つかりません。')
        removeScheduleItemLocal(item.date, item.id)
        return
      }

      const persisted = normalizeScheduleItem(selectedSnap.data(), selectedSnap.id)
      if (!isScheduleTask(persisted) && findChildTasksForParent(scheduleMap, persisted).length > 0) {
        notifyScheduleAction(SCHEDULE_DELETE_HAS_CHILDREN_MSG)
        fetchWeekSchedule()
        return
      }
      if (scheduleItemHasOrderRelation(scheduleMap, persisted)) {
        notifyScheduleAction(SCHEDULE_DELETE_REQUIRES_UNLINK_MSG)
        fetchWeekSchedule()
        return
      }
    } catch (error) {
      console.error('予定の関連付け確認エラー:', error)
      alert(`予定の確認に失敗しました:\n${error.message}`)
      return
    }

    const itemKind = isScheduleChildTask(latest) ? '配下タスク' : (isScheduleTask(latest) ? 'タスク' : '予定')
    const displayTitle = latest.title || itemKind
    if (!(await askScheduleAppConfirm(
      `「${displayTitle}」の${itemKind}を削除しますか？`,
      { title: '削除の確認', confirmLabel: '削除する' },
    ))) return

    try {
      await deleteDoc(selectedRef)
      removeScheduleItemLocal(item.date, item.id)
      fetchWeekSchedule()
    } catch (error) {
      console.error('予定削除エラー:', error)
      alert(`予定削除に失敗しました:\n${error.message}`)
    }
  }

  const clearLongPress = () => {
    if (holdTimerRef.current) {
      clearTimeout(holdTimerRef.current)
      holdTimerRef.current = null
    }
  }

  const SCHEDULE_LONG_PRESS_MS = 420
  const SCHEDULE_LONG_PRESS_MOVE_PX = 14
  const DOUBLE_TAP_THRESHOLD_MS = 350

  const lockScrollForScheduleDrag = () => {
    if (typeof document === 'undefined' || scheduleScrollLockRef.current) return
    const mainEl = mainRef.current
    const sectionEl = scheduleSectionRef.current
    const preventTouchMove = (event) => {
      if (!scheduleDragRef.current) return
      event.preventDefault()
    }
    scheduleScrollLockRef.current = {
      bodyOverflow: document.body.style.overflow,
      htmlOverflow: document.documentElement.style.overflow,
      mainOverflowY: mainEl ? mainEl.style.overflowY : '',
      sectionOverflowY: sectionEl ? sectionEl.style.overflowY : '',
      sectionTouchAction: sectionEl ? sectionEl.style.touchAction : '',
      windowScrollY: window.scrollY || window.pageYOffset || 0,
      mainScrollTop: mainEl ? mainEl.scrollTop : 0,
      sectionScrollTop: sectionEl ? sectionEl.scrollTop : 0,
      preventTouchMove,
    }
    document.documentElement.classList.add('schedule-card-reorder-active')
    document.body.style.overflow = 'hidden'
    document.documentElement.style.overflow = 'hidden'
    if (mainEl) mainEl.style.overflowY = 'hidden'
    if (sectionEl) {
      sectionEl.style.overflowY = 'hidden'
      sectionEl.style.touchAction = 'none'
    }
    document.addEventListener('touchmove', preventTouchMove, { passive: false })
  }

  const unlockScrollForScheduleDrag = () => {
    if (typeof document === 'undefined') return
    const lock = scheduleScrollLockRef.current
    if (!lock) return
    document.documentElement.classList.remove('schedule-card-reorder-active')
    document.body.style.overflow = lock.bodyOverflow
    document.documentElement.style.overflow = lock.htmlOverflow
    const mainEl = mainRef.current
    const sectionEl = scheduleSectionRef.current
    if (mainEl) {
      mainEl.style.overflowY = lock.mainOverflowY
      mainEl.scrollTop = lock.mainScrollTop
    }
    if (sectionEl) {
      sectionEl.style.overflowY = lock.sectionOverflowY
      sectionEl.style.touchAction = lock.sectionTouchAction
      sectionEl.scrollTop = lock.sectionScrollTop
    }
    window.scrollTo(0, lock.windowScrollY)
    document.removeEventListener('touchmove', lock.preventTouchMove)
    scheduleScrollLockRef.current = null
  }

  const clearScheduleDrag = () => {
    clearLongPress()
    const drag = scheduleDragRef.current
    if (drag?.pointerId != null && drag?.captureEl) {
      try {
        if (drag.captureEl.hasPointerCapture?.(drag.pointerId)) {
          drag.captureEl.releasePointerCapture(drag.pointerId)
        }
      } catch {
        // ignore
      }
    }
    scheduleDragRef.current = null
    setScheduleDrag(null)
    unlockScrollForScheduleDrag()
  }

  const resolveDropPlaceFromPoint = (clientX, clientY, draggedItemId) => {
    const el = document.elementFromPoint(clientX, clientY)
    if (!(el instanceof Element)) return { overItemId: null, place: null }
    const card = el.closest('[data-schedule-card-id]')
    if (!card) return { overItemId: null, place: null }
    const overItemId = card.getAttribute('data-schedule-card-id')
    if (!overItemId || overItemId === draggedItemId) return { overItemId: null, place: null }
    if (card.getAttribute('data-schedule-draggable') !== '1') return { overItemId: null, place: null }
    const rect = card.getBoundingClientRect()
    const place = clientY < rect.top + rect.height / 2 ? 'before' : 'after'
    return { overItemId, place }
  }

  const beginScheduleCardDrag = (item, event, captureEl) => {
    if (!item || item.completed || isScheduleTask(item)) return
    closeAllScheduleActionMenus()
    clearLongPress()
    lastCardTapRef.current = { id: null, time: 0 }
    scheduleDragMovedRef.current = true
    const next = {
      itemId: item.id,
      pointerId: event.pointerId,
      originY: event.clientY,
      deltaY: 0,
      overItemId: null,
      place: null,
      captureEl,
    }
    scheduleDragRef.current = next
    setScheduleDrag(next)
    lockScrollForScheduleDrag()
    try {
      captureEl?.setPointerCapture?.(event.pointerId)
    } catch {
      // ignore
    }
    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
      try {
        navigator.vibrate(12)
      } catch {
        // ignore
      }
    }
  }

  const updateScheduleCardDrag = (event) => {
    const drag = scheduleDragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    const drop = resolveDropPlaceFromPoint(event.clientX, event.clientY, drag.itemId)
    const next = {
      ...drag,
      deltaY: event.clientY - drag.originY,
      overItemId: drop.overItemId,
      place: drop.place,
    }
    scheduleDragRef.current = next
    setScheduleDrag(next)
  }

  const finishScheduleCardDrag = async (event) => {
    const drag = scheduleDragRef.current
    if (!drag || (event && drag.pointerId !== event.pointerId)) {
      clearScheduleDrag()
      return
    }

    const drop = event
      ? resolveDropPlaceFromPoint(event.clientX, event.clientY, drag.itemId)
      : { overItemId: drag.overItemId, place: drag.place }

    const item = (scheduleMap[selectedKey] || []).find((entry) => entry.id === drag.itemId)
      || selectedItems.find((entry) => entry.id === drag.itemId)

    clearScheduleDrag()

    if (!item || !drop.overItemId || !drop.place) return
    const target = (scheduleMap[selectedKey] || []).find((entry) => entry.id === drop.overItemId)
      || selectedItems.find((entry) => entry.id === drop.overItemId)
    if (!target || isScheduleTask(target) || target.completed) return

    if (drop.place === 'before') {
      await placeTimedScheduleBefore(item, target)
    } else {
      await placeTimedScheduleAfter(item, target)
    }
  }

  const handleScheduleCardPointerDown = (item, event) => {
    if (event.button != null && event.button !== 0) return
    if (!(event.target instanceof Element)) return
    if (event.target.closest('.schedule-actions-mobile, .schedule-action-menu, .schedule-complete-btn, .schedule-child-task-list, a, button, input, select, textarea, summary, label')) {
      return
    }
    if (item.completed || isScheduleTask(item)) return
    if (scheduleDragRef.current) return

    clearLongPress()
    scheduleDragMovedRef.current = false
    const startX = event.clientX
    const startY = event.clientY
    const captureEl = event.currentTarget
    const pointerId = event.pointerId

    holdTimerRef.current = window.setTimeout(() => {
      holdTimerRef.current = null
      beginScheduleCardDrag(item, { pointerId, clientY: startY }, captureEl)
    }, SCHEDULE_LONG_PRESS_MS)

    const onMove = (moveEvent) => {
      if (moveEvent.pointerId !== pointerId) return
      if (scheduleDragRef.current?.itemId === item.id) {
        updateScheduleCardDrag(moveEvent)
        moveEvent.preventDefault()
        return
      }
      const dx = moveEvent.clientX - startX
      const dy = moveEvent.clientY - startY
      if (Math.hypot(dx, dy) > SCHEDULE_LONG_PRESS_MOVE_PX) {
        clearLongPress()
      }
    }

    const onUp = (upEvent) => {
      if (upEvent.pointerId !== pointerId) return
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
      if (scheduleDragRef.current?.itemId === item.id) {
        void finishScheduleCardDrag(upEvent)
        return
      }
      clearLongPress()
    }

    window.addEventListener('pointermove', onMove, { passive: false })
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
  }

  // タップ間隔を自前で判定し、ダブルタップ時のみプレビューを開く（一回の軽いタッチでは開かない）
  const handleScheduleCardTap = (item) => {
    if (scheduleDragMovedRef.current) {
      scheduleDragMovedRef.current = false
      return
    }
    closeAllScheduleActionMenus()
    const now = Date.now()
    const last = lastCardTapRef.current
    if (last.id === item.id && now - last.time < DOUBLE_TAP_THRESHOLD_MS) {
      lastCardTapRef.current = { id: null, time: 0 }
      openSchedulePreview(item)
    } else {
      lastCardTapRef.current = { id: item.id, time: now }
    }
  }

  const stopScheduleCardActionBubble = (event) => {
    event.stopPropagation()
  }

  const handleAddSchedule = () => {
    const todayKey = formatDateKey(new Date())
    if (selectedKey < todayKey) {
      alert('過去の日付に対する予定の追加です。')
    }
    setSaveAsCommonTitle(false)
    setCommonTitlesExpanded(false)
    setDetailDraft({
      id: `new-${Date.now()}`,
      title: '',
      isTask: false,
      time: '09:00',
      endTime: '10:00',
      details: '',
      completed: false,
      priority: 'normal',
      date: selectedKey,
      relatedPrev: null,
      relatedNext: null,
      parentId: null,
      parentDate: null,
    })
  }

  const toggleCompleted = async (item) => {
    if (!session) return

    try {
      const latestItem = getLatestScheduleItem(item) || item

      if (isScheduleChildTask(latestItem)) {
        const parent = findParentScheduleItem(scheduleMap, latestItem)
        if (parent?.completed === true) {
          notifyScheduleAction(CHILD_COMPLETE_LOCKED_BY_PARENT_MSG)
          return
        }
      }

      if (!latestItem.completed) {
        const allowed = await ensurePriorScheduleCompleteBeforeComplete(latestItem)
        if (!allowed) return
      }

      const childTasks = !isScheduleTask(latestItem)
        ? findChildTasksForParent(scheduleMap, latestItem)
        : []

      if (latestItem.completed) {
        const confirmMessage = childTasks.length > 0
          ? `この予定の完了を取り消すと、配下のタスク${childTasks.length}件も未完了に戻ります。よろしいですか？`
          : '完了を取り消しますか？'
        if (!(await askScheduleAppConfirm(confirmMessage, {
          title: childTasks.length > 0 ? '完了取り消しの確認' : '確認',
          confirmLabel: '取り消す',
        }))) return
      } else {
        const confirmMessage = childTasks.length > 0
          ? `この予定を完了にすると、配下のタスク${childTasks.length}件も完了になります。よろしいですか？`
          : 'この予定を完了にしますか？'
        if (!(await askScheduleAppConfirm(confirmMessage, {
          title: childTasks.length > 0 ? '完了の確認' : '確認',
          confirmLabel: '完了する',
        }))) return
      }

      const nextCompleted = !latestItem.completed
      const batch = writeBatch(db)
      const nextItem = { ...latestItem, completed: nextCompleted, user_id: session.uid }
      batch.set(doc(db, 'schedule_items', `${session.uid}_${latestItem.date}_${latestItem.id}`), nextItem)

      childTasks.forEach((child) => {
        const nextChild = { ...child, completed: nextCompleted, user_id: session.uid }
        batch.set(doc(db, 'schedule_items', `${session.uid}_${child.date}_${child.id}`), nextChild)
      })

      await batch.commit()
      upsertScheduleItemLocal(nextItem)
      childTasks.forEach((child) => {
        upsertScheduleItemLocal({ ...child, completed: nextCompleted, user_id: session.uid })
      })
      setRelatedChainModal((prev) => {
        if (!prev.open) return prev
        const updatedByKey = new Map([
          [`${nextItem.date}_${nextItem.id}`, nextItem],
          ...childTasks.map((child) => [
            `${child.date}_${child.id}`,
            { ...child, completed: nextCompleted, user_id: session.uid },
          ]),
        ])
        return {
          ...prev,
          items: prev.items.map((entry) => updatedByKey.get(`${entry.date}_${entry.id}`) || entry),
        }
      })
      fetchWeekSchedule()
    } catch (error) {
      console.error('完了状態更新エラー:', error)
      alert(`完了状態の更新に失敗しました:\n${error.message}`)
    }
  }

  const addOneHourWithCap = (startTimeStr) => {
    const [hStr, mStr] = (startTimeStr || '09:00').split(':')
    let hours = parseInt(hStr, 10)
    let minutes = parseInt(mStr, 10)
    if (Number.isNaN(hours)) hours = 9
    if (Number.isNaN(minutes)) minutes = 0

    let endHours = hours + 1
    let endMinutes = minutes

    if (endHours > 23 || (endHours === 23 && endMinutes > 59)) {
      return '23:59'
    }
    return `${String(endHours).padStart(2, '0')}:${String(endMinutes).padStart(2, '0')}`
  }

  const timeToMinutes = (timeStr) => {
    const [h, m] = (timeStr || '00:00').split(':').map((v) => parseInt(v, 10) || 0)
    return h * 60 + m
  }

  const minutesToTime = (mins) => {
    const clamped = Math.max(0, Math.min(23 * 60 + 59, mins))
    const h = Math.floor(clamped / 60)
    const m = clamped % 60
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
  }

  const getTimedScheduleDurationMins = (item) => (
    Math.max(30, timeToMinutes(item.endTime || '10:00') - timeToMinutes(item.time || '09:00'))
  )

  /** 指定予定の直前に置く時刻（既存「上に移動」と同系統） */
  const buildTimesToPlaceBefore = (item, targetItem, itemImmediatelyBeforeTarget) => {
    let newStartTime = ''
    let newEndTime = ''
    if (itemImmediatelyBeforeTarget) {
      newStartTime = itemImmediatelyBeforeTarget.endTime || '09:00'
      newEndTime = targetItem.time || addOneHourWithCap(newStartTime)
      if (parseTimeValue(newEndTime) <= parseTimeValue(newStartTime)) {
        newEndTime = addOneHourWithCap(newStartTime)
      }
    } else {
      const targetStartMins = timeToMinutes(targetItem.time || '09:00')
      const startMins = Math.max(0, targetStartMins - 60)
      newStartTime = minutesToTime(startMins)
      newEndTime = targetItem.time || minutesToTime(startMins + 60)
      if (parseTimeValue(newEndTime) <= parseTimeValue(newStartTime)) {
        newEndTime = addOneHourWithCap(newStartTime)
      }
    }

    const isNoChange = newStartTime === (item.time || '09:00') && newEndTime === (item.endTime || '10:00')
    const isNotMovingUp = parseTimeValue(newStartTime) >= parseTimeValue(targetItem.time || '09:00')
    return { newStartTime, newEndTime, needsOverlapConfirm: isNoChange || isNotMovingUp }
  }

  const adjustTimesForOverlapBefore = (item, targetItem) => {
    const targetStartMins = timeToMinutes(targetItem.time || '09:00')
    const adjustedStartMins = Math.max(0, targetStartMins - 1)
    const newStartTime = minutesToTime(adjustedStartMins)
    const adjustedEndMins = Math.min(23 * 60 + 59, adjustedStartMins + getTimedScheduleDurationMins(item))
    return { newStartTime, newEndTime: minutesToTime(adjustedEndMins) }
  }

  /** 指定予定の直後に置く時刻（既存「下に移動」と同系統） */
  const buildTimesToPlaceAfter = (item, targetItem) => {
    const newStartTime = targetItem.endTime || '10:00'
    let newEndTime = addOneHourWithCap(newStartTime)
    const isNoChange = newStartTime === (item.time || '09:00') && newEndTime === (item.endTime || '10:00')
    const isNotMovingDown = parseTimeValue(newStartTime) <= parseTimeValue(targetItem.time || '09:00')
    return { newStartTime, newEndTime, needsOverlapConfirm: isNoChange || isNotMovingDown }
  }

  const adjustTimesForOverlapAfter = (item, targetItem) => {
    const targetStartMins = timeToMinutes(targetItem.time || '09:00')
    const adjustedStartMins = Math.min(23 * 60 + 59, targetStartMins + 1)
    const newStartTime = minutesToTime(adjustedStartMins)
    const adjustedEndMins = Math.min(23 * 60 + 59, adjustedStartMins + getTimedScheduleDurationMins(item))
    return { newStartTime, newEndTime: minutesToTime(adjustedEndMins) }
  }

  const commitTimedScheduleTimeMove = async (item, newStartTime, newEndTime) => {
    if (!session || !newStartTime || !newEndTime) return false

    const relationTimeConfirmed = await confirmScheduleRelationTimeChangeIfNeeded(
      item,
      newStartTime,
      newEndTime,
    )
    if (!relationTimeConfirmed) return false

    const updatedItem = {
      ...item,
      time: newStartTime,
      endTime: newEndTime,
      user_id: session.uid,
    }

    upsertScheduleItemLocal(updatedItem)

    try {
      await setDoc(doc(db, 'schedule_items', `${session.uid}_${item.date}_${item.id}`), updatedItem)
      fetchWeekSchedule()
      return true
    } catch (error) {
      console.error('予定の移動エラー:', error)
      alert(`予定の移動に失敗しました:\n${error.message}`)
      fetchWeekSchedule()
      return false
    }
  }

  const placeTimedScheduleBefore = async (item, targetItem) => {
    if (!session || !item || !targetItem || item.completed || isScheduleTask(item) || isScheduleTask(targetItem)) return
    if (item.id === targetItem.id) return

    const items = filterTimedSchedules(selectedItems)
    const without = items.filter((entry) => entry.id !== item.id)
    const targetIndex = without.findIndex((entry) => entry.id === targetItem.id)
    if (targetIndex < 0) return

    const fullIndex = items.findIndex((entry) => entry.id === item.id)
    const fullTargetIndex = items.findIndex((entry) => entry.id === targetItem.id)
    if (fullIndex >= 0 && fullTargetIndex === fullIndex + 1) return

    const itemImmediatelyBeforeTarget = targetIndex > 0 ? without[targetIndex - 1] : null
    let built = buildTimesToPlaceBefore(item, targetItem, itemImmediatelyBeforeTarget)
    if (built.needsOverlapConfirm) {
      const confirmResult = window.confirm(
        '移動先の予定と時間が重複するため、開始時間を調整して移動します。よろしいですか？',
      )
      if (!confirmResult) return
      built = adjustTimesForOverlapBefore(item, targetItem)
    }
    await commitTimedScheduleTimeMove(item, built.newStartTime, built.newEndTime)
  }

  const placeTimedScheduleAfter = async (item, targetItem) => {
    if (!session || !item || !targetItem || item.completed || isScheduleTask(item) || isScheduleTask(targetItem)) return
    if (item.id === targetItem.id) return

    const items = filterTimedSchedules(selectedItems)
    const fullIndex = items.findIndex((entry) => entry.id === item.id)
    const fullTargetIndex = items.findIndex((entry) => entry.id === targetItem.id)
    if (fullIndex >= 0 && fullTargetIndex === fullIndex - 1) return
    if (fullTargetIndex < 0) return

    let built = buildTimesToPlaceAfter(item, targetItem)
    if (built.needsOverlapConfirm) {
      const confirmResult = window.confirm(
        '移動先の予定と時間が重複するため、開始時間を調整して移動します。よろしいですか？',
      )
      if (!confirmResult) return
      built = adjustTimesForOverlapAfter(item, targetItem)
    }
    await commitTimedScheduleTimeMove(item, built.newStartTime, built.newEndTime)
  }

  const moveScheduleItem = async (item, direction) => {
    if (!session || item.completed || isScheduleTask(item)) return

    const items = filterTimedSchedules(selectedItems)
    const index = items.findIndex((entry) => entry.id === item.id)
    if (index < 0) return

    if (direction === 'up') {
      if (index === 0) return
      await placeTimedScheduleBefore(item, items[index - 1])
      return
    }

    if (direction === 'down') {
      if (index === items.length - 1) return
      await placeTimedScheduleAfter(item, items[index + 1])
    }
  }

  const copyToFutureFourWeeks = async (item) => {
    if (!session) return

    const latest = getLatestScheduleItem(item) || item
    if (isScheduleChildTask(latest)) return

    const sourceDate = new Date(`${latest.date}T00:00:00`)
    const targetDates = Array.from({ length: 4 }, (_, index) => formatDateKey(addDays(sourceDate, (index + 1) * 7)))
    const displayTitle = latest.title || (isScheduleTask(latest) ? 'タスク' : '予定')
    const childTasks = !isScheduleTask(latest) ? findChildTasksForParent(scheduleMap, latest) : []
    const childNote = childTasks.length > 0
      ? `\n配下タスク${childTasks.length}件も各週にコピーされます（関連付けはコピーされません）。`
      : '\n複製先には関連付けはコピーされません。'

    if (!(await askScheduleAppConfirm(
      `未来4週間（${targetDates.length}件）に「${displayTitle}」をコピーしますか？${childNote}`,
      { title: '未来4週間コピーの確認', confirmLabel: 'コピーする' },
    ))) return

    const perWeekCount = 1 + childTasks.length
    const allowed = await ensureDemoCanCreateScheduleItems(
      targetDates.map((dateKey) => ({ dateKey, count: perWeekCount })),
    )
    if (!allowed) return

    try {
      const batch = writeBatch(db)
      let createdCount = 0
      targetDates.forEach((targetDateKey, weekIndex) => {
        const newItemId = `s-${Date.now()}-${weekIndex}-${targetDateKey}`
        const newItem = {
          id: newItemId,
          user_id: session.uid,
          title: latest.title,
          isTask: isScheduleTask(latest),
          time: isScheduleTask(latest) ? null : latest.time,
          endTime: isScheduleTask(latest) ? null : latest.endTime,
          details: latest.details,
          completed: false,
          priority: latest.priority || 'normal',
          date: targetDateKey,
          relatedPrev: null,
          relatedNext: null,
          parentId: null,
          parentDate: null,
        }
        batch.set(doc(db, 'schedule_items', `${session.uid}_${targetDateKey}_${newItemId}`), newItem)
        createdCount += 1

        childTasks.forEach((child, childIndex) => {
          const childId = `s-${Date.now()}-${weekIndex}-c${childIndex}-${targetDateKey}`
          batch.set(doc(db, 'schedule_items', `${session.uid}_${targetDateKey}_${childId}`), {
            id: childId,
            user_id: session.uid,
            title: child.title || 'タスク',
            isTask: true,
            time: null,
            endTime: null,
            details: child.details || '',
            completed: false,
            priority: child.priority || 'normal',
            date: targetDateKey,
            relatedPrev: null,
            relatedNext: null,
            parentId: newItemId,
            parentDate: targetDateKey,
          })
          createdCount += 1
        })
      })
      await batch.commit()
      fetchWeekSchedule()
      notifyScheduleAction(FUTURE_FOUR_WEEKS_COPY_DONE_MSG(createdCount))
    } catch (error) {
      console.error('未来4週間コピーエラー:', error)
      alert(`未来4週間コピーに失敗しました:\n${error.message}`)
    }
  }

  const closeRelationDialog = () => setRelationDialog(null)

  const dismissScheduleActionNotice = () => {
    setScheduleActionNotice(null)
    closeSchedulePreview()
    closeDetail()
    closeRelationDialog()
    closeMoveCopyDialog()
    setRelatedChainModal({ open: false, loading: false, items: [] })
  }

  const openRelationDialog = async (item) => {
    if (!session) return
    if (isScheduleTask(item)) {
      alert('タスクには「先に終わらせる予定」を設定できません。')
      return
    }

    try {
      const q = query(collection(db, 'schedule_items'), where('user_id', '==', session.uid))
      const snapshot = await getDocs(q)
      const allItems = []

      snapshot.forEach((docSnap) => {
        const entry = docSnap.data()
        allItems.push(normalizeScheduleItem(entry, docSnap.id))
      })

      const candidates = allItems
        .filter((candidate) => {
          if (isScheduleTask(candidate)) return false
          if (candidate.id === item.id && candidate.date === item.date) return false
          if (candidate.completed) return false
          return isRelatablePreviousSchedule(candidate, item)
        })
        .sort((a, b) => {
          if (a.date !== b.date) return b.date.localeCompare(a.date)
          return parseTimeValue(b.endTime || '10:00') - parseTimeValue(a.endTime || '10:00')
        })

      const sameDayCandidates = candidates.filter((candidate) => candidate.date === item.date)
      const otherDayCandidates = candidates.filter((candidate) => candidate.date !== item.date)
      const recommended = pickSameDayRecommendedPrevious(candidates, item)
      const recommendedKey = recommended ? relationKeyFromItem(recommended) : ''

      setRelationDialog({
        item,
        candidates,
        sameDayCandidates,
        otherDayCandidates,
        showOtherDays: otherDayCandidates.length > 0 && sameDayCandidates.length === 0,
        recommendedKey,
        selectedCandidateKey: item.relatedPrev ? relationKeyFromItem(item.relatedPrev) : recommendedKey,
      })
    } catch (error) {
      console.error('関連付け候補取得エラー:', error)
      alert(`関連付け候補の取得に失敗しました:\n${error.message}`)
    }
  }

  const applyRecommendedScheduleRelation = () => {
    if (!relationDialog?.recommendedKey) return
    void applyScheduleRelation(relationDialog.recommendedKey)
  }

  const applyScheduleRelation = async (overrideCandidateKey) => {
    if (!session || !relationDialog) return
    const selectedCandidateKey = overrideCandidateKey || relationDialog.selectedCandidateKey
    if (!selectedCandidateKey) {
      alert('先に終わらせる予定を選択してください。')
      return
    }

    const selectedItem = relationDialog.item
    const selectedItemRef = toScheduleRelation(selectedItem)
    const nextPreviousItem = relationDialog.candidates.find((candidate) => relationKeyFromItem(candidate) === selectedCandidateKey)
    if (!nextPreviousItem) {
      alert('選択した関連付け対象が見つかりません。')
      return
    }

    const linkedNext = nextPreviousItem.relatedNext
    if (linkedNext && !isSameScheduleRelation(linkedNext, selectedItemRef)) {
      alert('選択した予定にはすでに次の予定が関連付いています。別の予定を選択してください。')
      return
    }

    try {
      const selectedRef = doc(db, 'schedule_items', `${session.uid}_${selectedItem.date}_${selectedItem.id}`)
      const previousRef = doc(db, 'schedule_items', `${session.uid}_${nextPreviousItem.date}_${nextPreviousItem.id}`)

      const batch = writeBatch(db)
      batch.update(selectedRef, { relatedPrev: toScheduleRelation(nextPreviousItem) })
      batch.update(previousRef, { relatedNext: selectedItemRef })

      if (selectedItem.relatedPrev && !isSameScheduleRelation(selectedItem.relatedPrev, nextPreviousItem)) {
        const oldPreviousRef = doc(db, 'schedule_items', `${session.uid}_${selectedItem.relatedPrev.date}_${selectedItem.relatedPrev.id}`)
        const oldPreviousSnap = await getDoc(oldPreviousRef)
        if (oldPreviousSnap.exists() && isSameScheduleRelation(oldPreviousSnap.data().relatedNext, selectedItemRef)) {
          batch.update(oldPreviousRef, { relatedNext: null })
        }
      }

      await batch.commit()

      upsertScheduleItemLocal({
        ...selectedItem,
        relatedPrev: toScheduleRelation(nextPreviousItem),
      })
      upsertScheduleItemLocal({
        ...nextPreviousItem,
        relatedNext: toScheduleRelation(selectedItem),
      })

      closeRelationDialog()
      fetchWeekSchedule()
      alert('関連付けを更新しました。')
    } catch (error) {
      console.error('関連付け更新エラー:', error)
      alert(`関連付けの更新に失敗しました:\n${error.message}`)
    }
  }

  const clearScheduleRelation = async () => {
    if (!session || !relationDialog) return

    const selectedItem = relationDialog.item
    if (!selectedItem.relatedPrev) {
      closeRelationDialog()
      return
    }

    try {
      const selectedRef = doc(db, 'schedule_items', `${session.uid}_${selectedItem.date}_${selectedItem.id}`)
      const previousRef = doc(db, 'schedule_items', `${session.uid}_${selectedItem.relatedPrev.date}_${selectedItem.relatedPrev.id}`)
      const previousSnap = await getDoc(previousRef)
      const updates = [updateDoc(selectedRef, { relatedPrev: null })]
      const previousRelation = selectedItem.relatedPrev
      const clearsPreviousRelation = previousSnap.exists() && isSameScheduleRelation(previousSnap.data().relatedNext, toScheduleRelation(selectedItem))

      if (clearsPreviousRelation) {
        updates.push(updateDoc(previousRef, { relatedNext: null }))
      }

      await Promise.all(updates)
      setScheduleMap((current) => {
        const next = { ...current }
        Object.entries(current).forEach(([dateKey, items]) => {
          next[dateKey] = items.map((item) => {
            if (item.id === selectedItem.id && item.date === selectedItem.date) {
              return { ...item, relatedPrev: null }
            }
            if (clearsPreviousRelation && item.id === previousRelation.id && item.date === previousRelation.date) {
              return { ...item, relatedNext: null }
            }
            return item
          })
        })
        return next
      })
      setRelationDialog((current) => (current ? { ...current, item: { ...current.item, relatedPrev: null } } : current))
      setMoveCopyDialog(null)
      closeRelationDialog()
      fetchWeekSchedule()
      alert('関連付けを解除しました。')
    } catch (error) {
      console.error('関連付け解除エラー:', error)
      alert(`関連付けの解除に失敗しました:\n${error.message}`)
    }
  }

  const fetchIncompleteItemsList = async () => {
    if (!session) return []
    const todayKey = formatDateKey(new Date())
    const q = query(collection(db, 'schedule_items'), where('user_id', '==', session.uid))
    const snapshot = await getDocs(q)

    const allItems = []
    snapshot.forEach((docSnap) => {
      const item = docSnap.data()
      const dateKey = item.date
      allItems.push(normalizeScheduleItem({ ...item, date: dateKey }, docSnap.id))
    })

    const parentLookup = new Map(
      allItems
        .filter((entry) => !isScheduleTask(entry))
        .map((entry) => [`${entry.date}_${entry.id}`, entry]),
    )

    const items = allItems
      .filter((item) => item.completed !== true)
      .map((item) => {
        const dayDate = new Date(`${item.date}T00:00:00`)
        const parent = isScheduleChildTask(item)
          ? parentLookup.get(`${item.parentDate || item.date}_${item.parentId}`)
          : null
        return {
          ...item,
          dateKey: item.date,
          dayName: dayNames[dayDate.getDay()],
          isPast: item.date < todayKey,
          parentLabel: parent ? formatChildTaskParentLabel(parent) : '',
        }
      })

    items.sort((a, b) => {
      if (a.dateKey !== b.dateKey) return a.dateKey.localeCompare(b.dateKey)
      const aTask = isScheduleTask(a)
      const bTask = isScheduleTask(b)
      if (aTask !== bTask) return aTask ? 1 : -1
      if (isScheduleChildTask(a) !== isScheduleChildTask(b)) return isScheduleChildTask(a) ? 1 : -1
      if (aTask && bTask) return String(a.id).localeCompare(String(b.id))
      return parseTimeValue(a.time || '09:00') - parseTimeValue(b.time || '09:00')
    })
    return items
  }

  useEffect(() => {
    if (view !== 'incompleteList' || !session) return
    let cancelled = false
    setIncompleteLoading(true)
    fetchIncompleteItemsList()
      .then((items) => {
        if (!cancelled) setIncompleteItems(items)
      })
      .catch((error) => {
        console.error('未完了一覧取得エラー:', error)
        if (!cancelled) alert(`未完了一覧の取得に失敗しました:\n${error.message}`)
      })
      .finally(() => {
        if (!cancelled) setIncompleteLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [view, session])

  const openAggregationModal = () => {
    // フォームの年月日は週カレンダーで表示中の月を初期値とする
    const baseDate = selectedDate
    const monthStart = new Date(baseDate.getFullYear(), baseDate.getMonth(), 1)
    const monthEnd = new Date(baseDate.getFullYear(), baseDate.getMonth() + 1, 0)
    setAggStartDate(formatDateKey(monthStart))
    setAggEndDate(formatDateKey(monthEnd))
    setAggFilter('all')
    setAggError('')
    setAggResult(null)
    setAggregationOpen(true)
  }

  const closeAggregationModal = () => {
    setAggregationOpen(false)
  }

  const runAggregation = async () => {
    if (!session) return
    setAggError('')
    setAggResult(null)

    if (!aggStartDate || !aggEndDate) {
      setAggError('開始日と終了日を指定してください')
      return
    }
    if (aggStartDate > aggEndDate) {
      setAggError('開始日は終了日以前の日付を指定してください')
      return
    }
    const diffDays = Math.round(
      (new Date(`${aggEndDate}T00:00:00`) - new Date(`${aggStartDate}T00:00:00`)) / 86400000
    ) + 1
    if (diffDays > AGGREGATION_MAX_DAYS) {
      setAggError(`集計期間は${AGGREGATION_MAX_DAYS}日以内で指定してください`)
      return
    }

    setLoading(true)
    try {
      const q = query(
        collection(db, 'schedule_items'),
        where('user_id', '==', session.uid),
        where('date', '>=', aggStartDate),
        where('date', '<=', aggEndDate)
      )
      const snapshot = await getDocs(q)
      const groups = new Map()

      snapshot.forEach((docSnap) => {
        const item = docSnap.data()
        if (aggFilter === 'completed' && item.completed !== true) return
        if (item.isTask === true) return
        const title = item.title || '予定'
        const minutes = Math.max(0, parseTimeValue(item.endTime || '10:00') - parseTimeValue(item.time || '09:00'))
        const current = groups.get(title) || { title, count: 0, totalMinutes: 0 }
        current.count += 1
        current.totalMinutes += minutes
        groups.set(title, current)
      })

      const rows = Array.from(groups.values()).sort((a, b) => {
        if (b.totalMinutes !== a.totalMinutes) return b.totalMinutes - a.totalMinutes
        if (b.count !== a.count) return b.count - a.count
        return a.title.localeCompare(b.title, 'ja')
      })

      const totalCount = rows.reduce((sum, row) => sum + row.count, 0)
      const totalMinutes = rows.reduce((sum, row) => sum + row.totalMinutes, 0)

      setAggResult({
        rows,
        totalCount,
        totalMinutes,
        periodText: `${aggStartDate} ～ ${aggEndDate}`,
        filterLabel: aggFilter === 'completed' ? '完了のみ' : '全て',
      })
    } catch (error) {
      console.error('スケジュール集計エラー:', error)
      setAggError(`集計に失敗しました:\n${error.message}`)
    } finally {
      setLoading(false)
    }
  }

  const outputAggregationPdf = () => {
    if (!aggResult) return

    const reportWindow = window.open('', '_blank', 'width=1000,height=750')
    if (!reportWindow) {
      alert('帳票画面を開けませんでした。ポップアップを許可してください。')
      return
    }

    const rows = aggResult.rows.length
      ? aggResult.rows.map((row) => `
          <tr>
            <td>${escapeHtml(row.title)}</td>
            <td>${row.count}</td>
            <td>${row.totalMinutes}</td>
          </tr>`).join('') + `
          <tr class="total-row">
            <td>合計</td>
            <td>${aggResult.totalCount}</td>
            <td>${aggResult.totalMinutes}</td>
          </tr>`
      : '<tr><td colspan="3" class="empty">該当する予定はありません</td></tr>'

    const html = `<!doctype html>
      <html lang="ja">
        <head>
          <meta charset="UTF-8" />
          <title>スケジュール集計</title>
          <style>
            @page { size: A4 portrait; margin: 12mm; }
            * { box-sizing: border-box; }
            body { margin: 0; color: #172033; font-family: "Noto Sans JP", "Yu Gothic", Meiryo, sans-serif; }
            h1 { margin: 0 0 5px; font-size: 24px; }
            .period { color: #64748b; margin-bottom: 4px; font-size: 13px; }
            .output-date { color: #475569; margin-bottom: 18px; font-size: 13px; }
            table { width: 100%; border-collapse: collapse; table-layout: fixed; font-size: 13px; }
            th, td { border: 1px solid #cbd5e1; padding: 7px 8px; text-align: left; vertical-align: top; overflow-wrap: anywhere; }
            th { background: #e8f0ff; color: #1e3a8a; }
            th:nth-child(2), td:nth-child(2), th:nth-child(3), td:nth-child(3) { width: 18%; text-align: right; }
            .total-row td { font-weight: 700; background: #f1f5f9; }
            .empty { text-align: center; color: #64748b; padding: 24px; }
            .actions { display: flex; justify-content: flex-end; gap: 10px; margin-bottom: 14px; }
            button { border: 0; border-radius: 10px; background: #2563eb; color: white; padding: 12px 20px; font-size: 15px; font-weight: 700; cursor: pointer; }
            .close-button { background: #64748b; }
            @media print { .actions { display: none; } }
          </style>
        </head>
        <body>
          <div class="actions"><button onclick="window.print()">PDFとして保存 / 印刷</button><button class="close-button" onclick="window.close()">閉じる</button></div>
          <h1>スケジュール集計</h1>
          <div class="period">対象期間: ${escapeHtml(aggResult.periodText)}（${escapeHtml(aggResult.filterLabel)}）</div>
          <div class="output-date">出力日: ${escapeHtml(formatDisplayDate(new Date()))}</div>
          <table>
            <thead><tr><th>予定名</th><th>件数</th><th>合計時間(分)</th></tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </body>
      </html>`

    const blobUrl = URL.createObjectURL(new Blob([html], { type: 'text/html' }))
    setTimeout(() => {
      if (reportWindow.closed) {
        URL.revokeObjectURL(blobUrl)
        return
      }
      reportWindow.location.href = blobUrl
      reportWindow.focus()
    }, 0)
    setTimeout(() => URL.revokeObjectURL(blobUrl), 60000)
  }

  const outputAggregationCsv = () => {
    if (!aggResult) return

    const lines = [['予定名', '件数', '合計時間(分)'].map(escapeCsvField).join(',')]
    aggResult.rows.forEach((row) => {
      lines.push([row.title, row.count, row.totalMinutes].map(escapeCsvField).join(','))
    })
    lines.push(['合計', aggResult.totalCount, aggResult.totalMinutes].map(escapeCsvField).join(','))

    // ExcelでもUTF-8として文字化けしないようにBOMを付与する
    const csvContent = `\uFEFF${lines.join('\r\n')}`
    const blobUrl = URL.createObjectURL(new Blob([csvContent], { type: 'text/csv;charset=utf-8;' }))
    const link = document.createElement('a')
    link.href = blobUrl
    link.download = `schedule_summary_${aggStartDate}_${aggEndDate}.csv`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    setTimeout(() => URL.revokeObjectURL(blobUrl), 60000)
  }

  const saveManualStepsForSelectedDay = async () => {
    if (stepsCsvBusy || !healthLifeCountEnabled) return
    const trimmed = stepManualDraft.trim()
    if (!trimmed) {
      alert('歩数を入力してください。')
      return
    }
    const steps = Number(trimmed.replace(/,/g, ''))
    if (!Number.isFinite(steps) || steps < 0 || !Number.isInteger(steps)) {
      alert('0以上の整数で歩数を入力してください。')
      return
    }
    setStepsCsvBusy(true)
    try {
      const next = await upsertStepsCsvRow({
        date: selectedKey,
        steps,
        source: 'manual',
        is_final: true,
        updated_at: formatJstIsoTimestamp(),
      })
      setStepsByDate(next)
      if (typeof window !== 'undefined') {
        window.localStorage.setItem(STEPS_LINKED_STORAGE_KEY, 'true')
      }
      const wasEmpty = !stepsByDate || stepsByDate.size === 0
      if (wasEmpty) {
        alert('歩数を記録しました。保存用CSV（steps_daily.csv 相当）を新規作成しました。')
      }
    } catch (error) {
      console.error('歩数記録エラー:', error)
      alert(`歩数の保存に失敗しました:\n${error.message}`)
    } finally {
      setStepsCsvBusy(false)
    }
  }

  const handleStepsCsvFileChange = async (event) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file || stepsCsvBusy) return
    setStepsCsvBusy(true)
    try {
      const text = await file.text()
      const next = await importStepsCsvText(text, { replace: false })
      setStepsByDate(next)
      if (typeof window !== 'undefined' && next.size > 0) {
        window.localStorage.setItem(STEPS_LINKED_STORAGE_KEY, 'true')
      }
      alert(`歩数CSVを取り込みました（${next.size}日分）。`)
    } catch (error) {
      console.error('歩数CSV取込エラー:', error)
      alert(`歩数CSVの取り込みに失敗しました:\n${error.message}`)
    } finally {
      setStepsCsvBusy(false)
    }
  }

  const handleClearStepsCsvWeb = async () => {
    if (Capacitor.isNativePlatform()) return
    if (!window.confirm('ブラウザに保存した歩数CSV（localStorage）を削除します。fixtures のサンプルファイルは消えません。よろしいですか？')) return
    await clearStepsCsvWebOnly()
    setStepsByDate(new Map())
    setStepManualDraft('')
  }

  const openSleepReport = async () => {
    if (!session) return

    const reportWindow = window.open('', '_blank', 'width=1000,height=750')
    if (!reportWindow) {
      alert('帳票画面を開けませんでした。ポップアップを許可してください。')
      return
    }

    reportWindow.document.write(`<!doctype html><html lang="ja"><head><meta charset="UTF-8" /><title>健康生活PDFを準備中</title><style>body{margin:0;padding:48px 24px;color:#172033;font-family:"Noto Sans JP","Yu Gothic",Meiryo,sans-serif;text-align:center}.progress-box{max-width:480px;margin:40px auto;text-align:left}.progress-track{height:12px;background:#e2e8f0;border-radius:6px;overflow:hidden}.progress-bar{width:35%;height:100%;background:#0f766e;animation:progress 1.2s ease-in-out infinite alternate}@keyframes progress{from{width:15%}to{width:85%}}</style></head><body><h1>健康生活PDFを準備しています</h1><div class="progress-box"><p>対象月のデータを読み込んでいます...</p><div class="progress-track" role="progressbar" aria-label="読み込み中"><div class="progress-bar"></div></div></div></body></html>`)
    reportWindow.document.close()

    const year = selectedDate.getFullYear()
    const month = selectedDate.getMonth()
    const daysInMonth = new Date(year, month + 1, 0).getDate()
    const monthStartKey = formatDateKey(new Date(year, month, 1))
    const monthEndKey = formatDateKey(new Date(year, month, daysInMonth))
    const completedPlanCounts = {}
    const scheduleByDate = {}

    try {
      const scheduleSnapshot = await getDocs(query(
        collection(db, 'schedule_items'),
        where('user_id', '==', session.uid),
        where('date', '>=', monthStartKey),
        where('date', '<=', monthEndKey)
      ))
      scheduleSnapshot.forEach((docSnap) => {
        const item = docSnap.data()
        if (!item.date) return
        if (item.completed === true && item.isTask !== true) {
          completedPlanCounts[item.date] = (completedPlanCounts[item.date] || 0) + 1
        }
        if (!scheduleByDate[item.date]) scheduleByDate[item.date] = []
        scheduleByDate[item.date].push(normalizeScheduleItem(item, docSnap.id))
      })
    } catch (error) {
      console.error('月別計画数取得エラー:', error)
      if (!reportWindow.closed) reportWindow.close()
      alert(`計画数の取得に失敗しました:\n${error.message}`)
      return
    }

    if (reportWindow.closed) return

    let pdfStepsByDate = new Map()
    try {
      pdfStepsByDate = await loadStepsByDate()
    } catch (error) {
      console.error('健康生活PDF 歩数CSV読込:', error)
    }

    const reportRows = Array.from({ length: daysInMonth }, (_, index) => {
      const date = new Date(year, month, index + 1)
      const dateKey = formatDateKey(date)
      const record = sleepRecordMap[dateKey]
      const wakeTime = record?.wakeTime || ''
      const currentBedtime = record?.bedtime || ''
      const previousDateKey = formatDateKey(addDays(date, -1))
      const previousBedtime = sleepRecordMap[previousDateKey]?.bedtime || ''
      let minutes = null
      if (previousBedtime && wakeTime) {
        minutes = parseTimeValue(wakeTime) - parseTimeValue(previousBedtime)
        if (minutes <= 0) minutes += 24 * 60
      }
      return { dateKey, dayName: dayNames[date.getDay()], currentBedtime, previousBedtime, wakeTime, minutes, completedPlanCount: completedPlanCounts[dateKey] || 0 }
    })
    const todayKey = formatDateKey(new Date())
    const fatigueByDay = reportRows.map((row, index) => {
      const date = new Date(year, month, index + 1)
      const dayScheduleMap = { [row.dateKey]: scheduleByDate[row.dateKey] || [] }
      const stepsForScoring = getStepsForScoring(pdfStepsByDate, row.dateKey)
      const fatigue = computeFatigueScore(date, sleepRecordMap, dayScheduleMap, {
        isToday: row.dateKey === todayKey,
        stepsForScoring,
      })
      const stepRow = getStepsForDisplay(pdfStepsByDate, row.dateKey)
      const stepPoints = fatigue.breakdown.steps?.points ?? null
      return {
        dateKey: row.dateKey,
        score: fatigue.score,
        bandLabel: fatigue.bandLabel,
        stepCount: stepRow?.steps ?? null,
        stepPoints,
      }
    })
    const todayFatigue = fatigueByDay.find((entry) => entry.dateKey === todayKey)
    const formatDuration = (minutes) => minutes === null ? '-' : `${Math.floor(minutes / 60)}時間${minutes % 60}分`
    const recordedSleepMinutes = reportRows.filter((row) => row.minutes !== null).map((row) => row.minutes)
    const averageSleepMinutes = recordedSleepMinutes.length
      ? Math.round(recordedSleepMinutes.reduce((sum, minutes) => sum + minutes, 0) / recordedSleepMinutes.length)
      : null
    const formatMedSlot = (dateKey, slotKey) => {
      const record = medicationRecordMap[dateKey]
      const slot = record?.slots?.[slotKey]
      if (!slot?.completed) return '未'
      return slot.takenAt ? `済 ${slot.takenAt}` : '済'
    }
    const rows = reportRows.map((row, index) => {
      const fatigue = fatigueByDay[index]
      const stepsCell = fatigue.stepCount === null ? '—' : String(fatigue.stepCount)
      const stepPtsCell = fatigue.stepPoints === null ? '—' : (fatigue.stepPoints > 0 ? `+${fatigue.stepPoints}` : '0')
      return `
      <tr><td>${row.dateKey} (${row.dayName})</td><td>${row.wakeTime || '-'}</td><td>${row.currentBedtime || '-'}</td><td>${row.previousBedtime || '-'}</td><td>${formatDuration(row.minutes)}</td><td>${stepsCell}</td><td>${stepPtsCell}</td><td>${fatigue.score}</td><td>${fatigue.bandLabel}</td><td>${formatMedSlot(row.dateKey, 'morning')}</td><td>${formatMedSlot(row.dateKey, 'noon')}</td><td>${formatMedSlot(row.dateKey, 'evening')}</td><td>${formatMedSlot(row.dateKey, 'bedtime')}</td></tr>`
    }).join('')
    const chartWidth = 760
    const chartHeight = 330
    const plotLeft = 52
    const plotRight = chartWidth - 52
    const plotTop = 44
    const plotBottom = 208
    const barBandTop = 212
    const barBandBottom = 232
    const plotHeight = plotBottom - plotTop
    const barBandHeight = barBandBottom - barBandTop
    const maxMinutes = Math.max(12 * 60, ...reportRows.filter((row) => row.minutes !== null).map((row) => row.minutes))
    const maxCompletedPlans = Math.max(1, ...reportRows.map((row) => row.completedPlanCount))
    const xForIndex = (index) => (
      reportRows.length === 1
        ? (plotLeft + plotRight) / 2
        : plotLeft + (plotRight - plotLeft) * index / (reportRows.length - 1)
    )
    const chartPoints = reportRows.map((row, index) => {
      const x = xForIndex(index)
      const fatigue = fatigueByDay[index]
      const sleepY = row.minutes === null ? null : plotBottom - (row.minutes / maxMinutes) * plotHeight
      const fatigueY = plotBottom - (fatigue.score / 100) * plotHeight
      return { ...row, x, sleepY, fatigueY, fatigueScore: fatigue.score, fatigueBandLabel: fatigue.bandLabel }
    })
    const sleepPoints = chartPoints.filter((point) => point.sleepY !== null)
    const sleepPolyline = sleepPoints.map((point) => `${point.x},${point.sleepY}`).join(' ')
    const fatiguePolyline = chartPoints.map((point) => `${point.x},${point.fatigueY}`).join(' ')
    const targetY = plotBottom - (8 * 60 / maxMinutes) * plotHeight
    const leftHoursLabel = (hours) => `${hours}h`
    const barWidth = Math.max(4, (plotRight - plotLeft) / daysInMonth * 0.58)
    const completionBars = chartPoints.map((point) => {
      const barHeight = point.completedPlanCount / maxCompletedPlans * barBandHeight
      return `<rect x="${point.x - barWidth / 2}" y="${barBandBottom - barHeight}" width="${barWidth}" height="${barHeight}" fill="#f59e0b" opacity="0.78"><title>${point.dateKey}: 完了 ${point.completedPlanCount}件</title></rect>`
    }).join('')
    const monthPrefix = `${year}-${String(month + 1).padStart(2, '0')}`
    const showTodayLegend = todayFatigue && todayKey.startsWith(monthPrefix)
    const combinedChart = `<svg viewBox="0 0 ${chartWidth} ${chartHeight}" role="img" aria-label="日別の健康生活（睡眠・疲れ・完了件数）">
        <rect x="${plotLeft}" y="${barBandTop}" width="${plotRight - plotLeft}" height="${barBandHeight}" fill="#fff7ed" opacity="0.85" />
        <line x1="${plotLeft}" y1="${plotBottom}" x2="${plotRight}" y2="${plotBottom}" stroke="#cbd5e1" />
        <line x1="${plotLeft}" y1="${plotTop}" x2="${plotLeft}" y2="${plotBottom}" stroke="#94a3b8" />
        <line x1="${plotRight}" y1="${plotTop}" x2="${plotRight}" y2="${plotBottom}" stroke="#94a3b8" />
        <line x1="${plotLeft}" y1="${barBandTop}" x2="${plotRight}" y2="${barBandTop}" stroke="#e2e8f0" stroke-dasharray="4 3" />
        <text x="${plotLeft - 6}" y="${plotTop + 4}" text-anchor="end" font-size="9" fill="#115e59">${leftHoursLabel(Math.round(maxMinutes / 60))}</text>
        <text x="${plotLeft - 6}" y="${plotBottom}" text-anchor="end" font-size="9" fill="#115e59">0h</text>
        <text x="${plotLeft - 6}" y="${plotTop + plotHeight / 2 + 3}" text-anchor="end" font-size="8" fill="#64748b">睡眠</text>
        <text x="${plotRight + 6}" y="${plotTop + 4}" text-anchor="start" font-size="9" fill="#5b21b6">100</text>
        <text x="${plotRight + 6}" y="${plotBottom}" text-anchor="start" font-size="9" fill="#5b21b6">0</text>
        <text x="${plotRight + 6}" y="${plotTop + plotHeight / 2 + 3}" text-anchor="start" font-size="8" fill="#64748b">疲れ</text>
        <line x1="${plotLeft}" y1="${targetY}" x2="${plotRight}" y2="${targetY}" stroke="#dc2626" stroke-width="2" stroke-dasharray="6 5" />
        <text x="${plotRight - 4}" y="${targetY - 6}" text-anchor="end" font-size="10" fill="#b91c1c">推奨 8時間</text>
        ${completionBars}
        ${sleepPoints.length ? `<polyline points="${sleepPolyline}" fill="none" stroke="#0f766e" stroke-width="3" />${sleepPoints.map((point, index) => { const labelY = index % 2 === 0 ? point.sleepY - 8 : point.sleepY + 14; return `<circle cx="${point.x}" cy="${point.sleepY}" r="4" fill="#0f766e" /><text x="${point.x}" y="${labelY}" text-anchor="middle" font-size="7" fill="#115e59">${formatDuration(point.minutes)}</text>` }).join('')}` : ''}
        <polyline points="${fatiguePolyline}" fill="none" stroke="#7c3aed" stroke-width="3" />
        ${chartPoints.map((point) => {
          const isToday = point.dateKey === todayKey
          const r = isToday ? 6 : 4
          const fill = isToday ? '#dc2626' : '#7c3aed'
          return `<circle cx="${point.x}" cy="${point.fatigueY}" r="${r}" fill="${fill}"><title>${point.dateKey}: 疲れ ${point.fatigueScore}（${point.fatigueBandLabel}）</title></circle><text x="${point.x}" y="${point.fatigueY - 10}" text-anchor="middle" font-size="8" fill="#5b21b6">${point.fatigueScore}</text>`
        }).join('')}
        ${chartPoints.map((point) => `<text x="${point.x}" y="248" text-anchor="middle" font-size="10" fill="#64748b">${point.dateKey.slice(8)}</text>`).join('')}
        <text x="${plotLeft}" y="268" font-size="10" fill="#0f766e">● 睡眠（左・時間）</text>
        <text x="${plotLeft + 130}" y="268" font-size="10" fill="#7c3aed">● 疲れ（右・0〜100）</text>
        <text x="${plotLeft + 280}" y="268" font-size="10" fill="#d97706">■ 完了件数（下帯・時刻あり予定）</text>
        ${showTodayLegend ? `<text x="${plotRight}" y="268" text-anchor="end" font-size="10" fill="#dc2626">今日の疲れ: ${todayFatigue.score}（${todayFatigue.bandLabel}）</text>` : ''}
        <text x="${plotLeft}" y="284" font-size="9" fill="#64748b">左軸＝睡眠時間　右軸＝疲れスコア　下の橙棒＝その日に完了した時刻あり予定の件数（当月最大を基準にした高さの目安）</text>
      </svg>`

    const html = `<!doctype html><html lang="ja"><head><meta charset="UTF-8" /><title>健康生活PDF</title>
      <style>
        @page { size: A4 portrait; margin: 12mm; } * { box-sizing: border-box; }
        body { margin: 0; color: #172033; font-family: "Noto Sans JP", "Yu Gothic", Meiryo, sans-serif; }
        h1 { margin: 0 0 5px; font-size: 24px; } h2 { margin: 22px 0 10px; font-size: 17px; color: #115e59; }
        .period, .output-date { color: #64748b; font-size: 13px; } .output-date { margin: 4px 0 18px; } .average { margin: 0 0 14px; color: #134e4a; font-size: 15px; } .average span { margin-left: 6px; color: #64748b; font-size: 12px; }
        table { width: 100%; border-collapse: collapse; font-size: 12px; } th, td { border: 1px solid #cbd5e1; padding: 6px 8px; text-align: left; }
        th { background: #ccfbf1; color: #115e59; } .chart-box { border: 1px solid #e2e8f0; padding: 10px; margin-bottom: 14px; } .chart-note { margin: 6px 0 0; font-size: 10px; color: #64748b; line-height: 1.45; } svg { width: 100%; height: auto; }
        .disclaimer { margin-top: 16px; font-size: 11px; color: #64748b; line-height: 1.5; }
        .empty { color: #64748b; text-align: center; padding: 30px; } .actions { display: flex; justify-content: flex-end; gap: 10px; margin-bottom: 14px; }
        button { border: 0; border-radius: 8px; background: #0f766e; color: white; padding: 10px 18px; font-weight: 700; cursor: pointer; } .close-button { background: #64748b; }
        @media print { .actions { display: none; } }
      </style></head><body><div class="actions"><button onclick="window.print()">PDFとして保存 / 印刷</button><button class="close-button" onclick="window.close()">閉じる</button></div>
      <h1>健康生活PDF</h1><div class="period">対象期間: ${year}年${month + 1}月（選択中の月）</div><div class="output-date">出力日: ${escapeHtml(formatDisplayDate(new Date()))}</div>
      <div class="average">当月平均睡眠時間: <strong>${formatDuration(averageSleepMinutes)}</strong><span>（${recordedSleepMinutes.length}日を集計）</span></div>
      <table><thead><tr><th>日付</th><th>起床時間</th><th>就寝時間（当日）</th><th>就寝時間（前日）</th><th>睡眠時間</th><th>歩数</th><th>歩数加点</th><th>疲れ</th><th>帯域</th><th>服薬・朝</th><th>服薬・昼</th><th>服薬・夜</th><th>服薬・寝る前</th></tr></thead><tbody>${rows}</tbody></table>
      <h2>日別の健康生活（睡眠・疲れ・完了件数）</h2><div class="chart-box">${combinedChart}</div>
      <p class="disclaimer">※疲れスコアは睡眠記録と未完了の時刻あり予定から算出した目安であり、医療上の診断・治療の代わりにはなりません。服薬列は記録の表示のみで疲れ加点には使いません。タスク（時刻なし）は疲れ・下帯の完了件数に含みません。達成（連続日数など）はタスク込みです。歩数はCSVで is_final=true の日のみ加点（最大15点）。日別スコアは出力時点の予定データに基づきます。</p></body></html>`
    const blobUrl = URL.createObjectURL(new Blob([html], { type: 'text/html' }))
    setTimeout(() => { if (!reportWindow.closed) { reportWindow.location.href = blobUrl; reportWindow.focus() } }, 0)
    setTimeout(() => URL.revokeObjectURL(blobUrl), 60000)
  }

  const openWeeklyReport = async (reportType) => {
    if (!session) return

    const reportTitle = reportType === 'all' ? 'スケジュール一覧' : '未完了一覧'

    // ポップアップブロック対策: 非同期取得の前にユーザー操作と同じtickでウィンドウを開いておく
    const reportWindow = window.open('', '_blank', 'width=1000,height=750')
    if (!reportWindow) {
      alert('帳票画面を開けませんでした。ポップアップを許可してください。')
      return
    }

    const outputDate = new Date()
    const outputDateKey = formatDateKey(outputDate)

    let reportItems = []
    let periodText = `${formatDateKey(weekDates[0])} ～ ${formatDateKey(weekDates[6])}`

    try {
      if (reportType === 'incomplete') {
        reportItems = await fetchIncompleteItemsList()
        periodText = '全期間'
      } else {
        reportItems = weekDates.flatMap((date) => {
          const dateKey = formatDateKey(date)
          return (scheduleMap[dateKey] || [])
            .map((item) => ({ ...item, dateKey, dayName: dayNames[date.getDay()], isPast: dateKey < outputDateKey }))
        })
      }
    } catch (error) {
      console.error('帳票データ取得エラー:', error)
      if (!reportWindow.closed) reportWindow.close()
      alert(`帳票データの取得に失敗しました:\n${error.message}`)
      return
    }

    if (reportWindow.closed) return

    const rows = reportItems.length
      ? reportItems.map((item) => {
        const parentLabel = item.parentLabel
          || (isScheduleChildTask(item) ? formatChildTaskParentLabel(findParentScheduleItem(scheduleMap, item)) : '')
        const timeLabel = isScheduleChildTask(item)
          ? '配下'
          : isScheduleTask(item)
            ? '—'
            : `${item.time} - ${item.endTime}`
        const titleHtml = parentLabel
          ? `${escapeHtml(item.title)}<div style="margin-top:4px;font-size:11px;color:#64748b;">${escapeHtml(parentLabel)}</div>`
          : escapeHtml(item.title)
        return `
          <tr class="${item.isPast ? 'past-schedule' : ''}">
            <td>${escapeHtml(item.dateKey)} (${item.dayName})</td>
            <td>${escapeHtml(timeLabel)}</td>
            <td>${titleHtml}</td>
            <td>${escapeHtml(item.priority === 'high' ? '重要' : item.priority === 'low' ? '低' : '通常')}</td>
            <td>${escapeHtml(item.details || '')}</td>
            <td>${item.completed ? '完了' : '未完了'}</td>
          </tr>`
      }).join('')
      : '<tr><td colspan="6" class="empty">該当する予定はありません</td></tr>'

    const html = `<!doctype html>
      <html lang="ja">
        <head>
          <meta charset="UTF-8" />
          <title>${escapeHtml(reportTitle)}</title>
          <style>
            @page { size: A4 landscape; margin: 12mm; }
            * { box-sizing: border-box; }
            body { margin: 0; color: #172033; font-family: "Noto Sans JP", "Yu Gothic", Meiryo, sans-serif; }
            h1 { margin: 0 0 5px; font-size: 24px; }
            .period { color: #64748b; margin-bottom: 4px; font-size: 13px; }
            .output-date { color: #475569; margin-bottom: 18px; font-size: 13px; }
            table { width: 100%; border-collapse: collapse; table-layout: fixed; font-size: 11px; }
            th, td { border: 1px solid #cbd5e1; padding: 7px 8px; text-align: left; vertical-align: top; overflow-wrap: anywhere; }
            th { background: #e8f0ff; color: #1e3a8a; }
            .past-schedule td { color: #b45309; background: #fff7ed; }
            th:nth-child(1) { width: 15%; } th:nth-child(2) { width: 15%; } th:nth-child(3) { width: 17%; }
            th:nth-child(4) { width: 9%; } th:nth-child(6) { width: 9%; }
            .empty { text-align: center; color: #64748b; padding: 24px; }
            .actions { display: flex; justify-content: flex-end; gap: 10px; margin-bottom: 14px; }
            button { border: 0; border-radius: 10px; background: #2563eb; color: white; padding: 12px 20px; font-size: 15px; font-weight: 700; cursor: pointer; }
            .close-button { background: #64748b; }
            @media print { .actions { display: none; } }
          </style>
        </head>
        <body>
          <div class="actions"><button onclick="window.print()">PDFとして保存 / 印刷</button><button class="close-button" onclick="window.close()">閉じる</button></div>
          <h1>${escapeHtml(reportTitle)}</h1>
          <div class="period">対象期間: ${escapeHtml(periodText)}</div>
          <div class="output-date">出力日: ${escapeHtml(formatDisplayDate(outputDate))}</div>
          <table>
            <thead><tr><th>日付</th><th>時間</th><th>予定名</th><th>重要度</th><th>詳細</th><th>状態</th></tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </body>
      </html>`

    // document.write は別オリジン扱いされる環境があるため Blob URL への遷移で表示する
    const blobUrl = URL.createObjectURL(new Blob([html], { type: 'text/html' }))
    // window.open 直後は新しいウィンドウの初期化が終わっていないことがあるため、遷移を次のtickにずらす
    setTimeout(() => {
      if (reportWindow.closed) {
        URL.revokeObjectURL(blobUrl)
        return
      }
      reportWindow.location.href = blobUrl
      reportWindow.focus()
    }, 0)
    setTimeout(() => URL.revokeObjectURL(blobUrl), 60000)
  }

  const openUserGuidePdf = async (lang = 'ja') => {
    const reportWindow = window.open('', '_blank', 'width=1000,height=750')
    if (!reportWindow) {
      const alertText = lang === 'en'
        ? 'The user guide could not be opened. Please allow pop-ups and try again.'
        : 'ユーザー案内の画面を開けませんでした。ポップアップを許可してください。'
      alert(alertText)
      return
    }

    reportWindow.document.write('<!doctype html><html lang="ja"><head><meta charset="UTF-8"><title>利用ガイドを準備中</title><style>body{font-family:"Noto Sans JP","Yu Gothic",Meiryo,sans-serif;text-align:center;padding:48px;color:#172033}.track{max-width:460px;height:12px;margin:24px auto;background:#e2e8f0;border-radius:6px;overflow:hidden}.bar{height:100%;width:40%;background:#2563eb;animation:load 1.2s ease-in-out infinite alternate}@keyframes load{from{width:15%}to{width:85%}}</style></head><body><h1>利用ガイドを準備しています</h1><div class="track" role="progressbar" aria-label="読み込み中"><div class="bar"></div></div></body></html>')
    reportWindow.document.close()

    const guideContent = {
      ja: {
        title: `${APP_DISPLAY_NAME} 利用ガイド`,
        subtitle: '予定の追加から進捗管理まで、日々の計画をすっきり整理して使えるガイドです。',
        sections: [
          {
            heading: '1. 予定を登録する',
            body: '画面の「追加」ボタンから、時刻ありのスケジュールまたは「タスク」チェックをオンにした時刻なしの ToDo を登録できます。定例タイトルで繰り返し入力も速くなります。',
            points: [
              '「タスク」は時刻・通知・先に終わらせる予定の指定がありません。一覧では時刻あり予定の下に並びます（一般タスク）。',
              '時刻あり予定のメニューから「タスクを追加」すると、その予定だけの配下タスクを作れます。配下タスクは親カードの中にだけ表示され、一般タスクとは別物です。',
              '定例タイトルを使うと、よく使う予定名をすぐに選べます。',
              '重要度を「重要」にすると、視認性が高くなります。',
              '詳細メモには、会議内容や持ち物などを残せます。',
            ],
          },
          {
            heading: '2. 予定を管理する',
            body: '各カードから完了・複製・移動・削除ができます。時刻あり予定だけ「先に終わらせる予定を選ぶ」で、完了順を1本の流れとして指定できます。ダブルタップで詳細プレビュー。',
            points: [
              '先に終わらせる予定が未完了の間、その予定は完了にできません。',
              '同日の直前候補はおすすめボタンでワンタップ設定できます。別日は「別の日を選ぶ」から選べます。',
              '順番を先に終わらせたい準備は、時刻付きスケジュールにすると指定しやすいです（一般タスク・配下タスクには関連付けがありません）。',
              '配下タスクは完了・編集・削除のみです。親予定を完了／完了取り消しすると、配下もまとめて同じ状態になります（確認あり）。親が完了済みの間は配下の追加・編集・完了変更はできません。',
              '配下タスクがある予定は、配下を削除するまで親を削除できません。親を一般タスクへ変更する場合は、配下が削除される旨の確認があります。',
              '「複製 / 移動」や「未来4週間にコピー」では、配下タスクも一緒にコピー／移動されます。複製先に関連付けは付きません。関連がある予定の移動は、矛盾がある場合のみ関連が自動解除されます。',
              '検索・未完了一覧・スケジュール一覧では配下タスクも表示され、親予定への紐づけが分かります。カレンダーの件数にも含まれます。',
            ],
          },
          {
            heading: '3. 週ごとの一覧と未完了の確認',
            body: 'メニューから「スケジュール一覧」や「未完了一覧」を開くと、今週の予定や未完了の作業をまとめて確認できます。ホームでは「スケジュールを検索」で予定名を検索できます。',
            points: [
              '検索の月移動は、週カレンダーと同じ青いバーで前月・翌月を切り替えます（選択中の日と連動）。',
              '検索クリア（×）は入力欄の右側です。',
              'スケジュール一覧PDFで、外出先でも簡単に確認できます。',
              '未完了一覧PDFで、やるべきことを整理しやすくなります。',
            ],
          },
          {
            heading: '4. カレンダーの表示を切り替える',
            body: '設定メニューの「月カレンダー表示」と「週カレンダー表示」で、月・週カレンダーを個別に表示または非表示にできます。初期状態では両方が表示され、月のみ・週のみ・両方の表示を選べます。',
            points: [
              '表示中のカレンダーが1つだけの場合は、カレンダーがすべて非表示にならないよう、その表示を解除できません。',
              '各日には未完了件数 / 全件数が表示され、全件完了した日は全件数のみ緑色で表示されます。',
              '前月・翌月ボタンで月を移動でき、週カレンダーやスケジュール検索の対象月も自動的に連動します。',
              '週カレンダーで表示中の週の範囲は、月カレンダー上でも色付けされて確認できます。',
              '日付をタップすると選択日が切り替わり、週カレンダーとスケジュールカードにも即座に反映されます。',
              'ヘッダーの折りたたみボタンで、月カレンダーの表示・非表示を切り替えられます。',
            ],
          },
          {
            heading: '5. 睡眠記録を便利に使う',
            body: '睡眠記録では、選択日の起床時刻と当日の就寝時刻を保存できます。「現在時刻」を押すと、その時点の時刻をワンタッチで保存できます。前日の就寝時刻は自動的に参照表示されます。睡眠記録は健康生活カウントの直上に表示されます。',
            points: [
              '時刻を手動で変更した場合は「保存」を押して記録します。',
              '睡眠記録の見出しを押すと、入力欄と詳細を折りたためます。初期状態は開いた状態です。',
              '設定メニューの「睡眠記録表示」で、睡眠記録欄の表示・非表示を切り替えられます。非表示にしても保存済みデータは削除されません。',
              'メニューの「健康生活PDF」から、選択中の月の睡眠一覧・服薬記録と、睡眠・疲れ・完了件数を1枚にまとめた日別グラフを出力できます。',
            ],
          },
          {
            heading: '5b. 服薬記録を使う',
            body: '朝・昼・夜・寝る前の4枠で服薬を記録できます。各枠の時刻は画面内で変更でき、指定時刻の前後30分から未完了の枠がゆっくり点滅します。過去の日も後から記録・取消できます。',
            points: [
              '「完了」で服薬済み、「済」をもう一度押すと取消します。',
              '「通知不要」は服薬の5分前通知だけをオフにします（予定の通知とは別です）。',
              '設定メニューの「服薬記録表示」で表示・非表示を切り替えられます。',
              '睡眠専用ショートカット（?sleep=1）では服薬欄は表示されません。',
              '健康生活PDFの服薬列は表示のみで、疲れスコアには加点しません。',
            ],
          },
          {
            heading: '6. 通知を使う',
            body: '右上の通知ボタンから、時刻ありスケジュールの開始時刻を通知で受け取れます。タスクには通知しません。服薬の5分前通知は服薬記録欄の「通知不要」で別に切り替えられます。ブラウザの通知許可が必要です。',
            points: [
              '通知がオンの場合、予定開始時刻に音や表示で知らせます。',
              'iPhone / Safari はホーム画面に追加後に設定してください。',
              '通知がブロックされている場合は、ブラウザ設定から許可を切り替えてください。',
            ],
          },
          {
            heading: '7. 進捗状況を確認する',
            body: '選択日の予定カードの直下に、連続達成日数と今週のバッジが表示されます。達成の判定はその日のスケジュールとタスクの両方を含みます（全部完了で達成）。',
            points: [
              '進捗率の推移をPDFとして保存できます。',
              '継続のサポートとして、達成感を感じやすくなります。',
              '日々の予定を完了に近づけるための励ましになります。',
            ],
          },
          {
            heading: '8. 健康生活カウントを使う',
            body: '睡眠・時刻あり予定の負荷などをもとに、選択した日の「疲れ」目安（0〜100）を確認できる機能です。設定メニューの「健康生活カウント表示」で表示できます。初期状態はオフです。',
            points: [
              'オンにすると、ホーム画面の末尾（予定リストの下）にセクションが現れます。見出しをタップして開閉できます（月カレンダーと同様）。',
              '表示内容: 疲れスコア（2行）、睡眠・予定の内訳バー、最近3日の平均睡眠（睡眠記録表示がオンのとき）、歩数（連携状態に応じて表示）。',
              '月次の疲れ推移はメニューの「健康生活PDF」の統合グラフ（左＝睡眠・右＝疲れ・下帯＝完了した時刻あり予定）で確認できます。',
              '疲れと内訳の件数は未完了の時刻あり予定のみです。タスクは含みません。達成（連続日数など）はタスク込みです。',
              'セクション内に医療上の免責（診断・治療の代わりにならない旨）があります。詳しい判定のしくみは、ヘルプの「疲れ」判定の説明PDFを参照してください。',
              '表示をオフにしている間は、疲れスコアの計算を行いません。',
              '歩数は端末連携の有無を確認して表示します（未連携のときは「未連携」など）。将来、連携後にスコアへ反映する拡張を予定しています。',
            ],
          },
          {
            heading: '9. スケジュールを集計する',
            body: 'メニューの「スケジュール集計」から、期間と「全て / 完了のみ」を指定して、時刻あり予定名ごとの件数と合計時間(分)を集計できます。タスクは集計に含みません。集計結果はPDFまたはCSVで保存できます。',
            points: [
              '集計期間は31日以内で指定します。超える場合はメッセージが表示されます。',
              '予定名が完全一致するものを1件として集計します。表記を揃えたい場合は定例タイトルの利用が便利です。',
              '集計結果の最下行に合計件数と合計時間が表示されます。',
            ],
          },
          {
            heading: '付録. iPhoneで睡眠記録ショートカットを使う',
            body: 'iPhoneのショートカットアプリから、睡眠記録をすぐに開く専用アイコンをホーム画面に追加できます。共有リンクには「https://ron-sch.vercel.app/?sleep=1」を開く処理だけが登録されています。',
            points: [
              'Safariでヘルプの「iPhone用『睡眠記録』ショートカットを取得」をタップします。',
              'Appleのページが開いたら「ショートカットを取得」をタップし、内容を確認して追加します。',
              'ショートカットアプリで追加したショートカットの「・・・」を開き、共有ボタンから「ホーム画面に追加」を選びます。',
              'ホーム画面の「睡眠記録」アイコンをタップし、アプリにログインすると睡眠記録だけの画面が開きます。',
              '睡眠専用画面ではログアウトやアカウント削除は行えません。通常のアプリURLから開いたときのみ可能です。',
              '初回はSafariでログインが必要な場合があります。パスワードやFirebaseの秘密情報はショートカットに入力しません。',
            ],
          },
        ],
        noteTitle: 'ご利用のコツ',
        note: '毎日少しずつ予定を見直し、完了したものを確認することでセルフマネジメントがしやすくなります。通知と進捗チェックを併用すると、予定の見落としを防ぎやすくなります。',
        footer: '作成日: ' + new Date().toLocaleDateString('ja-JP', { year: 'numeric', month: 'long', day: 'numeric' }),
        saveLabel: 'PDFとして保存 / 印刷',
        closeLabel: '閉じる',
      },
      en: {
        title: `${APP_DISPLAY_NAME_EN} User Guide`,
        subtitle: 'A simple guide to planning ahead, managing tasks, and tracking your progress in daily life.',
        sections: [
          {
            heading: '1. Create a schedule',
            body: 'Tap Add to create a timed schedule or turn on “Task” for a to-do without times. Saved common titles speed up recurring entries.',
            points: [
              'Standalone tasks have no times, notifications, or “finish this first” links. They appear below timed items for that day.',
              'From a timed schedule’s menu, choose “Add task” to create child tasks under that schedule only. Child tasks appear inside the parent card and are separate from standalone tasks.',
              'Common titles let you reuse familiar task names in seconds.',
              'Setting priority to High makes an item stand out more clearly.',
              'Notes are useful for keeping meeting details, packing lists, or reminders.',
            ],
          },
          {
            heading: '2. Manage your schedule',
            body: 'Each card supports complete, duplicate, move, and delete. Timed schedules can link to one prior item you must finish first. Double-tap for preview.',
            points: [
              'You cannot complete a schedule until its linked prior item is complete.',
              'Use the recommended same-day button for the item right before yours, or open “Pick another day” for earlier dates.',
              'If order matters, make prep a timed schedule and link it—standalone tasks and child tasks cannot be linked.',
              'Child tasks support complete, edit, and delete only. Completing or uncompleting the parent applies the same status to all child tasks (with confirmation). While the parent is complete, you cannot add, edit, or change child completion.',
              'You cannot delete a parent while it still has child tasks. Converting a parent into a standalone task asks for confirmation because child tasks will be deleted.',
              'Copy/move and “Copy to next 4 weeks” also copy or move child tasks. Copies do not keep order links. Moving a linked schedule keeps the link when possible; if the new date conflicts, the link is cleared automatically.',
              'Search, incomplete lists, and schedule lists include child tasks with a parent link. Calendar day counts include them too.',
            ],
          },
          {
            heading: '3. Review weekly and incomplete tasks',
            body: 'From the menu, open the weekly schedule and incomplete-task list. On Home, use schedule search to find tasks by name.',
            points: [
              'Month navigation for search uses the same blue bar as the week calendar (synced with the selected date).',
              'Clear search (×) is on the right of the input field.',
              'Weekly and incomplete-task PDF exports make review easy anywhere.',
              'Lists help you focus on what still requires action.',
            ],
          },
          {
            heading: '4. Switch calendar displays',
            body: 'Use "Show Month Calendar" and "Show Week Calendar" in the settings menu to show or hide each calendar independently. Both are shown by default, and you can use the month calendar only, the week calendar only, or both.',
            points: [
              'When only one calendar is visible, it cannot be turned off, so at least one calendar always remains on screen.',
              'Each day shows incomplete tasks / total tasks. When all tasks are complete, only the total is shown in green.',
              'Use the previous/next month buttons to browse months; the week calendar and schedule search stay in sync with the selected month.',
              'The week currently shown in the week calendar is highlighted within the month view.',
              'Tapping a date switches the selected day, instantly updating the week calendar and schedule card.',
              'Use the collapse button in the header to show or hide the month calendar.',
            ],
          },
          {
            heading: '5. Make good use of sleep records',
            body: 'Sleep Records lets you save the selected day’s wake-up time and bedtime. Tap “Current time” to save the time instantly with one tap. The previous day’s bedtime is shown automatically for reference.',
            points: [
              'After changing a time manually, tap “Save” to store the edited value.',
              'Tap the Sleep Records heading to collapse or expand the input and details. It is expanded by default.',
              'Use “Show Sleep Records” in Settings to show or hide the sleep record panel. Hiding it does not delete saved data.',
              'From the menu, open “Healthy Life PDF” to export the month’s sleep table and a combined daily chart (sleep, fatigue, completed tasks).',
            ],
          },
          {
            heading: '6. Use notifications',
            body: 'Tap the notification button in the upper-right corner to receive reminders when a timed schedule is about to start. Tasks do not send notifications. Browser notification permission is required.',
            points: [
              'When notifications are enabled, you will receive a reminder at the scheduled time.',
              'For iPhone and Safari, add the app to your home screen before enabling alerts.',
              'If notifications are blocked, change the browser settings to allow them.',
            ],
          },
          {
            heading: '7. Track your progress',
            body: 'Below the schedule cards for the selected day, you see your streak and weekly badge. Achievement counts both timed schedules and tasks (all must be complete).',
            points: [
              'Progress trends can be saved as a PDF report.',
              'Motivational indicators help maintain momentum.',
              'Daily review makes your plans easier to manage and more realistic.',
            ],
          },
          {
            heading: '8. Use Healthy Life Count',
            body: 'This optional feature shows a fatigue score (0–100) for the selected day based on sleep records and incomplete timed schedule load. Turn it on with “Show Healthy Life Count” in Settings. It is off by default.',
            points: [
              'When enabled, a section appears at the bottom of Home (below your schedule list). Tap the heading to expand or collapse it, like the month calendar.',
              'It shows: fatigue score (two lines), sleep/schedule bars, recent 3-day sleep average (when sleep records are shown), and steps (based on link status).',
              'Monthly fatigue trends appear in “Healthy Life PDF” as one chart (left: sleep, right: fatigue, bottom band: completed timed schedules).',
              'Fatigue and schedule subscores use incomplete timed schedules only—not tasks. Streak/achievement includes tasks.',
              'A one-line medical disclaimer appears in the section. For full scoring details, open Help → fatigue score guide (PDF).',
              'While the feature is off, fatigue score is not calculated.',
              'Steps reflect whether device linking is available (e.g. “Not linked”). Step data may feed into the score in a future update.',
            ],
          },
          {
            heading: '9. Summarize your schedules',
            body: 'From the menu, open "Schedule Summary" to choose a date range and either "All" or "Completed only", then get the count and total minutes for each timed schedule title. Tasks are excluded. Results can be saved as PDF or CSV.',
            points: [
              'The date range can be up to 31 days; a message appears if it is exceeded.',
              'Tasks are grouped by exact title match. Use common titles to keep names consistent.',
              'The total count and total minutes are shown in the last row of the summary.',
            ],
          },
          {
            heading: 'Appendix. Use the Sleep Records Shortcut on iPhone',
            body: 'You can add a dedicated home-screen icon that opens Sleep Records quickly in the iPhone Shortcuts app. The shared shortcut only opens “https://ron-sch.vercel.app/?sleep=1”.',
            points: [
              'In Safari, tap “Get the Sleep Records Shortcut for iPhone” in Help.',
              'When Apple’s page opens, tap “Get Shortcut”, review the actions, and add it.',
              'In the Shortcuts app, open the shortcut menu, tap Share, and choose “Add to Home Screen”.',
              'Tap the new Sleep Records icon on the Home Screen and sign in when prompted.',
              'In Sleep-only mode, log out and account deletion are unavailable. Use the normal app URL for those actions.',
              'You may need to sign in through Safari the first time. Never enter a password or Firebase secret into the shortcut.',
            ],
          },
        ],
        noteTitle: 'Helpful tip',
        note: 'Take a few minutes each day to review your schedule and confirm what you have completed. Combining notifications with progress checks helps reduce missed tasks and keeps you motivated.',
        footer: 'Created on: ' + new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }),
        saveLabel: 'Save / Print as PDF',
        closeLabel: 'Close',
      },
    }

    const guide = guideContent[lang] || guideContent.ja
    const guideScreenshotPaths = lang === 'en'
      ? [
        ...Array.from({ length: 7 }, (_, index) => ({ path: `/guide-screen-${index + 1}.png`, alt: `${APP_DISPLAY_NAME_EN} app screen ${index + 1}`, caption: `App screen example ${index + 1}.` })),
      ]
      : [
        ...Array.from({ length: 7 }, (_, index) => ({ path: `/guide-screen-${index + 1}.png`, alt: `${APP_DISPLAY_NAME}画面${index + 1}`, caption: `アプリ画面例 ${index + 1}` })),
      ]
    let guideScreenshots
    try {
      guideScreenshots = await Promise.all(guideScreenshotPaths.map(async (screenshot) => ({
        ...screenshot,
        src: await loadPublicImageAsDataUrl(screenshot.path),
      })))
    } catch (error) {
      if (!reportWindow.closed) reportWindow.close()
      alert(`${lang === 'en' ? 'The guide images could not be loaded' : 'ガイド画像を読み込めませんでした'}:\n${error.message}`)
      return
    }
    const guideScreenshotsHtml = guideScreenshots.map((screenshot, index) => `
      <figure class="guide-screenshot${index === guideScreenshots.length - 1 ? ' guide-screenshot-wide' : ''}">
        <img src="${screenshot.src}" alt="${screenshot.alt}" />
        <figcaption>${screenshot.caption}</figcaption>
      </figure>
    `).join('')
    const sectionsHtml = guide.sections.map((section, index) => `
      <section class="card">
        <div class="step-badge">${index + 1}</div>
        <h2>${section.heading}</h2>
        <p>${section.body}</p>
        <ul>
          ${section.points.map((point) => `<li>${point}</li>`).join('')}
        </ul>
      </section>
    `).join('')

    const guideHtml = `<!doctype html>
      <html lang="${lang}">
        <head>
          <meta charset="UTF-8" />
          <title>${guide.title}</title>
          <style>
            @page { size: A4 portrait; margin: 12mm; }
            * { box-sizing: border-box; }
            body {
              margin: 0;
              background: linear-gradient(180deg, #f8fbff 0%, #eef6ff 100%);
              color: #172033;
              font-family: "Noto Sans JP", "Segoe UI", "Yu Gothic", Meiryo, sans-serif;
            }
            .page {
              max-width: 820px;
              margin: 0 auto;
              padding: 24px 20px 40px;
            }
            .topbar {
              display: flex;
              justify-content: space-between;
              align-items: center;
              gap: 12px;
              margin-bottom: 18px;
            }
            .brand {
              display: inline-flex;
              align-items: center;
              gap: 10px;
              background: #eff6ff;
              border: 1px solid #bfdbfe;
              border-radius: 999px;
              padding: 8px 14px;
              color: #1d4ed8;
              font-weight: 700;
              font-size: 12px;
            }
            .actions {
              display: flex;
              justify-content: flex-end;
              gap: 10px;
              margin-bottom: 12px;
            }
            button {
              border: 0;
              border-radius: 10px;
              background: #2563eb;
              color: white;
              padding: 12px 20px;
              font-size: 15px;
              font-weight: 700;
              cursor: pointer;
            }
            .close-button { background: #64748b; }
            .sheet {
              background: #ffffff;
              border: 1px solid #dfeaf7;
              border-radius: 18px;
              box-shadow: 0 10px 24px rgba(15, 23, 42, 0.08);
              padding: 28px 24px;
            }
            h1 {
              margin: 0;
              font-size: 30px;
              line-height: 1.2;
              color: #0f172a;
            }
            .subtitle {
              margin: 10px 0 0;
              color: #475569;
              font-size: 14px;
              line-height: 1.7;
            }
            .screenshots {
              display: grid;
              grid-template-columns: repeat(2, minmax(0, 1fr));
              gap: 12px;
              margin-top: 22px;
            }
            .guide-screenshot {
              margin: 0;
              min-width: 0;
              break-inside: avoid;
            }
            .guide-screenshot-wide {
              grid-column: 1 / -1;
            }
            .guide-screenshot img {
              display: block;
              width: 100%;
              height: 190px;
              object-fit: contain;
              object-position: center;
              background: #f8fafc;
              border: 1px solid #dbeafe;
              border-radius: 10px;
            }
            .guide-screenshot-wide img {
              height: auto;
              max-height: 310px;
              object-fit: contain;
            }
            .guide-screenshot figcaption {
              margin-top: 6px;
              color: #475569;
              font-size: 11px;
              line-height: 1.5;
            }
            .card {
              background: linear-gradient(180deg, #f8fbff 0%, #ffffff 100%);
              border: 1px solid #dbeafe;
              border-radius: 12px;
              padding: 18px 18px 14px;
              margin-top: 18px;
            }
            .step-badge {
              display: inline-flex;
              align-items: center;
              justify-content: center;
              width: 28px;
              height: 28px;
              border-radius: 999px;
              background: #dbeafe;
              color: #1d4ed8;
              font-size: 12px;
              font-weight: 800;
              margin-bottom: 10px;
            }
            h2 {
              margin: 0 0 8px;
              font-size: 18px;
              color: #1e3a8a;
            }
            p, li {
              font-size: 14px;
              line-height: 1.8;
              color: #334155;
            }
            ul {
              margin: 12px 0 0;
              padding-left: 20px;
            }
            .tip {
              margin-top: 24px;
              background: #eff6ff;
              border: 1px solid #bfdbfe;
              border-radius: 12px;
              padding: 16px 18px;
            }
            .tip-title {
              margin: 0 0 6px;
              font-size: 14px;
              color: #1e3a8a;
              font-weight: 800;
            }
            .footer {
              margin-top: 20px;
              padding-top: 14px;
              border-top: 1px solid #e2e8f0;
              color: #64748b;
              font-size: 12px;
              text-align: right;
            }
            @media print { .actions { display: none; } }
          </style>
        </head>
        <body>
          <div class="page">
            <div class="actions">
              <button onclick="window.print()">${guide.saveLabel}</button>
              <button class="close-button" onclick="window.close()">${guide.closeLabel}</button>
            </div>
            <div class="sheet">
              <div class="topbar">
                <div class="brand">${escapeHtml(lang === 'en' ? APP_DISPLAY_NAME_EN : APP_DISPLAY_NAME)}</div>
              </div>
              <h1>${guide.title}</h1>
              <p class="subtitle">${guide.subtitle}</p>
              ${sectionsHtml}
              <div class="tip">
                <div class="tip-title">${guide.noteTitle}</div>
                <div>${guide.note}</div>
              </div>
              <div class="footer">${guide.footer}</div>
              <div class="screenshots">${guideScreenshotsHtml}</div>
            </div>
          </div>
        </body>
      </html>`

    const blobUrl = URL.createObjectURL(new Blob([guideHtml], { type: 'text/html' }))
    setTimeout(() => {
      if (reportWindow.closed) {
        URL.revokeObjectURL(blobUrl)
        return
      }
      reportWindow.location.href = blobUrl
      reportWindow.focus()
    }, 0)
    setTimeout(() => URL.revokeObjectURL(blobUrl), 60000)
  }

  const openFatigueGuidePdf = (lang = 'ja') => {
    const reportWindow = window.open('', '_blank', 'width=1000,height=750')
    if (!reportWindow) {
      const alertText = lang === 'en'
        ? 'The fatigue guide could not be opened. Please allow pop-ups and try again.'
        : '「疲れ」判定の説明を開けませんでした。ポップアップを許可してください。'
      alert(alertText)
      return
    }
    const guideHtml = buildFatigueGuideHtml(lang)
    const blobUrl = URL.createObjectURL(new Blob([guideHtml], { type: 'text/html' }))
    setTimeout(() => {
      if (reportWindow.closed) {
        URL.revokeObjectURL(blobUrl)
        return
      }
      reportWindow.location.href = blobUrl
      reportWindow.focus()
    }, 0)
    setTimeout(() => URL.revokeObjectURL(blobUrl), 60000)
  }

  const openProductPrPdf = async (lang = 'ja') => {
    const reportWindow = window.open('', '_blank', 'width=1100,height=800')
    if (!reportWindow) {
      alert(lang === 'en' ? 'The PR slides could not be opened. Please allow pop-ups.' : 'PRスライドを開けませんでした。ポップアップを許可してください。')
      return
    }

    const isEnglish = lang === 'en'
    const slides = isEnglish ? [
      { tag: 'RON SCHE+DULE', title: 'Plan your day.\nMake progress visible.', body: 'A friendly daily schedule app that turns intentions into small, achievable actions.', points: ['Turn a busy day into clear next steps.', 'See progress without losing your focus.'], art: '📅  ✨  🐈‍⬛' },
      { tag: 'ONE PLACE FOR YOUR DAY', title: 'See what matters\nat a glance.', body: 'Schedules, priorities, completion, search, calendar views, and reminders work together in one calm workspace.', points: ['Keep plans, priorities, and reminders together.', 'Find the right task quickly when plans change.'], art: '🗓️  ✅  🔔' },
      { tag: 'SLEEP RECORDS', title: 'Start the morning\nwith a simple tap.', body: 'Save wake-up time and bedtime manually or use Current Time. Review the previous bedtime and your recent average.', points: ['Record wake-up and bedtime in seconds.', 'Compare sleep duration with the recommended eight hours.'], art: '🌙  🛏️  ☀️' },
      { tag: 'RON-KUN’S SUPPORT', title: 'A little advice\nfor today.', body: 'Recent sleep averages are translated into four friendly levels, emojis, and rotating advice from black cat Ron-kun.', points: ['Make recent sleep patterns easier to understand.', 'Receive a gentle suggestion matched to your rhythm.'], art: '🐈‍⬛  💬  😊' },
      { tag: 'KEEP GOING', title: 'Small checks create\na better rhythm.', body: 'Streaks, progress reports, PDFs, and notifications help you notice what you have done and choose the next step.', points: ['Celebrate completed plans and steady routines.', 'Use reports to turn reflection into action.'], art: '🔥  📈  🚶' },
      { tag: 'READY WHEN YOU ARE', title: 'Make today\neasier to begin.', body: 'Use the web app or the iPhone Sleep Records Shortcut for quick access to the moments that matter.', points: ['Open the right view whenever you need it.', 'Keep the daily routine accessible on mobile.'], art: '📱  🚀  🐈‍⬛' },
      { tag: 'APP SCREENS', title: 'Everything you need\nin one place.', body: 'Explore the app screens and find the view that fits your daily routine.', points: ['A calm interface supports repeated daily use.', 'Choose the screen that matches your next action.'], art: '🖥️  📱  ✅' },
    ] : [
      { tag: APP_DISPLAY_NAME, title: '今日を整え、\n前進を見える化。', body: 'やりたいことを小さな行動に変えて、毎日の達成感を支えるスケジュールアプリです。', points: ['一日のやることを見通しやすく整理。', '小さな完了を積み重ねて達成感を実感。'], art: '📅  ✨  🐈‍⬛' },
      { tag: '一日の予定をひとまとめ', title: '大切なことが\nひと目でわかる。', body: '予定、重要度、完了、検索、カレンダー、通知をひとつの落ち着いた画面で管理できます。', points: ['重要度で、先に取り組むことが明確に。', '検索とカレンダーで予定をすぐ確認。'], art: '🗓️  ✅  🔔' },
      { tag: '睡眠記録', title: '朝の記録を\nワンタッチで。', body: '起床と就寝を手動または現在時刻で保存。前日の就寝と最近の平均睡眠時間も確認できます。', points: ['現在時刻ボタンで入力の手間を軽減。', '8時間の目安と日別の睡眠時間を比較。'], art: '🌙  🛏️  ☀️' },
      { tag: 'ロン君のサポート', title: '今日のあなたに\nひとこと。', body: '最近の睡眠平均を4段階で判定し、黒猫ロン君の絵文字と日替わりアドバイスで寄り添います。', points: ['睡眠の状態を4段階でやさしく表示。', '毎日の気分に寄り添うアドバイスを提供。'], art: '🐈‍⬛  💬  😊' },
      { tag: '続ける仕組み', title: '小さな確認が\nよいリズムをつくる。', body: '連続達成、進捗レポート、PDF、通知で、できたことに気づき次の一歩を選べます。', points: ['連続達成日数で継続を確認。', 'レポートで習慣の変化を振り返る。'], art: '🔥  📈  🚶' },
      { tag: 'いつでも、あなたのペースで', title: '今日を始める\nきっかけに。', body: 'Webアプリでも、iPhoneの睡眠記録ショートカットでも、必要な瞬間にすぐ使えます。', points: ['PCでもスマートフォンでも利用可能。', '必要な記録へすぐアクセス。'], art: '📱  🚀  🐈‍⬛' },
      { tag: 'アプリ画面', title: '必要な機能を\nひとつの場所に。', body: '7つの画面例から、毎日の使い方をイメージできます。', points: ['画面ごとの役割がひと目でわかる。', '自分に合う使い方を見つけやすい。'], art: '🖥️  📱  ✅' },
    ]

    const slideScreenshotPaths = Array.from({ length: 7 }, (_, index) => `/guide-screen-${index + 1}.png`)
    let slideScreenshots
    try {
      slideScreenshots = await Promise.all(slideScreenshotPaths.map((path) => loadPublicImageAsDataUrl(path)))
    } catch (error) {
      if (!reportWindow.closed) reportWindow.close()
      alert(`${isEnglish ? 'The slide images could not be loaded' : 'スライド画像を読み込めませんでした'}:\n${error.message}`)
      return
    }
    let ronImage
    try {
      ronImage = await loadPublicImageAsDataUrl('/ron.png', true)
    } catch (error) {
      if (!reportWindow.closed) reportWindow.close()
      alert(`${isEnglish ? 'Ron-kun image could not be loaded' : 'ロン君の画像を読み込めませんでした'}:\n${error.message}`)
      return
    }
    const slideHtml = slides.map((slide, index) => `
      <section class="slide ${index === 0 ? 'cover' : ''}">
        <div class="brand">${escapeHtml(slide.tag)}</div>
        <div class="illustration">${slide.art}</div>
        <div class="slide-number">${String(index + 1).padStart(2, '0')} / ${String(slides.length).padStart(2, '0')}</div>
        <h1>${escapeHtml(slide.title).replaceAll('\n', '<br>')}</h1>
        <p>${escapeHtml(slide.body)}</p>
        <ul class="appeal-points">${slide.points.map((point) => `<li>${escapeHtml(point)}</li>`).join('')}</ul>
        <img class="screen-shot" src="${slideScreenshots[index]}" alt="${isEnglish ? 'App screen example' : 'アプリ画面の例'}" />
        <img class="ron" src="${ronImage}" alt="黒猫ロン君" />
      </section>`).join('')

    const title = isEnglish ? `${APP_DISPLAY_NAME_EN} App Introduction` : `${APP_DISPLAY_NAME} アプリ紹介`
    const html = `<!doctype html><html lang="${isEnglish ? 'en' : 'ja'}"><head><meta charset="UTF-8" /><title>${title}</title>
      <style>
        @page { size: A4 landscape; margin: 0; } * { box-sizing: border-box; }
        body { margin: 0; color: #172033; font-family: "Noto Sans JP", "Yu Gothic", Meiryo, sans-serif; background: #dfe8f2; }
        .slide { position: relative; width: 297mm; height: 210mm; page-break-after: always; overflow: hidden; padding: 24mm 28mm; background: linear-gradient(135deg, #f8fbff 0%, #e7f4f2 100%); }
        .slide.cover { background: linear-gradient(135deg, #dbeafe 0%, #ccfbf1 100%); }
        .brand { color: #0f766e; font-size: 15px; font-weight: 800; letter-spacing: 2px; }
        .illustration { position: absolute; top: 42mm; right: 25mm; font-size: 58px; letter-spacing: 10px; white-space: nowrap; }
        .slide h1 { position: relative; z-index: 1; max-width: 82mm; margin: 38mm 0 10mm; color: #0f172a; font-size: 39px; line-height: 1.2; }
        .slide p { position: relative; z-index: 1; max-width: 82mm; color: #475569; font-size: 19px; line-height: 1.65; }
        .appeal-points { position: relative; z-index: 1; max-width: 82mm; margin: 8mm 0 0; padding-left: 7mm; color: #0f766e; font-size: 15px; line-height: 1.7; font-weight: 700; }
        .screen-shot { position: absolute; z-index: 1; right: 80mm; bottom: 28mm; width: 100mm; height: 66mm; object-fit: contain; object-position: center; background: rgba(255,255,255,.72); border: 2px solid rgba(255,255,255,.9); border-radius: 10px; box-shadow: 0 12px 28px rgba(15,23,42,.18); }
        .ron { position: absolute; z-index: 2; right: 25mm; bottom: 20mm; width: 32mm; max-height: 46mm; object-fit: contain; background: transparent; }
        .slide-number { position: absolute; right: 28mm; bottom: 14mm; color: #64748b; font-size: 12px; }
        .cover h1 { font-size: 50px; margin-top: 52mm; } .cover p { font-size: 21px; }
        .actions { position: fixed; z-index: 10; top: 12px; right: 12px; display: flex; gap: 8px; }
        button { border: 0; border-radius: 8px; padding: 10px 16px; background: #0f766e; color: white; font-weight: 700; cursor: pointer; } .close { background: #64748b; }
        @media print { body { background: white; } .actions { display: none; } }
      </style></head><body><div class="actions"><button onclick="window.print()">${isEnglish ? 'Save / Print as PDF' : 'PDFとして保存 / 印刷'}</button><button class="close" onclick="window.close()">${isEnglish ? 'Close' : '閉じる'}</button></div>${slideHtml}</body></html>`
    const blobUrl = URL.createObjectURL(new Blob([html], { type: 'text/html' }))
    setTimeout(() => { if (!reportWindow.closed) { reportWindow.location.href = blobUrl; reportWindow.focus() } }, 0)
    setTimeout(() => URL.revokeObjectURL(blobUrl), 60000)
  }

  const openProgressReport = async () => {
    if (!session) return

    // ポップアップブロック対策: 非同期取得の前にユーザー操作と同じtickでウィンドウを開いておく
    const reportWindow = window.open('', '_blank', 'width=1000,height=750')
    if (!reportWindow) {
      alert('帳票画面を開けませんでした。ポップアップを許可してください。')
      return
    }

    let monthlyStats = []
    try {
      const q = query(collection(db, 'schedule_items'), where('user_id', '==', session.uid))
      const snapshot = await getDocs(q)
      const statsByMonth = {}

      snapshot.forEach((docSnap) => {
        const item = docSnap.data()
        const monthKey = String(item.date || '').slice(0, 7)
        if (!monthKey) return
        if (!statsByMonth[monthKey]) {
          statsByMonth[monthKey] = { monthKey, planned: 0, completed: 0 }
        }
        statsByMonth[monthKey].planned += 1
        if (item.completed === true) statsByMonth[monthKey].completed += 1
      })

      monthlyStats = Object.values(statsByMonth)
        .sort((a, b) => a.monthKey.localeCompare(b.monthKey))
        .map((row) => ({
          ...row,
          rate: row.planned > 0 ? Math.round((row.completed / row.planned) * 1000) / 10 : 0,
        }))
    } catch (error) {
      console.error('進捗率データ取得エラー:', error)
      if (!reportWindow.closed) reportWindow.close()
      alert(`進捗率データの取得に失敗しました:\n${error.message}`)
      return
    }

    if (reportWindow.closed) return

    const totalPlanned = monthlyStats.reduce((sum, row) => sum + row.planned, 0)
    const totalCompleted = monthlyStats.reduce((sum, row) => sum + row.completed, 0)
    const totalRate = totalPlanned > 0 ? Math.round((totalCompleted / totalPlanned) * 1000) / 10 : 0

    const rows = monthlyStats.length
      ? monthlyStats.map((row) => `
          <tr>
            <td>${escapeHtml(row.monthKey)}</td>
            <td>${row.planned}</td>
            <td>${row.completed}</td>
            <td>${row.rate.toFixed(1)}%</td>
          </tr>`).join('')
      : '<tr><td colspan="4" class="empty">データがありません</td></tr>'

    const totalRow = `
          <tr class="total-row">
            <td>全体</td>
            <td>${totalPlanned}</td>
            <td>${totalCompleted}</td>
            <td>${totalRate.toFixed(1)}%</td>
          </tr>`

    // 折れ線グラフ用のSVGパスを進捗率(0-100%)から生成する
    const chartWidth = 760
    const chartHeight = 260
    const paddingLeft = 46
    const paddingRight = 16
    const paddingTop = 16
    const paddingBottom = 34
    const plotWidth = chartWidth - paddingLeft - paddingRight
    const plotHeight = chartHeight - paddingTop - paddingBottom
    const pointCount = monthlyStats.length

    const toX = (index) => pointCount <= 1
      ? paddingLeft + plotWidth / 2
      : paddingLeft + (plotWidth * index) / (pointCount - 1)
    const toY = (rate) => paddingTop + plotHeight - (plotHeight * Math.min(100, Math.max(0, rate))) / 100

    const points = monthlyStats.map((row, index) => ({ x: toX(index), y: toY(row.rate), row }))
    const polylinePoints = points.map((p) => `${p.x},${p.y}`).join(' ')
    const gridLines = [0, 25, 50, 75, 100].map((tick) => {
      const y = toY(tick)
      return `<line x1="${paddingLeft}" y1="${y}" x2="${chartWidth - paddingRight}" y2="${y}" stroke="#e2e8f0" stroke-width="1" />
              <text x="${paddingLeft - 8}" y="${y + 4}" font-size="10" fill="#94a3b8" text-anchor="end">${tick}%</text>`
    }).join('')
    const monthLabels = points.map((p) => `<text x="${p.x}" y="${chartHeight - paddingBottom + 16}" font-size="10" fill="#64748b" text-anchor="middle">${escapeHtml(p.row.monthKey)}</text>`).join('')
    const dots = points.map((p) => `<circle cx="${p.x}" cy="${p.y}" r="3.5" fill="#2563eb" /><text x="${p.x}" y="${p.y - 8}" font-size="10" fill="#1d4ed8" text-anchor="middle">${p.row.rate.toFixed(0)}%</text>`).join('')
    const chartSvg = pointCount
      ? `<svg viewBox="0 0 ${chartWidth} ${chartHeight}" width="100%" style="max-width: ${chartWidth}px;">
          ${gridLines}
          <polyline points="${polylinePoints}" fill="none" stroke="#2563eb" stroke-width="2" />
          ${dots}
          ${monthLabels}
        </svg>`
      : '<p class="empty">データがありません</p>'

    const html = `<!doctype html>
      <html lang="ja">
        <head>
          <meta charset="UTF-8" />
          <title>進捗率</title>
          <style>
            @page { size: A4 landscape; margin: 12mm; }
            * { box-sizing: border-box; }
            body { margin: 0; color: #172033; font-family: "Noto Sans JP", "Yu Gothic", Meiryo, sans-serif; }
            h1 { margin: 0 0 5px; font-size: 24px; }
            h2 { margin: 24px 0 10px; font-size: 16px; color: #1e3a8a; }
            .output-date { color: #475569; margin-bottom: 18px; font-size: 13px; }
            table { width: 100%; border-collapse: collapse; font-size: 12px; margin-bottom: 8px; }
            th, td { border: 1px solid #cbd5e1; padding: 7px 8px; text-align: left; vertical-align: top; }
            th { background: #e8f0ff; color: #1e3a8a; }
            .total-row td { background: #fef9c3; font-weight: 700; }
            .empty { text-align: center; color: #64748b; padding: 24px; }
            .chart-box { border: 1px solid #e2e8f0; border-radius: 10px; padding: 12px; }
            .actions { display: flex; justify-content: flex-end; gap: 10px; margin-bottom: 14px; }
            button { border: 0; border-radius: 10px; background: #2563eb; color: white; padding: 12px 20px; font-size: 15px; font-weight: 700; cursor: pointer; }
            .close-button { background: #64748b; }
            @media print { .actions { display: none; } }
          </style>
        </head>
        <body>
          <div class="actions"><button onclick="window.print()">PDFとして保存 / 印刷</button><button class="close-button" onclick="window.close()">閉じる</button></div>
          <h1>進捗率</h1>
          <div class="output-date">出力日: ${escapeHtml(formatDisplayDate(new Date()))}</div>
          <table>
            <thead><tr><th>月</th><th>計画数</th><th>完了数</th><th>進捗率</th></tr></thead>
            <tbody>${rows}${totalRow}</tbody>
          </table>
          <h2>進捗率の推移</h2>
          <div class="chart-box">${chartSvg}</div>
        </body>
      </html>`

    const blobUrl = URL.createObjectURL(new Blob([html], { type: 'text/html' }))
    setTimeout(() => {
      if (reportWindow.closed) {
        URL.revokeObjectURL(blobUrl)
        return
      }
      reportWindow.location.href = blobUrl
      reportWindow.focus()
    }, 0)
    setTimeout(() => URL.revokeObjectURL(blobUrl), 60000)
  }

  return (
    <>
      {!session ? (
        <div style={styles.authContainer}>
          <div style={styles.authBox}>
            <div style={styles.brandRow}>
              <CalendarDays size={28} color="#2d6cdf" />
              <h2 style={styles.brandTitle}>{APP_DISPLAY_NAME}</h2>
            </div>
            <p style={styles.authCaption}>{authMode === 'login' ? 'ログイン画面' : '新規登録画面'}</p>
            {authError && <p style={styles.authError}>{authError}</p>}

            <form onSubmit={handleAuth} style={styles.authForm}>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="メールアドレス"
                style={styles.input}
                required
              />
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="パスワード"
                style={styles.input}
                required
              />
              {authMode === 'login' && (
                <div style={{ textAlign: 'right', marginTop: '-4px', marginBottom: '8px' }}>
                  <button
                    type="button"
                    style={{ ...styles.textButton, fontSize: '12px', padding: 0 }}
                    onClick={handleSendPasswordReset}
                  >
                    パスワードをお忘れの方はこちら
                  </button>
                </div>
              )}
              <button type="submit" style={styles.primaryButton}>
                {authMode === 'login' ? 'ログイン' : '登録する'}
              </button>
            </form>

            <button type="button" style={styles.textButton} onClick={() => setAuthMode(authMode === 'login' ? 'signup' : 'login')}>
              {authMode === 'login' ? 'アカウントをお持ちでない方は新規登録' : 'すでにアカウントをお持ちの方はこちら'}
            </button>
          </div>
        </div>
      ) : (
        <div style={styles.appShell} className={`app-shell${sleepOnlyMode ? ' sleep-only-mode' : ''}${demoMode ? ' demo-mode' : ''}`}>
          {demoMode && session && (
            <div className="demo-mode-banner" style={styles.demoModeBanner} role="status">
              <strong style={styles.demoModeBadge}>DEMO</strong>
              <span>
                デモ版です。登録は1日{DEMO_MAX_PER_DAY}件・全体{DEMO_MAX_TOTAL}件まで。ログアウト／アカウント削除はできません。
              </span>
            </div>
          )}
          {loading && (
            <div style={styles.progressBarTrack}>
              <div style={styles.progressBarFill} />
            </div>
          )}
          <header style={styles.header} className="app-header">
            <div style={styles.headerTitleBox} className="app-header-title-box">
              <div style={styles.menuWrapper} ref={menuRef}>
                <button
                  type="button"
                  style={styles.menuButton}
                  onClick={() => {
                    setMenuOpen((current) => !current)
                    setSettingsMenuOpen(false)
                  }}
                  aria-haspopup="true"
                  aria-expanded={menuOpen}
                  aria-label="メニューを開く"
                >
                  {menuOpen ? <X size={28} /> : <Menu size={28} />}
                </button>
                {menuOpen && (
                  <div style={styles.menuDropdown} role="menu">
                    <button
                      type="button"
                      role="menuitem"
                      style={styles.menuItem}
                      onClick={() => {
                        setView('home')
                        setSelectedDate(new Date())
                        setMenuOpen(false)
                      }}
                    >
                      <Home size={18} /> ホーム
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      style={styles.menuItem}
                      onClick={() => {
                        setView('scheduleList')
                        setMenuOpen(false)
                      }}
                    >
                      <FileText size={18} /> スケジュール一覧
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      style={styles.menuItem}
                      onClick={() => {
                        setView('incompleteList')
                        setMenuOpen(false)
                      }}
                    >
                      <ClipboardList size={18} /> 未完了一覧
                    </button>
                    <div style={styles.menuDivider} />
                    <button
                      type="button"
                      role="menuitem"
                      style={styles.menuItem}
                      onClick={() => setSettingsMenuOpen((current) => !current)}
                      aria-expanded={settingsMenuOpen}
                    >
                      <Settings size={18} /> 設定
                    </button>
                    {settingsMenuOpen && (
                      <div style={styles.settingsSubmenu} role="group" aria-label="カレンダーと睡眠記録の設定">
                        <button
                          type="button"
                          role="menuitem"
                          style={styles.menuItem}
                          onClick={() => setWeekCalendarFixed((current) => !current)}
                        >
                          <Check size={18} color={weekCalendarFixed ? '#2563eb' : 'transparent'} />
                          週カレンダー固定と中止
                        </button>
                        <button
                          type="button"
                          role="menuitem"
                          style={styles.menuItem}
                          onClick={() => setMonthCalendarEnabled((current) => current && !weekCalendarEnabled ? current : !current)}
                          disabled={monthCalendarEnabled && !weekCalendarEnabled}
                        >
                          <Check size={18} color={monthCalendarEnabled ? '#2563eb' : 'transparent'} />
                          月カレンダー表示
                        </button>
                        <button
                          type="button"
                          role="menuitem"
                          style={styles.menuItem}
                          onClick={() => setWeekCalendarEnabled((current) => current && !monthCalendarEnabled ? current : !current)}
                          disabled={weekCalendarEnabled && !monthCalendarEnabled}
                        >
                          <Check size={18} color={weekCalendarEnabled ? '#2563eb' : 'transparent'} />
                          週カレンダー表示
                        </button>
                        <button
                          type="button"
                          role="menuitem"
                          style={styles.menuItem}
                          onClick={() => setSleepRecordEnabled((current) => !current)}
                        >
                          <Check size={18} color={sleepRecordEnabled ? '#2563eb' : 'transparent'} />
                          睡眠記録表示
                        </button>
                        <button
                          type="button"
                          role="menuitem"
                          style={styles.menuItem}
                          onClick={() => setMedicationRecordEnabled((current) => !current)}
                        >
                          <Check size={18} color={medicationRecordEnabled ? '#2563eb' : 'transparent'} />
                          服薬記録表示
                        </button>
                        <button
                          type="button"
                          role="menuitem"
                          style={styles.menuItem}
                          onClick={() => setHealthLifeCountEnabled((current) => !current)}
                        >
                          <Check size={18} color={healthLifeCountEnabled ? '#2563eb' : 'transparent'} />
                          健康生活カウント表示
                        </button>
                        <label style={styles.settingsSelectLabel}>
                          週の開始を設定
                          <select
                            value={weekStartDay}
                            onChange={(event) => setWeekStartDay(Number(event.target.value))}
                            style={styles.settingsSelect}
                          >
                            {dayNames.map((dayName, dayIndex) => (
                              <option key={dayName} value={dayIndex}>{dayName}曜日</option>
                            ))}
                          </select>
                        </label>
                      </div>
                    )}
                    <div style={styles.menuDivider} />
                    <button
                      type="button"
                      role="menuitem"
                      style={styles.menuItem}
                      onClick={() => {
                        openWeeklyReport('all')
                        setMenuOpen(false)
                      }}
                    >
                      <FileText size={18} /> スケジュール一覧PDF
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      style={styles.menuItem}
                      onClick={() => {
                        openWeeklyReport('incomplete')
                        setMenuOpen(false)
                      }}
                    >
                      <ClipboardList size={18} /> 未完了一覧PDF
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      style={styles.menuItem}
                      onClick={() => {
                        openProgressReport()
                        setMenuOpen(false)
                      }}
                    >
                      <TrendingUp size={18} /> 進捗率PDF
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      style={styles.menuItem}
                      onClick={() => {
                        openSleepReport()
                        setMenuOpen(false)
                      }}
                    >
                      <Clock3 size={18} /> 健康生活PDF
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      style={styles.menuItem}
                      onClick={() => {
                        openAggregationModal()
                        setMenuOpen(false)
                      }}
                    >
                      <ChartColumn size={18} /> スケジュール集計
                    </button>
                    <div style={styles.menuDivider} />
                    <button
                      type="button"
                      role="menuitem"
                      style={styles.menuItem}
                      onClick={() => {
                        setHelpOpen(true)
                        setMenuOpen(false)
                      }}
                    >
                      <HelpCircle size={18} /> ヘルプ
                    </button>
                    {!sleepOnlyMode && !demoMode && (
                      <>
                        <div style={styles.menuDivider} />
                        <button
                          type="button"
                          role="menuitem"
                          style={styles.menuItem}
                          onClick={openSubscriptionCancelModal}
                        >
                          <Mail size={18} /> サブスク解約の申請
                        </button>
                        <div style={styles.menuDivider} />
                        <button
                          type="button"
                          role="menuitem"
                          style={{ ...styles.menuItem, ...styles.menuItemDanger }}
                          onClick={() => {
                            setMenuOpen(false)
                            signOut(auth)
                          }}
                        >
                          <LogOut size={18} /> ログアウト
                        </button>
                        <button
                          type="button"
                          role="menuitem"
                          style={{ ...styles.menuItem, ...styles.menuItemDanger }}
                          onClick={() => {
                            setMenuOpen(false)
                            setDeleteAccountError('')
                            setDeletePassword('')
                            setDeleteAccountModalOpen(true)
                          }}
                        >
                          <UserX size={18} /> アカウント削除
                        </button>
                      </>
                    )}
                  </div>
                )}
              </div>
              <CalendarDays size={26} color="#2563eb" />
              <h1 style={styles.title} className="app-title">{APP_DISPLAY_NAME}</h1>
            </div>

            <div style={styles.userArea} className="app-user-area">
              <span style={styles.userEmail} className="app-user-email">{session.email}</span>
              <div style={styles.notificationControls} className="app-notification-controls">
                <button
                  type="button"
                  className="notification-toggle-btn"
                  style={{
                    ...styles.notificationButton,
                    ...(notificationEnabled ? styles.notificationButtonOn : styles.notificationButtonOff),
                    ...(notificationBusy ? styles.notificationButtonBusy : {}),
                  }}
                  onClick={toggleNotifications}
                  disabled={notificationBusy}
                  aria-label={notificationEnabled ? '通知をオフにする' : '通知をオンにする'}
                  title={notificationEnabled ? '通知をオフにする' : '通知をオンにする'}
                >
                  {notificationEnabled ? <Bell size={28} /> : <BellOff size={28} />}
                  <span className="notification-label">{notificationBusy ? '処理中' : notificationEnabled ? '通知ON' : '通知OFF'}</span>
                  {notificationBadgeCount > 0 && (
                    <span style={styles.notificationCountBadge} className="notification-count-badge">{notificationBadgeCount}</span>
                  )}
                </button>
                <button
                  type="button"
                  style={styles.notificationHelpButton}
                  onClick={() => setNotificationHelpOpen((current) => !current)}
                  aria-expanded={notificationHelpOpen}
                  aria-label="通知の設定方法を表示"
                  title="通知の設定方法"
                  className="notification-help-btn"
                >
                  設定方法
                </button>
                {notificationHelpOpen && (
                  <div style={styles.notificationHelpPanel} role="dialog" aria-label="通知の設定方法">
                    <div style={styles.notificationHelpHeader}>
                      <strong style={styles.notificationHelpTitle}>通知を有効にする手順</strong>
                      <button
                        type="button"
                        style={styles.notificationHelpClose}
                        onClick={() => setNotificationHelpOpen(false)}
                        aria-label="設定方法を閉じる"
                      >
                        ×
                      </button>
                    </div>
                    {notificationBadgeCount > 0 && (
                      <div style={styles.notificationCountLabel}>
                      未読 {notificationBadgeCount}
                      </div>
                    )}
                    <ol style={styles.notificationHelpList}>
                      {notificationHelpSteps.map((step) => (
                        <li key={step} style={styles.notificationHelpItem}>{step}</li>
                      ))}
                    </ol>
                    {safariInstallSteps.length > 0 && (
                      <div style={styles.notificationHelpNote}>
                        <strong>iPhone / Safari の場合</strong>
                        <ol style={{ ...styles.notificationHelpList, marginTop: '6px' }}>
                          {safariInstallSteps.map((step) => (
                            <li key={step} style={styles.notificationHelpItem}>{step}</li>
                          ))}
                        </ol>
                      </div>
                    )}
                    {notificationPermission === 'denied' && (
                      <div style={styles.notificationHelpNote}>
                        現在はブラウザでブロック中です。サイト情報 → 通知 → 許可 に変更してください。
                      </div>
                    )}
                  </div>
                )}
              </div>
              {notificationPermission === 'denied' && (
                <span style={styles.notificationNotice} className="notification-notice">通知はブラウザ設定でブロックされています。</span>
              )}
            </div>
          </header>

          {view === 'home' && (
          <main ref={mainRef} className={sleepOnlyMode ? 'sleep-only-main' : undefined} style={{ ...styles.main, ...(weekCalendarEnabled && weekCalendarFixed ? styles.mainWithFixedWeek : {}) }}>
            <section className="schedule-search-section" style={styles.scheduleSearchSection} aria-label="スケジュール名を検索">
              <div className="schedule-search-header" style={styles.scheduleSearchHeader}>
                <div>
                  <h2 className="schedule-search-title" style={styles.scheduleSearchTitle}>スケジュールを検索</h2>
                  <p className="schedule-search-caption" style={styles.scheduleSearchCaption}>予定名から部分一致で検索（対象月は下の表示）</p>
                </div>
              </div>
              <div className="schedule-search-month-nav week-nav" style={styles.weekNav} role="navigation" aria-label="検索対象の月">
                <button
                  type="button"
                  className="week-nav-btn schedule-search-nav-btn"
                  style={styles.navButton}
                  onClick={() => changeSearchMonth(-1)}
                  aria-label="前月"
                  title="前月"
                >
                  <ChevronLeft size={16} />
                </button>
                <div className="schedule-search-nav-month week-nav-title" style={styles.weekTitle}>
                  {searchMonthTitle}
                </div>
                <button
                  type="button"
                  className="week-nav-btn schedule-search-nav-btn"
                  style={styles.navButton}
                  onClick={() => changeSearchMonth(1)}
                  aria-label="翌月"
                  title="翌月"
                >
                  <ChevronRight size={16} />
                </button>
              </div>
              <div className="schedule-search-input-row" style={styles.scheduleSearchInputRow}>
                <Search size={18} color="#2563eb" />
                <input
                  type="text"
                  className="schedule-search-input"
                  value={scheduleSearchQuery}
                  onChange={(event) => setScheduleSearchQuery(event.target.value)}
                  placeholder={`${searchMonthTitle}の予定名を入力`}
                  style={styles.scheduleSearchInput}
                />
                {scheduleSearchQuery && (
                  <button
                    type="button"
                    className="schedule-search-clear-btn"
                    style={styles.searchClearButton}
                    onClick={() => setScheduleSearchQuery('')}
                    aria-label="検索をクリア"
                    title="検索をクリア"
                  >
                    <X size={16} />
                  </button>
                )}
              </div>
              {scheduleSearchQuery.trim() && (
                <div style={styles.scheduleSearchResults}>
                  <div style={styles.scheduleSearchStatus}>
                    【{searchMonthTitle}】「{scheduleSearchQuery.trim()}」の検索結果: {scheduleSearchResults.length}件
                  </div>
                  {scheduleSearchResults.map((item) => (
                    <button
                      key={`${item.date}_${item.id}`}
                      type="button"
                      style={styles.scheduleSearchResult}
                      onClick={() => {
                        setScheduleSearchQuery('')
                        setSelectedDate(new Date(`${item.date}T00:00:00`))
                        openSchedulePreview(item)
                      }}
                    >
                      <span style={styles.scheduleSearchResultTitle}>{item.title || '予定'}</span>
                      <span style={styles.scheduleSearchResultMeta}>
                        {item.date}　
                        {isScheduleChildTask(item)
                          ? `配下タスク／${formatChildTaskParentLabel(findParentScheduleItem(scheduleMap, item)) || '親予定'}`
                          : isScheduleTask(item)
                            ? 'タスク'
                            : formatScheduleTimeRange(item)}
                      </span>
                    </button>
                  ))}
                  {scheduleSearchResults.length === 0 && (
                    <div style={styles.scheduleSearchEmpty}>{searchMonthTitle}に該当する予定はありません。</div>
                  )}
                </div>
              )}
            </section>
            {monthCalendarEnabled && (
              <section className="month-calendar-section" style={styles.monthCalendarSection} aria-label="月カレンダー">
                <div className="month-calendar-header" style={styles.monthCalendarHeader}>
                  <button
                    type="button"
                    className="month-calendar-collapse-btn"
                    style={styles.monthCalendarCollapseButton}
                    onClick={() => setMonthCalendarCollapsed((current) => !current)}
                    aria-expanded={!monthCalendarCollapsed}
                    aria-label={monthCalendarCollapsed ? '月カレンダーを開く' : '月カレンダーを閉じる'}
                  >
                    {monthCalendarCollapsed ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
                    <span>月カレンダー</span>
                  </button>
                  <span className="month-calendar-nav-title" style={styles.monthCalendarNavTitle}>{formatMonthTitle(monthViewDate)}</span>
                </div>
                {!monthCalendarCollapsed && (
                  <div className="month-calendar-body" style={styles.monthCalendarBody}>
                    <div className="month-calendar-weekday-row" style={styles.monthCalendarWeekdayRow}>
                      {Array.from({ length: 7 }, (_, index) => dayNames[(weekStartDay + index) % 7]).map((dayName, index) => (
                        <span
                          key={dayName}
                          style={{
                            ...styles.monthCalendarWeekdayCell,
                            color: (weekStartDay + index) % 7 === 0 ? '#dc2626' : (weekStartDay + index) % 7 === 6 ? '#2563eb' : '#64748b',
                          }}
                        >
                          {dayName}
                        </span>
                      ))}
                    </div>
                    {monthGridWeeks.map((week) => {
                      const rowWeekKey = formatDateKey(getWeekStart(week[0], weekStartDay))
                      const isCurrentWeekRow = rowWeekKey === weekStartKey
                      return (
                        <div
                          key={rowWeekKey}
                          className="month-calendar-week-row"
                          style={{
                            ...styles.monthCalendarWeekRow,
                            ...(isCurrentWeekRow ? styles.monthCalendarCurrentWeekRow : {}),
                          }}
                        >
                          {week.map((date) => {
                            const dateKey = formatDateKey(date)
                            const isCurrentMonth = date.getMonth() === monthViewDate.getMonth()
                            const isToday = dateKey === formatDateKey(new Date())
                            const isSelected = dateKey === selectedKey
                            const isHoliday = Boolean(holidayMap[dateKey])
                            const items = scheduleMap[dateKey] || []
                            const totalCount = items.length
                            const incompleteCount = items.filter((item) => item.completed !== true).length
                            const isAllCompleted = totalCount > 0 && incompleteCount === 0
                            const isCountAbbreviated = incompleteCount >= 100 || totalCount >= 100
                            const hasSleepRecord = Boolean(sleepRecordMap[dateKey])

                            return (
                              <button
                                type="button"
                                key={dateKey}
                                className="month-calendar-day-cell"
                                onClick={() => setSelectedDate(date)}
                                style={{
                                  ...styles.monthCalendarDayCell,
                                  background: isSelected ? '#dbeafe' : isToday ? '#e3f6e8' : 'transparent',
                                  borderColor: isSelected ? '#2563eb' : isToday ? '#86d9a0' : 'transparent',
                                  opacity: isCurrentMonth ? 1 : 0.35,
                                }}
                              >
                                <span style={{ ...styles.monthCalendarDayNumber, color: isHoliday ? '#dc2626' : '#1e293b' }}>{date.getDate()}</span>
                                <span style={styles.monthCalendarDayCount}>
                                  {totalCount > 0 && (
                                    isCountAbbreviated ? '…/…' : isAllCompleted ? (
                                      <span style={styles.monthCalendarCompletedCount}>{totalCount}</span>
                                    ) : (
                                      <>
                                        <span style={styles.monthCalendarIncompleteCount}>{incompleteCount}</span>
                                        <span style={styles.monthCalendarCountSeparator}>/</span>
                                        <span>{totalCount}</span>
                                      </>
                                    )
                                  )}
                                </span>
                                {hasSleepRecord && <span style={styles.monthCalendarSleepMark}>睡眠</span>}
                              </button>
                            )
                          })}
                        </div>
                      )
                    })}
                  </div>
                )}
              </section>
            )}
            {weekCalendarEnabled && (
              <section
                className="week-section"
                style={{ ...styles.weekSection, ...(weekCalendarFixed ? styles.fixedWeekSection : {}), touchAction: 'pan-y' }}
              onTouchStart={(event) => {
                weekTouchRef.current = event.changedTouches[0].clientX
              }}
              onTouchEnd={(event) => {
                if (weekTouchRef.current === null) return
                const distance = event.changedTouches[0].clientX - weekTouchRef.current
                weekTouchRef.current = null
                if (Math.abs(distance) > 50) changeWeek(distance < 0 ? 7 : -7)
              }}
              onPointerDown={(event) => {
                if (event.pointerType === 'touch') return
                weekSwipeRef.current = event.clientX
              }}
              onPointerUp={(event) => {
                if (event.pointerType === 'touch') return
                if (weekSwipeRef.current === null) return
                const distance = event.clientX - weekSwipeRef.current
                weekSwipeRef.current = null
                if (Math.abs(distance) > 60) changeWeek(distance < 0 ? 7 : -7)
              }}
              onPointerCancel={() => {
                weekSwipeRef.current = null
              }}
              onWheel={(e) => {
                if (Math.abs(e.deltaY) > 30) {
                  changeWeek(e.deltaY > 0 ? 7 : -7)
                }
              }}
            >
              <div className="week-nav" style={styles.weekNav}>
                <button type="button" className="week-nav-btn" style={styles.navButton} aria-label="前の週" onClick={selectPreviousWeek}>
                  <ChevronLeft size={16} />
                </button>
                <div className="week-nav-title" style={styles.weekTitle}>{formatMonthTitle(selectedDate)}</div>
                <button type="button" className="week-nav-btn" style={styles.navButton} aria-label="次の週" onClick={selectNextWeek}>
                  <ChevronRight size={16} />
                </button>
              </div>

              <div className="week-grid" style={styles.weekGrid}>
                {weekDates.map((date) => {
                  const key = formatDateKey(date)
                  const list = scheduleMap[key] || []
                  const totalCount = list.length
                  const incompleteCount = list.filter((item) => item.completed !== true).length
                  const isAllCompleted = totalCount > 0 && incompleteCount === 0
                  const isCountAbbreviated = incompleteCount >= 100 || totalCount >= 100
                  const isSelected = key === selectedKey
                  const isToday = key === formatDateKey(new Date())
                  const isHoliday = Boolean(holidayMap[key])

                  return (
                    <button
                      type="button"
                      key={key}
                      className="week-day-tile"
                      onClick={() => setSelectedDate(date)}
                      style={{
                        ...styles.dayButton,
                        background: isSelected ? '#dbeafe' : isToday ? '#e3f6e8' : '#ffffff',
                        borderColor: isSelected ? '#2563eb' : isToday ? '#86d9a0' : '#d9e2f2',
                        boxShadow: isSelected ? '0 6px 18px rgba(37,99,235,0.16)' : '0 2px 6px rgba(15,23,42,0.04)',
                      }}
                    >
                      <span className="week-day-label" style={{ ...styles.dayLabel, color: isHoliday || date.getDay() === 0 ? '#dc2626' : date.getDay() === 6 ? '#2563eb' : '#475569' }}>
                        {dayNames[date.getDay()]}
                      </span>
                      <strong className="week-day-number" style={{ ...styles.dayNumber, color: isHoliday ? '#dc2626' : '#0f172a' }}>{date.getDate()}</strong>
                      <span style={styles.dayMeta}>
                        {totalCount > 0 && (
                          isCountAbbreviated ? '…/…' : isAllCompleted ? (
                            <span style={styles.monthCalendarCompletedCount}>{totalCount}</span>
                          ) : (
                            <>
                              <span style={styles.monthCalendarIncompleteCount}>{incompleteCount}</span>
                              <span style={styles.monthCalendarCountSeparator}>/</span>
                              <span>{totalCount}</span>
                            </>
                          )
                        )}
                      </span>
                    </button>
                  )
                })}
              </div>
              </section>
            )}

            <section
              ref={scheduleSectionRef}
              className="schedule-section"
              style={{
                ...styles.scheduleSection,
                ...(weekCalendarEnabled && weekCalendarFixed ? styles.scrollableScheduleSection : {}),
                touchAction: scheduleDrag ? 'none' : 'pan-y',
              }}
              onTouchStart={(event) => {
                dayTouchRef.current = null
                if (scheduleDragRef.current) return
                if (isScheduleSectionSwipeTarget(event.target)) return
                dayTouchRef.current = event.changedTouches[0].clientX
              }}
              onTouchEnd={(event) => {
                if (scheduleDragRef.current) {
                  dayTouchRef.current = null
                  return
                }
                if (dayTouchRef.current === null) return
                if (isScheduleSectionSwipeTarget(event.target)) {
                  dayTouchRef.current = null
                  return
                }
                const distance = event.changedTouches[0].clientX - dayTouchRef.current
                dayTouchRef.current = null
                if (Math.abs(distance) > 50) {
                  clearLongPress()
                  changeSelectedDay(distance < 0 ? 1 : -1)
                }
              }}
              onPointerDown={(event) => {
                if (scheduleDragRef.current) return
                if (event.pointerType === 'touch') return
                daySwipeRef.current = event.clientX
              }}
              onPointerUp={(event) => {
                if (scheduleDragRef.current) {
                  daySwipeRef.current = null
                  return
                }
                if (event.pointerType === 'touch') return
                if (daySwipeRef.current === null) return
                const distance = event.clientX - daySwipeRef.current
                daySwipeRef.current = null
                if (Math.abs(distance) > 60) {
                  clearLongPress()
                  changeSelectedDay(distance < 0 ? 1 : -1)
                }
              }}
              onPointerCancel={() => {
                daySwipeRef.current = null
              }}
            >
              <div className="selected-header" style={styles.selectedHeader}>
                <div>
                  <div className="selected-caption" style={styles.selectedCaption}>選択中の日</div>
                  <h2 className="selected-date-text" style={{ ...styles.selectedDateText, color: selectedHolidayName ? '#dc2626' : '#0f172a' }}>
                    {formatWeekTitle(selectedDate)}{selectedHolidayName ? ` ${selectedHolidayName}` : ''}
                  </h2>
                </div>
                <div style={styles.selectedHeaderActions}>
                  {formatDateKey(selectedDate) !== formatDateKey(new Date()) && (
                    <button type="button" className="today-reset-button" style={styles.todayResetButton} onClick={goToToday}>
                      今日へ戻る
                    </button>
                  )}
                  <button type="button" className="schedule-add-button" style={styles.addButton} onClick={handleAddSchedule}>
                    <Plus size={18} /> 追加
                  </button>
                </div>
              </div>

              {showDoubleTapHint && doubleTapHintMessages[Math.min(hintMessageIndex, doubleTapHintMessages.length - 1)] && (
                <div
                  style={{ ...styles.doubleTapHintBanner, ...(doubleTapHintFading ? styles.doubleTapHintBannerFading : {}) }}
                  role="status"
                >
                  {(() => {
                    const currentHint = doubleTapHintMessages[Math.min(hintMessageIndex, doubleTapHintMessages.length - 1)]
                    const HintIcon = currentHint.icon
                    return (
                      <>
                        <HintIcon size={16} /> <span>{currentHint.text}</span>
                      </>
                    )
                  })()}
                </div>
              )}

              {loading && selectedTopLevelItems.length === 0 ? (
                <div style={styles.loadingState}>読み込み中...</div>
              ) : selectedTopLevelItems.length === 0 ? (
                <div style={styles.emptyState}>この日の予定はまだありません。追加ボタンから予定を登録できます。</div>
              ) : (
                <div
                  className="schedule-list"
                  style={styles.scheduleList}
                  onPointerDownCapture={handleScheduleListPointerDownCapture}
                >
                  {selectedTopLevelItems.map((item) => {
                    const timedItems = filterTimedSchedules(selectedTopLevelItems)
                    const taskItem = isScheduleTask(item)
                    const childTasks = !taskItem ? findChildTasksForParent(scheduleMap, item) : []
                    const timedIndex = resolveTimedScheduleIndex(item, timedItems)
                    const isFirst = taskItem || timedIndex === 0
                    const isLast = taskItem || (timedIndex >= 0 && timedIndex === timedItems.length - 1)
                    const hasOverlap = !taskItem && timedItems.some((other) => {
                      return other.id !== item.id && isTimeOverlap(item.time || '09:00', item.endTime || '10:00', other.time || '09:00', other.endTime || '10:00')
                    })
                    const timeDisplay = taskItem ? 'タスク' : `${item.time || '09:00'} - ${item.endTime || '10:00'}`
                    
                    let timeBoxStyle = styles.scheduleTimeBox
                    let clockIconColor = '#2563eb'

                    if (item.completed) {
                      timeBoxStyle = { ...styles.scheduleTimeBox, background: '#d1d5db', color: '#6b7280' }
                      clockIconColor = '#6b7280'
                    } else if (taskItem) {
                      timeBoxStyle = { ...styles.scheduleTimeBox, background: '#f3f4f6', color: '#374151', border: '1px dashed #9ca3af' }
                      clockIconColor = '#6b7280'
                    } else if (item.priority === 'high') {
                      timeBoxStyle = { ...styles.scheduleTimeBox, background: '#fee2e2', color: '#dc2626' }
                      clockIconColor = '#dc2626'
                    } else if (item.priority === 'low') {
                      timeBoxStyle = { ...styles.scheduleTimeBox, background: 'transparent', border: '1px solid #cbd5e1', color: '#475569' }
                      clockIconColor = '#64748b'
                    } else {
                      timeBoxStyle = { ...styles.scheduleTimeBox, background: '#e0edff', color: '#1d4ed8' }
                      clockIconColor = '#2563eb'
                    }

                    const urgency = getScheduleUrgency(item, nowTick)
                    const canDragReorder = !taskItem && !item.completed
                    const isDraggingCard = scheduleDrag?.itemId === item.id
                    const isDropBefore = Boolean(
                      scheduleDrag
                      && scheduleDrag.overItemId === item.id
                      && scheduleDrag.place === 'before'
                      && canDragReorder,
                    )
                    const isDropAfter = Boolean(
                      scheduleDrag
                      && scheduleDrag.overItemId === item.id
                      && scheduleDrag.place === 'after'
                      && canDragReorder,
                    )

                    return (
                    <div
                      key={item.id}
                      className={`schedule-card-mobile${isDraggingCard ? ' schedule-card-dragging' : ''}`}
                      data-schedule-card-id={item.id}
                      data-schedule-draggable={canDragReorder ? '1' : '0'}
                      onClick={() => handleScheduleCardTap(item)}
                      onPointerDown={(event) => handleScheduleCardPointerDown(item, event)}
                      style={{
                        ...styles.scheduleCard,
                        ...(item.completed ? styles.completedScheduleCard : {}),
                        ...(isDraggingCard ? styles.scheduleCardDragging : {}),
                        ...(isDropBefore ? styles.scheduleCardDropBefore : {}),
                        ...(isDropAfter ? styles.scheduleCardDropAfter : {}),
                        ...(isDraggingCard ? { transform: `translateY(${scheduleDrag.deltaY}px)` } : {}),
                        ...(canDragReorder ? { touchAction: isDraggingCard ? 'none' : 'pan-y' } : {}),
                      }}
                    >
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: '4px' }}>
                        <div style={timeBoxStyle}>
                          {!taskItem && <Clock3 size={16} color={clockIconColor} />}
                          <span>{timeDisplay}</span>
                        </div>
                        {hasOverlap && (
                          <div style={{ display: 'flex', alignItems: 'center', gap: '4px', color: '#dc2626', fontSize: '11px', fontWeight: 700, paddingLeft: '2px' }}>
                            <AlertTriangle size={14} color="#dc2626" />
                            <span>重複注意</span>
                          </div>
                        )}
                      </div>

                      <div style={styles.scheduleBody}>
                        <div className="schedule-title-row-mobile" style={styles.scheduleTitleRow}>
                          <div style={styles.scheduleTitleWrap}>
                            <span
                              className={`schedule-title-text${urgency === 'critical' ? ' schedule-title-urgent-critical' : urgency === 'warning' ? ' schedule-title-urgent-warning' : ''}`}
                              style={{ ...styles.scheduleTitle, ...(item.completed ? styles.completedText : {}) }}
                            >{item.title}</span>
                            {item.priority !== 'normal' && (
                              <span style={{ ...styles.priorityBadge, ...(item.priority === 'high' ? styles.highPriorityBadge : styles.lowPriorityBadge) }}>
                                {item.priority === 'high' ? '重要' : '低'}
                              </span>
                            )}
                          </div>
                          <div className="schedule-actions-mobile" style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
                            <button
                              type="button"
                              className="schedule-complete-btn"
                              style={{ ...styles.completeButton, ...(item.completed ? styles.completedButton : {}) }}
                              aria-label={item.completed ? '完了を取り消す' : '予定を完了にする'}
                              onClick={(event) => {
                                stopScheduleCardActionBubble(event)
                                closeAllScheduleActionMenus()
                                void toggleCompleted(getLatestScheduleItem(item))
                              }}
                              title={item.completed ? '完了を取り消す' : '完了にする'}
                            >
                              <Check size={16} />
                            </button>
                            <details
                              className="schedule-action-menu"
                              style={styles.scheduleActionMenu}
                              onClick={stopScheduleCardActionBubble}
                              onToggle={handleScheduleActionMenuToggle}
                            >
                              <summary
                                className="schedule-action-menu-summary"
                                style={styles.scheduleActionMenuButton}
                                aria-label="予定の操作"
                                title="予定の操作"
                              >
                                <MoreHorizontal size={20} />
                              </summary>
                              <div className="schedule-action-menu-list" style={styles.scheduleActionMenuList}>
                                {!taskItem && (
                                  <button type="button" className="schedule-action-menu-item" style={styles.scheduleActionMenuItem} onClick={(event) => {
                                    event.stopPropagation()
                                    closeScheduleActionMenu(event)
                                    if (!item.completed) openAddChildTask(item)
                                  }} disabled={item.completed}>
                                    <Plus size={18} /> <span>タスクを追加</span>
                                  </button>
                                )}
                                {!taskItem && (
                                  <>
                                <button type="button" className="schedule-action-menu-item" style={styles.scheduleActionMenuItem} onClick={(event) => {
                                  event.stopPropagation()
                                  closeScheduleActionMenu(event)
                                  if (item.completed) return
                                  if (isFirst) {
                                    notifyScheduleAction('時刻順でいちばん上の予定のため、これ以上上には移動できません。')
                                    return
                                  }
                                  void moveScheduleItem(item, 'up')
                                }} disabled={item.completed}>
                                  <ChevronUp size={18} /> <span>上に移動</span>
                                </button>
                                <button type="button" className="schedule-action-menu-item" style={styles.scheduleActionMenuItem} onClick={(event) => {
                                  event.stopPropagation()
                                  closeScheduleActionMenu(event)
                                  if (!item.completed && !isLast) moveScheduleItem(item, 'down')
                                }} disabled={item.completed || isLast}>
                                  <ChevronDown size={18} /> <span>下に移動</span>
                                </button>
                                  </>
                                )}
                                <button type="button" className="schedule-action-menu-item" style={styles.scheduleActionMenuItem} onClick={(event) => {
                                  event.stopPropagation()
                                  closeScheduleActionMenu(event)
                                  if (!item.completed) openMoveCopyDialog(item)
                                }} disabled={item.completed}>
                                  <Copy size={18} /> <span>複製 / 移動</span>
                                </button>
                                <button type="button" className="schedule-action-menu-item" style={styles.scheduleActionMenuItem} onClick={(event) => {
                                  event.stopPropagation()
                                  closeScheduleActionMenu(event)
                                  if (!item.completed) copyToFutureFourWeeks(item)
                                }} disabled={item.completed}>
                                  <Repeat2 size={18} /> <span>未来4週間にコピー</span>
                                </button>
                                {!taskItem && (
                                <button type="button" className="schedule-action-menu-item" style={styles.scheduleActionMenuItem} onClick={(event) => {
                                  event.stopPropagation()
                                  closeScheduleActionMenu(event)
                                  if (!item.completed) openRelationDialog(item)
                                }} disabled={item.completed}>
                                  <Link2 size={18} /> <span>先に終わらせる予定を選ぶ</span>
                                </button>
                                )}
                                <button type="button" className="schedule-action-menu-item schedule-action-delete-item" style={{ ...styles.scheduleActionMenuItem, ...styles.scheduleActionDelete }} onClick={(event) => {
                                  event.stopPropagation()
                                  closeScheduleActionMenu(event)
                                  deleteScheduleItem(item)
                                }}>
                                  <Trash2 size={18} /> <span>{taskItem ? 'タスクを削除' : '予定を削除'}</span>
                                </button>
                              </div>
                            </details>
                          </div>
                        </div>

                        <div style={styles.scheduleDetailText}>
                          {item.details ? item.details : '詳細なし'}
                        </div>
                        {!taskItem && (item.relatedPrev || item.relatedNext) && (
                          <div style={styles.relationInfoGroup} aria-label="順番指定">
                            {item.relatedPrev && (
                              <div
                                style={styles.relationInfoTextLink}
                                onClick={(event) => {
                                  event.stopPropagation()
                                  openRelatedSchedule(item.relatedPrev)
                                }}
                              >
                                先に終わらせる: {formatScheduleRelationLine(item.relatedPrev)}
                              </div>
                            )}
                            {item.relatedNext && (
                              <div
                                style={styles.relationInfoTextLink}
                                onClick={(event) => {
                                  event.stopPropagation()
                                  openRelatedSchedule(item.relatedNext)
                                }}
                              >
                                このあと完了待ち: {formatScheduleRelationLine(item.relatedNext)}
                              </div>
                            )}
                          </div>
                        )}
                        {childTasks.length > 0 && (
                          <div className="schedule-child-task-list" style={styles.childTaskList} aria-label="配下タスク">
                            {childTasks.map((child) => {
                              const childLocked = item.completed === true
                              return (
                                <div
                                  key={child.id}
                                  className="schedule-child-task-row"
                                  style={{
                                    ...styles.childTaskRow,
                                    ...(child.completed ? styles.childTaskRowCompleted : {}),
                                  }}
                                  onClick={(event) => {
                                    event.stopPropagation()
                                    handleScheduleCardTap(child)
                                  }}
                                >
                                  <span style={{ ...styles.childTaskTitle, ...(child.completed ? styles.completedText : {}) }}>
                                    {child.title || 'タスク'}
                                  </span>
                                  <div
                                    className="schedule-actions-mobile schedule-child-task-actions"
                                    style={{ ...styles.childTaskActions, display: 'flex', gap: '4px', alignItems: 'center' }}
                                    onClick={stopScheduleCardActionBubble}
                                  >
                                    <button
                                      type="button"
                                      className="schedule-complete-btn"
                                      style={{
                                        ...styles.completeButton,
                                        ...(child.completed ? styles.completedButton : {}),
                                        ...(childLocked ? styles.childTaskCompleteLocked : {}),
                                      }}
                                      aria-label={child.completed ? '完了を取り消す' : 'タスクを完了にする'}
                                      disabled={childLocked}
                                      onClick={(event) => {
                                        stopScheduleCardActionBubble(event)
                                        if (childLocked) {
                                          notifyScheduleAction(CHILD_COMPLETE_LOCKED_BY_PARENT_MSG)
                                          return
                                        }
                                        void toggleCompleted(getLatestScheduleItem(child))
                                      }}
                                      title={childLocked ? '親が完了済みのため変更できません' : (child.completed ? '完了を取り消す' : '完了にする')}
                                    >
                                      <Check size={14} />
                                    </button>
                                    <details
                                      className="schedule-action-menu schedule-child-action-menu"
                                      style={styles.scheduleActionMenu}
                                      onClick={stopScheduleCardActionBubble}
                                      onToggle={handleScheduleActionMenuToggle}
                                    >
                                      <summary
                                        className="schedule-action-menu-summary"
                                        style={{ ...styles.scheduleActionMenuButton, ...styles.childTaskActionMenuButton }}
                                        aria-label="配下タスクの操作"
                                        title="配下タスクの操作"
                                      >
                                        <MoreHorizontal size={16} />
                                      </summary>
                                      <div className="schedule-action-menu-list" style={{ ...styles.scheduleActionMenuList, ...styles.childTaskActionMenuList }}>
                                        <button type="button" className="schedule-action-menu-item" style={styles.scheduleActionMenuItem} onClick={(event) => {
                                          event.stopPropagation()
                                          closeScheduleActionMenu(event)
                                          openDetail(child)
                                        }} disabled={child.completed || childLocked}>
                                          <PencilLine size={18} /> <span>編集</span>
                                        </button>
                                        <button type="button" className="schedule-action-menu-item schedule-action-delete-item" style={{ ...styles.scheduleActionMenuItem, ...styles.scheduleActionDelete }} onClick={(event) => {
                                          event.stopPropagation()
                                          closeScheduleActionMenu(event)
                                          deleteScheduleItem(child)
                                        }}>
                                          <Trash2 size={18} /> <span>タスクを削除</span>
                                        </button>
                                      </div>
                                    </details>
                                  </div>
                                </div>
                              )
                            })}
                          </div>
                        )}
                      </div>
                    </div>
                    )})}
                </div>
              )}
            </section>

            {!sleepOnlyMode && (
              <section className="achievement-bar" style={styles.achievementBar} aria-label="達成状況">
                <div className="achievement-item" style={styles.achievementItem}>
                  <span style={styles.achievementIcon} aria-hidden="true">🔥</span>
                  <span style={styles.achievementLabel}>{achievementStats.streak}日連続達成</span>
                </div>
                {achievementStats.weekBadge && (
                  <div className="achievement-item" style={styles.achievementBadge}>
                    <span style={styles.achievementIcon} aria-hidden="true">{achievementStats.weekBadge.icon}</span>
                    <span style={styles.achievementLabel}>今週: {achievementStats.weekBadge.label}</span>
                  </div>
                )}
              </section>
            )}

            {sleepRecordEnabled && (
              <div className="sleep-record-panel" style={styles.sleepRecordPanel} aria-label="睡眠記録">
                <div style={styles.sleepRecordTitleRow}>
                  <button
                    type="button"
                    style={styles.sleepRecordCollapseButton}
                    onClick={() => setSleepRecordCollapsed((current) => !current)}
                    aria-expanded={!sleepRecordCollapsed}
                  >
                    {sleepRecordCollapsed ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
                    <strong style={styles.sleepRecordTitle}>睡眠記録</strong>
                  </button>
                  <span style={styles.sleepRecordStatus}>{sleepRecord?.exists ? '保存済み' : '未記録'}</span>
                </div>
                {sleepOnlyMode && <div style={styles.sleepOnlyDate}>{formatWeekTitle(selectedDate)}</div>}
                {!sleepRecordCollapsed && (
                  <>
                    <div style={styles.sleepRecordFields}>
                      <label style={styles.sleepRecordField}>
                        <span>起床</span>
                        <input
                          type="time"
                          value={sleepRecord?.wakeTime || formatCurrentTime()}
                          onChange={(event) => {
                            setSleepSaveMessage('')
                            setSleepRecord((current) => ({ ...(current || {}), wakeTime: event.target.value }))
                          }}
                          style={styles.sleepRecordInput}
                        />
                        <span style={styles.sleepRecordActions}>
                          <button type="button" style={styles.sleepRecordSaveButton} onClick={() => saveSleepTime('wakeTime', sleepRecord?.wakeTime)} disabled={sleepSaving}>
                            保存
                          </button>
                          <button type="button" style={styles.currentTimeButton} onClick={() => saveSleepTime('wakeTime')} disabled={sleepSaving}>
                            現在時刻
                          </button>
                        </span>
                      </label>
                      <label style={styles.sleepRecordField}>
                        <span>就寝</span>
                        <input
                          type="time"
                          value={sleepRecord?.bedtime || formatCurrentTime()}
                          onChange={(event) => {
                            setSleepSaveMessage('')
                            setSleepRecord((current) => ({ ...(current || {}), bedtime: event.target.value }))
                          }}
                          style={styles.sleepRecordInput}
                        />
                        <span style={styles.sleepRecordActions}>
                          <button type="button" style={styles.sleepRecordSaveButton} onClick={() => saveSleepTime('bedtime', sleepRecord?.bedtime)} disabled={sleepSaving}>
                            保存
                          </button>
                          <button type="button" style={styles.currentTimeButton} onClick={() => saveSleepTime('bedtime')} disabled={sleepSaving}>
                            現在時刻
                          </button>
                        </span>
                      </label>
                    </div>
                    {sleepSaveMessage && <div style={styles.sleepSaveMessage} role="status">{sleepSaveMessage}</div>}
                    <div style={styles.previousSleepRecord}>
                      <span>前日の就寝</span>
                      <strong>{previousSleepRecord?.bedtime || '未記録'}</strong>
                      <span style={styles.previousSleepRecordNote}>前日の記録を表示</span>
                    </div>
                  </>
                )}
              </div>
            )}

            {!sleepOnlyMode && medicationRecordEnabled && (
              <section className="medication-record-panel" style={styles.medicationRecordPanel} aria-label="服薬記録">
                <div style={styles.medicationTitleRow}>
                  <button
                    type="button"
                    style={styles.sleepRecordCollapseButton}
                    onClick={() => setMedicationRecordCollapsed((current) => !current)}
                    aria-expanded={!medicationRecordCollapsed}
                  >
                    {medicationRecordCollapsed ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
                    <strong style={styles.sleepRecordTitle}>服薬記録</strong>
                  </button>
                  <button
                    type="button"
                    style={{
                      ...styles.medicationNotifyButton,
                      ...(medicationSettingsDraft.notifyEnabled === false ? styles.medicationNotifyButtonOff : {}),
                    }}
                    onClick={toggleMedicationNotifyEnabled}
                    disabled={medicationSaving}
                    title="服薬の5分前通知のみ切り替えます（予定通知とは別です）"
                  >
                    {medicationSettingsDraft.notifyEnabled === false ? '服薬通知オフ' : '通知不要'}
                  </button>
                </div>
                {!medicationRecordCollapsed && (
                  <>
                    <div style={styles.medicationSlotList}>
                      {MEDICATION_SLOT_KEYS.map((slotKey) => {
                        const slot = medicationRecord?.slots?.[slotKey] || { completed: false, takenAt: null }
                        const scheduledTime = medicationSettings[slotKey] || DEFAULT_MEDICATION_TIMES[slotKey]
                        const alert = getMedicationSlotAlert({
                          scheduledTime,
                          completed: slot.completed,
                          isSelectedToday: selectedIsToday,
                          nowMs: nowTick,
                        })
                        return (
                          <div
                            key={slotKey}
                            className={alert === 'due' ? 'medication-slot-due' : undefined}
                            style={{
                              ...styles.medicationSlotRow,
                              ...(slot.completed ? styles.medicationSlotRowDone : {}),
                              ...(alert === 'due' ? styles.medicationSlotRowDue : {}),
                            }}
                          >
                            <div style={styles.medicationSlotMeta}>
                              <strong>{MEDICATION_SLOT_LABELS[slotKey]}</strong>
                              <span style={styles.medicationSlotTime}>{scheduledTime}</span>
                              {slot.completed && slot.takenAt && (
                                <span style={styles.medicationSlotTaken}>記録 {slot.takenAt}</span>
                              )}
                              {alert === 'due' && !slot.completed && (
                                <span style={styles.medicationSlotWarn}>未服薬</span>
                              )}
                            </div>
                            <button
                              type="button"
                              style={{
                                ...styles.medicationSlotButton,
                                ...(slot.completed ? styles.medicationSlotButtonDone : {}),
                              }}
                              onClick={() => toggleMedicationSlot(slotKey)}
                              disabled={medicationSaving}
                              aria-pressed={slot.completed}
                            >
                              {slot.completed ? '済' : '完了'}
                            </button>
                          </div>
                        )
                      })}
                    </div>
                    <div style={styles.medicationSettingsBlock} aria-label="服薬時刻の設定">
                      <div style={styles.medicationSettingsHeading}>服薬時刻</div>
                      <div style={styles.medicationSettingsFields}>
                        {MEDICATION_SLOT_KEYS.map((slotKey) => (
                          <label key={slotKey} style={styles.medicationSettingsField}>
                            <span>{MEDICATION_SLOT_LABELS[slotKey]}</span>
                            <input
                              type="time"
                              value={medicationSettingsDraft[slotKey] || DEFAULT_MEDICATION_TIMES[slotKey]}
                              onChange={(event) => {
                                setMedicationSaveMessage('')
                                setMedicationSettingsDraft((current) => ({
                                  ...current,
                                  [slotKey]: event.target.value,
                                }))
                              }}
                              style={styles.sleepRecordInput}
                            />
                          </label>
                        ))}
                      </div>
                      <button
                        type="button"
                        style={styles.medicationSettingsSaveButton}
                        onClick={saveMedicationSettings}
                        disabled={medicationSaving}
                      >
                        時刻を保存
                      </button>
                    </div>
                    {medicationSaveMessage && (
                      <div style={styles.sleepSaveMessage} role="status">{medicationSaveMessage}</div>
                    )}
                  </>
                )}
              </section>
            )}

            {!sleepOnlyMode && healthLifeCountEnabled && healthLifePresentation && stepsDisplay && (
              <section className="health-life-count-section" style={styles.healthLifeCountSection} aria-label="健康生活カウント">
                <div className="health-life-count-nav" style={styles.healthLifeCountNav}>
                  <button
                    type="button"
                    style={styles.healthLifeCountCollapseButton}
                    onClick={() => setHealthLifeCountCollapsed((current) => !current)}
                    aria-expanded={!healthLifeCountCollapsed}
                    aria-label={healthLifeCountCollapsed ? '健康生活カウントを開く' : '健康生活カウントを閉じる'}
                  >
                    {healthLifeCountCollapsed ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
                    <span>健康生活カウント</span>
                  </button>
                </div>
                {!healthLifeCountCollapsed && (
                  <div
                    style={{
                      ...styles.footerHealthStrip,
                      borderLeftColor: healthLifeBandColors.border,
                    }}
                    role="status"
                    aria-label={healthLifePresentation.ariaLabel}
                  >
                    <div style={styles.footerFatigueLine1}>{healthLifePresentation.fatigueLine1}</div>
                    <div style={styles.footerFatigueLine2}>{healthLifePresentation.fatigueLine2}</div>
                    <div style={styles.footerMetricBars} aria-hidden="true">
                      <div style={styles.footerMetricBarRow}>
                        <span style={styles.footerMetricBarLabel}>睡眠</span>
                        <div style={styles.footerMetricBarTrack}>
                          <div
                            style={{
                              ...styles.footerMetricBarFill,
                              width: `${Math.round(healthLifePresentation.sleepBarRatio * 100)}%`,
                              background: '#14b8a6',
                            }}
                          />
                        </div>
                      </div>
                      <div style={styles.footerMetricBarRow}>
                        <span style={styles.footerMetricBarLabel}>予定</span>
                        <div style={styles.footerMetricBarTrack}>
                          <div
                            style={{
                              ...styles.footerMetricBarFill,
                              width: `${Math.round(healthLifePresentation.scheduleBarRatio * 100)}%`,
                              background: '#f59e0b',
                            }}
                          />
                        </div>
                      </div>
                      {healthLifePresentation.showStepsBar && (
                        <div style={styles.footerMetricBarRow}>
                          <span style={styles.footerMetricBarLabel}>歩数</span>
                          <div style={styles.footerMetricBarTrack}>
                            <div
                              style={{
                                ...styles.footerMetricBarFill,
                                width: `${Math.round(healthLifePresentation.stepsBarRatio * 100)}%`,
                                background: '#6366f1',
                              }}
                            />
                          </div>
                        </div>
                      )}
                    </div>
                    {healthLifePresentation.sleepAverageLabel && (
                      <div style={styles.footerSleepAverage}>
                        {healthLifePresentation.sleepAverageLabel}
                        {sleepLevelEmoji && <span style={styles.footerSleepEmoji}>{sleepLevelEmoji}</span>}
                      </div>
                    )}
                    <div
                      style={{
                        ...styles.footerStepsLine,
                        ...(stepsDisplay.status === 'unlinked' ? styles.footerStepsUnlinked : {}),
                      }}
                    >
                      {stepsDisplay.label}
                    </div>
                    <div style={styles.footerStepsEditor} aria-label="歩数の手入力とCSV取込">
                      <input
                        type="number"
                        min={0}
                        step={1}
                        inputMode="numeric"
                        value={stepManualDraft}
                        onChange={(event) => setStepManualDraft(event.target.value)}
                        placeholder="歩数"
                        style={styles.footerStepsInput}
                        disabled={stepsCsvBusy}
                        aria-label={`${selectedKey} の歩数`}
                      />
                      <button
                        type="button"
                        style={styles.footerStepsSaveButton}
                        onClick={saveManualStepsForSelectedDay}
                        disabled={stepsCsvBusy}
                      >
                        記録
                      </button>
                      {selectedIsToday && (
                        <button
                          type="button"
                          style={styles.footerStepsCheckButton}
                          onClick={openDeviceStepsAppForCheck}
                          disabled={stepsCsvBusy}
                          title="歩数アプリの確認手順を表示します。数値の保存は「記録」で行います。"
                        >
                          歩数を確認する
                        </button>
                      )}
                      <button
                        type="button"
                        style={styles.footerStepsImportButton}
                        onClick={() => stepsCsvFileInputRef.current?.click()}
                        disabled={stepsCsvBusy}
                      >
                        CSV取込
                      </button>
                      <input
                        ref={stepsCsvFileInputRef}
                        type="file"
                        accept=".csv,text/csv"
                        style={{ display: 'none' }}
                        onChange={handleStepsCsvFileChange}
                      />
                      {!Capacitor.isNativePlatform() && stepsByDate && stepsByDate.size > 0 && (
                        <button
                          type="button"
                          style={styles.footerStepsClearButton}
                          onClick={handleClearStepsCsvWeb}
                          disabled={stepsCsvBusy}
                          title="public/fixtures のサンプルは消えません。ブラウザに保存した歩数CSVだけ削除します。"
                        >
                          保存CSVクリア
                        </button>
                      )}
                    </div>
                    <div style={styles.healthLifeDisclaimer}>
                      ※医療上の診断・治療の代わりにはなりません。
                      <button type="button" style={styles.fatigueGuideLinkButton} onClick={() => openFatigueGuidePdf(helpLang)}>
                        {helpLang === 'en' ? 'Score guide (PDF)' : '判定の説明（PDF）'}
                      </button>
                    </div>
                  </div>
                )}
              </section>
            )}

            {!sleepOnlyMode && (
              <div style={styles.homeCopyright}>© {new Date().getFullYear()} {APP_DISPLAY_NAME}</div>
            )}
          </main>
          )}

          {view === 'scheduleList' && (
            <main style={styles.main}>
              <section style={styles.listSection}>
                <h2 style={styles.listSectionTitle}>スケジュール一覧（{formatDateKey(weekDates[0])} ～ {formatDateKey(weekDates[6])}）</h2>
                {scheduleListItems.length === 0 ? (
                  <p style={styles.listEmpty}>該当する予定はありません。</p>
                ) : (
                  <div style={styles.listTableWrap}>
                    <table style={styles.listTable}>
                      <thead>
                        <tr>
                          <th style={styles.listTh}>日付</th>
                          <th style={styles.listTh}>時間</th>
                          <th style={styles.listTh}>予定名</th>
                          <th style={styles.listTh}>重要度</th>
                          <th style={styles.listTh}>状態</th>
                        </tr>
                      </thead>
                      <tbody>
                        {scheduleListItems.map((item) => (
                          <tr key={`${item.dateKey}_${item.id}`} style={item.isPast ? styles.listRowPast : undefined}>
                            <td style={styles.listTd}>{item.dateKey} ({item.dayName})</td>
                            <td style={styles.listTd}>
                              {isScheduleChildTask(item)
                                ? '配下'
                                : isScheduleTask(item)
                                  ? '—'
                                  : `${item.time} - ${item.endTime}`}
                            </td>
                            <td style={styles.listTd}>
                              <div>{item.title}</div>
                              {isScheduleChildTask(item) ? (
                                <div style={styles.listParentLink}>
                                  {formatChildTaskParentLabel(findParentScheduleItem(scheduleMap, item))}
                                </div>
                              ) : null}
                            </td>
                            <td style={styles.listTd}>{item.priority === 'high' ? '重要' : item.priority === 'low' ? '低' : '通常'}</td>
                            <td style={styles.listTd}>{item.completed ? '完了' : '未完了'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            </main>
          )}

          {view === 'incompleteList' && (
            <main style={styles.main}>
              <section style={styles.listSection}>
                <h2 style={styles.listSectionTitle}>未完了一覧</h2>
                {incompleteLoading ? (
                  <p style={styles.listEmpty}>読み込み中...</p>
                ) : incompleteItems.length === 0 ? (
                  <p style={styles.listEmpty}>未完了の予定はありません。</p>
                ) : (
                  <div style={styles.listTableWrap}>
                    <table style={styles.listTable}>
                      <thead>
                        <tr>
                          <th style={styles.listTh}>日付</th>
                          <th style={styles.listTh}>時間</th>
                          <th style={styles.listTh}>予定名</th>
                          <th style={styles.listTh}>重要度</th>
                        </tr>
                      </thead>
                      <tbody>
                        {incompleteItems.map((item) => (
                          <tr key={`${item.dateKey}_${item.id}`} style={item.isPast ? styles.listRowPast : undefined}>
                            <td style={styles.listTd}>{item.dateKey} ({item.dayName})</td>
                            <td style={styles.listTd}>
                              {isScheduleChildTask(item)
                                ? '配下'
                                : isScheduleTask(item)
                                  ? '—'
                                  : `${item.time} - ${item.endTime}`}
                            </td>
                            <td style={styles.listTd}>
                              <div>{item.title}</div>
                              {item.parentLabel ? (
                                <div style={styles.listParentLink}>{item.parentLabel}</div>
                              ) : null}
                            </td>
                            <td style={styles.listTd}>{item.priority === 'high' ? '重要' : item.priority === 'low' ? '低' : '通常'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            </main>
          )}

          <button
            type="button"
            className="scroll-to-top-button"
            style={styles.scrollToTopButton}
            onClick={scrollToTop}
            aria-label="最上部に戻る"
            title="最上部に戻る"
          >
            <ArrowUp size={20} />
          </button>

          {relationDialog && (
            <div style={styles.modalOverlay} onClick={closeRelationDialog}>
              <div className="schedule-modal" style={{ ...styles.modal, maxWidth: '760px' }} onClick={(event) => event.stopPropagation()}>
                <div style={styles.modalHeader}>
                  <div style={styles.modalTitleWrap}>
                    <Link2 size={18} color="#ca8a04" />
                    <h3 style={styles.modalTitle}>先に終わらせる予定を選ぶ</h3>
                  </div>
                  <button type="button" style={styles.closeButton} onClick={closeRelationDialog}>閉じる</button>
                </div>

                <p style={{ margin: '0 0 12px', fontSize: '13px', color: '#475569', lineHeight: 1.5 }}>
                  この予定を完了する前に、先に終わらせる予定を1つ選びます。先が未完了の間は、この予定を完了にできません。
                </p>

                <div style={styles.relationTargetBox}>
                  <strong>{relationDialog.item.title}</strong>
                  <div style={styles.relationTargetMeta}>
                    {relationDialog.item.date} {formatScheduleTimeRange(relationDialog.item)}
                  </div>
                </div>

                {relationDialog.item.relatedPrev && (
                  <div style={styles.currentRelationBox}>
                    現在の指定: {relationDialog.item.relatedPrev.date} {relationDialog.item.relatedPrev.time} - {relationDialog.item.relatedPrev.endTime} {relationDialog.item.relatedPrev.title}
                  </div>
                )}

                {relationDialog.recommendedKey && (
                  <div style={{ marginBottom: '12px' }}>
                    <button
                      type="button"
                      style={{ ...styles.primaryButton, background: '#ca8a04', width: '100%' }}
                      onClick={applyRecommendedScheduleRelation}
                    >
                      おすすめ（同日の直前）を先に終わらせる予定にする
                    </button>
                  </div>
                )}

                {relationDialog.candidates.length === 0 ? (
                  <div style={styles.emptyState}>選べる予定がありません。</div>
                ) : (
                  <>
                    {(relationDialog.sameDayCandidates || []).length > 0 && (
                      <>
                        <div style={{ fontWeight: 700, marginBottom: '8px', color: '#92400e' }}>今日・この前</div>
                        <div style={styles.relationTableWrap}>
                          <table style={styles.relationTable}>
                            <thead>
                              <tr>
                                <th style={styles.relationTableHeadCell}>選択</th>
                                <th style={styles.relationTableHeadCell}>時間</th>
                                <th style={styles.relationTableHeadCell}>予定名</th>
                                <th style={styles.relationTableHeadCell}>状態</th>
                              </tr>
                            </thead>
                            <tbody>
                              {(relationDialog.sameDayCandidates || []).slice(0, 3).map((candidate) => {
                                const candidateKey = relationKeyFromItem(candidate)
                                const disabled = Boolean(candidate.relatedNext && !isSameScheduleRelation(candidate.relatedNext, toScheduleRelation(relationDialog.item)))
                                return (
                                  <tr key={candidateKey} style={disabled ? styles.disabledRelationRow : undefined}>
                                    <td style={styles.relationTableCell}>
                                      <input
                                        type="radio"
                                        name="schedule-relation"
                                        value={candidateKey}
                                        checked={relationDialog.selectedCandidateKey === candidateKey}
                                        disabled={disabled}
                                        onChange={() => setRelationDialog((current) => (current ? { ...current, selectedCandidateKey: candidateKey } : current))}
                                      />
                                    </td>
                                    <td style={styles.relationTableCell}>{candidate.time} - {candidate.endTime}</td>
                                    <td style={styles.relationTableCell}>{candidate.title}</td>
                                    <td style={styles.relationTableCell}>
                                      {disabled ? '後ろの予定が設定済み' : '未完了'}
                                    </td>
                                  </tr>
                                )
                              })}
                            </tbody>
                          </table>
                        </div>
                      </>
                    )}
                    {(relationDialog.otherDayCandidates || []).length > 0 && (
                      <>
                        <button
                          type="button"
                          style={{ ...styles.secondaryButton, marginTop: '12px', marginBottom: '8px' }}
                          onClick={() => setRelationDialog((current) => (current ? { ...current, showOtherDays: !current.showOtherDays } : current))}
                        >
                          {relationDialog.showOtherDays ? '別の日を選ぶ（閉じる）' : '別の日を選ぶ'}
                        </button>
                        {relationDialog.showOtherDays && (
                          <div style={styles.relationTableWrap}>
                            <table style={styles.relationTable}>
                              <thead>
                                <tr>
                                  <th style={styles.relationTableHeadCell}>選択</th>
                                  <th style={styles.relationTableHeadCell}>日付</th>
                                  <th style={styles.relationTableHeadCell}>時間</th>
                                  <th style={styles.relationTableHeadCell}>予定名</th>
                                  <th style={styles.relationTableHeadCell}>状態</th>
                                </tr>
                              </thead>
                              <tbody>
                                {(relationDialog.otherDayCandidates || []).map((candidate) => {
                                  const candidateKey = relationKeyFromItem(candidate)
                                  const disabled = Boolean(candidate.relatedNext && !isSameScheduleRelation(candidate.relatedNext, toScheduleRelation(relationDialog.item)))
                                  return (
                                    <tr key={candidateKey} style={disabled ? styles.disabledRelationRow : undefined}>
                                      <td style={styles.relationTableCell}>
                                        <input
                                          type="radio"
                                          name="schedule-relation"
                                          value={candidateKey}
                                          checked={relationDialog.selectedCandidateKey === candidateKey}
                                          disabled={disabled}
                                          onChange={() => setRelationDialog((current) => (current ? { ...current, selectedCandidateKey: candidateKey } : current))}
                                        />
                                      </td>
                                      <td style={styles.relationTableCell}>{candidate.date}</td>
                                      <td style={styles.relationTableCell}>{candidate.time} - {candidate.endTime}</td>
                                      <td style={styles.relationTableCell}>{candidate.title}</td>
                                      <td style={styles.relationTableCell}>
                                        {disabled ? '後ろの予定が設定済み' : '未完了'}
                                      </td>
                                    </tr>
                                  )
                                })}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </>
                    )}
                  </>
                )}

                <div style={styles.modalActionRow}>
                  {relationDialog.item.relatedPrev && (
                    <button type="button" style={styles.unlinkButton} onClick={clearScheduleRelation}>順番の指定をやめる</button>
                  )}
                  <button type="button" style={styles.secondaryButton} onClick={closeRelationDialog}>キャンセル</button>
                  <button
                    type="button"
                    style={styles.primaryButton}
                    onClick={() => void applyScheduleRelation()}
                    disabled={!relationDialog.selectedCandidateKey}
                  >
                    指定する
                  </button>
                </div>
              </div>
            </div>
          )}

          {moveCopyDialog && (
            <div style={styles.modalOverlay} onClick={closeMoveCopyDialog}>
              <div className="schedule-modal" style={{ ...styles.modal, maxWidth: '500px' }} onClick={(event) => event.stopPropagation()}>
                <div style={styles.modalHeader}>
                  <div style={styles.modalTitleWrap}>
                    <ClipboardList size={18} color="#2563eb" />
                    <h3 style={styles.modalTitle}>予定の複製 / 移動</h3>
                  </div>
                  <button type="button" style={styles.closeButton} onClick={closeMoveCopyDialog}>閉じる</button>
                </div>

                <div style={styles.relationTargetBox}>
                  <strong>{moveCopyDialog.item.title}</strong>
                  <div style={styles.relationTargetMeta}>
                    {moveCopyDialog.item.date} {isScheduleTask(moveCopyDialog.item) ? '（タスク）' : formatScheduleTimeRange(moveCopyDialog.item)}
                  </div>
                </div>

                {hasScheduleRelation(moveCopyDialog.item) ? (
                  <div style={{ ...styles.currentRelationBox, background: '#eff6ff', borderColor: '#bfdbfe', color: '#1e3a8a' }}>
                    <strong>関連付けについて</strong>
                    <div style={{ marginTop: '6px' }}>
                      複製先の予定には関連付けはコピーされません。
                    </div>
                    <div style={{ marginTop: '6px' }}>
                      移動時は関連付けを維持できます。移動先の日付（関連が同日の場合は時刻）と矛盾する場合のみ、関連付けが自動で解除されます。
                    </div>
                  </div>
                ) : (
                  <div style={{ ...styles.currentRelationBox, background: '#f8fafc', borderColor: '#e2e8f0', color: '#475569' }}>
                    複製先の予定には関連付けはコピーされません。
                  </div>
                )}

                {moveCopyDialog.duplicateConflicts?.length > 0 && (
                  <div style={{ ...styles.currentRelationBox, background: '#fff7ed', borderColor: '#fed7aa', color: '#9a4d00' }}>
                    <strong>重複する予定があります</strong>
                    <div style={{ marginTop: '8px' }}>
                      {moveCopyDialog.duplicateConflicts.map((conflict) => (
                        <div key={`${conflict.date}-${conflict.time}-${conflict.id}`}>
                          {conflict.date} {conflict.time} - {conflict.endTime}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <label style={styles.fieldLabel}>移動先の日付</label>
                <div style={styles.dateInputRow}>
                  <input
                    key={moveCopyDialog.dialogId}
                    type="date"
                    value={moveCopyDialog.targetDate}
                    onChange={(event) => setMoveCopyDialog((current) => current ? { ...current, targetDate: event.target.value, duplicateConflicts: [], pendingMode: null } : current)}
                    style={{ ...styles.modalInput, flex: 1 }}
                  />
                  <button
                    type="button"
                    style={styles.datePickerButton}
                    aria-label="カレンダーを開く"
                    title="カレンダーを開く"
                    onClick={() => moveCopyCalendarOpen ? setMoveCopyCalendarOpen(false) : openMoveCopyCalendar()}
                  >
                    <CalendarDays size={19} />
                  </button>
                </div>
                {moveCopyCalendarOpen && moveCopyCalendarMonth && (
                  <div style={styles.moveCopyCalendar}>
                    <div style={styles.moveCopyCalendarHeader}>
                      <button type="button" style={styles.calendarNavButton} aria-label="前の月" onClick={() => setMoveCopyCalendarMonth((current) => new Date(current.getFullYear(), current.getMonth() - 1, 1))}>
                        <ChevronLeft size={18} />
                      </button>
                      <strong>{formatMonthTitle(moveCopyCalendarMonth)}</strong>
                      <button type="button" style={styles.calendarNavButton} aria-label="次の月" onClick={() => setMoveCopyCalendarMonth((current) => new Date(current.getFullYear(), current.getMonth() + 1, 1))}>
                        <ChevronRight size={18} />
                      </button>
                    </div>
                    <div style={styles.moveCopyCalendarGrid}>
                      {dayNames.map((dayName) => <span key={dayName} style={styles.calendarDayName}>{dayName}</span>)}
                      {getMonthCalendarDays(moveCopyCalendarMonth).map((date, index) => date ? (
                        <button
                          key={formatDateKey(date)}
                          type="button"
                          style={{ ...styles.calendarDateButton, ...(moveCopyDialog.targetDate === formatDateKey(date) ? styles.calendarSelectedDateButton : {}) }}
                          onClick={() => selectMoveCopyDate(date)}
                        >
                          {date.getDate()}
                        </button>
                      ) : <span key={`blank-${index}`} />)}
                    </div>
                  </div>
                )}

                <div style={{ ...styles.modalActionRow, justifyContent: 'flex-end', marginTop: '16px' }}>
                  <button type="button" style={styles.secondaryButton} onClick={closeMoveCopyDialog}>キャンセル</button>
                  <button
                    type="button"
                    style={styles.primaryButton}
                    onClick={() => executeMoveOrCopy('copy')}
                    disabled={!moveCopyDialog.targetDate}
                  >
                    複製
                  </button>
                  <button
                    type="button"
                    style={{ ...styles.primaryButton, background: '#0f766e' }}
                    onClick={() => executeMoveOrCopy('move')}
                    disabled={!moveCopyDialog.targetDate}
                  >
                    移動
                  </button>
                  {moveCopyDialog.duplicateConflicts?.length > 0 && (
                    <button
                      type="button"
                      style={{ ...styles.primaryButton, background: '#ef4444' }}
                      onClick={() => {
                        const nextMode = moveCopyDialog.pendingMode || 'copy'
                        void proceedMoveOrCopy(nextMode, true)
                      }}
                    >
                      重複を承認して実行
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}

          {schedulePreview && (
            <div style={styles.modalOverlay} onClick={closeSchedulePreview}>
              <div className="schedule-modal schedule-preview-modal" style={{ ...styles.modal, ...styles.schedulePreviewModal }} onClick={(event) => event.stopPropagation()}>
                <div style={styles.modalHeader}>
                  <div style={styles.modalTitleWrap}>
                    <FileText size={22} color="#2563eb" />
                    <h3 style={styles.modalTitle}>予定の詳細</h3>
                  </div>
                  <button type="button" style={styles.closeButton} onClick={closeSchedulePreview}>閉じる</button>
                </div>
                <div style={styles.previewMeta}>
                  {formatDisplayDate(new Date(`${schedulePreview.date}T00:00:00`))}
                  {isScheduleChildTask(schedulePreview)
                    ? '　配下タスク'
                    : isScheduleTask(schedulePreview)
                      ? '　タスク'
                      : `　${schedulePreview.time || '09:00'} - ${schedulePreview.endTime || '10:00'}`}
                </div>
                <h2 style={styles.previewTitle}>{schedulePreview.title || '予定'}</h2>
                {isScheduleChildTask(schedulePreview) && (
                  <div style={styles.childTaskParentLabel}>
                    {formatChildTaskParentLabel(findParentScheduleItem(scheduleMap, schedulePreview))}
                  </div>
                )}
                <div style={styles.previewDetails}>{schedulePreview.details || '詳細メモはありません。'}</div>
                {!isScheduleTask(schedulePreview) && (schedulePreview.relatedPrev || schedulePreview.relatedNext) && (
                  <div style={styles.relationInfoGroup} aria-label="順番指定">
                    {schedulePreview.relatedPrev && (
                      <div
                        style={styles.relationInfoTextLink}
                        onClick={() => openRelatedSchedule(schedulePreview.relatedPrev)}
                      >
                        先に終わらせる: {formatScheduleRelationLine(schedulePreview.relatedPrev)}
                      </div>
                    )}
                    {schedulePreview.relatedNext && (
                      <div
                        style={styles.relationInfoTextLink}
                        onClick={() => openRelatedSchedule(schedulePreview.relatedNext)}
                      >
                        このあと完了待ち: {formatScheduleRelationLine(schedulePreview.relatedNext)}
                      </div>
                    )}
                  </div>
                )}
                <div style={styles.modalActionRow}>
                  <button type="button" style={styles.secondaryButton} onClick={closeSchedulePreview}>閉じる</button>
                  {!schedulePreview.completed && !(
                    isScheduleChildTask(schedulePreview)
                    && findParentScheduleItem(scheduleMap, schedulePreview)?.completed === true
                  ) && (
                    <button type="button" style={styles.primaryButton} onClick={editScheduleFromPreview}>
                      <PencilLine size={17} /> 編集
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}

          {helpOpen && (
            <div style={styles.modalOverlay} onClick={() => setHelpOpen(false)}>
              <div className="schedule-modal" style={styles.modal} onClick={(event) => event.stopPropagation()}>
                <div style={styles.modalHeader}>
                  <div style={styles.modalTitleWrap}>
                    <HelpCircle size={20} color="#2563eb" />
                    <h3 style={styles.modalTitle}>{helpContent[helpLang].title}</h3>
                  </div>
                  <button type="button" style={styles.closeButton} onClick={() => setHelpOpen(false)}>{helpContent[helpLang].close}</button>
                </div>

                <div style={styles.helpLangSwitch} role="group" aria-label="Language / 言語切替">
                  {Object.keys(helpContent).map((langKey) => (
                    <button
                      key={langKey}
                      type="button"
                      style={{ ...styles.helpLangButton, ...(helpLang === langKey ? styles.helpLangButtonActive : {}) }}
                      onClick={() => setHelpLang(langKey)}
                    >
                      {helpContent[langKey].langLabel}
                    </button>
                  ))}
                </div>

                <div style={styles.helpBody}>
                  <p style={styles.helpAppInfo}>{helpContent[helpLang].appInfo}</p>
                  <a
                    href={HELP_SITE_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={styles.helpLink}
                  >
                    {helpContent[helpLang].siteLabel}
                  </a>
                  <a href={`mailto:${HELP_MAIL_ADDRESS}`} style={styles.helpLink}>
                    {helpContent[helpLang].mailLabel}: {HELP_MAIL_ADDRESS}
                  </a>
                  <button
                    type="button"
                    style={{ ...styles.secondaryButton, width: '100%' }}
                    onClick={() => openUserGuidePdf(helpLang)}
                  >
                    {helpContent[helpLang].guideButton}
                  </button>
                  <p style={styles.helpFatigueDisclaimer}>{helpContent[helpLang].fatigueDisclaimer}</p>
                  <button
                    type="button"
                    style={{ ...styles.secondaryButton, width: '100%', borderColor: '#99f6e4', background: '#f0fdfa', color: '#0f766e' }}
                    onClick={() => openFatigueGuidePdf(helpLang)}
                  >
                    {helpContent[helpLang].fatigueGuideButton}
                  </button>
                  <button
                    type="button"
                    style={{ ...styles.primaryButton, width: '100%', background: 'linear-gradient(135deg, #0f766e 0%, #0e7490 100%)' }}
                    onClick={() => openProductPrPdf(helpLang)}
                  >
                    {helpContent[helpLang].prButton}
                  </button>
                  <a
                    href={SLEEP_SHORTCUT_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ ...styles.helpLink, color: '#0f766e', fontWeight: 700 }}
                  >
                    {helpContent[helpLang].shortcutButton}
                  </a>
                  <p style={styles.helpNote}>{helpContent[helpLang].note}</p>
                </div>

                <div style={{ ...styles.modalActionRow, justifyContent: 'flex-end' }}>
                  <button type="button" style={styles.secondaryButton} onClick={() => setHelpOpen(false)}>{helpContent[helpLang].close}</button>
                </div>
              </div>
            </div>
          )}

          {aggregationOpen && (
            <div style={styles.modalOverlay} onClick={closeAggregationModal}>
              <div className="schedule-modal" style={styles.modal} onClick={(event) => event.stopPropagation()}>
                <div style={styles.modalHeader}>
                  <div style={styles.modalTitleWrap}>
                    <ChartColumn size={20} color="#2563eb" />
                    <h3 style={styles.modalTitle}>スケジュール集計</h3>
                  </div>
                  <button type="button" style={styles.closeButton} onClick={closeAggregationModal}>閉じる</button>
                </div>

                <label style={styles.fieldLabel}>開始日</label>
                <input
                  type="date"
                  value={aggStartDate}
                  onChange={(event) => setAggStartDate(event.target.value)}
                  style={styles.modalInput}
                />

                <label style={styles.fieldLabel}>終了日</label>
                <input
                  type="date"
                  value={aggEndDate}
                  onChange={(event) => setAggEndDate(event.target.value)}
                  style={styles.modalInput}
                />

                <label style={styles.fieldLabel}>集計対象</label>
                <div style={styles.aggFilterRow}>
                  <label style={styles.aggFilterLabel}>
                    <input
                      type="radio"
                      name="agg-filter"
                      checked={aggFilter === 'all'}
                      onChange={() => setAggFilter('all')}
                    />
                    全て
                  </label>
                  <label style={styles.aggFilterLabel}>
                    <input
                      type="radio"
                      name="agg-filter"
                      checked={aggFilter === 'completed'}
                      onChange={() => setAggFilter('completed')}
                    />
                    完了のみ
                  </label>
                </div>

                {aggError && <p style={styles.helpNote}>{aggError}</p>}

                <div style={styles.modalActionRow}>
                  <button type="button" style={styles.primaryButton} onClick={runAggregation}>集計する</button>
                </div>

                {aggResult && (
                  <>
                    <div style={styles.aggResultMeta}>
                      対象期間: {aggResult.periodText}（{aggResult.filterLabel}）
                    </div>
                    <div style={styles.aggResultTableWrap}>
                      <table style={styles.aggResultTable}>
                        <thead>
                          <tr>
                            <th style={styles.aggResultHeaderCell}>予定名</th>
                            <th style={styles.aggResultHeaderCell}>件数</th>
                            <th style={styles.aggResultHeaderCell}>合計時間(分)</th>
                          </tr>
                        </thead>
                        <tbody>
                          {aggResult.rows.length ? aggResult.rows.map((row) => (
                            <tr key={row.title}>
                              <td style={styles.aggResultCell}>{row.title}</td>
                              <td style={{ ...styles.aggResultCell, textAlign: 'right' }}>{row.count}</td>
                              <td style={{ ...styles.aggResultCell, textAlign: 'right' }}>{row.totalMinutes}</td>
                            </tr>
                          )) : (
                            <tr><td style={styles.aggResultCell} colSpan={3}>該当する予定はありません</td></tr>
                          )}
                          {aggResult.rows.length > 0 && (
                            <tr>
                              <td style={{ ...styles.aggResultCell, fontWeight: 700, background: '#f1f5f9' }}>合計</td>
                              <td style={{ ...styles.aggResultCell, fontWeight: 700, background: '#f1f5f9', textAlign: 'right' }}>{aggResult.totalCount}</td>
                              <td style={{ ...styles.aggResultCell, fontWeight: 700, background: '#f1f5f9', textAlign: 'right' }}>{aggResult.totalMinutes}</td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                    <div style={{ ...styles.modalActionRow, justifyContent: 'flex-end' }}>
                      <button type="button" style={styles.secondaryButton} onClick={outputAggregationCsv}>CSVで出力</button>
                      <button type="button" style={styles.primaryButton} onClick={outputAggregationPdf}>PDFで出力</button>
                    </div>
                  </>
                )}
              </div>
            </div>
          )}

          {detailDraft && (
            <div style={styles.modalOverlay} onClick={closeDetail}>
              <div className="schedule-modal" style={styles.modal} onClick={(event) => event.stopPropagation()}>
                <div style={styles.modalHeader}>
                  <div style={styles.modalTitleWrap}>
                    <PencilLine size={18} color="#2563eb" />
                    <h3 style={styles.modalTitle}>
                      {detailDraft.parentId ? '配下タスクの詳細' : '予定の詳細'}
                    </h3>
                  </div>
                  <button type="button" style={styles.closeButton} onClick={closeDetail}>閉じる</button>
                </div>

                {detailDraft.parentId && (
                  <div style={styles.childTaskParentLabel}>
                    {formatChildTaskParentLabel(
                      (scheduleMap[detailDraft.parentDate || detailDraft.date] || [])
                        .find((entry) => entry.id === detailDraft.parentId && !isScheduleTask(entry))
                      || null,
                    )}
                  </div>
                )}

                <label style={styles.fieldLabel}>タイトル（必須）</label>
                {commonTitles.length > 0 && (
                  <select
                    style={{ ...styles.modalInput, marginBottom: '8px' }}
                    value=""
                    onChange={(e) => {
                      const selectedVal = e.target.value
                      if (selectedVal) {
                        setDetailDraft((prev) => (prev ? { ...prev, title: selectedVal } : null))
                      }
                    }}
                    aria-label="定例タイトルから選択"
                  >
                    <option value="">定例タイトルから選択…</option>
                    {commonTitles.map((titleOption) => (
                      <option key={titleOption} value={titleOption}>
                        {titleOption}
                      </option>
                    ))}
                  </select>
                )}
                <input
                  type="text"
                  value={detailDraft.title}
                  onChange={(e) => {
                    const val = e.target.value
                    setDetailDraft((prev) => (prev ? { ...prev, title: val } : null))
                  }}
                  style={styles.modalInput}
                  placeholder="タイトルを入力してください"
                />

                <label style={styles.commonTitleCheckboxRow}>
                  <input
                    type="checkbox"
                    checked={saveAsCommonTitle}
                    onChange={(e) => setSaveAsCommonTitle(e.target.checked)}
                    disabled={!detailDraft.title.trim()}
                  />
                  この予定名を定例タイトルとして保存する（{commonTitles.length}/{MAX_COMMON_TITLES}件）
                </label>

                {commonTitles.length > 0 && (
                  <div style={styles.commonTitleChipRow}>
                    {(commonTitlesExpanded ? commonTitles : commonTitles.slice(0, 1)).map((titleOption) => (
                      <span key={titleOption} style={styles.commonTitleChip}>
                        <button
                          type="button"
                          style={styles.commonTitleChipLabel}
                          onClick={() => setDetailDraft({ ...detailDraft, title: titleOption })}
                        >
                          {titleOption}
                        </button>
                        <button
                          type="button"
                          style={styles.commonTitleChipRemove}
                          aria-label={`定例タイトル「${titleOption}」を削除`}
                          onClick={() => removeCommonTitle(titleOption)}
                        >
                          <X size={11} />
                        </button>
                      </span>
                    ))}
                    {commonTitles.length > 1 && (
                      <button
                        type="button"
                        style={styles.commonTitleToggleButton}
                        aria-label={commonTitlesExpanded ? '定例タイトルを折りたたむ' : '定例タイトルをすべて表示'}
                        onClick={() => setCommonTitlesExpanded((prev) => !prev)}
                      >
                        <ChevronDown size={14} style={{ transform: commonTitlesExpanded ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }} />
                      </button>
                    )}
                  </div>
                )}

                <label style={styles.fieldLabel}>重要度</label>
                <select
                  value={detailDraft.priority}
                  onChange={(e) => setDetailDraft({ ...detailDraft, priority: e.target.value })}
                  style={styles.modalInput}
                >
                  <option value="low">低</option>
                  <option value="normal">通常</option>
                  <option value="high">重要</option>
                </select>

                {!detailDraft.parentId && (
                <label style={styles.commonTitleCheckboxRow}>
                  <input
                    type="checkbox"
                    checked={detailDraft.isTask === true}
                    disabled={
                      !detailDraft.isTask
                      && scheduleItemHasOrderRelation(scheduleMap, getLatestScheduleItem(detailDraft) || detailDraft)
                    }
                    onChange={async (e) => {
                      const nextIsTask = e.target.checked
                      if (nextIsTask) {
                        const base = getLatestScheduleItem(detailDraft) || detailDraft
                        if (scheduleItemHasOrderRelation(scheduleMap, base)) {
                          notifyScheduleAction(TASK_CONVERT_REQUIRES_UNLINK_MSG)
                          return
                        }
                        if (!isScheduleTask(base)) {
                          const childTasks = findChildTasksForParent(scheduleMap, base)
                          if (childTasks.length > 0) {
                            const confirmed = await askScheduleAppConfirm(
                              TASK_CONVERT_DELETES_CHILDREN_MSG(childTasks.length),
                              { title: 'タスクへの変更確認', confirmLabel: '変更する' },
                            )
                            if (!confirmed) return
                          }
                        }
                        setDetailDraft((prev) => (prev ? {
                          ...prev,
                          isTask: true,
                          parentId: null,
                          parentDate: null,
                        } : null))
                        return
                      }
                      setDetailDraft((prev) => (prev ? {
                        ...prev,
                        isTask: false,
                        time: prev.time || '09:00',
                        endTime: prev.endTime || '10:00',
                        parentId: null,
                        parentDate: null,
                      } : null))
                    }}
                  />
                  タスク（時刻なし・通知なし・関連付けなし）
                </label>
                )}
                {detailDraft.parentId && (
                  <p style={{ margin: '0 0 12px', fontSize: '12px', color: '#64748b', lineHeight: 1.5 }}>
                    スケジュール配下のタスクです。完了・削除・編集のみ行えます。
                  </p>
                )}
                {!detailDraft.parentId && !detailDraft.isTask && scheduleItemHasOrderRelation(scheduleMap, getLatestScheduleItem(detailDraft) || detailDraft) && (
                  <p style={{ margin: '0 0 12px', fontSize: '12px', color: '#b45309', lineHeight: 1.5 }}>
                    順番の指定があるため、タスクに変更できません。カードのメニューから順番の指定を解除してください。
                  </p>
                )}

                {!detailDraft.isTask && !detailDraft.parentId && (
                  <>
                <label style={styles.fieldLabel}>開始時間</label>
                <div style={styles.timeFieldRow}>
                  <input
                    type="time"
                    value={detailDraft.time || ''}
                    onChange={(e) => setDetailDraft({ ...detailDraft, time: e.target.value })}
                    style={{ ...styles.modalInput, ...styles.timeFieldInput }}
                  />
                  <button
                    type="button"
                    style={styles.currentTimeButton}
                    onClick={() => setDetailDraft({ ...detailDraft, time: formatCurrentTime() })}
                  >
                    現在時刻設定
                  </button>
                </div>

                <label style={styles.fieldLabel}>終了時間</label>
                <div style={styles.timeFieldRow}>
                  <input
                    type="time"
                    value={detailDraft.endTime || ''}
                    onChange={(e) => setDetailDraft({ ...detailDraft, endTime: e.target.value })}
                    style={{ ...styles.modalInput, ...styles.timeFieldInput }}
                  />
                  <button
                    type="button"
                    style={styles.currentTimeButton}
                    onClick={() => setDetailDraft({ ...detailDraft, endTime: formatCurrentTime() })}
                  >
                    現在時刻設定
                  </button>
                </div>
                {detailDraft.time && detailDraft.endTime && !isValidTimeRange(detailDraft.time, detailDraft.endTime) && (
                  <p style={{ margin: '0 0 12px', fontSize: '13px', color: '#b91c1c', lineHeight: 1.5 }}>
                    {INVALID_TIME_RANGE_MSG}
                  </p>
                )}
                  </>
                )}

                <label style={styles.fieldLabel}>詳細メモ</label>
                <textarea
                  className="schedule-details-input"
                  value={detailDraft.details}
                  onChange={(e) => setDetailDraft({ ...detailDraft, details: e.target.value })}
                  rows={6}
                  style={styles.textarea}
                  placeholder="予定の詳細を入力してください。複数行で記録できます。"
                />

                <div style={styles.modalActionRow}>
                  <button type="button" style={styles.secondaryButton} onClick={closeDetail} disabled={savingDraft}>キャンセル</button>
                  <button
                    type="button"
                    style={{ ...styles.primaryButton, opacity: savingDraft ? 0.7 : 1, cursor: savingDraft ? 'wait' : 'pointer' }}
                    onClick={saveDetailDraft}
                    disabled={savingDraft}
                  >
                    {savingDraft ? '保存中…' : '保存'}
                  </button>
                </div>
              </div>
            </div>
          )}

          {relatedChainModal.open && (
            <div style={styles.modalOverlay} onClick={() => setRelatedChainModal({ open: false, loading: false, items: [] })}>
              <div className="schedule-modal" style={{ ...styles.modal, maxWidth: '600px' }} onClick={(event) => event.stopPropagation()}>
                <div style={styles.modalHeader}>
                  <div style={styles.modalTitleWrap}>
                    <Link2 size={18} color="#2563eb" />
                    <h3 style={styles.modalTitle}>関連スケジュール一覧</h3>
                  </div>
                  <button type="button" style={styles.closeButton} onClick={() => setRelatedChainModal({ open: false, loading: false, items: [] })}>閉じる</button>
                </div>

                {relatedChainModal.loading ? (
                  <div style={styles.loadingState}>読み込み中...</div>
                ) : relatedChainModal.items.length === 0 ? (
                  <div style={styles.emptyState}>関連するスケジュールはありません。</div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginTop: '14px', maxHeight: '60vh', overflowY: 'auto', paddingRight: '4px' }}>
                    {relatedChainModal.items.map((item) => {
                      const timeDisplay = `${item.date}　${item.time || '09:00'} - ${item.endTime || '10:00'}`
                      return (
                        <div
                          key={`${item.date}_${item.id}`}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            padding: '12px 14px',
                            borderRadius: '12px',
                            border: '1px solid #dfeaf7',
                            background: item.completed ? '#e5e7eb' : '#ffffff',
                            gap: '12px',
                          }}
                        >
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '3px', minWidth: 0, flex: 1 }}>
                            <div style={{ fontSize: '13px', fontWeight: 700, color: item.completed ? '#64748b' : '#2563eb' }}>
                              {timeDisplay}
                            </div>
                            <div style={{ fontSize: '15px', fontWeight: 700, color: item.completed ? '#6b7280' : '#0f172a', textDecoration: item.completed ? 'line-through' : 'none', wordBreak: 'break-word' }}>
                              {item.title || '予定'}
                            </div>
                          </div>
                          <button
                            type="button"
                            className="schedule-complete-btn"
                            style={{
                              ...styles.completeButton,
                              ...(item.completed ? styles.completedButton : {}),
                              flexShrink: 0,
                            }}
                            onClick={() => toggleRelatedItemCompleted(item)}
                            title={item.completed ? '完了を取り消す' : '完了にする'}
                            aria-label={item.completed ? '完了を取り消す' : '予定を完了にする'}
                          >
                            <Check size={16} />
                          </button>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            </div>
          )}

          {subscriptionCancelModalOpen && (
            <div
              style={styles.modalOverlayFront}
              role="dialog"
              aria-modal="true"
              aria-labelledby="subscription-cancel-title"
              onClick={() => setSubscriptionCancelModalOpen(false)}
            >
              <div
                className="schedule-modal"
                style={{ ...styles.modal, maxWidth: '460px' }}
                onClick={(event) => event.stopPropagation()}
              >
                <div style={styles.modalHeader}>
                  <div style={styles.modalTitleWrap}>
                    <Mail size={18} color="#2563eb" />
                    <h3 id="subscription-cancel-title" style={styles.modalTitle}>サブスク解約の申請</h3>
                  </div>
                  <button
                    type="button"
                    style={styles.closeButton}
                    onClick={() => setSubscriptionCancelModalOpen(false)}
                  >
                    閉じる
                  </button>
                </div>

                <div
                  style={{
                    background: '#eff6ff',
                    border: '1px solid #bfdbfe',
                    borderRadius: '10px',
                    padding: '12px',
                    color: '#1e3a8a',
                    fontSize: '13px',
                    marginTop: '12px',
                    marginBottom: '12px',
                    lineHeight: 1.55,
                  }}
                >
                  <strong>この操作について</strong>
                  <p style={{ margin: '6px 0 0' }}>
                    解約はアプリ内では完了しません。お問い合わせフォームから「サブスク削除申請」を送信いただき、受付後に運用で手続きします。
                  </p>
                </div>

                <div
                  style={{
                    background: '#fffbeb',
                    border: '1px solid #fcd34d',
                    borderRadius: '10px',
                    padding: '12px',
                    color: '#78350f',
                    fontSize: '13px',
                    marginBottom: '12px',
                    lineHeight: 1.55,
                  }}
                >
                  <strong>ご注意ください</strong>
                  <ul style={{ margin: '8px 0 0', paddingLeft: '1.2em' }}>
                    <li>すぐに解約・課金停止になるわけではありません。反映までお時間をいただく場合があります。</li>
                    <li>手続き完了までは、いままでどおりご利用いただけます。</li>
                    <li>アカウント削除とは別の手続きです。データ消去をご希望の場合は「アカウント削除」をご利用ください。</li>
                    <li>次の画面では、ログイン中のメールアドレスが初期表示されます。内容を確認のうえ送信してください。</li>
                  </ul>
                </div>

                {session?.email && (
                  <p style={{ margin: '0 0 16px', fontSize: '13px', color: '#475569', lineHeight: 1.5 }}>
                    申請に使うメール: <strong style={{ color: '#0f172a' }}>{session.email}</strong>
                  </p>
                )}

                <div style={{ ...styles.modalActionRow, justifyContent: 'flex-end', gap: '10px' }}>
                  <button
                    type="button"
                    style={styles.secondaryButton}
                    onClick={() => setSubscriptionCancelModalOpen(false)}
                  >
                    もどる
                  </button>
                  <button
                    type="button"
                    style={styles.primaryButton}
                    onClick={proceedSubscriptionCancelContact}
                    disabled={!session?.email}
                  >
                    問い合わせフォームを開く
                  </button>
                </div>
              </div>
            </div>
          )}

          {deleteAccountModalOpen && (
            <div style={styles.modalOverlay} onClick={() => !deletingAccount && setDeleteAccountModalOpen(false)}>
              <div className="schedule-modal" style={styles.modal} onClick={(event) => event.stopPropagation()}>
                <div style={styles.modalHeader}>
                  <div style={styles.modalTitleWrap}>
                    <UserX size={18} color="#dc2626" />
                    <h3 style={{ ...styles.modalTitle, color: '#dc2626' }}>アカウントの削除</h3>
                  </div>
                  <button type="button" style={styles.closeButton} onClick={() => setDeleteAccountModalOpen(false)} disabled={deletingAccount}>閉じる</button>
                </div>

                <div style={{ background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: '10px', padding: '12px', color: '#991b1b', fontSize: '13px', marginTop: '12px', marginBottom: '14px', lineHeight: 1.5 }}>
                  <strong>⚠️ 注意・確認事項</strong>
                  <p style={{ margin: '4px 0 0' }}>
                    アカウントを削除すると全データ（スケジュール、睡眠記録、設定など）が完全に消去され、復旧することはできません。
                  </p>
                </div>

                {deleteAccountError && (
                  <div style={{ color: '#dc2626', fontSize: '13px', fontWeight: 700, marginBottom: '10px' }}>
                    {deleteAccountError}
                  </div>
                )}

                <label style={styles.fieldLabel}>本人確認のため現在のパスワードを入力してください</label>
                <input
                  type="password"
                  value={deletePassword}
                  onChange={(e) => setDeletePassword(e.target.value)}
                  placeholder="パスワードを入力"
                  style={styles.modalInput}
                  disabled={deletingAccount}
                />

                <div style={{ marginTop: '8px', marginBottom: '16px', textAlign: 'right' }}>
                  <button
                    type="button"
                    style={{ ...styles.textButton, fontSize: '12px', padding: 0 }}
                    onClick={handleSendResetEmailInDeleteModal}
                    disabled={deletingAccount}
                  >
                    パスワードをお忘れの方はこちら（再設定メール送信）
                  </button>
                </div>

                <div style={styles.modalActionRow}>
                  <button type="button" style={styles.secondaryButton} onClick={() => setDeleteAccountModalOpen(false)} disabled={deletingAccount}>キャンセル</button>
                  <button
                    type="button"
                    style={{ ...styles.primaryButton, background: '#dc2626', borderColor: '#b91c1c', opacity: deletingAccount ? 0.7 : 1, cursor: deletingAccount ? 'wait' : 'pointer' }}
                    onClick={handleAccountDelete}
                    disabled={deletingAccount}
                  >
                    {deletingAccount ? '削除中…' : 'アカウントを削除する'}
                  </button>
                </div>
              </div>
            </div>
          )}

          {scheduleAppConfirm && (
            <div
              style={styles.modalOverlayFront}
              role="alertdialog"
              aria-modal="true"
              aria-labelledby="schedule-app-confirm-title"
            >
              <div className="schedule-modal" style={{ ...styles.modal, maxWidth: '420px' }} onClick={(event) => event.stopPropagation()}>
                <h3 id="schedule-app-confirm-title" style={{ ...styles.modalTitle, margin: '0 0 12px' }}>{scheduleAppConfirm.title}</h3>
                <p style={{ margin: '0 0 18px', fontSize: '15px', lineHeight: 1.55, color: '#334155', whiteSpace: 'pre-line' }}>
                  {scheduleAppConfirm.message}
                </p>
                <div style={{ ...styles.modalActionRow, justifyContent: 'flex-end', gap: '10px' }}>
                  {!scheduleAppConfirm.hideCancel && (
                    <button type="button" style={styles.secondaryButton} onClick={() => finishScheduleAppConfirm(false)}>キャンセル</button>
                  )}
                  <button type="button" style={styles.primaryButton} onClick={() => finishScheduleAppConfirm(true)}>{scheduleAppConfirm.confirmLabel}</button>
                </div>
              </div>
            </div>
          )}

          {scheduleRelationTimeConfirm && (
            <div
              style={styles.modalOverlayFront}
              role="alertdialog"
              aria-modal="true"
              aria-labelledby="schedule-relation-time-confirm-title"
            >
              <div className="schedule-modal" style={{ ...styles.modal, maxWidth: '420px' }} onClick={(event) => event.stopPropagation()}>
                <h3 id="schedule-relation-time-confirm-title" style={{ ...styles.modalTitle, margin: '0 0 12px' }}>
                  {scheduleRelationTimeConfirm.allowProceed ? '日時変更の確認' : '日時を変更できません'}
                </h3>
                <p style={{ margin: '0 0 18px', fontSize: '15px', lineHeight: 1.55, color: '#334155', whiteSpace: 'pre-line' }}>
                  {scheduleRelationTimeConfirm.message}
                </p>
                <div style={{ ...styles.modalActionRow, justifyContent: 'flex-end', gap: '10px' }}>
                  {scheduleRelationTimeConfirm.allowProceed ? (
                    <>
                      <button type="button" style={styles.secondaryButton} onClick={() => finishScheduleRelationTimeConfirm(false)}>キャンセル</button>
                      <button type="button" style={styles.primaryButton} onClick={() => finishScheduleRelationTimeConfirm(true)}>変更する</button>
                    </>
                  ) : (
                    <button type="button" style={styles.primaryButton} onClick={() => finishScheduleRelationTimeConfirm(false)}>閉じる</button>
                  )}
                </div>
              </div>
            </div>
          )}

          {scheduleActionNotice && (
            <div
              style={styles.modalOverlayFront}
              role="alertdialog"
              aria-modal="true"
              aria-labelledby="schedule-action-notice-title"
              onClick={dismissScheduleActionNotice}
            >
              <div className="schedule-modal" style={{ ...styles.modal, maxWidth: '420px' }} onClick={(event) => event.stopPropagation()}>
                <h3 id="schedule-action-notice-title" style={{ ...styles.modalTitle, margin: '0 0 12px' }}>お知らせ</h3>
                <p style={{ margin: '0 0 18px', fontSize: '15px', lineHeight: 1.55, color: '#334155' }}>{scheduleActionNotice}</p>
                <div style={{ ...styles.modalActionRow, justifyContent: 'flex-end' }}>
                  <button type="button" style={styles.primaryButton} onClick={dismissScheduleActionNotice}>OK</button>
                </div>
              </div>
            </div>
          )}

          {demoWelcomeOpen && (
            <div
              style={styles.modalOverlayFront}
              role="dialog"
              aria-modal="true"
              aria-labelledby="demo-welcome-title"
            >
              <div className="schedule-modal" style={{ ...styles.modal, maxWidth: '440px' }} onClick={(event) => event.stopPropagation()}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '12px' }}>
                  <strong style={styles.demoModeBadge}>DEMO</strong>
                  <h3 id="demo-welcome-title" style={{ ...styles.modalTitle, margin: 0 }}>デモ版のご案内</h3>
                </div>
                <p style={{ margin: '0 0 10px', fontSize: '15px', lineHeight: 1.55, color: '#334155' }}>
                  この画面はデモ用です。機能を一通りお試しいただけます。
                </p>
                <ul style={{ margin: '0 0 18px', paddingLeft: '1.2em', fontSize: '14px', lineHeight: 1.6, color: '#475569' }}>
                  <li>スケジュール登録は1日{DEMO_MAX_PER_DAY}件・全体{DEMO_MAX_TOTAL}件まで</li>
                  <li>ログアウトとアカウント削除は利用できません</li>
                </ul>
                <div style={{ ...styles.modalActionRow, justifyContent: 'flex-end' }}>
                  <button type="button" style={styles.primaryButton} onClick={dismissDemoWelcome}>はじめる</button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </>
  )
}

const styles = {
  authContainer: {
    minHeight: '100vh',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'linear-gradient(135deg, #eff6ff 0%, #f8fafc 100%)',
    padding: '20px',
  },
  authBox: {
    width: '100%',
    maxWidth: '420px',
    background: '#fff',
    borderRadius: '20px',
    padding: '28px 24px',
    boxShadow: '0 20px 45px rgba(15, 23, 42, 0.12)',
    border: '1px solid #e5eefb',
  },
  brandRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '10px',
    marginBottom: '8px',
  },
  brandTitle: {
    margin: 0,
    fontSize: '26px',
    color: '#1f2937',
  },
  authCaption: {
    margin: '0 0 18px',
    textAlign: 'center',
    color: '#64748b',
    fontSize: '14px',
  },
  authError: {
    margin: '0 0 12px',
    color: '#dc2626',
    fontSize: '13px',
    textAlign: 'center',
  },
  authForm: {
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
  },
  input: {
    width: '100%',
    padding: '12px 14px',
    borderRadius: '10px',
    border: '1px solid #d9e2f2',
    background: '#f8fbff',
    fontSize: '14px',
  },
  primaryButton: {
    background: 'linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%)',
    border: 'none',
    borderRadius: '10px',
    color: '#fff',
    padding: '14px 18px',
    fontSize: '16px',
    fontWeight: 700,
    cursor: 'pointer',
    minHeight: '48px',
  },
  secondaryButton: {
    background: '#eef2ff',
    border: '1px solid #c7d2fe',
    borderRadius: '10px',
    color: '#1e3a8a',
    padding: '13px 18px',
    fontSize: '15px',
    fontWeight: 600,
    cursor: 'pointer',
    minHeight: '48px',
  },
  textButton: {
    marginTop: '16px',
    width: '100%',
    border: 'none',
    background: 'transparent',
    color: '#2563eb',
    fontSize: '13px',
    cursor: 'pointer',
  },
  appShell: {
    maxWidth: '960px',
    margin: '0 auto',
    padding: '12px 10px 20px',
  },
  demoModeBanner: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: '10px',
    marginBottom: '10px',
    padding: '10px 12px',
    borderRadius: '12px',
    border: '1px solid #fcd34d',
    background: 'linear-gradient(135deg, #fffbeb 0%, #fef3c7 100%)',
    color: '#78350f',
    fontSize: '13px',
    lineHeight: 1.5,
  },
  demoModeBadge: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    padding: '2px 8px',
    borderRadius: '6px',
    background: '#f59e0b',
    color: '#fff',
    fontSize: '11px',
    fontWeight: 700,
    letterSpacing: '0.04em',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '16px',
    marginBottom: '10px',
    paddingBottom: '8px',
    borderBottom: '1px solid #dfeaf7',
  },
  menuWrapper: {
    position: 'relative',
  },
  menuButton: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '56px',
    height: '56px',
    border: '1px solid #d9e2f2',
    background: '#ffffff',
    color: '#1d4ed8',
    borderRadius: '12px',
    cursor: 'pointer',
    flexShrink: 0,
  },
  menuDropdown: {
    position: 'absolute',
    top: 'calc(100% + 8px)',
    left: '0',
    minWidth: '220px',
    background: '#ffffff',
    border: '1px solid #dbeafe',
    borderRadius: '12px',
    boxShadow: '0 14px 32px rgba(15, 23, 42, 0.18)',
    padding: '6px',
    zIndex: 30,
    display: 'flex',
    flexDirection: 'column',
  },
  menuItem: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    width: '100%',
    border: 'none',
    background: 'transparent',
    color: '#1f2937',
    padding: '12px 14px',
    borderRadius: '8px',
    fontSize: '15px',
    fontWeight: 600,
    cursor: 'pointer',
    textAlign: 'left',
    minHeight: '44px',
  },
  menuItemDanger: {
    color: '#dc2626',
  },
  settingsSubmenu: {
    margin: '0 6px 4px',
    padding: '4px',
    borderLeft: '2px solid #bfdbfe',
    background: '#f8fbff',
  },
  settingsSelectLabel: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '8px',
    padding: '10px 10px 10px 14px',
    color: '#1f2937',
    fontSize: '14px',
    fontWeight: 600,
  },
  settingsSelect: {
    minWidth: '76px',
    border: '1px solid #bfdbfe',
    borderRadius: '6px',
    background: '#ffffff',
    color: '#1e3a8a',
    padding: '6px 8px',
    fontSize: '14px',
    fontWeight: 600,
  },
  menuDivider: {
    height: '1px',
    background: '#e5eefb',
    margin: '4px 6px',
  },
  headerTitleBox: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    minWidth: 0,
  },
  title: {
    margin: 0,
    fontSize: '22px',
    color: '#0f172a',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  userArea: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    flexWrap: 'wrap',
    justifyContent: 'flex-end',
  },
  userEmail: {
    color: '#475569',
    fontSize: '13px',
  },
  notificationButton: {
    position: 'relative',
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    border: '1px solid #d9e2f2',
    background: '#ffffff',
    color: '#334155',
    padding: '8px 12px',
    borderRadius: '10px',
    cursor: 'pointer',
  },
  notificationButtonOn: {
    borderColor: '#93c5fd',
    background: '#eff6ff',
    color: '#1d4ed8',
  },
  notificationButtonOff: {
    background: '#ffffff',
  },
  notificationButtonBusy: {
    opacity: 0.7,
    cursor: 'wait',
  },
  notificationCountBadge: {
    minWidth: '18px',
    height: '18px',
    padding: '0 5px',
    borderRadius: '999px',
    background: '#dc2626',
    color: '#fff',
    fontSize: '11px',
    fontWeight: 700,
    lineHeight: '18px',
    textAlign: 'center',
  },
  notificationControls: {
    position: 'relative',
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    flexWrap: 'wrap',
  },
  notificationHelpButton: {
    border: '1px solid #d9e2f2',
    background: '#ffffff',
    color: '#64748b',
    borderRadius: '999px',
    padding: '6px 10px',
    fontSize: '12px',
    cursor: 'pointer',
  },
  notificationHelpPanel: {
    position: 'fixed',
    top: '96px',
    right: '16px',
    width: 'min(280px, calc(100vw - 32px))',
    maxHeight: 'calc(100vh - 112px)',
    overflowY: 'auto',
    background: '#ffffff',
    border: '1px solid #dbeafe',
    borderRadius: '12px',
    boxShadow: '0 14px 32px rgba(15, 23, 42, 0.16)',
    padding: '12px',
    zIndex: 20,
  },
  notificationHelpHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '8px',
    marginBottom: '8px',
  },
  notificationHelpTitle: {
    fontSize: '13px',
    color: '#0f172a',
  },
  notificationCountLabel: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: '8px',
    padding: '4px 8px',
    borderRadius: '999px',
    background: '#eff6ff',
    color: '#1d4ed8',
    fontSize: '12px',
    fontWeight: 700,
  },
  notificationHelpClose: {
    width: '24px',
    height: '24px',
    borderRadius: '999px',
    border: '1px solid #d9e2f2',
    background: '#f8fbff',
    color: '#334155',
    cursor: 'pointer',
    lineHeight: 1,
  },
  notificationHelpList: {
    margin: '0',
    paddingLeft: '18px',
    color: '#334155',
    fontSize: '12px',
    lineHeight: 1.6,
  },
  notificationHelpItem: {
    marginBottom: '4px',
  },
  notificationHelpNote: {
    marginTop: '8px',
    padding: '8px 10px',
    borderRadius: '8px',
    background: '#fef3c7',
    border: '1px solid #fde68a',
    color: '#92400e',
    fontSize: '12px',
    lineHeight: 1.5,
  },
  notificationNotice: {
    color: '#b45309',
    fontSize: '12px',
    whiteSpace: 'nowrap',
  },
  main: {
    display: 'flex',
    flexDirection: 'column',
    gap: '10px',
  },
  mainWithFixedWeek: {
    height: 'calc(100dvh - 132px)',
    minHeight: 0,
    overflowY: 'auto',
    overscrollBehavior: 'contain',
  },
  healthLifeCountSection: {
    marginTop: '8px',
    border: '1px solid #dbeafe',
    borderRadius: '14px',
    background: '#ffffff',
    overflow: 'hidden',
  },
  healthLifeCountNav: {
    display: 'flex',
    alignItems: 'center',
    padding: '8px 10px',
    background: '#f0fdfa',
    borderBottom: '1px solid #ccfbf1',
  },
  healthLifeCountCollapseButton: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '6px',
    border: 0,
    background: 'transparent',
    color: '#0f766e',
    fontWeight: 700,
    fontSize: '13px',
    cursor: 'pointer',
    padding: 0,
  },
  healthLifeDisclaimer: {
    marginTop: '10px',
    fontSize: '11px',
    lineHeight: 1.5,
    color: '#64748b',
  },
  homeCopyright: {
    marginTop: '16px',
    paddingTop: '12px',
    borderTop: '1px solid #e2e8f0',
    textAlign: 'center',
    fontSize: '11px',
    color: '#94a3b8',
  },
  footerStepsLine: {
    marginTop: '8px',
    fontSize: '12px',
    color: '#334155',
    fontWeight: 600,
  },
  footerStepsUnlinked: {
    color: '#64748b',
    fontWeight: 500,
  },
  footerStepsEditor: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: '6px',
    marginTop: '8px',
  },
  footerStepsInput: {
    width: '88px',
    padding: '6px 8px',
    borderRadius: '8px',
    border: '1px solid #cbd5e1',
    fontSize: '13px',
  },
  footerStepsSaveButton: {
    padding: '6px 10px',
    borderRadius: '8px',
    border: 'none',
    background: '#0f766e',
    color: '#fff',
    fontSize: '12px',
    fontWeight: 700,
    cursor: 'pointer',
  },
  footerStepsCheckButton: {
    padding: '6px 10px',
    borderRadius: '8px',
    border: '1px solid #0f766e',
    background: '#ecfdf5',
    color: '#0f766e',
    fontSize: '12px',
    fontWeight: 700,
    cursor: 'pointer',
  },
  footerStepsImportButton: {
    padding: '6px 10px',
    borderRadius: '8px',
    border: '1px solid #94a3b8',
    background: '#fff',
    color: '#334155',
    fontSize: '12px',
    fontWeight: 600,
    cursor: 'pointer',
  },
  footerStepsClearButton: {
    padding: '6px 8px',
    border: 'none',
    background: 'transparent',
    color: '#64748b',
    fontSize: '11px',
    textDecoration: 'underline',
    cursor: 'pointer',
  },
  footerHealthStrip: {
    width: '100%',
    background: '#ffffff',
    borderLeft: '4px solid #14b8a6',
    padding: '10px 12px',
  },
  footerHealthTitle: {
    fontSize: '11px',
    fontWeight: 800,
    letterSpacing: '0.04em',
    color: '#0f766e',
    marginBottom: '6px',
  },
  footerFatigueLine1: {
    fontSize: '13px',
    fontWeight: 700,
    color: '#0f172a',
    lineHeight: 1.45,
  },
  footerFatigueLine2: {
    fontSize: '11px',
    color: '#64748b',
    marginTop: '2px',
    lineHeight: 1.45,
  },
  footerMetricBars: {
    display: 'grid',
    gap: '4px',
    marginTop: '8px',
  },
  footerMetricBarRow: {
    display: 'grid',
    gridTemplateColumns: '36px 1fr',
    alignItems: 'center',
    gap: '8px',
  },
  footerMetricBarLabel: {
    fontSize: '10px',
    color: '#64748b',
  },
  footerMetricBarTrack: {
    height: '6px',
    borderRadius: '999px',
    background: '#e2e8f0',
    overflow: 'hidden',
  },
  footerMetricBarFill: {
    height: '100%',
    borderRadius: '999px',
  },
  footerSleepAverage: {
    marginTop: '8px',
    fontSize: '12px',
    color: '#134e4a',
    fontWeight: 600,
  },
  footerSleepEmoji: {
    marginLeft: '4px',
  },
  footerStepsPlaceholder: {
    marginTop: '6px',
    fontSize: '10px',
    color: '#94a3b8',
  },
  footerRonMessage: {
    display: 'flex',
    gap: '10px',
    alignItems: 'flex-start',
    width: '100%',
    borderLeft: '4px solid #14b8a6',
    borderRadius: '12px',
    padding: '10px 12px',
  },
  footerRonEmoji: {
    fontSize: '22px',
    lineHeight: 1,
    flexShrink: 0,
  },
  footerRonText: {
    flex: 1,
    minWidth: 0,
  },
  footerRonParagraph: {
    margin: 0,
    fontSize: '13px',
    lineHeight: 1.55,
  },
  footerMedicalNote: {
    width: '100%',
    fontSize: '11px',
    lineHeight: 1.5,
    textAlign: 'center',
    color: '#64748b',
  },
  footerCopyright: {
    textAlign: 'center',
    fontSize: '11px',
    color: '#94a3b8',
  },
  footer: {
    marginTop: '10px',
    padding: '12px 14px 10px',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '10px',
    textAlign: 'center',
    fontSize: '12px',
    color: '#475569',
    background: 'linear-gradient(180deg, rgba(239,246,255,0.9) 0%, rgba(248,250,252,1) 100%)',
    border: '1px solid #dbeafe',
    borderRadius: '16px',
    boxShadow: '0 -6px 18px rgba(15,23,42,0.04)',
  },
  footerAchievementBar: {
    width: '100%',
    margin: 0,
    justifyContent: 'center',
    background: 'linear-gradient(135deg, #fff7ed 0%, #fffbeb 100%)',
    border: '1px solid #fed7aa',
    borderRadius: '12px',
    padding: '10px 12px',
    boxShadow: '0 6px 14px rgba(251,146,60,0.08)',
  },
  scrollToTopButton: {
    position: 'fixed',
    bottom: '24px',
    right: '20px',
    zIndex: 50,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '58px',
    height: '58px',
    borderRadius: '50%',
    border: '1px solid #bfdbfe',
    background: '#2563eb',
    color: '#ffffff',
    boxShadow: '0 4px 14px rgba(37, 99, 235, 0.35)',
    cursor: 'pointer',
  },
  listSection: {
    background: '#ffffff',
    border: '1px solid #e8eef7',
    borderRadius: '18px',
    padding: '18px',
  },
  listSectionTitle: {
    margin: '0 0 14px',
    fontSize: '16px',
    color: '#0f172a',
  },
  listEmpty: {
    margin: 0,
    color: '#64748b',
    fontSize: '14px',
    textAlign: 'center',
    padding: '24px 0',
  },
  listTableWrap: {
    overflowX: 'auto',
  },
  listTable: {
    width: '100%',
    minWidth: '520px',
    borderCollapse: 'collapse',
    fontSize: '13px',
  },
  listTh: {
    textAlign: 'left',
    padding: '8px 10px',
    background: '#eff6ff',
    color: '#1e3a8a',
    borderBottom: '1px solid #dbeafe',
    whiteSpace: 'nowrap',
  },
  listTd: {
    padding: '8px 10px',
    borderBottom: '1px solid #eef2f7',
    verticalAlign: 'top',
  },
  listRowPast: {
    background: '#fff7ed',
    color: '#b45309',
  },
  weekSection: {
    background: '#ffffff',
    border: '1px solid #e8eef7',
    borderRadius: '18px',
    padding: '12px',
    boxShadow: '0 12px 26px rgba(15, 23, 42, 0.04)',
  },
  fixedWeekSection: {
    flexShrink: 0,
  },
  weekNav: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '10px',
    marginBottom: '10px',
    padding: '8px 10px',
    borderRadius: '12px',
    background: 'linear-gradient(135deg, #2563eb 0%, #3b82f6 100%)',
    boxShadow: '0 6px 14px rgba(37,99,235,0.22)',
  },
  navButton: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '40px',
    height: '40px',
    borderRadius: '10px',
    border: '1px solid rgba(255,255,255,0.4)',
    background: 'rgba(255,255,255,0.15)',
    color: '#ffffff',
    cursor: 'pointer',
    flexShrink: 0,
  },
  weekTitle: {
    flex: 1,
    textAlign: 'center',
    fontSize: '15px',
    fontWeight: 700,
    color: '#ffffff',
    letterSpacing: '0.02em',
  },
  weekGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(7, minmax(0, 1fr))',
    gap: '6px',
  },
  dayButton: {
    border: '1px solid #d9e2f2',
    borderRadius: '14px',
    minHeight: '110px',
    padding: '10px 8px',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '6px',
    cursor: 'pointer',
  },
  dayLabel: {
    fontSize: '12px',
    fontWeight: 600,
  },
  dayNumber: {
    fontSize: '22px',
    color: '#111827',
  },
  dayMeta: {
    fontSize: '11px',
    color: '#64748b',
  },
  achievementBar: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '10px',
    background: 'linear-gradient(135deg, #fff7ed 0%, #fffbeb 100%)',
    border: '1px solid #fed7aa',
    borderRadius: '12px',
    marginBottom: '14px',
    padding: '10px 14px',
    boxShadow: '0 6px 18px rgba(251,146,60,0.08)',
  },
  achievementItem: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    fontSize: '13px',
    color: '#7c2d12',
  },
  achievementBadge: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    fontSize: '13px',
    color: '#7c2d12',
    background: '#ffedd5',
    borderRadius: '999px',
    padding: '3px 10px',
  },
  achievementIcon: {
    fontSize: '16px',
  },
  achievementLabel: {
    whiteSpace: 'normal',
    lineHeight: 1.4,
  },
  scheduleSearchSection: {
    background: '#ffffff',
    border: '1px solid #dbeafe',
    borderRadius: '12px',
    boxShadow: '0 6px 16px rgba(15, 23, 42, 0.04)',
    marginBottom: '14px',
    padding: '14px',
  },
  monthCalendarSection: {
    background: '#ffffff',
    border: '1px solid #dbeafe',
    borderRadius: '12px',
    boxShadow: '0 6px 16px rgba(15, 23, 42, 0.04)',
    marginBottom: '14px',
    padding: '14px',
  },
  monthCalendarHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '12px',
  },
  monthCalendarCollapseButton: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    border: 'none',
    background: 'transparent',
    color: '#0f172a',
    fontSize: '15px',
    fontWeight: 600,
    padding: '4px 2px',
    cursor: 'pointer',
  },
  monthCalendarNavTitle: {
    fontSize: '14px',
    fontWeight: 600,
    color: '#1e293b',
    minWidth: '110px',
    textAlign: 'center',
  },
  monthCalendarBody: {
    marginTop: '10px',
  },
  monthCalendarWeekdayRow: {
    display: 'grid',
    gridTemplateColumns: 'repeat(7, 1fr)',
    marginBottom: '4px',
  },
  monthCalendarWeekdayCell: {
    textAlign: 'center',
    fontSize: '11px',
    fontWeight: 600,
  },
  monthCalendarWeekRow: {
    display: 'grid',
    gridTemplateColumns: 'repeat(7, 1fr)',
    borderRadius: '8px',
  },
  monthCalendarCurrentWeekRow: {
    background: '#eef2ff',
    boxShadow: 'inset 0 0 0 1px #c7d2fe',
  },
  monthCalendarDayCell: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '2px',
    border: '1px solid transparent',
    borderRadius: '8px',
    background: 'transparent',
    padding: '6px 2px',
    minHeight: '46px',
    cursor: 'pointer',
  },
  monthCalendarDayNumber: {
    fontSize: '13px',
    fontWeight: 600,
    color: '#1e293b',
  },
  monthCalendarDayCount: {
    fontSize: '11px',
    color: '#0f172a',
    fontWeight: 600,
    minHeight: '13px',
    whiteSpace: 'nowrap',
  },
  monthCalendarSleepMark: {
    color: '#0f766e',
    fontSize: '10px',
    lineHeight: 1.2,
    fontWeight: 700,
  },
  monthCalendarIncompleteCount: {
    color: '#dc2626',
  },
  monthCalendarCountSeparator: {
    color: '#0f172a',
  },
  monthCalendarCompletedCount: {
    color: '#16a34a',
  },
  scheduleSearchHeader: {
    marginBottom: '8px',
  },
  scheduleSearchTitle: {
    color: '#0f172a',
    fontSize: '17px',
  },
  scheduleSearchCaption: {
    color: '#64748b',
    fontSize: '12px',
    marginTop: '3px',
  },
  searchClearButton: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '38px',
    height: '38px',
    border: '1px solid #d9e2f2',
    borderRadius: '9px',
    background: '#f8fbff',
    color: '#475569',
    cursor: 'pointer',
    padding: 0,
  },
  scheduleSearchInputRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    marginTop: '10px',
    border: '1px solid #bfdbfe',
    borderRadius: '8px',
    background: '#f8fbff',
    padding: '0 10px',
    cursor: 'text',
  },
  scheduleSearchInput: {
    width: '100%',
    border: 0,
    outline: 0,
    background: 'transparent',
    color: '#0f172a',
    fontSize: '16px',
    padding: '10px 0',
  },
  scheduleSearchResults: {
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
    marginTop: '10px',
  },
  scheduleSearchStatus: {
    color: '#475569',
    fontSize: '13px',
    padding: '2px 2px 5px',
  },
  scheduleSearchResult: {
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: '12px',
    width: '100%',
    border: '1px solid #e0eaf7',
    borderRadius: '8px',
    background: '#ffffff',
    color: '#1e293b',
    cursor: 'pointer',
    padding: '10px 12px',
    textAlign: 'left',
  },
  scheduleSearchResultTitle: {
    fontSize: '15px',
    fontWeight: 700,
    overflowWrap: 'anywhere',
  },
  scheduleSearchResultMeta: {
    color: '#64748b',
    flexShrink: 0,
    fontSize: '12px',
  },
  scheduleSearchEmpty: {
    color: '#64748b',
    fontSize: '13px',
    padding: '10px 2px',
  },
  scheduleSection: {
    background: '#ffffff',
    border: '1px solid #e8eef7',
    borderRadius: '18px',
    padding: '10px',
    boxShadow: '0 12px 26px rgba(15, 23, 42, 0.04)',
  },
  scrollableScheduleSection: {
    flex: 1,
    minHeight: '220px',
    overflowY: 'auto',
    overscrollBehavior: 'contain',
  },
  selectedHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '16px',
    marginBottom: '10px',
  },
  selectedHeaderActions: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    flexWrap: 'wrap',
    justifyContent: 'flex-end',
  },
  selectedCaption: {
    fontSize: '12px',
    color: '#64748b',
    marginBottom: '0',
  },
  selectedDateText: {
    margin: 0,
    fontSize: '26px',
    color: '#0f172a',
  },
  fatigueStatus: {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
    marginBottom: '10px',
    padding: '10px 12px',
    borderLeft: '3px solid #14b8a6',
    fontSize: '13px',
    lineHeight: 1.45,
  },
  fatigueStatusMain: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'baseline',
    gap: '8px',
  },
  fatigueStatusNoteInline: {
    fontSize: '11px',
    fontWeight: 400,
    opacity: 0.85,
  },
  fatigueStatusMeta: {
    fontSize: '12px',
    opacity: 0.9,
  },
  fatigueStatusHint: {
    margin: '2px 0 0',
    fontSize: '13px',
  },
  fatigueStatusFootnote: {
    fontSize: '11px',
    opacity: 0.85,
    marginTop: '2px',
  },
  fatigueMedicalNote: {
    fontSize: '11px',
    lineHeight: 1.5,
    marginTop: '4px',
    opacity: 0.9,
  },
  fatigueGuideLinkButton: {
    marginLeft: '6px',
    padding: 0,
    border: 'none',
    background: 'transparent',
    color: 'inherit',
    textDecoration: 'underline',
    cursor: 'pointer',
    fontSize: '11px',
    fontWeight: 600,
  },
  sleepRecordPanel: {
    display: 'block',
    borderTop: '1px solid #e8eef7',
    borderBottom: '1px solid #e8eef7',
    padding: '10px 0',
    marginBottom: '10px',
  },
  medicationRecordPanel: {
    display: 'block',
    borderTop: '1px solid #fde68a',
    borderBottom: '1px solid #fde68a',
    padding: '10px 0',
    marginBottom: '10px',
    background: '#fffbeb',
  },
  medicationTitleRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '8px',
    marginBottom: '8px',
  },
  medicationNotifyButton: {
    border: '1px solid #f59e0b',
    borderRadius: '8px',
    background: '#fff7ed',
    color: '#9a3412',
    fontSize: '12px',
    fontWeight: 700,
    padding: '6px 10px',
    cursor: 'pointer',
  },
  medicationNotifyButtonOff: {
    borderColor: '#94a3b8',
    background: '#f1f5f9',
    color: '#475569',
  },
  medicationSlotList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
  },
  medicationSlotRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '10px',
    padding: '10px 12px',
    borderRadius: '10px',
    border: '1px solid #fcd34d',
    background: '#ffffff',
  },
  medicationSlotRowDone: {
    borderColor: '#86efac',
    background: '#f0fdf4',
  },
  medicationSlotRowDue: {
    borderColor: '#fb923c',
  },
  medicationSlotMeta: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'baseline',
    gap: '8px',
    color: '#334155',
    fontSize: '13px',
  },
  medicationSlotTime: {
    color: '#64748b',
    fontWeight: 600,
  },
  medicationSlotTaken: {
    color: '#15803d',
    fontSize: '12px',
  },
  medicationSlotWarn: {
    color: '#c2410c',
    fontWeight: 700,
    fontSize: '12px',
  },
  medicationSlotButton: {
    minWidth: '56px',
    border: '0',
    borderRadius: '8px',
    background: '#ea580c',
    color: '#ffffff',
    fontWeight: 700,
    fontSize: '13px',
    padding: '8px 12px',
    cursor: 'pointer',
  },
  medicationSlotButtonDone: {
    background: '#16a34a',
  },
  medicationSettingsBlock: {
    marginTop: '12px',
    paddingTop: '10px',
    borderTop: '1px dashed #fcd34d',
  },
  medicationSettingsHeading: {
    fontSize: '12px',
    fontWeight: 700,
    color: '#92400e',
    marginBottom: '8px',
  },
  medicationSettingsFields: {
    display: 'grid',
    gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
    gap: '8px',
  },
  medicationSettingsField: {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
    fontSize: '12px',
    color: '#475569',
  },
  medicationSettingsSaveButton: {
    marginTop: '10px',
    border: '0',
    borderRadius: '8px',
    background: '#b45309',
    color: '#ffffff',
    fontWeight: 700,
    fontSize: '13px',
    padding: '8px 14px',
    cursor: 'pointer',
  },
  sleepRecordTitleRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '8px',
    marginBottom: '8px',
  },
  sleepRecordCollapseButton: {
    display: 'flex',
    alignItems: 'center',
    gap: '4px',
    border: 0,
    padding: 0,
    background: 'transparent',
    color: '#334155',
    cursor: 'pointer',
  },
  sleepOnlyDate: {
    marginBottom: '10px',
    color: '#0f172a',
    fontSize: '18px',
    fontWeight: 700,
  },
  sleepRecordTitle: {
    color: '#334155',
    fontSize: '14px',
  },
  sleepRecordStatus: {
    color: '#64748b',
    fontSize: '12px',
  },
  sleepSaveMessage: {
    marginTop: '8px',
    color: '#047857',
    fontSize: '12px',
    fontWeight: 700,
  },
  sleepRecordFields: {
    display: 'grid',
    gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
    gap: '10px',
  },
  sleepRecordField: {
    display: 'grid',
    gridTemplateColumns: '42px minmax(90px, 1fr)',
    alignItems: 'center',
    gap: '8px',
    color: '#475569',
    fontSize: '13px',
    fontWeight: 700,
  },
  sleepRecordActions: {
    gridColumn: '2',
    display: 'flex',
    flexWrap: 'wrap',
    gap: '6px',
  },
  sleepRecordInput: {
    width: '100%',
    minWidth: 0,
    border: '1px solid #d9e2f2',
    borderRadius: '8px',
    background: '#f8fbff',
    padding: '8px',
    color: '#1f2937',
  },
  sleepSummary: {
    gridColumn: '2',
    gridRow: '1 / span 3',
    minWidth: 0,
    padding: '10px 12px',
    borderRadius: '10px',
    background: '#ecfeff',
    border: '1px solid #a5f3fc',
  },
  sleepSummaryHeading: {
    color: '#0f766e',
    fontSize: '12px',
    fontWeight: 700,
  },
  sleepSummaryValue: {
    marginTop: '3px',
    color: '#134e4a',
    fontSize: '20px',
    fontWeight: 800,
  },
  sleepSummaryEmoji: {
    fontSize: '22px',
    marginLeft: '4px',
  },
  sleepSummaryDays: {
    color: '#64748b',
    fontSize: '11px',
  },
  sleepSummaryMessage: {
    margin: '6px 0 0',
    color: '#155e75',
    fontSize: '12px',
    lineHeight: 1.5,
  },
  sleepSummaryFootnote: {
    margin: '6px 0 0',
    color: '#64748b',
    fontSize: '11px',
    lineHeight: 1.4,
  },
  sleepSummaryEmpty: {
    marginTop: '5px',
    color: '#64748b',
    fontSize: '11px',
    lineHeight: 1.4,
  },
  previousSleepRecord: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    marginTop: '10px',
    padding: '8px 10px',
    borderRadius: '8px',
    background: '#f8fafc',
    color: '#64748b',
    fontSize: '12px',
  },
  previousSleepRecordNote: {
    color: '#94a3b8',
    fontSize: '11px',
  },
  sleepRecordSaveButton: {
    border: '1px solid #cbd5e1',
    borderRadius: '8px',
    background: '#ffffff',
    color: '#334155',
    cursor: 'pointer',
    fontSize: '12px',
    fontWeight: 700,
    padding: '8px 12px',
  },
  todayResetButton: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: '#ecfeff',
    color: '#0f766e',
    border: '1px solid #99f6e4',
    borderRadius: '999px',
    padding: '8px 14px',
    fontSize: '13px',
    fontWeight: 700,
    cursor: 'pointer',
    boxShadow: '0 4px 10px rgba(13, 148, 136, 0.08)',
  },
  addButton: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    background: '#2563eb',
    color: '#fff',
    border: 'none',
    borderRadius: '10px',
    padding: '13px 18px',
    fontSize: '15px',
    fontWeight: 700,
    cursor: 'pointer',
    minHeight: '46px',
  },
  loadingState: {
    padding: '28px 12px',
    textAlign: 'center',
    color: '#475569',
  },
  progressBarTrack: {
    position: 'sticky',
    top: 0,
    zIndex: 60,
    width: '100%',
    height: '3px',
    background: '#dbeafe',
    borderRadius: '2px',
    overflow: 'hidden',
    marginBottom: '8px',
  },
  progressBarFill: {
    height: '100%',
    width: '40%',
    background: '#2563eb',
    borderRadius: '2px',
    animation: 'schedule-progress-bar 1.1s ease-in-out infinite',
  },
  emptyState: {
    background: '#f8fbff',
    border: '1px dashed #d7e5f9',
    borderRadius: '12px',
    padding: '28px 18px',
    color: '#52607a',
    textAlign: 'center',
    lineHeight: 1.6,
  },
  scheduleList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
  },
  scheduleCard: {
    display: 'flex',
    gap: '10px',
    alignItems: 'flex-start',
    background: '#f8fbff',
    border: '1px solid #dfeaf7',
    borderRadius: '12px',
    padding: '8px 10px',
    boxShadow: '0 4px 10px rgba(15, 23, 42, 0.02)',
    cursor: 'pointer',
    userSelect: 'none',
    WebkitUserSelect: 'none',
    touchAction: 'manipulation',
    overflow: 'visible',
  },
  scheduleCardDragging: {
    position: 'relative',
    zIndex: 80,
    opacity: 0.92,
    boxShadow: '0 12px 28px rgba(37, 99, 235, 0.28)',
    borderColor: '#93c5fd',
    background: '#eff6ff',
    cursor: 'grabbing',
    pointerEvents: 'none',
  },
  scheduleCardDropBefore: {
    boxShadow: 'inset 0 3px 0 #2563eb, 0 4px 10px rgba(15, 23, 42, 0.02)',
  },
  scheduleCardDropAfter: {
    boxShadow: 'inset 0 -3px 0 #2563eb, 0 4px 10px rgba(15, 23, 42, 0.02)',
  },
  completedScheduleCard: {
    background: '#e5e7eb',
    borderColor: '#d1d5db',
    boxShadow: 'none',
    cursor: 'pointer',
    userSelect: 'none',
    WebkitUserSelect: 'none',
    touchAction: 'manipulation',
  },
  relatedScheduleCard: {
    background: '#fef9c3',
    borderColor: '#facc15',
    boxShadow: '0 6px 16px rgba(202, 138, 4, 0.18)',
  },
  completedRelatedScheduleCard: {
    background: '#fde68a',
    borderColor: '#f59e0b',
    boxShadow: 'none',
    cursor: 'default',
  },
  scheduleTimeBox: {
    minWidth: '94px',
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    background: '#e0edff',
    borderRadius: '10px',
    color: '#1d4ed8',
    padding: '8px 10px',
    fontSize: '13px',
    fontWeight: 700,
  },
  scheduleBody: {
    flex: 1,
    minWidth: 0,
    overflow: 'visible',
  },
  scheduleTitleRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '12px',
    marginBottom: '4px',
    position: 'relative',
    zIndex: 2,
  },
  scheduleTitleWrap: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    minWidth: 0,
  },
  scheduleTitle: {
    fontSize: '15px',
    fontWeight: 700,
    color: '#0f172a',
    wordBreak: 'break-word',
  },
  completedText: {
    color: '#6b7280',
    textDecoration: 'line-through',
  },
  priorityBadge: {
    flexShrink: 0,
    borderRadius: '6px',
    padding: '2px 6px',
    fontSize: '11px',
    fontWeight: 700,
  },
  highPriorityBadge: {
    background: '#fee2e2',
    color: '#b91c1c',
  },
  lowPriorityBadge: {
    background: '#e0f2fe',
    color: '#0369a1',
  },
  completeButton: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '40px',
    height: '40px',
    borderRadius: '9px',
    border: '1px solid #bbf7d0',
    background: '#f0fdf4',
    color: '#16a34a',
    cursor: 'pointer',
  },
  completedButton: {
    background: '#16a34a',
    color: '#ffffff',
  },
  deleteButton: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '30px',
    height: '30px',
    borderRadius: '8px',
    border: '1px solid #e2e8f0',
    background: '#ffffff',
    color: '#ef4444',
    cursor: 'pointer',
  },
  copyButton: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '30px',
    height: '30px',
    borderRadius: '8px',
    border: '1px solid #d1d5db',
    background: '#f3f4f6',
    color: '#6b7280',
    cursor: 'pointer',
    fontSize: '16px',
  },
  weeklyCopyButton: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '30px',
    height: '30px',
    borderRadius: '8px',
    border: '1px solid #c7d2fe',
    background: '#eef2ff',
    color: '#4f46e5',
    cursor: 'pointer',
    fontSize: '18px',
    lineHeight: 1,
  },
  relationButton: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '30px',
    height: '30px',
    borderRadius: '8px',
    border: '1px solid #fcd34d',
    background: '#fef3c7',
    color: '#a16207',
    cursor: 'pointer',
  },
  scheduleActionMenu: {
    position: 'relative',
  },
  scheduleActionMenuButton: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '40px',
    height: '40px',
    borderRadius: '9px',
    border: '1px solid #d1d5db',
    background: '#ffffff',
    color: '#475569',
    cursor: 'pointer',
    listStyle: 'none',
  },
  scheduleActionMenuList: {
    position: 'absolute',
    top: 'calc(100% + 4px)',
    right: 0,
    zIndex: 300,
    width: '220px',
    padding: '8px 6px',
    border: '1px solid #dfeaf7',
    borderRadius: '10px',
    background: '#ffffff',
    boxShadow: '0 12px 28px rgba(15, 23, 42, 0.18), 0 2px 8px rgba(0, 0, 0, 0.06)',
    maxHeight: 'min(70vh, 360px)',
    overflowY: 'auto',
  },
  scheduleActionMenuItem: {
    display: 'flex',
    alignItems: 'center',
    width: '100%',
    gap: '10px',
    border: 0,
    borderRadius: '6px',
    background: 'transparent',
    color: '#334155',
    padding: '10px 12px',
    fontSize: '14px',
    fontWeight: 500,
    textAlign: 'left',
    cursor: 'pointer',
    boxSizing: 'border-box',
    minHeight: '40px',
  },
  scheduleActionDelete: {
    color: '#dc2626',
  },
  dateInputRow: {
    display: 'flex',
    alignItems: 'stretch',
    gap: '8px',
  },
  aggFilterRow: {
    display: 'flex',
    gap: '18px',
  },
  aggFilterLabel: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    fontSize: '14px',
    color: '#334155',
  },
  aggResultMeta: {
    marginTop: '14px',
    fontSize: '13px',
    color: '#475569',
  },
  aggResultTableWrap: {
    marginTop: '8px',
    maxHeight: '260px',
    overflowY: 'auto',
    border: '1px solid #e2e8f0',
    borderRadius: '10px',
  },
  aggResultTable: {
    width: '100%',
    borderCollapse: 'collapse',
    fontSize: '13px',
  },
  aggResultHeaderCell: {
    position: 'sticky',
    top: 0,
    background: '#e8f0ff',
    color: '#1e3a8a',
    textAlign: 'left',
    padding: '8px 10px',
    borderBottom: '1px solid #cbd5e1',
  },
  aggResultCell: {
    padding: '8px 10px',
    borderBottom: '1px solid #e2e8f0',
    overflowWrap: 'anywhere',
  },
  datePickerButton: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '42px',
    flexShrink: 0,
    border: '1px solid #bfdbfe',
    borderRadius: '8px',
    background: '#eff6ff',
    color: '#2563eb',
    cursor: 'pointer',
  },
  moveCopyCalendar: {
    marginTop: '10px',
    border: '1px solid #bfdbfe',
    borderRadius: '8px',
    background: '#ffffff',
    padding: '10px',
  },
  moveCopyCalendarHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    color: '#1e3a5f',
    marginBottom: '8px',
  },
  calendarNavButton: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '38px',
    height: '38px',
    border: 0,
    borderRadius: '7px',
    background: '#eff6ff',
    color: '#2563eb',
    cursor: 'pointer',
  },
  moveCopyCalendarGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(7, 1fr)',
    gap: '3px',
    textAlign: 'center',
  },
  calendarDayName: {
    color: '#64748b',
    fontSize: '12px',
    fontWeight: 700,
    padding: '4px 0',
  },
  calendarDateButton: {
    minWidth: 0,
    height: '32px',
    border: 0,
    borderRadius: '5px',
    background: 'transparent',
    color: '#1e293b',
    cursor: 'pointer',
  },
  calendarSelectedDateButton: {
    background: '#2563eb',
    color: '#ffffff',
    fontWeight: 700,
  },
  scheduleDetailText: {
    fontSize: '12px',
    color: '#475569',
    whiteSpace: 'pre-wrap',
    lineHeight: 1.6,
    wordBreak: 'break-word',
  },
  relationInfoGroup: {
    marginTop: '6px',
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
  },
  childTaskList: {
    marginTop: '8px',
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
    paddingTop: '8px',
    borderTop: '1px dashed #cbd5e1',
    overflow: 'visible',
  },
  childTaskRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '8px',
    padding: '6px 8px',
    borderRadius: '8px',
    background: '#f8fafc',
    border: '1px solid #e2e8f0',
    position: 'relative',
    overflow: 'visible',
  },
  childTaskRowCompleted: {
    background: '#eef2f7',
    borderColor: '#d8dee8',
    color: '#64748b',
  },
  childTaskActions: {
    position: 'relative',
    zIndex: 1,
    flexShrink: 0,
  },
  childTaskActionMenuButton: {
    width: '28px',
    height: '28px',
    minWidth: '28px',
  },
  childTaskActionMenuList: {
    top: 'auto',
    bottom: 'calc(100% + 4px)',
    zIndex: 320,
    minWidth: '180px',
    width: '200px',
  },
  childTaskCompleteLocked: {
    background: '#e2e8f0',
    color: '#94a3b8',
    borderColor: '#cbd5e1',
    cursor: 'not-allowed',
  },
  childTaskTitle: {
    flex: 1,
    fontSize: '13px',
    fontWeight: 600,
    color: '#334155',
    wordBreak: 'break-word',
  },
  childTaskParentLabel: {
    margin: '0 0 10px',
    fontSize: '12px',
    color: '#1d4ed8',
    background: '#eff6ff',
    border: '1px solid #bfdbfe',
    borderRadius: '8px',
    padding: '6px 8px',
    lineHeight: 1.45,
  },
  listParentLink: {
    marginTop: '4px',
    fontSize: '11px',
    color: '#64748b',
    lineHeight: 1.4,
  },
  relationInfoText: {
    marginTop: '6px',
    fontSize: '12px',
    color: '#a16207',
    background: '#fef3c7',
    border: '1px solid #fde68a',
    borderRadius: '8px',
    padding: '6px 8px',
  },
  relationInfoTextLink: {
    marginTop: '6px',
    fontSize: '12px',
    color: '#a16207',
    background: '#fef3c7',
    border: '1px solid #fde68a',
    borderRadius: '8px',
    padding: '6px 8px',
    cursor: 'pointer',
    textDecoration: 'underline',
  },
  modalOverlay: {
    position: 'fixed',
    inset: 0,
    background: 'rgba(15, 23, 42, 0.55)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '20px',
    zIndex: 50,
  },
  modalOverlayFront: {
    position: 'fixed',
    inset: 0,
    background: 'rgba(15, 23, 42, 0.65)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '20px',
    zIndex: 1000,
  },
  modal: {
    width: '100%',
    maxWidth: '520px',
    background: '#fff',
    borderRadius: '18px',
    padding: '18px 18px 16px',
    boxShadow: '0 18px 40px rgba(15, 23, 42, 0.22)',
  },
  schedulePreviewModal: {
    maxWidth: '680px',
  },
  previewMeta: {
    color: '#475569',
    fontSize: '16px',
    fontWeight: 700,
    marginBottom: '16px',
  },
  previewTitle: {
    color: '#0f172a',
    fontSize: '30px',
    lineHeight: 1.4,
    marginBottom: '18px',
    overflowWrap: 'anywhere',
  },
  previewDetails: {
    minHeight: '150px',
    border: '1px solid #dfeaf7',
    borderRadius: '8px',
    background: '#f8fbff',
    color: '#1e293b',
    fontSize: '20px',
    lineHeight: 1.8,
    padding: '16px',
    whiteSpace: 'pre-wrap',
    overflowWrap: 'anywhere',
  },
  modalHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '12px',
    marginBottom: '12px',
  },
  modalTitleWrap: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  },
  modalTitle: {
    margin: 0,
    fontSize: '20px',
    color: '#0f172a',
  },
  closeButton: {
    border: '1px solid #dfeaf7',
    background: '#f8fbff',
    color: '#334155',
    borderRadius: '9px',
    cursor: 'pointer',
    padding: '10px 14px',
    fontSize: '14px',
    minHeight: '40px',
  },
  fieldLabel: {
    display: 'block',
    marginBottom: '8px',
    marginTop: '12px',
    fontSize: '13px',
    fontWeight: 700,
    color: '#334155',
  },
  modalInput: {
    width: '100%',
    borderRadius: '10px',
    border: '1px solid #d9e2f2',
    background: '#f8fbff',
    padding: '10px 12px',
    fontSize: '14px',
  },
  timeFieldRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  },
  timeFieldInput: {
    flex: '1 1 auto',
    minWidth: 0,
  },
  currentTimeButton: {
    flex: '0 0 auto',
    border: '1px solid #93c5fd',
    borderRadius: '8px',
    background: '#eff6ff',
    color: '#1d4ed8',
    cursor: 'pointer',
    fontSize: '13px',
    fontWeight: 700,
    padding: '10px 12px',
    whiteSpace: 'nowrap',
  },
  commonTitleCheckboxRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    marginTop: '10px',
    fontSize: '12px',
    color: '#475569',
  },
  commonTitleChipRow: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '6px',
    marginTop: '10px',
  },
  commonTitleChip: {
    display: 'flex',
    alignItems: 'center',
    gap: '2px',
    background: '#eff6ff',
    border: '1px solid #dbeafe',
    borderRadius: '999px',
    padding: '2px 2px 2px 10px',
  },
  commonTitleChipLabel: {
    border: 'none',
    background: 'transparent',
    color: '#1d4ed8',
    fontSize: '12px',
    cursor: 'pointer',
    padding: '4px 2px',
  },
  commonTitleChipRemove: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '18px',
    height: '18px',
    border: 'none',
    borderRadius: '999px',
    background: 'transparent',
    color: '#94a3b8',
    cursor: 'pointer',
  },
  commonTitleToggleButton: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '26px',
    height: '26px',
    border: '1px solid #dbeafe',
    borderRadius: '999px',
    background: '#eff6ff',
    color: '#1d4ed8',
    cursor: 'pointer',
  },
  textarea: {
    width: '100%',
    borderRadius: '10px',
    border: '1px solid #d9e2f2',
    background: '#f8fbff',
    padding: '12px',
    resize: 'vertical',
    minHeight: '140px',
    fontSize: '14px',
  },
  modalActionRow: {
    display: 'flex',
    justifyContent: 'flex-end',
    gap: '10px',
    marginTop: '18px',
  },
  relationTargetBox: {
    border: '1px solid #e2e8f0',
    borderRadius: '10px',
    background: '#f8fafc',
    padding: '10px 12px',
    marginBottom: '12px',
  },
  relationTargetMeta: {
    marginTop: '4px',
    fontSize: '12px',
    color: '#475569',
  },
  currentRelationBox: {
    border: '1px solid #fcd34d',
    borderRadius: '10px',
    background: '#fffbeb',
    color: '#92400e',
    fontSize: '12px',
    padding: '8px 10px',
    marginBottom: '12px',
  },
  relationTableWrap: {
    maxHeight: '320px',
    overflowY: 'auto',
    border: '1px solid #e2e8f0',
    borderRadius: '10px',
  },
  relationTable: {
    width: '100%',
    borderCollapse: 'collapse',
    fontSize: '13px',
  },
  relationTableHeadCell: {
    background: '#eff6ff',
    color: '#1e3a8a',
    position: 'sticky',
    top: 0,
    textAlign: 'left',
    padding: '8px',
    borderBottom: '1px solid #dbeafe',
  },
  relationTableCell: {
    padding: '8px',
    borderBottom: '1px solid #f1f5f9',
    color: '#1e293b',
  },
  disabledRelationRow: {
    opacity: 0.55,
  },
  unlinkButton: {
    marginRight: 'auto',
    border: '1px solid #fca5a5',
    borderRadius: '10px',
    background: '#fef2f2',
    color: '#b91c1c',
    padding: '13px 18px',
    fontSize: '15px',
    fontWeight: 600,
    cursor: 'pointer',
    minHeight: '48px',
  },
  helpLangSwitch: {
    display: 'flex',
    gap: '8px',
    marginBottom: '14px',
  },
  helpLangButton: {
    border: '1px solid #d9e2f2',
    borderRadius: '999px',
    background: '#f8fbff',
    color: '#475569',
    padding: '6px 14px',
    fontSize: '13px',
    fontWeight: 600,
    cursor: 'pointer',
  },
  helpLangButtonActive: {
    border: '1px solid #2563eb',
    background: '#2563eb',
    color: '#ffffff',
  },
  helpBody: {
    display: 'flex',
    flexDirection: 'column',
    gap: '10px',
  },
  helpAppInfo: {
    margin: 0,
    fontSize: '15px',
    fontWeight: 700,
    color: '#0f172a',
  },
  helpLink: {
    color: '#2563eb',
    fontSize: '14px',
    textDecoration: 'underline',
    wordBreak: 'break-all',
  },
  helpFatigueDisclaimer: {
    margin: 0,
    fontSize: '12px',
    lineHeight: 1.55,
    color: '#92400e',
    background: '#fffbeb',
    border: '1px solid #fcd34d',
    borderRadius: '8px',
    padding: '8px 10px',
  },
  helpNote: {
    margin: 0,
    fontSize: '12px',
    color: '#b91c1c',
    background: '#fef2f2',
    border: '1px solid #fecaca',
    borderRadius: '8px',
    padding: '8px 10px',
  },
  doubleTapHintBanner: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    marginBottom: '10px',
    padding: '8px 12px',
    borderRadius: '10px',
    background: '#eff6ff',
    border: '1px solid #bfdbfe',
    color: '#1d4ed8',
    fontSize: '13px',
    fontWeight: 600,
    transition: 'opacity 0.6s ease',
    opacity: 1,
  },
  doubleTapHintBannerFading: {
    opacity: 0,
  },
}

export default App