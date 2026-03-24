const fs = require('node:fs/promises');
const path = require('node:path');
const prisma = require('../backend/config/database');
const { articleSelect, toApiArticle } = require('../backend/models/Article');
const { invalidateCache } = require('../backend/utils/cache');
const {
  ADMIN_EMAIL,
  clearAdminSessionCookie,
  readAdminSession,
  requireAdminSession,
  setAdminSessionCookie,
  verifyGoogleIdToken,
} = require('../backend/utils/adminAuth');
const {
  buildManualRawContent,
  buildManualSourceUrl,
  expireFeaturedArticles,
  normalizeAdminCategory,
  normalizeAdminPlacement,
} = require('../backend/utils/adminArticle');
const { uploadImageToCloudinary } = require('../backend/utils/adminImageUpload');
const { readJsonBody } = require('../backend/utils/requestBody');
const { slugify } = require('../lib/seo');

function cleanText(value = '') {
  return String(value || '').trim();
}

function resolveGoogleClientId() {
  return String(
    process.env.GOOGLE_CLIENT_ID
    || process.env.GOOGLE_AUTH_CLIENT_ID
    || process.env.GOOGLE_OAUTH_CLIENT_ID
    || process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID
    || ''
  ).trim();
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

async function renderAdminPage(req, res) {
  if (req.method !== 'GET') {
    res.status(405).send('Method not allowed');
    return;
  }

  const session = await requireAdminSession(req, res, { redirectTo: '/' });
  if (!session) return;

  const templatePath = path.join(process.cwd(), 'templates', 'admin-news.html');
  const template = await fs.readFile(templatePath, 'utf8');
  const runtimeScript = [
    '<script>',
    `window.__SUNWIRE_GOOGLE_CLIENT_ID__=${JSON.stringify(resolveGoogleClientId())};`,
    `window.__SUNWIRE_ADMIN_EMAIL__=${JSON.stringify(ADMIN_EMAIL)};`,
    `window.__SUNWIRE_ADMIN_USER__=${JSON.stringify(session)};`,
    '</script>',
    '<script type="module" src="/admin/news.js?v=20260324-5"></script>',
  ].join('');

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).send(
    String(template).replace(
      /<script type="module" src="\/admin\/news\.js\?v=[^"]+"><\/script>/,
      runtimeScript
    )
  );
}

async function handleSession(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'GET') {
    const session = readAdminSession(req);
    return res.status(200).json({
      authenticated: Boolean(session?.email === ADMIN_EMAIL),
      adminEmail: ADMIN_EMAIL,
      user: session || null,
    });
  }

  if (req.method === 'DELETE') {
    clearAdminSessionCookie(res);
    return res.status(200).json({ ok: true });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed.' });
  }

  const body = await readJsonBody(req);
  const profile = await verifyGoogleIdToken(body?.idToken || '');
  if (profile.email !== ADMIN_EMAIL) {
    clearAdminSessionCookie(res);
    return res.status(403).json({ error: 'Admin access denied.' });
  }

  const expiresAt = setAdminSessionCookie(res, profile);
  return res.status(200).json({
    ok: true,
    expiresAt,
    adminEmail: ADMIN_EMAIL,
    user: {
      email: profile.email,
      name: profile.name,
      picture: profile.picture,
    },
  });
}

async function handleNews(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'GET') {
    const session = await requireAdminSession(req, res);
    if (!session) return;

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

    return res.status(200).json({
      ok: true,
      featured: featured ? toApiArticle(featured) : null,
      recent: recentManual.map(toApiArticle),
    });
  }

  if (req.method === 'DELETE') {
    const session = await requireAdminSession(req, res);
    if (!session) return;

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

    if (!existing) {
      return res.status(404).json({ error: 'Manual article not found.' });
    }

    await prisma.article.delete({
      where: { id: existing.id },
    });
    await invalidateCache();

    return res.status(200).json({
      ok: true,
      removedId: existing.id,
      title: existing.title,
    });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed.' });
  }

  const session = await requireAdminSession(req, res);
  if (!session) return;

  const body = await readJsonBody(req);
  const title = cleanText(body?.headline || '');
  const subheadline = cleanText(body?.subheadline || '');
  const source = cleanText(body?.source || '');
  const category = normalizeAdminCategory(body?.category || '');
  const placement = normalizeAdminPlacement(body?.placement || 'headline');
  const content = String(body?.content || '').replace(/\r/g, '').trim();
  const imageUrl = cleanText(body?.image_url || '');
  const featuredUntil = parseFeaturedUntil(body);

  if (!title) return res.status(400).json({ error: 'Headline is required.' });
  if (!source) return res.status(400).json({ error: 'Source is required.' });
  if (!category) return res.status(400).json({ error: 'Category is invalid.' });
  if (!content || content.length < 80) return res.status(400).json({ error: 'Article content must be at least 80 characters.' });
  if (!imageUrl) return res.status(400).json({ error: 'Image upload is required.' });
  if (!featuredUntil) return res.status(400).json({ error: 'A valid featured duration is required.' });

  const isHeadlinePlacement = placement === 'headline';

  const publishedAt = new Date();
  const slug = slugify(title || `manual-${publishedAt.getTime()}`);
  const rawContent = buildManualRawContent({
    title,
    subheadline,
    content,
    source,
    imageUrl,
    category,
    placement,
    publishedAt: publishedAt.toISOString(),
  });
  const sourceUrl = buildManualSourceUrl({ slug, createdAt: publishedAt });
  const wordCount = Number(rawContent.wordCount || 0) || null;

  const created = await prisma.$transaction(async (tx) => {
    await expireFeaturedArticles(tx);

    if (isHeadlinePlacement) {
      await tx.article.updateMany({
        where: { is_featured: true },
        data: {
          is_featured: false,
          featured_until: null,
        },
      });
    }

    return tx.article.create({
      data: {
        title,
        slug,
        summary: cleanText(rawContent.summary || '').slice(0, 500) || content.slice(0, 240),
        content,
        image_url: imageUrl,
        image_storage_url: imageUrl,
        source,
        source_url: sourceUrl,
        category,
        published_at: publishedAt,
        word_count: wordCount,
        ai_summary: cleanText(rawContent.subheadline || rawContent.summary || '').slice(0, 280) || null,
        raw_content: JSON.stringify(rawContent),
        ai_rewritten: true,
        is_featured: isHeadlinePlacement,
        featured_until: isHeadlinePlacement ? featuredUntil : null,
        trending_score: isHeadlinePlacement ? 0 : 999,
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
}

async function handleUpload(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed.' });
  }

  const session = await requireAdminSession(req, res);
  if (!session) return;

  const body = await readJsonBody(req);
  const uploaded = await uploadImageToCloudinary(body?.imageData || '', {
    folder: 'sunwire/manual-news',
    publicId: slugify(body?.headline || `manual-${Date.now()}`),
  });

  return res.status(200).json({
    ok: true,
    image_url: uploaded.url,
    image: uploaded,
  });
}

module.exports = async function handler(req, res) {
  const view = cleanText(req.query?.view || '');

  try {
    if (view === 'page') return await renderAdminPage(req, res);
    if (view === 'session') return await handleSession(req, res);
    if (view === 'news') return await handleNews(req, res);
    if (view === 'upload') return await handleUpload(req, res);
    return res.status(404).json({ error: 'Admin route not found.' });
  } catch (error) {
    const statusCode = Number(error.statusCode || 500);
    if (!res.headersSent) {
      if (view === 'page') {
        return res.status(statusCode).send(error.message || 'Admin page failed.');
      }
      return res.status(statusCode).json({ error: error.message || 'Admin request failed.' });
    }
  }
};
