function escapeHtml(text = "") {
  return String(text || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function renderTopTrendingTopics(listEl, stories = [], options = {}) {
  if (!listEl) return;

  const activeFilter = options.activeFilter || "all";
  const sortStoriesForHomepageFocus = options.sortStoriesForHomepageFocus || ((items = []) => items);
  const sortStoriesForTrending = options.sortStoriesForTrending || ((items = []) => items);
  const optimizeHeadline = options.optimizeHeadline || ((value = "") => value);
  const categoryLabel = options.categoryLabel || ((story = {}) => story.category || "Latest");

  listEl.innerHTML = "";
  const picked = (activeFilter === "all" || activeFilter === "latest" || activeFilter === "india-pulse"
    ? sortStoriesForHomepageFocus(stories)
    : sortStoriesForTrending(stories)
  ).slice(0, 4);

  if (!picked.length) {
    listEl.innerHTML = "<li>No topics available.</li>";
    return;
  }

  picked.forEach((story) => {
    const li = document.createElement("li");
    li.innerHTML = `<div><strong>${escapeHtml(optimizeHeadline(story.title, "compact"))}</strong><span>${escapeHtml(categoryLabel(story))}</span></div>`;
    listEl.appendChild(li);
  });
}

export function renderSidebarData(elements = {}, data = {}) {
  const {
    toolNameEl,
    toolUseEl,
    toolLinkEl,
    eventsListEl,
    priceBoardMetaEl,
    priceBoardListEl,
    priceBoardSourcesEl,
  } = elements;

  const events = Array.isArray(data?.events) ? data.events.slice(0, 3) : [];
  const tool = data?.tool || {};
  const prices = Array.isArray(data?.marketBoard?.items) ? data.marketBoard.items.slice(0, 3) : [];
  const marketBoard = data?.marketBoard || {};
  const marketBoardTimestamp = marketBoard?.asOf
    ? new Date(marketBoard.asOf).toLocaleString("en-IN", {
      timeZone: "Asia/Kolkata",
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    })
    : "";

  if (toolNameEl) toolNameEl.textContent = tool.tool || "SunWire Pick";
  if (toolUseEl) toolUseEl.textContent = tool.use || "Explore the latest AI tool shaping newsroom workflows.";
  if (toolLinkEl) toolLinkEl.href = tool.link || "https://www.anthropic.com/";

  if (priceBoardMetaEl) {
    priceBoardMetaEl.textContent = [
      marketBoard.meta || "Latest India market snapshot.",
      marketBoardTimestamp ? `Updated ${marketBoardTimestamp} IST.` : "",
    ].filter(Boolean).join(" ");
  }

  if (priceBoardListEl) {
    priceBoardListEl.innerHTML = "";
    if (!prices.length) {
      priceBoardListEl.innerHTML = "<li>No price data available.</li>";
    } else {
      prices.forEach((item) => {
        const li = document.createElement("li");
        const deltaClass = item.deltaDirection === "up"
          ? "is-up"
          : item.deltaDirection === "down"
            ? "is-down"
            : "is-flat";
        li.innerHTML = [
          '<div class="price-item__head">',
          `<strong>${escapeHtml(item.name || "Market")}</strong>`,
          `<span class="price-item__market">${escapeHtml(item.market || "")}</span>`,
          "</div>",
          `<div class="price-item__row"><span>Today</span><strong>${escapeHtml(item.today || "-")}</strong></div>`,
          `<div class="price-item__row"><span>Yesterday</span><span>${escapeHtml(item.yesterday || "-")}</span></div>`,
          `<div class="price-item__row"><span>Change</span><span class="price-item__delta ${deltaClass}">${escapeHtml(item.change || "-")}</span></div>`,
        ].join("");
        priceBoardListEl.appendChild(li);
      });
    }
  }

  if (priceBoardSourcesEl) {
    const sources = Array.isArray(marketBoard.sources) ? marketBoard.sources : [];
    priceBoardSourcesEl.innerHTML = sources.length
      ? sources.map((source) => `<a href="${escapeHtml(source.url || "#")}">${escapeHtml(source.label || "Source")}</a>`).join(" • ")
      : "";
  }

  if (!eventsListEl) return;
  eventsListEl.innerHTML = "";
  if (!events.length) {
    eventsListEl.innerHTML = "<li>No upcoming events found.</li>";
    return;
  }

  events.forEach((event) => {
    const li = document.createElement("li");
    li.innerHTML = `<div><strong>${escapeHtml(event.name || "AI Event")}</strong><span>${escapeHtml(event.about || "Latest sessions and practical AI insights.")}</span></div>`;
    eventsListEl.appendChild(li);
  });
}
