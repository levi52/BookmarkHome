// BookmarkHome — Background Service Worker
// 负责收藏夹数据的读取、解析和缓存

// 剪切板状态（内存中，不持久化）
let clipboard = null;
// clipboard = { operation: 'cut'|'copy', type: 'folder'|'bookmark', data: {...}, sourceParentId: string }

// 递归创建文件夹及其内容（用于复制粘贴文件夹）
function createFolderRecursive(parentId, folder) {
  return new Promise((resolve) => {
    chrome.bookmarks.create({ parentId, title: folder.title }, (newFolder) => {
      const promises = [];

      // 创建子文件夹
      if (folder.children) {
        for (const child of folder.children) {
          promises.push(createFolderRecursive(newFolder.id, child));
        }
      }

      // 创建书签
      if (folder.bookmarks) {
        for (const bm of folder.bookmarks) {
          promises.push(new Promise((res) => {
            chrome.bookmarks.create({ parentId: newFolder.id, title: bm.title, url: bm.url }, res);
          }));
        }
      }

      Promise.all(promises).then(() => resolve(newFolder));
    });
  });
}

/**
 * 递归解析收藏夹树，返回根节点分组结构
 * 根节点通常是"收藏夹栏"和"工作区"等顶级分类
 * 每个根节点包含 children（子文件夹）和 bookmarks（直接在该层级的网页）
 */
function parseBookmarkTree(nodes) {
  const roots = [];    // 根节点列表：收藏夹栏、工作区等
  const allBookmarks = [];

  /**
   * 递归解析一个文件夹节点，返回结构化对象
   */
  function parseFolder(node, depth = 0) {
    const result = {
      id: node.id,
      title: node.title || '未命名文件夹',
      depth,
      children: [],   // 子文件夹
      bookmarks: []   // 该文件夹下的直接网页链接
    };

    if (!node.children) return result;

    for (const child of node.children) {
      if (child.url) {
        // 这是一个网页书签
        let faviconUrl = '';
        try {
          faviconUrl = `chrome-extension://${chrome.runtime.id}/_favicon/?pageUrl=${encodeURIComponent(child.url)}&size=32`;
        } catch { /* ignore invalid URL */ }

        const bookmark = {
          id: child.id,
          title: child.title || child.url,
          url: child.url,
          favicon: faviconUrl,
          parentId: node.id
        };
        result.bookmarks.push(bookmark);
        allBookmarks.push(bookmark);
      } else if (child.children) {
        // 这是一个子文件夹
        const subFolder = parseFolder(child, depth + 1);
        result.children.push(subFolder);
      }
    }

    return result;
  }

  /**
   * Chrome/Edge 的 getTree() 返回结构：
   * [ { title: "", children: [收藏夹栏, 其他收藏夹, 工作区, ...] } ]
   * 最顶层是空标题的虚拟根节点，真正的根节点是它的子节点。
   * 需要跳过虚拟根节点，直接取其子节点作为 roots。
   */
  function collectRealRoots(nodes) {
    const realRoots = [];
    for (const node of nodes) {
      if (!node.children) continue;
      // 判断是否为虚拟根节点：空标题，且子节点全是文件夹（无直接网页链接）
      const hasOnlySubfolders = node.children.every(c => !c.url);
      if (!node.title && hasOnlySubfolders) {
        // 这是虚拟根节点，取其子节点继续查找
        realRoots.push(...collectRealRoots(node.children));
      } else {
        // 这是真正的根节点（收藏夹栏、其他收藏夹、工作区等）
        realRoots.push(node);
      }
    }
    return realRoots;
  }

  const realRoots = collectRealRoots(nodes);

  for (const rootNode of realRoots) {
    const parsed = parseFolder(rootNode, 0);

    // 只保留有内容的根节点
    if (parsed.bookmarks.length > 0 || parsed.children.length > 0) {
      roots.push(parsed);
    }
  }

  return { roots, bookmarks: allBookmarks };
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

/**
 * 读取并处理收藏夹数据
 */
async function getBookmarkData() {
  return new Promise((resolve) => {
    chrome.bookmarks.getTree((tree) => {
      const { roots, bookmarks } = parseBookmarkTree(tree);

      const stats = {
        totalBookmarks: bookmarks.length,
        totalRoots: roots.length,
        lastUpdated: Date.now()
      };

      resolve({ roots, bookmarks, stats });
    });
  });
}

// 监听来自 newtab / popup 的消息
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'GET_BOOKMARKS') {
    getBookmarkData().then((data) => {
      sendResponse({ success: true, data });
    });
    return true;
  }

  if (message.type === 'SEARCH_BOOKMARKS') {
    const query = message.query.toLowerCase().trim();
    chrome.bookmarks.search(query, (results) => {
      const bookmarks = results
        .filter(b => b.url)
        .map(b => {
          let faviconUrl = '';
          try {
            faviconUrl = `chrome-extension://${chrome.runtime.id}/_favicon/?pageUrl=${encodeURIComponent(b.url)}&size=32`;
          } catch { /* ignore */ }
          return {
            id: b.id,
            title: b.title || b.url,
            url: b.url,
            favicon: faviconUrl
          };
        });
      sendResponse({ success: true, bookmarks });
    });
    return true;
  }

  if (message.type === 'SAVE_SETTINGS') {
    chrome.storage.local.set({ settings: message.settings }, () => {
      sendResponse({ success: true });
    });
    return true;
  }

  if (message.type === 'GET_SETTINGS') {
    chrome.storage.local.get(['settings'], (result) => {
      sendResponse({ success: true, settings: result.settings || {} });
    });
    return true;
  }

  if (message.type === 'GET_CLIPBOARD') {
    sendResponse({ hasData: clipboard !== null });
    return false;
  }

  if (message.type === 'CUT_BOOKMARK') {
    clipboard = { operation: 'cut', type: message.data.type, data: message.data, sourceParentId: message.data.parentId || null };
    sendResponse({ success: true });
    return false;
  }

  if (message.type === 'COPY_BOOKMARK') {
    clipboard = { operation: 'copy', type: message.data.type, data: message.data };
    sendResponse({ success: true });
    return false;
  }

  if (message.type === 'PASTE_BOOKMARK') {
    if (!clipboard) {
      sendResponse({ success: false, error: '剪贴板为空' });
      return false;
    }

    const parentId = message.parentId;

    if (clipboard.operation === 'cut') {
      // 移动操作：直接 move，完成后清空剪切板
      chrome.bookmarks.move(clipboard.data.id, { parentId: parentId }, () => {
        const title = clipboard.data.title;
        clipboard = null;
        sendResponse({ success: true, title });
      });
      return true;
    }

    if (clipboard.operation === 'copy') {
      if (clipboard.type === 'bookmark') {
        chrome.bookmarks.create(
          { parentId: parentId, title: clipboard.data.title, url: clipboard.data.url },
          (newBm) => sendResponse({ success: true, title: newBm.title })
        );
      } else {
        // 复制文件夹：递归创建
        createFolderRecursive(parentId, clipboard.data).then((newFolder) => {
          sendResponse({ success: true, title: newFolder.title });
        });
      }
      return true;
    }
  }

  if (message.type === 'RENAME_BOOKMARK') {
    chrome.bookmarks.update(message.id, { title: message.title }, () => {
      sendResponse({ success: true });
    });
    return true;
  }

  if (message.type === 'DELETE_BOOKMARK') {
    // 判断是书签还是文件夹
    chrome.bookmarks.get(message.id, (results) => {
      if (chrome.runtime.lastError || !results.length) {
        sendResponse({ success: false });
        return;
      }
      if (results[0]?.url) {
        chrome.bookmarks.remove(message.id, () => sendResponse({ success: true }));
      } else {
        chrome.bookmarks.removeTree(message.id, () => sendResponse({ success: true }));
      }
    });
    return true;
  }
});

// 收藏夹变化时通知所有打开的新标签页刷新
chrome.bookmarks.onCreated.addListener(() => notifyTabsRefresh());
chrome.bookmarks.onRemoved.addListener(() => notifyTabsRefresh());
chrome.bookmarks.onChanged.addListener(() => notifyTabsRefresh());
chrome.bookmarks.onMoved.addListener(() => notifyTabsRefresh());

function notifyTabsRefresh() {
  chrome.tabs.query({}, (tabs) => {
    for (const tab of tabs) {
      if (tab.url && tab.url.startsWith('chrome-extension://') && tab.url.includes('newtab')) {
        chrome.tabs.sendMessage(tab.id, { type: 'BOOKMARKS_CHANGED' }).catch(() => {});
      }
    }
  });
}
