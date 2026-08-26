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
  writeBatch,
  where,
} from 'firebase/firestore'
import { Bell, BellOff, CalendarDays, Check, ChevronLeft, ChevronRight, Clock3, Link2, LogOut, PencilLine, Plus, Trash2 } from 'lucide-react'

const dayNames = ['日', '月', '火', '水', '木', '金', '土']

const formatDateKey = (date) => {
  const d = new Date(date)
  const year = d.getFullYear()
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
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

const getWeekStart = (date) => {
  const base = new Date(date)
  base.setHours(0, 0, 0, 0)
  const day = base.getDay()
  const diff = day === 0 ? -6 : 1 - day
  base.setDate(base.getDate() + diff)
  return base
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
  const [loading, setLoading] = useState(false)
  const [detailDraft, setDetailDraft] = useState(null)
  const [relationDialog, setRelationDialog] = useState(null)
  const [notificationEnabled, setNotificationEnabled] = useState(false)
  const [notificationPermission, setNotificationPermission] = useState(
    typeof window !== 'undefined' && 'Notification' in window ? Notification.permission : 'unsupported'
  )
  const [notificationBusy, setNotificationBusy] = useState(false)
  const [notificationHelpOpen, setNotificationHelpOpen] = useState(false)
  const [notificationBadgeCount, setNotificationBadgeCount] = useState(0)
  const holdTimerRef = useRef(null)
  const notificationRegistrationRef = useRef(null)
  const notificationToggleLockRef = useRef(false)
  const weekSwipeRef = useRef(null)
  const weekTouchRef = useRef(null)
  const daySwipeRef = useRef(null)
  const dayTouchRef = useRef(null)
  const loadedWeeksRef = useRef(new Set())

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setSession(user)
    })
    return () => unsubscribe()
  }, [])

  useEffect(() => {
    // アカウント切り替え時は週キャッシュを破棄して再取得させる
    loadedWeeksRef.current = new Set()
    setScheduleMap({})
  }, [session?.uid])

  useEffect(() => {
    if (!session || typeof window === 'undefined') return
    if (!('Notification' in window) || !('serviceWorker' in navigator)) {
      setNotificationEnabled(false)
      setNotificationPermission('unsupported')
      return
    }

    let cancelled = false

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

    loadNotificationState().catch((error) => {
      console.error('通知状態の取得エラー:', error)
    })
    setNotificationBadgeCount(0)

    return () => {
      cancelled = true
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
    '右上の鈴ボタンを押して通知をONにします。',
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

    const attachForegroundListener = async () => {
      unsubscribe = await subscribeForegroundNotifications((payload) => {
        if (!active) return
        if (Notification.permission !== 'granted') return

        const title = payload.notification?.title || '予定の開始時刻です'
        const body = payload.notification?.body || '開始時間になった予定があります。'
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

    attachForegroundListener().catch((error) => {
      console.error('フォアグラウンド通知購読エラー:', error)
    })

    return () => {
      active = false
      unsubscribe()
    }
  }, [session?.uid])

  useEffect(() => {
    if (!session || typeof window === 'undefined' || !navigator.serviceWorker) return

    const handleMessage = (event) => {
      if (!event.data) return

      if (event.data.type === 'badge-count') {
        const nextCount = Math.max(Number(event.data.count || 0), 0)
        setNotificationBadgeCount(nextCount)
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
    const start = getWeekStart(selectedDate)
    return Array.from({ length: 7 }, (_, index) => addDays(start, index))
  }, [selectedDate])

  const weekStartKey = useMemo(() => formatDateKey(getWeekStart(selectedDate)), [selectedDate])

  const selectedKey = formatDateKey(selectedDate)

  const selectedItems = useMemo(() => {
    const items = scheduleMap[selectedKey] || []
    return [...items].sort((a, b) => parseTimeValue(a.time) - parseTimeValue(b.time))
  }, [scheduleMap, selectedKey])

  const fetchWeekSchedule = async () => {
    if (!session || weekDates.length === 0) return

    setLoading(true)
    try {
      const startKey = formatDateKey(weekDates[0])
      const endKey = formatDateKey(weekDates[6])
      const rangeKeys = weekDates.map((date) => formatDateKey(date))

      // user_id + date 範囲でサーバー側に絞り込ませる（composite index 使用）
      const q = query(
        collection(db, 'schedule_items'),
        where('user_id', '==', session.uid),
        where('date', '>=', startKey),
        where('date', '<=', endKey)
      )

      const snapshot = await getDocs(q)
      const nextMap = {}

      snapshot.forEach((docSnap) => {
        const item = docSnap.data()
        const dateKey = item.date

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

      // 取得済みの他の週のデータは保持したまま、今回の週の分だけ差し替える
      setScheduleMap((current) => {
        const merged = { ...current }
        rangeKeys.forEach((dateKey) => {
          merged[dateKey] = nextMap[dateKey] || []
        })
        return merged
      })
      loadedWeeksRef.current.add(startKey)
    } catch (error) {
      console.error('週予定取得エラー:', error)
      alert(`スケジュール読み込みエラー:\n${error.message}`)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (!session) return
    const weekStartKey = formatDateKey(getWeekStart(selectedDate))
    if (loadedWeeksRef.current.has(weekStartKey)) return
    fetchWeekSchedule()
  }, [session?.uid, weekStartKey])

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

  const selectNextWeekMonday = () => {
    setSelectedDate((current) => addDays(getWeekStart(current), 7))
  }

  const selectPreviousWeekSunday = () => {
    setSelectedDate((current) => addDays(getWeekStart(current), -1))
  }

  const changeSelectedDay = (offset) => {
    setSelectedDate((current) => addDays(current, offset))
  }

  const openDetail = (item) => {
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

  const saveDetailDraft = async () => {
    if (!session || !detailDraft) return

    const startTime = detailDraft.time || '09:00'
    const endTime = detailDraft.endTime || '10:00'

    // 時間の妥当性チェック
    if (!isValidTimeRange(startTime, endTime)) {
      alert('開始時刻は終了時刻より前に設定してください')
      return
    }

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
      setDetailDraft(null)
      fetchWeekSchedule()
    } catch (error) {
      console.error('予定保存エラー:', error)
      alert(`予定保存に失敗しました:\n${error.message}`)
    }
  }

  const deleteScheduleItem = async (item) => {
    if (!session) return
    if (!window.confirm(`「${item.title}」を削除しますか？`)) return

    try {
      const selectedRef = doc(db, 'schedule_items', `${session.uid}_${item.date}_${item.id}`)

      if (item.relatedPrev?.id && item.relatedPrev?.date) {
        const previousRef = doc(db, 'schedule_items', `${session.uid}_${item.relatedPrev.date}_${item.relatedPrev.id}`)
        const previousSnap = await getDoc(previousRef)
        if (previousSnap.exists() && isSameScheduleRelation(previousSnap.data().relatedNext, toScheduleRelation(item))) {
          await updateDoc(previousRef, { relatedNext: null })
        }
      }

      if (item.relatedNext?.id && item.relatedNext?.date) {
        const nextRef = doc(db, 'schedule_items', `${session.uid}_${item.relatedNext.date}_${item.relatedNext.id}`)
        const nextSnap = await getDoc(nextRef)
        if (nextSnap.exists() && isSameScheduleRelation(nextSnap.data().relatedPrev, toScheduleRelation(item))) {
          await updateDoc(nextRef, { relatedPrev: null })
        }
      }

      await deleteDoc(selectedRef)
      removeScheduleItemLocal(item.date, item.id)
      fetchWeekSchedule()
    } catch (error) {
      console.error('予定削除エラー:', error)
      alert(`予定削除に失敗しました:\n${error.message}`)
    }
  }

  const startLongPress = (item) => {
    if (item.completed) return
    holdTimerRef.current = setTimeout(() => {
      openDetail(item)
    }, 500)
  }

  const clearLongPress = () => {
    if (holdTimerRef.current) {
      clearTimeout(holdTimerRef.current)
      holdTimerRef.current = null
    }
  }

  const handleAddSchedule = () => {
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

  const copyToNextDay = async (item) => {
    if (!session) return

    try {
      const nextDate = addDays(new Date(item.date), 1)
      const nextDateKey = formatDateKey(nextDate)
      const newItemId = `s-${Date.now()}`

      const newItem = {
        id: newItemId,
        user_id: session.uid,
        title: item.title,
        time: item.time,
        endTime: item.endTime,
        details: item.details,
        completed: false,
        priority: item.priority || 'normal',
        date: nextDateKey,
        relatedPrev: null,
        relatedNext: null,
      }

      await setDoc(doc(db, 'schedule_items', `${session.uid}_${nextDateKey}_${newItemId}`), newItem)
      fetchWeekSchedule()
      alert(`${nextDateKey} に予定をコピーしました`)
    } catch (error) {
      console.error('予定コピーエラー:', error)
      alert(`予定コピーに失敗しました:\n${error.message}`)
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

      if (previousSnap.exists() && isSameScheduleRelation(previousSnap.data().relatedNext, toScheduleRelation(selectedItem))) {
        updates.push(updateDoc(previousRef, { relatedNext: null }))
      }

      await Promise.all(updates)
      closeRelationDialog()
      fetchWeekSchedule()
      alert('関連付けを解除しました。')
    } catch (error) {
      console.error('関連付け解除エラー:', error)
      alert(`関連付けの解除に失敗しました:\n${error.message}`)
    }
  }

  const openWeeklyReport = async (reportType) => {
    if (!session) return

    const outputDate = new Date()
    const outputDateKey = formatDateKey(outputDate)
    const reportTitle = reportType === 'all' ? 'スケジュール一覧' : '未完了一覧'

    let reportItems = []
    let periodText = `${formatDateKey(weekDates[0])} ～ ${formatDateKey(weekDates[6])}`

    try {
      if (reportType === 'incomplete') {
        const q = query(collection(db, 'schedule_items'), where('user_id', '==', session.uid))
        const snapshot = await getDocs(q)

        reportItems = []
        snapshot.forEach((docSnap) => {
          const item = docSnap.data()
          if (item.completed === true) return
          const dateKey = item.date
          const dayDate = new Date(`${dateKey}T00:00:00`)
          reportItems.push({
            id: item.id || docSnap.id,
            title: item.title || '予定',
            time: item.time || '09:00',
            endTime: item.endTime || '10:00',
            details: item.details || '',
            completed: item.completed === true,
            priority: item.priority || 'normal',
            dateKey,
            dayName: dayNames[dayDate.getDay()],
            isPast: dateKey < outputDateKey,
          })
        })

        reportItems.sort((a, b) => {
          if (a.dateKey !== b.dateKey) return a.dateKey.localeCompare(b.dateKey)
          return parseTimeValue(a.time || '09:00') - parseTimeValue(b.time || '09:00')
        })
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
      alert(`帳票データの取得に失敗しました:\n${error.message}`)
      return
    }

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

    const reportWindow = window.open('', '_blank', 'width=1000,height=750')
    if (!reportWindow) {
      alert('帳票画面を開けませんでした。ポップアップを許可してください。')
      return
    }

    reportWindow.document.write(`<!doctype html>
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
      </html>`)
    reportWindow.document.close()
    reportWindow.focus()
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
        <div style={styles.appShell}>
          <header style={styles.header}>
            <div style={styles.headerTitleBox}>
              <CalendarDays size={26} color="#2563eb" />
              <h1 style={styles.title}>スケジュール</h1>
            </div>

            <div style={styles.userArea}>
              <span style={styles.userEmail}>{session.email}</span>
              <div style={styles.notificationControls}>
                <button
                  type="button"
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
                  <span>{notificationBusy ? '処理中' : notificationEnabled ? '通知ON' : '通知OFF'}</span>
                  {notificationBadgeCount > 0 && (
                    <span style={styles.notificationCountBadge}>{notificationBadgeCount}</span>
                  )}
                </button>
                <button
                  type="button"
                  style={styles.notificationHelpButton}
                  onClick={() => setNotificationHelpOpen((current) => !current)}
                  aria-expanded={notificationHelpOpen}
                  aria-label="通知の設定方法を表示"
                  title="通知の設定方法"
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
                <span style={styles.notificationNotice}>通知はブラウザ設定でブロックされています。</span>
              )}
              <button type="button" style={styles.logoutButton} onClick={() => signOut(auth)}>
                <LogOut size={16} /> ログアウト
              </button>
            </div>
          </header>

          <div style={styles.reportActions}>
            <button type="button" style={styles.reportButton} onClick={() => openWeeklyReport('all')}>スケジュール一覧PDF</button>
            <button type="button" style={styles.reportButton} onClick={() => openWeeklyReport('incomplete')}>未完了一覧PDF</button>
          </div>

          <main style={styles.main}>
            <section
              style={{ ...styles.weekSection, touchAction: 'pan-y' }}
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
              <div style={styles.weekNav}>
                <button type="button" style={styles.navButton} aria-label="前の週" onClick={selectPreviousWeekSunday}>
                  <ChevronLeft size={18} />
                </button>
                <div style={styles.weekTitle}>{formatMonthTitle(weekDates[0])}</div>
                <button type="button" style={styles.navButton} aria-label="次の週" onClick={selectNextWeekMonday}>
                  <ChevronRight size={18} />
                </button>
              </div>

              <div style={styles.weekGrid}>
                {weekDates.map((date) => {
                  const key = formatDateKey(date)
                  const list = scheduleMap[key] || []
                  const isSelected = key === selectedKey

                  return (
                    <button
                      type="button"
                      key={key}
                      className="week-day-tile"
                      onClick={() => setSelectedDate(date)}
                      style={{
                        ...styles.dayButton,
                        background: isSelected ? '#dbeafe' : '#ffffff',
                        borderColor: isSelected ? '#2563eb' : '#d9e2f2',
                        boxShadow: isSelected ? '0 6px 18px rgba(37,99,235,0.16)' : '0 2px 6px rgba(15,23,42,0.04)',
                      }}
                    >
                      <span className="week-day-label" style={{ ...styles.dayLabel, color: date.getDay() === 0 ? '#dc2626' : date.getDay() === 6 ? '#2563eb' : '#475569' }}>
                        {dayNames[date.getDay()]}
                      </span>
                      <strong className="week-day-number" style={styles.dayNumber}>{date.getDate()}</strong>
                      <span style={styles.dayMeta}>{list.length ? `${list.length}件` : ''}</span>
                    </button>
                  )
                })}
              </div>
            </section>

            <section
              style={{ ...styles.scheduleSection, touchAction: 'pan-y' }}
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
              <div style={styles.selectedHeader}>
                <div>
                  <div style={styles.selectedCaption}>選択中の日</div>
                  <h2 style={styles.selectedDateText}>{formatWeekTitle(selectedDate)}</h2>
                </div>
                <button type="button" style={styles.addButton} onClick={handleAddSchedule}>
                  <Plus size={18} /> 追加
                </button>
              </div>

              {loading ? (
                <div style={styles.loadingState}>読み込み中...</div>
              ) : selectedItems.length === 0 ? (
                <div style={styles.emptyState}>この日の予定はまだありません。追加ボタンから予定を登録できます。</div>
              ) : (
                <div style={styles.scheduleList}>
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

                    return (
                    <div
                      key={item.id}
                      className="schedule-card-mobile"
                      onPointerDown={() => startLongPress(item)}
                      onPointerUp={clearLongPress}
                      onPointerLeave={clearLongPress}
                      onPointerCancel={clearLongPress}
                      onClick={() => {
                        clearLongPress()
                        if (!item.completed) openDetail(item)
                      }}
                      style={{
                        ...styles.scheduleCard,
                        ...(item.relatedPrev ? styles.relatedScheduleCard : {}),
                        ...(item.completed ? (item.relatedPrev ? styles.completedRelatedScheduleCard : styles.completedScheduleCard) : {}),
                      }}
                    >
                      <div style={timeBoxStyle}>
                        <Clock3 size={16} color={hasOverlap ? '#dc2626' : '#2563eb'} />
                        <span>{timeDisplay}</span>
                      </div>

                      <div style={styles.scheduleBody}>
                        <div className="schedule-title-row-mobile" style={styles.scheduleTitleRow}>
                          <div style={styles.scheduleTitleWrap}>
                            <span className="schedule-title-text" style={{ ...styles.scheduleTitle, ...(item.completed ? styles.completedText : {}) }}>{item.title}</span>
                            {item.priority !== 'normal' && (
                              <span style={{ ...styles.priorityBadge, ...(item.priority === 'high' ? styles.highPriorityBadge : styles.lowPriorityBadge) }}>
                                {item.priority === 'high' ? '重要' : '低'}
                              </span>
                            )}
                          </div>
                          <div className="schedule-actions-mobile" style={{ display: 'flex', gap: '8px' }}>
                            <button
                              type="button"
                              style={{ ...styles.completeButton, ...(item.completed ? styles.completedButton : {}) }}
                              aria-label={item.completed ? '完了を取り消す' : '予定を完了にする'}
                              onClick={(event) => {
                                event.stopPropagation()
                                toggleCompleted(item)
                              }}
                              title={item.completed ? '完了を取り消す' : '完了にする'}
                            >
                              <Check size={14} />
                            </button>
                            <button
                              type="button"
                              style={styles.copyButton}
                              aria-label="翌日にコピー"
                              onClick={(event) => {
                                event.stopPropagation()
                                if (!item.completed) copyToNextDay(item)
                              }}
                              title="翌日にコピー"
                              disabled={item.completed}
                            >
                              📋
                            </button>
                            <button
                              type="button"
                              style={styles.weeklyCopyButton}
                              aria-label="未来4週間にコピー"
                              onClick={(event) => {
                                event.stopPropagation()
                                if (!item.completed) copyToFutureFourWeeks(item)
                              }}
                              title="未来4週間にコピー"
                              disabled={item.completed}
                            >
                              ↻
                            </button>
                            <button
                              type="button"
                              style={styles.relationButton}
                              aria-label="前の予定と関連付け"
                              onClick={(event) => {
                                event.stopPropagation()
                                if (!item.completed) openRelationDialog(item)
                              }}
                              title="前の予定と関連付け"
                              disabled={item.completed}
                            >
                              <Link2 size={14} />
                            </button>
                            <button
                              type="button"
                              style={styles.deleteButton}
                              aria-label="予定を削除"
                              onClick={(event) => {
                                event.stopPropagation()
                                deleteScheduleItem(item)
                              }}
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>
                        </div>

                        <div style={styles.scheduleDetailText}>
                          {item.details ? item.details : '詳細なし'}
                        </div>
                        {item.relatedPrev && (
                          <div style={styles.relationInfoText}>
                            関連: {item.relatedPrev.date} {item.relatedPrev.time}-{item.relatedPrev.endTime} {item.relatedPrev.title}
                          </div>
                        )}
                      </div>
                    </div>
                    )})}
                </div>
              )}
            </section>
          </main>

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
                  value={detailDraft.title}
                  onChange={(e) => setDetailDraft({ ...detailDraft, title: e.target.value })}
                  style={styles.modalInput}
                />

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
                <input
                  type="time"
                  value={detailDraft.time}
                  onChange={(e) => setDetailDraft({ ...detailDraft, time: e.target.value })}
                  style={styles.modalInput}
                />

                <label style={styles.fieldLabel}>終了時間</label>
                <input
                  type="time"
                  value={detailDraft.endTime}
                  onChange={(e) => setDetailDraft({ ...detailDraft, endTime: e.target.value })}
                  style={styles.modalInput}
                />

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
                  <button type="button" style={styles.secondaryButton} onClick={closeDetail}>キャンセル</button>
                  <button type="button" style={styles.primaryButton} onClick={saveDetailDraft}>保存</button>
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
    padding: '12px 16px',
    fontSize: '15px',
    fontWeight: 700,
    cursor: 'pointer',
  },
  secondaryButton: {
    background: '#eef2ff',
    border: '1px solid #c7d2fe',
    borderRadius: '10px',
    color: '#1e3a8a',
    padding: '11px 16px',
    fontSize: '14px',
    fontWeight: 600,
    cursor: 'pointer',
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
    padding: '24px 16px 40px',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '16px',
    marginBottom: '20px',
    paddingBottom: '14px',
    borderBottom: '1px solid #dfeaf7',
  },
  reportActions: {
    display: 'flex',
    justifyContent: 'flex-end',
    flexWrap: 'wrap',
    gap: '8px',
    marginBottom: '14px',
  },
  reportButton: {
    border: '1px solid #bfdbfe',
    borderRadius: '8px',
    background: '#eff6ff',
    color: '#1d4ed8',
    padding: '8px 10px',
    fontSize: '12px',
    fontWeight: 700,
    cursor: 'pointer',
  },
  headerTitleBox: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
  },
  title: {
    margin: 0,
    fontSize: '28px',
    color: '#0f172a',
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
  logoutButton: {
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
  notificationButton: {
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
    position: 'absolute',
    top: 'calc(100% + 8px)',
    right: '0',
    width: '280px',
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
    gap: '18px',
  },
  weekSection: {
    background: '#ffffff',
    border: '1px solid #e8eef7',
    borderRadius: '18px',
    padding: '16px',
    boxShadow: '0 12px 26px rgba(15, 23, 42, 0.04)',
  },
  weekNav: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: '14px',
  },
  navButton: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '38px',
    height: '38px',
    borderRadius: '12px',
    border: '1px solid #dfeaf7',
    background: '#f8fbff',
    color: '#0f172a',
    cursor: 'pointer',
  },
  weekTitle: {
    fontSize: '16px',
    fontWeight: 700,
    color: '#1e293b',
  },
  weekGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(7, minmax(0, 1fr))',
    gap: '8px',
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
  scheduleSection: {
    background: '#ffffff',
    border: '1px solid #e8eef7',
    borderRadius: '18px',
    padding: '16px',
    boxShadow: '0 12px 26px rgba(15, 23, 42, 0.04)',
  },
  selectedHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '16px',
    marginBottom: '16px',
  },
  selectedCaption: {
    fontSize: '12px',
    color: '#64748b',
    marginBottom: '2px',
  },
  selectedDateText: {
    margin: 0,
    fontSize: '26px',
    color: '#0f172a',
  },
  addButton: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    background: '#2563eb',
    color: '#fff',
    border: 'none',
    borderRadius: '10px',
    padding: '10px 14px',
    fontWeight: 700,
    cursor: 'pointer',
  },
  loadingState: {
    padding: '28px 12px',
    textAlign: 'center',
    color: '#475569',
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
    gap: '14px',
  },
  scheduleCard: {
    display: 'flex',
    gap: '12px',
    alignItems: 'flex-start',
    background: '#f8fbff',
    border: '1px solid #dfeaf7',
    borderRadius: '14px',
    padding: '12px 14px',
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
    marginBottom: '8px',
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
    width: '30px',
    height: '30px',
    borderRadius: '8px',
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
    borderRadius: '8px',
    cursor: 'pointer',
    padding: '8px 10px',
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
    padding: '11px 16px',
    fontSize: '14px',
    fontWeight: 600,
    cursor: 'pointer',
  },
}

export default App