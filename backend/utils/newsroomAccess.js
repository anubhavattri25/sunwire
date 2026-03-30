const { randomUUID } = require('node:crypto');
const globalForNewsroomTables = globalThis;

function shouldSkipRuntimeTableSetup() {
  return process.env.VERCEL === '1'
    || process.env.VERCEL === 'true'
    || process.env.NODE_ENV === 'production';
}

function cleanText(value = '') {
  return String(value || '').trim();
}

function normalizeEmail(value = '') {
  return cleanText(value).toLowerCase();
}

async function ensureNewsroomTables(prisma) {
  if (shouldSkipRuntimeTableSetup()) {
    globalForNewsroomTables.__sunwireNewsroomTablesReady = true;
    return;
  }
  if (globalForNewsroomTables.__sunwireNewsroomTablesReady) return;
  if (globalForNewsroomTables.__sunwireNewsroomTablesPromise) {
    await globalForNewsroomTables.__sunwireNewsroomTablesPromise;
    return;
  }

  globalForNewsroomTables.__sunwireNewsroomTablesPromise = (async () => {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS newsroom_submitter_access (
        email TEXT PRIMARY KEY,
        created_by_email TEXT NOT NULL DEFAULT '',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS newsroom_news_requests (
        id TEXT PRIMARY KEY,
        requester_email TEXT NOT NULL,
        requester_name TEXT NOT NULL DEFAULT '',
        requester_picture TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'pending',
        requested_headline TEXT NOT NULL DEFAULT '',
        requested_category TEXT NOT NULL DEFAULT '',
        wants_hero BOOLEAN NOT NULL DEFAULT FALSE,
        payload JSONB NOT NULL,
        reviewer_note TEXT NOT NULL DEFAULT '',
        reviewed_by_email TEXT NOT NULL DEFAULT '',
        reviewed_at TIMESTAMPTZ NULL,
        published_article_id UUID NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    await prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS newsroom_news_requests_status_created_idx
      ON newsroom_news_requests (status, created_at DESC);
    `);

    await prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS newsroom_news_requests_requester_created_idx
      ON newsroom_news_requests (requester_email, created_at DESC);
    `);

    globalForNewsroomTables.__sunwireNewsroomTablesReady = true;
  })();

  try {
    await globalForNewsroomTables.__sunwireNewsroomTablesPromise;
  } catch (error) {
    globalForNewsroomTables.__sunwireNewsroomTablesPromise = null;
    throw error;
  }
}

async function listAuthorizedSubmitters(prisma) {
  await ensureNewsroomTables(prisma);
  const rows = await prisma.$queryRawUnsafe(`
    SELECT email, created_by_email, created_at, updated_at
    FROM newsroom_submitter_access
    ORDER BY email ASC;
  `);
  return Array.isArray(rows) ? rows : [];
}

async function hasSubmitterAccess(prisma, email = '') {
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail) return false;
  await ensureNewsroomTables(prisma);
  const rows = await prisma.$queryRawUnsafe(`
    SELECT email
    FROM newsroom_submitter_access
    WHERE email = $1
    LIMIT 1;
  `, normalizedEmail);
  return Array.isArray(rows) && rows.length > 0;
}

async function addAuthorizedSubmitter(prisma, email = '', createdByEmail = '') {
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail) {
    const error = new Error('Email is required.');
    error.statusCode = 400;
    throw error;
  }

  await ensureNewsroomTables(prisma);
  await prisma.$executeRawUnsafe(`
    INSERT INTO newsroom_submitter_access (email, created_by_email, updated_at)
    VALUES ($1, $2, NOW())
    ON CONFLICT (email)
    DO UPDATE SET created_by_email = EXCLUDED.created_by_email, updated_at = NOW();
  `, normalizedEmail, normalizeEmail(createdByEmail));

  const rows = await prisma.$queryRawUnsafe(`
    SELECT email, created_by_email, created_at, updated_at
    FROM newsroom_submitter_access
    WHERE email = $1
    LIMIT 1;
  `, normalizedEmail);
  return rows?.[0] || null;
}

async function removeAuthorizedSubmitter(prisma, email = '') {
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail) {
    const error = new Error('Email is required.');
    error.statusCode = 400;
    throw error;
  }

  await ensureNewsroomTables(prisma);
  await prisma.$executeRawUnsafe(`
    DELETE FROM newsroom_submitter_access
    WHERE email = $1;
  `, normalizedEmail);
}

function toNewsRequestPayload(payload = {}) {
  return {
    headline: cleanText(payload.headline || ''),
    subheadline: cleanText(payload.subheadline || ''),
    authorName: cleanText(payload.authorName || ''),
    source: cleanText(payload.source || ''),
    primarySourceName: cleanText(payload.primarySourceName || ''),
    primarySourceUrl: cleanText(payload.primarySourceUrl || ''),
    category: cleanText(payload.category || ''),
    image_url: cleanText(payload.image_url || ''),
    content: String(payload.content || '').replace(/\r/g, '').trim(),
    tags: Array.isArray(payload.tags) ? payload.tags : [],
    keyPoints: Array.isArray(payload.keyPoints) ? payload.keyPoints : [],
    factSheet: Array.isArray(payload.factSheet) ? payload.factSheet : [],
    background: Array.isArray(payload.background) ? payload.background : [],
    indiaPulse: cleanText(payload.indiaPulse || ''),
    metaTitle: cleanText(payload.metaTitle || ''),
    metaDescription: cleanText(payload.metaDescription || ''),
    showOnHero: Boolean(payload.showOnHero),
    durationMinutes: Number(payload.durationMinutes || 0) || 0,
    featuredUntil: cleanText(payload.featuredUntil || ''),
    readerPulse: payload.readerPulse && typeof payload.readerPulse === 'object'
      ? payload.readerPulse
      : null,
    liveUpdates: payload.liveUpdates && typeof payload.liveUpdates === 'object'
      ? payload.liveUpdates
      : null,
  };
}

async function createNewsRequest(prisma, requester = {}, payload = {}) {
  await ensureNewsroomTables(prisma);
  const id = randomUUID();
  const safePayload = toNewsRequestPayload(payload);
  await prisma.$executeRawUnsafe(`
    INSERT INTO newsroom_news_requests (
      id,
      requester_email,
      requester_name,
      requester_picture,
      status,
      requested_headline,
      requested_category,
      wants_hero,
      payload,
      created_at,
      updated_at
    )
    VALUES ($1, $2, $3, $4, 'pending', $5, $6, $7, CAST($8 AS JSONB), NOW(), NOW());
  `,
  id,
  normalizeEmail(requester.email),
  cleanText(requester.name || ''),
  cleanText(requester.picture || ''),
  cleanText(safePayload.headline || ''),
  cleanText(safePayload.category || ''),
  Boolean(safePayload.showOnHero),
  JSON.stringify(safePayload));

  return getNewsRequestById(prisma, id);
}

async function getNewsRequestById(prisma, id = '') {
  const requestId = cleanText(id);
  if (!requestId) return null;
  await ensureNewsroomTables(prisma);
  const rows = await prisma.$queryRawUnsafe(`
    SELECT *
    FROM newsroom_news_requests
    WHERE id = $1
    LIMIT 1;
  `, requestId);
  return rows?.[0] || null;
}

async function listNewsRequests(prisma, options = {}) {
  await ensureNewsroomTables(prisma);
  const status = cleanText(options.status || '');
  const requesterEmail = normalizeEmail(options.requesterEmail || '');
  const limit = Math.max(1, Math.min(500, Number(options.limit || 100) || 100));
  const conditions = [];
  const params = [];

  if (status) {
    params.push(status);
    conditions.push(`status = $${params.length}`);
  }

  if (requesterEmail) {
    params.push(requesterEmail);
    conditions.push(`requester_email = $${params.length}`);
  }

  params.push(limit);
  const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const rows = await prisma.$queryRawUnsafe(`
    SELECT *
    FROM newsroom_news_requests
    ${whereClause}
    ORDER BY
      CASE status
        WHEN 'pending' THEN 0
        WHEN 'approved' THEN 1
        ELSE 2
      END,
      created_at DESC
    LIMIT $${params.length};
  `, ...params);

  return Array.isArray(rows) ? rows : [];
}

async function updateNewsRequest(prisma, id = '', values = {}) {
  const requestId = cleanText(id);
  if (!requestId) {
    const error = new Error('Request id is required.');
    error.statusCode = 400;
    throw error;
  }

  const setClauses = [];
  const params = [];

  Object.entries(values).forEach(([key, value]) => {
    params.push(value);
    if (key === 'payload') {
      setClauses.push(`${key} = CAST($${params.length} AS JSONB)`);
      return;
    }
    if (key === 'published_article_id') {
      setClauses.push(`${key} = NULLIF($${params.length}, '')::UUID`);
      return;
    }
    setClauses.push(`${key} = $${params.length}`);
  });

  params.push(requestId);
  await ensureNewsroomTables(prisma);
  await prisma.$executeRawUnsafe(`
    UPDATE newsroom_news_requests
    SET ${setClauses.join(', ')}, updated_at = NOW()
    WHERE id = $${params.length};
  `, ...params);

  return getNewsRequestById(prisma, requestId);
}

function mapNewsRequestRecord(record = {}) {
  return {
    id: cleanText(record.id || ''),
    requesterEmail: normalizeEmail(record.requester_email || ''),
    requesterName: cleanText(record.requester_name || ''),
    requesterPicture: cleanText(record.requester_picture || ''),
    status: cleanText(record.status || 'pending') || 'pending',
    requestedHeadline: cleanText(record.requested_headline || ''),
    requestedCategory: cleanText(record.requested_category || ''),
    wantsHero: Boolean(record.wants_hero),
    payload: typeof record.payload === 'string'
      ? JSON.parse(record.payload || '{}')
      : (record.payload || {}),
    reviewerNote: cleanText(record.reviewer_note || ''),
    reviewedByEmail: normalizeEmail(record.reviewed_by_email || ''),
    reviewedAt: record.reviewed_at || null,
    publishedArticleId: cleanText(record.published_article_id || ''),
    createdAt: record.created_at || null,
    updatedAt: record.updated_at || null,
  };
}

module.exports = {
  addAuthorizedSubmitter,
  cleanText,
  createNewsRequest,
  ensureNewsroomTables,
  getNewsRequestById,
  hasSubmitterAccess,
  listAuthorizedSubmitters,
  listNewsRequests,
  mapNewsRequestRecord,
  normalizeEmail,
  removeAuthorizedSubmitter,
  toNewsRequestPayload,
  updateNewsRequest,
};
