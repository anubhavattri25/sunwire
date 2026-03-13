(function () {
  const measurementId = window.__SUNWIRE_GA_ID;
  if (!measurementId || typeof window.gtag !== "function") return;

  let lastTrackedUrl = "";

  function trackPageView() {
    const url = `${window.location.pathname}${window.location.search}`;
    if (!url || url === lastTrackedUrl) return;
    lastTrackedUrl = url;
    window.gtag("event", "page_view", {
      page_title: document.title,
      page_location: window.location.href,
      page_path: url,
      send_to: measurementId,
    });
  }

  const originalPushState = window.history.pushState;
  const originalReplaceState = window.history.replaceState;

  window.history.pushState = function pushState() {
    const result = originalPushState.apply(this, arguments);
    window.requestAnimationFrame(trackPageView);
    return result;
  };

  window.history.replaceState = function replaceState() {
    const result = originalReplaceState.apply(this, arguments);
    window.requestAnimationFrame(trackPageView);
    return result;
  };

  window.addEventListener("popstate", trackPageView);
  window.addEventListener("load", trackPageView, { once: true });
})();
