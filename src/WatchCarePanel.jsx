import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Eye, Shield, UserRound } from 'lucide-react'
import {
  WATCH_COMMENT_MAX_LENGTH,
  WATCH_EVENT_CONDITION,
  WATCH_ROLE_REQUESTER,
  WATCH_ROLE_WATCHER,
  WATCH_STATUS_ACTIVE,
  WATCH_STATUS_PENDING_APPROVAL,
  WATCH_STATUS_PENDING_TERMS,
  WATCH_TERMS_TEXT,
  agreeWatchTerms,
  approveWatchRequest,
  buildMatchCommentSummaries,
  cancelWatchRequest,
  createWatchRequest,
  endWatchMatch,
  expireStaleMatches,
  getWatchEventLabel,
  getWatchRoleLabel,
  getWatchStatusLabel,
  listMatchesForRequester,
  listMatchesForWatcher,
  loadWatchProfile,
  markWatchMatchCommentsRead,
  normalizeWatchEmail,
  postWatchComment,
  rejectWatchRequest,
  saveWatchProfile,
  sortMatchesByCommentAttention,
  subscribeWatchCommentsForMatch,
  subscribeWatchCommentsForWatcher,
  subscribeWatchEventsForMatch,
} from './watchCare'
import {
  openReportWindowSync,
  openWatchConditionMonthReport,
  preferInAppConditionReport,
} from './watchConditionReport'

const sectionBox = {
  border: '1px solid #e2e8f0',
  borderRadius: 12,
  padding: 12,
  background: '#f8fafc',
  marginBottom: 12,
}

const recordsSectionBox = {
  ...sectionBox,
  background: '#eef6ff',
  border: '1px solid #93c5fd',
}

const commentsSectionBox = {
  ...sectionBox,
  background: '#eefaf3',
  border: '1px solid #86efac',
}

const sectionTitle = {
  margin: '0 0 8px',
  fontSize: 15,
  fontWeight: 700,
  color: '#0f172a',
}

const unreadBadge = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  minWidth: 22,
  height: 22,
  padding: '0 7px',
  borderRadius: 999,
  background: '#dc2626',
  color: '#fff',
  fontSize: 12,
  fontWeight: 800,
  lineHeight: 1,
}

const lastCommentLine = {
  margin: '0 0 8px',
  padding: '6px 8px',
  borderRadius: 8,
  background: '#fff7ed',
  border: '1px solid #fdba74',
  color: '#9a3412',
  fontSize: 12,
  lineHeight: 1.45,
}

const muted = { margin: '0 0 8px', color: '#64748b', fontSize: 13, lineHeight: 1.5 }

const listItem = {
  border: '1px solid #e2e8f0',
  borderRadius: 10,
  padding: 10,
  background: '#fff',
  marginBottom: 8,
}

const EVENT_KIND_STYLE = {
  bedtime: { borderLeft: '4px solid #6366f1', labelColor: '#3730a3' },
  wake: { borderLeft: '4px solid #f59e0b', labelColor: '#92400e' },
  medication: { borderLeft: '4px solid #14b8a6', labelColor: '#115e59' },
  condition: { borderLeft: '4px solid #f43f5e', labelColor: '#9f1239' },
}

const formatMaybeTime = (dateKey, timeKey) => {
  if (!dateKey && !timeKey) return '—'
  return `${dateKey || ''} ${timeKey || ''}`.trim()
}

const renderWatchEventItem = (event) => {
  const kindStyle = EVENT_KIND_STYLE[event.kind] || {
    borderLeft: '4px solid #94a3b8',
    labelColor: '#334155',
  }
  return (
    <div
      key={event.id}
      style={{
        ...listItem,
        marginBottom: 6,
        padding: '8px 10px',
        background: '#fff',
        border: '1px solid #dbeafe',
        borderLeft: kindStyle.borderLeft,
      }}
    >
      <strong style={{ color: kindStyle.labelColor }}>
        {getWatchEventLabel(event.kind, event.slotLabel)}
      </strong>
      <span style={{ marginLeft: 8, color: '#475569', fontSize: 13 }}>
        {formatMaybeTime(event.dateKey, event.timeKey)}
      </span>
      {event.kind === WATCH_EVENT_CONDITION && event.conditionNote ? (
        <div style={{ marginTop: 4, fontSize: 13, color: '#334155', whiteSpace: 'pre-wrap' }}>
          {event.conditionNote}
        </div>
      ) : null}
    </div>
  )
}

const buildEndWatchNotice = (partnerLabel) => (
  [
    `${partnerLabel}との見守りを終了しようとしています。`,
    '',
    '■ 注意',
    '・「終了する」を押すと、相手の承認なしでただちに終了します。',
    '・終了後は記録の参照・コメント・通知ができなくなります。',
    '・再開するには、最初から見守り依頼が必要です。',
    '',
    '■ キャンセル',
    '・「キャンセル」を選ぶと終了しません。',
    '・見守り関係はそのまま続きます。',
    '',
    'それでも終了する場合だけ「終了する」を押してください。',
  ].join('\n')
)

const recordsScrollBox = {
  maxHeight: 168,
  overflowY: 'auto',
  paddingRight: 4,
  marginTop: 4,
}

const resolveCommentRole = (comment, match) => {
  if (!match) return ''
  if (comment.fromUid === match.watcherUid) return WATCH_ROLE_WATCHER
  if (comment.fromUid === match.requesterUid) return WATCH_ROLE_REQUESTER
  return ''
}

export default function WatchCarePanel({
  open,
  mode,
  session,
  contractEmail,
  styles,
  onClose,
  onProfileChanged,
}) {
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [profile, setProfile] = useState(null)
  const [nameDraft, setNameDraft] = useState('')
  const [roleDraft, setRoleDraft] = useState(WATCH_ROLE_REQUESTER)
  const [matches, setMatches] = useState([])
  const [inviteEmail, setInviteEmail] = useState('')
  const [selectedMatchId, setSelectedMatchId] = useState('')
  const [events, setEvents] = useState([])
  const [comments, setComments] = useState([])
  const [commentDraft, setCommentDraft] = useState('')
  const [termsOpenMatchId, setTermsOpenMatchId] = useState('')
  const [endConfirm, setEndConfirm] = useState(null)
  const [watcherInboxComments, setWatcherInboxComments] = useState([])
  const [conditionMonthKey, setConditionMonthKey] = useState(() => {
    const now = new Date()
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  })
  const [conditionReportBusy, setConditionReportBusy] = useState(false)
  const [conditionReportHtml, setConditionReportHtml] = useState('')
  const conditionReportFrameRef = useRef(null)
  const commentsScrollRef = useRef(null)
  const commentsEndRef = useRef(null)
  const detailSectionRef = useRef(null)

  const selectedMatch = useMemo(
    () => matches.find((match) => match.id === selectedMatchId) || null,
    [matches, selectedMatchId]
  )

  const commentSummaries = useMemo(
    () => buildMatchCommentSummaries(matches, watcherInboxComments, session?.uid),
    [matches, watcherInboxComments, session?.uid]
  )

  const displayedMatches = useMemo(() => {
    if (profile?.role !== WATCH_ROLE_WATCHER) return matches
    return sortMatchesByCommentAttention(matches, commentSummaries)
  }, [matches, commentSummaries, profile?.role])

  const totalUnread = useMemo(
    () => Object.values(commentSummaries).reduce((sum, row) => sum + (row.unreadCount || 0), 0),
    [commentSummaries]
  )

  const openMatchDetail = useCallback((matchId) => {
    if (!matchId || !session?.uid) return
    setSelectedMatchId(matchId)
    const match = matches.find((item) => item.id === matchId)
    if (match?.status === WATCH_STATUS_ACTIVE) {
      markWatchMatchCommentsRead({ match, viewerUid: session.uid })
        .then(() => {
          const readAt = new Date()
          setMatches((current) => current.map((item) => (
            item.id === matchId
              ? {
                ...item,
                ...(session.uid === item.watcherUid
                  ? { watcherLastReadAt: readAt }
                  : { requesterLastReadAt: readAt }),
              }
              : item
          )))
        })
        .catch((err) => {
          console.warn('見守りコメント既読の更新に失敗:', err)
        })
    }
    window.setTimeout(() => {
      detailSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }, 80)
  }, [matches, session?.uid])

  const printConditionReport = async (reportWindow = null) => {
    if (!selectedMatch || selectedMatch.status !== WATCH_STATUS_ACTIVE) {
      setError('マッチング中の依頼人を選択してください。')
      if (reportWindow && !reportWindow.closed) reportWindow.close()
      return
    }
    if (!conditionMonthKey) {
      setError('対象月を選択してください。')
      if (reportWindow && !reportWindow.closed) reportWindow.close()
      return
    }
    setConditionReportBusy(true)
    setError('')
    setMessage('')
    try {
      const result = await openWatchConditionMonthReport({
        requesterUid: selectedMatch.requesterUid,
        requesterName: selectedMatch.requesterName || selectedMatch.requesterEmail || '依頼人',
        monthKey: conditionMonthKey,
        reportWindow,
      })
      if (result?.mode === 'html' && result.html) {
        setConditionReportHtml(result.html)
        setMessage('体調グラフを画面内に表示しました。「印刷する」から印刷できます。')
      } else {
        setMessage(`${selectedMatch.requesterName || '依頼人'}さんの ${conditionMonthKey} 体調グラフを開きました。`)
      }
    } catch (err) {
      if (reportWindow && !reportWindow.closed) {
        try { reportWindow.close() } catch { /* ignore */ }
      }
      setError(err?.message || '体調グラフの作成に失敗しました。')
    } finally {
      setConditionReportBusy(false)
    }
  }

  const refresh = useCallback(async () => {
    if (!session?.uid) return
    setError('')
    const nextProfile = await loadWatchProfile(session.uid)
    setProfile(nextProfile)
    if (nextProfile) {
      setNameDraft(nextProfile.name || '')
      setRoleDraft(nextProfile.role || WATCH_ROLE_REQUESTER)
    } else {
      setNameDraft('')
      setRoleDraft(WATCH_ROLE_REQUESTER)
    }

    let nextMatches = []
    if (nextProfile?.role === WATCH_ROLE_WATCHER) {
      nextMatches = await listMatchesForWatcher(session.uid)
    } else if (nextProfile?.role === WATCH_ROLE_REQUESTER) {
      nextMatches = await listMatchesForRequester(session.uid)
    }
    const expiredIds = await expireStaleMatches(nextMatches)
    if (expiredIds.length) {
      nextMatches = nextMatches.map((match) => (
        expiredIds.includes(match.id)
          ? { ...match, status: 'expired' }
          : match
      ))
    }
    setMatches(nextMatches)

    const preferred = nextMatches.find((match) => match.status === WATCH_STATUS_ACTIVE)
      || nextMatches.find((match) => (
        match.status === WATCH_STATUS_PENDING_APPROVAL
        || match.status === WATCH_STATUS_PENDING_TERMS
      ))
      || nextMatches[0]
      || null

    setSelectedMatchId((current) => {
      if (current && nextMatches.some((match) => match.id === current)) return current
      return preferred?.id || ''
    })

    onProfileChanged?.(nextProfile)
  }, [session?.uid, onProfileChanged])

  useEffect(() => {
    if (!open || !session?.uid) return undefined
    let cancelled = false
    ;(async () => {
      setBusy(true)
      setMessage('')
      setError('')
      try {
        if (!cancelled) await refresh()
      } catch (err) {
        if (!cancelled) setError(err?.message || '見守りの読み込みに失敗しました。')
      } finally {
        if (!cancelled) setBusy(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [open, session?.uid, mode, refresh])

  useEffect(() => {
    if (!open || !session?.uid || profile?.role !== WATCH_ROLE_WATCHER) {
      setWatcherInboxComments([])
      return undefined
    }
    return subscribeWatchCommentsForWatcher(
      session.uid,
      (nextComments) => setWatcherInboxComments(nextComments),
      (err) => console.warn('見守りコメント一覧の購読に失敗:', err)
    )
  }, [open, session?.uid, profile?.role])

  useEffect(() => {
    if (!open || !selectedMatchId || !session?.uid) {
      setEvents([])
      setComments([])
      return undefined
    }
    const match = matches.find((item) => item.id === selectedMatchId)
    if (!match || match.status !== WATCH_STATUS_ACTIVE) {
      setEvents([])
      setComments([])
      return undefined
    }

    const unsubEvents = subscribeWatchEventsForMatch(
      match,
      session.uid,
      (nextEvents) => setEvents(nextEvents),
      (err) => setError(err?.message || '記録の購読に失敗しました。')
    )
    const unsubComments = subscribeWatchCommentsForMatch(
      match,
      session.uid,
      (nextComments) => setComments(nextComments),
      (err) => setError(err?.message || 'コメントの購読に失敗しました。')
    )

    return () => {
      unsubEvents()
      unsubComments()
    }
  }, [open, selectedMatchId, matches, session?.uid])

  useEffect(() => {
    if (!open || !selectedMatch || selectedMatch.status !== WATCH_STATUS_ACTIVE) return
    const frame = window.requestAnimationFrame(() => {
      if (commentsScrollRef.current) {
        commentsScrollRef.current.scrollTop = commentsScrollRef.current.scrollHeight
      }
    })
    return () => window.cancelAnimationFrame(frame)
  }, [comments, open, selectedMatchId, selectedMatch])

  const runAction = async (action, successMessage) => {
    setBusy(true)
    setError('')
    setMessage('')
    try {
      await action()
      await refresh()
      if (successMessage) setMessage(successMessage)
    } catch (err) {
      setError(err?.message || '処理に失敗しました。')
    } finally {
      setBusy(false)
    }
  }

  const renderCommentsSection = () => (
    <div style={commentsSectionBox}>
      <h4 style={sectionTitle}>💬 コメント（リアルタイム）</h4>
      <p style={{ ...muted, marginBottom: 10 }}>
        右＝自分 ／ 緑＝見守り人 ／ 白＝見守り依頼人
      </p>
      <div
        ref={commentsScrollRef}
        style={{
          maxHeight: 260,
          overflowY: 'auto',
          marginBottom: 8,
          padding: '10px 8px',
          borderRadius: 10,
          background: '#c8e6c9',
          border: '1px solid #86efac',
        }}
      >
        {comments.length === 0 && (
          <p style={{ ...muted, textAlign: 'center', margin: '12px 0' }}>コメントはまだありません。</p>
        )}
        {comments.map((comment) => {
          const isMine = comment.fromUid === session?.uid
          const role = resolveCommentRole(comment, selectedMatch)
          const isWatcher = role === WATCH_ROLE_WATCHER
          const roleLabel = isWatcher ? '見守り人' : role === WATCH_ROLE_REQUESTER ? '見守り依頼人' : 'メンバー'
          const bubbleBg = isWatcher ? '#dcf8c6' : '#ffffff'
          const bubbleBorder = isWatcher ? '#86efac' : '#e2e8f0'
          return (
            <div
              key={comment.id}
              style={{
                display: 'flex',
                justifyContent: isMine ? 'flex-end' : 'flex-start',
                marginBottom: 10,
              }}
            >
              <div style={{ maxWidth: '82%' }}>
                <div style={{
                  fontSize: 11,
                  color: isWatcher ? '#166534' : '#475569',
                  fontWeight: 700,
                  marginBottom: 3,
                  textAlign: isMine ? 'right' : 'left',
                }}
                >
                  {isWatcher ? '🛡️ ' : '👤 '}
                  {roleLabel}
                  {comment.fromName ? ` · ${comment.fromName}` : ''}
                  {isMine ? '（自分）' : ''}
                </div>
                <div style={{
                  background: bubbleBg,
                  border: `1px solid ${bubbleBorder}`,
                  borderRadius: isMine ? '14px 4px 14px 14px' : '4px 14px 14px 14px',
                  padding: '8px 11px',
                  fontSize: 14,
                  lineHeight: 1.45,
                  color: '#0f172a',
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                  boxShadow: '0 1px 2px rgba(15, 23, 42, 0.08)',
                }}
                >
                  {comment.body}
                </div>
              </div>
            </div>
          )
        })}
        <div ref={commentsEndRef} />
      </div>
      <textarea
        value={commentDraft}
        onChange={(event) => setCommentDraft(event.target.value.slice(0, WATCH_COMMENT_MAX_LENGTH))}
        rows={3}
        style={{ ...styles.modalInput, resize: 'vertical', background: '#fff' }}
        placeholder="コメント（マッチング中のみ）"
        disabled={busy}
      />
      <button
        type="button"
        style={{ ...styles.primaryButton, marginTop: 8 }}
        disabled={busy || !selectedMatch}
        onClick={() => runAction(async () => {
          await postWatchComment({
            match: selectedMatch,
            fromUid: session.uid,
            fromName: profile?.name || '',
            body: commentDraft,
          })
          setCommentDraft('')
        }, 'コメントを送信しました。')}
      >
        送信
      </button>
    </div>
  )

  if (!open) return null

  const title = mode === 'setup'
    ? '見守り初期設定'
    : mode === 'watcher'
      ? '見守り人処理'
      : '見守り依頼人処理'

  const TitleIcon = mode === 'setup' ? UserRound : mode === 'watcher' ? Shield : Eye

  return (
    <div style={styles.modalOverlay} onClick={onClose}>
      <div
        className="schedule-modal"
        style={{ ...styles.modal, maxWidth: 560 }}
        onClick={(event) => event.stopPropagation()}
      >
        <div style={styles.modalHeader}>
          <div style={styles.modalTitleWrap}>
            <TitleIcon size={20} color="#2563eb" />
            <h3 style={styles.modalTitle}>{title}</h3>
          </div>
          <button type="button" style={styles.closeButton} onClick={onClose}>閉じる</button>
        </div>

        {message && <p style={{ ...muted, color: '#0f766e' }}>{message}</p>}
        {error && <p style={{ ...muted, color: '#b91c1c' }}>{error}</p>}

        {mode === 'setup' && (
          <div style={sectionBox}>
            <label style={styles.fieldLabel}>名前</label>
            <input
              type="text"
              value={nameDraft}
              onChange={(event) => setNameDraft(event.target.value)}
              style={styles.modalInput}
              maxLength={40}
              placeholder="表示名（見守り相手に表示されます）"
              disabled={busy}
            />
            <label style={styles.fieldLabel}>契約メールアドレス</label>
            <input
              type="email"
              value={contractEmail || ''}
              style={{ ...styles.modalInput, background: '#f1f5f9' }}
              readOnly
              disabled
            />
            <p style={muted}>契約メールは表示のみです。変更はできません。</p>
            <label style={styles.fieldLabel}>役割</label>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 12 }}>
              <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 14 }}>
                <input
                  type="radio"
                  name="watch-role"
                  checked={roleDraft === WATCH_ROLE_WATCHER}
                  onChange={() => setRoleDraft(WATCH_ROLE_WATCHER)}
                  disabled={busy}
                />
                見守り人（複数の依頼人を見守る）
              </label>
              <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 14 }}>
                <input
                  type="radio"
                  name="watch-role"
                  checked={roleDraft === WATCH_ROLE_REQUESTER}
                  onChange={() => setRoleDraft(WATCH_ROLE_REQUESTER)}
                  disabled={busy}
                />
                見守り依頼人（見守り人は1人まで）
              </label>
            </div>
            <p style={muted}>
              役割は一方のみです。手続き中・マッチング中の関係があるあいだは変更できません。
            </p>
            <button
              type="button"
              style={styles.primaryButton}
              disabled={busy}
              onClick={() => runAction(
                () => saveWatchProfile({
                  uid: session.uid,
                  name: nameDraft,
                  email: contractEmail,
                  role: roleDraft,
                }),
                `初期設定を保存しました（${getWatchRoleLabel(roleDraft)}）。`
              )}
            >
              保存する
            </button>
          </div>
        )}

        {mode === 'watcher' && (
          <>
            <div style={sectionBox}>
              <p style={muted}>
                {profile
                  ? `${profile.name || '（無名）'} ／ ${profile.email || ''}`
                  : '初期設定が見つかりません。先に初期設定を行ってください。'}
              </p>
              <p style={muted}>承認待ちの依頼を処理し、マッチング中の依頼人の記録を確認できます。</p>
            </div>

            <div style={sectionBox}>
              <h4 style={{ margin: '0 0 8px', fontSize: 15 }}>
                依頼一覧
                {totalUnread > 0 ? (
                  <span style={{ ...unreadBadge, marginLeft: 8, verticalAlign: 'middle' }}>
                    未読 {totalUnread}
                  </span>
                ) : null}
              </h4>
              <p style={muted}>未読がある依頼人を上に表示します。青い枠が現在選択中の依頼人です。</p>
              {displayedMatches.length === 0 && <p style={muted}>依頼はまだありません。</p>}
              {displayedMatches.map((match) => {
                const summary = commentSummaries[match.id] || {}
                const unreadCount = summary.unreadCount || 0
                const isSelected = match.id === selectedMatchId
                return (
                  <div
                    key={match.id}
                    style={{
                      ...listItem,
                      ...(unreadCount > 0 && !isSelected
                        ? { borderColor: '#fca5a5', background: '#fff1f2' }
                        : {}),
                      ...(isSelected
                        ? {
                          borderColor: '#2563eb',
                          background: '#eff6ff',
                          boxShadow: 'inset 4px 0 0 #2563eb',
                        }
                        : {}),
                    }}
                    aria-current={isSelected ? 'true' : undefined}
                  >
                    <div style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: 8,
                      marginBottom: 4,
                    }}
                    >
                      <div style={{ fontWeight: 700, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                        {match.requesterName || match.requesterEmail || '依頼人'}
                        {isSelected ? (
                          <span style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            padding: '2px 8px',
                            borderRadius: 999,
                            background: '#2563eb',
                            color: '#fff',
                            fontSize: 11,
                            fontWeight: 800,
                          }}
                          >
                            選択中
                          </span>
                        ) : null}
                      </div>
                      {unreadCount > 0 ? (
                        <span style={unreadBadge}>未読 {unreadCount}</span>
                      ) : null}
                    </div>
                    <div style={{ fontSize: 13, color: '#475569', marginBottom: 6 }}>
                      {match.requesterEmail} ／ {getWatchStatusLabel(match.status)}
                    </div>
                    {summary.lastBody ? (
                      <p style={{
                        ...lastCommentLine,
                        ...(unreadCount > 0 ? {} : { background: '#f8fafc', borderColor: '#e2e8f0', color: '#64748b' }),
                      }}
                      >
                        💬 {summary.lastFromName ? `${summary.lastFromName}: ` : ''}
                        {summary.lastBody}
                        {String(summary.lastBody).length >= 36 ? '…' : ''}
                      </p>
                    ) : (
                      <p style={{ ...muted, marginBottom: 8 }}>まだコメントはありません。</p>
                    )}
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                      <button
                        type="button"
                        style={{
                          ...styles.secondaryButton,
                          ...(isSelected
                            ? { borderColor: '#2563eb', color: '#1d4ed8', background: '#dbeafe', fontWeight: 700 }
                            : {}),
                        }}
                        disabled={busy}
                        onClick={() => openMatchDetail(match.id)}
                      >
                        {isSelected ? '選択中' : (unreadCount > 0 ? '未読を確認' : '選択')}
                      </button>
                      {match.status === WATCH_STATUS_PENDING_APPROVAL && (
                        <>
                          <button
                            type="button"
                            style={styles.primaryButton}
                            disabled={busy}
                            onClick={() => runAction(
                              () => approveWatchRequest({ matchId: match.id, watcherUid: session.uid }),
                              '依頼を承認しました。相手の利用注意事項同意待ちです。'
                            )}
                          >
                            承認
                          </button>
                          <button
                            type="button"
                            style={{ ...styles.secondaryButton, color: '#b91c1c' }}
                            disabled={busy}
                            onClick={() => {
                              if (!window.confirm('この依頼を却下しますか？')) return
                              runAction(
                                () => rejectWatchRequest({ matchId: match.id, watcherUid: session.uid }),
                                '依頼を却下しました。'
                              )
                            }}
                          >
                            却下
                          </button>
                        </>
                      )}
                      {match.status === WATCH_STATUS_ACTIVE && (
                        <button
                          type="button"
                          style={{ ...styles.secondaryButton, color: '#b91c1c' }}
                          disabled={busy}
                          onClick={() => {
                            setEndConfirm({
                              matchId: match.id,
                              partnerLabel: match.requesterName || '依頼人',
                            })
                          }}
                        >
                          見守り終了
                        </button>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>

            {selectedMatch?.status === WATCH_STATUS_ACTIVE && (
              <div ref={detailSectionRef}>
                <div style={sectionBox}>
                  <h4 style={sectionTitle}>📈 体調グラフ印刷（一人ずつ）</h4>
                  <p style={muted}>
                    対象: {selectedMatch.requesterName || selectedMatch.requesterEmail || '依頼人'}
                    （5段階: 1大変悪い〜5大変良い／普通=3の点線）
                  </p>
                  <label style={styles.fieldLabel}>対象月</label>
                  <input
                    type="month"
                    value={conditionMonthKey}
                    onChange={(event) => setConditionMonthKey(event.target.value)}
                    style={styles.modalInput}
                    disabled={busy || conditionReportBusy}
                  />
                  <button
                    type="button"
                    style={{ ...styles.primaryButton, marginTop: 8 }}
                    disabled={busy || conditionReportBusy}
                    onClick={() => {
                      // スマホは別タブの URL がおかしくなる／ブロックされるため画面内表示を優先
                      const reportWindow = preferInAppConditionReport()
                        ? null
                        : openReportWindowSync()
                      void printConditionReport(reportWindow)
                    }}
                  >
                    {conditionReportBusy ? '作成中…' : '体調グラフを印刷'}
                  </button>
                  <p style={{ ...muted, marginTop: 8 }}>
                    スマホでは画面内にグラフを表示します。表示後の「印刷する」から印刷できます。
                  </p>
                </div>
                <div style={recordsSectionBox}>
                  <h4 style={sectionTitle}>
                    📋 共有済みの記録（{selectedMatch.requesterName || '依頼人'}・リアルタイム）
                  </h4>
                  <p style={{ ...muted, marginBottom: 6 }}>
                    左線の色：紫＝就寝 ／ 橙＝起床 ／ 青緑＝服薬 ／ 赤＝体調
                  </p>
                  <p style={{ ...muted, marginBottom: 8 }}>
                    一覧は約3件分を表示し、それ以上はスクロールで確認できます。
                  </p>
                  {events.length === 0 ? (
                    <p style={muted}>まだ共有された記録はありません。</p>
                  ) : (
                    <div style={recordsScrollBox}>
                      {events.map((event) => renderWatchEventItem(event))}
                    </div>
                  )}
                </div>
                {renderCommentsSection()}
              </div>
            )}
          </>
        )}

        {mode === 'requester' && (
          <>
            <div style={sectionBox}>
              <p style={muted}>
                {profile
                  ? `${profile.name || '（無名）'} ／ ${profile.email || ''}`
                  : '初期設定が見つかりません。先に初期設定を行ってください。'}
              </p>
              <p style={muted}>見守り人の契約メールアドレスを入力して依頼します。見守り人は1人までです。</p>
            </div>

            <div style={sectionBox}>
              <label style={styles.fieldLabel}>見守り人の契約メール</label>
              <input
                type="email"
                value={inviteEmail}
                onChange={(event) => setInviteEmail(event.target.value)}
                style={styles.modalInput}
                placeholder="watcher@example.com"
                disabled={busy}
              />
              <button
                type="button"
                style={{ ...styles.primaryButton, marginTop: 8 }}
                disabled={busy || !profile}
                onClick={() => runAction(
                  () => createWatchRequest({
                    requesterProfile: profile,
                    watcherEmail: normalizeWatchEmail(inviteEmail),
                  }),
                  '見守り依頼を送信しました。相手の承認待ちです。'
                )}
              >
                依頼する
              </button>
            </div>

            <div style={sectionBox}>
              <h4 style={{ margin: '0 0 8px', fontSize: 15 }}>関係・手続き</h4>
              {matches.length === 0 && <p style={muted}>まだ依頼はありません。</p>}
              {matches.map((match) => (
                <div key={match.id} style={listItem}>
                  <div style={{ fontWeight: 700, marginBottom: 4 }}>
                    {match.watcherName || match.watcherEmail || '見守り人'}
                  </div>
                  <div style={{ fontSize: 13, color: '#475569', marginBottom: 8 }}>
                    {match.watcherEmail} ／ {getWatchStatusLabel(match.status)}
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                    {(match.status === WATCH_STATUS_PENDING_APPROVAL
                      || match.status === WATCH_STATUS_PENDING_TERMS) && (
                      <button
                        type="button"
                        style={{ ...styles.secondaryButton, color: '#b91c1c' }}
                        disabled={busy}
                        onClick={() => {
                          if (!window.confirm('この依頼を取り消しますか？')) return
                          runAction(
                            () => cancelWatchRequest({ matchId: match.id, requesterUid: session.uid }),
                            '依頼を取り消しました。'
                          )
                        }}
                      >
                        取消
                      </button>
                    )}
                    {match.status === WATCH_STATUS_PENDING_TERMS && (
                      <button
                        type="button"
                        style={styles.primaryButton}
                        disabled={busy}
                        onClick={() => setTermsOpenMatchId(match.id)}
                      >
                        利用注意事項に同意
                      </button>
                    )}
                    {match.status === WATCH_STATUS_ACTIVE && (
                      <>
                        <button
                          type="button"
                          style={styles.secondaryButton}
                          disabled={busy}
                          onClick={() => openMatchDetail(match.id)}
                        >
                          記録・コメントを開く
                        </button>
                        <button
                          type="button"
                          style={{ ...styles.secondaryButton, color: '#b91c1c' }}
                          disabled={busy}
                          onClick={() => {
                            setEndConfirm({
                              matchId: match.id,
                              partnerLabel: match.watcherName || '見守り人',
                            })
                          }}
                        >
                          見守り終了
                        </button>
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>

            {selectedMatch?.status === WATCH_STATUS_ACTIVE && (
              <div ref={detailSectionRef}>
                <div style={recordsSectionBox}>
                  <h4 style={sectionTitle}>📋 共有済みの記録（リアルタイム）</h4>
                  <p style={{ ...muted, marginBottom: 6 }}>
                    左線の色：紫＝就寝 ／ 橙＝起床 ／ 青緑＝服薬 ／ 赤＝体調
                  </p>
                  <p style={{ ...muted, marginBottom: 8 }}>
                    一覧は約3件分を表示し、それ以上はスクロールで確認できます。
                  </p>
                  {events.length === 0 ? (
                    <p style={muted}>まだ記録はありません。</p>
                  ) : (
                    <div style={recordsScrollBox}>
                      {events.map((event) => renderWatchEventItem(event))}
                    </div>
                  )}
                </div>
                {renderCommentsSection()}
              </div>
            )}
          </>
        )}

        {conditionReportHtml && (
          <div
            style={{ ...styles.modalOverlay, zIndex: 95 }}
            onClick={() => setConditionReportHtml('')}
          >
            <div
              className="schedule-modal"
              style={{
                ...styles.modal,
                maxWidth: 900,
                width: '100%',
                height: 'min(90vh, 900px)',
                display: 'flex',
                flexDirection: 'column',
                padding: 12,
              }}
              onClick={(event) => event.stopPropagation()}
            >
              <div style={{ ...styles.modalHeader, marginBottom: 8 }}>
                <h3 style={styles.modalTitle}>体調グラフ（画面内表示）</h3>
                <button
                  type="button"
                  style={styles.closeButton}
                  onClick={() => setConditionReportHtml('')}
                >
                  閉じる
                </button>
              </div>
              <div style={{ display: 'flex', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
                <button
                  type="button"
                  style={styles.primaryButton}
                  onClick={() => {
                    const frame = conditionReportFrameRef.current
                    if (frame?.contentWindow) {
                      frame.contentWindow.focus()
                      frame.contentWindow.print()
                    }
                  }}
                >
                  印刷する
                </button>
                <button
                  type="button"
                  style={styles.secondaryButton}
                  onClick={() => setConditionReportHtml('')}
                >
                  閉じる
                </button>
              </div>
              <iframe
                ref={conditionReportFrameRef}
                title="体調グラフ"
                srcDoc={conditionReportHtml}
                style={{
                  flex: 1,
                  width: '100%',
                  border: '1px solid #e2e8f0',
                  borderRadius: 10,
                  background: '#fff',
                  minHeight: 360,
                }}
              />
            </div>
          </div>
        )}

        {endConfirm && (
          <div
            style={{ ...styles.modalOverlay, zIndex: 90 }}
            onClick={() => {
              if (!busy) setEndConfirm(null)
            }}
          >
            <div
              className="schedule-modal"
              style={{ ...styles.modal, maxWidth: 480 }}
              onClick={(event) => event.stopPropagation()}
              role="alertdialog"
              aria-modal="true"
              aria-labelledby="watch-end-confirm-title"
            >
              <div style={styles.modalHeader}>
                <h3 id="watch-end-confirm-title" style={{ ...styles.modalTitle, color: '#b91c1c' }}>
                  見守り終了の確認
                </h3>
                <button
                  type="button"
                  style={styles.closeButton}
                  disabled={busy}
                  onClick={() => setEndConfirm(null)}
                >
                  閉じる
                </button>
              </div>
              <pre style={{
                whiteSpace: 'pre-wrap',
                fontFamily: 'inherit',
                fontSize: 13,
                lineHeight: 1.6,
                background: '#fff7ed',
                border: '1px solid #fdba74',
                borderRadius: 10,
                padding: 12,
                margin: '0 0 12px',
                color: '#7c2d12',
              }}
              >
                {buildEndWatchNotice(endConfirm.partnerLabel)}
              </pre>
              <div style={{ ...styles.modalActionRow, justifyContent: 'flex-end' }}>
                <button
                  type="button"
                  style={styles.secondaryButton}
                  disabled={busy}
                  onClick={() => setEndConfirm(null)}
                >
                  キャンセル
                </button>
                <button
                  type="button"
                  style={{ ...styles.primaryButton, background: '#dc2626' }}
                  disabled={busy}
                  onClick={() => {
                    const matchId = endConfirm.matchId
                    runAction(async () => {
                      await endWatchMatch({ matchId, actorUid: session.uid })
                      setEndConfirm(null)
                    }, '見守りを終了しました。')
                  }}
                >
                  終了する
                </button>
              </div>
            </div>
          </div>
        )}

        {termsOpenMatchId && (
          <div style={{ ...styles.modalOverlay, zIndex: 80 }} onClick={() => setTermsOpenMatchId('')}>
            <div
              className="schedule-modal"
              style={{ ...styles.modal, maxWidth: 480 }}
              onClick={(event) => event.stopPropagation()}
            >
              <div style={styles.modalHeader}>
                <h3 style={styles.modalTitle}>利用注意事項</h3>
                <button type="button" style={styles.closeButton} onClick={() => setTermsOpenMatchId('')}>閉じる</button>
              </div>
              <pre style={{
                whiteSpace: 'pre-wrap',
                fontFamily: 'inherit',
                fontSize: 13,
                lineHeight: 1.6,
                background: '#f8fafc',
                border: '1px solid #e2e8f0',
                borderRadius: 10,
                padding: 12,
                margin: '0 0 12px',
              }}
              >
                {WATCH_TERMS_TEXT}
              </pre>
              <div style={{ ...styles.modalActionRow, justifyContent: 'flex-end' }}>
                <button type="button" style={styles.secondaryButton} onClick={() => setTermsOpenMatchId('')}>戻る</button>
                <button
                  type="button"
                  style={styles.primaryButton}
                  disabled={busy}
                  onClick={() => runAction(async () => {
                    await agreeWatchTerms({ matchId: termsOpenMatchId, requesterUid: session.uid })
                    setTermsOpenMatchId('')
                  }, 'マッチングが完了しました。見守り人に記録が共有されます。')}
                >
                  同意してマッチング完了
                </button>
              </div>
            </div>
          </div>
        )}

        <div style={{ ...styles.modalActionRow, justifyContent: 'flex-end' }}>
          <button type="button" style={styles.secondaryButton} onClick={onClose}>閉じる</button>
        </div>
      </div>
    </div>
  )
}
