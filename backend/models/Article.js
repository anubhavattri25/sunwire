const articleSelect = {
  id: true,
  slug: true,
  title: true,
  summary: true,
  content: true,
  ai_summary: true,
  raw_content: true,
  image_url: true,
  image_storage_url: true,
  category: true,
  source: true,
  source_url: true,
  published_at: true,
  created_at: true,
  updated_at: true,
  views: true,
  shares: true,
  word_count: true,
  trending_score: true,
  ai_rewritten: true,
  is_featured: true,
  featured_until: true,
  manual_upload: true,
};

function parseRawContentMetadata(value) {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (_) {
    return {};
  }
}

function toApiArticle(record) {
  if (!record) return null;
  const metadata = parseRawContentMetadata(record.raw_content);
  const publisherReview = metadata.publisherReview && typeof metadata.publisherReview === 'object'
    ? metadata.publisherReview
    : null;
  return {
    id: record.id,
    slug: metadata.slug || record.slug || '',
    title: record.title,
    summary: record.summary || record.ai_summary || '',
    content: record.content || '',
    subheadline: metadata.subheadline || record.ai_summary || '',
    keyPoints: Array.isArray(metadata.keyPoints) ? metadata.keyPoints : [],
    deepDive: Array.isArray(metadata.deepDive) ? metadata.deepDive : [],
    background: Array.isArray(metadata.background) ? metadata.background : [],
    factSheet: Array.isArray(metadata.factSheet) ? metadata.factSheet : [],
    author_name: metadata.authorName || 'Sunwire News Desk',
    tags: Array.isArray(metadata.tags) ? metadata.tags : [],
    meta_title: metadata.metaTitle || '',
    meta_description: metadata.metaDescription || '',
    structured_data: metadata.structuredData || null,
    trusted_sources: Array.isArray(metadata.coverage) ? metadata.coverage : [],
    primary_source_url: metadata.primarySourceUrl || '',
    primary_source_name: metadata.primarySourceName || '',
    image_url: record.image_storage_url || record.image_url || '',
    category: record.category,
    source: record.source,
    source_url: metadata.primarySourceUrl || (record.manual_upload ? '' : record.source_url),
    storage_source_url: record.source_url,
    published_at: record.published_at,
    created_at: record.created_at,
    updated_at: record.updated_at,
    views: record.views,
    shares: record.shares,
    word_count: Number(record.word_count || metadata.wordCount || 0),
    trending_score: record.trending_score,
    ai_rewritten: Boolean(record.ai_rewritten || metadata.ai_rewritten),
    is_featured: Boolean(record.is_featured),
    featured_until: record.featured_until,
    manual_upload: Boolean(record.manual_upload || metadata.manual_upload),
    publisher_review: publisherReview,
    review_ready: Boolean(publisherReview?.eligibleForPublisherNetwork),
  };
}

module.exports = {
  articleSelect,
  toApiArticle,
};
