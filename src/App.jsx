import React, { useEffect, useMemo, useRef, useState } from 'react'
import { auth, db, deleteFcmToken, getFcmToken, subscribeForegroundNotifications } from './firebase'
import {
  createUserWithEmailAndPassword,
  onAuthStateChanged,
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
  serverTimestamp,
  updateDoc,
  writeBatch,
  where,
} from 'firebase/firestore'
import { ArrowUp, Bell, BellOff, CalendarDays, ChartColumn, Check, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, ClipboardList, Clock3, Copy, FileText, HelpCircle, Home, Link2, LogOut, Menu, MoreHorizontal, PencilLine, Plus, Repeat2, Search, Settings, Trash2, TrendingUp, X } from 'lucide-react'

const dayNames = ['日', '月', '火', '水', '木', '金', '土']

const HELP_SITE_URL = 'https://ron-home-app.vercel.app/'
const HELP_MAIL_ADDRESS = 'ronron201907@gmail.com'
const SLEEP_SHORTCUT_URL = 'https://www.icloud.com/shortcuts/829d308f0a34444fbf032d3d0b5f467c'

const helpContent = {
  ja: {
    langLabel: '日本語',
    title: 'ヘルプ',
    appInfo: 'ロン君のスケジュール　Ver1.00',
    siteLabel: '黒猫ロン君のAI検証ハブサイト',
    mailLabel: 'お問い合わせメール',
    note: 'なお、誹謗中傷のメールはご遠慮願います。',
    close: '閉じる',
    guideButton: '利用ガイドPDFを開く',
    prButton: 'アプリ紹介・PRスライドPDFをダウンロード',
    shortcutButton: 'iPhone用「睡眠記録」ショートカットを取得',
    about: '『ロン君のスケジュール』は、日々の予定管理を簡単にし、達成感と継続を支えるためのアプリです。',
    summary: '予定の登録から通知、進捗確認まで、日々の生活に沿った使い方をサポートします。',
  },
  en: {
    langLabel: 'English',
    title: 'Help',
    appInfo: "Ron’s Schedule Ver1.00",
    siteLabel: "Black Cat Ron-kun's AI Verification Hub",
    mailLabel: 'Contact Email',
    note: 'Please avoid sending abusive or defamatory emails.',
    close: 'Close',
    guideButton: 'Open User Guide (PDF)',
    prButton: 'Download App Introduction / PR Slides',
    shortcutButton: 'Get the “Sleep Records” Shortcut for iPhone',
    about: 'Ron’s Schedule is a simple planning app designed to make daily scheduling easier and help you stay consistent over time.',
    summary: 'From adding tasks to checking progress and managing reminders, it supports a smoother daily routine.',
  },
}

const MAX_COMMON_TITLES = 20
const WEEK_CALENDAR_FIXED_KEY = 'ron-sch-week-calendar-fixed'
const WEEK_START_DAY_KEY = 'ron-sch-week-start-day'
const MONTH_CALENDAR_ENABLED_KEY = 'ron-sch-month-calendar-enabled'
const WEEK_CALENDAR_ENABLED_KEY = 'ron-sch-week-calendar-enabled'
const SLEEP_RECORD_ENABLED_KEY = 'ron-sch-sleep-record-enabled'

const isSleepShortcutLaunch = () => {
  if (typeof window === 'undefined') return false
  return new URLSearchParams(window.location.search).get('sleep') === '1'
}

const formatDateKey = (date) => {
  const d = new Date(date)
  const year = d.getFullYear()
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

const formatCurrentTime = () => {
  const now = new Date()
  return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
}

const getSleepDurationMinutes = (record, previousRecord) => {
  if (!record?.wakeTime || !previousRecord?.bedtime) return null
  let minutes = parseTimeValue(record.wakeTime) - parseTimeValue(previousRecord.bedtime)
  if (minutes <= 0) minutes += 24 * 60
  return minutes
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

const getSleepAdviceLevel = (averageMinutes) => {
  if (averageMinutes === null) return null
  if (averageMinutes <= 5 * 60) return 'short'
  if (averageMinutes <= 7 * 60) return 'moderate'
  if (averageMinutes <= 8 * 60) return 'good'
  return 'long'
}

const parseTimeValue = (time = '09:00') => {
  const [hourText = '9', minuteText = '0'] = String(time).split(':')
  return Number(hourText || 0) * 60 + Number(minuteText || 0)
}

const isTimeOverlap = (time1, endTime1, time2, endTime2) => {
  const start1 = parseTimeValue(time1)
  const end1 = parseTimeValue(endTime1)
  const start2 = parseTimeValue(time2)
  const end2 = parseTimeValue(endTime2)
  return start1 < end2 && start2 < end1
}

const isValidTimeRange = (startTime, endTime) => {
  return parseTimeValue(startTime) < parseTimeValue(endTime)
}

// 開始時刻までの残り分数から緊急度を判定（5分前=critical, 15分前=warning）
const getScheduleUrgency = (item, nowMs) => {
  if (item.completed || !item.date) return 'none'
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

const isRelatablePreviousSchedule = (candidate, selected) => {
  if (candidate.date === selected.date) {
    return parseTimeValue(candidate.endTime || '10:00') < parseTimeValue(selected.time || '09:00')
  }
  return candidate.date < selected.date
}

const relationKeyFromItem = (item) => `${item.date}_${item.id}`

const addDays = (date, amount) => {
  const next = new Date(date)
  next.setDate(next.getDate() + amount)
  return next
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

const AGGREGATION_MAX_DAYS = 31

const notificationTokenKey = (userId) => `ron-sch-fcm-token:${userId}`

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
  const [sleepRecord, setSleepRecord] = useState(null)
  const [previousSleepRecord, setPreviousSleepRecord] = useState(null)
  const [sleepRecordMap, setSleepRecordMap] = useState({})
  const [sleepSaving, setSleepSaving] = useState(false)
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
  const notificationRegistrationRef = useRef(null)
  const notificationToggleLockRef = useRef(false)
  const weekSwipeRef = useRef(null)
  const weekTouchRef = useRef(null)
  const daySwipeRef = useRef(null)
  const dayTouchRef = useRef(null)
  const loadedWeeksRef = useRef(new Set())
  const mainRef = useRef(null)
  const scheduleSectionRef = useRef(null)
  const selectedKey = formatDateKey(selectedDate)
  const sleepOnlyMode = isSleepShortcutLaunch()

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

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setSession(user)
    })
    return () => unsubscribe()
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
    if (!session || typeof window === 'undefined') return
    if (!('Notification' in window) || !('serviceWorker' in navigator)) {
      setNotificationEnabled(false)
      setNotificationPermission('unsupported')
      return
    }

    let cancelled = false
    let timerId = null

    const loadNotificationState = async () => {
      setNotificationPermission(Notification.permission)

      if (Notification.permission !== 'granted') {
        if (!cancelled) {
          setNotificationEnabled(false)
        }
        return
      }

      const storedToken = window.localStorage.getItem(notificationTokenKey(session.uid))
      if (!storedToken) {
        if (!cancelled) {
          setNotificationEnabled(false)
        }
        return
      }

      const tokenDoc = await getDoc(doc(db, 'fcm_tokens', `${session.uid}_${storedToken}`))
      if (cancelled) return

      if (!tokenDoc.exists()) {
        window.localStorage.removeItem(notificationTokenKey(session.uid))
        setNotificationEnabled(false)
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
    }

    // 初回レンダリングとスケジュール取得を優先するため、通知同期は遅延実行
    timerId = setTimeout(() => {
      loadNotificationState().catch((error) => {
        console.error('通知状態の取得エラー:', error)
      })
    }, 1200)

    setNotificationBadgeCount(0)

    return () => {
      cancelled = true
      if (timerId) clearTimeout(timerId)
    }
  }, [session?.uid])

  const getNotificationRegistration = async () => {
    if (notificationRegistrationRef.current) return notificationRegistrationRef.current
    const registration = await navigator.serviceWorker.register('/firebase-messaging-sw.js')
    notificationRegistrationRef.current = registration
    return registration
  }

  const syncBadgeWithServiceWorker = async (count) => {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return

    try {
      const existing = await navigator.serviceWorker.getRegistration('/firebase-messaging-sw.js')
      if (!existing) return
      const registration = await navigator.serviceWorker.ready
      const targetWorker = navigator.serviceWorker.controller || registration.active
      if (targetWorker) {
        targetWorker.postMessage({
          type: 'sync-badge-count',
          count: Math.max(Number(count) || 0, 0),
        })
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

    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return

    try {
      const existing = await navigator.serviceWorker.getRegistration('/firebase-messaging-sw.js')
      if (!existing) return
      const registration = await navigator.serviceWorker.ready
      const targetWorker = navigator.serviceWorker.controller || registration.active
      if (targetWorker) {
        targetWorker.postMessage({ type: 'clear-badge-count' })
      }
    } catch (error) {
      console.warn('起動時のバッジクリアに失敗しました:', error)
    }
  }

  useEffect(() => {
    if (typeof window === 'undefined') return
    clearNotificationBadge().catch((error) => {
      console.error('起動時のバッジクリアエラー:', error)
    })
  }, [])

  const enableNotifications = async () => {
    if (!session) return
    if (!('Notification' in window) || !('serviceWorker' in navigator)) {
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
        updated_at: serverTimestamp(),
      },
      { merge: true }
    ), 15000, '通知トークンの保存がタイムアウトしました。')

    setNotificationEnabled(true)
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
    if (!('Notification' in window)) return

    let unsubscribe = () => {}
    let active = true
    let timerId = null

    const attachForegroundListener = async () => {
      unsubscribe = await subscribeForegroundNotifications((payload) => {
        if (!active) return
        if (Notification.permission !== 'granted') return

        const title = payload.data?.title ? 'スケジュール通知' : (payload.notification?.title || '予定の開始時刻です')
        const body = payload.data?.body || payload.notification?.body || '開始時間になった予定があります。'
        setNotificationBadgeCount((current) => {
          const next = current + 1
          setBrowserBadge(next).catch((error) => {
            console.error('バッジ設定エラー:', error)
          })
          return next
        })
        const notification = new Notification(title, { body })
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

    const handleMessage = (event) => {
      if (!event.data) return

      if (event.data.type === 'badge-count') {
        const nextCount = Math.max(Number(event.data.count || 0), 0)
        setNotificationBadgeCount((current) => (current === nextCount ? current : nextCount))
        setBrowserBadge(nextCount).catch((error) => {
          console.error('通知件数同期エラー:', error)
        })
        return
      }

      if (event.data.type === 'notification-clicked') {
        navigator.serviceWorker.ready.then((registration) => {
          if (registration.active) {
            registration.active.postMessage({ type: 'get-badge-count' })
          }
        }).catch((error) => {
          console.error('通知件数再取得エラー:', error)
        })
      }
    }

    navigator.serviceWorker.addEventListener('message', handleMessage)

    const requestBadgeCount = () => {
      navigator.serviceWorker.getRegistration('/firebase-messaging-sw.js').then((existing) => {
        if (!existing) return
        return navigator.serviceWorker.ready.then((registration) => {
          if (registration.active) {
            registration.active.postMessage({ type: 'get-badge-count' })
          }
        })
      }).catch((error) => {
        console.error('通知件数取得エラー:', error)
      })
    }

    requestBadgeCount()

    // スリープ復帰やタブ復帰時に SW 側の実カウントと再同期する
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        requestBadgeCount()
      }
    }
    document.addEventListener('visibilitychange', handleVisibilityChange)
    window.addEventListener('focus', requestBadgeCount)

    return () => {
      navigator.serviceWorker.removeEventListener('message', handleMessage)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      window.removeEventListener('focus', requestBadgeCount)
    }
  }, [session?.uid])

  useEffect(() => {
    if (!session || typeof document === 'undefined') return
    document.title = notificationBadgeCount > 0
      ? `(${notificationBadgeCount}) スケジュール`
      : 'スケジュール'
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

  const weekEndKey = formatDateKey(weekDates[6])

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

  const changeMonthView = (offset) => changeSelectedMonth(offset)
  const sessionUserId = session?.uid

  const selectedItems = useMemo(() => {
    const items = scheduleMap[selectedKey] || []
    return [...items].sort((a, b) => parseTimeValue(a.time) - parseTimeValue(b.time))
  }, [scheduleMap, selectedKey])

  const recentSleepSummary = useMemo(() => {
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
  }, [selectedDate, sleepRecordMap])

  const sleepAdvice = useMemo(() => {
    if (!recentSleepSummary.level) return null
    const advice = sleepAdviceByLevel[recentSleepSummary.level]
    return {
      emoji: advice.emoji,
      message: advice.messages[Math.floor(Math.random() * advice.messages.length)],
    }
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
    } catch (error) {
      console.error('睡眠記録保存エラー:', error)
      alert(`睡眠記録の保存に失敗しました:\n${error.message}`)
    } finally {
      setSleepSaving(false)
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
        return parseTimeValue(a.time || '09:00') - parseTimeValue(b.time || '09:00')
      })
  }, [weekDates, scheduleMap])

  // 連続達成日数・週間バッジ・ロン君の表情を予定データから算出（追加のDB読み込みなし）
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

    const todayItems = scheduleMap[todayKey] || []
    const todayRate = todayItems.length > 0 ? todayItems.filter((item) => item.completed).length / todayItems.length : null

    // マスコットは黒猫統一（🐈‍⬛）で表情のみ変化
    let mascotEmoji = '🐈‍⬛'
    let mascotMessage = '今日の予定を登録してみましょう'
    if (todayRate !== null) {
      if (todayRate >= 0.8) {
        mascotEmoji = '🐈‍⬛✨'
        mascotMessage = '今日も完璧！ロン君もご機嫌です'
      } else if (todayRate >= 0.4) {
        mascotEmoji = '🐈‍⬛'
        mascotMessage = 'いい調子！あと少しでコンプリート'
      } else {
        mascotEmoji = '🐈‍⬛💦'
        mascotMessage = 'ロン君が応援してます、ぼちぼち進めよう'
      }
    }

    const weekItems = weekDates.flatMap((date) => scheduleMap[formatDateKey(date)] || [])
    const weekRate = weekItems.length > 0 ? weekItems.filter((item) => item.completed).length / weekItems.length : null
    let weekBadge = null
    if (weekRate !== null) {
      if (weekRate >= 1) weekBadge = { icon: '🏆', label: '皆勤賞' }
      else if (weekRate >= 0.7) weekBadge = { icon: '🌟', label: 'がんばり屋さん' }
      else if (weekRate >= 0.4) weekBadge = { icon: '👍', label: '順調ペース' }
    }

    return { streak, mascotEmoji, mascotMessage, weekBadge }
  }, [scheduleMap, weekDates])

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
      .sort((a, b) => (a.date || '').localeCompare(b.date || '') || parseTimeValue(a.time || '09:00') - parseTimeValue(b.time || '09:00'))
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

        nextMap[dateKey].push({
          id: item.id || docSnap.id,
          title: item.title || '予定',
          time: item.time || '09:00',
          endTime: item.endTime || '10:00',
          details: item.details || '',
          completed: item.completed === true,
          priority: item.priority || 'normal',
          date: dateKey,
          relatedPrev: item.relatedPrev || null,
          relatedNext: item.relatedNext || null,
        })
      })

      Object.keys(nextMap).forEach((key) => {
        nextMap[key].sort((a, b) => parseTimeValue(a.time) - parseTimeValue(b.time))
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

        partialMap[dateKey].push({
          id: item.id || docSnap.id,
          title: item.title || '予定',
          time: item.time || '09:00',
          endTime: item.endTime || '10:00',
          details: item.details || '',
          completed: item.completed === true,
          priority: item.priority || 'normal',
          date: dateKey,
          relatedPrev: item.relatedPrev || null,
          relatedNext: item.relatedNext || null,
        })
      })

      Object.keys(partialMap).forEach((key) => {
        partialMap[key].sort((a, b) => parseTimeValue(a.time) - parseTimeValue(b.time))
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
      const updatedList = [...filtered, item].sort((a, b) => parseTimeValue(a.time) - parseTimeValue(b.time))
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

  const changeWeek = (offset) => {
    setSelectedDate((current) => addDays(current, offset))
  }

  const selectNextWeek = () => {
    setSelectedDate((current) => addDays(getWeekStart(current, weekStartDay), 7))
  }

  const selectPreviousWeek = () => {
    setSelectedDate((current) => addDays(getWeekStart(current, weekStartDay), -1))
  }

  const changeSelectedDay = (offset) => {
    setSelectedDate((current) => addDays(current, offset))
  }

  const goToToday = () => {
    setSelectedDate(new Date())
  }

  const hasScheduleRelation = (item) => Boolean(item?.relatedPrev || item?.relatedNext)

  const getDateConflictingItems = async (dateKey, item, ignoreExistingId = null) => {
    if (!session || !item) return []

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

    if (hasScheduleRelation(item)) {
      alert('関連を削除してから実行してください。')
      return
    }

    if (mode === 'move') {
      if (targetDate === item.date) {
        alert('移動先の日付は現在の予定日と異なる日付を選択してください。')
        return
      }
    }

    const targetDateKey = formatDateKey(new Date(`${targetDate}T00:00:00`))

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

    try {
      if (mode === 'copy') {
        const newItemId = `s-${Date.now()}`
        const newItem = {
          ...item,
          id: newItemId,
          user_id: session.uid,
          date: targetDateKey,
          completed: false,
          relatedPrev: null,
          relatedNext: null,
        }

        await setDoc(doc(db, 'schedule_items', `${session.uid}_${targetDateKey}_${newItemId}`), newItem)
        setScheduleMap((current) => {
          const next = { ...current }
          const targetList = next[targetDateKey] || []
          next[targetDateKey] = [...targetList, newItem].sort((entryA, entryB) => parseTimeValue(entryA.time) - parseTimeValue(entryB.time))
          return next
        })
        invalidateScheduleWeeks([item.date, targetDateKey])
        clearScheduleCache()
        setSelectedDate(new Date(`${targetDateKey}T00:00:00`))
        closeMoveCopyDialog()
        await fetchWeekSchedule()
        alert(`${targetDateKey} に予定を複製しました`)
        return
      }

      const sourceRef = doc(db, 'schedule_items', `${session.uid}_${item.date}_${item.id}`)
      const movedItem = {
        ...item,
        user_id: session.uid,
        date: targetDateKey,
        completed: item.completed === true,
        relatedPrev: null,
        relatedNext: null,
      }

      await setDoc(doc(db, 'schedule_items', `${session.uid}_${targetDateKey}_${item.id}`), movedItem)
      await deleteDoc(sourceRef)
      setScheduleMap((current) => {
        const next = { ...current }
        if (next[item.date]) {
          next[item.date] = next[item.date].filter((entry) => entry.id !== item.id)
        }
        const targetList = next[targetDateKey] || []
        next[targetDateKey] = [...targetList.filter((entry) => entry.id !== item.id), movedItem].sort((entryA, entryB) => parseTimeValue(entryA.time) - parseTimeValue(entryB.time))
        return next
      })
      invalidateScheduleWeeks([item.date, targetDateKey])
      clearScheduleCache()
      setSelectedDate(new Date(`${targetDateKey}T00:00:00`))
      closeMoveCopyDialog()
      await fetchWeekSchedule()
      alert(`${item.date} から ${targetDateKey} に予定を移動しました`)
    } catch (error) {
      console.error('予定の複製/移動エラー:', error)
      alert(`予定の${mode === 'copy' ? '複製' : '移動'}に失敗しました:\n${error.message}`)
    }
  }

  const executeMoveOrCopy = async (mode) => {
    await proceedMoveOrCopy(mode, false)
  }

  const openDetail = (item) => {
    if (item.completed) {
      alert('完了済みの予定は編集できません。')
      return
    }
    setSaveAsCommonTitle(false)
    setCommonTitlesExpanded(false)
    setDetailDraft({
      id: item.id,
      title: item.title || '予定',
      time: item.time || '09:00',
      endTime: item.endTime || '10:00',
      details: item.details || '',
      completed: item.completed === true,
      priority: item.priority || 'normal',
      date: item.date || selectedKey,
      relatedPrev: item.relatedPrev || null,
      relatedNext: item.relatedNext || null,
    })
  }

  const closeDetail = () => setDetailDraft(null)

  const openRelatedSchedule = async (relation) => {
    if (!relation || !session) return
    try {
      const localItem = (scheduleMap[relation.date] || []).find((entry) => entry.id === relation.id)
      if (localItem) {
        closeSchedulePreview()
        openDetail(localItem)
        return
      }
      const snap = await getDoc(doc(db, 'schedule_items', `${session.uid}_${relation.date}_${relation.id}`))
      if (!snap.exists()) {
        alert('関連する予定が見つかりません。')
        return
      }
      closeSchedulePreview()
      openDetail({ id: relation.id, date: relation.date, ...snap.data() })
    } catch (error) {
      console.error('関連予定の取得エラー:', error)
      alert(`関連する予定の取得に失敗しました:\n${error.message}`)
    }
  }

  const openSchedulePreview = (item) => setSchedulePreview(item)

  const closeSchedulePreview = () => setSchedulePreview(null)

  const closeScheduleActionMenu = (event) => {
    event.currentTarget.closest('details')?.removeAttribute('open')
  }

  const editScheduleFromPreview = () => {
    if (!schedulePreview) return
    if (schedulePreview.completed) {
      alert('完了済みの予定は編集できません。')
      return
    }
    openDetail(schedulePreview)
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

    const startTime = detailDraft.time || '09:00'
    const endTime = detailDraft.endTime || '10:00'

    // 時間の妥当性チェック
    if (!isValidTimeRange(startTime, endTime)) {
      alert('開始時刻は終了時刻より前に設定してください')
      return
    }

    setSavingDraft(true)
    try {
      const itemId = detailDraft.id || `s-${Date.now()}`
      const item = {
        id: itemId,
        user_id: session.uid,
        title: detailDraft.title.trim() || '予定',
        time: startTime,
        endTime: endTime,
        details: detailDraft.details || '',
        completed: detailDraft.completed === true,
        priority: detailDraft.priority || 'normal',
        date: detailDraft.date || selectedKey,
        relatedPrev: detailDraft.relatedPrev || null,
        relatedNext: detailDraft.relatedNext || null,
      }

      await setDoc(doc(db, 'schedule_items', `${session.uid}_${item.date}_${itemId}`), item)
      upsertScheduleItemLocal(item)
      if (saveAsCommonTitle) {
        await addCommonTitle(item.title)
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
    const selectedRef = doc(db, 'schedule_items', `${session.uid}_${item.date}_${item.id}`)

    try {
      const selectedSnap = await getDoc(selectedRef)
      if (!selectedSnap.exists()) {
        alert('削除対象の予定が見つかりません。')
        removeScheduleItemLocal(item.date, item.id)
        return
      }

      const currentItem = selectedSnap.data()
      if (hasScheduleRelation(currentItem)) {
        alert('関連付けされている予定は削除できません。関連付けを解除してから削除してください。')
        fetchWeekSchedule()
        return
      }
    } catch (error) {
      console.error('予定の関連付け確認エラー:', error)
      alert(`予定の確認に失敗しました:\n${error.message}`)
      return
    }

    if (!window.confirm(`「${item.title}」を削除しますか？`)) return

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

  // タップ間隔を自前で判定し、ダブルタップ時のみプレビューを開く（一回の軽いタッチでは開かない）
  const DOUBLE_TAP_THRESHOLD_MS = 350
  const handleScheduleCardTap = (item) => {
    const now = Date.now()
    const last = lastCardTapRef.current
    if (last.id === item.id && now - last.time < DOUBLE_TAP_THRESHOLD_MS) {
      lastCardTapRef.current = { id: null, time: 0 }
      openSchedulePreview(item)
    } else {
      lastCardTapRef.current = { id: item.id, time: now }
    }
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
      title: '新規予定',
      time: '09:00',
      endTime: '10:00',
      details: '',
      completed: false,
      priority: 'normal',
      date: selectedKey,
      relatedPrev: null,
      relatedNext: null,
    })
  }

  const toggleCompleted = async (item) => {
    if (!session) return

    const confirmMessage = item.completed ? '完了を取り消しますか？' : 'この予定を完了にしますか？'
    if (!window.confirm(confirmMessage)) return

    try {
      if (!item.completed && item.relatedPrev?.id && item.relatedPrev?.date) {
        const previousRef = doc(db, 'schedule_items', `${session.uid}_${item.relatedPrev.date}_${item.relatedPrev.id}`)
        const previousSnap = await getDoc(previousRef)
        if (!previousSnap.exists()) {
          alert('関連する前の予定が見つかりません。関連付けを解除するか、予定を確認してください。')
          return
        }
        const previousItem = previousSnap.data()
        if (previousItem.completed !== true) {
          alert('関連する前の予定が未完了のため、この予定は完了できません。')
          return
        }
      }

      const nextItem = { ...item, completed: !item.completed, user_id: session.uid }
      await setDoc(doc(db, 'schedule_items', `${session.uid}_${item.date}_${item.id}`), nextItem)
      upsertScheduleItemLocal(nextItem)
      fetchWeekSchedule()
    } catch (error) {
      console.error('完了状態更新エラー:', error)
      alert(`完了状態の更新に失敗しました:\n${error.message}`)
    }
  }

  const copyToFutureFourWeeks = async (item) => {
    if (!session) return

    const sourceDate = new Date(`${item.date}T00:00:00`)
    const targetDates = Array.from({ length: 4 }, (_, index) => formatDateKey(addDays(sourceDate, (index + 1) * 7)))

    if (!window.confirm(`未来4週間（${targetDates.length}件）に「${item.title}」をコピーしますか？`)) return

    try {
      await Promise.all(targetDates.map((targetDateKey) => {
        const newItemId = `s-${Date.now()}-${targetDateKey}`
        const newItem = {
          id: newItemId,
          user_id: session.uid,
          title: item.title,
          time: item.time,
          endTime: item.endTime,
          details: item.details,
          completed: false,
          priority: item.priority || 'normal',
          date: targetDateKey,
          relatedPrev: null,
          relatedNext: null,
        }

        return setDoc(doc(db, 'schedule_items', `${session.uid}_${targetDateKey}_${newItemId}`), newItem)
      }))
      fetchWeekSchedule()
      alert(`未来4週間に${targetDates.length}件の予定をコピーしました`)
    } catch (error) {
      console.error('未来4週間コピーエラー:', error)
      alert(`未来4週間コピーに失敗しました:\n${error.message}`)
    }
  }

  const closeRelationDialog = () => setRelationDialog(null)

  const openRelationDialog = async (item) => {
    if (!session) return

    try {
      const q = query(collection(db, 'schedule_items'), where('user_id', '==', session.uid))
      const snapshot = await getDocs(q)
      const allItems = []

      snapshot.forEach((docSnap) => {
        const entry = docSnap.data()
        allItems.push({
          id: entry.id || docSnap.id,
          title: entry.title || '予定',
          time: entry.time || '09:00',
          endTime: entry.endTime || '10:00',
          details: entry.details || '',
          completed: entry.completed === true,
          priority: entry.priority || 'normal',
          date: entry.date,
          relatedPrev: entry.relatedPrev || null,
          relatedNext: entry.relatedNext || null,
        })
      })

      const candidates = allItems
        .filter((candidate) => {
          if (candidate.id === item.id && candidate.date === item.date) return false
          if (candidate.completed) return false
          return isRelatablePreviousSchedule(candidate, item)
        })
        .sort((a, b) => {
          if (a.date !== b.date) return b.date.localeCompare(a.date)
          return parseTimeValue(b.endTime || '10:00') - parseTimeValue(a.endTime || '10:00')
        })

      setRelationDialog({
        item,
        candidates,
        selectedCandidateKey: item.relatedPrev ? relationKeyFromItem(item.relatedPrev) : '',
      })
    } catch (error) {
      console.error('関連付け候補取得エラー:', error)
      alert(`関連付け候補の取得に失敗しました:\n${error.message}`)
    }
  }

  const applyScheduleRelation = async () => {
    if (!session || !relationDialog) return
    if (!relationDialog.selectedCandidateKey) {
      alert('関連付け対象の予定を選択してください。')
      return
    }

    const selectedItem = relationDialog.item
    const selectedItemRef = toScheduleRelation(selectedItem)
    const nextPreviousItem = relationDialog.candidates.find((candidate) => relationKeyFromItem(candidate) === relationDialog.selectedCandidateKey)
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

    const items = []
    snapshot.forEach((docSnap) => {
      const item = docSnap.data()
      if (item.completed === true) return
      const dateKey = item.date
      const dayDate = new Date(`${dateKey}T00:00:00`)
      items.push({
        id: item.id || docSnap.id,
        title: item.title || '予定',
        time: item.time || '09:00',
        endTime: item.endTime || '10:00',
        details: item.details || '',
        completed: item.completed === true,
        priority: item.priority || 'normal',
        dateKey,
        dayName: dayNames[dayDate.getDay()],
        isPast: dateKey < todayKey,
      })
    })

    items.sort((a, b) => {
      if (a.dateKey !== b.dateKey) return a.dateKey.localeCompare(b.dateKey)
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

  const openSleepReport = () => {
    if (!session) return

    const reportWindow = window.open('', '_blank', 'width=1000,height=750')
    if (!reportWindow) {
      alert('帳票画面を開けませんでした。ポップアップを許可してください。')
      return
    }

    const year = selectedDate.getFullYear()
    const month = selectedDate.getMonth()
    const daysInMonth = new Date(year, month + 1, 0).getDate()
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
      return { dateKey, dayName: dayNames[date.getDay()], currentBedtime, previousBedtime, wakeTime, minutes }
    })
    const formatDuration = (minutes) => minutes === null ? '-' : `${Math.floor(minutes / 60)}時間${minutes % 60}分`
    const rows = reportRows.map((row) => `
      <tr><td>${row.dateKey} (${row.dayName})</td><td>${row.wakeTime || '-'}</td><td>${row.currentBedtime || '-'}</td><td>${row.previousBedtime || '-'}</td><td>${formatDuration(row.minutes)}</td></tr>`).join('')
    const chartRows = reportRows.filter((row) => row.minutes !== null)
    const chartWidth = 760
    const chartHeight = 260
    const maxMinutes = Math.max(12 * 60, ...chartRows.map((row) => row.minutes))
    const chartPoints = chartRows.map((row, index) => {
      const x = chartRows.length === 1 ? chartWidth / 2 : 48 + (chartWidth - 72) * index / (chartRows.length - 1)
      const y = 220 - (row.minutes / maxMinutes) * 180
      return { ...row, x, y }
    })
    const polyline = chartPoints.map((point) => `${point.x},${point.y}`).join(' ')
    const chart = chartPoints.length
      ? `<svg viewBox="0 0 ${chartWidth} ${chartHeight}" role="img" aria-label="日別睡眠時間グラフ">
          <line x1="48" y1="220" x2="${chartWidth - 24}" y2="220" stroke="#cbd5e1" />
          <line x1="48" y1="40" x2="48" y2="220" stroke="#cbd5e1" />
          <polyline points="${polyline}" fill="none" stroke="#0f766e" stroke-width="3" />
          ${chartPoints.map((point) => `<circle cx="${point.x}" cy="${point.y}" r="4" fill="#0f766e" /><text x="${point.x}" y="${point.y - 8}" text-anchor="middle" font-size="10" fill="#115e59">${formatDuration(point.minutes)}</text><text x="${point.x}" y="238" text-anchor="middle" font-size="10" fill="#64748b">${point.dateKey.slice(8)}</text>`).join('')}
        </svg>`
      : '<p class="empty">睡眠記録がありません</p>'

    const html = `<!doctype html><html lang="ja"><head><meta charset="UTF-8" /><title>睡眠記録</title>
      <style>
        @page { size: A4 portrait; margin: 12mm; } * { box-sizing: border-box; }
        body { margin: 0; color: #172033; font-family: "Noto Sans JP", "Yu Gothic", Meiryo, sans-serif; }
        h1 { margin: 0 0 5px; font-size: 24px; } h2 { margin: 22px 0 10px; font-size: 17px; color: #115e59; }
        .period, .output-date { color: #64748b; font-size: 13px; } .output-date { margin: 4px 0 18px; }
        table { width: 100%; border-collapse: collapse; font-size: 12px; } th, td { border: 1px solid #cbd5e1; padding: 6px 8px; text-align: left; }
        th { background: #ccfbf1; color: #115e59; } .chart-box { border: 1px solid #e2e8f0; padding: 10px; } svg { width: 100%; height: auto; }
        .empty { color: #64748b; text-align: center; padding: 30px; } .actions { display: flex; justify-content: flex-end; gap: 10px; margin-bottom: 14px; }
        button { border: 0; border-radius: 8px; background: #0f766e; color: white; padding: 10px 18px; font-weight: 700; cursor: pointer; } .close-button { background: #64748b; }
        @media print { .actions { display: none; } }
      </style></head><body><div class="actions"><button onclick="window.print()">PDFとして保存 / 印刷</button><button class="close-button" onclick="window.close()">閉じる</button></div>
      <h1>睡眠記録</h1><div class="period">対象期間: ${year}年${month + 1}月</div><div class="output-date">出力日: ${escapeHtml(formatDisplayDate(new Date()))}</div>
      <table><thead><tr><th>日付</th><th>起床時間</th><th>就寝時間（当日）</th><th>就寝時間（前日）</th><th>睡眠時間</th></tr></thead><tbody>${rows}</tbody></table>
      <h2>日別睡眠時間</h2><div class="chart-box">${chart}</div></body></html>`
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
      ? reportItems.map((item) => `
          <tr class="${item.isPast ? 'past-schedule' : ''}">
            <td>${escapeHtml(item.dateKey)} (${item.dayName})</td>
            <td>${escapeHtml(`${item.time} - ${item.endTime}`)}</td>
            <td>${escapeHtml(item.title)}</td>
            <td>${escapeHtml(item.priority === 'high' ? '重要' : item.priority === 'low' ? '低' : '通常')}</td>
            <td>${escapeHtml(item.details || '')}</td>
            <td>${item.completed ? '完了' : '未完了'}</td>
          </tr>`).join('')
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

  const openUserGuidePdf = (lang = 'ja') => {
    const reportWindow = window.open('', '_blank', 'width=1000,height=750')
    if (!reportWindow) {
      const alertText = lang === 'en'
        ? 'The user guide could not be opened. Please allow pop-ups and try again.'
        : 'ユーザー案内の画面を開けませんでした。ポップアップを許可してください。'
      alert(alertText)
      return
    }

    const guideContent = {
      ja: {
        title: 'ロン君のスケジュール 利用ガイド',
        subtitle: '予定の追加から進捗管理まで、日々の計画をすっきり整理して使えるガイドです。',
        sections: [
          {
            heading: '1. 予定を登録する',
            body: '画面の「追加」ボタンを押すと、予定の入力フォームが開きます。タイトル、開始時刻、終了時刻、重要度、詳細メモを入力して保存できます。定例タイトルを使えば、繰り返し同じ予定を素早く入力できます。',
            points: [
              '定例タイトルを使うと、よく使う予定名をすぐに選べます。',
              '重要度を「重要」にすると、視認性が高くなります。',
              '詳細メモには、会議内容や持ち物などを残せます。',
            ],
          },
          {
            heading: '2. 予定を管理する',
            body: '各予定カードでは、完了、複製、移動、削除、前の予定との関連付けを行えます。カードをダブルタップすると、詳細プレビューを確認できます。',
            points: [
              '予定の重複がある場合は、事前に確認メッセージが表示されます。',
              '「複製 / 移動」機能で別の日付への移動が簡単です。',
              '関連付け機能で、連続して行う予定を流れとして管理できます。',
            ],
          },
          {
            heading: '3. 週ごとの一覧と未完了の確認',
            body: 'メニューから「スケジュール一覧」や「未完了一覧」を開くと、今週の予定や未完了の作業をまとめて確認できます。月ごとの検索機能も使えます。',
            points: [
              '検索機能で、予定名からすぐに目的の予定を見つけられます。',
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
            body: '睡眠記録では、選択日の起床時刻と当日の就寝時刻を保存できます。「現在時刻」を押すと、その時点の時刻をワンタッチで保存できます。前日の就寝時刻は自動的に参照表示されます。',
            points: [
              '時刻を手動で変更した場合は「保存」を押して記録します。',
              '睡眠記録の見出しを押すと、入力欄と詳細を折りたためます。初期状態は開いた状態です。',
              '設定メニューの「睡眠記録表示」で、睡眠記録欄の表示・非表示を切り替えられます。非表示にしても保存済みデータは削除されません。',
              '直近3日間の平均睡眠時間と、睡眠時間に応じたロン君の絵文字・アドバイスを確認できます。',
              'メニューの「睡眠記録PDF」から、選択中の月の一覧表と日別グラフを出力できます。',
            ],
          },
          {
            heading: '6. 通知を使う',
            body: '右上の通知ボタンから、予定の開始時刻を通知で受け取れます。ブラウザの通知許可が必要です。',
            points: [
              '通知がオンの場合、予定開始時刻に音や表示で知らせます。',
              'iPhone / Safari はホーム画面に追加後に設定してください。',
              '通知がブロックされている場合は、ブラウザ設定から許可を切り替えてください。',
            ],
          },
          {
            heading: '7. 進捗状況を確認する',
            body: 'フッターには連続達成日数と今週の進捗状況が表示されます。達成数を見ながら、自分のペースを把握しやすくなっています。',
            points: [
              '進捗率の推移をPDFとして保存できます。',
              '継続のサポートとして、達成感を感じやすくなります。',
              '日々の予定を完了に近づけるための励ましになります。',
            ],
          },
          {
            heading: '8. スケジュールを集計する',
            body: 'メニューの「スケジュール集計」から、期間と「全て / 完了のみ」を指定して、予定名ごとの件数と合計時間(分)を集計できます。集計結果はPDFまたはCSVで保存できます。',
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
        title: 'Ron’s Schedule User Guide',
        subtitle: 'A simple guide to planning ahead, managing tasks, and tracking your progress in daily life.',
        sections: [
          {
            heading: '1. Create a schedule',
            body: 'Tap the Add button to open the schedule form. Enter the title, start time, end time, priority, and notes, then save. Reusing saved common titles helps you add recurring tasks quickly.',
            points: [
              'Common titles let you reuse familiar task names in seconds.',
              'Setting a task to High priority makes it stand out more clearly.',
              'Notes are useful for keeping meeting details, packing lists, or reminders.',
            ],
          },
          {
            heading: '2. Manage your schedule',
            body: 'Each schedule card lets you mark tasks as complete, duplicate them, move them to another date, delete them, or link them to related tasks. Double-tapping a card opens a detailed preview.',
            points: [
              'Overlapping schedules are checked automatically before saving.',
              'The copy and move tools make it easy to reschedule tasks.',
              'Related tasks can be linked to show a clear sequence of work.',
            ],
          },
          {
            heading: '3. Review weekly and incomplete tasks',
            body: 'From the menu, you can open the weekly schedule and incomplete-task list to review what is coming up or still needs attention. You can also search by task name.',
            points: [
              'Search helps you find the task you need in seconds.',
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
              'Review the average sleep time for the most recent three days, along with a Ron-style emoji and advice based on the sleep duration.',
              'From the menu, open “Sleep Records PDF” to export a table and a daily sleep-duration chart for the selected month.',
            ],
          },
          {
            heading: '6. Use notifications',
            body: 'Tap the notification button in the upper-right corner to receive reminders when a scheduled task is about to start. Browser notification permission is required.',
            points: [
              'When notifications are enabled, you will receive a reminder at the scheduled time.',
              'For iPhone and Safari, add the app to your home screen before enabling alerts.',
              'If notifications are blocked, change the browser settings to allow them.',
            ],
          },
          {
            heading: '7. Track your progress',
            body: 'The footer shows your streak and weekly progress so it is easy to stay aware of your momentum and keep moving forward.',
            points: [
              'Progress trends can be saved as a PDF report.',
              'Motivational indicators help maintain momentum.',
              'Daily review makes your plans easier to manage and more realistic.',
            ],
          },
          {
            heading: '8. Summarize your schedules',
            body: 'From the menu, open "Schedule Summary" to choose a date range and either "All" or "Completed only", then get the count and total minutes for each task name. Results can be saved as PDF or CSV.',
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
                <div class="brand">RON SCH</div>
              </div>
              <h1>${guide.title}</h1>
              <p class="subtitle">${guide.subtitle}</p>
              ${sectionsHtml}
              <div class="tip">
                <div class="tip-title">${guide.noteTitle}</div>
                <div>${guide.note}</div>
              </div>
              <div class="footer">${guide.footer}</div>
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

  const openProductPrPdf = (lang = 'ja') => {
    const reportWindow = window.open('', '_blank', 'width=1100,height=800')
    if (!reportWindow) {
      alert(lang === 'en' ? 'The PR slides could not be opened. Please allow pop-ups.' : 'PRスライドを開けませんでした。ポップアップを許可してください。')
      return
    }

    const isEnglish = lang === 'en'
    const slides = isEnglish ? [
      { tag: 'RON’S SCHEDULE', title: 'Plan your day.\nMake progress visible.', body: 'A friendly daily schedule app that turns intentions into small, achievable actions.', art: '📅  ✨  🐈‍⬛' },
      { tag: 'ONE PLACE FOR YOUR DAY', title: 'See what matters\nat a glance.', body: 'Schedules, priorities, completion, search, calendar views, and reminders work together in one calm workspace.', art: '🗓️  ✅  🔔' },
      { tag: 'SLEEP RECORDS', title: 'Start the morning\nwith a simple tap.', body: 'Save wake-up time and bedtime manually or use Current Time. Review the previous bedtime and your recent average.', art: '🌙  🛏️  ☀️' },
      { tag: 'RON-KUN’S SUPPORT', title: 'A little advice\nfor today.', body: 'Recent sleep averages are translated into four friendly levels, emojis, and rotating advice from black cat Ron-kun.', art: '🐈‍⬛  💬  😊' },
      { tag: 'KEEP GOING', title: 'Small checks create\na better rhythm.', body: 'Streaks, progress reports, PDFs, and notifications help you notice what you have done and choose the next step.', art: '🔥  📈  🚶' },
      { tag: 'READY WHEN YOU ARE', title: 'Make today\neasier to begin.', body: 'Use the web app or the iPhone Sleep Records Shortcut for quick access to the moments that matter.', art: '📱  🚀  🐈‍⬛' },
    ] : [
      { tag: 'ロン君のスケジュール', title: '今日を整え、\n前進を見える化。', body: 'やりたいことを小さな行動に変えて、毎日の達成感を支えるスケジュールアプリです。', art: '📅  ✨  🐈‍⬛' },
      { tag: '一日の予定をひとまとめ', title: '大切なことが\nひと目でわかる。', body: '予定、重要度、完了、検索、カレンダー、通知をひとつの落ち着いた画面で管理できます。', art: '🗓️  ✅  🔔' },
      { tag: '睡眠記録', title: '朝の記録を\nワンタッチで。', body: '起床と就寝を手動または現在時刻で保存。前日の就寝と最近の平均睡眠時間も確認できます。', art: '🌙  🛏️  ☀️' },
      { tag: 'ロン君のサポート', title: '今日のあなたに\nひとこと。', body: '最近の睡眠平均を4段階で判定し、黒猫ロン君の絵文字と日替わりアドバイスで寄り添います。', art: '🐈‍⬛  💬  😊' },
      { tag: '続ける仕組み', title: '小さな確認が\nよいリズムをつくる。', body: '連続達成、進捗レポート、PDF、通知で、できたことに気づき次の一歩を選べます。', art: '🔥  📈  🚶' },
      { tag: 'いつでも、あなたのペースで', title: '今日を始める\nきっかけに。', body: 'Webアプリでも、iPhoneの睡眠記録ショートカットでも、必要な瞬間にすぐ使えます。', art: '📱  🚀  🐈‍⬛' },
    ]

    const slideHtml = slides.map((slide, index) => `
      <section class="slide ${index === 0 ? 'cover' : ''}">
        <div class="brand">${escapeHtml(slide.tag)}</div>
        <div class="illustration">${slide.art}</div>
        <div class="slide-number">${String(index + 1).padStart(2, '0')} / ${String(slides.length).padStart(2, '0')}</div>
        <h1>${escapeHtml(slide.title).replaceAll('\n', '<br>')}</h1>
        <p>${escapeHtml(slide.body)}</p>
        <img class="ron" src="/ron.png" alt="黒猫ロン君" />
      </section>`).join('')

    const title = isEnglish ? 'Ron’s Schedule App Introduction' : 'ロン君のスケジュール アプリ紹介'
    const html = `<!doctype html><html lang="${isEnglish ? 'en' : 'ja'}"><head><meta charset="UTF-8" /><title>${title}</title>
      <style>
        @page { size: A4 landscape; margin: 0; } * { box-sizing: border-box; }
        body { margin: 0; color: #172033; font-family: "Noto Sans JP", "Yu Gothic", Meiryo, sans-serif; background: #dfe8f2; }
        .slide { position: relative; width: 297mm; height: 210mm; page-break-after: always; overflow: hidden; padding: 24mm 28mm; background: linear-gradient(135deg, #f8fbff 0%, #e7f4f2 100%); }
        .slide.cover { background: linear-gradient(135deg, #dbeafe 0%, #ccfbf1 100%); }
        .brand { color: #0f766e; font-size: 15px; font-weight: 800; letter-spacing: 2px; }
        .illustration { position: absolute; top: 42mm; right: 25mm; font-size: 58px; letter-spacing: 10px; white-space: nowrap; }
        .slide h1 { position: relative; z-index: 1; max-width: 185mm; margin: 38mm 0 10mm; color: #0f172a; font-size: 39px; line-height: 1.2; }
        .slide p { position: relative; z-index: 1; max-width: 145mm; color: #475569; font-size: 19px; line-height: 1.8; }
        .ron { position: absolute; right: 30mm; bottom: 22mm; width: 54mm; max-height: 72mm; object-fit: contain; }
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
              <h2 style={styles.brandTitle}>ロン君のスケジュール</h2>
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
        <div style={styles.appShell} className={`app-shell${sleepOnlyMode ? ' sleep-only-mode' : ''}`}>
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
                      <Clock3 size={18} /> 睡眠記録PDF
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
                  </div>
                )}
              </div>
              <CalendarDays size={26} color="#2563eb" />
              <h1 style={styles.title} className="app-title">スケジュール</h1>
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
                  {notificationEnabled ? <Bell size={16} /> : <BellOff size={16} />}
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
                  {!monthCalendarCollapsed && (
                    <div className="month-calendar-nav" style={styles.monthCalendarNav}>
                      <button
                        type="button"
                        className="month-calendar-nav-btn"
                        style={styles.searchNavButton}
                        onClick={() => changeMonthView(-1)}
                        aria-label="前月"
                        title="前月"
                      >
                        <ChevronLeft size={16} />
                      </button>
                      <span className="month-calendar-nav-title" style={styles.monthCalendarNavTitle}>{formatMonthTitle(monthViewDate)}</span>
                      <button
                        type="button"
                        className="month-calendar-nav-btn"
                        style={styles.searchNavButton}
                        onClick={() => changeMonthView(1)}
                        aria-label="翌月"
                        title="翌月"
                      >
                        <ChevronRight size={16} />
                      </button>
                    </div>
                  )}
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
                                <span style={styles.monthCalendarDayNumber}>{date.getDate()}</span>
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
            <section className="schedule-search-section" style={styles.scheduleSearchSection} aria-label="スケジュール名を検索">
              <div className="schedule-search-header" style={styles.scheduleSearchHeader}>
                <div>
                  <h2 className="schedule-search-title" style={styles.scheduleSearchTitle}>スケジュールを検索</h2>
                  <p className="schedule-search-caption" style={styles.scheduleSearchCaption}>{searchMonthTitle}の予定名から部分一致で検索</p>
                </div>
                <div className="schedule-search-nav" style={styles.scheduleSearchNav}>
                  <button
                    type="button"
                    className="schedule-search-nav-btn"
                    style={styles.searchNavButton}
                    onClick={() => changeSearchMonth(-1)}
                    aria-label="前月"
                    title="前月"
                  >
                    <ChevronLeft size={16} />
                  </button>
                  <span className="schedule-search-nav-month" style={styles.searchNavMonthText}>{searchMonthTitle}</span>
                  <button
                    type="button"
                    className="schedule-search-nav-btn"
                    style={styles.searchNavButton}
                    onClick={() => changeSearchMonth(1)}
                    aria-label="翌月"
                    title="翌月"
                  >
                    <ChevronRight size={16} />
                  </button>
                  {scheduleSearchQuery && (
                    <button type="button" className="schedule-search-clear-btn" style={styles.searchClearButton} onClick={() => {
                      setScheduleSearchQuery('')
                    }} aria-label="検索をクリア" title="検索をクリア">
                      <X size={16} />
                    </button>
                  )}
                </div>
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
                      <span style={styles.scheduleSearchResultMeta}>{item.date}　{item.time || '09:00'} - {item.endTime || '10:00'}</span>
                    </button>
                  ))}
                  {scheduleSearchResults.length === 0 && (
                    <div style={styles.scheduleSearchEmpty}>{searchMonthTitle}に該当する予定はありません。</div>
                  )}
                </div>
              )}
            </section>
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
                      <span className="week-day-label" style={{ ...styles.dayLabel, color: date.getDay() === 0 ? '#dc2626' : date.getDay() === 6 ? '#2563eb' : '#475569' }}>
                        {dayNames[date.getDay()]}
                      </span>
                      <strong className="week-day-number" style={styles.dayNumber}>{date.getDate()}</strong>
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
              style={{ ...styles.scheduleSection, ...(weekCalendarEnabled && weekCalendarFixed ? styles.scrollableScheduleSection : {}), touchAction: 'pan-y' }}
              onTouchStart={(event) => {
                dayTouchRef.current = event.changedTouches[0].clientX
              }}
              onTouchEnd={(event) => {
                if (dayTouchRef.current === null) return
                const distance = event.changedTouches[0].clientX - dayTouchRef.current
                dayTouchRef.current = null
                if (Math.abs(distance) > 50) {
                  clearLongPress()
                  changeSelectedDay(distance < 0 ? 1 : -1)
                }
              }}
              onPointerDown={(event) => {
                if (event.pointerType === 'touch') return
                daySwipeRef.current = event.clientX
              }}
              onPointerUp={(event) => {
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
                  <h2 className="selected-date-text" style={styles.selectedDateText}>{formatWeekTitle(selectedDate)}</h2>
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

              {sleepRecordEnabled && <div className="sleep-record-panel" style={styles.sleepRecordPanel} aria-label="睡眠記録">
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
                {!sleepRecordCollapsed && <>
                <div style={styles.sleepRecordFields}>
                  <label style={styles.sleepRecordField}>
                    <span>起床</span>
                    <input
                      type="time"
                      value={sleepRecord?.wakeTime || formatCurrentTime()}
                      onChange={(event) => setSleepRecord((current) => ({ ...(current || {}), wakeTime: event.target.value }))}
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
                      onChange={(event) => setSleepRecord((current) => ({ ...(current || {}), bedtime: event.target.value }))}
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
                <div style={styles.previousSleepRecord}>
                  <span>前日の就寝</span>
                  <strong>{previousSleepRecord?.bedtime || '未記録'}</strong>
                  <span style={styles.previousSleepRecordNote}>前日の記録を表示</span>
                </div>
                <aside className="sleep-summary" style={styles.sleepSummary} aria-label="最近3日間の平均睡眠時間">
                  <div style={styles.sleepSummaryHeading}>最近3日間の平均</div>
                  {sleepAdvice ? (
                    <>
                      <div style={styles.sleepSummaryValue}>{formatSleepDuration(recentSleepSummary.averageMinutes)} <span style={styles.sleepSummaryEmoji}>{sleepAdvice.emoji}</span></div>
                      <div style={styles.sleepSummaryDays}>{recentSleepSummary.recordedDays}/3日を集計</div>
                      <p style={styles.sleepSummaryMessage}>{sleepAdvice.message}</p>
                    </>
                  ) : (
                    <div style={styles.sleepSummaryEmpty}>睡眠時間を保存すると表示します</div>
                  )}
                </aside>
                </>}
              </div>}

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

              {loading && selectedItems.length === 0 ? (
                <div style={styles.loadingState}>読み込み中...</div>
              ) : selectedItems.length === 0 ? (
                <div style={styles.emptyState}>この日の予定はまだありません。追加ボタンから予定を登録できます。</div>
              ) : (
                <div className="schedule-list" style={styles.scheduleList}>
                  {selectedItems.map((item) => {
                    const hasOverlap = selectedItems.some((other) => {
                      return other.id !== item.id && isTimeOverlap(item.time || '09:00', item.endTime || '10:00', other.time || '09:00', other.endTime || '10:00')
                    })
                    const timeDisplay = `${item.time || '09:00'} - ${item.endTime || '10:00'}`
                    const timeBoxStyle = hasOverlap
                      ? { ...styles.scheduleTimeBox, color: '#dc2626', background: '#fee2e2' }
                      : item.completed
                        ? { ...styles.scheduleTimeBox, color: '#6b7280', background: '#d1d5db' }
                        : styles.scheduleTimeBox
                    const urgency = getScheduleUrgency(item, nowTick)

                    return (
                    <div
                      key={item.id}
                      className="schedule-card-mobile"
                      onClick={() => handleScheduleCardTap(item)}
                      style={{
                        ...styles.scheduleCard,
                        ...(hasScheduleRelation(item) ? styles.relatedScheduleCard : {}),
                        ...(item.completed ? (hasScheduleRelation(item) ? styles.completedRelatedScheduleCard : styles.completedScheduleCard) : {}),
                      }}
                    >
                      <div style={timeBoxStyle}>
                        <Clock3 size={16} color={hasOverlap ? '#dc2626' : '#2563eb'} />
                        <span>{timeDisplay}</span>
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
                          <div className="schedule-actions-mobile" style={{ display: 'flex', gap: '8px' }}>
                            <button
                              type="button"
                              className="schedule-complete-btn"
                              style={{ ...styles.completeButton, ...(item.completed ? styles.completedButton : {}) }}
                              aria-label={item.completed ? '完了を取り消す' : '予定を完了にする'}
                              onClick={(event) => {
                                event.stopPropagation()
                                toggleCompleted(item)
                              }}
                              title={item.completed ? '完了を取り消す' : '完了にする'}
                            >
                              <Check size={16} />
                            </button>
                            <details className="schedule-action-menu" style={styles.scheduleActionMenu} onClick={(event) => event.stopPropagation()}>
                              <summary className="schedule-action-menu-summary" style={styles.scheduleActionMenuButton} aria-label="予定の操作" title="予定の操作">
                                <MoreHorizontal size={20} />
                              </summary>
                              <div className="schedule-action-menu-list" style={styles.scheduleActionMenuList}>
                                <button type="button" className="schedule-action-menu-item" style={styles.scheduleActionMenuItem} onClick={(event) => {
                                  closeScheduleActionMenu(event)
                                  if (!item.completed) openMoveCopyDialog(item)
                                }} disabled={item.completed}>
                                  <Copy size={18} /> <span>複製 / 移動</span>
                                </button>
                                <button type="button" className="schedule-action-menu-item" style={styles.scheduleActionMenuItem} onClick={(event) => {
                                  closeScheduleActionMenu(event)
                                  if (!item.completed) copyToFutureFourWeeks(item)
                                }} disabled={item.completed}>
                                  <Repeat2 size={18} /> <span>未来4週間にコピー</span>
                                </button>
                                <button type="button" className="schedule-action-menu-item" style={styles.scheduleActionMenuItem} onClick={(event) => {
                                  closeScheduleActionMenu(event)
                                  if (!item.completed) openRelationDialog(item)
                                }} disabled={item.completed}>
                                  <Link2 size={18} /> <span>前の予定と関連付け</span>
                                </button>
                                <button type="button" className="schedule-action-menu-item schedule-action-delete-item" style={{ ...styles.scheduleActionMenuItem, ...styles.scheduleActionDelete }} onClick={(event) => {
                                  closeScheduleActionMenu(event)
                                  deleteScheduleItem(item)
                                }}>
                                  <Trash2 size={18} /> <span>予定を削除</span>
                                </button>
                              </div>
                            </details>
                          </div>
                        </div>

                        <div style={styles.scheduleDetailText}>
                          {item.details ? item.details : '詳細なし'}
                        </div>
                        {item.relatedPrev && (
                          <div
                            style={styles.relationInfoTextLink}
                            onClick={(event) => {
                              event.stopPropagation()
                              openRelatedSchedule(item.relatedPrev)
                            }}
                          >
                            関連: {item.relatedPrev.date} {item.relatedPrev.time}-{item.relatedPrev.endTime} {item.relatedPrev.title}
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
                            次の関連: {item.relatedNext.date} {item.relatedNext.time}-{item.relatedNext.endTime} {item.relatedNext.title}
                          </div>
                        )}
                      </div>
                    </div>
                    )})}
                </div>
              )}
            </section>
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
                            <td style={styles.listTd}>{item.time} - {item.endTime}</td>
                            <td style={styles.listTd}>{item.title}</td>
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
                            <td style={styles.listTd}>{item.time} - {item.endTime}</td>
                            <td style={styles.listTd}>{item.title}</td>
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

          <footer style={styles.footer}>
            <section className="achievement-bar" style={{ ...styles.achievementBar, ...styles.footerAchievementBar }} aria-label="達成状況">
              <div className="achievement-item" style={styles.achievementItem}>
                <span style={styles.achievementIcon} aria-hidden="true">🔥</span>
                <span style={styles.achievementLabel}>{achievementStats.streak}日連続達成</span>
              </div>
              <div className="achievement-item" style={styles.achievementItem}>
                <span style={styles.achievementIcon} aria-hidden="true">{achievementStats.mascotEmoji}</span>
                <span style={styles.achievementLabel}>{achievementStats.mascotMessage}</span>
              </div>
              {achievementStats.weekBadge && (
                <div className="achievement-item" style={styles.achievementBadge}>
                  <span style={styles.achievementIcon} aria-hidden="true">{achievementStats.weekBadge.icon}</span>
                  <span style={styles.achievementLabel}>今週: {achievementStats.weekBadge.label}</span>
                </div>
              )}
            </section>
            <div>© {new Date().getFullYear()} ロン君のスケジュール</div>
          </footer>

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
                    <h3 style={styles.modalTitle}>前の予定との関連付け</h3>
                  </div>
                  <button type="button" style={styles.closeButton} onClick={closeRelationDialog}>閉じる</button>
                </div>

                <div style={styles.relationTargetBox}>
                  <strong>{relationDialog.item.title}</strong>
                  <div style={styles.relationTargetMeta}>
                    {relationDialog.item.date} {relationDialog.item.time} - {relationDialog.item.endTime}
                  </div>
                </div>

                {relationDialog.item.relatedPrev && (
                  <div style={styles.currentRelationBox}>
                    現在の関連: {relationDialog.item.relatedPrev.date} {relationDialog.item.relatedPrev.time} - {relationDialog.item.relatedPrev.endTime} {relationDialog.item.relatedPrev.title}
                  </div>
                )}

                {relationDialog.candidates.length === 0 ? (
                  <div style={styles.emptyState}>関連付けできる前の予定がありません。</div>
                ) : (
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
                        {relationDialog.candidates.map((candidate) => {
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
                                {disabled ? '次予定が設定済み' : candidate.completed ? '完了' : '未完了'}
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                )}

                <div style={styles.modalActionRow}>
                  {relationDialog.item.relatedPrev && (
                    <button type="button" style={styles.unlinkButton} onClick={clearScheduleRelation}>関連解除</button>
                  )}
                  <button type="button" style={styles.secondaryButton} onClick={closeRelationDialog}>キャンセル</button>
                  <button
                    type="button"
                    style={styles.primaryButton}
                    onClick={applyScheduleRelation}
                    disabled={!relationDialog.selectedCandidateKey}
                  >
                    関連付けする
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
                    {moveCopyDialog.item.date} {moveCopyDialog.item.time} - {moveCopyDialog.item.endTime}
                  </div>
                </div>

                {hasScheduleRelation(moveCopyDialog.item) ? (
                  <div style={{ ...styles.currentRelationBox, background: '#fee2e2', borderColor: '#fecaca', color: '#991b1b' }}>
                    この予定は関連付け済みのため、移動はできません。関連を削除してから実行してください。
                  </div>
                ) : null}

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
                    disabled={hasScheduleRelation(moveCopyDialog.item) || !moveCopyDialog.targetDate}
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
                <div style={styles.previewMeta}>{formatDisplayDate(new Date(`${schedulePreview.date}T00:00:00`))}　{schedulePreview.time || '09:00'} - {schedulePreview.endTime || '10:00'}</div>
                <h2 style={styles.previewTitle}>{schedulePreview.title || '予定'}</h2>
                <div style={styles.previewDetails}>{schedulePreview.details || '詳細メモはありません。'}</div>
                {schedulePreview.relatedPrev && (
                  <div
                    style={styles.relationInfoTextLink}
                    onClick={() => openRelatedSchedule(schedulePreview.relatedPrev)}
                  >
                    関連: {schedulePreview.relatedPrev.date} {schedulePreview.relatedPrev.time}-{schedulePreview.relatedPrev.endTime} {schedulePreview.relatedPrev.title}
                  </div>
                )}
                {schedulePreview.relatedNext && (
                  <div
                    style={styles.relationInfoTextLink}
                    onClick={() => openRelatedSchedule(schedulePreview.relatedNext)}
                  >
                    次の関連: {schedulePreview.relatedNext.date} {schedulePreview.relatedNext.time}-{schedulePreview.relatedNext.endTime} {schedulePreview.relatedNext.title}
                  </div>
                )}
                <div style={styles.modalActionRow}>
                  <button type="button" style={styles.secondaryButton} onClick={closeSchedulePreview}>閉じる</button>
                  <button type="button" style={styles.primaryButton} onClick={editScheduleFromPreview}>
                    <PencilLine size={17} /> 編集
                  </button>
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
                    <h3 style={styles.modalTitle}>予定の詳細</h3>
                  </div>
                  <button type="button" style={styles.closeButton} onClick={closeDetail}>閉じる</button>
                </div>

                <label style={styles.fieldLabel}>タイトル</label>
                <input
                  type="text"
                  list="common-title-options"
                  value={detailDraft.title}
                  onChange={(e) => setDetailDraft({ ...detailDraft, title: e.target.value })}
                  style={styles.modalInput}
                  placeholder="タイトルを入力（定例タイトルから選択も可能）"
                />
                <datalist id="common-title-options">
                  {commonTitles.map((titleOption) => (
                    <option key={titleOption} value={titleOption} />
                  ))}
                </datalist>

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

                <label style={styles.fieldLabel}>開始時間</label>
                <div style={styles.timeFieldRow}>
                  <input
                    type="time"
                    value={detailDraft.time}
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
                    value={detailDraft.endTime}
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
    fontSize: '28px',
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
  monthCalendarNav: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
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
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '12px',
    marginBottom: '10px',
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
  scheduleSearchNav: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
  },
  searchNavButton: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '28px',
    height: '28px',
    border: '1px solid #d9e2f2',
    borderRadius: '7px',
    background: '#ffffff',
    color: '#334155',
    cursor: 'pointer',
    padding: 0,
  },
  searchNavMonthText: {
    fontSize: '13px',
    fontWeight: 700,
    color: '#1e293b',
    minWidth: '76px',
    textAlign: 'center',
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
  sleepRecordPanel: {
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1fr) minmax(220px, 280px)',
    columnGap: '16px',
    alignItems: 'start',
    borderTop: '1px solid #e8eef7',
    borderBottom: '1px solid #e8eef7',
    padding: '10px 0',
    marginBottom: '10px',
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
  },
  completedScheduleCard: {
    background: '#e5e7eb',
    borderColor: '#d1d5db',
    boxShadow: 'none',
    cursor: 'default',
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
  },
  scheduleTitleRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '12px',
    marginBottom: '4px',
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
    top: '38px',
    right: 0,
    zIndex: 50,
    width: '220px',
    padding: '8px 6px',
    border: '1px solid #dfeaf7',
    borderRadius: '10px',
    background: '#ffffff',
    boxShadow: '0 12px 28px rgba(15, 23, 42, 0.18), 0 2px 8px rgba(0, 0, 0, 0.06)',
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