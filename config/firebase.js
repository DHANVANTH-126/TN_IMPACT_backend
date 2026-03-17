const admin = require('firebase-admin');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

let bucket = null;
let firebaseInitialized = false;

try {
  const serviceAccountPath = path.join(__dirname, 'serviceAccountKey.json');
  if (fs.existsSync(serviceAccountPath)) {
    const serviceAccount = require(serviceAccountPath);
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
    });
    bucket = admin.storage().bucket();
    firebaseInitialized = true;
    console.log('✅ Firebase Storage initialized');
  } else {
    console.warn('⚠️  Firebase serviceAccountKey.json not found — file uploads will use local fallback');
  }
} catch (err) {
  console.warn('⚠️  Firebase init failed:', err.message);
}

module.exports = { bucket, firebaseInitialized };
