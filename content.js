(() => {
  const BUTTON_ID = 'booth-forum-link-helper';
  const TITLE_LIMIT = 120;
  let lastSearchedTitle = '';
  let searchInProgress = false;
  let extensionEnabled = true;
  const finalResultCache = new Map();
  const log = (...args) => console.info('[BOOTH Forum Link Helper]', ...args);

  const removeHelper = () => {
    document.getElementById(`${BUTTON_ID}-container`)?.remove();
    document.getElementById(`${BUTTON_ID}-separator`)?.remove();
  };

  chrome.storage.local.get({ enabled: true }, (settings) => {
    extensionEnabled = settings.enabled;
    if (!extensionEnabled) removeHelper();
    log('Enabled:', extensionEnabled);
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || changes.enabled === undefined) return;
    extensionEnabled = changes.enabled.newValue !== false;
    if (!extensionEnabled) {
      removeHelper();
      searchInProgress = false;
      log('Disabled from extension icon.');
    } else {
      lastSearchedTitle = '';
      log('Enabled from extension icon.');
      schedule();
    }
  });

  const cleanTitle = (value) => value
    .replace(/\[[^\]]+\]/g, ' ')
    .replace(/[♡♥【】]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, TITLE_LIMIT);

  const getProductTitle = () => {
    const usable = (value) => value && !/^booth(\s*[-|｜].*)?$/i.test(value) ? value : '';
    const visibleHeading = [...document.querySelectorAll('h1, h2, [role="heading"]')]
      .map((node) => node.textContent?.trim())
      .map(usable)
      .find((value) => value && value.length > 3);
    const metadataTitle = usable(document.querySelector('meta[property="og:title"]')?.content?.trim())
      || usable(document.querySelector('meta[name="title"]')?.content?.trim());
    const documentTitle = usable(document.title
      .replace(/\s*[|｜-]\s*BOOTH\s*$/i, '')
      .replace(/^BOOTH\s*[|｜-]\s*/i, '')
      .trim());
    return visibleHeading || metadataTitle || documentTitle || '';
  };

  const getApiTitle = async () => {
    const match = location.pathname.match(/\/items\/(\d+)/);
    if (!match) return '';
    try {
      const response = await fetch(`${location.origin}/en/items/${match[1]}.json`, { credentials: 'include' });
      if (!response.ok) throw new Error(`BOOTH API returned ${response.status}`);
      const data = await response.json();
      log('BOOTH API item:', { id: data.id, name: data.name });
      return typeof data.name === 'string' ? data.name.trim() : '';
    } catch (error) {
      log('BOOTH API lookup failed:', error.message);
      return '';
    }
  };

  const getItemId = () => location.pathname.match(/\/items\/(\d+)/)?.[1] || '';

  const getKeywordFallback = (title) => {
    const words = cleanTitle(title)
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .split(/\s+/)
      .map((word) => word.replace(/[^\p{L}\p{N}_-]/gu, ''))
      .filter((word) => word.length >= 4 && !/^(vrchat|avatar|対応|アバター)$/i.test(word));
    return words.sort((a, b) => b.length - a.length)[0] || '';
  };

  const searchForum = (term, delayMs, page = 1) => new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: 'search-forum', term, delayMs, page }, (result) => {
      if (chrome.runtime.lastError) {
        log('Extension message error:', chrome.runtime.lastError.message);
        resolve({ ok: false, error: chrome.runtime.lastError.message });
        return;
      }
      if (result?.cached) log('Forum result retrieved from cache:', term);
      resolve(result);
    });
  });

  const searchAllForumPages = async (term, delayMs) => {
    const allPosts = [];
    let page = 1;
    let pageCount = 1;
    do {
      const result = await searchForum(term, delayMs, page);
      if (!result?.ok) return result;
      allPosts.push(...(result.posts || []));
      pageCount = Math.max(pageCount, Number(result.pageCount) || 1);
      log('Forum search page:', { term, page, pageCount, posts: result.posts?.length || 0 });
      page += 1;
    } while (page <= pageCount);
    return { ok: true, posts: allPosts, pageCount };
  };

  const forumUrl = (path) => new URL(path, 'https://forum.ripper.store').href;

  const scorePost = (post, title) => {
    const haystack = `${post.topic?.title || ''} ${post.content || ''}`.toLowerCase();
    const words = cleanTitle(title).toLowerCase().split(/\s+/).filter((word) => word.length > 2);
    return words.reduce((score, word) => score + (haystack.includes(word) ? 1 : 0), 0);
  };

  const rankMatches = (posts, title) => {
    const byTopic = new Map();
    posts.forEach((post) => {
      if (!post.topic?.slug) return;
      const content = `${post.content || ''} ${post.sourceContent || ''}`;
      const downloadSignal = /hidelinks\/|download\s+link|\bdownload\b|🔗\s*dl|\bdl\b/i.test(content) ? 100 : 0;
      const category = `${post.category?.slug || ''} ${post.category?.name || ''}`.toLowerCase();
      const giftsDownloadsSignal = /gifts-downloads|gifts\s*\/\s*downloads/.test(category) ? 200 : 0;
      const candidate = {
        post,
        score: scorePost(post, title) + downloadSignal + giftsDownloadsSignal,
        hasDownloadSignal: Boolean(downloadSignal),
        isGiftsDownloads: Boolean(giftsDownloadsSignal),
      };
      const existing = byTopic.get(post.topic.tid);
      if (!existing || candidate.score > existing.score) byTopic.set(post.topic.tid, candidate);
    });
    return [...byTopic.values()].sort((a, b) => b.score - a.score);
  };

  const findPurchaseArea = () => {
    const variations = document.querySelector('ul#variations');
    const variationsContainer = variations?.closest('div');
    if (variationsContainer?.parentElement) {
      return { area: variationsContainer.parentElement, before: variationsContainer };
    }

    const wishlist = [...document.querySelectorAll('a, button, div, span, p')]
      .find((node) => node.textContent?.trim() === 'スキリストに追加' && node.getBoundingClientRect().width > 0);
    if (wishlist?.parentElement) {
      const wishlistRow = wishlist.parentElement;
      if (wishlistRow.parentElement) {
        return { area: wishlistRow.parentElement, after: wishlistRow };
      }
      return { area: wishlistRow, after: wishlist };
    }
    return null;
  };

  const findPurchaseControl = () => [...document.querySelectorAll('button, a, [role="button"]')]
    .find((node) => /add to cart/i.test(node.textContent || ''));

  const render = (state) => {
    const existing = document.getElementById(`${BUTTON_ID}-container`) || document.getElementById(BUTTON_ID);
    if (existing) existing.remove();
    const existingSeparator = document.getElementById(`${BUTTON_ID}-separator`);
    if (existingSeparator) existingSeparator.remove();
    const target = findPurchaseArea();
    if (!target?.area) {
      log('Could not find an insertion area.');
      return;
    }

    const original = findPurchaseControl();
    const tagName = original?.tagName?.toLowerCase() === 'a' ? 'a' : 'button';
    const container = document.createElement('div');
    container.id = `${BUTTON_ID}-container`;
    container.className = `booth-forum-link-container${state.topics?.length > 1 ? '' : ' booth-forum-link-single'}`;
    const button = document.createElement(tagName);
    button.id = BUTTON_ID;
    if (tagName === 'button') button.type = 'button';
    if (original?.className) button.className = original.className;
    button.classList.add('booth-forum-link-button');
    if (state.loading) button.classList.add('booth-forum-link-loading');
    button.textContent = state.text;
    button.disabled = Boolean(state.disabled);
    if (state.href) button.addEventListener('click', () => window.open(state.href, '_blank', 'noopener'));
    container.appendChild(button);

    if (state.topics?.length > 1) {
      const arrow = document.createElement('button');
      arrow.type = 'button';
      arrow.className = original?.className || '';
      arrow.classList.add('booth-forum-link-arrow');
      arrow.textContent = '▾';
      arrow.setAttribute('aria-label', 'Show other forum topics');

      const menu = document.createElement('div');
      menu.className = 'booth-forum-link-menu';
      menu.hidden = true;
      state.topics.forEach((topic) => {
        const item = document.createElement('a');
        item.href = topic.href;
        item.target = '_blank';
        item.rel = 'noopener';
        item.textContent = topic.title;
        menu.appendChild(item);
      });
      arrow.addEventListener('click', () => { menu.hidden = !menu.hidden; });
      container.appendChild(arrow);
      container.appendChild(menu);
    }

    if (target.after && target.after.parentElement === target.area) {
      const separator = document.createElement('div');
      separator.id = `${BUTTON_ID}-separator`;
      separator.className = 'booth-forum-link-separator';
      target.area.insertBefore(separator, target.after.nextSibling);
      target.area.insertBefore(container, separator.nextSibling);
      log('Button status:', state.text, 'inserted after wishlist with separator in:', target.area);
    } else if (target.before && target.before.parentElement === target.area) {
      target.area.insertBefore(container, target.before);
      log('Button status:', state.text, 'inserted before:', target.before);
    } else {
      target.area.appendChild(container);
      log('Button status:', state.text, 'appended in:', target.area);
    }
  };

  const search = async () => {
    if (!extensionEnabled) return;
    if (searchInProgress) return;
    searchInProgress = true;
    const title = (await getApiTitle()) || getProductTitle();
    if (!/booth\.pm/i.test(location.hostname)) {
      log('Skipped: unsupported host', location.hostname);
      searchInProgress = false;
      return;
    }
    if (!title) {
      log('BOOTH title not ready; retrying.', {
        documentTitle: document.title,
        headings: [...document.querySelectorAll('h1, h2, [role="heading"]')].map((node) => node.textContent?.trim()).filter(Boolean),
      });
      searchInProgress = false;
      schedule();
      return;
    }
    if (title === lastSearchedTitle && document.getElementById(`${BUTTON_ID}-container`)) {
      searchInProgress = false;
      return;
    }
    lastSearchedTitle = title;
    const itemId = getItemId();
    const resultCacheKey = `${itemId}|${cleanTitle(title).toLowerCase()}`;
    const cachedFinal = finalResultCache.get(resultCacheKey);
    if (cachedFinal) {
      log('Final ranked result retrieved from page cache:', resultCacheKey);
      render(cachedFinal);
      searchInProgress = false;
      return;
    }
    let response;
    if (itemId) {
      log('Searching forum by BOOTH item ID:', itemId);
      render({ text: 'Searching forum by item ID…', disabled: true, loading: true });
      response = await searchAllForumPages(itemId, 1500);
    }
    if (!response) response = { ok: true, posts: [] };
    if (!response?.ok) {
      searchInProgress = false;
      return render({ text: 'Forum search unavailable', disabled: true });
    }

    let candidatePosts = response.posts || [];
    let matches = rankMatches(candidatePosts, title);
    if (itemId) {
      matches = matches.filter(({ post }) => {
        const content = `${post.topic?.title || ''} ${post.content || ''} ${post.sourceContent || ''}`;
        return content.includes(itemId);
      });
      candidatePosts = matches.map(({ post }) => post);
      log('Strict item ID matches:', matches.length);
    }

    log('Always searching forum by title:', title);
    render({ text: 'Searching forum by title…', disabled: true, loading: true });
    const titleResponse = await searchAllForumPages(cleanTitle(title), 1500);
    if (!titleResponse?.ok) {
      searchInProgress = false;
      return render({ text: 'Forum search unavailable', disabled: true });
    }
    candidatePosts = candidatePosts.concat(titleResponse.posts || []);
    matches = rankMatches(candidatePosts, title).filter((item) => item.score > 0);

    if (!matches.length) {
      const keyword = getKeywordFallback(title);
      if (keyword && keyword.toLowerCase() !== cleanTitle(title).toLowerCase()) {
        log('No forum topic found by full title; falling back to keyword:', keyword);
        render({ text: `Searching forum for ${keyword}…`, disabled: true, loading: true });
        response = await searchAllForumPages(keyword, 1500);
        if (!response?.ok) {
          searchInProgress = false;
          return render({ text: 'Forum search unavailable', disabled: true });
        }
        matches = rankMatches(response.posts, title).filter((item) => item.score > 0 || item.post.topic?.title);
      }
    }

    if (!matches.length) {
      searchInProgress = false;
      return render({ text: 'No forum download found', disabled: true });
    }
    const best = matches[0];
    const topicPath = best.post.topic?.slug ? `/topic/${best.post.topic.slug}` : `/post/${best.post.pid}`;
    const topicUrl = forumUrl(topicPath);
    const topics = matches.map(({ post, hasDownloadSignal }) => ({
      title: `${hasDownloadSignal ? '★ ' : ''}${post.topic.title}`,
      href: forumUrl(`/topic/${post.topic.slug}`),
    }));
    log('Match found:', {
      title: best.post.topic?.title,
      score: best.score,
      hasDownloadSignal: best.hasDownloadSignal,
      isGiftsDownloads: best.isGiftsDownloads,
      topicUrl,
    });
    const finalState = { text: `${best.hasDownloadSignal ? '★ ' : ''}${best.post.topic.title}`, href: topicUrl, topics };
    finalResultCache.set(resultCacheKey, finalState);
    render(finalState);
    document.getElementById(BUTTON_ID)?.setAttribute('title', `Match: ${best.post.topic?.title || topicPath}`);
    searchInProgress = false;
  };

  let scheduled;
  const schedule = () => { clearTimeout(scheduled); scheduled = setTimeout(search, 750); };
  log('Content script initialized:', location.href);
  new MutationObserver(schedule).observe(document.documentElement, { childList: true, subtree: true });
    render({ text: 'Preparing forum search…', disabled: true, loading: true });
  schedule();
})();
