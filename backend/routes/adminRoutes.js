const express = require('express');
const prisma = require('../config/database');
const { articleSelect, toApiArticle } = require('../models/Article');
const { invalidateCache } = require('../utils/cache');
const {
  ADMIN_EMAIL,
  clearAdminSessionCookie,
  readAdminSession,
  setAdminSessionCookie,
  verifyGoogleIdToken,
} = require('../utils/adminAuth');
const { uploadImageToCloudinary } = require('../utils/adminImageUpload');
const {
  buildManualRawContent,
  buildManualSourceUrl,
  expireFeaturedArticles,
  normalizeAdminCategory,
} = require('../utils/adminArticle');
const { slugify } = require('../../lib/seo');

const router = express.Router();

function cleanText(value = '') {
  return String(value || '').trim();
}

function requireExpressAdmin(req, res, next) {
  const session = readAdminSession(req);
  if (session?.email === ADMIN_EMAIL) {
    req.user = session;
    return next();
  }

  clearAdminSessionCookie(res);
  return res.status(403).json({ error: 'Admin access denied.' });
}

function parseFeaturedUntil(body = {}) {
  const minutes = Number(body?.durationMinutes || 0);
  const dateTime = cleanText(body?.featuredUntil || '');
  if (minutes > 0) return new Date(Date.now() + (minutes * 60 * 1000));
  if (!dateTime) return null;
  const parsed = new Date(dateTime);
  if (Number.isNaN(parsed.getTime()) || parsed.getTime() <= Date.now()) return null;
  return parsed;
}

router.get('/admin/session', (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const session = readAdminSession(req);
  return res.json({
    authenticated: Boolean(session?.email === ADMIN_EMAIL),
    adminEmail: ADMIN_EMAIL,
    user: session || null,
  });
});

router.post('/admin/session', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  try {
    const profile = await verifyGoogleIdToken(req.body?.idToken || '');
    if (profile.email !== ADMIN_EMAIL) {
      clearAdminSessionCookie(res);
      return res.status(403).json({ error: 'Admin access denied.' });
    }

    const expiresAt = setAdminSessionCookie(res, profile);
    return res.json({
      ok: true,
      expiresAt,
      user: {
        email: profile.email,
        name: profile.name,
        picture: profile.picture,
      },
    });
  } catch (error) {
    return res.status(Number(error.statusCode || 500)).json({ error: error.message || 'Admin session failed.' });
  }
});

router.delete('/admin/session', (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  clearAdminSessionCookie(res);
  return res.json({ ok: true });
});

router.get('/admin/news', requireExpressAdmin, async (req, res, next) => {
  try {
    await expireFeaturedArticles(prisma);
    const [featured, recentManual] = await Promise.all([
      prisma.article.findFirst({
        where: {
          is_featured: true,
          featured_until: { gt: new Date() },
        },
        select: articleSelect,
        orderBy: [
          { featured_until: 'desc' },
          { created_at: 'desc' },
        ],
      }),
      prisma.article.findMany({
        where: { manual_upload: true },
        select: articleSelect,
        orderBy: [{ created_at: 'desc' }],
        take: 8,
      }),
    ]);

    return res.json({
      ok: true,
      featured: featured ? toApiArticle(featured) : null,
      recent: recentManual.map(toApiArticle),
    });
  } catch (error) {
    return res.status(Number(error.statusCode || 500)).json({ error: error.message || 'Admin news fetch failed.' });
  }
});

router.delete('/admin/news', requireExpressAdmin, async (req, res, next) => {
  try {
    const articleId = cleanText(req.query?.id || '');
    if (!articleId) return res.status(400).json({ error: 'Manual article id is required.' });

    const existing = await prisma.article.findFirst({
      where: {
        id: articleId,
        manual_upload: true,
      },
      select: {
        id: true,
        title: true,
      },
    });

    if (!existing) return res.status(404).json({ error: 'Manual article not found.' });

    await prisma.article.delete({
      where: { id: existing.id },
    });

    await invalidateCache();
    return res.json({
      ok: true,
      removedId: existing.id,
      title: existing.title,
    });
  } catch (error) {
    return res.status(Number(error.statusCode || 500)).json({ error: error.message || 'Manual news removal failed.' });
  }
});

router.post('/admin/upload-image', requireExpressAdmin, async (req, res, next) => {
  try {
    const uploaded = await uploadImageToCloudinary(req.body?.imageData || '', {
      folder: 'sunwire/manual-news',
      publicId: slugify(req.body?.headline || `manual-${Date.now()}`),
    });
    return res.json({
      ok: true,
      image_url: uploaded.url,
      image: uploaded,
    });
  } catch (error) {
    return res.status(Number(error.statusCode || 500)).json({ error: error.message || 'Image upload failed.' });
  }
});

router.post('/admin/news', requireExpressAdmin, async (req, res, next) => {
  try {
    const title = cleanText(req.body?.headline || '');
    const source = cleanText(req.body?.source || '');
    const subheadline = cleanText(req.body?.subheadline || '');
    const category = normalizeAdminCategory(req.body?.category || '');
    const content = String(req.body?.content || '').replace(/\r/g, '').trim();
    const imageUrl = cleanText(req.body?.image_url || '');
    const featuredUntil = parseFeaturedUntil(req.body);

    if (!title) return res.status(400).json({ error: 'Headline is required.' });
    if (!source) return res.status(400).json({ error: 'Source is required.' });
    if (!category) return res.status(400).json({ error: 'Category is invalid.' });
    if (!content || content.length < 80) return res.status(400).json({ error: 'Article content must be at least 80 characters.' });
    if (!imageUrl) return res.status(400).json({ error: 'Image upload is required.' });
    if (!featuredUntil) return res.status(400).json({ error: 'A valid featured duration is required.' });

    const publishedAt = new Date();
    const slug = slugify(title || `manual-${publishedAt.getTime()}`);
    const rawContent = buildManualRawContent({
      title,
      subheadline,
      content,
      source,
      imageUrl,
      category,
      publishedAt: publishedAt.toISOString(),
    });
    const sourceUrl = buildManualSourceUrl({ slug, createdAt: publishedAt });

    const created = await prisma.$transaction(async (tx) => {
      await expireFeaturedArticles(tx);
      await tx.article.updateMany({
        where: { is_featured: true },
        data: { is_featured: false, featured_until: null },
      });

      return tx.article.create({
        data: {
          title,
          slug,
          summary: cleanText(rawContent.summary || '').slice(0, 500) || content.slice(0, 240),
          content,
          image_url: imageUrl,
          image_storage_url: imageUrl,
          category,
          source,
          source_url: sourceUrl,
          published_at: publishedAt,
          word_count: Number(rawContent.wordCount || 0) || null,
          ai_summary: cleanText(rawContent.subheadline || rawContent.summary || '').slice(0, 280) || null,
          raw_content: JSON.stringify(rawContent),
          ai_rewritten: true,
          is_featured: true,
          featured_until: featuredUntil,
          manual_upload: true,
        },
        select: articleSelect,
      });
    });

    await invalidateCache();
    return res.status(201).json({
      ok: true,
      article: toApiArticle(created),
    });
  } catch (error) {
    return res.status(Number(error.statusCode || 500)).json({ error: error.message || 'News push failed.' });
  }
});

module.exports = router;
