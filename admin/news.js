const adminUser = window.__SUNWIRE_ADMIN_USER__ || null;

const adminUserEmailEl = document.getElementById("adminUserEmail");
const featuredStatusEl = document.getElementById("featuredStatus");
const featuredMetaEl = document.getElementById("featuredMeta");
const featuredPreviewCard = document.getElementById("featuredPreviewCard");
const featuredPreviewImage = document.getElementById("featuredPreviewImage");
const featuredPreviewCategory = document.getElementById("featuredPreviewCategory");
const featuredPreviewHeadline = document.getElementById("featuredPreviewHeadline");
const featuredPreviewSource = document.getElementById("featuredPreviewSource");
const featuredRemoveButton = document.getElementById("featuredRemoveButton");
const recentManualList = document.getElementById("recentManualList");
const imageInput = document.getElementById("imageInput");
const imagePreview = document.getElementById("imagePreview");
const imageUploadStatus = document.getElementById("imageUploadStatus");
const headlineInput = document.getElementById("headlineInput");
const subheadlineInput = document.getElementById("subheadlineInput");
const sourceInput = document.getElementById("sourceInput");
const categoryInput = document.getElementById("categoryInput");
const placementInput = document.getElementById("placementInput");
const durationMinutesInput = document.getElementById("durationMinutesInput");
const featuredUntilInput = document.getElementById("featuredUntilInput");
const contentEditor = document.getElementById("contentEditor");
const newsForm = document.getElementById("newsForm");
const formStatus = document.getElementById("formStatus");
const pushNewsButton = document.getElementById("pushNewsButton");
const resetFormButton = document.getElementById("resetFormButton");
const refreshAdminDataButton = document.getElementById("refreshAdminDataButton");
const logoutAdminButton = document.getElementById("logoutAdminButton");
const toast = document.getElementById("toast");
const toastMessage = document.getElementById("toastMessage");
const imageUploadButtonLabel = document.getElementById("imageUploadButtonLabel");
const quickDurationButtons = [...document.querySelectorAll("[data-duration-minutes]")];

let uploadedImageUrl = "";
let pendingUploadName = "";
let activeToastTimer = 0;

function cleanText(value = "") {
  return String(value)
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function escapeHtml(value = "") {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function normalizeEditorParagraph(value = "") {
  return String(value || "")
    .replace(/\u00a0/g, " ")
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .join("\n")
    .trim();
}

function showToast(message, tone = "default") {
  window.clearTimeout(activeToastTimer);
  toastMessage.textContent = cleanText(message);
  toastMessage.className = tone === "error"
    ? "rounded-full bg-red-600 px-5 py-3 text-sm font-semibold text-white shadow-2xl"
    : "rounded-full bg-slate-950 px-5 py-3 text-sm font-semibold text-white shadow-2xl";
  toast.classList.remove("translate-y-4", "opacity-0");
  toast.classList.add("translate-y-0", "opacity-100");
  activeToastTimer = window.setTimeout(() => {
    toast.classList.add("translate-y-4", "opacity-0");
    toast.classList.remove("translate-y-0", "opacity-100");
  }, 2400);
}

function setFormBusyState(isBusy, label = "") {
  pushNewsButton.disabled = isBusy;
  refreshAdminDataButton.disabled = isBusy;
  formStatus.textContent = cleanText(label || (isBusy ? "Working..." : "Ready to publish."));
}

function formatDateTime(value = "") {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Schedule not set";
  return date.toLocaleString("en-IN", {
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

function extractEditorContent() {
  return String(contentEditor?.innerText || "")
    .replace(/\r/g, "")
    .split(/\n{2,}/)
    .map((entry) => normalizeEditorParagraph(entry))
    .filter(Boolean)
    .join("\n\n");
}

function validateForm() {
  const errors = [];
  if (!cleanText(headlineInput.value)) errors.push("Headline is required.");
  if (!cleanText(sourceInput.value)) errors.push("Source is required.");
  if (!cleanText(placementInput.value)) errors.push("Placement is required.");
  if (!cleanText(categoryInput.value)) errors.push("Category is required.");
  if (!extractEditorContent() || extractEditorContent().length < 80) errors.push("Article content must be at least 80 characters.");
  if (!uploadedImageUrl) errors.push("Upload an image before publishing.");

  const durationMinutes = Number(durationMinutesInput.value || 0);
  const featuredUntil = cleanText(featuredUntilInput.value || "");
  if (!(durationMinutes > 0) && !featuredUntil) {
    errors.push("Set either duration minutes or a featured-until date.");
  }

  return errors;
}

function renderFeaturedCard(article = null) {
  if (!article) {
    featuredStatusEl.textContent = "No active featured article.";
    featuredMetaEl.textContent = "The homepage will use normal ordering until you push one.";
    featuredPreviewCategory.textContent = "Awaiting publish";
    featuredPreviewHeadline.textContent = "No featured story is live right now.";
    featuredPreviewSource.textContent = "The next pushed story will appear here and move to the top of the homepage.";
    featuredPreviewImage.src = uploadedImageUrl || "/social-card.svg";
    featuredPreviewCard.classList.remove("ring-2", "ring-amber-300");
    if (featuredRemoveButton) {
      featuredRemoveButton.hidden = true;
      delete featuredRemoveButton.dataset.articleId;
      delete featuredRemoveButton.dataset.articleTitle;
    }
    return;
  }

  const featuredUntilValue = article?.featured_until || article?.featuredUntil || "";

  featuredStatusEl.textContent = cleanText(article.title || "Active featured article");
  featuredMetaEl.textContent = `Live until ${formatDateTime(featuredUntilValue)} - ${cleanText(article.source || "Sunwire")}`;
  featuredPreviewCategory.textContent = cleanText(article.category || "featured");
  featuredPreviewHeadline.textContent = cleanText(article.title || "Active featured article");
  featuredPreviewSource.textContent = `${cleanText(article.source || "Sunwire")} - Live until ${formatDateTime(featuredUntilValue)}`;
  featuredPreviewImage.src = cleanText(article.image_url || uploadedImageUrl || "/social-card.svg");
  featuredPreviewCard.classList.add("ring-2", "ring-amber-300");
  if (featuredRemoveButton) {
    const removable = Boolean(article.manual_upload && article.id);
    featuredRemoveButton.hidden = !removable;
    if (removable) {
      featuredRemoveButton.dataset.articleId = String(article.id);
      featuredRemoveButton.dataset.articleTitle = cleanText(article.title || "this story");
    } else {
      delete featuredRemoveButton.dataset.articleId;
      delete featuredRemoveButton.dataset.articleTitle;
    }
  }
}

function renderRecentList(items = []) {
  if (!Array.isArray(items) || !items.length) {
    recentManualList.innerHTML = '<p class="rounded-2xl bg-slate-50 px-4 py-4 text-sm text-slate-500">No manual uploads yet.</p>';
    return;
  }

  recentManualList.innerHTML = items.map((item) => `
    <article class="rounded-[24px] border border-slate-200 bg-white px-4 py-4 shadow-sm">
      <div class="flex items-start justify-between gap-3">
        <p class="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">${escapeHtml(cleanText(item.category || "news"))}</p>
        <button class="rounded-full border border-red-200 px-3 py-1 text-xs font-semibold text-red-600 transition hover:border-red-400 hover:bg-red-50" type="button" data-remove-id="${escapeHtml(String(item.id || ""))}" data-remove-title="${escapeHtml(cleanText(item.title || "this story"))}">Remove</button>
      </div>
      <h3 class="mt-2 text-base font-semibold leading-6 text-slate-950">${escapeHtml(cleanText(item.title || "Untitled"))}</h3>
      <p class="mt-2 text-sm text-slate-500">${escapeHtml(cleanText(item.source || "Sunwire"))} - ${escapeHtml(formatDateTime(item.created_at || item.published_at))}</p>
      ${item.is_featured ? '<p class="mt-2 text-xs font-semibold uppercase tracking-[0.18em] text-amber-600">Currently live on homepage</p>' : ""}
    </article>
  `).join("");
}

async function removeManualArticle(articleId = "", articleTitle = "this story") {
  const id = cleanText(articleId);
  if (!id) return;
  const confirmed = window.confirm(`Remove "${cleanText(articleTitle || "this story")}" from Sunwire?`);
  if (!confirmed) return;

  setFormBusyState(true, "Removing manual news...");

  try {
    const response = await fetch(`/api/admin/news?id=${encodeURIComponent(id)}`, {
      method: "DELETE",
      credentials: "include",
      headers: {
        "Cache-Control": "no-store",
      },
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload.error || "Manual news could not be removed.");
    }

    showToast("Manual news removed.");
    await loadAdminData();
  } catch (error) {
    formStatus.textContent = cleanText(error.message || "Manual news could not be removed.");
    showToast(error.message || "Manual news could not be removed.", "error");
  } finally {
    setFormBusyState(false);
  }
}

async function loadAdminData() {
  const response = await fetch("/api/admin/news", {
    credentials: "include",
    headers: {
      "Cache-Control": "no-store",
    },
  });

  if (!response.ok) {
    if (response.status === 403) {
      window.location.assign("/");
      return;
    }

    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.error || "Failed to load admin data.");
  }

  const payload = await response.json();
  renderFeaturedCard(payload.featured || null);
  renderRecentList(payload.recent || []);
}

async function uploadSelectedImage(file) {
  if (!file) return;
  if (!/^image\//i.test(file.type)) {
    throw new Error("Select a valid image file.");
  }
  if (file.size > 4 * 1024 * 1024) {
    throw new Error("Image size must be under 4 MB.");
  }

  pendingUploadName = file.name || "image";
  imageUploadStatus.textContent = `Uploading ${pendingUploadName}...`;
  const dataUrl = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Image could not be read."));
    reader.readAsDataURL(file);
  });

  imagePreview.src = dataUrl;

  const response = await fetch("/api/admin/upload-image", {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      headline: cleanText(headlineInput.value || file.name || "manual-image"),
      imageData: dataUrl,
    }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || "Image upload failed.");
  }

  uploadedImageUrl = cleanText(payload.image_url || "");
  imagePreview.src = uploadedImageUrl || dataUrl;
  if (imageUploadButtonLabel) imageUploadButtonLabel.textContent = "Replace Cover Image";
  imageUploadStatus.textContent = uploadedImageUrl
    ? "Image uploaded and ready for publish."
    : "Image uploaded.";
}

function resetForm() {
  newsForm.reset();
  contentEditor.innerHTML = "";
  uploadedImageUrl = "";
  pendingUploadName = "";
  imagePreview.src = "/social-card.svg";
  if (imageUploadButtonLabel) imageUploadButtonLabel.textContent = "Choose Cover Image";
  imageUploadStatus.textContent = "No image uploaded yet.";
  formStatus.textContent = "Ready to publish.";
}

async function submitNewsForm(event) {
  event.preventDefault();
  const errors = validateForm();
  if (errors.length) {
    formStatus.textContent = errors[0];
    showToast(errors[0], "error");
    return;
  }

  setFormBusyState(true, "Publishing to Sunwire...");

  try {
    const response = await fetch("/api/admin/news", {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        headline: cleanText(headlineInput.value),
        subheadline: cleanText(subheadlineInput?.value || ""),
        source: cleanText(sourceInput.value),
        placement: cleanText(placementInput.value),
        category: cleanText(categoryInput.value),
        content: extractEditorContent(),
        image_url: uploadedImageUrl,
        durationMinutes: Number(durationMinutesInput.value || 0),
        featuredUntil: cleanText(featuredUntilInput.value),
      }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload.error || "News push failed.");
    }

    renderFeaturedCard(payload.article || null);
    showToast("News pushed successfully \uD83D\uDE80");
    resetForm();
    await loadAdminData();
  } catch (error) {
    formStatus.textContent = cleanText(error.message || "News push failed.");
    showToast(error.message || "News push failed.", "error");
  } finally {
    setFormBusyState(false);
  }
}

async function logoutAdmin() {
  await fetch("/api/admin/session", {
    method: "DELETE",
    credentials: "include",
  }).catch(() => null);
  window.location.assign("/");
}

adminUserEmailEl.textContent = cleanText(adminUser?.email || window.__SUNWIRE_ADMIN_EMAIL__ || "Admin");

imageInput?.addEventListener("change", async (event) => {
  const file = event.target.files?.[0];
  if (!file) return;

  try {
    await uploadSelectedImage(file);
    showToast("Image uploaded.");
  } catch (error) {
    imageUploadStatus.textContent = cleanText(error.message || "Image upload failed.");
    showToast(error.message || "Image upload failed.", "error");
  }
});

quickDurationButtons.forEach((button) => {
  button.addEventListener("click", () => {
    durationMinutesInput.value = String(button.dataset.durationMinutes || "");
    featuredUntilInput.value = "";
  });
});

featuredUntilInput?.addEventListener("input", () => {
  if (cleanText(featuredUntilInput.value)) durationMinutesInput.value = "";
});

durationMinutesInput?.addEventListener("input", () => {
  if (Number(durationMinutesInput.value || 0) > 0) featuredUntilInput.value = "";
});

newsForm?.addEventListener("submit", submitNewsForm);
resetFormButton?.addEventListener("click", resetForm);
refreshAdminDataButton?.addEventListener("click", async () => {
  try {
    await loadAdminData();
    showToast("Dashboard refreshed.");
  } catch (error) {
    showToast(error.message || "Dashboard refresh failed.", "error");
  }
});
featuredRemoveButton?.addEventListener("click", () => removeManualArticle(
  featuredRemoveButton.dataset.articleId || "",
  featuredRemoveButton.dataset.articleTitle || "this story",
));
recentManualList?.addEventListener("click", (event) => {
  const button = event.target instanceof Element ? event.target.closest("[data-remove-id]") : null;
  if (!button) return;
  removeManualArticle(button.getAttribute("data-remove-id") || "", button.getAttribute("data-remove-title") || "this story");
});
logoutAdminButton?.addEventListener("click", logoutAdmin);

loadAdminData().catch((error) => {
  featuredStatusEl.textContent = cleanText(error.message || "Failed to load admin dashboard.");
  featuredMetaEl.textContent = "Reload the page or sign in again.";
});
