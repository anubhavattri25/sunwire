const axios = require('axios');
const cheerio = require('cheerio');
const { v2: cloudinary } = require('cloudinary');

let cloudinaryConfigured = false;

function configureCloudinary() {
  if (cloudinaryConfigured) return;
  if (process.env.CLOUDINARY_CLOUD_NAME && process.env.CLOUDINARY_API_KEY && process.env.CLOUDINARY_API_SECRET) {
    cloudinary.config({
      cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
      api_key: process.env.CLOUDINARY_API_KEY,
      api_secret: process.env.CLOUDINARY_API_SECRET,
    });
  }
  cloudinaryConfigured = true;
}

async function fetchOpenGraphImage(url) {
  if (!url) return '';
  try {
    const response = await axios.get(url, { timeout: 10000, headers: { 'User-Agent': 'SunwireBot/1.0' } });
    const $ = cheerio.load(response.data);
    return $('meta[property="og:image"]').attr('content') || $('meta[name="twitter:image"]').attr('content') || '';
  } catch (_) {
    return '';
  }
}

async function searchUnsplashImage(query = '') {
  if (!process.env.UNSPLASH_ACCESS_KEY || !query) return '';
  try {
    const response = await axios.get('https://api.unsplash.com/search/photos', {
      timeout: 10000,
      params: { query, per_page: 1, orientation: 'landscape' },
      headers: { Authorization: `Client-ID ${process.env.UNSPLASH_ACCESS_KEY}` },
    });
    return response.data?.results?.[0]?.urls?.regular || '';
  } catch (_) {
    return '';
  }
}

function placeholderImage(title = 'Sunwire') {
  return `https://placehold.co/1200x675/F6E7B5/111111?text=${encodeURIComponent(title.slice(0, 40))}`;
}

async function uploadToCloudinary(imageUrl = '') {
  configureCloudinary();
  if (!imageUrl || !process.env.CLOUDINARY_CLOUD_NAME) return imageUrl;
  try {
    const result = await cloudinary.uploader.upload(imageUrl, {
      folder: 'sunwire/articles',
      overwrite: false,
    });
    return result.secure_url || imageUrl;
  } catch (_) {
    return imageUrl;
  }
}

async function resolveArticleImage(article = {}) {
  const ogImage = article.image_url || await fetchOpenGraphImage(article.source_url);
  const unsplashImage = ogImage || await searchUnsplashImage(article.title || article.category || 'news');
  const chosen = unsplashImage || placeholderImage(article.title || 'Sunwire');
  const uploaded = await uploadToCloudinary(chosen);
  return uploaded || chosen;
}

module.exports = {
  resolveArticleImage,
  fetchOpenGraphImage,
  searchUnsplashImage,
  placeholderImage,
};
