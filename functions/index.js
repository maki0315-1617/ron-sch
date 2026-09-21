const { onSchedule } = require('firebase-functions/v2/scheduler');
const logger = require('firebase-functions/logger');
const admin = require('firebase-admin');

admin.initializeApp();

const db = admin.firestore();
const messaging = admin.messaging();
const TIME_ZONE = 'Asia/Tokyo';
const WEB_PUSH_APP_URL = (process.env.WEB_PUSH_APP_URL || 'https://ron-sch.vercel.app/').replace(/\/?$/, '/');

const toDateAndTimeKey = (date) => {
  const dateParts = new Intl.DateTimeFormat('en-US', {
    timeZone: TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);

  const timeParts = new Intl.DateTimeFormat('en-US', {
    timeZone: TIME_ZONE,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date);

  const getPart = (parts, type) => {
    const target = parts.find((part) => part.type === type);
    if (!target) {
      throw new Error(`日時パーツ(${type})の取得に失敗しました。`);
    }
    return target.value;
  };

  return {
    dateKey: `${getPart(dateParts, 'year')}-${getPart(dateParts, 'month')}-${getPart(dateParts, 'day')}`,
    timeKey: `${getPart(timeParts, 'hour')}:${getPart(timeParts, 'minute')}`,
  };
};

const isAlreadyExistsError = (error) => {
  return error && (error.code === 6 || error.code === 'already-exists');
};

const shouldDeleteToken = (error) => {
  return Boolean(
    error &&
    (
      error.code === 'messaging/registration-token-not-registered' ||
      error.code === 'messaging/invalid-registration-token'
    )
  );
};

const parseTimeValue = (time = '00:00') => {
  const [hourText = '0', minuteText = '0'] = String(time).split(':');
  return Number(hourText || 0) * 60 + Number(minuteText || 0);
};

/** タスク（isTask）・時刻なしは通知対象外 */
const isNotificationScheduleItem = (item) => {
  if (!item || item.isTask === true) return false;
  return Boolean(item.time);
};

const isDueWithinGraceWindow = (scheduledTime, nowTime, graceMinutes) => {
  const scheduledMinutes = parseTimeValue(scheduledTime);
  const nowMinutes = parseTimeValue(nowTime);
  return nowMinutes >= scheduledMinutes && nowMinutes - scheduledMinutes <= graceMinutes;
};

// 開始時刻の指定分前（15分前・5分前など）が到来したかを判定する
const isDueForReminder = (scheduledTime, nowTime, offsetMinutes, graceMinutes) => {
  const reminderMinutes = parseTimeValue(scheduledTime) - offsetMinutes;
  const nowMinutes = parseTimeValue(nowTime);
  return nowMinutes >= reminderMinutes && nowMinutes - reminderMinutes <= graceMinutes;
};

const resolveActiveTokens = async (userId, tokenCache) => {
  if (!tokenCache.has(userId)) {
    const tokenSnapshot = await db.collection('fcm_tokens').where('user_id', '==', userId).get();
    const tokenDocs = tokenSnapshot.docs
      .map((tokenDoc) => ({
        id: tokenDoc.id,
        token: tokenDoc.data().token,
        platform: tokenDoc.data().platform || 'web',
        updatedAt: tokenDoc.data().updated_at,
      }))
      .filter((entry) => Boolean(entry.token));

    tokenDocs.sort((a, b) => {
      const aWeb = a.platform === 'web' ? 1 : 0;
      const bWeb = b.platform === 'web' ? 1 : 0;
      if (aWeb !== bWeb) return bWeb - aWeb;
      const aTime = a.updatedAt && typeof a.updatedAt.toMillis === 'function' ? a.updatedAt.toMillis() : 0;
      const bTime = b.updatedAt && typeof b.updatedAt.toMillis === 'function' ? b.updatedAt.toMillis() : 0;
      return bTime - aTime;
    });

    const activeEntry = tokenDocs.length > 0 ? tokenDocs[0] : null;
    if (tokenDocs.length > 1) {
      const batch = db.batch();
      tokenDocs.slice(1).forEach((entry) => {
        batch.delete(db.collection('fcm_tokens').doc(entry.id));
      });
      await batch.commit();
    }

    tokenCache.set(userId, activeEntry ? [{ token: activeEntry.token, docId: activeEntry.id }] : []);
  }

  return tokenCache.get(userId) || [];
};

const buildWebPushDataMessage = (tokenEntries, data) => ({
  tokens: tokenEntries.map((entry) => entry.token),
  data: Object.fromEntries(
    Object.entries(data).map(([key, value]) => [key, String(value)])
  ),
  webpush: {
    headers: {
      Urgency: 'high',
    },
    fcmOptions: {
      link: WEB_PUSH_APP_URL,
    },
  },
});

const collectSendErrors = (result, tokenEntries) => {
  const errors = [];
  result.responses.forEach((response, index) => {
    if (response.success || !response.error) return;
    errors.push({
      tokenSuffix: tokenEntries[index]?.token?.slice(-12) || '',
      code: response.error.code || 'unknown',
      message: response.error.message || 'Unknown error',
    });
  });
  return errors;
};

const finalizeMulticastSend = async (logRef, result, tokenEntries, context) => {
  const invalidEntries = [];
  result.responses.forEach((response, index) => {
    if (!response.success && shouldDeleteToken(response.error)) {
      invalidEntries.push(tokenEntries[index]);
    }
  });

  if (invalidEntries.length > 0) {
    const batch = db.batch();
    invalidEntries.forEach((entry) => {
      if (entry?.docId) {
        batch.delete(db.collection('fcm_tokens').doc(entry.docId));
      }
    });
    await batch.commit();
  }

  const errorDetails = collectSendErrors(result, tokenEntries);
  const status = result.failureCount > 0
    ? (result.successCount > 0 ? 'partial' : 'failed')
    : 'sent';

  await logRef.set(
    {
      status,
      success_count: result.successCount,
      failure_count: result.failureCount,
      error_details: errorDetails.slice(0, 3),
      updated_at: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  if (result.failureCount > 0) {
    logger.warn('FCM Web Push の送信に失敗しました。', {
      ...context,
      webPushLink: WEB_PUSH_APP_URL,
      successCount: result.successCount,
      failureCount: result.failureCount,
      errorDetails,
    });
  } else if (result.successCount > 0) {
    logger.info('FCM Web Push を送信しました。', {
      ...context,
      successCount: result.successCount,
    });
  }
};

// 15分前・5分前リマインド通知を送信する（当日開始時刻の通知とは別ログIDで管理）
const sendReminderNotifications = async (scheduleSnapshot, dateKey, timeKey, offsetMinutes, label, tokenCache) => {
  const graceMinutes = 5;

  const reminderItems = scheduleSnapshot.docs.filter((scheduleDoc) => {
    const item = scheduleDoc.data();
    if (!item.user_id || item.completed === true || !isNotificationScheduleItem(item)) {
      return false;
    }
    return isDueForReminder(item.time || '00:00', timeKey, offsetMinutes, graceMinutes);
  });

  for (const scheduleDoc of reminderItems) {
    const item = scheduleDoc.data();
    const userId = item.user_id;
    const scheduledTime = item.time || '00:00';

    const logId = `${scheduleDoc.id}_${dateKey}_${scheduledTime}_reminder${offsetMinutes}`;
    const logRef = db.collection('notification_logs').doc(logId);

    try {
      await logRef.create({
        schedule_item_id: scheduleDoc.id,
        user_id: userId,
        date: dateKey,
        time: scheduledTime,
        scheduled_for: scheduledTime,
        reminder_offset_minutes: offsetMinutes,
        status: 'pending',
        created_at: admin.firestore.FieldValue.serverTimestamp(),
      });
    } catch (error) {
      if (isAlreadyExistsError(error)) {
        continue;
      }
      throw error;
    }

    const tokenEntries = await resolveActiveTokens(userId, tokenCache);
    if (tokenEntries.length === 0) {
      await logRef.set(
        {
          status: 'skipped_no_token',
          updated_at: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
      continue;
    }

    const title = item.title || '予定';
    const body = `${title} ${label}です`;
    const message = buildWebPushDataMessage(tokenEntries, {
      scheduleItemId: scheduleDoc.id,
      date: dateKey,
      time: scheduledTime,
      title,
      body,
    });

    const result = await messaging.sendEachForMulticast(message);
    await finalizeMulticastSend(logRef, result, tokenEntries, {
      userId,
      scheduleItemId: scheduleDoc.id,
      dateKey,
      timeKey,
      kind: `reminder${offsetMinutes}`,
    });
  }
};

exports.sendScheduleStartNotifications = onSchedule(
  {
    schedule: 'every 1 minutes',
    timeZone: TIME_ZONE,
    region: 'asia-northeast1',
    retryCount: 0,
  },
  async () => {
    const now = new Date();
    const { dateKey, timeKey } = toDateAndTimeKey(now);
    const graceMinutes = 5;

    logger.info('スケジュール開始通知バッチを実行します。', { dateKey, timeKey, webPushLink: WEB_PUSH_APP_URL });

    const scheduleSnapshot = await db
      .collection('schedule_items')
      .where('date', '==', dateKey)
      .get();

    if (scheduleSnapshot.empty) {
      logger.info('通知対象の予定はありません。', { dateKey, timeKey });
      return;
    }

    const tokenCache = new Map();

    // 15分前・5分前のリマインド通知（当日開始時刻の通知処理より前に実行し、早期returnの影響を受けないようにする）
    await sendReminderNotifications(scheduleSnapshot, dateKey, timeKey, 15, '15分前', tokenCache);
    await sendReminderNotifications(scheduleSnapshot, dateKey, timeKey, 5, '5分前', tokenCache);

    const dueItems = scheduleSnapshot.docs.filter((scheduleDoc) => {
      const item = scheduleDoc.data();
      if (!item.user_id || item.completed === true || !isNotificationScheduleItem(item)) {
        return false;
      }
      return isDueWithinGraceWindow(item.time || '00:00', timeKey, graceMinutes);
    });

    if (dueItems.length === 0) {
      logger.info('通知対象の予定はありますが、送信対象の開始時刻ではありません。', {
        dateKey,
        timeKey,
        graceMinutes,
      });
      return;
    }

    for (const scheduleDoc of dueItems) {
      const item = scheduleDoc.data();
      const userId = item.user_id;
      const scheduledTime = item.time || '00:00';

      const logId = `${scheduleDoc.id}_${dateKey}_${scheduledTime}`;
      const logRef = db.collection('notification_logs').doc(logId);

      try {
        await logRef.create({
          schedule_item_id: scheduleDoc.id,
          user_id: userId,
          date: dateKey,
          time: scheduledTime,
          scheduled_for: scheduledTime,
          status: 'pending',
          created_at: admin.firestore.FieldValue.serverTimestamp(),
        });
      } catch (error) {
        if (isAlreadyExistsError(error)) {
          continue;
        }
        throw error;
      }

      const tokenEntries = await resolveActiveTokens(userId, tokenCache);
      if (tokenEntries.length === 0) {
        await logRef.set(
          {
            status: 'skipped_no_token',
            updated_at: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true }
        );
        continue;
      }

      const title = item.title || '予定';
      const body = `${title} 開始時間です`;
      const message = buildWebPushDataMessage(tokenEntries, {
        scheduleItemId: scheduleDoc.id,
        date: dateKey,
        time: scheduledTime,
        title,
        body,
      });

      const result = await messaging.sendEachForMulticast(message);
      await finalizeMulticastSend(logRef, result, tokenEntries, {
        userId,
        scheduleItemId: scheduleDoc.id,
        dateKey,
        timeKey,
        kind: 'start',
      });
    }

    logger.info('スケジュール開始通知バッチを完了しました。', {
      dateKey,
      timeKey,
      targetCount: dueItems.length,
    });
  }
);
