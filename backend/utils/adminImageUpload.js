const { createHash } = require('node:crypto');

function cleanText(value = '') {
  return String(value || '').trim();
}

function getCloudinaryConfig() {
  return {
    cloudName: cleanText(process.env.CLOUDINARY_CLOUD_NAME || ''),
    apiKey: cleanText(process.env.CLOUDINARY_API_KEY || ''),
    apiSecret: cleanText(process.env.CLOUDINARY_API_SECRET || ''),
  };
}

function isCloudinaryConfigured() {
  const config = getCloudinaryConfig();
  return Boolean(config.cloudName && config.apiKey && config.apiSecret);
}

function buildCloudinarySignature(params = {}, apiSecret = '') {
  const sorted = Object.entries(params)
    .filter(([, value]) => value !== undefined && value !== null && value !== '')
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join('&');

  return createHash('sha1').update(`${sorted}${apiSecret}`).digest('hex');
}

async function uploadImageToCloudinary(dataUri = '', options = {}) {
  const normalizedDataUri = cleanText(dataUri);
  if (!normalizedDataUri.startsWith('data:image/')) {
    const error = new Error('Image upload requires a valid image file.');
    error.statusCode = 400;
    throw error;
  }

  const { cloudName, apiKey, apiSecret } = getCloudinaryConfig();
  if (!cloudName || !apiKey || !apiSecret) {
    const error = new Error('Cloudinary is not configured.');
    error.statusCode = 500;
    throw error;
  }

  const timestamp = Math.floor(Date.now() / 1000);
  const folder = cleanText(options.folder || 'sunwire/manual-news');
  const publicId = cleanText(options.publicId || '');
  const signatureParams = {
    folder,
    timestamp,
    ...(publicId ? { public_id: publicId } : {}),
  };
  const formData = new URLSearchParams({
    file: normalizedDataUri,
    api_key: apiKey,
    timestamp: String(timestamp),
    folder,
    signature: buildCloudinarySignature(signatureParams, apiSecret),
  });

  if (publicId) formData.set('public_id', publicId);

  const response = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/image/upload`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: formData.toString(),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(cleanText(payload?.error?.message || 'Image upload failed.'));
    error.statusCode = 502;
    throw error;
  }

  return {
    url: cleanText(payload.secure_url || payload.url || ''),
    publicId: cleanText(payload.public_id || ''),
    width: Number(payload.width || 0) || null,
    height: Number(payload.height || 0) || null,
  };
}

module.exports = {
  isCloudinaryConfigured,
  uploadImageToCloudinary,
};
