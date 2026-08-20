import React, { useEffect, useMemo, useRef, useState } from 'react'
import { auth, db } from './firebase'
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
  getDocs,
  query,
  setDoc,
  where,
} from 'firebase/firestore'
import { CalendarDays, Check, ChevronLeft, ChevronRight, Clock3, LogOut, PencilLine, Plus, Trash2 } from 'lucide-react'

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

const escapeHtml = (value = '') => String(value)
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#039;')

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
  const holdTimerRef = useRef(null)
  const weekSwipeRef = useRef(null)
  const weekTouchRef = useRef(null)

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setSession(user)
    })
    return () => unsubscribe()
  }, [])

  const weekDates = useMemo(() => {
    const start = getWeekStart(selectedDate)
    return Array.from({ length: 7 }, (_, index) => addDays(start, index))
  }, [selectedDate])

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

      // user_id のみで検索して、日付フィルタリングはクライアント側で行う
      const q = query(
        collection(db, 'schedule_items'),
        where('user_id', '==', session.uid)
      )

      const snapshot = await getDocs(q)
      const nextMap = {}

      snapshot.forEach((docSnap) => {
        const item = docSnap.data()
        const dateKey = item.date

        // クライアント側で日付範囲をフィルタリング
        if (dateKey >= startKey && dateKey <= endKey) {
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
          })
        }
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

  useEffect(() => {
    if (session) {
      fetchWeekSchedule()
    }
  }, [session, selectedDate])

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
      }

      await setDoc(doc(db, 'schedule_items', `${session.uid}_${item.date}_${itemId}`), item)
      setDetailDraft(null)
      await fetchWeekSchedule()
    } catch (error) {
      console.error('予定保存エラー:', error)
      alert(`予定保存に失敗しました:\n${error.message}`)
    }
  }

  const deleteScheduleItem = async (item) => {
    if (!session) return
    if (!window.confirm(`「${item.title}」を削除しますか？`)) return

    try {
      await deleteDoc(doc(db, 'schedule_items', `${session.uid}_${item.date}_${item.id}`))
      await fetchWeekSchedule()
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
    })
  }

  const toggleCompleted = async (item) => {
    if (!session) return

    try {
      const nextItem = { ...item, completed: !item.completed, user_id: session.uid }
      await setDoc(doc(db, 'schedule_items', `${session.uid}_${item.date}_${item.id}`), nextItem)
      await fetchWeekSchedule()
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
      }

      await setDoc(doc(db, 'schedule_items', `${session.uid}_${nextDateKey}_${newItemId}`), newItem)
      await fetchWeekSchedule()
      alert(`${nextDateKey} に予定をコピーしました`)
    } catch (error) {
      console.error('予定コピーエラー:', error)
      alert(`予定コピーに失敗しました:\n${error.message}`)
    }
  }

  const copyToSameWeekdaysInMonth = async (item) => {
    if (!session) return

    const sourceDate = new Date(`${item.date}T00:00:00`)
    const year = sourceDate.getFullYear()
    const month = sourceDate.getMonth()
    const lastDay = new Date(year, month + 1, 0).getDate()
    const targetDates = []

    for (let day = 1; day <= lastDay; day += 1) {
      const targetDate = new Date(year, month, day)
      if (targetDate.getDay() === sourceDate.getDay() && formatDateKey(targetDate) !== item.date) {
        targetDates.push(formatDateKey(targetDate))
      }
    }

    if (targetDates.length === 0) {
      alert('同じ月にコピー先がありません')
      return
    }

    if (!window.confirm(`${targetDates.length}件の同じ曜日に「${item.title}」をコピーしますか？`)) return

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
        }

        return setDoc(doc(db, 'schedule_items', `${session.uid}_${targetDateKey}_${newItemId}`), newItem)
      }))
      await fetchWeekSchedule()
      alert(`${targetDates.length}件の同じ曜日に予定をコピーしました`)
    } catch (error) {
      console.error('毎週コピーエラー:', error)
      alert(`毎週コピーに失敗しました:\n${error.message}`)
    }
  }

  const openWeeklyReport = (reportType) => {
    const reportItems = weekDates.flatMap((date) => {
      const dateKey = formatDateKey(date)
      return (scheduleMap[dateKey] || [])
        .filter((item) => reportType === 'all' || !item.completed)
        .map((item) => ({ ...item, dateKey, dayName: dayNames[date.getDay()] }))
    })

    const reportTitle = reportType === 'all' ? 'スケジュール一覧' : '未完了一覧'
    const rows = reportItems.length
      ? reportItems.map((item) => `
          <tr>
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
            .period { color: #64748b; margin-bottom: 18px; font-size: 13px; }
            table { width: 100%; border-collapse: collapse; table-layout: fixed; font-size: 11px; }
            th, td { border: 1px solid #cbd5e1; padding: 7px 8px; text-align: left; vertical-align: top; overflow-wrap: anywhere; }
            th { background: #e8f0ff; color: #1e3a8a; }
            th:nth-child(1) { width: 15%; } th:nth-child(2) { width: 15%; } th:nth-child(3) { width: 17%; }
            th:nth-child(4) { width: 9%; } th:nth-child(6) { width: 9%; }
            .empty { text-align: center; color: #64748b; padding: 24px; }
            .actions { display: flex; justify-content: flex-end; margin-bottom: 12px; }
            button { border: 0; border-radius: 6px; background: #2563eb; color: white; padding: 8px 14px; cursor: pointer; }
            @media print { .actions { display: none; } }
          </style>
        </head>
        <body>
          <div class="actions"><button onclick="window.print()">PDFとして保存 / 印刷</button></div>
          <h1>${escapeHtml(reportTitle)}</h1>
          <div class="period">対象期間: ${escapeHtml(formatDateKey(weekDates[0]))} ～ ${escapeHtml(formatDateKey(weekDates[6]))}</div>
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
                <button type="button" style={styles.navButton} aria-label="前の週" onClick={() => changeWeek(-7)}>
                  <ChevronLeft size={18} />
                </button>
                <div style={styles.weekTitle}>{formatMonthTitle(weekDates[0])}</div>
                <button type="button" style={styles.navButton} aria-label="次の週" onClick={() => changeWeek(7)}>
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
                      onClick={() => setSelectedDate(date)}
                      style={{
                        ...styles.dayButton,
                        background: isSelected ? '#dbeafe' : '#ffffff',
                        borderColor: isSelected ? '#2563eb' : '#d9e2f2',
                        boxShadow: isSelected ? '0 6px 18px rgba(37,99,235,0.16)' : '0 2px 6px rgba(15,23,42,0.04)',
                      }}
                    >
                      <span style={{ ...styles.dayLabel, color: date.getDay() === 0 ? '#dc2626' : date.getDay() === 6 ? '#2563eb' : '#475569' }}>
                        {dayNames[date.getDay()]}
                      </span>
                      <strong style={styles.dayNumber}>{date.getDate()}</strong>
                      <span style={styles.dayMeta}>{list.length ? `${list.length}件` : ''}</span>
                    </button>
                  )
                })}
              </div>
            </section>

            <section style={styles.scheduleSection}>
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
                      style={{ ...styles.scheduleCard, ...(item.completed ? styles.completedScheduleCard : {}) }}
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
                              aria-label="同じ月の同じ曜日にコピー"
                              onClick={(event) => {
                                event.stopPropagation()
                                if (!item.completed) copyToSameWeekdaysInMonth(item)
                              }}
                              title="同じ月の同じ曜日にコピー"
                              disabled={item.completed}
                            >
                              ↻
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
                      </div>
                    </div>
                    )})}
                </div>
              )}
            </section>
          </main>

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
  scheduleDetailText: {
    fontSize: '12px',
    color: '#475569',
    whiteSpace: 'pre-wrap',
    lineHeight: 1.6,
    wordBreak: 'break-word',
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
}

export default App