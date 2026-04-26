// ── State ──────────────────────────────────────────────
let tree = [];
let selectedFolderId = '__root__';
let editingNodeId = null;
let searchQuery = '';
let showHidden = false;
let recentCopied = [];    // array of text node IDs (max 10)
let currentTags = [];     // tags being edited in modal
let pendingDeleteId = null;
let pendingImportData = null;
let deleteHistory = [];    // array of {node, parentFolderId, deletedAt} (max 10)

// ── Icons ───────────────────────────────────────────────
const SVG_EYE = `<svg width="14" height="10" viewBox="0 0 14 10" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M1 5C2.5 2 4.5 1 7 1s4.5 1 6 4c-1.5 3-3.5 4-6 4S2.5 8 1 5z"/><circle cx="7" cy="5" r="1.8" fill="currentColor" stroke="none"/></svg>`;
const SVG_EYE_SLASH = `<svg width="14" height="12" viewBox="0 0 14 12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M1 6C2.5 3 4.5 2 7 2s4.5 1 6 4c-1.5 3-3.5 4-6 4S2.5 9 1 6z"/><circle cx="7" cy="6" r="1.8" fill="currentColor" stroke="none"/><line x1="2" y1="1" x2="12" y2="11"/></svg>`;
const SVG_UP = `<svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="2,8 6,4 10,8"/></svg>`;
const SVG_DOWN = `<svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="2,4 6,8 10,4"/></svg>`;

// ── Utility ────────────────────────────────────────────
function genId() {
  return crypto.randomUUID();
}

function getFolderDepth(id) {
  const all = flattenFolders(tree);
  const found = all.find(f => f.id === id);
  return found ? found.depth : -1;
}

function findNode(nodes, id) {
  for (let i = 0; i < nodes.length; i++) {
    if (nodes[i].id === id) return { node: nodes[i], parent: nodes, index: i };
    if (nodes[i].type === 'folder' && nodes[i].children) {
      const found = findNode(nodes[i].children, id);
      if (found) return found;
    }
  }
  return null;
}

function collectTexts(nodes, includeHidden = false) {
  const texts = [];
  for (const n of nodes) {
    if (n.type === 'text') texts.push(n);
    if (n.type === 'folder' && n.children) {
      if (!n.hidden || includeHidden) {
        texts.push(...collectTexts(n.children, includeHidden));
      }
    }
  }
  return texts;
}

function collectTextsByTag(nodes, tag) {
  const texts = [];
  for (const n of nodes) {
    if (n.type === 'text' && n.tags && n.tags.includes(tag)) texts.push(n);
    if (n.type === 'folder' && n.children) texts.push(...collectTextsByTag(n.children, tag));
  }
  return texts;
}

function collectAllTags(nodes) {
  const tags = new Set();
  for (const n of nodes) {
    if (n.type === 'text' && n.tags && n.tags.length) n.tags.forEach(t => tags.add(t));
    if (n.type === 'folder' && n.children) collectAllTags(n.children).forEach(t => tags.add(t));
  }
  return [...tags].sort();
}

function flattenFolders(nodes, depth = 0, result = []) {
  for (const n of nodes) {
    if (n.type === 'folder') {
      result.push({ id: n.id, name: n.name, depth });
      if (n.children) flattenFolders(n.children, depth + 1, result);
    }
  }
  return result;
}

// ── Storage ────────────────────────────────────────────
function handleStorageError(label) {
  if (chrome.runtime.lastError) {
    console.error(`${label} 儲存失敗:`, chrome.runtime.lastError);
    showToast('儲存失敗：空間不足或權限錯誤');
  }
}

function saveTree() {
  chrome.storage.local.set({ tree }, () => handleStorageError('tree'));
}

function saveRecent() {
  chrome.storage.local.set({ recentCopied }, () => handleStorageError('recentCopied'));
}

function saveSelectedFolder() {
  chrome.storage.local.set({ selectedFolderId }, () => handleStorageError('selectedFolderId'));
}

function saveDeleteHistory() {
  chrome.storage.local.set({ deleteHistory }, () => handleStorageError('deleteHistory'));
}

function reIdNodes(nodes) {
  for (const n of nodes) {
    n.id = genId();
    if (n.children) reIdNodes(n.children);
  }
}

function loadTree(cb) {
  chrome.storage.local.get(['tree', 'recentCopied', 'selectedFolderId', 'deleteHistory'], (result) => {
    tree = result.tree && result.tree.length > 0 ? result.tree : defaultData();
    recentCopied = result.recentCopied || [];
    deleteHistory = result.deleteHistory || [];
    if (result.selectedFolderId) selectedFolderId = result.selectedFolderId;
    cb();
  });
}

function defaultData() {
  return [];
}

// ── Render: Tree ───────────────────────────────────────
function renderTree() {
  const container = document.getElementById('tree-container');
  container.innerHTML = '';
  renderFolderNodes(tree, container, 0);
  renderTagList();
  updateFolderToolbar();

  document.querySelectorAll('.tree-folder, .tree-item-root, .tree-tag-item').forEach(el => {
    el.classList.remove('active');
  });
  const activeId = selectedFolderId === '__root__' ? '__root__' : selectedFolderId;
  const activeEl = document.querySelector(`[data-id="${CSS.escape(activeId)}"]`);
  if (activeEl) activeEl.classList.add('active');
}

function updateFolderToolbar() {
  const isFolder = !selectedFolderId.startsWith('__') && !!findNode(tree, selectedFolderId);
  const ids = ['tb-up', 'tb-down', 'tb-hide', 'tb-edit', 'tb-delete'];
  ids.forEach(id => {
    const btn = document.getElementById(id);
    if (btn) btn.disabled = !isFolder;
  });

  if (isFolder) {
    const found = findNode(tree, selectedFolderId);
    const hideBtn = document.getElementById('tb-hide');
    if (found && hideBtn) hideBtn.innerHTML = found.node.hidden ? SVG_EYE_SLASH : SVG_EYE;
  }
}

function renderFolderNodes(nodes, container, depth) {
  const folderSiblings = nodes.filter(n => n.type === 'folder');

  for (const node of nodes) {
    if (node.type !== 'folder') continue;
    if (node.hidden && !showHidden) continue;

    const wrapper = document.createElement('div');
    wrapper.className = 'tree-folder-row' + (node.hidden ? ' folder-hidden-row' : '');

    const folderEl = document.createElement('div');
    folderEl.className = 'tree-folder' + (node.expanded ? ' expanded' : '');
    folderEl.dataset.id = node.id;
    folderEl.style.paddingLeft = (8 + depth * 14) + 'px';

    const hasSubFolders = node.children && node.children.some(n => n.type === 'folder');
    folderEl.innerHTML = `
      <span class="folder-triangle${hasSubFolders && node.expanded ? ' rotated' : ''}">▶</span>
      <span class="folder-name" title="${escHtml(node.name)}">${escHtml(node.name)}</span>
    `;

    folderEl.addEventListener('click', (e) => {
      e.stopPropagation();
      node.expanded = !node.expanded;
      selectedFolderId = node.id;
      saveTree();
      saveSelectedFolder();
      renderTree();
      renderTextList();
    });

    wrapper.appendChild(folderEl);

    const childContainer = document.createElement('div');
    childContainer.className = 'tree-children' + (node.expanded ? ' visible' : '');
    if (node.children && node.children.length > 0) {
      renderFolderNodes(node.children, childContainer, depth + 1);
    }
    wrapper.appendChild(childContainer);
    container.appendChild(wrapper);
  }
}

function renderTagList() {
  const container = document.getElementById('tag-list-container');
  if (!container) return;
  container.innerHTML = '';
  const tags = collectAllTags(tree);
  for (const tag of tags) {
    const el = document.createElement('div');
    el.className = 'tree-tag-item';
    el.dataset.id = `__tag__${tag}`;
    el.innerHTML = `<span class="tag-hash">#</span><span>${escHtml(tag)}</span>`;
    el.addEventListener('click', () => {
      selectedFolderId = `__tag__${tag}`;
      document.querySelectorAll('.tree-folder, .tree-item-root, .tree-tag-item').forEach(e => e.classList.remove('active'));
      el.classList.add('active');
      saveSelectedFolder();
      renderTextList();
    });
    container.appendChild(el);
  }
}

// ── Render: Text List ──────────────────────────────────
function renderTextList() {
  const list = document.getElementById('text-list');
  const title = document.getElementById('content-title');
  const subtitle = document.getElementById('content-subtitle');
  list.innerHTML = '';
  subtitle.textContent = '';
  subtitle.classList.add('hidden');

  let texts = [];

  if (selectedFolderId === '__root__') {
    title.textContent = '所有文字';
    texts = collectTexts(tree, showHidden);
  } else if (selectedFolderId === '__recent__') {
    title.textContent = '最近複製';
    subtitle.textContent = '僅顯示最近 10 筆';
    subtitle.classList.remove('hidden');
    texts = recentCopied.map(id => {
      const found = findNode(tree, id);
      return found ? found.node : null;
    }).filter(Boolean);
  } else if (selectedFolderId.startsWith('__tag__')) {
    const tag = selectedFolderId.slice(7);
    title.textContent = `# ${tag}`;
    texts = collectTextsByTag(tree, tag);
  } else {
    const found = findNode(tree, selectedFolderId);
    if (found) {
      title.textContent = found.node.name;
      texts = collectTexts(found.node.children || [], showHidden);
    }
  }

  if (searchQuery) {
    const q = searchQuery.toLowerCase();
    texts = texts.filter(t =>
      (t.name && t.name.toLowerCase().includes(q)) ||
      (t.content && t.content.toLowerCase().includes(q)) ||
      (t.tags && t.tags.some(tag => tag.toLowerCase().includes(q)))
    );
  }

  if (texts.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.innerHTML = `<div class="empty-icon">📭</div><div>尚無文字<br>點擊「＋」新增</div>`;
    list.appendChild(empty);
    return;
  }

  for (const t of texts) {
    const item = document.createElement('div');
    item.className = 'text-item' + (!t.name ? ' text-item-no-title' : '');
    item.dataset.id = t.id;

    const hasTitle = t.name && t.name.trim();
    const tagsHtml = t.tags && t.tags.length
      ? `<div class="text-item-tags">${t.tags.map(tag => `<span class="item-tag-chip">${escHtml(tag)}</span>`).join('')}</div>`
      : '';

    item.innerHTML = `
      <div class="text-item-body">
        ${hasTitle ? `<div class="text-item-name">${escHtml(t.name)}</div>` : ''}
        <div class="text-item-content">${escHtml(t.content)}</div>
        ${tagsHtml}
      </div>
      <div class="text-item-actions">
        <button class="text-action-btn btn-edit-text" title="編輯">✏️</button>
        <button class="text-action-btn btn-del-text" title="刪除">🗑</button>
      </div>
      <div class="copy-indicator">已複製！</div>
    `;

    item.querySelector('.text-item-body').addEventListener('click', () => copyText(t, item));
    item.querySelector('.btn-edit-text').addEventListener('click', (e) => {
      e.stopPropagation();
      openEditTextModal(t.id);
    });
    item.querySelector('.btn-del-text').addEventListener('click', (e) => {
      e.stopPropagation();
      deleteNode(t.id);
    });

    list.appendChild(item);
  }
}

// ── Copy ───────────────────────────────────────────────
function copyText(node, itemEl) {
  const doCopy = () => {
    itemEl.classList.add('copied');
    showToast('已複製！');
    setTimeout(() => itemEl.classList.remove('copied'), 1200);
    recordRecent(node.id);
  };

  navigator.clipboard.writeText(node.content).then(doCopy).catch(() => {
    const ta = document.createElement('textarea');
    ta.value = node.content;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
    doCopy();
  });
}

function recordRecent(nodeId) {
  recentCopied = [nodeId, ...recentCopied.filter(id => id !== nodeId)].slice(0, 10);
  saveRecent();
  if (selectedFolderId === '__recent__') renderTextList();
}

function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 1800);
}

// ── Modal: Folder ──────────────────────────────────────
function openAddFolderModal(parentId = null) {
  editingNodeId = null;
  document.getElementById('modal-folder-title').textContent = '新增資料夾';
  document.getElementById('folder-name-input').value = '';
  document.getElementById('btn-folder-save').dataset.parentId = parentId || selectedFolderId;
  document.getElementById('modal-folder').classList.remove('hidden');
  document.getElementById('folder-name-input').focus();
}

function openEditFolderModal(id) {
  const found = findNode(tree, id);
  if (!found) return;
  editingNodeId = id;
  document.getElementById('modal-folder-title').textContent = '編輯資料夾';
  document.getElementById('folder-name-input').value = found.node.name;
  document.getElementById('modal-folder').classList.remove('hidden');
  document.getElementById('folder-name-input').focus();
}

function saveFolderModal() {
  const name = document.getElementById('folder-name-input').value.trim();
  if (!name) { document.getElementById('folder-name-input').focus(); return; }

  if (editingNodeId) {
    const found = findNode(tree, editingNodeId);
    if (found) { found.node.name = name; }
  } else {
    const newFolder = { id: genId(), name, type: 'folder', expanded: false, children: [] };
    const parentId = document.getElementById('btn-folder-save').dataset.parentId;
    if (parentId && parentId !== '__root__' && getFolderDepth(parentId) >= 2) {
      alert('最多支援 3 層資料夾，無法繼續新增子資料夾。');
      return;
    }
    if (!parentId || parentId === '__root__') {
      tree.push(newFolder);
    } else {
      const found = findNode(tree, parentId);
      if (found && found.node.type === 'folder') {
        found.node.children.push(newFolder);
        found.node.expanded = true;
      } else {
        tree.push(newFolder);
      }
    }
  }

  saveTree();
  renderTree();
  renderTextList();
  closeModal('modal-folder');
}

// ── Modal: Text ────────────────────────────────────────
function openAddTextModal() {
  editingNodeId = null;
  currentTags = [];
  document.getElementById('modal-text-title').textContent = '新增文字';
  document.getElementById('text-name-input').value = '';
  document.getElementById('text-content-input').value = '';
  const activeFolder = !selectedFolderId.startsWith('__') ? selectedFolderId : null;
  populateFolderSelect(activeFolder);
  renderTagChips();
  document.getElementById('modal-text').classList.remove('hidden');
  document.getElementById('text-content-input').focus();
}

function openEditTextModal(id) {
  const found = findNode(tree, id);
  if (!found) return;
  editingNodeId = id;
  currentTags = found.node.tags ? [...found.node.tags] : [];
  document.getElementById('modal-text-title').textContent = '編輯文字';
  document.getElementById('text-name-input').value = found.node.name || '';
  document.getElementById('text-content-input').value = found.node.content || '';
  const parentFolder = findParentFolder(tree, id);
  populateFolderSelect(parentFolder);
  renderTagChips();
  document.getElementById('modal-text').classList.remove('hidden');
  document.getElementById('text-content-input').focus();
}

function findParentFolder(nodes, childId, parentId = '__root__') {
  for (const n of nodes) {
    if (n.id === childId) return parentId;
    if (n.type === 'folder' && n.children) {
      const found = findParentFolder(n.children, childId, n.id);
      if (found !== null) return found;
    }
  }
  return null;
}

function populateFolderSelect(selectedId) {
  const sel = document.getElementById('text-folder-select');
  sel.innerHTML = '';
  const folders = flattenFolders(tree);
  if (folders.length === 0) {
    const opt = document.createElement('option');
    opt.value = '';
    opt.disabled = true;
    opt.textContent = '（請先新增資料夾）';
    sel.appendChild(opt);
    sel.value = '';
    return;
  }
  for (const f of folders) {
    const opt = document.createElement('option');
    opt.value = f.id;
    opt.textContent = '\u00a0'.repeat(f.depth * 2) + f.name;
    sel.appendChild(opt);
  }
  if (selectedId && selectedId !== '__root__' && folders.find(f => f.id === selectedId)) {
    sel.value = selectedId;
  } else {
    sel.value = folders[0].id;
  }
}

function saveTextModal() {
  const name = document.getElementById('text-name-input').value.trim();
  const content = document.getElementById('text-content-input').value.trim();
  const folderId = document.getElementById('text-folder-select').value;

  // Flush any typed-but-not-confirmed tag
  const tagInput = document.getElementById('tag-input-field');
  if (tagInput.value.trim()) addTag(tagInput.value.trim());
  tagInput.value = '';

  if (!content) { document.getElementById('text-content-input').focus(); return; }
  if (!folderId) { showToast('請先新增資料夾'); return; }

  if (editingNodeId) {
    const oldParent = findParentFolder(tree, editingNodeId);
    const found = findNode(tree, editingNodeId);
    if (!found) return;

    if (oldParent !== folderId) {
      found.parent.splice(found.index, 1);
      found.node.name = name;
      found.node.content = content;
      found.node.tags = [...currentTags];
      insertTextNode(found.node, folderId);
    } else {
      found.node.name = name;
      found.node.content = content;
      found.node.tags = [...currentTags];
    }
  } else {
    const newText = { id: genId(), name, type: 'text', content, tags: [...currentTags] };
    insertTextNode(newText, folderId);
  }

  saveTree();
  renderTree();
  renderTextList();
  closeModal('modal-text');
}

function insertTextNode(node, folderId) {
  if (!folderId || folderId === '__root__') {
    tree.push(node);
  } else {
    const found = findNode(tree, folderId);
    if (found && found.node.type === 'folder') {
      found.node.children.push(node);
    } else {
      tree.push(node);
    }
  }
}

// ── Tag Input ──────────────────────────────────────────
function initTagInput() {
  const input = document.getElementById('tag-input-field');
  const box = document.getElementById('tag-input-box');

  box.addEventListener('click', (e) => {
    if (!e.target.closest('.tag-chip')) input.focus();
  });

  input.addEventListener('keydown', (e) => {
    if ((e.key === 'Enter' || e.key === ',') && !e.isComposing) {
      e.preventDefault();
      addTag(input.value.replace(/,$/, '').trim());
      input.value = '';
    } else if (e.key === 'Backspace' && input.value === '' && currentTags.length > 0) {
      currentTags.pop();
      renderTagChips();
    }
  });
}

function addTag(val) {
  const tag = val.replace(/,/g, '').trim();
  if (tag && !currentTags.includes(tag)) {
    currentTags.push(tag);
    renderTagChips();
  }
}

function renderTagChips() {
  const box = document.getElementById('tag-input-box');
  box.querySelectorAll('.tag-chip').forEach(el => el.remove());
  const input = document.getElementById('tag-input-field');
  for (const tag of currentTags) {
    const chip = document.createElement('span');
    chip.className = 'tag-chip';
    chip.innerHTML = `${escHtml(tag)}<span class="tag-chip-remove">✕</span>`;
    chip.querySelector('.tag-chip-remove').addEventListener('click', () => {
      currentTags = currentTags.filter(t => t !== tag);
      renderTagChips();
    });
    box.insertBefore(chip, input);
  }
}

// ── Folder Order & Visibility ──────────────────────────
function moveFolderUp(id, siblingNodes) {
  const arr = siblingNodes || (findNode(tree, id) || {}).parent || tree;
  const folders = arr.filter(n => n.type === 'folder');
  const idx = folders.findIndex(n => n.id === id);
  if (idx <= 0) return;
  const aIdx = arr.indexOf(folders[idx]);
  const bIdx = arr.indexOf(folders[idx - 1]);
  [arr[aIdx], arr[bIdx]] = [arr[bIdx], arr[aIdx]];
  saveTree();
  renderTree();
}

function moveFolderDown(id, siblingNodes) {
  const arr = siblingNodes || (findNode(tree, id) || {}).parent || tree;
  const folders = arr.filter(n => n.type === 'folder');
  const idx = folders.findIndex(n => n.id === id);
  if (idx === -1 || idx >= folders.length - 1) return;
  const aIdx = arr.indexOf(folders[idx]);
  const bIdx = arr.indexOf(folders[idx + 1]);
  [arr[aIdx], arr[bIdx]] = [arr[bIdx], arr[aIdx]];
  saveTree();
  renderTree();
}

function toggleFolderHidden(id) {
  const found = findNode(tree, id);
  if (!found) return;
  found.node.hidden = !found.node.hidden;
  if (found.node.hidden && selectedFolderId === id) selectedFolderId = '__root__';
  saveTree();
  renderTree();
  renderTextList();
}

// ── Delete ─────────────────────────────────────────────
function deleteNode(id) {
  const found = findNode(tree, id);
  if (!found) return;

  const isFolder = found.node.type === 'folder';
  const hasChildren = isFolder && found.node.children && found.node.children.length > 0;
  const msg = isFolder
    ? (hasChildren ? `確定要刪除資料夾「${found.node.name}」及其所有內容？` : `確定要刪除資料夾「${found.node.name}」？`)
    : `確定要刪除此文字？`;

  pendingDeleteId = id;
  document.getElementById('confirm-msg').textContent = msg;
  document.getElementById('modal-confirm').classList.remove('hidden');
}

function confirmDelete() {
  if (!pendingDeleteId) return;
  const found = findNode(tree, pendingDeleteId);
  if (found) {
    // Record delete history
    const parentFolderId = findParentFolder(tree, pendingDeleteId) || '__root__';
    deleteHistory.unshift({
      node: JSON.parse(JSON.stringify(found.node)),
      parentFolderId,
      deletedAt: Date.now()
    });
    if (deleteHistory.length > 10) deleteHistory.pop();
    saveDeleteHistory();

    // Clean up recentCopied
    if (found.node.type === 'folder') {
      const textIds = collectTexts([found.node], true).map(t => t.id);
      recentCopied = recentCopied.filter(id => !textIds.includes(id));
    } else {
      recentCopied = recentCopied.filter(id => id !== pendingDeleteId);
    }
    saveRecent();

    found.parent.splice(found.index, 1);
    if (selectedFolderId === pendingDeleteId) selectedFolderId = '__root__';
    saveTree();
    renderTree();
    renderTextList();
  }
  pendingDeleteId = null;
  closeModal('modal-confirm');
}

// ── Delete History ─────────────────────────────────────
function renderDeleteHistory() {
  const container = document.getElementById('delete-history-list');
  if (!deleteHistory.length) {
    container.innerHTML = '<p style="color:#999;font-size:13px;text-align:center;padding:16px">尚無刪除紀錄</p>';
    return;
  }
  container.innerHTML = deleteHistory.map((entry, i) => {
    const node = entry.node;
    const isFolder = node.type === 'folder';
    const typeTag = isFolder ? '資料夾' : '文字';
    const date = new Date(entry.deletedAt).toLocaleString('zh-TW', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
    const titleLine = isFolder
      ? escHtml(node.name)
      : (node.name ? escHtml(node.name) : '<span style="color:#aaa">（無標題）</span>');
    const previewLine = isFolder
      ? (() => { const count = collectTexts([node], true).length; return `共 ${count} 筆文字`; })()
      : `<span class="delete-history-preview">${escHtml(node.content)}</span>`;
    return `<div class="delete-history-item">
      <div class="delete-history-info">
        <div style="display:flex;align-items:center;gap:6px">
          <span class="delete-history-type">${typeTag}</span>
          <span class="delete-history-time">${date}</span>
        </div>
        <span class="delete-history-label">${titleLine}</span>
        <div class="delete-history-content">${previewLine}</div>
      </div>
      <div style="display:flex;flex-direction:column;gap:4px;flex-shrink:0">
        <button class="btn-small delete-history-restore" data-index="${i}">還原</button>
        <button class="delete-history-remove" data-index="${i}">移除</button>
      </div>
    </div>`;
  }).join('');

  container.querySelectorAll('.delete-history-restore').forEach(btn => {
    btn.addEventListener('click', () => restoreDeleted(parseInt(btn.dataset.index)));
  });
  container.querySelectorAll('.delete-history-remove').forEach(btn => {
    btn.addEventListener('click', () => {
      deleteHistory.splice(parseInt(btn.dataset.index), 1);
      saveDeleteHistory();
      renderDeleteHistory();
    });
  });
}

function restoreDeleted(index) {
  const entry = deleteHistory[index];
  if (!entry) return;
  const node = JSON.parse(JSON.stringify(entry.node));
  reIdNodes([node]);

  if (node.type === 'folder') {
    tree.push(node);
  } else {
    const parentFound = findNode(tree, entry.parentFolderId);
    if (parentFound && parentFound.node.type === 'folder') {
      parentFound.node.children.push(node);
    } else {
      const allFolders = flattenFolders(tree);
      if (allFolders.length > 0) {
        const firstFolder = findNode(tree, allFolders[0].id);
        if (firstFolder) firstFolder.node.children.push(node);
      } else {
        tree.push(node);
        showToast('原路徑已不存在，已還原至根目錄');
      }
    }
  }

  deleteHistory.splice(index, 1);
  saveDeleteHistory();
  saveTree();
  renderTree();
  renderTextList();
  renderDeleteHistory();
  showToast('已還原！');
}

// ── Modal helpers ──────────────────────────────────────
function closeModal(id) {
  document.getElementById(id).classList.add('hidden');
  editingNodeId = null;
}

function escHtml(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ── Feature Tour ───────────────────────────────────────
const TOUR_ITEMS = [
  { title: '所有文字', desc: '顯示全部資料夾內的所有文字，搜尋時跨資料夾全域查找。', target: '#tree-item-all' },
  { title: '資料夾', desc: '點選資料夾切換顯示範圍，搜尋時僅搜尋該資料夾及其子資料夾內容。', target: '#tree-root' },
  { title: '標籤篩選', desc: '左側標籤列表可跨資料夾篩選所有包含該標籤的文字。', target: '.tree-tags-panel' },
  { title: '搜尋', desc: '在所有文字搜尋文字名稱、內容與標籤，搜尋範圍為全域，於特定資料夾搜尋，則會將搜尋範圍侷限於目前選擇資料夾當中。', target: '#search-input' },
  { title: '新增文字', desc: '在目前資料夾新增文字項目，可設定標題、內容與標籤。', target: '#btn-add-text' },
  { title: '資料夾工具列', desc: '選取資料夾後可上移、下移、隱藏、編輯或刪除該資料夾。', target: '.folder-toolbar' },
  { title: '最近複製', desc: '記錄最近 10 筆複製內容，方便快速取用常用文字。', target: '#btn-recent' },
  { title: '刪除紀錄', desc: '保留最近 10 筆刪除紀錄，可一鍵還原誤刪的資料夾或文字。', target: '#btn-delete-history' },
  { title: '匯入 / 匯出', desc: '匯入匯出資料均為JSON 格式，匯入資料時可選擇覆蓋或加入現有資料。', target: '#btn-import-export' },
];

function renderTour() {
  document.getElementById('tour-list').innerHTML = TOUR_ITEMS.map((item, i) =>
    `<div class="tour-item">
      <div class="tour-item-info">
        <span class="tour-item-title">${escHtml(item.title)}</span>
        <span class="tour-item-desc">${escHtml(item.desc)}</span>
      </div>
      <button class="tour-demo-btn" data-index="${i}">示範</button>
    </div>`
  ).join('');

  document.querySelectorAll('.tour-demo-btn').forEach(btn => {
    btn.addEventListener('click', () => startDemo(parseInt(btn.dataset.index)));
  });
}

function startDemo(index) {
  const item = TOUR_ITEMS[index];
  if (!item) return;
  const target = document.querySelector(item.target);
  if (!target) return;

  closeModal('modal-tour');

  const spotlight = document.getElementById('tour-spotlight');
  const tooltip = document.getElementById('tour-tooltip');
  const rect = target.getBoundingClientRect();
  const pad = 5;

  spotlight.style.left   = (rect.left   - pad) + 'px';
  spotlight.style.top    = (rect.top    - pad) + 'px';
  spotlight.style.width  = (rect.width  + pad * 2) + 'px';
  spotlight.style.height = (rect.height + pad * 2) + 'px';

  tooltip.textContent = item.desc;
  spotlight.classList.remove('hidden');
  tooltip.classList.remove('hidden');

  // Position tooltip: prefer below, fallback above; clamp to viewport
  const tooltipWidth = 220;
  const clampedLeft = Math.min(Math.max(8, rect.left), window.innerWidth - tooltipWidth - 8);
  tooltip.style.left = clampedLeft + 'px';
  tooltip.style.top = '';
  tooltip.style.bottom = '';
  const spaceBelow = window.innerHeight - rect.bottom;
  if (spaceBelow >= 70) {
    tooltip.style.top = (rect.bottom + 10) + 'px';
  } else {
    tooltip.style.bottom = (window.innerHeight - rect.top + 10) + 'px';
  }

  let dismissed = false;
  function dismiss() {
    if (dismissed) return;
    dismissed = true;
    spotlight.classList.add('hidden');
    tooltip.classList.add('hidden');
    document.removeEventListener('click', dismiss);
  }

  const timer = setTimeout(dismiss, 3000);
  setTimeout(() => document.addEventListener('click', dismiss, { once: true }), 200);
  spotlight.addEventListener('click', () => { clearTimeout(timer); dismiss(); }, { once: true });
}

// ── Release Log ────────────────────────────────────────
const RELEASE_LOG = [
  {
    version: '3.1',
    date: '2026-04-26',
    badge: '穩定性修復',
    groups: [
      {
        label: '改進',
        items: [
          '儲存失敗時顯示提示，避免資料無聲遺失',
          '還原刪除項目時不再因資料夾不存在而阻擋操作',
          '新增 unlimitedStorage 權限，避免長期使用後空間不足',
        ]
      },
    ]
  },
  {
    version: '3.0',
    date: '2026-04-18',
    badge: '功能更新',
    groups: [
      {
        label: '新功能',
        items: [
          '刪除紀錄：自動保留最近 10 筆刪除的資料夾或文字，可一鍵還原或移除紀錄',
          '匯入模式選擇：匯入時可選擇「覆蓋現有資料」或「加入現有資料」',
          '功能導覽：提供文字說明與 Spotlight 示範動畫，協助快速了解各功能位置',
        ]
      },
      {
        label: '介面優化',
        items: [
          '標籤區固定於左側欄底部，不再因資料夾過多而被擠出可視範圍',
          '工具列上移、下移、隱藏按鈕改為 SVG 圖示，視覺更清晰',
          '隱藏狀態以眼睛／眼睛斜線圖示區分，語意更直觀',
        ]
      },
      {
        label: '安全性強化',
        items: [
          'ID 生成改用 crypto.randomUUID()，消除碰撞風險',
          '新增資料夾最大深度限制（3 層），並於匯入時同步驗證',
        ]
      },
    ]
  },
  {
    version: '2.0',
    date: '2026-04-15',
    badge: '功能更新',
    groups: [
      {
        label: '新功能',
        items: [
          '左側新增「所有文字」可點選項目，快速切換全域瀏覽',
          '搜尋範圍切換：所有文字模式跨資料夾搜尋，選擇資料夾時限定範圍內搜尋',
          '匯入資料前新增確認提示，顯示現有資料筆數，防止誤覆蓋',
        ]
      },
      {
        label: '修正',
        items: [
          '新增文字時移除根目錄選項，文字必須存放於資料夾中避免遺失',
        ]
      },
      {
        label: '體驗優化',
        items: [
          '記憶上次瀏覽頁面',
          '匯入確認視窗同時顯示現有與匯入資料筆數',
        ]
      },
    ]
  },
  {
    version: '1.0',
    date: '2026-04-12',
    badge: '初始版本',
    groups: [
      {
        label: '主要功能',
        items: [
          '一鍵複製常用文字到剪貼簿',
          '新增/編輯/刪除資料夾與文字',
          '搜尋功能',
        ]
      },
      {
        label: '分類功能',
        items: [
          '資料夾、標籤系統',
          '資料夾排序（↑↓）與隱藏功能',
        ]
      },
      {
        label: '記憶功能',
        items: [
          '最近複製紀錄（最近10筆）',
        ]
      },
      {
        label: '備份功能',
        items: [
          '匯入/匯出（JSON 格式）',
        ]
      },
    ]
  }
];

function openReleaseLog() {
  const content = document.getElementById('release-log-content');
  content.innerHTML = '';
  RELEASE_LOG.forEach((entry, idx) => {
    const div = document.createElement('div');
    div.className = 'release-entry';

    const groupsHtml = (entry.groups || []).map(g => `
      <div class="release-group-label">${escHtml(g.label)}</div>
      <ul class="release-items">
        ${g.items.map(item => `<li>${escHtml(item)}</li>`).join('')}
      </ul>
    `).join('');

    div.innerHTML = `
      <div class="release-header">
        <span class="release-version">v${escHtml(entry.version)}</span>
        <span class="release-date">${escHtml(entry.date)}</span>
        ${entry.badge ? `<span class="release-badge">${escHtml(entry.badge)}</span>` : ''}
      </div>
      ${groupsHtml}
    `;
    content.appendChild(div);
    if (idx < RELEASE_LOG.length - 1) {
      const hr = document.createElement('hr');
      hr.className = 'release-divider';
      content.appendChild(hr);
    }
  });
  document.getElementById('modal-release-log').classList.remove('hidden');
}

// ── Import / Export ────────────────────────────────────
function doExport() {
  const json = JSON.stringify(tree, null, 2);
  document.getElementById('import-textarea').value = json;
  showToast('已匯出到下方文字框');
}

function doImport() {
  const raw = document.getElementById('import-textarea').value.trim();
  if (!raw) return;
  let data;
  try {
    data = JSON.parse(raw);
    if (!Array.isArray(data)) throw new Error('格式錯誤');
  } catch {
    alert('JSON 格式錯誤，請確認資料是否正確。');
    return;
  }
  function checkNodes(nodes, d) {
    for (const n of nodes) {
      if (!n.id || typeof n.id !== 'string') return '節點缺少有效的 id';
      if (n.type !== 'folder' && n.type !== 'text') return '節點 type 必須為 folder 或 text';
      if (n.type === 'folder') {
        if (d > 2) return '資料夾超過 3 層限制';
        if (n.children) {
          const err = checkNodes(n.children, d + 1);
          if (err) return err;
        }
      }
      if (n.type === 'text' && (typeof n.content !== 'string')) return '文字節點缺少 content 欄位';
    }
    return null;
  }
  const validationError = checkNodes(data, 0);
  if (validationError) {
    alert(`匯入失敗：${validationError}，請確認資料格式後重新匯入。`);
    return;
  }
  pendingImportData = data;
  const currentCount = collectTexts(tree, true).length;
  const importCount = collectTexts(data, true).length;
  document.getElementById('confirm-import-msg').innerHTML =
    `目前已有 <strong style="color:#177077">${currentCount} 筆文字</strong>，匯入資料共 <strong style="color:#177077">${importCount} 筆文字</strong>。請選擇匯入方式：`;
  document.getElementById('import-mode-merge').checked = true;
  document.getElementById('modal-confirm-import').classList.remove('hidden');
}

function confirmImport() {
  if (!pendingImportData) return;
  const mode = document.querySelector('input[name="import-mode"]:checked').value;
  if (mode === 'overwrite') {
    tree = pendingImportData;
  } else {
    const imported = JSON.parse(JSON.stringify(pendingImportData));
    reIdNodes(imported);
    tree.push(...imported);
  }
  pendingImportData = null;
  selectedFolderId = '__root__';
  saveTree();
  renderTree();
  renderTextList();
  closeModal('modal-confirm-import');
  closeModal('modal-ie');
  showToast(mode === 'overwrite' ? '匯入成功！' : '資料已加入！');
}

// ── Init ───────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  // Set static SVG icons
  document.getElementById('tb-up').innerHTML = SVG_UP;
  document.getElementById('tb-down').innerHTML = SVG_DOWN;
  document.getElementById('tb-hide').innerHTML = SVG_EYE;
  document.getElementById('btn-toggle-hidden').innerHTML = SVG_EYE_SLASH;

  loadTree(() => {
    renderTree();
    renderTextList();
  });

  initTagInput();

  // Folder toolbar buttons
  document.getElementById('tb-up').addEventListener('click', () => {
    if (!selectedFolderId.startsWith('__')) {
      const found = findNode(tree, selectedFolderId);
      if (found) moveFolderUp(selectedFolderId, found.parent);
    }
  });
  document.getElementById('tb-down').addEventListener('click', () => {
    if (!selectedFolderId.startsWith('__')) {
      const found = findNode(tree, selectedFolderId);
      if (found) moveFolderDown(selectedFolderId, found.parent);
    }
  });
  document.getElementById('tb-hide').addEventListener('click', () => {
    if (!selectedFolderId.startsWith('__')) toggleFolderHidden(selectedFolderId);
  });
  document.getElementById('tb-edit').addEventListener('click', () => {
    if (!selectedFolderId.startsWith('__')) openEditFolderModal(selectedFolderId);
  });
  document.getElementById('tb-delete').addEventListener('click', () => {
    if (!selectedFolderId.startsWith('__')) deleteNode(selectedFolderId);
  });

  document.getElementById('tree-item-all').addEventListener('click', () => {
    selectedFolderId = '__root__';
    document.querySelectorAll('.tree-folder, .tree-tag-item').forEach(el => el.classList.remove('active'));
    document.getElementById('tree-item-all').classList.add('active');
    saveSelectedFolder();
    renderTextList();
  });

  document.getElementById('btn-recent').addEventListener('click', () => {
    selectedFolderId = '__recent__';
    document.querySelectorAll('.tree-folder, .tree-tag-item').forEach(el => el.classList.remove('active'));
    saveSelectedFolder();
    renderTextList();
  });

  document.getElementById('btn-toggle-hidden').addEventListener('click', () => {
    showHidden = !showHidden;
    const toggleBtn = document.getElementById('btn-toggle-hidden');
    toggleBtn.classList.toggle('active', showHidden);
    toggleBtn.innerHTML = showHidden ? SVG_EYE : SVG_EYE_SLASH;
    renderTree();
    renderTextList();
  });

  document.getElementById('btn-add-folder').addEventListener('click', () => {
    const activeFolder = !selectedFolderId.startsWith('__') ? selectedFolderId : null;
    openAddFolderModal(activeFolder);
  });

  document.getElementById('btn-add-text').addEventListener('click', openAddTextModal);

  document.getElementById('btn-folder-save').addEventListener('click', saveFolderModal);
  document.getElementById('folder-name-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') saveFolderModal();
  });

  document.getElementById('btn-text-save').addEventListener('click', saveTextModal);
  document.getElementById('text-content-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.ctrlKey) saveTextModal();
  });

  document.querySelectorAll('.modal-close, .btn-cancel').forEach(btn => {
    btn.addEventListener('click', () => {
      const modalId = btn.dataset.modal;
      if (modalId) closeModal(modalId);
    });
  });

  document.querySelectorAll('.modal-overlay').forEach(overlay => {
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) closeModal(overlay.id);
    });
  });

  document.getElementById('btn-confirm-delete').addEventListener('click', confirmDelete);
  document.getElementById('btn-confirm-import').addEventListener('click', confirmImport);

  document.getElementById('btn-tour').addEventListener('click', () => {
    renderTour();
    document.getElementById('modal-tour').classList.remove('hidden');
  });

  document.getElementById('btn-delete-history').addEventListener('click', () => {
    renderDeleteHistory();
    document.getElementById('modal-delete-history').classList.remove('hidden');
  });

  document.getElementById('btn-release-log').addEventListener('click', openReleaseLog);

  document.getElementById('btn-import-export').addEventListener('click', () => {
    document.getElementById('import-textarea').value = '';
    document.getElementById('modal-ie').classList.remove('hidden');
  });
  document.getElementById('btn-export').addEventListener('click', doExport);
  document.getElementById('btn-import').addEventListener('click', doImport);

  let searchDebounce;
  document.getElementById('search-input').addEventListener('input', (e) => {
    clearTimeout(searchDebounce);
    searchDebounce = setTimeout(() => {
      searchQuery = e.target.value.trim();
      renderTextList();
    }, 300);
  });

});
