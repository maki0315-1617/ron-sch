import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  limit,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore'
import { db } from './firebase'

export const WATCH_ROLE_WATCHER = 'watcher'
export const WATCH_ROLE_REQUESTER = 'requester'

export const WATCH_STATUS_PENDING_APPROVAL = 'pending_approval'
export const WATCH_STATUS_PENDING_TERMS = 'pending_terms'
export const WATCH_STATUS_ACTIVE = 'active'
export const WATCH_STATUS_ENDED = 'ended'
export const WATCH_STATUS_EXPIRED = 'expired'

export const WATCH_PLAN_S_PLUS = 's_plus'
export const WATCH_PENDING_EXPIRE_MS = 7 * 24 * 60 * 60 * 1000
export const WATCH_COMMENT_MAX_LENGTH = 200

export const WATCH_EVENT_BEDTIME = 'bedtime'
export const WATCH_EVENT_WAKE = 'wake'
export const WATCH_EVENT_MEDICATION = 'medication'

export const WATCH_TERMS_TEXT = [
  '見守り機能では、あなたが記録した実就寝時刻・実起床時刻・実服薬時刻が見守り人に共有され、そのたびにお知らせが送られます。',
  'お互いのコメントも共有されます。体調・住所・電話番号・スケジュール内容は共有されません。',
  '見守り関係は、あなたまたは見守り人のどちらからでも、申請だけで即時終了できます。',
  'Sプラスかつ契約が有効なあいだのみ利用できます。条件を外れた場合は参照・通知が停止します。',
  '見守りは生活の参考情報であり、医療行為や緊急対応の代替ではありません。',
].join('\n')

export const normalizeWatchEmail = (value) => String(value || '').trim().toLowerCase()

export const watchEmailIndexId = (email) => normalizeWatchEmail(email).replace(/\//g, '_')

export const watchMatchId = (watcherUid, requesterUid) => `${watcherUid}_${requesterUid}`

export const getWatchRoleLabel = (role) => {
  if (role === WATCH_ROLE_WATCHER) return '見守り人'
  if (role === WATCH_ROLE_REQUESTER) return '見守り依頼人'
  return ''
}

export const getWatchStatusLabel = (status) => {
  switch (status) {
    case WATCH_STATUS_PENDING_APPROVAL:
      return '承認待ち'
    case WATCH_STATUS_PENDING_TERMS:
      return '利用注意事項の同意待ち'
    case WATCH_STATUS_ACTIVE:
      return 'マッチング中'
    case WATCH_STATUS_ENDED:
      return '終了'
    case WATCH_STATUS_EXPIRED:
      return '期限切れ'
    default:
      return status || ''
  }
}

export const getWatchEventLabel = (kind, slotLabel = '') => {
  if (kind === WATCH_EVENT_BEDTIME) return '就寝'
  if (kind === WATCH_EVENT_WAKE) return '起床'
  if (kind === WATCH_EVENT_MEDICATION) return slotLabel ? `服薬（${slotLabel}）` : '服薬'
  return '記録'
}

export const formatWatchPlanLabel = (plan) => {
  const key = String(plan || '').trim()
  if (!key) return '未契約／デモ'
  if (key === WATCH_PLAN_S_PLUS) return 'Sプラス'
  return key
}

export const isWatchCarePlanEligible = (subscription) => (
  Boolean(
    subscription
    && subscription.status === 'active'
    && String(subscription.plan || '').trim() === WATCH_PLAN_S_PLUS
  )
)

const toMillis = (value) => {
  if (!value) return 0
  if (typeof value.toMillis === 'function') return value.toMillis()
  if (typeof value.seconds === 'number') return value.seconds * 1000
  const asDate = value instanceof Date ? value : new Date(value)
  const ms = asDate.getTime()
  return Number.isFinite(ms) ? ms : 0
}

export const isWatchMatchPendingExpired = (match, nowMs = Date.now()) => {
  if (!match) return false
  if (match.status !== WATCH_STATUS_PENDING_APPROVAL && match.status !== WATCH_STATUS_PENDING_TERMS) {
    return false
  }
  const base = toMillis(match.updatedAt) || toMillis(match.createdAt)
  if (!base) return false
  return nowMs - base >= WATCH_PENDING_EXPIRE_MS
}

export const loadWatchProfile = async (uid) => {
  if (!db || !uid) return null
  const snap = await getDoc(doc(db, 'watch_profiles', uid))
  if (!snap.exists()) return null
  return { id: snap.id, ...snap.data() }
}

export const saveWatchProfile = async ({ uid, name, email, role }) => {
  if (!db || !uid) throw new Error('ログインが必要です。')
  const trimmedName = String(name || '').trim()
  if (!trimmedName) throw new Error('名前を入力してください。')
  if (role !== WATCH_ROLE_WATCHER && role !== WATCH_ROLE_REQUESTER) {
    throw new Error('役割を選択してください。')
  }
  const normalizedEmail = normalizeWatchEmail(email)
  if (!normalizedEmail) throw new Error('契約メールアドレスが取得できません。')

  const existing = await loadWatchProfile(uid)
  if (existing?.role && existing.role !== role) {
    const openMatches = await listOpenMatchesForUser(uid, existing.role)
    if (openMatches.length > 0) {
      throw new Error('有効または手続き中の見守り関係があるため、役割を変更できません。')
    }
  }

  const profile = {
    user_id: uid,
    name: trimmedName,
    email: normalizedEmail,
    role,
    updatedAt: serverTimestamp(),
  }
  if (!existing) profile.createdAt = serverTimestamp()

  await setDoc(doc(db, 'watch_profiles', uid), profile, { merge: true })
  await setDoc(doc(db, 'watch_email_index', watchEmailIndexId(normalizedEmail)), {
    email: normalizedEmail,
    user_id: uid,
    name: trimmedName,
    role,
    updatedAt: serverTimestamp(),
  }, { merge: true })

  return { id: uid, ...profile, name: trimmedName, email: normalizedEmail, role }
}

export const findWatcherByEmail = async (email) => {
  const emailKey = watchEmailIndexId(email)
  if (!emailKey) return null
  const snap = await getDoc(doc(db, 'watch_email_index', emailKey))
  if (!snap.exists()) return null
  const data = snap.data() || {}
  if (data.role !== WATCH_ROLE_WATCHER || !data.user_id) return null
  return {
    uid: data.user_id,
    email: data.email || normalizeWatchEmail(email),
    name: data.name || '',
    role: data.role,
  }
}

const mapMatchDoc = (snap) => ({ id: snap.id, ...snap.data() })

export const listMatchesForWatcher = async (watcherUid) => {
  if (!db || !watcherUid) return []
  const snapshot = await getDocs(query(
    collection(db, 'watch_matches'),
    where('watcherUid', '==', watcherUid),
    limit(100),
  ))
  return snapshot.docs.map(mapMatchDoc)
}

export const listMatchesForRequester = async (requesterUid) => {
  if (!db || !requesterUid) return []
  const snapshot = await getDocs(query(
    collection(db, 'watch_matches'),
    where('requesterUid', '==', requesterUid),
    limit(50),
  ))
  return snapshot.docs.map(mapMatchDoc)
}

export const listOpenMatchesForUser = async (uid, role) => {
  const matches = role === WATCH_ROLE_WATCHER
    ? await listMatchesForWatcher(uid)
    : await listMatchesForRequester(uid)
  return matches.filter((match) => (
    match.status === WATCH_STATUS_PENDING_APPROVAL
    || match.status === WATCH_STATUS_PENDING_TERMS
    || match.status === WATCH_STATUS_ACTIVE
  ))
}

export const expireStaleMatches = async (matches) => {
  const stale = (matches || []).filter((match) => isWatchMatchPendingExpired(match))
  await Promise.all(stale.map(async (match) => {
    try {
      await updateDoc(doc(db, 'watch_matches', match.id), {
        status: WATCH_STATUS_EXPIRED,
        endedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
    } catch (error) {
      console.warn('見守り依頼の期限切れ更新に失敗:', error)
    }
  }))
  return stale.map((match) => match.id)
}

export const createWatchRequest = async ({
  requesterProfile,
  watcherEmail,
}) => {
  if (!requesterProfile?.user_id && !requesterProfile?.id) {
    throw new Error('見守り依頼人の初期設定が必要です。')
  }
  const requesterUid = requesterProfile.user_id || requesterProfile.id
  if (requesterProfile.role !== WATCH_ROLE_REQUESTER) {
    throw new Error('見守り依頼人のみ依頼できます。')
  }

  const watcher = await findWatcherByEmail(watcherEmail)
  if (!watcher) {
    throw new Error('その契約メールの見守り人は見つかりません。相手が見守り人として初期設定済みか確認してください。')
  }
  if (watcher.uid === requesterUid) {
    throw new Error('自分自身には依頼できません。')
  }

  const existing = await listMatchesForRequester(requesterUid)
  const blocking = existing.find((match) => (
    match.status === WATCH_STATUS_PENDING_APPROVAL
    || match.status === WATCH_STATUS_PENDING_TERMS
    || match.status === WATCH_STATUS_ACTIVE
  ))
  if (blocking) {
    throw new Error('すでに見守り人との関係または依頼中があります。終了または取消後に再度依頼してください。')
  }

  const matchId = watchMatchId(watcher.uid, requesterUid)
  const previous = existing.find((match) => match.id === matchId)
  const payload = {
    watcherUid: watcher.uid,
    requesterUid,
    watcherEmail: watcher.email,
    requesterEmail: normalizeWatchEmail(requesterProfile.email),
    watcherName: watcher.name || '',
    requesterName: requesterProfile.name || '',
    status: WATCH_STATUS_PENDING_APPROVAL,
    updatedAt: serverTimestamp(),
  }
  if (!previous) payload.createdAt = serverTimestamp()
  await setDoc(doc(db, 'watch_matches', matchId), payload, { merge: true })
  return { id: matchId, ...payload }
}

export const approveWatchRequest = async ({ matchId, watcherUid }) => {
  const ref = doc(db, 'watch_matches', matchId)
  const snap = await getDoc(ref)
  if (!snap.exists()) throw new Error('依頼が見つかりません。')
  const data = snap.data() || {}
  if (data.watcherUid !== watcherUid) throw new Error('この依頼を承認する権限がありません。')
  if (data.status !== WATCH_STATUS_PENDING_APPROVAL) {
    throw new Error('承認待ちの依頼ではありません。')
  }
  if (isWatchMatchPendingExpired(data)) {
    await updateDoc(ref, {
      status: WATCH_STATUS_EXPIRED,
      endedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    })
    throw new Error('この依頼は期限切れです。')
  }
  await updateDoc(ref, {
    status: WATCH_STATUS_PENDING_TERMS,
    approvedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  })
}

export const rejectWatchRequest = async ({ matchId, watcherUid }) => {
  const ref = doc(db, 'watch_matches', matchId)
  const snap = await getDoc(ref)
  if (!snap.exists()) throw new Error('依頼が見つかりません。')
  const data = snap.data() || {}
  if (data.watcherUid !== watcherUid) throw new Error('この依頼を却下する権限がありません。')
  if (data.status !== WATCH_STATUS_PENDING_APPROVAL) {
    throw new Error('承認待ちの依頼ではありません。')
  }
  await updateDoc(ref, {
    status: WATCH_STATUS_ENDED,
    endedAt: serverTimestamp(),
    endedByUid: watcherUid,
    endReason: 'rejected',
    updatedAt: serverTimestamp(),
  })
}

export const cancelWatchRequest = async ({ matchId, requesterUid }) => {
  const ref = doc(db, 'watch_matches', matchId)
  const snap = await getDoc(ref)
  if (!snap.exists()) throw new Error('依頼が見つかりません。')
  const data = snap.data() || {}
  if (data.requesterUid !== requesterUid) throw new Error('この依頼を取り消す権限がありません。')
  if (
    data.status !== WATCH_STATUS_PENDING_APPROVAL
    && data.status !== WATCH_STATUS_PENDING_TERMS
  ) {
    throw new Error('取消できる依頼ではありません。')
  }
  await updateDoc(ref, {
    status: WATCH_STATUS_ENDED,
    endedAt: serverTimestamp(),
    endedByUid: requesterUid,
    endReason: 'cancelled',
    updatedAt: serverTimestamp(),
  })
}

export const agreeWatchTerms = async ({ matchId, requesterUid }) => {
  const ref = doc(db, 'watch_matches', matchId)
  const snap = await getDoc(ref)
  if (!snap.exists()) throw new Error('依頼が見つかりません。')
  const data = snap.data() || {}
  if (data.requesterUid !== requesterUid) throw new Error('同意する権限がありません。')
  if (data.status !== WATCH_STATUS_PENDING_TERMS) {
    throw new Error('利用注意事項の同意待ちではありません。')
  }
  if (isWatchMatchPendingExpired(data)) {
    await updateDoc(ref, {
      status: WATCH_STATUS_EXPIRED,
      endedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    })
    throw new Error('この依頼は期限切れです。')
  }
  await updateDoc(ref, {
    status: WATCH_STATUS_ACTIVE,
    termsAgreedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  })
}

export const endWatchMatch = async ({ matchId, actorUid }) => {
  const ref = doc(db, 'watch_matches', matchId)
  const snap = await getDoc(ref)
  if (!snap.exists()) throw new Error('見守り関係が見つかりません。')
  const data = snap.data() || {}
  if (data.watcherUid !== actorUid && data.requesterUid !== actorUid) {
    throw new Error('終了する権限がありません。')
  }
  if (data.status !== WATCH_STATUS_ACTIVE) {
    throw new Error('マッチング中の関係のみ終了できます。')
  }
  await updateDoc(ref, {
    status: WATCH_STATUS_ENDED,
    endedAt: serverTimestamp(),
    endedByUid: actorUid,
    endReason: 'ended',
    updatedAt: serverTimestamp(),
  })
}

export const loadActiveMatchForRequester = async (requesterUid) => {
  const matches = await listMatchesForRequester(requesterUid)
  return matches.find((match) => match.status === WATCH_STATUS_ACTIVE) || null
}

export const publishWatchCareEvent = async ({
  match,
  kind,
  dateKey,
  timeKey,
  slotKey = '',
  slotLabel = '',
}) => {
  if (!db || !match || match.status !== WATCH_STATUS_ACTIVE) return null
  if (!kind || !dateKey || !timeKey) return null
  const eventRef = doc(collection(db, 'watch_events'))
  const payload = {
    matchId: match.id,
    watcherUid: match.watcherUid,
    requesterUid: match.requesterUid,
    requesterName: match.requesterName || '',
    kind,
    dateKey,
    timeKey,
    slotKey: slotKey || '',
    slotLabel: slotLabel || '',
    createdAt: serverTimestamp(),
  }
  await setDoc(eventRef, payload)
  return { id: eventRef.id, ...payload }
}

export const listWatchEventsForMatch = async (match, viewerUid, max = 80) => {
  if (!db || !match?.id || !viewerUid) return []
  const partyField = match.watcherUid === viewerUid
    ? 'watcherUid'
    : (match.requesterUid === viewerUid ? 'requesterUid' : null)
  if (!partyField) return []
  const snapshot = await getDocs(query(
    collection(db, 'watch_events'),
    where('matchId', '==', match.id),
    where(partyField, '==', viewerUid),
    limit(max),
  ))
  return snapshot.docs
    .map((snap) => ({ id: snap.id, ...snap.data() }))
    .sort((a, b) => toMillis(b.createdAt) - toMillis(a.createdAt))
}

export const listWatchCommentsForMatch = async (match, viewerUid, max = 80) => {
  if (!db || !match?.id || !viewerUid) return []
  const partyField = match.watcherUid === viewerUid
    ? 'watcherUid'
    : (match.requesterUid === viewerUid ? 'requesterUid' : null)
  if (!partyField) return []
  const snapshot = await getDocs(query(
    collection(db, 'watch_comments'),
    where('matchId', '==', match.id),
    where(partyField, '==', viewerUid),
    limit(max),
  ))
  return snapshot.docs
    .map((snap) => ({ id: snap.id, ...snap.data() }))
    .sort((a, b) => toMillis(a.createdAt) - toMillis(b.createdAt))
}

export const postWatchComment = async ({
  match,
  fromUid,
  fromName,
  body,
}) => {
  if (!match || match.status !== WATCH_STATUS_ACTIVE) {
    throw new Error('マッチング中のみコメントできます。')
  }
  if (match.watcherUid !== fromUid && match.requesterUid !== fromUid) {
    throw new Error('コメントする権限がありません。')
  }
  const text = String(body || '').trim().slice(0, WATCH_COMMENT_MAX_LENGTH)
  if (!text) throw new Error('コメントを入力してください。')
  const ref = doc(collection(db, 'watch_comments'))
  const payload = {
    matchId: match.id,
    watcherUid: match.watcherUid,
    requesterUid: match.requesterUid,
    fromUid,
    fromName: fromName || '',
    body: text,
    createdAt: serverTimestamp(),
  }
  await setDoc(ref, payload)
  return { id: ref.id, ...payload }
}

export const deleteWatchEmailIndexIfOwned = async (email, uid) => {
  const emailKey = watchEmailIndexId(email)
  if (!emailKey || !uid) return
  const ref = doc(db, 'watch_email_index', emailKey)
  const snap = await getDoc(ref)
  if (!snap.exists()) return
  if (snap.data()?.user_id !== uid) return
  await deleteDoc(ref)
}
