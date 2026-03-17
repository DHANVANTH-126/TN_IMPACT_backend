const { v2: cloudinary } = require('cloudinary');
require('dotenv').config();

const cloudinaryConfigured = Boolean(
  process.env.CLOUDINARY_CLOUD_NAME &&
  process.env.CLOUDINARY_API_KEY &&
  process.env.CLOUDINARY_API_SECRET
);

if (cloudinaryConfigured) {
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
  });
  console.log('✅ Cloudinary initialized');
} else {
  console.warn('⚠️  Cloudinary env vars missing — file uploads will use local fallback');
}

module.exports = { cloudinary, cloudinaryConfigured };