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
  normalizeWatchEmail,
  postWatchComment,
  rejectWatchRequest,
  saveWatchProfile,
  subscribeWatchCommentsForMatch,
  subscribeWatchEventsForMatch,
} from './watchCare'

const sectionBox = {
  border: '1px solid #e2e8f0',
  borderRadius: 12,
  padding: 12,
  background: '#f8fafc',
  marginBottom: 12,
}

const muted = { margin: '0 0 8px', color: '#64748b', fontSize: 13, lineHeight: 1.5 }
const listItem = {
  border: '1px solid #e2e8f0',
  borderRadius: 10,
  padding: 10,
  background: '#fff',
  marginBottom: 8,
}

const formatMaybeTime = (dateKey, timeKey) => {
  if (!dateKey && !timeKey) return '—'
  return `${dateKey || ''} ${timeKey || ''}`.trim()
}

const renderWatchEventItem = (event) => (
  <div key={event.id} style={{ ...listItem, marginBottom: 6, padding: 8 }}>
    <strong>{getWatchEventLabel(event.kind, event.slotLabel)}</strong>
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
  const commentsScrollRef = useRef(null)
  const commentsEndRef = useRef(null)

  const selectedMatch = useMemo(
    () => matches.find((match) => match.id === selectedMatchId) || null,
    [matches, selectedMatchId]
  )

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
      if (commentsEndRef.current) {
        commentsEndRef.current.scrollIntoView({ block: 'end' })
      } else if (commentsScrollRef.current) {
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
    <div style={sectionBox}>
      <h4 style={{ margin: '0 0 8px', fontSize: 15 }}>コメント（リアルタイム）</h4>
      <div
        ref={commentsScrollRef}
        style={{ maxHeight: 220, overflowY: 'auto', marginBottom: 8, paddingRight: 4 }}
      >
        {comments.length === 0 && <p style={muted}>コメントはまだありません。</p>}
        {comments.map((comment) => (
          <div key={comment.id} style={{ ...listItem, marginBottom: 6, padding: 8 }}>
            <div style={{ fontSize: 12, color: '#64748b' }}>{comment.fromName || 'メンバー'}</div>
            <div style={{ fontSize: 14, whiteSpace: 'pre-wrap' }}>{comment.body}</div>
          </div>
        ))}
        <div ref={commentsEndRef} />
      </div>
      <textarea
        value={commentDraft}
        onChange={(event) => setCommentDraft(event.target.value.slice(0, WATCH_COMMENT_MAX_LENGTH))}
        rows={3}
        style={{ ...styles.modalInput, resize: 'vertical' }}
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
              <h4 style={{ margin: '0 0 8px', fontSize: 15 }}>依頼一覧</h4>
              {matches.length === 0 && <p style={muted}>依頼はまだありません。</p>}
              {matches.map((match) => (
                <div key={match.id} style={listItem}>
                  <div style={{ fontWeight: 700, marginBottom: 4 }}>
                    {match.requesterName || match.requesterEmail || '依頼人'}
                  </div>
                  <div style={{ fontSize: 13, color: '#475569', marginBottom: 8 }}>
                    {match.requesterEmail} ／ {getWatchStatusLabel(match.status)}
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                    <button
                      type="button"
                      style={styles.secondaryButton}
                      disabled={busy}
                      onClick={() => setSelectedMatchId(match.id)}
                    >
                      選択
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
                          if (!window.confirm(`${match.requesterName || '依頼人'}との見守りを終了しますか？\n相手の承認は不要で、すぐに終了します。`)) return
                          runAction(
                            () => endWatchMatch({ matchId: match.id, actorUid: session.uid }),
                            '見守りを終了しました。'
                          )
                        }}
                      >
                        見守り終了
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>

            {selectedMatch?.status === WATCH_STATUS_ACTIVE && (
              <>
                <div style={sectionBox}>
                  <h4 style={{ margin: '0 0 8px', fontSize: 15 }}>
                    記録（{selectedMatch.requesterName || '依頼人'}・リアルタイム）
                  </h4>
                  {events.length === 0 && <p style={muted}>まだ共有された記録はありません。</p>}
                  {events.slice(0, 40).map((event) => renderWatchEventItem(event))}
                </div>
                {renderCommentsSection()}
              </>
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
                          onClick={() => setSelectedMatchId(match.id)}
                        >
                          記録・コメントを開く
                        </button>
                        <button
                          type="button"
                          style={{ ...styles.secondaryButton, color: '#b91c1c' }}
                          disabled={busy}
                          onClick={() => {
                            if (!window.confirm('見守りを終了しますか？\n相手の承認は不要で、すぐに終了します。')) return
                            runAction(
                              () => endWatchMatch({ matchId: match.id, actorUid: session.uid }),
                              '見守りを終了しました。'
                            )
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
              <>
                <div style={sectionBox}>
                  <h4 style={{ margin: '0 0 8px', fontSize: 15 }}>共有済みの記録（リアルタイム）</h4>
                  {events.length === 0 && <p style={muted}>まだ記録はありません。</p>}
                  {events.slice(0, 40).map((event) => renderWatchEventItem(event))}
                </div>
                {renderCommentsSection()}
              </>
            )}
          </>
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
