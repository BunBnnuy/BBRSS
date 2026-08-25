const FORUM_ORIGIN = 'https://forum.ripper.store';
const CACHE_TTL_MS = 10 * 60 * 1000;
const MIN_REQUEST_INTERVAL_MS = 1500;
const searchCache = new Map();
let lastRequestAt = 0;

const iconPaths = (grayscale) => {
  const prefix = grayscale ? 'bbrss_gray_' : 'bbrss_';
  return {
    16: `${prefix}16.png`,
    32: `${prefix}32.png`,
    48: `${prefix}48.png`,
    128: `${prefix}128.png`,
  };
};

async function updateIcon(enabled) {
  await chrome.action.setIcon({ path: iconPaths(!enabled) });
}

chrome.storage.local.get({ enabled: true }, ({ enabled }) => updateIcon(enabled));

chrome.action.onClicked.addListener(async () => {
  const current = await chrome.storage.local.get({ enabled: true });
  const enabled = !current.enabled;
  await chrome.storage.local.set({ enabled });
  await updateIcon(enabled);
  console.info('[BB\'s RS Searcher] Enabled:', !current.enabled);
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== 'search-forum' || typeof message.term !== 'string') return;

  const term = message.term.trim().slice(0, 160);
  const page = Number.isInteger(message.page) && message.page > 0 ? message.page : 1;
  console.info('[BOOTH Forum Link Helper] API search:', term);
  if (!term) {
    sendResponse({ ok: true, posts: [] });
    return;
  }

  const cacheKey = `${term.toLowerCase()}::page=${page}`;
  const cached = searchCache.get(cacheKey);
  if (cached && Date.now() - cached.createdAt < CACHE_TTL_MS) {
    console.info('[BOOTH Forum Link Helper] Cache hit:', term);
    sendResponse({ ok: true, posts: cached.posts, cached: true, page, pageCount: cached.pageCount || 1 });
    return;
  }

  const requestedDelay = Number.isFinite(message.delayMs) ? Math.max(0, Math.min(message.delayMs, MIN_REQUEST_INTERVAL_MS)) : MIN_REQUEST_INTERVAL_MS;
  const waitMs = Math.max(0, requestedDelay - (Date.now() - lastRequestAt));
  setTimeout(() => performSearch(term, page, cacheKey, sendResponse), waitMs);
  return true;
});

function performSearch(term, page, cacheKey, sendResponse) {
  lastRequestAt = Date.now();

  fetch(`${FORUM_ORIGIN}/api/search?term=${encodeURIComponent(term)}&page=${page}`, {
    credentials: 'include',
  })
    .then((response) => {
      console.info('[BOOTH Forum Link Helper] API status:', response.status);
      if (!response.ok) throw new Error(`Forum search failed (${response.status})`);
      return response.json();
    })
    .then((data) => {
      console.info('[BOOTH Forum Link Helper] API posts:', data.posts?.length || 0);
      const posts = Array.isArray(data.posts) ? data.posts : [];
      searchCache.set(cacheKey, { createdAt: Date.now(), posts, pageCount: data.pagination?.pageCount || 1 });
      sendResponse({ ok: true, posts, cached: false, page, pageCount: data.pagination?.pageCount || 1 });
    })
    .catch((error) => {
      console.error('[BOOTH Forum Link Helper] API error:', error);
      sendResponse({ ok: false, error: error.message });
    });
}
