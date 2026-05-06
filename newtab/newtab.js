// BookmarkHome — 新标签页逻辑（v3：根节点 Tab + 平铺展示）
'use strict';

// ─── 常量 ───────────────────────────────────────────────────
const MAX_VISIBLE_BOOKMARKS = 6;

// ─── 搜索引擎配置 ────────────────────────────────────────────
const SEARCH_ENGINES = {
  bookmark: { icon: '🔖', name: '收藏夹', placeholder: '搜索收藏夹...',   url: null },
  bing:     { icon: '🔷', name: '必应',   placeholder: '用 Bing 搜索...',  url: 'https://www.bing.com/search?q=' },
  google:   { icon: '🔍', name: '谷歌',   placeholder: '用 Google 搜索...', url: 'https://www.google.com/search?q=' },
  baidu:    { icon: '🅱️', name: '百度',   placeholder: '用百度搜索...',    url: 'https://www.baidu.com/s?wd=' },
  yandex:   { icon: '🟡', name: 'Yandex', placeholder: '用 Yandex 搜索...', url: 'https://yandex.com/search/?text=' },
};

let currentEngine = 'bookmark';   // 当前搜索引擎 key

// 分类自动 Emoji 映射
const CATEGORY_ICONS = [
  { keys: ['工作', 'work', '职场', '办公', 'job', 'office'], icon: '💼' },
  { keys: ['技术', 'tech', '开发', 'dev', '编程', 'code', 'git', 'github', 'stack'], icon: '⚡' },
  { keys: ['设计', 'design', 'ui', 'ux', '美工', 'figma', 'sketch'], icon: '🎨' },
  { keys: ['视频', 'video', '影视', '电影', '电视', 'movie', 'film', 'youtube', 'bili', '哔哩'], icon: '🎬' },
  { keys: ['音乐', 'music', '歌曲', '音频', 'spotify', 'netease'], icon: '🎵' },
  { keys: ['购物', 'shop', '商城', '淘宝', '京东', 'amazon', 'taobao', 'jd'], icon: '🛒' },
  { keys: ['新闻', 'news', '资讯', '财经', '热点'], icon: '📰' },
  { keys: ['学习', 'learn', '教育', 'edu', '课程', 'course', 'study'], icon: '📚' },
  { keys: ['工具', 'tool', '效率', 'util', 'app'], icon: '🔧' },
  { keys: ['社交', 'social', '论坛', 'forum', 'twitter', 'weibo'], icon: '💬' },
  { keys: ['游戏', 'game', 'steam', 'play'], icon: '🎮' },
  { keys: ['旅行', 'travel', '地图', 'map', '航班', 'hotel'], icon: '✈️' },
  { keys: ['美食', 'food', '餐厅', 'recipe', '菜谱'], icon: '🍜' },
  { keys: ['健康', 'health', '医疗', '运动', 'fitness'], icon: '💪' },
  { keys: ['金融', 'finance', '股票', '基金', 'bank', '理财'], icon: '💰' },
  { keys: ['收藏夹栏', 'bookmarks bar', '书签栏', 'bookmark bar'], icon: '⭐' },
  { keys: ['工作区', 'workspace', 'other bookmarks', '其他书签'], icon: '📌' },
];

function getCategoryIcon(title) {
  const lower = (title || '').toLowerCase();
  for (const { keys, icon } of CATEGORY_ICONS) {
    if (keys.some(k => lower.includes(k))) return icon;
  }
  return '📂';
}

// ─── 状态 ───────────────────────────────────────────────────
let roots = [];            // 根节点列表：收藏夹栏、工作区等
let allBookmarks = [];     // 所有网页书签的扁平列表
let activeRootIndex = 0;   // 当前选中的根节点
let searchDebounceTimer = null;

// 导航栈：记录当前浏览路径
let navStack = [];

// ─── DOM 工具 ────────────────────────────────────────────────
const $ = id => document.getElementById(id);

function showToast(msg, duration = 2500) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), duration);
}

// ─── 折叠体高度管理 ─────────────────────────────────────────
function expandBody(bodyEl) {
  bodyEl.style.maxHeight = bodyEl.scrollHeight + 'px';
  bodyEl.style.opacity = '1';
  bodyEl.classList.remove('is-collapsed', 'is-collapsing');

  const onEnd = () => {
    if (!bodyEl.classList.contains('is-collapsed')) {
      bodyEl.style.maxHeight = 'none';
    }
    bodyEl.removeEventListener('transitionend', onEnd);
  };
  bodyEl.addEventListener('transitionend', onEnd);
}

function collapseBody(bodyEl) {
  if (bodyEl.style.maxHeight === 'none' || !bodyEl.style.maxHeight) {
    bodyEl.style.maxHeight = bodyEl.scrollHeight + 'px';
  }
  bodyEl.classList.add('is-collapsing');
  void bodyEl.offsetHeight;
  bodyEl.style.maxHeight = '0px';
  bodyEl.style.opacity = '0';

  const onEnd = () => {
    bodyEl.classList.remove('is-collapsing');
    bodyEl.classList.add('is-collapsed');
    bodyEl.removeEventListener('transitionend', onEnd);
  };
  bodyEl.addEventListener('transitionend', onEnd);
}

// ─── 折叠/展开所有文件夹 ──────────────────────────────
function collapseAll() {
  document.querySelectorAll('.category-card').forEach(card => {
    if (!card.classList.contains('collapsed')) {
      card.classList.add('collapsed');
      const bodyEl = card.querySelector('.category-body');
      if (bodyEl) collapseBody(bodyEl);
    }
  });
  showToast('📦 已折叠所有文件夹');
}

function expandAll() {
  document.querySelectorAll('.category-card').forEach(card => {
    if (card.classList.contains('collapsed')) {
      card.classList.remove('collapsed');
      const bodyEl = card.querySelector('.category-body');
      if (bodyEl) expandBody(bodyEl);
    }
  });
  showToast('📥 已展开所有文件夹');
}

// ─── 卡片操作：重命名 & 删除 ──────────────────────────
async function handleRename(type, data) {
  const newName = prompt(`重命名"${data.title}"：`, data.title);
  if (!newName || newName === data.title) return;
  try {
    await chrome.runtime.sendMessage({ type: 'RENAME_BOOKMARK', id: data.id, title: newName });
    showToast(`✅ 已重命名为"${newName}"`);
    await loadBookmarks();
  } catch (err) {
    console.error(err);
    showToast('❌ 重命名失败，请重试');
  }
}

async function handleDelete(type, data) {
  const msg = type === 'folder'
    ? `确定要删除文件夹"${data.title}"及其所有内容吗？`
    : `确定要删除书签"${data.title}"吗？`;
  if (!confirm(msg)) return;
  try {
    await chrome.runtime.sendMessage({ type: 'DELETE_BOOKMARK', id: data.id });
    showToast(`🗑️ 已删除"${data.title}"`);
    await loadBookmarks();
  } catch (err) {
    console.error(err);
    showToast('❌ 删除失败，请重试');
  }
}

// ─── 初始化 ──────────────────────────────────────────────────
async function init() {
  const savedTheme = localStorage.getItem('bh-theme') || 'dark';
  document.body.dataset.theme = savedTheme;

  await loadBookmarks();
  bindEvents();
}

async function loadBookmarks() {
  $('loading').style.display = 'flex';
  $('categoriesGrid').innerHTML = '';

  try {
    const resp = await chrome.runtime.sendMessage({ type: 'GET_BOOKMARKS' });
    if (!resp?.success) throw new Error('Failed');

    roots = resp.data.roots;
    allBookmarks = resp.data.bookmarks;

    // 渲染根节点 Tab
    renderRootTabs();

    // 显示首页视图（根节点卡片），不自动选中第一个根节点
    renderHomeView();

  } catch (err) {
    console.error(err);
    $('emptyState').style.display = 'block';
  } finally {
    $('loading').style.display = 'none';
  }
}

// ─── 根节点 Tab ──────────────────────────────────────────────
function renderRootTabs() {
  const container = $('rootTabs');
  container.innerHTML = '';

  roots.forEach((root, i) => {
    const btn = document.createElement('button');
    btn.className = 'root-tab' + (i === activeRootIndex ? ' active' : '');
    btn.innerHTML = `
      <span class="root-tab-icon">${getCategoryIcon(root.title)}</span>
      <span class="root-tab-label">${escHtml(root.title)}</span>
      <span class="root-tab-count">${countAllBookmarks([root])}</span>
    `;
    btn.addEventListener('click', () => {
      selectRoot(i);
    });
    container.appendChild(btn);
  });
}

function selectRoot(index) {
  if (index < 0 || index >= roots.length) return;
  activeRootIndex = index;

  // 更新 Tab 高亮
  document.querySelectorAll('.root-tab').forEach((btn, i) => {
    btn.classList.toggle('active', i === index);
  });

  const root = roots[index];

  // 更新统计
  animateCount($('statCategories'), root.children.length);
  animateCount($('statBookmarks'), countAllBookmarks([root]));

  // 重置导航栈
  navStack = [{ folder: root, title: root.title }];
  renderCurrentView();
  updateBreadcrumb();
}

// ─── 首页视图：显示所有根节点作为卡片 ──────────────────────
function renderHomeView() {
  navStack = [];
  const grid = $('categoriesGrid');
  grid.innerHTML = '';
  $('emptyState').style.display = 'none';
  $('statsBar').style.display = '';

  // 统计所有根节点
  const totalBookmarks = countAllBookmarks(roots);
  animateCount($('statCategories'), roots.length);
  animateCount($('statBookmarks'), totalBookmarks);

  // 取消所有根节点 Tab 高亮
  document.querySelectorAll('.root-tab').forEach(btn => btn.classList.remove('active'));
  activeRootIndex = -1;

  if (roots.length === 0) {
    $('emptyState').style.display = 'block';
    updateBreadcrumb();
    return;
  }

  roots.forEach((root, i) => {
    const card = buildRootCard(root, i);
    grid.appendChild(card);
  });

  updateBreadcrumb();
}

/** 构建根节点卡片（首页视图用） */
function buildRootCard(root, index) {
  const icon = getCategoryIcon(root.title);
  const totalBookmarks = countAllBookmarks([root]);
  const subfolderCount = root.children ? root.children.length : 0;

  const card = document.createElement('div');
  card.className = 'category-card';
  card.style.animationDelay = `${index * 55}ms`;

  card.innerHTML = `
    <div class="category-header">
      <div class="category-title-wrap">
        <span class="category-emoji">${icon}</span>
        <div>
          <div class="category-title" title="${escHtml(root.title)}">${escHtml(root.title)}</div>
          <div class="category-meta">${totalBookmarks} 条书签${subfolderCount > 0 ? ` · ${subfolderCount} 个子文件夹` : ''}</div>
        </div>
      </div>
      <div class="category-count">
        <span class="count-badge">${totalBookmarks}</span>
      </div>
    </div>
  `;

  card.addEventListener('click', () => selectRoot(index));
  return card;
}

// ─── 面包屑导航 ──────────────────────────────────────────────
function updateBreadcrumb() {
  const nav = $('breadcrumb');

  // 首页视图：隐藏面包屑
  if (navStack.length === 0) {
    nav.style.display = 'none';
    return;
  }

  nav.innerHTML = '';
  nav.style.display = 'flex';

  // 首页按钮 → 回到首页视图
  const homeBtn = document.createElement('button');
  homeBtn.className = 'breadcrumb-item';
  homeBtn.innerHTML = '🏠 首页';
  homeBtn.addEventListener('click', () => renderHomeView());
  nav.appendChild(homeBtn);

  // 显示导航路径
  for (let i = 0; i < navStack.length; i++) {
    const sep = document.createElement('span');
    sep.className = 'breadcrumb-sep';
    sep.textContent = '›';
    nav.appendChild(sep);

    const btn = document.createElement('button');
    btn.className = 'breadcrumb-item' + (i === navStack.length - 1 ? ' active' : '');
    btn.textContent = navStack[i].title;
    if (i < navStack.length - 1) {
      btn.addEventListener('click', () => navigateTo(i));
    }
    nav.appendChild(btn);
  }
}

function navigateTo(depthIndex) {
  navStack = navStack.slice(0, depthIndex + 1);
  renderCurrentView();
  updateBreadcrumb();
}

// ─── 渲染当前视图 ────────────────────────────────────────────
function renderCurrentView() {
  const current = navStack[navStack.length - 1];
  const folder = current.folder;

  const grid = $('categoriesGrid');
  grid.innerHTML = '';
  $('emptyState').style.display = 'none';
  $('statsBar').style.display = '';

  // 收集当前层级的内容：子文件夹 + 直接网页
  const items = [];

  // 子文件夹作为卡片
  if (folder.children) {
    for (const child of folder.children) {
      items.push({ type: 'folder', data: child });
    }
  }

  // 直接网页链接作为卡片
  if (folder.bookmarks && folder.bookmarks.length > 0) {
    for (const bm of folder.bookmarks) {
      items.push({ type: 'bookmark', data: bm });
    }
  }

  if (items.length === 0) {
    $('emptyState').style.display = 'block';
    return;
  }

  items.forEach((item, i) => {
    if (item.type === 'folder') {
      const card = buildFolderCard(item.data, i);
      grid.appendChild(card);
    } else {
      const el = buildBookmarkCard(item.data, i);
      grid.appendChild(el);
    }
  });
}

// ─── 构建文件夹卡片 ──────────────────────────────────────────
function buildFolderCard(folder, index = 0) {
  const icon = getCategoryIcon(folder.title);
  const hasChildren = folder.children && folder.children.length > 0;
  const hasBookmarks = folder.bookmarks && folder.bookmarks.length > 0;
  const totalBookmarks = countAllBookmarks([folder]);

  const card = document.createElement('div');
  card.className = 'category-card';
  card.style.animationDelay = `${index * 55}ms`;

  // 子文件夹入口 HTML
  const subfolderHTML = hasChildren ? `
    <div class="subfolders">
      ${folder.children.map((sub, si) => `
        <button class="subfolder-btn" data-sub-index="${si}" title="${escHtml(sub.title)}">
          <span class="subfolder-icon">${getCategoryIcon(sub.title)}</span>
          <span class="subfolder-name">${escHtml(sub.title)}</span>
          <span class="subfolder-count">${countAllBookmarks([sub])}</span>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
            <path d="m9 18 6-6-6-6"/>
          </svg>
        </button>
      `).join('')}
    </div>
  ` : '';

  // 网页链接 HTML
  const visibleBookmarks = folder.bookmarks.slice(0, MAX_VISIBLE_BOOKMARKS);
  const hiddenCount = folder.bookmarks.length - MAX_VISIBLE_BOOKMARKS;
  const bookmarksHTML = hasBookmarks ? `
    <div class="bookmarks-list">
      ${visibleBookmarks.map((b, bi) => buildBookmarkItemHTML(b, bi)).join('')}
      ${hiddenCount > 0 ? `
        <button class="show-more-btn" data-folder-id="${folder.id}" data-showing="false">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="m6 9 6 6 6-6"/>
          </svg>
          还有 ${hiddenCount} 条，点击展开
        </button>` : ''}
    </div>
  ` : '';

  card.innerHTML = `
    <div class="category-header">
      <div class="category-title-wrap">
        <span class="category-emoji">${icon}</span>
        <div>
          <div class="category-title" title="${escHtml(folder.title)}">${escHtml(folder.title)}</div>
          <div class="category-meta">${totalBookmarks} 条书签${hasChildren ? ` · ${folder.children.length} 个子文件夹` : ''}</div>
        </div>
      </div>
      <div class="category-count">
        <span class="count-badge">${totalBookmarks}</span>
        <span class="collapse-btn">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
            <path d="m6 9 6 6 6-6"/>
          </svg>
        </span>
      </div>
      <div class="card-actions">
        <button class="card-action-btn" data-action="rename" title="重命名">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
          </svg>
        </button>
        <button class="card-action-btn card-action-del" data-action="delete" title="删除">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6h14"/>
          </svg>
        </button>
      </div>
    </div>
    <div class="category-body">
      <div class="category-divider"></div>
      ${subfolderHTML}
      ${bookmarksHTML}
    </div>
  `;

  // 折叠/展开
  const bodyEl = card.querySelector('.category-body');
  card.querySelector('.category-header').addEventListener('click', () => {
    const isCollapsed = card.classList.toggle('collapsed');
    if (isCollapsed) {
      collapseBody(bodyEl);
    } else {
      expandBody(bodyEl);
    }
  });

  // 子文件夹点击 → 进入下一层
  card.querySelectorAll('.subfolder-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const subIndex = parseInt(btn.dataset.subIndex);
      const subFolder = folder.children[subIndex];
      if (subFolder) {
        navStack.push({ folder: subFolder, title: subFolder.title });
        renderCurrentView();
        updateBreadcrumb();
      }
    });
  });

  // 展开更多
  const showMoreBtn = card.querySelector('.show-more-btn');
  if (showMoreBtn) {
    showMoreBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleShowMore(showMoreBtn, folder, bodyEl);
    });
  }

  // 操作按钮：重命名 & 删除（仅限 category-header 内的按钮，排除书签条目里的按钮）
  card.querySelectorAll('.category-header .card-action-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const action = btn.dataset.action;
      if (action === 'rename') handleRename('folder', folder);
      if (action === 'delete') handleDelete('folder', folder);
    });
  });

  return card;
}

// ─── 构建单个网页链接卡片（平铺在网格中） ─────────────────────
function buildBookmarkCard(bookmark, index = 0) {
  const domain = tryGetDomain(bookmark.url);
  const faviconSrc = bookmark.favicon || getFaviconUrl(bookmark.url);
  const fallback1 = getFaviconFallback(bookmark.url);
  const fallback2 = getFaviconFinalFallback(bookmark.url);

  const card = document.createElement('div');
  card.className = 'bookmark-card';
  card.title = bookmark.title;
  card.style.animationDelay = `${index * 55}ms`;

  card.innerHTML = `
    <a class="bookmark-card-link" href="${escHtml(bookmark.url)}" target="_blank" rel="noopener">
      <img class="bookmark-card-favicon"
           src="${escHtml(faviconSrc)}"
           data-fallback1="${escHtml(fallback1)}"
           data-fallback2="${escHtml(fallback2)}"
           alt=""
           onerror="if(!this.dataset.tried1){this.dataset.tried1='1';this.src=this.dataset.fallback1;}else if(!this.dataset.tried2){this.dataset.tried2='1';this.src=this.dataset.fallback2;}else{this.classList.add('error');}">
      <div class="bookmark-card-info">
        <div class="bookmark-card-title">${escHtml(bookmark.title)}</div>
        <div class="bookmark-card-domain">${domain}</div>
      </div>
    </a>
    <div class="card-actions">
      <button class="card-action-btn" data-action="rename" title="重命名">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
          <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
        </svg>
      </button>
      <button class="card-action-btn card-action-del" data-action="delete" title="删除">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6h14"/>
        </svg>
      </button>
    </div>
  `;

  // 操作按钮：重命名 & 删除
  card.querySelectorAll('.card-action-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();
      const action = btn.dataset.action;
      if (action === 'rename') handleRename('bookmark', bookmark);
      if (action === 'delete') handleDelete('bookmark', bookmark);
    });
  });

  return card;
}

// ─── 书签条目 HTML（在文件夹卡片内） ─────────────────────────
function buildBookmarkItemHTML(b, index = 0) {
  const domain = tryGetDomain(b.url);
  const delay = Math.min(index * 30, 300);
  const faviconSrc = b.favicon || getFaviconUrl(b.url);
  const fallback1 = getFaviconFallback(b.url);
  const fallback2 = getFaviconFinalFallback(b.url);

  return `
    <div class="bookmark-item" style="animation-delay:${delay}ms" data-id="${escHtml(b.id)}" data-title="${escHtml(b.title)}">
      <a class="bookmark-item-link" href="${escHtml(b.url)}" title="${escHtml(b.title)}"
         target="_blank" rel="noopener">
        <img class="bookmark-favicon"
             src="${escHtml(faviconSrc)}"
             data-fallback1="${escHtml(fallback1)}"
             data-fallback2="${escHtml(fallback2)}"
             alt=""
             onerror="if(!this.dataset.tried1){this.dataset.tried1='1';this.src=this.dataset.fallback1;}else if(!this.dataset.tried2){this.dataset.tried2='1';this.src=this.dataset.fallback2;}else{this.classList.add('error');}">
        <span class="bookmark-title">${escHtml(b.title)}</span>
        <span class="bookmark-domain">${domain}</span>
      </a>
      <div class="bookmark-item-actions">
        <button class="card-action-btn" data-action="rename" title="重命名">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
          </svg>
        </button>
        <button class="card-action-btn card-action-del" data-action="delete" title="删除">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6h14"/>
          </svg>
        </button>
      </div>
    </div>
  `;
}

/** 获取 Favicon URL（Google S2） */
function getFaviconUrl(url) {
  try {
    const hostname = new URL(url).hostname;
    return `https://www.google.com/s2/favicons?domain=${hostname}&sz=32`;
  } catch { return ''; }
}

/** Favicon 备选：Google S2 */
function getFaviconFallback(url) {
  try {
    const hostname = new URL(url).hostname;
    return `https://www.google.com/s2/favicons?domain=${hostname}&sz=32`;
  } catch { return ''; }
}

/** 最终备选：网站自身 favicon */
function getFaviconFinalFallback(url) {
  try {
    const u = new URL(url);
    return `${u.origin}/favicon.ico`;
  } catch { return ''; }
}

// ─── 折叠/展开更多 ──────────────────────────────────────────
function toggleShowMore(btn, folder, bodyEl) {
  const showing = btn.dataset.showing === 'true';
  const list = btn.closest('.bookmarks-list');

  if (!showing) {
    const allItems = folder.bookmarks.map((b, i) => buildBookmarkItemHTML(b, i)).join('');
    list.innerHTML = allItems + `
      <button class="show-more-btn" data-folder-id="${folder.id}" data-showing="true">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="transform:rotate(180deg)">
          <path d="m6 9 6 6 6-6"/>
        </svg>
        折叠
      </button>
    `;
  } else {
    const visibleBookmarks = folder.bookmarks.slice(0, MAX_VISIBLE_BOOKMARKS);
    const hiddenCount = folder.bookmarks.length - MAX_VISIBLE_BOOKMARKS;
    list.innerHTML = visibleBookmarks.map((b, i) => buildBookmarkItemHTML(b, i)).join('') + `
      <button class="show-more-btn" data-folder-id="${folder.id}" data-showing="false">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="m6 9 6 6 6-6"/>
        </svg>
        还有 ${hiddenCount} 条，点击展开
      </button>
    `;
  }

  const newBtn = list.querySelector('.show-more-btn');
  if (newBtn) {
    newBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleShowMore(newBtn, folder, bodyEl);
    });
  }

  if (bodyEl && bodyEl.style.maxHeight !== '0px') {
    bodyEl.style.maxHeight = 'none';
    requestAnimationFrame(() => {
      bodyEl.style.maxHeight = bodyEl.scrollHeight + 'px';
      const onEnd = () => {
        bodyEl.style.maxHeight = 'none';
        bodyEl.removeEventListener('transitionend', onEnd);
      };
      bodyEl.addEventListener('transitionend', onEnd);
    });
  }
}

// ─── 搜索 ────────────────────────────────────────────────────
function handleSearch(query) {
  const trimmed = query.trim();

  if (!trimmed) {
    $('searchResults').classList.remove('visible');
    $('categoriesGrid').style.display = '';
    $('statsBar').style.display = '';
    $('breadcrumb').style.display = navStack.length > 0 ? 'flex' : 'none';
    return;
  }

  $('categoriesGrid').style.display = 'none';
  $('statsBar').style.display = 'none';
  $('breadcrumb').style.display = 'none';
  $('searchResults').classList.add('visible');

  clearTimeout(searchDebounceTimer);
  searchDebounceTimer = setTimeout(async () => {
    try {
      const resp = await chrome.runtime.sendMessage({ type: 'SEARCH_BOOKMARKS', query: trimmed });
      const bookmarks = resp?.bookmarks || [];
      $('searchCount').textContent = bookmarks.length;

      const grid = $('searchGrid');
      grid.innerHTML = bookmarks.length
        ? bookmarks.map((b, i) => buildBookmarkItemHTML(b, i)).join('')
        : '<p style="color:var(--text-muted);font-size:13px;padding:8px">未找到相关书签</p>';
    } catch {
      $('searchGrid').innerHTML = '<p style="color:var(--text-muted);font-size:13px;padding:8px">搜索失败，请重试</p>';
    }
  }, 300);
}

// ─── 搜索引擎切换 ─────────────────────────────────────────────
function setEngine(key) {
  if (!SEARCH_ENGINES[key]) return;
  currentEngine = key;
  const eng = SEARCH_ENGINES[key];

  // 更新图标
  $('searchEngineIcon').textContent = eng.icon;

  // 更新 placeholder
  $('searchInput').placeholder = eng.placeholder;

  // 更新菜单高亮
  document.querySelectorAll('.engine-item').forEach(item => {
    item.classList.toggle('active', item.dataset.engine === key);
  });

  // 保存偏好
  try { localStorage.setItem('bh-engine', key); } catch {}

  // 若当前是收藏夹搜索，立刻触发一次搜索；否则隐藏收藏夹结果
  const query = $('searchInput').value;
  if (key === 'bookmark') {
    handleSearch(query);
  } else {
    // 非收藏夹模式：隐藏收藏夹搜索结果区域
    $('searchResults').classList.remove('visible');
    $('categoriesGrid').style.display = '';
    $('statsBar').style.display = '';
    $('breadcrumb').style.display = navStack.length > 0 ? 'flex' : 'none';
  }
}

// ─── 事件绑定 ────────────────────────────────────────────────
function bindEvents() {
  // ── 恢复上次使用的搜索引擎 ──
  const savedEngine = (() => { try { return localStorage.getItem('bh-engine') || 'bookmark'; } catch { return 'bookmark'; } })();
  setEngine(savedEngine);

  // ── 搜索引擎切换按钮 ──
  const engineBtn  = $('searchEngineBtn');
  const engineMenu = $('searchEngineMenu');

  engineBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    engineMenu.classList.toggle('open');
  });

  // 点击菜单项
  engineMenu.addEventListener('click', (e) => {
    const item = e.target.closest('.engine-item');
    if (!item) return;
    setEngine(item.dataset.engine);
    engineMenu.classList.remove('open');
    $('searchInput').focus();
  });

  // 点击外部关闭菜单
  document.addEventListener('click', (e) => {
    if (!engineBtn.contains(e.target) && !engineMenu.contains(e.target)) {
      engineMenu.classList.remove('open');
    }
  });

  // 搜索
  $('searchInput').addEventListener('input', (e) => {
    const val = e.target.value;
    $('searchClear').classList.toggle('visible', val.length > 0);
    if (currentEngine === 'bookmark') {
      handleSearch(val);
    }
  });

  // Enter 键 → 外部搜索引擎跳转
  $('searchInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const query = $('searchInput').value.trim();
      if (!query) return;
      if (currentEngine === 'bookmark') {
        // 收藏夹搜索已实时显示，Enter 不做额外处理
        return;
      }
      const eng = SEARCH_ENGINES[currentEngine];
      if (eng && eng.url) {
        window.open(eng.url + encodeURIComponent(query), '_blank', 'noopener');
      }
    }
  });

  $('searchClear').addEventListener('click', () => {
    $('searchInput').value = '';
    $('searchClear').classList.remove('visible');
    handleSearch('');
    $('searchInput').focus();
  });

  // 快捷键
  document.addEventListener('keydown', (e) => {
    if ((e.key === '/' || e.key === 'f') && !isEditing()) {
      e.preventDefault();
      $('searchInput').focus();
    }
    if (e.key === 'Escape') {
      engineMenu.classList.remove('open');
      $('searchInput').blur();
      $('searchInput').value = '';
      $('searchClear').classList.remove('visible');
      handleSearch('');
    }
    // Backspace 在非输入状态下返回上一级
    if (e.key === 'Backspace' && !isEditing()) {
      if (navStack.length > 1) {
        navigateTo(navStack.length - 2);
      } else if (navStack.length === 1) {
        renderHomeView();
      }
    }
  });

  // 主题切换
  $('btnTheme').addEventListener('click', () => {
    document.body.classList.add('theme-transitioning');
    const current = document.body.dataset.theme;
    const next = current === 'dark' ? 'light' : 'dark';
    document.body.dataset.theme = next;
    localStorage.setItem('bh-theme', next);
    showToast(next === 'light' ? '☀️ 已切换到浅色模式' : '🌙 已切换到深色模式');
    setTimeout(() => document.body.classList.remove('theme-transitioning'), 400);
  });

  // 刷新
  $('btnRefresh').addEventListener('click', async () => {
    const btn = $('btnRefresh');
    btn.style.animation = 'spin 0.6s ease';
    setTimeout(() => btn.style.animation = '', 700);
    showToast('🔄 正在刷新收藏夹...');
    await loadBookmarks();
    showToast('✅ 收藏夹已更新');
  });

  // 监听 background 通知
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'BOOKMARKS_CHANGED') {
      showToast('📌 收藏夹已变更，正在更新...');
      loadBookmarks();
    }
  });

  // 折叠/展开所有文件夹
  $('btnCollapseAll').addEventListener('click', collapseAll);
  $('btnExpandAll').addEventListener('click', expandAll);

  // 事件委托：处理文件夹内书签条目的操作按钮
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('.bookmark-item .card-action-btn');
    if (!btn) return;
    e.stopPropagation();
    e.preventDefault();
    const item = btn.closest('.bookmark-item');
    const id = item?.dataset.id;
    const title = item?.dataset.title;
    if (!id) return;
    const action = btn.dataset.action;
    if (action === 'rename') handleRename('bookmark', { id, title });
    if (action === 'delete') handleDelete('bookmark', { id, title });
  });
}

// ─── 工具函数 ────────────────────────────────────────────────
function escHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function tryGetDomain(url) {
  try {
    return new URL(url).hostname.replace('www.', '');
  } catch { return ''; }
}

function isEditing() {
  const el = document.activeElement;
  return el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
}

/** 递归统计所有书签数量 */
function countAllBookmarks(categories) {
  let count = 0;
  for (const cat of categories) {
    count += cat.bookmarks.length;
    count += countAllBookmarks(cat.children || []);
  }
  return count;
}

/** 数字滚动动画 */
function animateCount(el, target) {
  const duration = 600;
  const start = performance.now();
  const from = parseInt(el.textContent) || 0;
  const step = (now) => {
    const t = Math.min((now - start) / duration, 1);
    const eased = 1 - Math.pow(1 - t, 3);
    el.textContent = Math.round(from + (target - from) * eased);
    if (t < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

// ─── 启动 ────────────────────────────────────────────────────
init();
