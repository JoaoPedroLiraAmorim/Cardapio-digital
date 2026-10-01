'use strict';

function normalizeTimestamp(value) {
  if (value?.toMillis) return value.toMillis();
  if (value instanceof Date) return value.getTime();
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

async function startOrderListener({ firebase, config, store, onOrder, logger }) {
  const state = store.load();
  if (!state.firebaseActivatedAt) { state.firebaseActivatedAt = Date.now(); store.save(); }
  const activatedAt = state.firebaseActivatedAt;
  const query = firebase.db.collection(config.collection)
    .where('createdAt', '>=', firebase.Timestamp.fromMillis(activatedAt))
    .orderBy('createdAt', 'asc');
  logger.info('FIREBASE', `Ouvindo ${config.collection} desde ${new Date(activatedAt).toISOString()}`);
  const unsubscribe = query.onSnapshot(snapshot => {
    for (const change of snapshot.docChanges()) {
      if (!['added', 'modified'].includes(change.type)) continue;
      const data = change.doc.data();
      if (!['confirmed', 'approved'].includes(data.status)) continue;
      const order = { ...(data.order || data), id: String((data.order || data).id || change.doc.id) };
      if (normalizeTimestamp(data.createdAt) < activatedAt) continue;
      try { onOrder(order); } catch (error) { logger.error('ORDER', `Pedido #${order.id} rejeitado`, error.message); }
    }
  }, error => logger.error('FIREBASE', 'Listener desconectado; o SDK tentará reconectar', error.message));
  return unsubscribe;
}

module.exports = { startOrderListener, normalizeTimestamp };

