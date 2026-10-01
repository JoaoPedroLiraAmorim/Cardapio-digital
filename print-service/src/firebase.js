'use strict';

const fs = require('node:fs');

async function connectFirebase(config) {
  const { initializeApp, applicationDefault, cert, getApps } = await import('firebase-admin/app');
  const { getFirestore, Timestamp } = await import('firebase-admin/firestore');
  let credential;
  if (config.serviceAccountPath) {
    const account = JSON.parse(fs.readFileSync(config.serviceAccountPath, 'utf8'));
    credential = cert(account);
  } else credential = applicationDefault();
  const app = getApps()[0] || initializeApp({ credential, projectId: config.projectId });
  return { db: getFirestore(app), Timestamp };
}

module.exports = { connectFirebase };

