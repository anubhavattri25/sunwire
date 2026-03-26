const fs = require('node:fs/promises');
const path = require('node:path');
const prisma = require('../backend/config/database');
const { articleSelect, toApiArticle } = require('../backend/models/Article');
const { countWords } = require('../backend/services/contentQuality');
const { invalidateCache } = require('../backend/utils/cache');
const {
  ADMIN_EMAIL,
  NEWSROOM_ROLES,
  clearAdminSessionCookie,
  readAdminSession,
  requireAdminSession,
  requireSubmitterSession,
  resolveNewsroomRole,
  setAdminSessionCookie,
  verifyGoogleIdToken,
} = require('../backend/utils/adminAuth');
const {
  buildManualRawContent,
  buildManualSourceUrl,
  expireFeaturedArticles,
  normalizeAdminCategory,
  toAdminArticleInput,
} = require('../backend/utils/adminArticle');
const {
  addAuthorizedSubmitter,
  createNewsRequest,
  ensureNewsroomTables,
  getNewsRequestById,
  listAuthorizedSubmitters,
  listNewsRequests,
  mapNewsRequestRecord,
  normalizeEmail,
  removeAuthorizedSubmitter,
  updateNewsRequest,
} = require('../backend/utils/newsroomAccess');
const { uploadImageToCloudinary } = require('../backend/utils/adminImageUpload');
const {
  getDatabaseBusyMessage,
  isDatabaseCoolingDown,
  isDatabasePoolLimitError,
  markDatabasePressure,
  normalizeDatabaseError,
} = require('../backend/utils/databaseAvailability');
const { readJsonBody } = require('../backend/utils/requestBody');
const { slugify } = require('../lib/seo');

const MIN_BODY_WORDS = 500;
const MIN_SUMMARY_WORDS = 20;
const MIN_PARAGRAPHS = 4;
const MIN_KEY_POINTS = 3;
const MIN_FACT_SHEET_ROWS = 4;
const MIN_BACKGROUND_ITEMS = 2;
const ADMIN_PAGE_MODES = new Set(['news-requests', 'edit-news', 'watch-all-news', 'submit-request', 'access-control']);
const adminDashboardCache = globalThis.__SUNWIRE_ADMIN_DASHBOARD_CACHE__ || {
  summary: null,
  archive: null,
};

globalThis.__SUNWIRE_ADMIN_DASHBOARD_CACHE__ = adminDashboardCache;

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

function allowedModesForRole(role = '') {
  if (role === NEWSROOM_ROLES.ADMIN) {
    return ['news-requests', 'edit-news', 'watch-all-news', 'access-control'];
  }
  if (role === NEWSROOM_ROLES.SUBMITTER) {
    return ['submit-request'];
  }
  return [];
}

function defaultModeForRole(role = '') {
  return role === NEWSROOM_ROLES.ADMIN ? 'news-requests' : 'submit-request';
}

function normalizePageMode(value = '', role = '') {
  const normalized = cleanText(value).toLowerCase();
  const allowed = allowedModesForRole(role);
  if (allowed.includes(normalized) && ADMIN_PAGE_MODES.has(normalized)) return normalized;
  return defaultModeForRole(role);
}

function normalizeStringArray(values = [], maxItems = 8) {
  return (Array.isArray(values) ? values : [])
    .map((entry) => cleanText(entry))
    .filter(Boolean)
    .slice(0, maxItems);
}

function normalizeFactSheetRows(rows = [], maxItems = 8) {
  return (Array.isArray(rows) ? rows : [])
    .map((row) => ({
      label: cleanText(row?.label || ''),
      value: cleanText(row?.value || ''),
    }))
    .filter((row) => row.label && row.value)
    .slice(0, maxItems);
}

function normalizeBackgroundItems(items = [], maxItems = 6) {
  return (Array.isArray(items) ? items : [])
    .map((item) => ({
      title: cleanText(item?.title || ''),
      context: cleanText(item?.context || ''),
      url: cleanText(item?.url || ''),
      source: cleanText(item?.source || ''),
    }))
    .filter((item) => item.title && item.context)
    .slice(0, maxItems);
}

function countParagraphs(value = '') {
  return String(value || '')
    .replace(/\r/g, '')
    .split(/\n{2,}/)
    .map((entry) => cleanText(entry))
    .filter(Boolean)
    .length;
}

function parseFeaturedUntil(body = {}) {
  if (!body?.showOnHero) return null;

  const minutes = Number(body?.durationMinutes || 0);
  const dateTime = cleanText(body?.featuredUntil || '');

  if (minutes > 0) return new Date(Date.now() + (minutes * 60 * 1000));
  if (!dateTime) return null;

  const parsed = new Date(dateTime);
  if (Number.isNaN(parsed.getTime()) || parsed.getTime() <= Date.now()) return null;
  return parsed;
}

function normalizeAdminPayload(body = {}) {
  const content = String(body?.content || '').replace(/\r/g, '').trim();
  const subheadline = cleanText(body?.subheadline || '');
  const source = cleanText(body?.source || '');
  const primarySourceName = cleanText(body?.primarySourceName || source);

  return {
    id: cleanText(body?.id || ''),
    title: cleanText(body?.headline || ''),
    subheadline,
    source,
    authorName: cleanText(body?.authorName || 'Sunwire News Desk'),
    primarySourceName,
    primarySourceUrl: cleanText(body?.primarySourceUrl || ''),
    category: normalizeAdminCategory(body?.category || ''),
    imageUrl: cleanText(body?.image_url || ''),
    content,
    tags: normalizeStringArray(body?.tags || [], 8),
    keyPoints: normalizeStringArray(body?.keyPoints || [], 6),
    factSheet: normalizeFactSheetRows(body?.factSheet || [], 8),
    background: normalizeBackgroundItems(body?.background || [], 6),
    indiaPulse: cleanText(body?.indiaPulse || ''),
    metaTitle: cleanText(body?.metaTitle || ''),
    metaDescription: cleanText(body?.metaDescription || ''),
    showOnHero: Boolean(body?.showOnHero),
    featuredUntil: parseFeaturedUntil(body),
  };
}

function validateAdminPayload(payload = {}) {
  const errors = [];
  const summaryWords = countWords(payload.subheadline || '');
  const bodyWords = countWords(payload.content || '');
  const paragraphCount = countParagraphs(payload.content || '');

  if (!payload.title) errors.push('Headline is required.');
  if (!payload.subheadline) errors.push('Under-headline is required.');
  if (payload.subheadline && summaryWords < MIN_SUMMARY_WORDS) {
    errors.push(`Under-headline should be at least ${MIN_SUMMARY_WORDS} words for article quality.`);
  }
  if (!payload.authorName) errors.push('Author name is required.');
  if (!payload.source) errors.push('Source label is required.');
  if (!payload.primarySourceName) errors.push('Primary source name is required.');
  if (!payload.primarySourceUrl || !/^https?:\/\//i.test(payload.primarySourceUrl)) {
    errors.push('Primary source URL must be a valid link.');
  }
  if (!payload.category) errors.push('Category is invalid.');
  if (!payload.imageUrl) errors.push('Image upload is required.');
  if (!payload.metaTitle) errors.push('SEO title is required.');
  if (!payload.metaDescription) errors.push('SEO description is required.');
  if (!payload.content) errors.push('Article content is required.');
  if (payload.content && bodyWords < MIN_BODY_WORDS) {
    errors.push(`Article content should be at least ${MIN_BODY_WORDS} words for ad-ready article pages.`);
  }
  if (payload.content && paragraphCount < MIN_PARAGRAPHS) {
    errors.push(`Article content should have at least ${MIN_PARAGRAPHS} paragraphs.`);
  }
  if (payload.keyPoints.length < MIN_KEY_POINTS) {
    errors.push(`Add at least ${MIN_KEY_POINTS} key points.`);
  }
  if (payload.factSheet.length < MIN_FACT_SHEET_ROWS) {
    errors.push(`Add at least ${MIN_FACT_SHEET_ROWS} fact sheet rows.`);
  }
  if (payload.background.length < MIN_BACKGROUND_ITEMS) {
    errors.push(`Add at least ${MIN_BACKGROUND_ITEMS} background/context blocks.`);
  }
  if (!payload.indiaPulse || countWords(payload.indiaPulse) < 18) {
    errors.push('Why it matters / reader context is required.');
  }
  if (payload.showOnHero && !payload.featuredUntil) {
    errors.push('Choose how long this article should stay on the hero card.');
  }

  return errors;
}

async function saveManualArticle(tx, payload = {}, options = {}) {
  const existing = options.existing || null;
  const createdAt = existing?.created_at || new Date();
  const publishedAt = options.publishedAt || existing?.published_at || new Date();
  const slug = slugify(payload.title || `manual-${publishedAt.getTime()}`);
  const rawContent = buildManualRawContent({
    title: payload.title,
    subheadline: payload.subheadline,
    content: payload.content,
    source: payload.source,
    authorName: payload.authorName,
    primarySourceName: payload.primarySourceName,
    primarySourceUrl: payload.primarySourceUrl,
    imageUrl: payload.imageUrl,
    category: payload.category,
    tags: payload.tags,
    keyPoints: payload.keyPoints,
    factSheet: payload.factSheet,
    background: payload.background,
    indiaPulse: payload.indiaPulse,
    metaTitle: payload.metaTitle,
    metaDescription: payload.metaDescription,
    publishedAt: publishedAt.toISOString(),
  });
  const sourceUrl = buildManualSourceUrl({ slug, createdAt });
  const wordCount = Number(rawContent.wordCount || 0) || null;

  if (payload.showOnHero) {
    const featuredWhere = { is_featured: true };
    if (existing?.id) featuredWhere.NOT = { id: existing.id };
    await tx.article.updateMany({
      where: featuredWhere,
      data: {
        is_featured: false,
        featured_until: null,
      },
    });
  }

  const data = {
    title: payload.title,
    slug,
    summary: cleanText(rawContent.summary || '').slice(0, 500) || payload.content.slice(0, 240),
    content: payload.content,
    image_url: payload.imageUrl,
    image_storage_url: payload.imageUrl,
    source: payload.source,
    source_url: sourceUrl,
    category: payload.category,
    published_at: publishedAt,
    word_count: wordCount,
    ai_summary: cleanText(rawContent.subheadline || rawContent.summary || '').slice(0, 280) || null,
    raw_content: JSON.stringify(rawContent),
    ai_rewritten: true,
    is_featured: payload.showOnHero,
    featured_until: payload.showOnHero ? payload.featuredUntil : null,
    trending_score: payload.showOnHero ? 0 : 999,
    manual_upload: true,
  };

  if (existing?.id) {
    return tx.article.update({
      where: { id: existing.id },
      data,
      select: articleSelect,
    });
  }

  return tx.article.create({
    data,
    select: articleSelect,
  });
}

async function renderAdminPage(req, res) {
  if (req.method !== 'GET') {
    res.status(405).send('Method not allowed');
    return;
  }

  const session = await requireSubmitterSession(req, res, {
    redirectTo: '/',
    trustSignedRole: true,
  });
  if (!session) return;

  const templatePath = path.join(process.cwd(), 'templates', 'admin-news.html');
  let template = await fs.readFile(templatePath, 'utf8');
  const mode = normalizePageMode(req.query?.mode || '', session.role);
  if (session.role !== 'admin') {
    template = template.replace(/data-admin-only="true"/g, 'data-admin-only="true" hidden');
  }
  if (session.role !== 'submitter') {
    template = template.replace(/data-submitter-only="true"/g, 'data-submitter-only="true" hidden');
  }
  const runtimeScript = [
    '<script>',
    `window.__SUNWIRE_GOOGLE_CLIENT_ID__=${JSON.stringify(resolveGoogleClientId())};`,
    `window.__SUNWIRE_ADMIN_EMAIL__=${JSON.stringify(ADMIN_EMAIL)};`,
    `window.__SUNWIRE_ADMIN_USER__=${JSON.stringify(session)};`,
    `window.__SUNWIRE_ADMIN_ROLE__=${JSON.stringify(session.role)};`,
    `window.__SUNWIRE_ADMIN_PAGE_MODE__=${JSON.stringify(mode)};`,
    '(function(){var role=String(window.__SUNWIRE_ADMIN_ROLE__||"").toLowerCase();document.querySelectorAll("[data-admin-only]").forEach(function(node){node.hidden=role!=="admin";});document.querySelectorAll("[data-submitter-only]").forEach(function(node){node.hidden=role!=="submitter";});})();',
    '</script>',
    '<script type="module" src="/admin/news.js?v=20260327-10"></script>',
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
    const session = await readAdminSession(req, { trustSignedRole: true });
    return res.status(200).json({
      authenticated: Boolean(session?.email),
      adminEmail: ADMIN_EMAIL,
      role: cleanText(session?.role || ''),
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
  await ensureNewsroomTables(prisma);
  const profile = await verifyGoogleIdToken(body?.idToken || '');
  const role = await resolveNewsroomRole(profile.email);
  if (!role) {
    clearAdminSessionCookie(res);
    return res.status(403).json({ error: 'News dashboard access denied.' });
  }

  const expiresAt = setAdminSessionCookie(res, { ...profile, role });
  return res.status(200).json({
    ok: true,
    expiresAt,
    adminEmail: ADMIN_EMAIL,
    role,
    user: {
      email: profile.email,
      name: profile.name,
      picture: profile.picture,
      role,
    },
  });
}

function buildAdminSummaryResponse({
  featured = null,
  recent = [],
  totalManual = 0,
  pendingRequests = null,
  submitterCount = null,
} = {}) {
  const response = {
    ok: true,
    featured: featured ? toApiArticle(featured) : null,
    recent: recent.map(toApiArticle),
    totalManual,
  };

  if (Number.isFinite(pendingRequests)) {
    response.pendingRequests = pendingRequests;
  }
  if (Number.isFinite(submitterCount)) {
    response.submitterCount = submitterCount;
  }

  return response;
}

async function fetchAdminSummary(options = {}) {
  const includeCounts = options.includeCounts !== false;
  const cachedSummary = adminDashboardCache.summary;
  const fallbackSummary = includeCounts
    ? (cachedSummary || buildAdminSummaryResponse({
      featured: null,
      recent: [],
      totalManual: 0,
      pendingRequests: 0,
      submitterCount: 0,
    }))
    : (cachedSummary || buildAdminSummaryResponse({
      featured: null,
      recent: [],
      totalManual: 0,
    }));

  if (isDatabaseCoolingDown()) {
    return {
      ...fallbackSummary,
      degraded: true,
      message: getDatabaseBusyMessage(),
    };
  }

  try {
    await ensureNewsroomTables(prisma);
    await expireFeaturedArticles(prisma);
    const [featured, recentManual, totalManual] = await prisma.$transaction([
      prisma.article.findFirst({
        where: {
          manual_upload: true,
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
        take: 12,
      }),
      prisma.article.count({ where: { manual_upload: true } }),
    ]);

    let response;
    if (!includeCounts) {
      response = buildAdminSummaryResponse({
        featured,
        recent: recentManual,
        totalManual,
      });
    } else {
      const counts = await prisma.$transaction(async (tx) => {
        const pending = await listNewsRequests(tx, { status: 'pending', limit: 100 });
        const submitters = await listAuthorizedSubmitters(tx);
        return {
          pendingRequests: pending.length,
          submitterCount: submitters.length,
        };
      });

      response = buildAdminSummaryResponse({
        featured,
        recent: recentManual,
        totalManual,
        pendingRequests: counts.pendingRequests,
        submitterCount: counts.submitterCount,
      });
    }

    adminDashboardCache.summary = response;
    return response;
  } catch (error) {
    if (isDatabasePoolLimitError(error)) {
      markDatabasePressure(error);
      return {
        ...fallbackSummary,
        degraded: true,
        message: getDatabaseBusyMessage(),
      };
    }
    throw error;
  }
}

async function fetchAdminArchive() {
  const fallbackArchive = adminDashboardCache.archive || {
    ok: true,
    items: [],
    total: 0,
  };

  if (isDatabaseCoolingDown()) {
    return {
      ...fallbackArchive,
      degraded: true,
      message: getDatabaseBusyMessage(),
    };
  }

  try {
    await expireFeaturedArticles(prisma);
    const records = await prisma.article.findMany({
      where: { manual_upload: true },
      select: articleSelect,
      orderBy: [{ created_at: 'desc' }],
      take: 500,
    });

    const response = {
      ok: true,
      items: records.map((record) => {
        const article = toApiArticle(record);
        return {
          ...article,
          created_at: record.created_at,
          published_at: record.published_at,
          is_featured: Boolean(record.is_featured),
          featured_until: record.featured_until,
        };
      }),
      total: records.length,
    };

    adminDashboardCache.archive = response;
    return response;
  } catch (error) {
    if (isDatabasePoolLimitError(error)) {
      markDatabasePressure(error);
      return {
        ...fallbackArchive,
        degraded: true,
        message: getDatabaseBusyMessage(),
      };
    }
    throw error;
  }
}

async function fetchAdminArticle(articleId = '') {
  const existing = await prisma.article.findFirst({
    where: {
      id: cleanText(articleId || ''),
      manual_upload: true,
    },
    select: articleSelect,
  });

  if (!existing) return null;
  return toAdminArticleInput(existing);
}

async function upsertManualArticle(req, res, method = 'POST') {
  const session = await requireAdminSession(req, res);
  if (!session) return;

  const body = await readJsonBody(req);
  const payload = normalizeAdminPayload(body);
  const errors = validateAdminPayload(payload);
  if (errors.length) {
    return res.status(400).json({ error: errors[0], errors });
  }

  const isUpdate = method === 'PUT';
  const articleId = cleanText(req.query?.id || payload.id || '');
  if (isUpdate && !articleId) {
    return res.status(400).json({ error: 'Manual article id is required for updates.' });
  }

  let existing = null;
  if (isUpdate) {
    existing = await prisma.article.findFirst({
      where: {
        id: articleId,
        manual_upload: true,
      },
      select: articleSelect,
    });

    if (!existing) {
      return res.status(404).json({ error: 'Manual article not found.' });
    }
  }

  const saved = await prisma.$transaction(async (tx) => {
    await expireFeaturedArticles(tx);
    return saveManualArticle(tx, payload, { existing });
  });

  await invalidateCache();

  return res.status(isUpdate ? 200 : 201).json({
    ok: true,
    article: toApiArticle(saved),
    adminArticle: toAdminArticleInput(saved),
  });
}

async function handleNews(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'GET') {
    const session = await requireAdminSession(req, res);
    if (!session) return;

    const articleId = cleanText(req.query?.id || '');
    if (articleId) {
      const article = await fetchAdminArticle(articleId);
      if (!article) return res.status(404).json({ error: 'Manual article not found.' });
      return res.status(200).json({ ok: true, article });
    }

    const scope = cleanText(req.query?.scope || '');
    if (scope === 'all') {
      return res.status(200).json(await fetchAdminArchive());
    }
    if (scope === 'editor') {
      return res.status(200).json(await fetchAdminSummary({ includeCounts: false }));
    }

    return res.status(200).json(await fetchAdminSummary());
  }

  if (req.method === 'PATCH') {
    const session = await requireAdminSession(req, res);
    if (!session) return;

    const action = cleanText(req.query?.action || '').toLowerCase();
    if (action !== 'remove-hero') {
      return res.status(400).json({ error: 'Unsupported admin news action.' });
    }

    const articleId = cleanText(req.query?.id || '');
    if (!articleId) return res.status(400).json({ error: 'Manual article id is required.' });

    const existing = await prisma.article.findFirst({
      where: {
        id: articleId,
        manual_upload: true,
      },
      select: articleSelect,
    });

    if (!existing) {
      return res.status(404).json({ error: 'Manual article not found.' });
    }

    const updated = await prisma.article.update({
      where: { id: existing.id },
      data: {
        is_featured: false,
        featured_until: null,
      },
      select: articleSelect,
    });

    await invalidateCache();

    return res.status(200).json({
      ok: true,
      article: toApiArticle(updated),
      adminArticle: toAdminArticleInput(updated),
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

  if (req.method === 'POST') {
    return upsertManualArticle(req, res, 'POST');
  }

  if (req.method === 'PUT') {
    return upsertManualArticle(req, res, 'PUT');
  }

  return res.status(405).json({ error: 'Method not allowed.' });
}

async function handleRequests(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'GET') {
    const session = await requireSubmitterSession(req, res);
    if (!session) return;

    const requestId = cleanText(req.query?.id || '');
    if (requestId) {
      const request = await getNewsRequestById(prisma, requestId);
      const mapped = request ? mapNewsRequestRecord(request) : null;
      if (!mapped) return res.status(404).json({ error: 'News request not found.' });
      if (session.role !== NEWSROOM_ROLES.ADMIN && mapped.requesterEmail !== normalizeEmail(session.email)) {
        return res.status(403).json({ error: 'News request access denied.' });
      }
      return res.status(200).json({ ok: true, request: mapped });
    }

    const items = await listNewsRequests(prisma, {
      status: cleanText(req.query?.status || ''),
      requesterEmail: session.role === NEWSROOM_ROLES.ADMIN ? '' : session.email,
      limit: 200,
    });
    return res.status(200).json({
      ok: true,
      items: items.map(mapNewsRequestRecord),
    });
  }

  if (req.method === 'POST') {
    const session = await requireSubmitterSession(req, res);
    if (!session) return;

    const body = await readJsonBody(req);
    const payload = normalizeAdminPayload(body);
    const errors = validateAdminPayload(payload);
    if (errors.length) {
      return res.status(400).json({ error: errors[0], errors });
    }

    const created = await createNewsRequest(prisma, session, {
      headline: payload.title,
      subheadline: payload.subheadline,
      authorName: payload.authorName,
      source: payload.source,
      primarySourceName: payload.primarySourceName,
      primarySourceUrl: payload.primarySourceUrl,
      category: payload.category,
      image_url: payload.imageUrl,
      content: payload.content,
      tags: payload.tags,
      keyPoints: payload.keyPoints,
      factSheet: payload.factSheet,
      background: payload.background,
      indiaPulse: payload.indiaPulse,
      metaTitle: payload.metaTitle,
      metaDescription: payload.metaDescription,
      showOnHero: payload.showOnHero,
      durationMinutes: 0,
      featuredUntil: payload.featuredUntil ? new Date(payload.featuredUntil).toISOString() : '',
    });

    return res.status(201).json({
      ok: true,
      request: mapNewsRequestRecord(created),
    });
  }

  if (req.method === 'PATCH') {
    const session = await requireAdminSession(req, res);
    if (!session) return;

    const requestId = cleanText(req.query?.id || '');
    const action = cleanText(req.query?.action || '').toLowerCase();
    if (!requestId) return res.status(400).json({ error: 'News request id is required.' });
    if (!['approve', 'reject'].includes(action)) {
      return res.status(400).json({ error: 'Unsupported request action.' });
    }

    const existing = await getNewsRequestById(prisma, requestId);
    const mapped = existing ? mapNewsRequestRecord(existing) : null;
    if (!mapped) return res.status(404).json({ error: 'News request not found.' });
    if (mapped.status !== 'pending') return res.status(400).json({ error: 'Only pending requests can be reviewed.' });

    if (action === 'reject') {
      const updated = await updateNewsRequest(prisma, requestId, {
        status: 'rejected',
        reviewer_note: cleanText((await readJsonBody(req))?.reviewerNote || ''),
        reviewed_by_email: normalizeEmail(session.email),
        reviewed_at: new Date(),
      });
      return res.status(200).json({ ok: true, request: mapNewsRequestRecord(updated) });
    }

    const payload = normalizeAdminPayload(mapped.payload || {});
    const errors = validateAdminPayload(payload);
    if (errors.length) {
      return res.status(400).json({ error: errors[0], errors });
    }

    const saved = await prisma.$transaction(async (tx) => {
      await expireFeaturedArticles(tx);
      const article = await saveManualArticle(tx, payload, {});
      await updateNewsRequest(tx, requestId, {
        status: 'approved',
        reviewer_note: '',
        reviewed_by_email: normalizeEmail(session.email),
        reviewed_at: new Date(),
        published_article_id: article.id,
      });
      return article;
    });

    await invalidateCache();
    const updated = await getNewsRequestById(prisma, requestId);
    return res.status(200).json({
      ok: true,
      request: mapNewsRequestRecord(updated),
      article: toApiArticle(saved),
      adminArticle: toAdminArticleInput(saved),
    });
  }

  return res.status(405).json({ error: 'Method not allowed.' });
}

async function handleAccess(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const session = await requireAdminSession(req, res);
  if (!session) return;

  if (req.method === 'GET') {
    const items = await listAuthorizedSubmitters(prisma);
    return res.status(200).json({
      ok: true,
      items: items.map((item) => ({
        email: normalizeEmail(item.email),
        createdByEmail: normalizeEmail(item.created_by_email),
        createdAt: item.created_at,
        updatedAt: item.updated_at,
      })),
    });
  }

  if (req.method === 'POST') {
    const body = await readJsonBody(req);
    const email = normalizeEmail(body?.email || '');
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: 'Enter a valid email address.' });
    }
    if (email === ADMIN_EMAIL) {
      return res.status(400).json({ error: 'Primary admin already has access.' });
    }

    const added = await addAuthorizedSubmitter(prisma, email, session.email);
    return res.status(201).json({
      ok: true,
      item: {
        email: normalizeEmail(added.email),
        createdByEmail: normalizeEmail(added.created_by_email),
        createdAt: added.created_at,
        updatedAt: added.updated_at,
      },
    });
  }

  if (req.method === 'DELETE') {
    const email = normalizeEmail(req.query?.email || '');
    if (!email) return res.status(400).json({ error: 'Email is required.' });
    await removeAuthorizedSubmitter(prisma, email);
    return res.status(200).json({ ok: true, removedEmail: email });
  }

  return res.status(405).json({ error: 'Method not allowed.' });
}

async function handleUpload(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed.' });
  }

  const session = await requireSubmitterSession(req, res);
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
    await ensureNewsroomTables(prisma);
    if (view === 'page') return await renderAdminPage(req, res);
    if (view === 'session') return await handleSession(req, res);
    if (view === 'news') return await handleNews(req, res);
    if (view === 'requests') return await handleRequests(req, res);
    if (view === 'access') return await handleAccess(req, res);
    if (view === 'upload') return await handleUpload(req, res);
    return res.status(404).json({ error: 'Admin route not found.' });
  } catch (error) {
    const normalizedError = normalizeDatabaseError(error, 'Admin request failed.');
    const statusCode = Number(normalizedError.statusCode || 500);
    if (!res.headersSent) {
      if (view === 'page') {
        return res.status(statusCode).send(normalizedError.message || 'Admin page failed.');
      }
      return res.status(statusCode).json({ error: normalizedError.message || 'Admin request failed.' });
    }
  }
};
