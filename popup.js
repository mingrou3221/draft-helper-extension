// ── State ──────────────────────────────────────────────
let tree = [];           // root array of folder/text nodes
let selectedFolderId = '__root__';  // currently selected folder in tree
let editingNodeId = null;           // node being edited
let searchQuery = '';
let showHidden = false;             // whether to show hidden folders

// ── Utility ────────────────────────────────────────────
function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

// Find a node by id anywhere in tree; also returns parent array and index
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

// Collect all text nodes under a folder (recursive); respects hidden state
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

// Get children of a folder id (__root__ = tree root)
function getChildren(id) {
  if (id === '__root__') return tree;
  const found = findNode(tree, id);
  return found ? (found.node.children || []) : [];
}

// Flatten folders for <select>
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
function saveTree() {
  chrome.storage.local.set({ tree });
}

function loadTree(cb) {
  chrome.storage.local.get(['tree'], (result) => {
    if (result.tree && result.tree.length > 0) {
      tree = result.tree;
    } else {
      tree = defaultData();
    }
    cb();
  });
}

function defaultData() {
  return [
    {
      id: genId(), name: '問候語', type: 'folder', expanded: true,
      children: [
        { id: genId(), name: '正式問候', type: 'text', content: '您好，感謝您的聯繫，請問有什麼需要協助的地方？' },
        { id: genId(), name: '輕鬆問候', type: 'text', content: '嗨！有什麼我能幫上忙的嗎？' },
      ]
    },
    {
      id: genId(), name: '結語', type: 'folder', expanded: false,
      children: [
        { id: genId(), name: '感謝結語', type: 'text', content: '感謝您的耐心等候，祝您有美好的一天！' },
      ]
    }
  ];
}

// ── Render: Tree ───────────────────────────────────────
function renderTree() {
  const container = document.getElementById('tree-container');
  container.innerHTML = '';
  renderFolderNodes(tree, container, 0);

  // mark active
  document.querySelectorAll('.tree-folder, .tree-item-root').forEach(el => {
    el.classList.remove('active');
  });
  const activeEl = document.querySelector(`[data-id="${CSS.escape(selectedFolderId)}"]`);
  if (activeEl) activeEl.classList.add('active');
}

function renderFolderNodes(nodes, container, depth) {
  // Only count folder siblings for up/down boundary check
  const folderSiblings = nodes.filter(n => n.type === 'folder');

  for (const node of nodes) {
    if (node.type !== 'folder') continue;

    // Skip hidden folders unless showHidden is on
    if (node.hidden && !showHidden) continue;

    const wrapper = document.createElement('div');
    wrapper.className = 'tree-folder-row' + (node.hidden ? ' folder-hidden-row' : '');

    const folderEl = document.createElement('div');
    folderEl.className = 'tree-folder' + (node.expanded ? ' expanded' : '');
    folderEl.dataset.id = node.id;
    folderEl.style.paddingLeft = (8 + depth * 14) + 'px';

    const sibIdx = folderSiblings.indexOf(node);
    const isFirst = sibIdx === 0;
    const isLast = sibIdx === folderSiblings.length - 1;

    folderEl.innerHTML = `
      <span class="folder-arrow">▶</span>
      <span class="folder-icon">📁</span>
      <span class="folder-name" title="${escHtml(node.name)}">${escHtml(node.name)}</span>
      <span class="folder-actions">
        <button class="folder-btn" data-action="up" title="上移" ${isFirst ? 'disabled style="opacity:0.3"' : ''}>↑</button>
        <button class="folder-btn" data-action="down" title="下移" ${isLast ? 'disabled style="opacity:0.3"' : ''}>↓</button>
        <button class="folder-btn" data-action="hide" title="${node.hidden ? '取消隱藏' : '隱藏'}">${node.hidden ? '🙈' : '👀'}</button>
        <button class="folder-btn" data-action="edit" title="編輯">✏</button>
        <button class="folder-btn del" data-action="delete" title="刪除">🗑</button>
      </span>
    `;

    folderEl.addEventListener('click', (e) => {
      if (e.target.closest('[data-action]')) return;
      e.stopPropagation();
      node.expanded = !node.expanded;
      selectedFolderId = node.id;
      saveTree();
      renderTree();
      renderTextList();
    });

    folderEl.querySelector('[data-action="up"]').addEventListener('click', (e) => {
      e.stopPropagation();
      moveFolderUp(node.id, nodes);
    });

    folderEl.querySelector('[data-action="down"]').addEventListener('click', (e) => {
      e.stopPropagation();
      moveFolderDown(node.id, nodes);
    });

    folderEl.querySelector('[data-action="hide"]').addEventListener('click', (e) => {
      e.stopPropagation();
      toggleFolderHidden(node.id);
    });

    folderEl.querySelector('[data-action="edit"]').addEventListener('click', (e) => {
      e.stopPropagation();
      openEditFolderModal(node.id);
    });

    folderEl.querySelector('[data-action="delete"]').addEventListener('click', (e) => {
      e.stopPropagation();
      deleteNode(node.id);
    });

    wrapper.appendChild(folderEl);

    // Children
    const childContainer = document.createElement('div');
    childContainer.className = 'tree-children' + (node.expanded ? ' visible' : '');
    if (node.children && node.children.length > 0) {
      renderFolderNodes(node.children, childContainer, depth + 1);
    }
    wrapper.appendChild(childContainer);
    container.appendChild(wrapper);
  }
}

// ── Render: Text List ──────────────────────────────────
function renderTextList() {
  const list = document.getElementById('text-list');
  const title = document.getElementById('content-title');
  list.innerHTML = '';

  let texts = [];
  if (selectedFolderId === '__root__') {
    title.textContent = '所有文字';
    texts = collectTexts(tree, showHidden);
  } else {
    const found = findNode(tree, selectedFolderId);
    if (found) {
      title.textContent = found.node.name;
      texts = found.node.children
        ? found.node.children.filter(n => n.type === 'text')
        : [];
    }
  }

  // Filter by search
  if (searchQuery) {
    const q = searchQuery.toLowerCase();
    texts = texts.filter(t =>
      (t.name && t.name.toLowerCase().includes(q)) ||
      (t.content && t.content.toLowerCase().includes(q))
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
    item.innerHTML = `
      <div class="text-item-body">
        ${hasTitle ? `<div class="text-item-name">${escHtml(t.name)}</div>` : ''}
        <div class="text-item-content">${escHtml(t.content)}</div>
      </div>
      <div class="text-item-actions">
        <button class="text-action-btn btn-edit-text" title="編輯">✏</button>
        <button class="text-action-btn btn-del-text" title="刪除">🗑</button>
      </div>
      <div class="copy-indicator">已複製！</div>
    `;

    // Click item body → copy
    item.querySelector('.text-item-body').addEventListener('click', () => copyText(t, item));

    // Edit button
    item.querySelector('.btn-edit-text').addEventListener('click', (e) => {
      e.stopPropagation();
      openEditTextModal(t.id);
    });

    // Delete button
    item.querySelector('.btn-del-text').addEventListener('click', (e) => {
      e.stopPropagation();
      deleteNode(t.id);
    });

    list.appendChild(item);
  }
}

// ── Copy ───────────────────────────────────────────────
function copyText(node, itemEl) {
  navigator.clipboard.writeText(node.content).then(() => {
    itemEl.classList.add('copied');
    showToast('已複製！');
    setTimeout(() => itemEl.classList.remove('copied'), 1200);
  }).catch(() => {
    // Fallback
    const ta = document.createElement('textarea');
    ta.value = node.content;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
    itemEl.classList.add('copied');
    showToast('已複製！');
    setTimeout(() => itemEl.classList.remove('copied'), 1200);
  });
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
    // Edit
    const found = findNode(tree, editingNodeId);
    if (found) { found.node.name = name; }
  } else {
    // Add
    const newFolder = { id: genId(), name, type: 'folder', expanded: false, children: [] };
    const parentId = document.getElementById('btn-folder-save').dataset.parentId;
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
  document.getElementById('modal-text-title').textContent = '新增文字';
  document.getElementById('text-name-input').value = '';
  document.getElementById('text-content-input').value = '';
  populateFolderSelect(selectedFolderId !== '__root__' ? selectedFolderId : null);
  document.getElementById('modal-text').classList.remove('hidden');
  document.getElementById('text-content-input').focus();
}

function openEditTextModal(id) {
  const found = findNode(tree, id);
  if (!found) return;
  editingNodeId = id;
  document.getElementById('modal-text-title').textContent = '編輯文字';
  document.getElementById('text-name-input').value = found.node.name || '';
  document.getElementById('text-content-input').value = found.node.content || '';

  // Find parent folder of this text
  const parentFolder = findParentFolder(tree, id);
  populateFolderSelect(parentFolder);
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
  sel.innerHTML = '<option value="__root__">（根目錄）</option>';
  const folders = flattenFolders(tree);
  for (const f of folders) {
    const opt = document.createElement('option');
    opt.value = f.id;
    opt.textContent = '\u00a0'.repeat(f.depth * 2) + f.name;
    if (f.id === selectedId) opt.selected = true;
    sel.appendChild(opt);
  }
  if (!selectedId || selectedId === '__root__') {
    sel.value = '__root__';
  }
}

function saveTextModal() {
  const name = document.getElementById('text-name-input').value.trim();
  const content = document.getElementById('text-content-input').value.trim();
  const folderId = document.getElementById('text-folder-select').value;

  if (!content) { document.getElementById('text-content-input').focus(); return; }

  if (editingNodeId) {
    // Edit: update in place (may move to different folder)
    const oldParent = findParentFolder(tree, editingNodeId);
    const found = findNode(tree, editingNodeId);
    if (!found) return;

    // If folder changed, move node
    const newFolderId = folderId;
    if (oldParent !== newFolderId) {
      // Remove from old location
      found.parent.splice(found.index, 1);
      // Update content
      found.node.name = name;
      found.node.content = content;
      // Insert in new location
      insertTextNode(found.node, newFolderId);
    } else {
      found.node.name = name;
      found.node.content = content;
    }
  } else {
    const newText = { id: genId(), name, type: 'text', content };
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

// ── Folder Order & Visibility ──────────────────────────
function moveFolderUp(id, siblingNodes) {
  const folders = siblingNodes.filter(n => n.type === 'folder');
  const idx = folders.findIndex(n => n.id === id);
  if (idx <= 0) return;
  // Swap in the actual parent array (siblingNodes)
  const aIdx = siblingNodes.indexOf(folders[idx]);
  const bIdx = siblingNodes.indexOf(folders[idx - 1]);
  [siblingNodes[aIdx], siblingNodes[bIdx]] = [siblingNodes[bIdx], siblingNodes[aIdx]];
  saveTree();
  renderTree();
}

function moveFolderDown(id, siblingNodes) {
  const folders = siblingNodes.filter(n => n.type === 'folder');
  const idx = folders.findIndex(n => n.id === id);
  if (idx === -1 || idx >= folders.length - 1) return;
  const aIdx = siblingNodes.indexOf(folders[idx]);
  const bIdx = siblingNodes.indexOf(folders[idx + 1]);
  [siblingNodes[aIdx], siblingNodes[bIdx]] = [siblingNodes[bIdx], siblingNodes[aIdx]];
  saveTree();
  renderTree();
}

function toggleFolderHidden(id) {
  const found = findNode(tree, id);
  if (!found) return;
  found.node.hidden = !found.node.hidden;
  // If hiding the currently selected folder, go back to root
  if (found.node.hidden && selectedFolderId === id) selectedFolderId = '__root__';
  saveTree();
  renderTree();
  renderTextList();
}

// ── Delete ─────────────────────────────────────────────
let pendingDeleteId = null;

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
    found.parent.splice(found.index, 1);
    if (selectedFolderId === pendingDeleteId) selectedFolderId = '__root__';
    saveTree();
    renderTree();
    renderTextList();
  }
  pendingDeleteId = null;
  closeModal('modal-confirm');
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

// ── Import / Export ────────────────────────────────────
function doExport() {
  const json = JSON.stringify(tree, null, 2);
  document.getElementById('import-textarea').value = json;
  showToast('已匯出到下方文字框');
}

function doImport() {
  const raw = document.getElementById('import-textarea').value.trim();
  if (!raw) return;
  try {
    const data = JSON.parse(raw);
    if (!Array.isArray(data)) throw new Error('格式錯誤');
    tree = data;
    selectedFolderId = '__root__';
    saveTree();
    renderTree();
    renderTextList();
    closeModal('modal-ie');
    showToast('匯入成功！');
  } catch {
    alert('JSON 格式錯誤，請確認資料是否正確。');
  }
}

// ── Init ───────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  loadTree(() => {
    renderTree();
    renderTextList();
  });

  // Root tree item click
  document.getElementById('tree-item-root').addEventListener('click', () => {
    selectedFolderId = '__root__';
    document.querySelectorAll('.tree-folder, .tree-item-root').forEach(el => el.classList.remove('active'));
    document.getElementById('tree-item-root').classList.add('active');
    renderTextList();
  });

  // Toggle hidden folders visibility
  document.getElementById('btn-toggle-hidden').addEventListener('click', () => {
    showHidden = !showHidden;
    document.getElementById('btn-toggle-hidden').classList.toggle('active', showHidden);
    renderTree();
    renderTextList();
  });

  // Add folder button
  document.getElementById('btn-add-folder').addEventListener('click', () => {
    openAddFolderModal(selectedFolderId !== '__root__' ? selectedFolderId : null);
  });

  // Add text button
  document.getElementById('btn-add-text').addEventListener('click', () => {
    openAddTextModal();
  });

  // Save folder
  document.getElementById('btn-folder-save').addEventListener('click', saveFolderModal);
  document.getElementById('folder-name-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') saveFolderModal();
  });

  // Save text
  document.getElementById('btn-text-save').addEventListener('click', saveTextModal);
  document.getElementById('text-content-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.ctrlKey) saveTextModal();
  });

  // Close modals
  document.querySelectorAll('.modal-close, .btn-cancel').forEach(btn => {
    btn.addEventListener('click', () => {
      const modalId = btn.dataset.modal;
      if (modalId) closeModal(modalId);
    });
  });

  // Click outside modal closes it
  document.querySelectorAll('.modal-overlay').forEach(overlay => {
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) closeModal(overlay.id);
    });
  });

  // Confirm delete
  document.getElementById('btn-confirm-delete').addEventListener('click', confirmDelete);

  // Import/Export
  document.getElementById('btn-import-export').addEventListener('click', () => {
    document.getElementById('import-textarea').value = '';
    document.getElementById('modal-ie').classList.remove('hidden');
  });
  document.getElementById('btn-export').addEventListener('click', doExport);
  document.getElementById('btn-import').addEventListener('click', doImport);

  // Search
  document.getElementById('search-input').addEventListener('input', (e) => {
    searchQuery = e.target.value.trim();
    renderTextList();
  });
});
