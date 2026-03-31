import { cleanText, fmtDate, timeAgo, toTitleCase } from "../shared/client-utils.mjs";

const GOOGLE_AUTH_SESSION_STORAGE_KEY = "sunwire:google-auth-session:v1";
const GOOGLE_AUTH_ID_TOKEN_STORAGE_KEY = "sunwire:google-auth-id-token:v1";
const NEWSROOM_ROLE_STORAGE_KEY = "sunwire:newsroom-role:v1";
const AUTH_UI_OVERRIDE_STORAGE_KEY = "sunwire:auth-ui-override:v1";
const ADMIN_GLOBAL_STATUS_STORAGE_KEY = "sunwire:admin-global-status:v1";
const DISPLAY_TIMEZONE = "Asia/Kolkata";
const MIN_BODY_WORDS = 500;
const MIN_SUMMARY_WORDS = 20;
const MIN_PARAGRAPHS = 4;
const MIN_KEY_POINTS = 3;
const MIN_FACT_ROWS = 4;
const MIN_BACKGROUND = 2;
const LIVE_UPDATE_WORD_LIMIT = 20;
const ADMIN_ROLE = "admin";
const SUBMITTER_ROLE = "submitter";
const ROLE = String(window.__SUNWIRE_ADMIN_ROLE__ || "").trim().toLowerCase();
const PAGE_MODE = String(window.__SUNWIRE_ADMIN_PAGE_MODE__ || "").trim() || (ROLE === ADMIN_ROLE ? "news-requests" : "submit-request");
const DASHBOARD_GET_CACHE_TTL_MS = 60 * 1000;
const ALLOWED_MODES = {
  [ADMIN_ROLE]: ["news-requests", "edit-news", "watch-all-news", "access-control"],
  [SUBMITTER_ROLE]: ["submit-request"],
};

const dom = {
  adminUserEmail: document.getElementById("adminUserEmail"),
  adminRoleBadge: document.getElementById("adminRoleBadge"),
  sidebarSubtitle: document.getElementById("sidebarSubtitle"),
  adminPageEyebrow: document.getElementById("adminPageEyebrow"),
  adminPageTitle: document.getElementById("adminPageTitle"),
  adminPageDescription: document.getElementById("adminPageDescription"),
  adminGlobalStatus: document.getElementById("adminGlobalStatus"),
  navRequests: document.getElementById("navRequests"),
  navRequestsCount: document.getElementById("navRequestsCount"),
  navEditNews: document.getElementById("navEditNews"),
  navWatchAllNews: document.getElementById("navWatchAllNews"),
  navAccessControl: document.getElementById("navAccessControl"),
  navAccessCount: document.getElementById("navAccessCount"),
  navSubmitRequest: document.getElementById("navSubmitRequest"),
  requestDashboardSection: document.getElementById("requestDashboardSection"),
  editDashboardSection: document.getElementById("editDashboardSection"),
  watchAllDashboardSection: document.getElementById("watchAllDashboardSection"),
  accessDashboardSection: document.getElementById("accessDashboardSection"),
  featuredStatus: document.getElementById("featuredStatus"),
  featuredMeta: document.getElementById("featuredMeta"),
  featuredRemoveButton: document.getElementById("featuredRemoveButton"),
  requestSummaryPending: document.getElementById("requestSummaryPending"),
  requestSummaryApproved: document.getElementById("requestSummaryApproved"),
  requestSummaryRejected: document.getElementById("requestSummaryRejected"),
  requestListMeta: document.getElementById("requestListMeta"),
  requestTotalCount: document.getElementById("requestTotalCount"),
  requestList: document.getElementById("requestList"),
  requestEmptyState: document.getElementById("requestEmptyState"),
  requestDetailEmpty: document.getElementById("requestDetailEmpty"),
  requestDetailCard: document.getElementById("requestDetailCard"),
  requestDetailHeadline: document.getElementById("requestDetailHeadline"),
  requestDetailMeta: document.getElementById("requestDetailMeta"),
  requestDetailStatus: document.getElementById("requestDetailStatus"),
  approveRequestButton: document.getElementById("approveRequestButton"),
  rejectRequestButton: document.getElementById("rejectRequestButton"),
  requestDetailImage: document.getElementById("requestDetailImage"),
  requestDetailRequester: document.getElementById("requestDetailRequester"),
  requestDetailRequesterMeta: document.getElementById("requestDetailRequesterMeta"),
  requestDetailSetup: document.getElementById("requestDetailSetup"),
  requestDetailReviewMeta: document.getElementById("requestDetailReviewMeta"),
  requestDetailSummary: document.getElementById("requestDetailSummary"),
  requestDetailBody: document.getElementById("requestDetailBody"),
  requestDetailWhyMatters: document.getElementById("requestDetailWhyMatters"),
  requestDetailSource: document.getElementById("requestDetailSource"),
  requestDetailPrimarySourceLink: document.getElementById("requestDetailPrimarySourceLink"),
  requestDetailMetaTitle: document.getElementById("requestDetailMetaTitle"),
  requestDetailMetaDescription: document.getElementById("requestDetailMetaDescription"),
  requestDetailTags: document.getElementById("requestDetailTags"),
  requestDetailKeyPointCount: document.getElementById("requestDetailKeyPointCount"),
  requestDetailKeyPoints: document.getElementById("requestDetailKeyPoints"),
  requestDetailFactCount: document.getElementById("requestDetailFactCount"),
  requestDetailFactSheet: document.getElementById("requestDetailFactSheet"),
  requestDetailBackgroundCount: document.getElementById("requestDetailBackgroundCount"),
  requestDetailBackground: document.getElementById("requestDetailBackground"),
  refreshRequestsButton: document.getElementById("refreshRequestsButton"),
  featuredPreviewImage: document.getElementById("featuredPreviewImage"),
  featuredPreviewCategory: document.getElementById("featuredPreviewCategory"),
  featuredPreviewHeadline: document.getElementById("featuredPreviewHeadline"),
  featuredPreviewSource: document.getElementById("featuredPreviewSource"),
  sidePanelEyebrow: document.getElementById("sidePanelEyebrow"),
  sidePanelTitle: document.getElementById("sidePanelTitle"),
  imagePreview: document.getElementById("imagePreview"),
  imageInput: document.getElementById("imageInput"),
  imageUploadButtonLabel: document.getElementById("imageUploadButtonLabel"),
  imageUploadStatus: document.getElementById("imageUploadStatus"),
  headlineInput: document.getElementById("headlineInput"),
  subheadlineInput: document.getElementById("subheadlineInput"),
  authorNameInput: document.getElementById("authorNameInput"),
  sourceInput: document.getElementById("sourceInput"),
  primarySourceNameInput: document.getElementById("primarySourceNameInput"),
  primarySourceUrlInput: document.getElementById("primarySourceUrlInput"),
  categoryInput: document.getElementById("categoryInput"),
  showOnHeroInput: document.getElementById("showOnHeroInput"),
  durationMinutesInput: document.getElementById("durationMinutesInput"),
  featuredUntilInput: document.getElementById("featuredUntilInput"),
  tagsInput: document.getElementById("tagsInput"),
  metaTitleInput: document.getElementById("metaTitleInput"),
  metaDescriptionInput: document.getElementById("metaDescriptionInput"),
  contentEditor: document.getElementById("contentEditor"),
  keyPointsList: document.getElementById("keyPointsList"),
  factSheetRows: document.getElementById("factSheetRows"),
  backgroundRows: document.getElementById("backgroundRows"),
  addKeyPointButton: document.getElementById("addKeyPointButton"),
  addFactSheetRowButton: document.getElementById("addFactSheetRowButton"),
  addBackgroundItemButton: document.getElementById("addBackgroundItemButton"),
  indiaPulseInput: document.getElementById("indiaPulseInput"),
  newsForm: document.getElementById("newsForm"),
  pushNewsButton: document.getElementById("pushNewsButton"),
  resetFormButton: document.getElementById("resetFormButton"),
  refreshAdminDataButton: document.getElementById("refreshAdminDataButton"),
  formStatus: document.getElementById("formStatus"),
  editorModeLabel: document.getElementById("editorModeLabel"),
  editorHeading: document.getElementById("editorHeading"),
  currentEditMeta: document.getElementById("currentEditMeta"),
  cancelEditButton: document.getElementById("cancelEditButton"),
  recentManualCount: document.getElementById("recentManualCount"),
  recentManualList: document.getElementById("recentManualList"),
  manualTotalCount: document.getElementById("manualTotalCount"),
  archiveUpdatedAt: document.getElementById("archiveUpdatedAt"),
  archiveGroups: document.getElementById("archiveGroups"),
  archiveEmptyState: document.getElementById("archiveEmptyState"),
  storySignalsPreview: document.getElementById("storySignalsPreview"),
  storySignalsArticleSelect: document.getElementById("storySignalsArticleSelect"),
  storySignalsHeadline: document.getElementById("storySignalsHeadline"),
  storySignalsMeta: document.getElementById("storySignalsMeta"),
  storySignalsStatus: document.getElementById("storySignalsStatus"),
  readerPulseBaseInput: document.getElementById("readerPulseBaseInput"),
  readerPulseStepInput: document.getElementById("readerPulseStepInput"),
  readerPulseMinutesInput: document.getElementById("readerPulseMinutesInput"),
  readerPulseStartedAtInput: document.getElementById("readerPulseStartedAtInput"),
  readerPulsePushedCount: document.getElementById("readerPulsePushedCount"),
  readerPulsePushedList: document.getElementById("readerPulsePushedList"),
  liveUpdatesArticleSelect: document.getElementById("liveUpdatesArticleSelect"),
  liveUpdatesHeadline: document.getElementById("liveUpdatesHeadline"),
  liveUpdatesMeta: document.getElementById("liveUpdatesMeta"),
  liveUpdatesScheduleToggle: document.getElementById("liveUpdatesScheduleToggle"),
  liveUpdatesIntervalInput: document.getElementById("liveUpdatesIntervalInput"),
  liveUpdatesQueueInput: document.getElementById("liveUpdatesQueueInput"),
  liveUpdatesCountBadge: document.getElementById("liveUpdatesCountBadge"),
  liveUpdatesPreviewBadge: document.getElementById("liveUpdatesPreviewBadge"),
  liveUpdatesPreviewList: document.getElementById("liveUpdatesPreviewList"),
  liveUpdatesPushedCount: document.getElementById("liveUpdatesPushedCount"),
  liveUpdatesPushedList: document.getElementById("liveUpdatesPushedList"),
  saveReaderPulseButton: document.getElementById("saveReaderPulseButton"),
  clearReaderPulseButton: document.getElementById("clearReaderPulseButton"),
  saveLiveUpdatesButton: document.getElementById("saveLiveUpdatesButton"),
  clearLiveUpdatesButton: document.getElementById("clearLiveUpdatesButton"),
  liveUpdatesStatus: document.getElementById("liveUpdatesStatus"),
  accessForm: document.getElementById("accessForm"),
  accessEmailInput: document.getElementById("accessEmailInput"),
  grantAccessButton: document.getElementById("grantAccessButton"),
  refreshAccessButton: document.getElementById("refreshAccessButton"),
  accessStatus: document.getElementById("accessStatus"),
  accessCount: document.getElementById("accessCount"),
  accessList: document.getElementById("accessList"),
  logoutAdminButton: document.getElementById("logoutAdminButton"),
  toast: document.getElementById("toast"),
  toastMessage: document.getElementById("toastMessage"),
};

const state = {
  role: ROLE === ADMIN_ROLE ? ADMIN_ROLE : SUBMITTER_ROLE,
  mode: PAGE_MODE,
  currentEditingArticleId: "",
  featuredArticle: null,
  recentArticles: [],
  archiveArticles: [],
  requests: [],
  selectedRequestId: "",
  accessList: [],
  imageUrl: "",
  toastTimer: null,
  formBusy: false,
  requestBusy: false,
  accessBusy: false,
  storySignalsBusy: false,
  selectedReaderPulseArticleId: "",
  selectedLiveUpdatesArticleId: "",
};
const dashboardResponseCache = new Map();

function wordCount(value = "") {
  return cleanText(value).split(/\s+/).filter(Boolean).length;
}

function paragraphCount(value = "") {
  return String(value || "")
    .replace(/\r/g, "")
    .split(/\n{2,}/)
    .map((entry) => cleanText(entry))
    .filter(Boolean)
    .length;
}

function normalizePositiveInteger(value, fallback = 0, max = 100000000) {
  const numeric = Number.parseInt(value, 10);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.min(max, Math.max(0, numeric));
}

function formatCompactNumber(value = 0) {
  const amount = Number(value || 0);
  return new Intl.NumberFormat("en-IN", {
    notation: amount >= 1000 ? "compact" : "standard",
    maximumFractionDigits: amount >= 1000 ? 1 : 0,
  }).format(amount);
}

function normalizeSignalDate(value = "") {
  const normalized = cleanText(value);
  if (!normalized) return "";
  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) return "";
  return parsed.toISOString();
}

function hashSeed(value = "") {
  let hash = 2166136261;
  const normalized = String(value || "");
  for (let index = 0; index < normalized.length; index += 1) {
    hash ^= normalized.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function signalStepMinutes(seed = "", index = 0, minGap = 10, maxGap = 20) {
  const safeMin = Math.max(1, normalizePositiveInteger(minGap, 10, 1440));
  const safeMax = Math.max(safeMin, normalizePositiveInteger(maxGap, 20, 2880));
  return safeMin + (hashSeed(`${seed}:${index}`) % (safeMax - safeMin + 1));
}

function normalizeReaderPulseConfig(value = {}, fallback = {}) {
  const source = value && typeof value === "object" ? value : {};
  const fallbackSource = fallback && typeof fallback === "object" ? fallback : {};
  const baseCount = normalizePositiveInteger(
    source.baseCount ?? source.startCount ?? fallbackSource.baseCount ?? fallbackSource.startCount ?? 0,
    0
  );
  const incrementBy = normalizePositiveInteger(
    source.incrementBy ?? source.stepCount ?? fallbackSource.incrementBy ?? fallbackSource.stepCount ?? 0,
    0
  );
  const everyMinutes = Math.max(1, normalizePositiveInteger(
    source.everyMinutes ?? source.stepMinutes ?? fallbackSource.everyMinutes ?? fallbackSource.stepMinutes ?? 15,
    15,
    1440
  ));
  const startedAt = normalizeSignalDate(
    source.startedAt
    || source.startAt
    || fallbackSource.startedAt
    || fallbackSource.startAt
    || ""
  );

  return {
    enabled: baseCount > 0 || incrementBy > 0,
    baseCount,
    incrementBy,
    everyMinutes,
    startedAt,
  };
}

function normalizeLiveUpdatesConfig(value = {}, fallback = {}) {
  const source = value && typeof value === "object" ? value : {};
  const fallbackSource = fallback && typeof fallback === "object" ? fallback : {};
  const items = (Array.isArray(source.items) ? source.items : String(source.items || source.queue || "").split(/\n+/))
    .map((entry) => typeof entry === "string" ? cleanText(entry) : cleanText(entry?.text || ""))
    .filter(Boolean)
    .slice(0, 40);
  const requestedMode = cleanText(
    source.mode
    || source.releaseMode
    || fallbackSource.mode
    || fallbackSource.releaseMode
    || ""
  ).toLowerCase();
  const intervalMinutes = Math.max(1, normalizePositiveInteger(
    source.intervalMinutes
    ?? source.everyMinutes
    ?? fallbackSource.intervalMinutes
    ?? fallbackSource.everyMinutes
    ?? source.minGapMinutes
    ?? source.intervalMin
    ?? fallbackSource.minGapMinutes
    ?? fallbackSource.intervalMin
    ?? 10,
    10,
    1440
  ));
  const scheduleEnabled = requestedMode === "scheduled"
    || Boolean(source.scheduleEnabled ?? fallbackSource.scheduleEnabled)
    || (!requestedMode && (
      Object.prototype.hasOwnProperty.call(source, "intervalMinutes")
      || Object.prototype.hasOwnProperty.call(source, "everyMinutes")
      || Object.prototype.hasOwnProperty.call(source, "minGapMinutes")
      || Object.prototype.hasOwnProperty.call(source, "maxGapMinutes")
      || Object.prototype.hasOwnProperty.call(source, "intervalMin")
      || Object.prototype.hasOwnProperty.call(source, "intervalMax")
      || Object.prototype.hasOwnProperty.call(fallbackSource, "intervalMinutes")
      || Object.prototype.hasOwnProperty.call(fallbackSource, "everyMinutes")
      || Object.prototype.hasOwnProperty.call(fallbackSource, "minGapMinutes")
      || Object.prototype.hasOwnProperty.call(fallbackSource, "maxGapMinutes")
      || Object.prototype.hasOwnProperty.call(fallbackSource, "intervalMin")
      || Object.prototype.hasOwnProperty.call(fallbackSource, "intervalMax")
    ));
  const startedAt = normalizeSignalDate(
    source.startedAt
    || source.startAt
    || fallbackSource.startedAt
    || fallbackSource.startAt
    || ""
  );

  return {
    enabled: items.length > 0,
    startedAt,
    mode: scheduleEnabled ? "scheduled" : "instant",
    scheduleEnabled,
    intervalMinutes,
    minGapMinutes: intervalMinutes,
    maxGapMinutes: intervalMinutes,
    items,
  };
}

function computeSyntheticVisitors(readerPulse = {}, fallbackStartAt = "") {
  const normalized = normalizeReaderPulseConfig(readerPulse);
  if (!normalized.enabled) return 0;
  const anchor = normalizeSignalDate(normalized.startedAt || fallbackStartAt || "") || "";
  const anchorMs = anchor ? new Date(anchor).getTime() : NaN;
  const elapsedMs = Number.isNaN(anchorMs) ? 0 : Math.max(0, Date.now() - anchorMs);
  const increments = normalized.incrementBy > 0
    ? Math.floor(elapsedMs / (normalized.everyMinutes * 60 * 1000))
    : 0;
  return normalized.baseCount + (increments * normalized.incrementBy);
}

function buildLiveUpdateTimelinePreview(liveUpdates = {}, article = {}) {
  const normalized = normalizeLiveUpdatesConfig(liveUpdates);
  const anchor = normalizeSignalDate(
    normalized.startedAt
    || article.created_at
    || article.published_at
    || article.createdAt
    || article.publishedAt
    || new Date().toISOString()
  );
  const anchorMs = anchor ? new Date(anchor).getTime() : NaN;
  if (!normalized.items.length || Number.isNaN(anchorMs)) return [];

  const seed = cleanText(article.id || article.slug || article.title || "sunwire-live");
  if (normalized.mode !== "scheduled") {
    return normalized.items.map((text, index) => ({
      id: `${seed}-${index + 1}`,
      text,
      scheduledAt: anchor,
    }));
  }
  let currentMs = anchorMs;

  return normalized.items.map((text, index) => {
    currentMs += signalStepMinutes(seed, index, normalized.minGapMinutes, normalized.maxGapMinutes) * 60 * 1000;
    return {
      id: `${seed}-${index + 1}`,
      text,
      scheduledAt: new Date(currentMs).toISOString(),
    };
  });
}

function setStatus(message, isError = false) {
  if (!dom.formStatus) return;
  dom.formStatus.textContent = message;
  dom.formStatus.classList.toggle("text-red-600", Boolean(isError));
  dom.formStatus.classList.toggle("text-slate-500", !isError);
}

function saveGlobalStatus(message = "", isError = false) {
  try {
    if (!message) {
      window.sessionStorage.removeItem(ADMIN_GLOBAL_STATUS_STORAGE_KEY);
      return;
    }
    window.sessionStorage.setItem(ADMIN_GLOBAL_STATUS_STORAGE_KEY, JSON.stringify({
      message: cleanText(message),
      isError: Boolean(isError),
      expiresAt: Date.now() + (30 * 60 * 1000),
    }));
  } catch (_) {
    // Ignore storage failures for status persistence.
  }
}

function readGlobalStatus() {
  try {
    const raw = window.sessionStorage.getItem(ADMIN_GLOBAL_STATUS_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.message) return null;
    if (Number(parsed.expiresAt || 0) && Number(parsed.expiresAt) < Date.now()) {
      window.sessionStorage.removeItem(ADMIN_GLOBAL_STATUS_STORAGE_KEY);
      return null;
    }
    return {
      message: cleanText(parsed.message),
      isError: Boolean(parsed.isError),
    };
  } catch (_) {
    return null;
  }
}

function setGlobalStatus(message = "", isError = false, options = {}) {
  const normalized = cleanText(message);
  const shouldPersist = options.persist !== false;
  if (!dom.adminGlobalStatus) return;

  if (!normalized) {
    dom.adminGlobalStatus.hidden = true;
    if (shouldPersist) saveGlobalStatus("", false);
    return;
  }

  dom.adminGlobalStatus.hidden = false;
  dom.adminGlobalStatus.textContent = normalized;
  dom.adminGlobalStatus.classList.toggle("border-red-300", Boolean(isError));
  dom.adminGlobalStatus.classList.toggle("bg-red-500/15", Boolean(isError));
  dom.adminGlobalStatus.classList.toggle("text-red-50", Boolean(isError));
  dom.adminGlobalStatus.classList.toggle("border-white/20", !isError);
  dom.adminGlobalStatus.classList.toggle("bg-white/10", !isError);
  dom.adminGlobalStatus.classList.toggle("text-white/90", !isError);

  if (shouldPersist) saveGlobalStatus(normalized, isError);
}

function setRequestMeta(message = "") {
  if (!dom.requestListMeta) return;
  dom.requestListMeta.textContent = cleanText(message);
}

function buildIndexingStatusMessage(actionLabel = "Story pushed", indexing = null) {
  const actionText = cleanText(actionLabel) || "Story pushed";
  if (!indexing || typeof indexing !== "object") return `${actionText}.`;
  if (indexing.ok) return `${actionText}. Google sitemap re-submitted for faster discovery.`;
  if (indexing.skipped) return `${actionText}. Indexing request skipped because Search Console credentials are not configured yet.`;

  const error = cleanText(indexing.error || "");
  return error
    ? `${actionText}. Indexing request failed: ${error}.`
    : `${actionText}. Indexing request failed.`;
}

function isIndexingStatusError(indexing = null) {
  if (!indexing || typeof indexing !== "object") return false;
  return indexing.ok !== true;
}

function showToast(message) {
  if (!dom.toast || !dom.toastMessage) return;
  dom.toastMessage.textContent = message;
  dom.toast.classList.remove("translate-y-4", "opacity-0");
  dom.toast.classList.add("translate-y-0", "opacity-100");
  window.clearTimeout(state.toastTimer);
  state.toastTimer = window.setTimeout(() => {
    dom.toast.classList.add("translate-y-4", "opacity-0");
    dom.toast.classList.remove("translate-y-0", "opacity-100");
  }, 2200);
}

function scheduleIdle(callback) {
  if (typeof window.requestIdleCallback === "function") {
    window.requestIdleCallback(() => callback(), { timeout: 1200 });
    return;
  }
  window.setTimeout(callback, 120);
}

async function fetchJson(url, options = {}) {
  const { forceFresh = false, headers = {}, ...requestOptions } = options;
  const method = cleanText(requestOptions.method || "GET").toUpperCase() || "GET";
  const canUseCache = method === "GET" && !forceFresh;
  const cacheKey = canUseCache ? `${method}:${url}` : "";
  const cached = canUseCache ? dashboardResponseCache.get(cacheKey) : null;
  if (cached && cached.expiresAt > Date.now()) {
    return cached.promise;
  }

  const request = fetch(url, {
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/json",
      ...headers,
    },
    ...requestOptions,
  })
    .then(async (response) => {
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(cleanText(data.error || data.message || "Request failed."));
      }
      if (method !== "GET") {
        dashboardResponseCache.clear();
      }
      return data;
    })
    .catch((error) => {
      if (cacheKey) dashboardResponseCache.delete(cacheKey);
      throw error;
    });

  if (canUseCache) {
    dashboardResponseCache.set(cacheKey, {
      expiresAt: Date.now() + DASHBOARD_GET_CACHE_TTL_MS,
      promise: request,
    });
  }

  return request;
}

function setAuthUiOverride(state = "") {
  try {
    if (!state) {
      window.sessionStorage.removeItem(AUTH_UI_OVERRIDE_STORAGE_KEY);
      return;
    }
    window.sessionStorage.setItem(AUTH_UI_OVERRIDE_STORAGE_KEY, JSON.stringify({
      state: cleanText(state),
      expiresAt: Date.now() + 15000,
    }));
  } catch (_) {
    // Ignore storage failures during auth transitions.
  }
}

function clearClientAuthState() {
  dashboardResponseCache.clear();
  window.localStorage.removeItem(GOOGLE_AUTH_SESSION_STORAGE_KEY);
  window.localStorage.removeItem(GOOGLE_AUTH_ID_TOKEN_STORAGE_KEY);
  window.localStorage.removeItem(NEWSROOM_ROLE_STORAGE_KEY);
}

function isAdminRole() {
  return state.role === ADMIN_ROLE;
}

function defaultModeForRole(role = state.role) {
  return role === ADMIN_ROLE ? "news-requests" : "submit-request";
}

function normalizeMode(mode = "") {
  const normalized = cleanText(mode);
  const allowed = ALLOWED_MODES[state.role] || [defaultModeForRole()];
  return allowed.includes(normalized) ? normalized : defaultModeForRole();
}

function setAccessStatus(message, isError = false) {
  if (!dom.accessStatus) return;
  dom.accessStatus.textContent = cleanText(message);
  dom.accessStatus.classList.toggle("text-red-600", Boolean(isError));
  dom.accessStatus.classList.toggle("text-slate-500", !isError);
}

function setRequestButtonState(button, busy, busyLabel) {
  setButtonBusy(button, busy, busyLabel);
}

function statusBadgeClass(status = "") {
  const normalized = cleanText(status).toLowerCase();
  if (normalized === "approved") return ["bg-emerald-100", "text-emerald-700"];
  if (normalized === "rejected") return ["bg-red-100", "text-red-700"];
  return ["bg-amber-100", "text-slate-900"];
}

function formatListDate(value = "") {
  if (!value) return "";
  return fmtDate(value);
}

function setImagePreview(url = "") {
  const nextUrl = cleanText(url || "");
  state.imageUrl = nextUrl;
  if (dom.imagePreview) dom.imagePreview.src = nextUrl || "/social-card.svg";
  if (dom.imageUploadStatus) {
    dom.imageUploadStatus.textContent = nextUrl ? "Image uploaded and ready." : "No image uploaded yet.";
  }
  syncFeaturedPreview();
}

function toLocalDateTimeValue(value = "") {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const local = new Date(date.getTime() - (date.getTimezoneOffset() * 60000));
  return local.toISOString().slice(0, 16);
}

function buildArticleHref(article = {}) {
  const slug = cleanText(article.slug || "story");
  const params = new URLSearchParams();
  if (article.id) params.set("id", cleanText(article.id));
  if (article.category) params.set("c", cleanText(article.category));
  if (article.title) params.set("t", cleanText(article.title));
  params.set("sw", "2");
  return `/article/${encodeURIComponent(slug)}?${params.toString()}`;
}

function findArchiveArticleById(articleId = "") {
  return state.archiveArticles.find((article) => cleanText(article.id) === cleanText(articleId)) || null;
}

function sortStoriesByNewest(left = {}, right = {}) {
  return new Date(right.created_at || right.published_at || 0).getTime()
    - new Date(left.created_at || left.published_at || 0).getTime();
}

function resolveDefaultLiveUpdatesArticle() {
  const liveStory = [...state.archiveArticles]
    .filter((article) => Number(article.liveUpdateCount || 0) > 0)
    .sort((left, right) => {
      const liveDiff = Number(right.liveUpdateCount || 0) - Number(left.liveUpdateCount || 0);
      if (liveDiff !== 0) return liveDiff;
      return sortStoriesByNewest(left, right);
    })[0];
  if (liveStory) return liveStory;

  const latestArchiveStory = [...state.archiveArticles].sort(sortStoriesByNewest)[0];
  if (latestArchiveStory) return latestArchiveStory;

  return state.featuredArticle || state.recentArticles[0] || null;
}

function resolveLiveUpdatesTargetArticle() {
  return findArchiveArticleById(state.selectedLiveUpdatesArticleId) || resolveDefaultLiveUpdatesArticle();
}

function signalStartFallback(article = {}) {
  return cleanText(
    article.created_at
    || article.published_at
    || article.createdAt
    || article.publishedAt
    || new Date().toISOString()
  );
}

function setStorySignalsStatus(message = "", isError = false) {
  if (!dom.storySignalsStatus) return;
  dom.storySignalsStatus.textContent = cleanText(message);
  dom.storySignalsStatus.classList.toggle("text-red-600", Boolean(isError));
  dom.storySignalsStatus.classList.toggle("text-slate-500", !isError);
}

function setLiveUpdatesStatus(message = "", isError = false) {
  if (!dom.liveUpdatesStatus) return;
  dom.liveUpdatesStatus.textContent = cleanText(message);
  dom.liveUpdatesStatus.classList.toggle("text-red-600", Boolean(isError));
  dom.liveUpdatesStatus.classList.toggle("text-slate-500", !isError);
}

function renderStorySignalsArticleOptions(items = []) {
  if (!dom.storySignalsArticleSelect) return;
  const previousValue = cleanText(dom.storySignalsArticleSelect.value || state.selectedReaderPulseArticleId || "");
  dom.storySignalsArticleSelect.replaceChildren();

  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = "Select a pushed article";
  dom.storySignalsArticleSelect.append(placeholder);

  items.forEach((article) => {
    const option = document.createElement("option");
    option.value = cleanText(article.id || "");
    option.textContent = cleanText(article.title || "Untitled story");
    dom.storySignalsArticleSelect.append(option);
  });

  dom.storySignalsArticleSelect.value = items.some((article) => cleanText(article.id) === previousValue)
    ? previousValue
    : "";
}

function resetReaderPulseDashboard({ preserveStatus = false } = {}) {
  state.selectedReaderPulseArticleId = "";
  if (dom.storySignalsArticleSelect) dom.storySignalsArticleSelect.value = "";
  if (dom.storySignalsPreview) dom.storySignalsPreview.textContent = "Choose a story";
  if (dom.storySignalsHeadline) dom.storySignalsHeadline.textContent = "Select a pushed article from Watch All News.";
  if (dom.storySignalsMeta) dom.storySignalsMeta.textContent = "The dashboard will load this story's visitor settings here.";
  if (dom.readerPulseBaseInput) dom.readerPulseBaseInput.value = "";
  if (dom.readerPulseStepInput) dom.readerPulseStepInput.value = "";
  if (dom.readerPulseMinutesInput) dom.readerPulseMinutesInput.value = "";
  if (dom.readerPulseStartedAtInput) dom.readerPulseStartedAtInput.value = "";
  if (!preserveStatus) setStorySignalsStatus("No article selected yet.");
}

function resetLiveUpdatesDashboard() {
  state.selectedLiveUpdatesArticleId = "";
  if (dom.liveUpdatesHeadline) dom.liveUpdatesHeadline.textContent = "Live desk source will attach automatically.";
  if (dom.liveUpdatesMeta) dom.liveUpdatesMeta.textContent = "Push quick lines here and Sunwire will store them separately from People Are Reading.";
  if (dom.liveUpdatesScheduleToggle) dom.liveUpdatesScheduleToggle.checked = false;
  if (dom.liveUpdatesIntervalInput) dom.liveUpdatesIntervalInput.value = "10";
  syncLiveUpdatesScheduleState();
  if (dom.liveUpdatesQueueInput) dom.liveUpdatesQueueInput.value = "";
  if (dom.liveUpdatesCountBadge) dom.liveUpdatesCountBadge.textContent = "0 lines";
  if (dom.liveUpdatesPreviewBadge) dom.liveUpdatesPreviewBadge.textContent = "Waiting";
  if (dom.liveUpdatesPreviewList) {
    dom.liveUpdatesPreviewList.replaceChildren();
    const empty = document.createElement("p");
    empty.className = "rounded-2xl bg-slate-50 px-4 py-4 text-sm text-slate-500";
    empty.textContent = "Push quick lines and Sunwire will attach them automatically.";
    dom.liveUpdatesPreviewList.append(empty);
  }
  setLiveUpdatesStatus("Write quick lines here. Sunwire will manage the live desk source automatically.");
}

function resetStorySignalsDashboard({ preserveStatus = false } = {}) {
  resetReaderPulseDashboard({ preserveStatus: true });
  resetLiveUpdatesDashboard();
  if (!preserveStatus) setStorySignalsStatus("No article selected yet.");
}

function getStorySignalsPayload(article = {}) {
  const readerPulse = normalizeReaderPulseConfig({
    baseCount: dom.readerPulseBaseInput?.value || 0,
    incrementBy: dom.readerPulseStepInput?.value || 0,
    everyMinutes: dom.readerPulseMinutesInput?.value || 15,
    startedAt: dom.readerPulseStartedAtInput?.value || signalStartFallback(article),
  });
  const scheduleEnabled = Boolean(dom.liveUpdatesScheduleToggle?.checked);
  const liveUpdates = normalizeLiveUpdatesConfig({
    mode: scheduleEnabled ? "scheduled" : "instant",
    scheduleEnabled,
    intervalMinutes: dom.liveUpdatesIntervalInput?.value || 10,
    startedAt: new Date().toISOString(),
    items: String(dom.liveUpdatesQueueInput?.value || "")
      .split(/\n+/)
      .map((entry) => cleanText(entry))
      .filter(Boolean),
  });

  return {
    readerPulse,
    liveUpdates: {
      ...liveUpdates,
      items: liveUpdates.items.map((text) => ({ text })),
    },
  };
}

function getReaderPulsePayload(article = {}) {
  return getStorySignalsPayload(article).readerPulse;
}

function getLiveUpdatesPayload(article = {}) {
  const existing = normalizeLiveUpdatesConfig(article.liveUpdates || article.live_updates || {}, {
    startedAt: signalStartFallback(article),
  });
  const inputItems = String(dom.liveUpdatesQueueInput?.value || "")
    .split(/\n+/)
    .map((entry) => cleanText(entry))
    .filter(Boolean);
  const includesExistingQueue = existing.items.length > 0
    && inputItems.length >= existing.items.length
    && existing.items.every((item, index) => item === inputItems[index]);
  const scheduleEnabled = Boolean(dom.liveUpdatesScheduleToggle?.checked);
  const liveUpdates = normalizeLiveUpdatesConfig({
    mode: scheduleEnabled ? "scheduled" : "instant",
    scheduleEnabled,
    intervalMinutes: dom.liveUpdatesIntervalInput?.value || existing.intervalMinutes || 10,
    startedAt: existing.startedAt || new Date().toISOString(),
    items: includesExistingQueue
      ? inputItems
      : [...existing.items, ...inputItems],
  }, existing);

  return {
    ...liveUpdates,
    items: liveUpdates.items.map((text) => ({ text })),
  };
}

function emptyReaderPulsePayload(article = {}) {
  return {
    enabled: false,
    baseCount: 0,
    incrementBy: 0,
    everyMinutes: 15,
    startedAt: normalizeSignalDate(signalStartFallback(article)),
  };
}

function emptyLiveUpdatesPayload(article = {}) {
  return {
    enabled: false,
    mode: "instant",
    scheduleEnabled: false,
    intervalMinutes: 10,
    startedAt: normalizeSignalDate(signalStartFallback(article)),
    items: [],
  };
}

function syncLiveUpdatesScheduleState() {
  const enabled = Boolean(dom.liveUpdatesScheduleToggle?.checked);
  if (dom.liveUpdatesIntervalInput) {
    dom.liveUpdatesIntervalInput.disabled = !enabled;
    if (enabled && !cleanText(dom.liveUpdatesIntervalInput.value || "")) {
      dom.liveUpdatesIntervalInput.value = "10";
    }
  }
}

function setSignalButtonsBusy(buttons = [], activeButton = null, busy = false, busyLabel = "Saving...") {
  buttons.forEach((button) => {
    if (!button) return;
    if (!button.dataset.label) button.dataset.label = button.textContent || "";
    button.disabled = busy;
    button.textContent = busy && button === activeButton ? busyLabel : button.dataset.label;
  });
}

function renderStorySignalsPreview() {
  const article = findArchiveArticleById(state.selectedReaderPulseArticleId);
  if (!article) {
    if (dom.storySignalsPreview) dom.storySignalsPreview.textContent = "Choose a story";
    return;
  }

  const readerPulse = getReaderPulsePayload(article);
  const currentVisitors = computeSyntheticVisitors(readerPulse, signalStartFallback(article));

  if (dom.storySignalsPreview) {
    dom.storySignalsPreview.textContent = currentVisitors > 0
      ? `${formatCompactNumber(currentVisitors)} reading`
      : "Reader pulse off";
  }
  if (currentVisitors > 0) {
    setStorySignalsStatus(`Current visitor count preview: ${formatCompactNumber(currentVisitors)} readers.`);
  } else {
    setStorySignalsStatus("Add visitor numbers, then push People Are Reading.");
  }
}

function applyStorySignalsArticle(article = null) {
  if (!article) {
    resetReaderPulseDashboard();
    return;
  }

  state.selectedReaderPulseArticleId = cleanText(article.id || "");
  if (dom.storySignalsArticleSelect) dom.storySignalsArticleSelect.value = state.selectedReaderPulseArticleId;
  if (dom.storySignalsHeadline) dom.storySignalsHeadline.textContent = cleanText(article.title || "Untitled story");
  if (dom.storySignalsMeta) {
    dom.storySignalsMeta.textContent = [
      toTitleCase(article.category || "news"),
      fmtDate(article.created_at || article.published_at || new Date().toISOString()),
      article.syntheticViews ? `${formatCompactNumber(article.syntheticViews)} reading now` : "",
    ].filter(Boolean).join(" | ");
  }

  const readerPulse = normalizeReaderPulseConfig(article.readerPulse || article.reader_pulse || {}, {
    startedAt: signalStartFallback(article),
  });
  if (dom.readerPulseBaseInput) dom.readerPulseBaseInput.value = readerPulse.baseCount ? String(readerPulse.baseCount) : "";
  if (dom.readerPulseStepInput) dom.readerPulseStepInput.value = readerPulse.incrementBy ? String(readerPulse.incrementBy) : "";
  if (dom.readerPulseMinutesInput) dom.readerPulseMinutesInput.value = String(readerPulse.everyMinutes || 15);
  if (dom.readerPulseStartedAtInput) dom.readerPulseStartedAtInput.value = toLocalDateTimeValue(readerPulse.startedAt || signalStartFallback(article));

  renderStorySignalsPreview();
}

function renderLiveUpdatesPreview() {
  const article = resolveLiveUpdatesTargetArticle();
  if (!article) {
    if (dom.liveUpdatesCountBadge) dom.liveUpdatesCountBadge.textContent = "0 lines";
    if (dom.liveUpdatesPreviewBadge) dom.liveUpdatesPreviewBadge.textContent = "Waiting";
    if (dom.liveUpdatesPreviewList) {
      dom.liveUpdatesPreviewList.replaceChildren();
      const empty = document.createElement("p");
      empty.className = "rounded-2xl bg-slate-50 px-4 py-4 text-sm text-slate-500";
      empty.textContent = "Push quick lines and Sunwire will attach them automatically.";
      dom.liveUpdatesPreviewList.append(empty);
    }
    setLiveUpdatesStatus("Live desk will use your latest pushed story automatically.");
    return;
  }

  const liveUpdates = getLiveUpdatesPayload(article);
  const liveItems = Array.isArray(liveUpdates.items) ? liveUpdates.items : [];
  const timeline = buildLiveUpdateTimelinePreview({
    ...liveUpdates,
    items: liveItems.map((item) => item.text),
  }, article);

  if (dom.liveUpdatesCountBadge) {
    dom.liveUpdatesCountBadge.textContent = `${liveItems.length} lines`;
  }
  if (dom.liveUpdatesPreviewBadge) {
    dom.liveUpdatesPreviewBadge.textContent = timeline.length
      ? (liveUpdates.mode === "scheduled"
        ? `Every ${liveUpdates.intervalMinutes || 10} min`
        : "Instant")
      : "No queue";
  }
  setLiveUpdatesStatus(liveItems.length
    ? "Live desk preview is ready."
    : "Add one short line per row, then push Live Updates.");
  if (!dom.liveUpdatesPreviewList) return;
  dom.liveUpdatesPreviewList.replaceChildren();

  if (!timeline.length) {
    const empty = document.createElement("p");
    empty.className = "rounded-2xl bg-slate-50 px-4 py-4 text-sm text-slate-500";
    empty.textContent = "No quick live lines are queued yet.";
    dom.liveUpdatesPreviewList.append(empty);
    return;
  }

  timeline.slice(0, 12).forEach((item) => {
    const card = document.createElement("div");
    card.className = "rounded-[22px] border border-slate-200 bg-slate-50 px-4 py-4";

    const headline = document.createElement("p");
    headline.className = "text-sm font-semibold text-slate-950";
    headline.textContent = item.text;

    const meta = document.createElement("p");
    meta.className = "mt-2 text-xs text-slate-500";
    meta.textContent = liveUpdates.mode === "scheduled"
      ? `${fmtDate(item.scheduledAt)} | ${timeAgo(item.scheduledAt)}`
      : "Push goes live instantly";

    card.append(headline, meta);
    dom.liveUpdatesPreviewList.append(card);
  });
}

function applyLiveUpdatesArticle(article = null) {
  if (!article) {
    resetLiveUpdatesDashboard();
    return;
  }

  state.selectedLiveUpdatesArticleId = cleanText(article.id || "");
  if (dom.liveUpdatesHeadline) dom.liveUpdatesHeadline.textContent = cleanText(article.title || "Untitled story");
  if (dom.liveUpdatesMeta) {
    dom.liveUpdatesMeta.textContent = [
      "Managed automatically",
      toTitleCase(article.category || "news"),
      fmtDate(article.created_at || article.published_at || new Date().toISOString()),
      article.liveUpdateCount ? `${article.liveUpdateCount} live lines saved` : "No quick lines saved yet",
    ].filter(Boolean).join(" | ");
  }

  const liveUpdates = normalizeLiveUpdatesConfig(article.liveUpdates || article.live_updates || {}, {
    startedAt: signalStartFallback(article),
  });
  if (dom.liveUpdatesScheduleToggle) dom.liveUpdatesScheduleToggle.checked = liveUpdates.mode === "scheduled";
  if (dom.liveUpdatesIntervalInput) dom.liveUpdatesIntervalInput.value = String(liveUpdates.intervalMinutes || 10);
  syncLiveUpdatesScheduleState();
  if (dom.liveUpdatesQueueInput) dom.liveUpdatesQueueInput.value = "";

  renderLiveUpdatesPreview();
}

function createSignalStoryCard(article = {}, options = {}) {
  const card = document.createElement("button");
  card.type = "button";
  const isSelected = cleanText(article.id || "") === cleanText(options.selectedId || "");
  const isInteractive = typeof options.onSelect === "function";
  card.className = `w-full rounded-[22px] border px-4 py-4 text-left transition ${
    isSelected ? "border-slate-950 bg-amber-50" : "border-slate-200 bg-slate-50"
  }`;
  if (isInteractive) {
    card.classList.add("hover:border-slate-300", "hover:bg-white");
  } else {
    card.disabled = true;
    card.classList.add("cursor-default");
  }

  const title = document.createElement("p");
  title.className = "text-sm font-semibold leading-6 text-slate-950";
  title.textContent = cleanText(article.title || "Untitled story");

  const meta = document.createElement("p");
  meta.className = "mt-2 text-xs text-slate-500";
  meta.textContent = cleanText(options.meta || "");

  card.append(title, meta);
  if (isInteractive) {
    card.addEventListener("click", () => {
      options.onSelect(article);
    });
  }
  return card;
}

function createLiveUpdatesQueueCard(article = {}) {
  const card = document.createElement("article");
  card.className = "rounded-[22px] border border-slate-200 bg-slate-50 px-4 py-4";

  const heading = document.createElement("p");
  heading.className = "text-sm font-semibold leading-6 text-slate-950";
  heading.textContent = "Current live desk queue";

  const meta = document.createElement("p");
  meta.className = "mt-2 text-xs text-slate-500";
  meta.textContent = `${Number(article.liveUpdateCount || 0)} live lines • ${fmtDate(article.created_at || article.published_at || "")}`;

  const timeline = buildLiveUpdateTimelinePreview(
    normalizeLiveUpdatesConfig(article.liveUpdates || article.live_updates || {}, {
      startedAt: signalStartFallback(article),
    }),
    article
  );
  const queue = document.createElement("div");
  queue.className = "mt-3 space-y-2";

  timeline.slice(0, 3).forEach((item) => {
    const line = document.createElement("p");
    line.className = "text-sm leading-6 text-slate-700";
    line.textContent = item.text;
    queue.append(line);
  });

  card.append(heading, meta);
  if (timeline.length) card.append(queue);
  return card;
}

function renderSignalBoards() {
  const readerStories = [...state.archiveArticles]
    .filter((article) => Number(article.syntheticViews || 0) > 0)
    .sort((left, right) => {
      const syntheticDiff = Number(right.syntheticViews || 0) - Number(left.syntheticViews || 0);
      if (syntheticDiff !== 0) return syntheticDiff;
      return new Date(right.created_at || right.published_at || 0).getTime()
        - new Date(left.created_at || left.published_at || 0).getTime();
    })
    .slice(0, 12);

  const liveStories = [...state.archiveArticles]
    .filter((article) => Number(article.liveUpdateCount || 0) > 0)
    .sort((left, right) => {
      const liveDiff = Number(right.liveUpdateCount || 0) - Number(left.liveUpdateCount || 0);
      if (liveDiff !== 0) return liveDiff;
      return sortStoriesByNewest(left, right);
    })
    .slice(0, 12);
  const liveDeskArticle = resolveLiveUpdatesTargetArticle();

  if (dom.readerPulsePushedCount) {
    dom.readerPulsePushedCount.textContent = `${readerStories.length} live`;
  }
  if (dom.readerPulsePushedList) {
    dom.readerPulsePushedList.replaceChildren();
    if (!readerStories.length) {
      const empty = document.createElement("p");
      empty.className = "rounded-2xl bg-slate-50 px-4 py-4 text-sm text-slate-500";
      empty.textContent = "Stories pushed to People Are Reading will appear here.";
      dom.readerPulsePushedList.append(empty);
    } else {
      readerStories.forEach((article) => {
        dom.readerPulsePushedList.append(createSignalStoryCard(article, {
          selectedId: state.selectedReaderPulseArticleId,
          meta: `${formatCompactNumber(article.syntheticViews || 0)} readers • ${fmtDate(article.created_at || article.published_at || "")}`,
          onSelect: applyStorySignalsArticle,
        }));
      });
    }
  }

  if (dom.liveUpdatesPushedCount) {
    dom.liveUpdatesPushedCount.textContent = liveDeskArticle && Number(liveDeskArticle.liveUpdateCount || 0) > 0
      ? `${Number(liveDeskArticle.liveUpdateCount || 0)} lines`
      : "0 live";
  }
  if (dom.liveUpdatesPushedList) {
    dom.liveUpdatesPushedList.replaceChildren();
    if (!liveDeskArticle || Number(liveDeskArticle.liveUpdateCount || 0) <= 0) {
      const empty = document.createElement("p");
      empty.className = "rounded-2xl bg-slate-50 px-4 py-4 text-sm text-slate-500";
      empty.textContent = "The current live desk queue will appear here after you push it.";
      dom.liveUpdatesPushedList.append(empty);
    } else {
      dom.liveUpdatesPushedList.append(createLiveUpdatesQueueCard(liveDeskArticle));
    }
  }

  if (liveDeskArticle && (!state.selectedLiveUpdatesArticleId || !findArchiveArticleById(state.selectedLiveUpdatesArticleId))) {
    applyLiveUpdatesArticle(liveDeskArticle);
  }
}

function setButtonBusy(button, busy, busyLabel) {
  if (!button) return;
  if (!button.dataset.label) button.dataset.label = button.textContent || "";
  button.disabled = busy;
  button.textContent = busy ? busyLabel : button.dataset.label;
}

function createRemoveButton(onClick) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "rounded-full border border-slate-300 bg-white px-4 py-2 text-xs font-semibold text-slate-900 transition hover:border-red-500 hover:text-red-600";
  button.textContent = "Remove";
  button.addEventListener("click", onClick);
  return button;
}

function createKeyPointRow(value = "") {
  const row = document.createElement("div");
  row.className = "flex items-center gap-3";

  const input = document.createElement("input");
  input.type = "text";
  input.value = cleanText(value);
  input.placeholder = "Write a crisp key point readers should understand quickly";
  input.className = "h-12 flex-1 rounded-2xl border border-slate-300 bg-white px-4 text-sm outline-none transition focus:border-slate-950";
  input.dataset.role = "key-point";
  input.addEventListener("input", syncFeaturedPreview);

  row.append(input, createRemoveButton(() => {
    row.remove();
    ensureMinimumRows();
  }));
  return row;
}

function createFactSheetRow(rowData = {}) {
  const row = document.createElement("div");
  row.className = "grid gap-3 md:grid-cols-[0.42fr_0.58fr_auto]";

  const label = document.createElement("input");
  label.type = "text";
  label.value = cleanText(rowData.label);
  label.placeholder = "Label";
  label.className = "h-12 rounded-2xl border border-slate-300 bg-white px-4 text-sm outline-none transition focus:border-slate-950";
  label.dataset.role = "fact-label";

  const value = document.createElement("input");
  value.type = "text";
  value.value = cleanText(rowData.value);
  value.placeholder = "Verified value";
  value.className = "h-12 rounded-2xl border border-slate-300 bg-white px-4 text-sm outline-none transition focus:border-slate-950";
  value.dataset.role = "fact-value";

  row.append(label, value, createRemoveButton(() => {
    row.remove();
    ensureMinimumRows();
  }));
  return row;
}

function createBackgroundRow(item = {}) {
  const row = document.createElement("div");
  row.className = "rounded-[24px] border border-slate-200 bg-slate-50 p-4";

  const fields = document.createElement("div");
  fields.className = "grid gap-3";

  const title = document.createElement("input");
  title.type = "text";
  title.value = cleanText(item.title);
  title.placeholder = "Background title";
  title.className = "h-12 rounded-2xl border border-slate-300 bg-white px-4 text-sm outline-none transition focus:border-slate-950";
  title.dataset.role = "background-title";

  const context = document.createElement("textarea");
  context.value = cleanText(item.context);
  context.placeholder = "Add context readers should know before or after this update.";
  context.className = "min-h-[110px] rounded-[20px] border border-slate-300 bg-white px-4 py-3 text-sm leading-7 outline-none transition focus:border-slate-950";
  context.dataset.role = "background-context";

  const actions = document.createElement("div");
  actions.className = "mt-3 flex justify-end";

  fields.append(title, context);
  actions.append(createRemoveButton(() => {
    row.remove();
    ensureMinimumRows();
  }));
  row.append(fields, actions);
  return row;
}

function ensureMinimumRows() {
  if (dom.keyPointsList) {
    while (dom.keyPointsList.children.length < MIN_KEY_POINTS) {
      dom.keyPointsList.append(createKeyPointRow());
    }
  }

  if (dom.factSheetRows) {
    while (dom.factSheetRows.children.length < MIN_FACT_ROWS) {
      dom.factSheetRows.append(createFactSheetRow());
    }
  }

  if (dom.backgroundRows) {
    while (dom.backgroundRows.children.length < MIN_BACKGROUND) {
      dom.backgroundRows.append(createBackgroundRow());
    }
  }
}

function resetStructuredInputs() {
  if (dom.keyPointsList) dom.keyPointsList.replaceChildren();
  if (dom.factSheetRows) dom.factSheetRows.replaceChildren();
  if (dom.backgroundRows) dom.backgroundRows.replaceChildren();
  ensureMinimumRows();
}

function extractTags() {
  return cleanText(dom.tagsInput?.value || "")
    .split(",")
    .map((entry) => cleanText(entry))
    .filter(Boolean)
    .slice(0, 8);
}

function extractKeyPoints() {
  return [...(dom.keyPointsList?.querySelectorAll('[data-role="key-point"]') || [])]
    .map((input) => cleanText(input.value))
    .filter(Boolean)
    .slice(0, 6);
}

function extractFactSheet() {
  return [...(dom.factSheetRows?.children || [])]
    .map((row) => ({
      label: cleanText(row.querySelector('[data-role="fact-label"]')?.value || ""),
      value: cleanText(row.querySelector('[data-role="fact-value"]')?.value || ""),
    }))
    .filter((row) => row.label && row.value)
    .slice(0, 8);
}

function extractBackground() {
  return [...(dom.backgroundRows?.children || [])]
    .map((row) => ({
      title: cleanText(row.querySelector('[data-role="background-title"]')?.value || ""),
      context: cleanText(row.querySelector('[data-role="background-context"]')?.value || ""),
    }))
    .filter((item) => item.title && item.context)
    .slice(0, 6);
}

function getFormPayload() {
  return {
    headline: cleanText(dom.headlineInput?.value || ""),
    subheadline: cleanText(dom.subheadlineInput?.value || ""),
    authorName: cleanText(dom.authorNameInput?.value || ""),
    source: cleanText(dom.sourceInput?.value || ""),
    primarySourceName: cleanText(dom.primarySourceNameInput?.value || ""),
    primarySourceUrl: cleanText(dom.primarySourceUrlInput?.value || ""),
    category: cleanText(dom.categoryInput?.value || ""),
    image_url: state.imageUrl,
    content: String(dom.contentEditor?.value || "").replace(/\r/g, "").trim(),
    tags: extractTags(),
    keyPoints: extractKeyPoints(),
    factSheet: extractFactSheet(),
    background: extractBackground(),
    indiaPulse: cleanText(dom.indiaPulseInput?.value || ""),
    metaTitle: cleanText(dom.metaTitleInput?.value || ""),
    metaDescription: cleanText(dom.metaDescriptionInput?.value || ""),
    showOnHero: Boolean(dom.showOnHeroInput?.checked),
    durationMinutes: Math.max(0, Number(dom.durationMinutesInput?.value || 0) || 0),
    featuredUntil: cleanText(dom.featuredUntilInput?.value || ""),
  };
}

function validatePayload(payload) {
  if (!payload.headline) return "Headline is required.";
  if (!payload.subheadline) return "Under-headline is required.";
  if (wordCount(payload.subheadline) < MIN_SUMMARY_WORDS) return `Under-headline should be at least ${MIN_SUMMARY_WORDS} words.`;
  if (!payload.authorName) return "Author name is required.";
  if (!payload.source) return "Source label is required.";
  if (!payload.primarySourceName) return "Primary source name is required.";
  if (!/^https?:\/\//i.test(payload.primarySourceUrl)) return "Primary source URL must be a valid link.";
  if (!payload.category) return "Category is required.";
  if (!payload.image_url) return "Cover image is required.";
  if (!payload.metaTitle) return "SEO title is required.";
  if (!payload.metaDescription) return "SEO description is required.";
  if (!payload.content) return "Article body is required.";
  if (wordCount(payload.content) < MIN_BODY_WORDS) return `Article body should be at least ${MIN_BODY_WORDS} words.`;
  if (paragraphCount(payload.content) < MIN_PARAGRAPHS) return `Article body should have at least ${MIN_PARAGRAPHS} paragraphs.`;
  if (payload.keyPoints.length < MIN_KEY_POINTS) return `Add at least ${MIN_KEY_POINTS} key points.`;
  if (payload.factSheet.length < MIN_FACT_ROWS) return `Add at least ${MIN_FACT_ROWS} fact sheet rows.`;
  if (payload.background.length < MIN_BACKGROUND) return `Add at least ${MIN_BACKGROUND} background blocks.`;
  if (wordCount(payload.indiaPulse) < 18) return "Add a stronger Why it matters section.";
  if (payload.showOnHero && !(payload.durationMinutes > 0 || payload.featuredUntil)) {
    return "Choose hero duration in minutes or set a hero end time.";
  }
  return "";
}

function syncEditorMode() {
  const editing = Boolean(state.currentEditingArticleId);
  const requestMode = state.mode === "submit-request";
  if (dom.editorModeLabel) {
    dom.editorModeLabel.textContent = requestMode
      ? (editing ? "Review Request Draft" : "Submit Request")
      : (editing ? "Edit News" : "Create News");
  }
  if (dom.editorHeading) {
    dom.editorHeading.textContent = requestMode
      ? (editing ? "Update request draft" : "Create approval-ready story")
      : (editing ? "Update manual story" : "Create article-ready story");
  }
  if (dom.currentEditMeta) {
    dom.currentEditMeta.textContent = requestMode
      ? "This story will stay pending until an admin accepts it and publishes it."
      : (editing
        ? "You are editing an existing pushed article. Save again to update homepage and article data."
        : "Fill every field needed for homepage, category, and article page quality.");
  }
  if (dom.cancelEditButton) dom.cancelEditButton.hidden = !editing || requestMode;
  if (dom.pushNewsButton) {
    dom.pushNewsButton.textContent = requestMode
      ? "Submit Request"
      : (editing ? "Update News" : "Push News");
    dom.pushNewsButton.dataset.label = dom.pushNewsButton.textContent;
  }
}

function applyPageHeader() {
  const copy = {
    "news-requests": {
      eyebrow: "News Requests",
      title: "Review contributor news requests.",
      description: "Approved emails can draft stories, but only admin approval pushes them live on the homepage and selected category.",
    },
    "edit-news": {
      eyebrow: "CMS Panel",
      title: "Edit and publish article-ready news.",
      description: "Fill the homepage, category page, and article page in one workflow. This editor is built for richer article structure, stronger SEO, and cleaner reading on laptop and mobile.",
    },
    "watch-all-news": {
      eyebrow: "Archive Desk",
      title: "Watch every pushed story day by day.",
      description: "See all manually pushed stories grouped by day. Today appears first, then yesterday, then older days with newest pushed articles first inside each group.",
    },
    "access-control": {
      eyebrow: "Access Control",
      title: "Manage contributor newsroom access.",
      description: "Grant or remove email access for people who can submit stories into the approval queue without direct publish rights.",
    },
    "submit-request": {
      eyebrow: "Submit Request",
      title: "Create a story for admin approval.",
      description: "Use the same structured form as the admin desk. Your story will stay pending until it is reviewed and accepted.",
    },
  }[state.mode] || {
    eyebrow: "Newsroom",
    title: "Manage the newsroom.",
    description: "Keep publishing quality and approval flow in one place.",
  };

  if (dom.adminPageEyebrow) dom.adminPageEyebrow.textContent = copy.eyebrow;
  if (dom.adminPageTitle) dom.adminPageTitle.textContent = copy.title;
  if (dom.adminPageDescription) dom.adminPageDescription.textContent = copy.description;
  if (dom.sidebarSubtitle) {
    dom.sidebarSubtitle.textContent = isAdminRole() ? "Newsroom dashboard" : "Contributor request desk";
  }
  if (dom.adminRoleBadge) {
    dom.adminRoleBadge.textContent = isAdminRole() ? "Admin access" : "Contributor access";
  }
  if (dom.sidePanelEyebrow) {
    dom.sidePanelEyebrow.textContent = isAdminRole() ? "Recent Manual News" : "My Requests";
  }
  if (dom.sidePanelTitle) {
    dom.sidePanelTitle.textContent = isAdminRole() ? "Latest pushes" : "My submission history";
  }
}

function styleNavLink(link, active) {
  if (!link) return;
  link.classList.toggle("bg-slate-950", active);
  link.classList.toggle("text-white", active);
  link.classList.toggle("border-slate-950", active);
  link.classList.toggle("bg-white", !active);
  link.classList.toggle("text-slate-950", !active);
}

function syncRoleVisibility() {
  const adminOnlyHidden = !isAdminRole();
  if (dom.navRequests) dom.navRequests.hidden = adminOnlyHidden;
  if (dom.navWatchAllNews) dom.navWatchAllNews.hidden = adminOnlyHidden;
  if (dom.navAccessControl) dom.navAccessControl.hidden = adminOnlyHidden;
  if (dom.navSubmitRequest) dom.navSubmitRequest.hidden = true;
  if (dom.navEditNews) {
    dom.navEditNews.hidden = false;
    dom.navEditNews.href = isAdminRole() ? "/admin/news?mode=edit-news" : "/admin/news?mode=submit-request";
    const title = dom.navEditNews.querySelector("span:first-child");
    const badge = dom.navEditNews.querySelector("span:last-child");
    if (title) title.textContent = "Edit News";
    if (badge) badge.textContent = isAdminRole() ? "Desk" : "Request";
  }
  if (dom.featuredRemoveButton && !state.featuredArticle?.id) {
    dom.featuredRemoveButton.hidden = true;
  } else if (dom.featuredRemoveButton) {
    dom.featuredRemoveButton.hidden = !isAdminRole();
  }
}

function syncModeInUrl() {
  const url = new URL(window.location.href);
  const defaultMode = defaultModeForRole();
  if (state.mode === defaultMode) url.searchParams.delete("mode");
  else url.searchParams.set("mode", state.mode);
  if (state.mode !== "edit-news" && !state.currentEditingArticleId) url.searchParams.delete("edit");
  window.history.replaceState({}, "", `${url.pathname}${url.search}`);
}

function setViewMode(mode, options = {}) {
  state.mode = normalizeMode(mode);
  if (dom.requestDashboardSection) dom.requestDashboardSection.hidden = state.mode !== "news-requests";
  if (dom.editDashboardSection) dom.editDashboardSection.hidden = !["edit-news", "submit-request"].includes(state.mode);
  if (dom.watchAllDashboardSection) dom.watchAllDashboardSection.hidden = state.mode !== "watch-all-news";
  if (dom.accessDashboardSection) dom.accessDashboardSection.hidden = state.mode !== "access-control";
  styleNavLink(dom.navRequests, state.mode === "news-requests");
  styleNavLink(dom.navEditNews, state.mode === "edit-news" || state.mode === "submit-request");
  styleNavLink(dom.navWatchAllNews, state.mode === "watch-all-news");
  styleNavLink(dom.navAccessControl, state.mode === "access-control");
  styleNavLink(dom.navSubmitRequest, state.mode === "submit-request");
  applyPageHeader();
  syncEditorMode();
  syncRoleVisibility();
  if (!options.skipUrl) syncModeInUrl();
}

function draftPreviewArticle() {
  return {
    title: cleanText(dom.headlineInput?.value || ""),
    source: cleanText(dom.sourceInput?.value || ""),
    category: cleanText(dom.categoryInput?.value || ""),
    image_url: state.imageUrl,
    featured_until: cleanText(dom.featuredUntilInput?.value || ""),
  };
}

function renderFeaturedStatus(article) {
  state.featuredArticle = article || null;
  if (!article) {
    if (dom.featuredStatus) {
      dom.featuredStatus.textContent = isAdminRole()
        ? "No live hero article."
        : "Draft hero preview updates here.";
    }
    if (dom.featuredMeta) {
      dom.featuredMeta.textContent = isAdminRole()
        ? "Push a story with hero enabled to reserve the homepage top slot."
        : "Turn hero on to request homepage priority for this story.";
    }
    if (dom.featuredRemoveButton) dom.featuredRemoveButton.hidden = true;
    syncFeaturedPreview();
    return;
  }

  if (dom.featuredStatus) dom.featuredStatus.textContent = cleanText(article.title || "Hero article");
  if (dom.featuredMeta) {
    const expiry = article.featured_until ? `Hero until ${fmtDate(article.featured_until)}` : "Hero timing not set";
    dom.featuredMeta.textContent = `${toTitleCase(article.category || "news")} | ${expiry}`;
  }
  if (dom.featuredRemoveButton) dom.featuredRemoveButton.hidden = !isAdminRole();
  syncFeaturedPreview();
}

function syncFeaturedPreview() {
  const draftArticle = draftPreviewArticle();
  const draftHasPreview = Boolean(
    cleanText(draftArticle.title || "")
    || cleanText(draftArticle.source || "")
    || cleanText(draftArticle.image_url || "")
  );
  const sourceArticle = isAdminRole()
    ? ((dom.showOnHeroInput?.checked || !state.featuredArticle) ? draftArticle : state.featuredArticle)
    : (draftHasPreview ? draftArticle : (state.featuredArticle || draftArticle));
  const hasPreview = Boolean(cleanText(sourceArticle.title || "") || cleanText(sourceArticle.source || "") || cleanText(sourceArticle.image_url || ""));

  if (!hasPreview) {
    if (dom.featuredPreviewImage) dom.featuredPreviewImage.src = "/social-card.svg";
    if (dom.featuredPreviewCategory) dom.featuredPreviewCategory.textContent = "Awaiting publish";
    if (dom.featuredPreviewHeadline) dom.featuredPreviewHeadline.textContent = "No hero story is live right now.";
    if (dom.featuredPreviewSource) dom.featuredPreviewSource.textContent = "Switch hero on when you want this article to take the top slot on the homepage.";
    return;
  }

  if (dom.featuredPreviewImage) dom.featuredPreviewImage.src = cleanText(sourceArticle.image_url || sourceArticle.image || "") || "/social-card.svg";
  if (dom.featuredPreviewCategory) dom.featuredPreviewCategory.textContent = toTitleCase(sourceArticle.category || "news");
  if (dom.featuredPreviewHeadline) dom.featuredPreviewHeadline.textContent = cleanText(sourceArticle.title || "Headline preview");

  const previewMeta = [
    cleanText(sourceArticle.source || ""),
    sourceArticle.featured_until ? `Until ${fmtDate(sourceArticle.featured_until)}` : (dom.showOnHeroInput?.checked ? "Ready for hero priority" : ""),
  ].filter(Boolean).join(" | ");
  if (dom.featuredPreviewSource) {
    dom.featuredPreviewSource.textContent = previewMeta || "This article is ready for homepage hero placement.";
  }
}

function renderRecentManualList(items = []) {
  state.recentArticles = Array.isArray(items) ? items : [];
  if (dom.recentManualCount) dom.recentManualCount.textContent = String(state.recentArticles.length);
  if (!dom.recentManualList) return;
  dom.recentManualList.replaceChildren();

  if (!state.recentArticles.length) {
    const empty = document.createElement("p");
    empty.className = "rounded-2xl bg-slate-50 px-4 py-4 text-sm text-slate-500";
    empty.textContent = "No manual stories pushed yet.";
    dom.recentManualList.append(empty);
    return;
  }

  state.recentArticles.forEach((article) => {
    const card = document.createElement("article");
    card.className = "rounded-[24px] border border-slate-200 bg-white p-4";

    const title = document.createElement("p");
    title.className = "text-sm font-semibold leading-6 text-slate-950";
    title.textContent = cleanText(article.title || "Untitled story");

    const meta = document.createElement("p");
    meta.className = "mt-2 text-xs text-slate-500";
    meta.textContent = [
      toTitleCase(article.category || "news"),
      fmtDate(article.created_at || article.published_at || new Date().toISOString()),
      article.is_featured ? "Hero live" : "",
    ].filter(Boolean).join(" | ");

    const actions = document.createElement("div");
    actions.className = "mt-4 flex flex-wrap gap-2";

    const editButton = document.createElement("button");
    editButton.type = "button";
    editButton.className = "rounded-full bg-slate-950 px-4 py-2 text-xs font-semibold text-white transition hover:bg-slate-800";
    editButton.textContent = "Edit";
    editButton.addEventListener("click", async () => {
      try {
        await loadArticleForEdit(article.id);
      } catch (error) {
        setStatus(error.message || "Failed to load article.", true);
        showToast(error.message || "Failed to load article.");
      }
    });

    const viewLink = document.createElement("a");
    viewLink.className = "rounded-full border border-slate-300 bg-white px-4 py-2 text-xs font-semibold text-slate-900 transition hover:border-slate-950";
    viewLink.href = buildArticleHref(article);
    viewLink.target = "_blank";
    viewLink.rel = "noopener noreferrer";
    viewLink.textContent = "Open";

    const deleteButton = document.createElement("button");
    deleteButton.type = "button";
    deleteButton.className = "rounded-full border border-slate-300 bg-white px-4 py-2 text-xs font-semibold text-slate-900 transition hover:border-red-500 hover:text-red-600";
    deleteButton.textContent = "Delete";
    deleteButton.addEventListener("click", () => handleDeleteArticle(article.id, article.title));

    actions.append(editButton, viewLink, deleteButton);
    card.append(title, meta, actions);
    dom.recentManualList.append(card);
  });
}

function renderContributorRequestPanel(items = []) {
  if (dom.recentManualCount) dom.recentManualCount.textContent = String(items.length);
  if (!dom.recentManualList) return;
  dom.recentManualList.replaceChildren();

  if (!items.length) {
    const empty = document.createElement("p");
    empty.className = "rounded-2xl bg-slate-50 px-4 py-4 text-sm text-slate-500";
    empty.textContent = "No requests submitted yet.";
    dom.recentManualList.append(empty);
    return;
  }

  items.forEach((request) => {
    const card = document.createElement("article");
    card.className = "rounded-[24px] border border-slate-200 bg-white p-4";

    const title = document.createElement("p");
    title.className = "text-sm font-semibold leading-6 text-slate-950";
    title.textContent = cleanText(request.requestedHeadline || request.payload?.headline || "Untitled request");

    const meta = document.createElement("p");
    meta.className = "mt-2 text-xs text-slate-500";
    meta.textContent = [
      toTitleCase(request.requestedCategory || request.payload?.category || "news"),
      toTitleCase(request.status || "pending"),
      formatListDate(request.createdAt || ""),
    ].filter(Boolean).join(" | ");

    const note = document.createElement("p");
    note.className = "mt-3 text-sm leading-6 text-slate-600";
    note.textContent = request.reviewerNote
      ? `Review note: ${request.reviewerNote}`
      : (request.status === "approved"
        ? "This request was accepted and published."
        : (request.status === "rejected" ? "This request was rejected." : "Waiting for admin review."));

    card.append(title, meta, note);
    dom.recentManualList.append(card);
  });
}

function renderRequestSummary(items = []) {
  const counts = items.reduce((acc, item) => {
    const key = cleanText(item.status || "pending").toLowerCase() || "pending";
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
  if (dom.requestSummaryPending) dom.requestSummaryPending.textContent = String(counts.pending || 0);
  if (dom.requestSummaryApproved) dom.requestSummaryApproved.textContent = String(counts.approved || 0);
  if (dom.requestSummaryRejected) dom.requestSummaryRejected.textContent = String(counts.rejected || 0);
  if (dom.requestTotalCount) dom.requestTotalCount.textContent = `${items.length} items`;
  if (dom.requestListMeta) {
    dom.requestListMeta.textContent = items.length
      ? (isAdminRole()
        ? "Review pending requests first, then scan approved and rejected history."
        : "Your newest pending request appears first.")
      : (isAdminRole()
        ? "No newsroom requests yet."
        : "You have not submitted any requests yet.");
  }
  if (dom.navRequestsCount) dom.navRequestsCount.textContent = String(counts.pending || 0);
}

function renderRequestDetail(request = null) {
  if (!request) {
    state.selectedRequestId = "";
    if (dom.requestDetailEmpty) dom.requestDetailEmpty.hidden = false;
    if (dom.requestDetailCard) dom.requestDetailCard.hidden = true;
    return;
  }

  state.selectedRequestId = cleanText(request.id || "");
  const payload = request.payload || {};
  const bodyParagraphs = String(payload.content || "")
    .replace(/\r/g, "")
    .split(/\n{2,}/)
    .map((entry) => cleanText(entry))
    .filter(Boolean);
  const badgeClasses = statusBadgeClass(request.status || "pending");

  if (dom.requestDetailEmpty) dom.requestDetailEmpty.hidden = true;
  if (dom.requestDetailCard) dom.requestDetailCard.hidden = false;
  if (dom.requestDetailHeadline) dom.requestDetailHeadline.textContent = cleanText(payload.headline || request.requestedHeadline || "Untitled request");
  if (dom.requestDetailMeta) {
    dom.requestDetailMeta.textContent = [
      toTitleCase(payload.category || request.requestedCategory || "news"),
      formatListDate(request.createdAt || ""),
      payload.showOnHero ? "Requested hero placement" : "Standard placement",
    ].filter(Boolean).join(" | ");
  }
  if (dom.requestDetailStatus) {
    dom.requestDetailStatus.textContent = toTitleCase(request.status || "pending");
    dom.requestDetailStatus.className = `rounded-full px-4 py-2 text-xs font-semibold uppercase tracking-[0.18em] ${badgeClasses.join(" ")}`;
  }
  if (dom.approveRequestButton) dom.approveRequestButton.hidden = !isAdminRole() || request.status !== "pending";
  if (dom.rejectRequestButton) dom.rejectRequestButton.hidden = !isAdminRole() || request.status !== "pending";
  if (dom.requestDetailImage) dom.requestDetailImage.src = cleanText(payload.image_url || "") || "/social-card.svg";
  if (dom.requestDetailRequester) dom.requestDetailRequester.textContent = cleanText(request.requesterName || request.requesterEmail || "Unknown requester");
  if (dom.requestDetailRequesterMeta) {
    dom.requestDetailRequesterMeta.textContent = [
      cleanText(request.requesterEmail || ""),
      request.updatedAt && request.updatedAt !== request.createdAt ? `Updated ${formatListDate(request.updatedAt)}` : "",
    ].filter(Boolean).join(" | ");
  }
  if (dom.requestDetailSetup) {
    dom.requestDetailSetup.textContent = [
      toTitleCase(payload.category || request.requestedCategory || "news"),
      payload.showOnHero ? "Hero requested" : "No hero request",
    ].join(" | ");
  }
  if (dom.requestDetailReviewMeta) {
    dom.requestDetailReviewMeta.textContent = request.reviewedByEmail
      ? `${toTitleCase(request.status || "")} by ${request.reviewedByEmail}${request.reviewedAt ? ` on ${formatListDate(request.reviewedAt)}` : ""}`
      : "Not reviewed yet.";
  }
  if (dom.requestDetailSummary) dom.requestDetailSummary.textContent = cleanText(payload.subheadline || "");
  if (dom.requestDetailWhyMatters) dom.requestDetailWhyMatters.textContent = cleanText(payload.indiaPulse || "");
  if (dom.requestDetailSource) {
    dom.requestDetailSource.textContent = [
      cleanText(payload.source || ""),
      cleanText(payload.primarySourceName || ""),
      cleanText(payload.authorName || ""),
    ].filter(Boolean).join(" | ");
  }
  if (dom.requestDetailPrimarySourceLink) {
    const href = cleanText(payload.primarySourceUrl || "");
    dom.requestDetailPrimarySourceLink.hidden = !href;
    dom.requestDetailPrimarySourceLink.href = href || "#";
  }
  if (dom.requestDetailMetaTitle) dom.requestDetailMetaTitle.textContent = cleanText(payload.metaTitle || "");
  if (dom.requestDetailMetaDescription) dom.requestDetailMetaDescription.textContent = cleanText(payload.metaDescription || "");
  if (dom.requestDetailTags) {
    const tags = Array.isArray(payload.tags) ? payload.tags.filter(Boolean) : [];
    dom.requestDetailTags.textContent = tags.length ? `Tags: ${tags.join(", ")}` : "Tags: None";
  }

  if (dom.requestDetailBody) {
    dom.requestDetailBody.replaceChildren();
    if (!bodyParagraphs.length) {
      const empty = document.createElement("p");
      empty.textContent = "No article body provided.";
      dom.requestDetailBody.append(empty);
    } else {
      bodyParagraphs.forEach((paragraph) => {
        const node = document.createElement("p");
        node.textContent = paragraph;
        dom.requestDetailBody.append(node);
      });
    }
  }

  if (dom.requestDetailKeyPoints) {
    const keyPoints = Array.isArray(payload.keyPoints) ? payload.keyPoints.filter(Boolean) : [];
    dom.requestDetailKeyPoints.replaceChildren();
    keyPoints.forEach((item) => {
      const row = document.createElement("p");
      row.className = "rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm leading-6 text-slate-800";
      row.textContent = item;
      dom.requestDetailKeyPoints.append(row);
    });
    if (!keyPoints.length) {
      const empty = document.createElement("p");
      empty.className = "text-sm text-slate-500";
      empty.textContent = "No key points added.";
      dom.requestDetailKeyPoints.append(empty);
    }
    if (dom.requestDetailKeyPointCount) dom.requestDetailKeyPointCount.textContent = String(keyPoints.length);
  }

  if (dom.requestDetailFactSheet) {
    const facts = Array.isArray(payload.factSheet) ? payload.factSheet.filter((item) => cleanText(item?.label || "") && cleanText(item?.value || "")) : [];
    dom.requestDetailFactSheet.replaceChildren();
    facts.forEach((item) => {
      const row = document.createElement("div");
      row.className = "grid gap-2 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 sm:grid-cols-[0.38fr_0.62fr]";
      const label = document.createElement("p");
      label.className = "text-xs font-semibold uppercase tracking-[0.16em] text-slate-500";
      label.textContent = cleanText(item.label);
      const value = document.createElement("p");
      value.className = "text-sm leading-6 text-slate-800";
      value.textContent = cleanText(item.value);
      row.append(label, value);
      dom.requestDetailFactSheet.append(row);
    });
    if (!facts.length) {
      const empty = document.createElement("p");
      empty.className = "text-sm text-slate-500";
      empty.textContent = "No fact sheet rows added.";
      dom.requestDetailFactSheet.append(empty);
    }
    if (dom.requestDetailFactCount) dom.requestDetailFactCount.textContent = String(facts.length);
  }

  if (dom.requestDetailBackground) {
    const background = Array.isArray(payload.background) ? payload.background.filter((item) => cleanText(item?.title || "") && cleanText(item?.context || "")) : [];
    dom.requestDetailBackground.replaceChildren();
    background.forEach((item) => {
      const card = document.createElement("div");
      card.className = "rounded-[24px] border border-slate-200 bg-slate-50 px-4 py-4";
      const title = document.createElement("p");
      title.className = "text-sm font-semibold text-slate-950";
      title.textContent = cleanText(item.title);
      const context = document.createElement("p");
      context.className = "mt-2 text-sm leading-6 text-slate-700";
      context.textContent = cleanText(item.context);
      card.append(title, context);
      dom.requestDetailBackground.append(card);
    });
    if (!background.length) {
      const empty = document.createElement("p");
      empty.className = "text-sm text-slate-500";
      empty.textContent = "No background blocks added.";
      dom.requestDetailBackground.append(empty);
    }
    if (dom.requestDetailBackgroundCount) dom.requestDetailBackgroundCount.textContent = String(background.length);
  }
}

function renderRequestList(items = []) {
  state.requests = Array.isArray(items) ? items : [];
  renderRequestSummary(state.requests);
  if (!dom.requestList) return;
  dom.requestList.replaceChildren();

  if (!state.requests.length) {
    const empty = document.createElement("p");
    empty.className = "rounded-2xl bg-slate-50 px-4 py-4 text-sm text-slate-500";
    empty.textContent = isAdminRole() ? "No contributor requests yet." : "You have not submitted any requests yet.";
    dom.requestList.append(empty);
    renderRequestDetail(null);
    renderContributorRequestPanel(state.requests);
    return;
  }

  state.requests.forEach((request) => {
    const item = document.createElement("button");
    item.type = "button";
    item.className = "request-item w-full rounded-[24px] border border-slate-200 bg-white p-4 text-left transition hover:border-slate-950";
    if (cleanText(request.id) === state.selectedRequestId) item.classList.add("is-active");

    const top = document.createElement("div");
    top.className = "flex items-center justify-between gap-3";

    const title = document.createElement("p");
    title.className = "text-sm font-semibold leading-6 text-slate-950";
    title.textContent = cleanText(request.requestedHeadline || request.payload?.headline || "Untitled request");

    const status = document.createElement("span");
    const badgeClasses = statusBadgeClass(request.status || "pending");
    status.className = `rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] ${badgeClasses.join(" ")}`;
    status.textContent = cleanText(request.status || "pending");

    const meta = document.createElement("p");
    meta.className = "mt-2 text-xs text-slate-500";
    meta.textContent = isAdminRole()
      ? [cleanText(request.requesterEmail || ""), toTitleCase(request.requestedCategory || request.payload?.category || "news"), formatListDate(request.createdAt || "")]
        .filter(Boolean)
        .join(" | ")
      : [toTitleCase(request.requestedCategory || request.payload?.category || "news"), formatListDate(request.createdAt || "")]
        .filter(Boolean)
        .join(" | ");

    const summary = document.createElement("p");
    summary.className = "mt-3 text-sm leading-6 text-slate-600";
    summary.textContent = cleanText(request.payload?.subheadline || "No under-headline provided.");

    top.append(title, status);
    item.append(top, meta, summary);
    item.addEventListener("click", () => {
      state.selectedRequestId = cleanText(request.id);
      renderRequestList(state.requests);
      renderRequestDetail(request);
    });
    dom.requestList.append(item);
  });

  const selected = state.requests.find((item) => cleanText(item.id) === state.selectedRequestId) || state.requests[0];
  renderRequestDetail(selected);
  renderContributorRequestPanel(state.requests);
}

function renderAccessList(items = []) {
  state.accessList = Array.isArray(items) ? items : [];
  if (dom.accessCount) dom.accessCount.textContent = `${state.accessList.length} emails`;
  if (dom.navAccessCount) dom.navAccessCount.textContent = String(state.accessList.length);
  if (!dom.accessList) return;
  dom.accessList.replaceChildren();

  if (!state.accessList.length) {
    const empty = document.createElement("p");
    empty.className = "rounded-2xl bg-slate-50 px-4 py-4 text-sm text-slate-500";
    empty.textContent = "No contributor emails have access right now.";
    dom.accessList.append(empty);
    return;
  }

  state.accessList.forEach((item) => {
    const card = document.createElement("article");
    card.className = "rounded-[24px] border border-slate-200 bg-white p-4";

    const title = document.createElement("p");
    title.className = "text-sm font-semibold text-slate-950";
    title.textContent = cleanText(item.email || "");

    const meta = document.createElement("p");
    meta.className = "mt-2 text-xs text-slate-500";
    meta.textContent = [
      cleanText(item.createdByEmail || ""),
      item.createdAt ? `Added ${formatListDate(item.createdAt)}` : "",
    ].filter(Boolean).join(" | ");

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "mt-4 rounded-full border border-slate-300 bg-white px-4 py-2 text-xs font-semibold text-slate-900 transition hover:border-red-500 hover:text-red-600";
    remove.textContent = "Remove Access";
    remove.addEventListener("click", () => handleRemoveAccess(item.email));

    card.append(title, meta, remove);
    dom.accessList.append(card);
  });
}

function archiveDateKey(value = "") {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "unknown";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: DISPLAY_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${map.year}-${map.month}-${map.day}`;
}

function archiveDateLabel(key = "") {
  if (!key || key === "unknown") return "Unknown day";
  const nowKey = archiveDateKey(new Date().toISOString());
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayKey = archiveDateKey(yesterday.toISOString());
  if (key === nowKey) return "Today";
  if (key === yesterdayKey) return "Yesterday";

  const date = new Date(`${key}T12:00:00+05:30`);
  return date.toLocaleDateString("en-IN", {
    timeZone: DISPLAY_TIMEZONE,
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function renderArchive(items = []) {
  state.archiveArticles = Array.isArray(items) ? items : [];
  renderStorySignalsArticleOptions(state.archiveArticles);
  renderSignalBoards();
  if (dom.manualTotalCount) dom.manualTotalCount.textContent = `${state.archiveArticles.length} articles`;
  if (dom.archiveUpdatedAt) dom.archiveUpdatedAt.textContent = `Updated ${fmtDate(new Date().toISOString())}`;
  if (!dom.archiveGroups) return;
  dom.archiveGroups.replaceChildren();

  if (!state.archiveArticles.length) {
    resetStorySignalsDashboard({ preserveStatus: true });
    const empty = document.createElement("p");
    empty.className = "rounded-2xl bg-slate-50 px-4 py-4 text-sm text-slate-500";
    empty.textContent = "No pushed articles yet.";
    dom.archiveGroups.append(empty);
    return;
  }

  const groups = new Map();
  state.archiveArticles.forEach((article) => {
    const key = archiveDateKey(article.created_at || article.published_at || "");
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(article);
  });

  groups.forEach((articles, key) => {
    const sortedArticles = [...articles].sort((left, right) =>
      new Date(right.created_at || right.published_at || 0).getTime()
        - new Date(left.created_at || left.published_at || 0).getTime()
    );
    const section = document.createElement("section");
    section.className = "archive-group";

    const header = document.createElement("div");
    header.className = "mb-4 flex items-center justify-between gap-3";

    const title = document.createElement("h3");
    title.className = "font-display text-2xl font-bold tracking-tight text-slate-950";
    title.textContent = archiveDateLabel(key);

    const count = document.createElement("span");
    count.className = "rounded-full bg-slate-100 px-4 py-2 text-xs font-semibold text-slate-900";
    count.textContent = `${articles.length} pushed`;

    header.append(title, count);
    section.append(header);

    const list = document.createElement("div");
    list.className = "grid gap-4";

    sortedArticles.forEach((article) => {
      const card = document.createElement("article");
      const isSelected = cleanText(article.id || "") === cleanText(state.selectedReaderPulseArticleId || "");
      card.className = `rounded-[24px] border bg-white p-4 transition ${isSelected ? "border-slate-950 shadow-lg shadow-slate-200/70" : "border-slate-200"}`;

      const headline = document.createElement("p");
      headline.className = "text-base font-semibold leading-7 text-slate-950";
      headline.textContent = cleanText(article.title || "Untitled story");

      const meta = document.createElement("p");
      meta.className = "mt-2 text-xs text-slate-500";
      meta.textContent = [
        fmtDate(article.created_at || article.published_at || ""),
        toTitleCase(article.category || "news"),
        cleanText(article.source || ""),
        article.is_featured ? "Hero live" : "",
      ].filter(Boolean).join(" | ");

      const actions = document.createElement("div");
      actions.className = "mt-4 flex flex-wrap gap-2";

      const readerButton = document.createElement("button");
      readerButton.type = "button";
      readerButton.className = "rounded-full border border-slate-300 bg-amber-100 px-4 py-2 text-xs font-semibold text-slate-900 transition hover:bg-amber-200";
      readerButton.textContent = "Use in People";
      readerButton.addEventListener("click", () => {
        applyStorySignalsArticle(article);
        window.scrollTo({ top: 0, behavior: "smooth" });
      });

      const editLink = document.createElement("a");
      editLink.className = "rounded-full bg-slate-950 px-4 py-2 text-xs font-semibold text-white transition hover:bg-slate-800";
      editLink.href = `/admin/news?edit=${encodeURIComponent(article.id)}`;
      editLink.textContent = "Edit";
      editLink.addEventListener("click", (event) => event.stopPropagation());

      const openLink = document.createElement("a");
      openLink.className = "rounded-full border border-slate-300 bg-white px-4 py-2 text-xs font-semibold text-slate-900 transition hover:border-slate-950";
      openLink.href = buildArticleHref(article);
      openLink.target = "_blank";
      openLink.rel = "noopener noreferrer";
      openLink.textContent = "Open";
      openLink.addEventListener("click", (event) => event.stopPropagation());

      actions.append(readerButton, editLink, openLink);
      card.append(headline, meta, actions);
      list.append(card);
    });

    section.append(list);
    dom.archiveGroups.append(section);
  });

  if (state.selectedReaderPulseArticleId) {
    const selectedReaderArticle = findArchiveArticleById(state.selectedReaderPulseArticleId);
    if (selectedReaderArticle) {
      applyStorySignalsArticle(selectedReaderArticle);
    } else {
      resetReaderPulseDashboard({ preserveStatus: true });
    }
  }
  if (state.selectedLiveUpdatesArticleId) {
    const selectedLiveArticle = findArchiveArticleById(state.selectedLiveUpdatesArticleId);
    if (selectedLiveArticle) {
      applyLiveUpdatesArticle(selectedLiveArticle);
    } else {
      resetLiveUpdatesDashboard();
    }
  }
}

function applyArticleToForm(article = {}) {
  const normalizedCategory = cleanText(article.category || "ai") || "ai";
  const hasCategoryOption = dom.categoryInput
    ? [...dom.categoryInput.options].some((option) => option.value === normalizedCategory)
    : false;
  state.currentEditingArticleId = cleanText(article.id || "");
  if (dom.headlineInput) dom.headlineInput.value = cleanText(article.headline || "");
  if (dom.subheadlineInput) dom.subheadlineInput.value = cleanText(article.subheadline || "");
  if (dom.authorNameInput) dom.authorNameInput.value = cleanText(article.authorName || "Sunwire News Desk");
  if (dom.sourceInput) dom.sourceInput.value = cleanText(article.source || "");
  if (dom.primarySourceNameInput) dom.primarySourceNameInput.value = cleanText(article.primarySourceName || article.source || "");
  if (dom.primarySourceUrlInput) dom.primarySourceUrlInput.value = cleanText(article.primarySourceUrl || "");
  if (dom.categoryInput) dom.categoryInput.value = hasCategoryOption ? normalizedCategory : "ai";
  if (dom.showOnHeroInput) dom.showOnHeroInput.checked = Boolean(article.showOnHero);
  if (dom.durationMinutesInput) dom.durationMinutesInput.value = "";
  if (dom.featuredUntilInput) dom.featuredUntilInput.value = toLocalDateTimeValue(article.featuredUntil || "");
  if (dom.tagsInput) dom.tagsInput.value = Array.isArray(article.tags) ? article.tags.join(", ") : "";
  if (dom.metaTitleInput) dom.metaTitleInput.value = cleanText(article.metaTitle || "");
  if (dom.metaDescriptionInput) dom.metaDescriptionInput.value = cleanText(article.metaDescription || "");
  if (dom.contentEditor) dom.contentEditor.value = String(article.content || "").replace(/\r/g, "").trim();
  if (dom.indiaPulseInput) dom.indiaPulseInput.value = cleanText(article.indiaPulse || "");

  resetStructuredInputs();
  if (dom.keyPointsList) {
    dom.keyPointsList.replaceChildren(...((article.keyPoints || []).slice(0, 6).map((item) => createKeyPointRow(item))));
  }
  if (dom.factSheetRows) {
    dom.factSheetRows.replaceChildren(...((article.factSheet || []).slice(0, 8).map((item) => createFactSheetRow(item))));
  }
  if (dom.backgroundRows) {
    dom.backgroundRows.replaceChildren(...((article.background || []).slice(0, 6).map((item) => createBackgroundRow(item))));
  }
  ensureMinimumRows();
  setImagePreview(article.image_url || "");
  syncEditorMode();
  syncFeaturedPreview();
}

function clearEditQueryParam() {
  const url = new URL(window.location.href);
  url.searchParams.delete("edit");
  window.history.replaceState({}, "", url.pathname + (url.search ? url.search : ""));
}

function resetForm({ keepStatus = false } = {}) {
  state.currentEditingArticleId = "";
  dom.newsForm?.reset();
  resetStructuredInputs();
  setImagePreview("");
  syncEditorMode();
  clearEditQueryParam();
  if (!keepStatus) setStatus(state.mode === "submit-request" ? "Ready to submit request." : "Ready to publish.");
}

async function loadArticleForEdit(articleId) {
  if (!articleId || !isAdminRole()) return;
  setViewMode("edit-news");
  const data = await fetchJson(`/api/admin?view=news&id=${encodeURIComponent(articleId)}`);
  applyArticleToForm(data.article || {});
  const url = new URL(window.location.href);
  url.pathname = "/admin/news";
  url.searchParams.set("edit", articleId);
  window.history.replaceState({}, "", url.pathname + url.search);
  window.scrollTo({ top: 0, behavior: "smooth" });
  showToast("Loaded story into Edit News.");
}

async function loadAdminSummary(options = {}) {
  const includeCounts = options.includeCounts !== false;
  const scope = includeCounts ? "" : "&scope=editor";
  const data = await fetchJson(`/api/admin?view=news${scope}`, {
    forceFresh: options.forceFresh === true,
  });
  if (data.degraded && data.message) {
    setStatus(data.message);
  }
  renderFeaturedStatus(data.featured || null);
  renderRecentManualList(data.recent || []);
  if (typeof data.pendingRequests !== "undefined" && dom.navRequestsCount) {
    dom.navRequestsCount.textContent = String(Number(data.pendingRequests || 0));
  }
  if (typeof data.submitterCount !== "undefined" && dom.navAccessCount) {
    dom.navAccessCount.textContent = String(Number(data.submitterCount || 0));
  }
}

async function loadArchiveData(options = {}) {
  if (!isAdminRole()) return;
  const data = await fetchJson("/api/admin?view=news&scope=all", {
    forceFresh: options.forceFresh === true,
  });
  if (data.degraded && data.message) {
    setStatus(data.message);
  }
  renderArchive(data.items || []);
}

async function handleStorySignalsMutation(payload = {}, options = {}) {
  const article = findArchiveArticleById(options.articleId || "")
    || (cleanText(state.featuredArticle?.id || "") === cleanText(options.articleId || "") ? state.featuredArticle : null);
  const setStatus = typeof options.setStatus === "function" ? options.setStatus : setStorySignalsStatus;
  if (!article || state.storySignalsBusy) {
    setStatus(state.storySignalsBusy ? "Another push is already in progress. Please wait a moment." : "Choose an article from Watch All News first.", true);
    return;
  }

  state.storySignalsBusy = true;
  setSignalButtonsBusy(options.buttons || [], options.activeButton || null, true, options.busyLabel || "Saving...");
  setStatus(cleanText(options.pendingMessage || "Saving dashboard changes..."));

  try {
    const data = await fetchJson(`/api/admin?view=news&id=${encodeURIComponent(article.id)}&action=story-signals`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    });
    await loadArchiveData({ forceFresh: true });
    const refreshed = data.article ? findArchiveArticleById(data.article.id) : findArchiveArticleById(article.id);
    const nextArticle = refreshed || data.article || article;
    if (options.kind === "readerPulse") {
      applyStorySignalsArticle(nextArticle);
    } else if (options.kind === "liveUpdates") {
      applyLiveUpdatesArticle(nextArticle);
    }
    setStatus(cleanText(options.successMessage || "Saved."));
    showToast(cleanText(options.toastMessage || "Saved."));
  } finally {
    state.storySignalsBusy = false;
    setSignalButtonsBusy(options.buttons || [], options.activeButton || null, false, options.busyLabel || "Saving...");
  }
}

async function handleSaveReaderPulse() {
  const article = findArchiveArticleById(state.selectedReaderPulseArticleId);
  if (!article) {
    setStorySignalsStatus("Choose an article from Watch All News first.", true);
    return;
  }

  const readerPulse = getReaderPulsePayload(article);
  if (!readerPulse.enabled) {
    setStorySignalsStatus("Add a starting visitor count or growth rule, or use Clear People Are Reading.", true);
    return;
  }

  await handleStorySignalsMutation(
    { readerPulse },
    {
      articleId: article.id,
      kind: "readerPulse",
      activeButton: dom.saveReaderPulseButton,
      buttons: [dom.saveReaderPulseButton, dom.clearReaderPulseButton],
      setStatus: setStorySignalsStatus,
      busyLabel: "Pushing...",
      pendingMessage: "Pushing People Are Reading...",
      successMessage: "People Are Reading saved. The sidebar will refresh from this story.",
      toastMessage: "People Are Reading pushed.",
    }
  );
}

async function handleClearReaderPulse() {
  const article = findArchiveArticleById(state.selectedReaderPulseArticleId);
  if (!article) {
    setStorySignalsStatus("Choose an article from Watch All News first.", true);
    return;
  }

  await handleStorySignalsMutation(
    { readerPulse: emptyReaderPulsePayload(article) },
    {
      articleId: article.id,
      kind: "readerPulse",
      activeButton: dom.clearReaderPulseButton,
      buttons: [dom.saveReaderPulseButton, dom.clearReaderPulseButton],
      setStatus: setStorySignalsStatus,
      busyLabel: "Clearing...",
      pendingMessage: "Clearing People Are Reading...",
      successMessage: "People Are Reading cleared for this story.",
      toastMessage: "People Are Reading cleared.",
    }
  );
}

async function handleSaveLiveUpdates() {
  const article = resolveLiveUpdatesTargetArticle();
  if (!article) {
    setLiveUpdatesStatus("Push a story first so Live Updates has somewhere to attach.", true);
    return;
  }

  const liveUpdates = getLiveUpdatesPayload(article);
  if (!liveUpdates.enabled || !liveUpdates.items.length) {
    setLiveUpdatesStatus("Add one short update per line, or use Clear Live Updates.", true);
    return;
  }
  const longLine = liveUpdates.items.find((item) => wordCount(item.text || "") > LIVE_UPDATE_WORD_LIMIT);
  if (longLine) {
    setLiveUpdatesStatus(`Keep each live update line within ${LIVE_UPDATE_WORD_LIMIT} words. "${longLine.text}" is too long.`, true);
    return;
  }

  await handleStorySignalsMutation(
    { liveUpdates },
    {
      articleId: article.id,
      kind: "liveUpdates",
      activeButton: dom.saveLiveUpdatesButton,
      buttons: [dom.saveLiveUpdatesButton, dom.clearLiveUpdatesButton],
      setStatus: setLiveUpdatesStatus,
      busyLabel: "Pushing...",
      pendingMessage: "Pushing Live Updates...",
      successMessage: liveUpdates.mode === "scheduled"
        ? "Live Updates saved. Sunwire will release them on schedule."
        : "Live Updates saved. Sunwire will reflect them instantly.",
      toastMessage: "Live Updates pushed.",
    }
  );
}

async function handleClearLiveUpdates() {
  const article = resolveLiveUpdatesTargetArticle();
  if (!article) {
    setLiveUpdatesStatus("Live desk is already empty.", true);
    return;
  }

  await handleStorySignalsMutation(
    { liveUpdates: emptyLiveUpdatesPayload(article) },
    {
      articleId: article.id,
      kind: "liveUpdates",
      activeButton: dom.clearLiveUpdatesButton,
      buttons: [dom.saveLiveUpdatesButton, dom.clearLiveUpdatesButton],
      setStatus: setLiveUpdatesStatus,
      busyLabel: "Clearing...",
      pendingMessage: "Clearing Live Updates...",
      successMessage: "Live Updates cleared.",
      toastMessage: "Live Updates cleared.",
    }
  );
}

async function loadRequests(options = {}) {
  const data = await fetchJson("/api/admin?view=requests", {
    forceFresh: options.forceFresh === true,
  });
  renderRequestList(data.items || []);
}

async function loadAccessList(options = {}) {
  if (!isAdminRole()) return;
  const data = await fetchJson("/api/admin?view=access", {
    forceFresh: options.forceFresh === true,
  });
  renderAccessList(data.items || []);
}

async function loadPageData(options = {}) {
  const forceFresh = options.forceFresh === true;
  const awaitSummary = options.awaitSummary === true;

  if (!isAdminRole()) {
    await loadRequests({ forceFresh });
    const summaryTask = loadAdminSummary({ forceFresh, includeCounts: false });
    if (awaitSummary) await summaryTask;
    else void summaryTask.catch(() => null);
    return;
  }

  if (state.mode === "edit-news") {
    await loadAdminSummary({ forceFresh, includeCounts: false });
    return;
  }

  if (state.mode === "watch-all-news") {
    await loadArchiveData({ forceFresh });
    const summaryTask = loadAdminSummary({ forceFresh, includeCounts: false });
    if (awaitSummary) await summaryTask;
    else void summaryTask.catch(() => null);
    return;
  }

  if (state.mode === "news-requests") {
    await loadRequests({ forceFresh });
    const summaryTask = loadAdminSummary({ forceFresh, includeCounts: true });
    if (awaitSummary) await summaryTask;
    else void summaryTask.catch(() => null);
    return;
  }

  if (state.mode === "access-control") {
    await loadAccessList({ forceFresh });
    const summaryTask = loadAdminSummary({ forceFresh, includeCounts: true });
    if (awaitSummary) await summaryTask;
    else void summaryTask.catch(() => null);
  }
}

async function handleDeleteArticle(articleId, title = "") {
  if (!articleId) return;
  if (!window.confirm(`Delete "${cleanText(title || "this article")}"? This cannot be undone.`)) return;
  await fetchJson(`/api/admin?view=news&id=${encodeURIComponent(articleId)}`, { method: "DELETE" });
  if (state.currentEditingArticleId === articleId) resetForm({ keepStatus: true });
  showToast("Article deleted.");
  await loadPageData();
  if (state.mode === "watch-all-news") await loadArchiveData();
}

async function handleRemoveHero() {
  if (!state.featuredArticle?.id) return;
  await fetchJson(`/api/admin?view=news&id=${encodeURIComponent(state.featuredArticle.id)}&action=remove-hero`, {
    method: "PATCH",
  });
  showToast("Hero slot cleared.");
  await loadPageData();
}

async function handleApproveRequest() {
  if (!state.selectedRequestId || state.requestBusy) return;
  state.requestBusy = true;
  setRequestButtonState(dom.approveRequestButton, true, "Publishing...");
  setRequestButtonState(dom.rejectRequestButton, true, "Working...");
  try {
    const data = await fetchJson(`/api/admin?view=requests&id=${encodeURIComponent(state.selectedRequestId)}&action=approve`, {
      method: "PATCH",
      body: JSON.stringify({}),
    });
    const statusMessage = buildIndexingStatusMessage("Request approved and published", data.indexing);
    await Promise.all([loadRequests(), loadAdminSummary()]);
    setGlobalStatus(statusMessage, isIndexingStatusError(data.indexing));
    setRequestMeta(statusMessage);
    setStatus(statusMessage);
    showToast(statusMessage);
  } finally {
    state.requestBusy = false;
    setRequestButtonState(dom.approveRequestButton, false, "Publishing...");
    setRequestButtonState(dom.rejectRequestButton, false, "Working...");
  }
}

async function handleRejectRequest() {
  if (!state.selectedRequestId || state.requestBusy) return;
  const reviewerNote = cleanText(window.prompt("Optional reject note for the contributor:", "") || "");
  state.requestBusy = true;
  setRequestButtonState(dom.approveRequestButton, true, "Working...");
  setRequestButtonState(dom.rejectRequestButton, true, "Rejecting...");
  try {
    await fetchJson(`/api/admin?view=requests&id=${encodeURIComponent(state.selectedRequestId)}&action=reject`, {
      method: "PATCH",
      body: JSON.stringify({ reviewerNote }),
    });
    showToast("Request rejected.");
    await loadRequests();
  } finally {
    state.requestBusy = false;
    setRequestButtonState(dom.approveRequestButton, false, "Working...");
    setRequestButtonState(dom.rejectRequestButton, false, "Rejecting...");
  }
}

async function handleGrantAccess(event) {
  event.preventDefault();
  if (state.accessBusy) return;
  const email = cleanText(dom.accessEmailInput?.value || "").toLowerCase();
  if (!email) {
    setAccessStatus("Enter an email address first.", true);
    return;
  }

  state.accessBusy = true;
  setButtonBusy(dom.grantAccessButton, true, "Saving...");
  try {
    await fetchJson("/api/admin?view=access", {
      method: "POST",
      body: JSON.stringify({ email }),
    });
    if (dom.accessEmailInput) dom.accessEmailInput.value = "";
    setAccessStatus("Access updated.");
    showToast("Contributor access saved.");
    await Promise.all([loadAccessList(), loadAdminSummary()]);
  } catch (error) {
    setAccessStatus(error.message || "Access update failed.", true);
    throw error;
  } finally {
    state.accessBusy = false;
    setButtonBusy(dom.grantAccessButton, false, "Saving...");
  }
}

async function handleRemoveAccess(email = "") {
  const normalized = cleanText(email).toLowerCase();
  if (!normalized) return;
  if (!window.confirm(`Remove newsroom access for ${normalized}?`)) return;
  await fetchJson(`/api/admin?view=access&email=${encodeURIComponent(normalized)}`, {
    method: "DELETE",
  });
  setAccessStatus(`${normalized} removed.`);
  showToast("Contributor access removed.");
  await Promise.all([loadAccessList(), loadAdminSummary()]);
}

async function handleImageUpload(file) {
  if (!file) return;
  if (file.size > 4 * 1024 * 1024) {
    throw new Error("Image should be 4 MB or smaller.");
  }

  const imageData = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Image upload failed."));
    reader.readAsDataURL(file);
  });

  setButtonBusy(dom.imageUploadButtonLabel, true, "Uploading...");
  if (dom.imageUploadStatus) dom.imageUploadStatus.textContent = "Uploading image...";
  try {
    const data = await fetchJson("/api/admin?view=upload", {
      method: "POST",
      body: JSON.stringify({
        imageData,
        headline: cleanText(dom.headlineInput?.value || file.name || "manual-story"),
      }),
    });
    setImagePreview(data.image_url || "");
    showToast("Image uploaded.");
  } finally {
    setButtonBusy(dom.imageUploadButtonLabel, false, "Uploading...");
  }
}

async function handleSubmit(event) {
  event.preventDefault();
  if (state.formBusy) return;

  const payload = getFormPayload();
  const error = validatePayload(payload);
  if (error) {
    setStatus(error, true);
    showToast(error);
    return;
  }

  state.formBusy = true;
  const requestMode = state.mode === "submit-request";
  setButtonBusy(dom.pushNewsButton, true, requestMode ? "Sending..." : (state.currentEditingArticleId ? "Updating..." : "Pushing..."));
  setStatus(requestMode ? "Submitting request..." : (state.currentEditingArticleId ? "Updating story..." : "Pushing story..."));

  try {
    if (requestMode) {
      await fetchJson("/api/admin?view=requests", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      resetForm({ keepStatus: true });
      setStatus("Request sent for admin approval.");
      showToast("Request submitted.");
      await loadRequests();
    } else {
      const isUpdate = Boolean(state.currentEditingArticleId);
      const url = isUpdate
        ? `/api/admin?view=news&id=${encodeURIComponent(state.currentEditingArticleId)}`
        : "/api/admin?view=news";
      const data = await fetchJson(url, {
        method: isUpdate ? "PUT" : "POST",
        body: JSON.stringify(payload),
      });

      applyArticleToForm(data.adminArticle || {});
      const statusMessage = buildIndexingStatusMessage(isUpdate ? "Story updated" : "Story pushed", data.indexing);
      setGlobalStatus(statusMessage, isIndexingStatusError(data.indexing));
      setStatus(statusMessage);
      showToast(statusMessage);
      await loadPageData();
      if (state.mode === "watch-all-news") await loadArchiveData();
    }
  } catch (errorResponse) {
    setStatus(errorResponse.message || (requestMode ? "Request failed." : "Publish failed."), true);
    throw errorResponse;
  } finally {
    state.formBusy = false;
    setButtonBusy(dom.pushNewsButton, false, requestMode ? "Sending..." : (state.currentEditingArticleId ? "Updating..." : "Pushing..."));
  }
}

function attachDraftPreviewListeners() {
  [
    dom.headlineInput,
    dom.sourceInput,
    dom.categoryInput,
    dom.showOnHeroInput,
    dom.featuredUntilInput,
  ].forEach((element) => {
    element?.addEventListener("input", syncFeaturedPreview);
    element?.addEventListener("change", syncFeaturedPreview);
  });
  dom.showOnHeroInput?.addEventListener("change", syncFeaturedPreview);
}

function attachQuickDurationButtons() {
  document.querySelectorAll("[data-duration-minutes]").forEach((button) => {
    button.addEventListener("click", () => {
      if (dom.durationMinutesInput) dom.durationMinutesInput.value = button.dataset.durationMinutes || "";
      if (dom.featuredUntilInput) dom.featuredUntilInput.value = "";
      if (dom.showOnHeroInput) dom.showOnHeroInput.checked = true;
      syncFeaturedPreview();
      showToast(`Hero duration set to ${button.dataset.durationMinutes} minutes.`);
    });
  });
}

function attachStorySignalsListeners() {
  [
    dom.readerPulseBaseInput,
    dom.readerPulseStepInput,
    dom.readerPulseMinutesInput,
    dom.readerPulseStartedAtInput,
  ].forEach((element) => {
    element?.addEventListener("input", renderStorySignalsPreview);
    element?.addEventListener("change", renderStorySignalsPreview);
  });

  [
    dom.liveUpdatesScheduleToggle,
    dom.liveUpdatesIntervalInput,
    dom.liveUpdatesQueueInput,
  ].forEach((element) => {
    element?.addEventListener("input", renderLiveUpdatesPreview);
    element?.addEventListener("change", renderLiveUpdatesPreview);
  });
  dom.liveUpdatesScheduleToggle?.addEventListener("change", () => {
    syncLiveUpdatesScheduleState();
    renderLiveUpdatesPreview();
  });

  dom.saveReaderPulseButton?.addEventListener("click", async () => {
    try {
      await handleSaveReaderPulse();
    } catch (error) {
      setStorySignalsStatus(error.message || "People Are Reading push failed.", true);
      showToast(error.message || "People Are Reading push failed.");
    }
  });

  dom.clearReaderPulseButton?.addEventListener("click", async () => {
    try {
      await handleClearReaderPulse();
    } catch (error) {
      setStorySignalsStatus(error.message || "People Are Reading clear failed.", true);
      showToast(error.message || "People Are Reading clear failed.");
    }
  });

  dom.saveLiveUpdatesButton?.addEventListener("click", async () => {
    try {
      await handleSaveLiveUpdates();
    } catch (error) {
      setLiveUpdatesStatus(error.message || "Live Updates push failed.", true);
      showToast(error.message || "Live Updates push failed.");
    }
  });

  dom.clearLiveUpdatesButton?.addEventListener("click", async () => {
    try {
      await handleClearLiveUpdates();
    } catch (error) {
      setLiveUpdatesStatus(error.message || "Live Updates clear failed.", true);
      showToast(error.message || "Live Updates clear failed.");
    }
  });

  dom.storySignalsArticleSelect?.addEventListener("change", (event) => {
    const article = findArchiveArticleById(event.target.value || "");
    if (!article) {
      resetReaderPulseDashboard({ preserveStatus: true });
      setStorySignalsStatus("Choose an article from the dropdown or archive list.", true);
      return;
    }
    applyStorySignalsArticle(article);
  });

}

function attachNavHandlers() {
  [
    [dom.navRequests, "news-requests"],
    [dom.navEditNews, isAdminRole() ? "edit-news" : "submit-request"],
    [dom.navWatchAllNews, "watch-all-news"],
    [dom.navAccessControl, "access-control"],
    [dom.navSubmitRequest, "submit-request"],
  ].forEach(([link, mode]) => {
    link?.addEventListener("click", async (event) => {
      event.preventDefault();
      const nextMode = normalizeMode(mode);
      if (state.mode === nextMode) return;
      setViewMode(nextMode);
      try {
        await loadPageData();
      } catch (error) {
        setStatus(error.message || "Dashboard load failed.", true);
        showToast(error.message || "Dashboard load failed.");
      }
    });
  });
}

function prefetchDashboardData() {
  const urls = isAdminRole()
    ? ["/api/admin?view=news&scope=editor", "/api/admin?view=requests", "/api/admin?view=access"]
    : ["/api/admin?view=requests"];
  scheduleIdle(() => {
    urls.forEach((url) => {
      void fetchJson(url).catch(() => null);
    });
  });
}

async function init() {
  if (dom.adminUserEmail) {
    dom.adminUserEmail.textContent = cleanText(window.__SUNWIRE_ADMIN_USER__?.email || window.__SUNWIRE_ADMIN_EMAIL__ || "Admin");
  }

  setViewMode(state.mode, { skipUrl: true });
  renderFeaturedStatus(null);
  resetStructuredInputs();
  syncRoleVisibility();
  attachDraftPreviewListeners();
  attachQuickDurationButtons();
  attachStorySignalsListeners();
  attachNavHandlers();
  setAccessStatus("Add an email to allow request-based publishing access.");
  resetStorySignalsDashboard({ preserveStatus: true });

  dom.addKeyPointButton?.addEventListener("click", () => dom.keyPointsList?.append(createKeyPointRow()));
  dom.addFactSheetRowButton?.addEventListener("click", () => dom.factSheetRows?.append(createFactSheetRow()));
  dom.addBackgroundItemButton?.addEventListener("click", () => dom.backgroundRows?.append(createBackgroundRow()));
  dom.imageInput?.addEventListener("change", async (event) => {
    const [file] = event.target.files || [];
    try {
      await handleImageUpload(file);
    } catch (error) {
      setStatus(error.message || "Image upload failed.", true);
      showToast(error.message || "Image upload failed.");
    } finally {
      event.target.value = "";
    }
  });
  dom.newsForm?.addEventListener("submit", async (event) => {
    try {
      await handleSubmit(event);
    } catch (error) {
      showToast(error.message || "Publish failed.");
    }
  });
  dom.resetFormButton?.addEventListener("click", () => resetForm());
  dom.cancelEditButton?.addEventListener("click", () => resetForm());
  dom.refreshAdminDataButton?.addEventListener("click", async () => {
    try {
      setStatus("Refreshing dashboard...");
      await loadPageData({ forceFresh: true, awaitSummary: true });
      setStatus("Dashboard refreshed.");
      showToast("Dashboard refreshed.");
    } catch (error) {
      setStatus(error.message || "Refresh failed.", true);
      showToast(error.message || "Refresh failed.");
    }
  });
  dom.refreshRequestsButton?.addEventListener("click", async () => {
    try {
      await loadRequests();
      showToast("Requests refreshed.");
    } catch (error) {
      showToast(error.message || "Request refresh failed.");
    }
  });
  dom.approveRequestButton?.addEventListener("click", async () => {
    try {
      await handleApproveRequest();
    } catch (error) {
      showToast(error.message || "Approval failed.");
    }
  });
  dom.rejectRequestButton?.addEventListener("click", async () => {
    try {
      await handleRejectRequest();
    } catch (error) {
      showToast(error.message || "Reject failed.");
    }
  });
  dom.accessForm?.addEventListener("submit", async (event) => {
    try {
      await handleGrantAccess(event);
    } catch (error) {
      showToast(error.message || "Access update failed.");
    }
  });
  dom.refreshAccessButton?.addEventListener("click", async () => {
    try {
      await loadAccessList();
      setAccessStatus("Access list refreshed.");
      showToast("Access list refreshed.");
    } catch (error) {
      setAccessStatus(error.message || "Access refresh failed.", true);
      showToast(error.message || "Access refresh failed.");
    }
  });
  dom.featuredRemoveButton?.addEventListener("click", async () => {
    try {
      await handleRemoveHero();
    } catch (error) {
      setStatus(error.message || "Failed to remove hero.", true);
      showToast(error.message || "Failed to remove hero.");
    }
  });
  dom.logoutAdminButton?.addEventListener("click", async () => {
    setButtonBusy(dom.logoutAdminButton, true, "Logging out...");
    setAuthUiOverride("logged-out");
    clearClientAuthState();
    void fetch("/api/admin?view=session", {
      method: "DELETE",
      credentials: "same-origin",
      keepalive: true,
    }).catch(() => null);
    window.location.replace("/");
  });

  try {
    const persistedStatus = readGlobalStatus();
    if (persistedStatus?.message) {
      setGlobalStatus(persistedStatus.message, persistedStatus.isError, { persist: false });
    }
    const editId = new URL(window.location.href).searchParams.get("edit");
    if (editId && isAdminRole()) {
      setViewMode("edit-news", { skipUrl: true });
      await loadPageData({ awaitSummary: true });
      await loadArticleForEdit(editId);
    } else {
      await loadPageData();
    }
    prefetchDashboardData();
  } catch (error) {
    setStatus(error.message || "Admin dashboard failed to load.", true);
    showToast(error.message || "Admin dashboard failed to load.");
  }
}

init();
