function escapeHtml(text = "") {
  return String(text || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatSidebarDate(value = "") {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "";
  return parsed.toLocaleDateString("en-IN", {
    timeZone: "Asia/Kolkata",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function getPriceIcon(name = "") {
  const normalized = String(name || "").toLowerCase();
  if (normalized.includes("gold")) return "🪙";
  if (normalized.includes("silver")) return "⚪";
  if (normalized.includes("nifty")) return "📈";
  return "📈";
}

function parseSignedAmount(value = "") {
  const normalized = String(value || "").replace(/,/g, "").replace(/[^\d.+-]/g, "");
  const amount = Number(normalized);
  return Number.isFinite(amount) ? amount : 0;
}

const FALLBACK_EVENTS = [
  { name: "Web Summit", about: "Startup, product, and market trends in global tech.", link: "https://websummit.com/" },
  { name: "Nvidia GTC", about: "GPU, AI infrastructure, and model performance updates.", link: "https://www.nvidia.com/gtc/" },
  { name: "OpenAI Dev Day", about: "New model APIs, product launches, and developer tools.", link: "https://openai.com/" },
];

const FALLBACK_PEOPLE_READING = [
  { title: "Sunwire audience queue is warming up", summary: "Configure visitor growth for your pushed stories from Watch All News.", visitors: 0, href: "/admin/news?mode=watch-all-news" },
];

const FALLBACK_PRICES = {
  meta: "Latest India market snapshot.",
  items: [
    { name: "Gold", today: "Rs. 1,46,670", change: "+3,760", deltaDirection: "up" },
    { name: "Silver", today: "Rs. 2,50,000", change: "+15,000", deltaDirection: "up" },
    { name: "Nifty 50", today: "22,590.00", change: "+210.00", deltaDirection: "up" },
  ],
};

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
    peopleReadingListEl,
    priceBoardMetaEl,
    priceBoardListEl,
    priceBoardSourcesEl,
  } = elements;

  const peopleReading = (Array.isArray(data?.peopleReading) && data.peopleReading.length
    ? data.peopleReading
    : FALLBACK_PEOPLE_READING).slice(0, 4);
  const tool = data?.tool || {};
  const prices = Array.isArray(data?.marketBoard?.items) && data.marketBoard.items.length
    ? data.marketBoard.items.slice(0, 3)
    : FALLBACK_PRICES.items;
  const marketBoard = data?.marketBoard?.items?.length ? data.marketBoard : FALLBACK_PRICES;
  const priceBoardDateEl = priceBoardMetaEl?.closest(".sidebar-card--prices")?.querySelector(".price-moves-date");
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
  const marketBoardDate = formatSidebarDate(marketBoard?.asOf);

  if (toolNameEl) toolNameEl.textContent = tool.tool || "SunWire Pick";
  if (toolUseEl) toolUseEl.textContent = tool.use || "Explore the latest AI tool shaping newsroom workflows.";
  if (toolLinkEl) toolLinkEl.href = tool.link || "https://www.anthropic.com/";
  if (priceBoardDateEl && marketBoardDate) priceBoardDateEl.textContent = marketBoardDate;

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
        const delta = parseSignedAmount(item.change || "0");
        const direction = item.deltaDirection || (delta > 0 ? "up" : (delta < 0 ? "down" : "flat"));
        const deltaClass = direction === "up" ? "price-item__change--up" : (direction === "down" ? "price-item__change--down" : "");
        const label = String(item.name || "Market").trim() || "Market";
        const changeLabel = String(item.change || "-").trim() || "-";
        li.className = "price-item";
        li.innerHTML = `
          <span class="price-item__icon" aria-hidden="true">${escapeHtml(getPriceIcon(label))}</span>
          <span class="price-item__label">${escapeHtml(label)}</span>
          <span class="price-item__value">${escapeHtml(item.today || item.value || "-")}</span>
          <span class="price-item__change ${deltaClass}">${escapeHtml(changeLabel)}</span>
        `;
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

  if (!peopleReadingListEl) return;
  peopleReadingListEl.innerHTML = "";
  if (!peopleReading.length) {
    peopleReadingListEl.innerHTML = "<li>No reader pulse stories yet.</li>";
    return;
  }

  peopleReading.forEach((entry) => {
    const li = document.createElement("li");
    li.className = "people-reading-item";
    const title = escapeHtml(entry.title || "Sunwire Story");
    const summary = escapeHtml(entry.summary || "Configured visitor counters will surface here.");
    const image = escapeHtml(entry.image_url || "/social-card.svg");
    const href = escapeHtml(entry.href || "/");
    const visitors = new Intl.NumberFormat("en-IN", {
      notation: Number(entry.visitors || 0) >= 1000 ? "compact" : "standard",
      maximumFractionDigits: Number(entry.visitors || 0) >= 1000 ? 1 : 0,
    }).format(Number(entry.visitors || 0));
    li.innerHTML = `
      <a class="people-reading-link" href="${href}" target="_self" rel="noopener noreferrer">
        <img class="people-reading-thumb" src="${image}" alt="${title}" loading="lazy" decoding="async" />
        <span class="people-reading-copy">
          <strong>${title}</strong>
          <span>${summary}</span>
        </span>
        <span class="people-reading-count">${escapeHtml(visitors)}</span>
      </a>
    `;
    peopleReadingListEl.appendChild(li);
  });
}
