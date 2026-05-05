// BookmarkHome — Popup 逻辑
'use strict';

let recentBookmarks = [];
let debounceTimer = null;

// 打开新标签页主页
document.getElementById('openNewtab').addEventListener('click', () => {
  chrome.tabs.create({ url: chrome.runtime.getURL('newtab/newtab.html') });
});

// 搜索输入
document.getElementById('searchInput').addEventListener('input', (e) => {
  const val = e.target.value.trim();
  clearTimeout(debounceTimer);
  if (!val) {
    renderRecent();
    return;
  }
  debounceTimer = setTimeout(() => search(val), 250);
});

// 加载最近书签（取最后添加的20条）
async function loadRecent() {
  return new Promise((resolve) => {
    // 获取最近添加的书签（通过时间排序）
    chrome.bookmarks.getRecent(20, (bookmarks) => {
      recentBookmarks = (bookmarks || [])
        .filter(b => b.url)
        .map(b => ({
          title: b.title || b.url,
          url: b.url,
          favicon: getFavicon(b.url)
        }));
      resolve();
    });
  });
}

function renderRecent() {
  const container = document.getElementById('results');
  if (recentBookmarks.length === 0) {
    container.innerHTML = `<div class="placeholder">📭 暂无书签数据</div>`;
    return;
  }

  container.innerHTML = `
    <div class="section-title">最近添加</div>
    <div class="recent-section">
      ${recentBookmarks.map(b => bookmarkItemHTML(b)).join('')}
    </div>
  `;
}

async function search(query) {
  try {
    const resp = await chrome.runtime.sendMessage({ type: 'SEARCH_BOOKMARKS', query });
    const bookmarks = (resp?.bookmarks || []).slice(0, 30);

    if (bookmarks.length === 0) {
      document.getElementById('results').innerHTML = `
        <div class="placeholder">🔍 无结果："${escHtml(query)}"</div>
      `;
      return;
    }

    document.getElementById('results').innerHTML = `
      <div class="section-title">找到 ${bookmarks.length} 条</div>
      ${bookmarks.map(b => bookmarkItemHTML(b)).join('')}
    `;
  } catch {
    document.getElementById('results').innerHTML = `<div class="placeholder">⚠️ 搜索失败</div>`;
  }
}

function bookmarkItemHTML(b) {
  const domain = tryGetDomain(b.url);
  const fallback = `https://www.google.com/s2/favicons?domain=${domain}&sz=32`;
  return `
    <a class="result-item" href="${escHtml(b.url)}" target="_blank" rel="noopener" title="${escHtml(b.title)}">
      <img class="result-favicon" src="${escHtml(b.favicon)}" data-fallback="${escHtml(fallback)}" alt=""
           onerror="if(!this.dataset.tried){this.dataset.tried='1';this.src=this.dataset.fallback;}else{this.src='data:image/svg+xml,<svg xmlns=\\'http://www.w3.org/2000/svg\\' viewBox=\\'0 0 16 16\\'><text y=\\'13\\' font-size=\\'12\\'>🌐</text></svg>';}">
      <div class="result-info">
        <div class="result-title">${escHtml(b.title)}</div>
        <div class="result-domain">${domain}</div>
      </div>
    </a>
  `;
}

function getFavicon(url) {
  try {
    const hostname = new URL(url).hostname;
    // 优先使用 Chrome favicon API
    return `chrome-extension://${chrome.runtime.id}/_favicon/?pageUrl=${encodeURIComponent(url)}&size=32`;
  } catch { return ''; }
}

function tryGetDomain(url) {
  try { return new URL(url).hostname.replace('www.', ''); } catch { return ''; }
}

function escHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

// 启动
loadRecent().then(renderRecent);
