const { onSchedule } = require('firebase-functions/v2/scheduler');
const logger = require('firebase-functions/logger');
const admin = require('firebase-admin');

admin.initializeApp();

const db = admin.firestore();
const messaging = admin.messaging();
const TIME_ZONE = 'Asia/Tokyo';

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
        updatedAt: tokenDoc.data().updated_at,
      }))
      .filter((entry) => Boolean(entry.token));

    tokenDocs.sort((a, b) => {
      const aTime = a.updatedAt && typeof a.updatedAt.toMillis === 'function' ? a.updatedAt.toMillis() : 0;
      const bTime = b.updatedAt && typeof b.updatedAt.toMillis === 'function' ? b.updatedAt.toMillis() : 0;
      return bTime - aTime;
    });

    const activeToken = tokenDocs.length > 0 ? tokenDocs[0].token : null;
    if (tokenDocs.length > 1) {
      const batch = db.batch();
      tokenDocs.slice(1).forEach((entry) => {
        batch.delete(db.collection('fcm_tokens').doc(entry.id));
      });
      await batch.commit();
    }

    tokenCache.set(userId, activeToken ? [activeToken] : []);
  }

  return tokenCache.get(userId) || [];
};

// 15分前・5分前リマインド通知を送信する（当日開始時刻の通知とは別ログIDで管理）
const sendReminderNotifications = async (scheduleSnapshot, dateKey, timeKey, offsetMinutes, label, tokenCache) => {
  const graceMinutes = 5;

  const reminderItems = scheduleSnapshot.docs.filter((scheduleDoc) => {
    const item = scheduleDoc.data();
    if (!item.user_id || item.completed === true) {
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

    const tokens = await resolveActiveTokens(userId, tokenCache);
    if (tokens.length === 0) {
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
    const message = {
      tokens,
      data: {
        scheduleItemId: String(scheduleDoc.id),
        date: dateKey,
        time: scheduledTime,
        title: String(title),
        body: String(body),
      },
      webpush: {
        fcmOptions: {
          link: '/',
        },
      },
    };

    const result = await messaging.sendEachForMulticast(message);

    const invalidTokens = [];
    result.responses.forEach((response, index) => {
      if (!response.success && shouldDeleteToken(response.error)) {
        invalidTokens.push(tokens[index]);
      }
    });

    if (invalidTokens.length > 0) {
      const batch = db.batch();
      invalidTokens.forEach((token) => {
        batch.delete(db.collection('fcm_tokens').doc(`${userId}_${token}`));
      });
      await batch.commit();
    }

    await logRef.set(
      {
        status: result.failureCount > 0 ? 'partial' : 'sent',
        success_count: result.successCount,
        failure_count: result.failureCount,
        updated_at: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
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

    logger.info('スケジュール開始通知バッチを実行します。', { dateKey, timeKey });

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
      if (!item.user_id || item.completed === true) {
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

      if (!tokenCache.has(userId)) {
        const tokenSnapshot = await db.collection('fcm_tokens').where('user_id', '==', userId).get();
        const tokenDocs = tokenSnapshot.docs
          .map((tokenDoc) => ({
            id: tokenDoc.id,
            token: tokenDoc.data().token,
            updatedAt: tokenDoc.data().updated_at,
          }))
          .filter((entry) => Boolean(entry.token));

        tokenDocs.sort((a, b) => {
          const aTime = a.updatedAt && typeof a.updatedAt.toMillis === 'function' ? a.updatedAt.toMillis() : 0;
          const bTime = b.updatedAt && typeof b.updatedAt.toMillis === 'function' ? b.updatedAt.toMillis() : 0;
          return bTime - aTime;
        });

        const activeToken = tokenDocs.length > 0 ? tokenDocs[0].token : null;
        if (tokenDocs.length > 1) {
          const batch = db.batch();
          tokenDocs.slice(1).forEach((entry) => {
            batch.delete(db.collection('fcm_tokens').doc(entry.id));
          });
          await batch.commit();
        }

        tokenCache.set(userId, activeToken ? [activeToken] : []);
      }

      const tokens = tokenCache.get(userId) || [];
      if (tokens.length === 0) {
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
      const message = {
        tokens,
        // notification フィールドを付けるとブラウザが自動表示し、
        // SW 側の onBackgroundMessage(バッジ更新処理)が実行されなくなるため data-only にする
        data: {
          scheduleItemId: String(scheduleDoc.id),
          date: dateKey,
          time: scheduledTime,
          title: String(title),
          body: String(body),
        },
        webpush: {
          fcmOptions: {
            link: '/',
          },
        },
      };

      const result = await messaging.sendEachForMulticast(message);

      const invalidTokens = [];
      result.responses.forEach((response, index) => {
        if (!response.success && shouldDeleteToken(response.error)) {
          invalidTokens.push(tokens[index]);
        }
      });

      if (invalidTokens.length > 0) {
        const batch = db.batch();
        invalidTokens.forEach((token) => {
          batch.delete(db.collection('fcm_tokens').doc(`${userId}_${token}`));
        });
        await batch.commit();
      }

      await logRef.set(
        {
          status: result.failureCount > 0 ? 'partial' : 'sent',
          success_count: result.successCount,
          failure_count: result.failureCount,
          updated_at: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
    }

    logger.info('スケジュール開始通知バッチを完了しました。', {
      dateKey,
      timeKey,
      targetCount: dueItems.length,
    });
  }
);
