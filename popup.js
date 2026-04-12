// ── State ──────────────────────────────────────────────
let tree = [];
let selectedFolderId = '__root__';
let editingNodeId = null;
let searchQuery = '';
let showHidden = false;
let recentCopied = [];    // array of text node IDs (max 10)
let currentTags = [];     // tags being edited in modal
let pendingDeleteId = null;

// ── Utility ────────────────────────────────────────────
function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
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
function saveTree() {
  chrome.storage.local.set({ tree });
}

function saveRecent() {
  chrome.storage.local.set({ recentCopied });
}

function loadTree(cb) {
  chrome.storage.local.get(['tree', 'recentCopied'], (result) => {
    tree = result.tree && result.tree.length > 0 ? result.tree : defaultData();
    recentCopied = result.recentCopied || [];
    cb();
  });
}

function defaultData() {
  return [
    {
      id: genId(), name: '問候語', type: 'folder', expanded: true,
      children: [
        { id: genId(), name: '正式問候', type: 'text', content: '您好，感謝您的聯繫，請問有什麼需要協助的地方？', tags: [] },
        { id: genId(), name: '輕鬆問候', type: 'text', content: '嗨！有什麼我能幫上忙的嗎？', tags: [] },
      ]
    },
    {
      id: genId(), name: '結語', type: 'folder', expanded: false,
      children: [
        { id: genId(), name: '感謝結語', type: 'text', content: '感謝您的耐心等候，祝您有美好的一天！', tags: [] },
      ]
    }
  ];
}

// ── Render: Tree ───────────────────────────────────────
function renderTree() {
  const container = document.getElementById('tree-container');
  container.innerHTML = '';
  renderFolderNodes(tree, container, 0);
  renderTagList();

  document.querySelectorAll('.tree-folder, .tree-item-root, .tree-tag-item').forEach(el => {
    el.classList.remove('active');
  });
  const activeEl = document.querySelector(`[data-id="${CSS.escape(selectedFolderId)}"]`);
  if (activeEl) activeEl.classList.add('active');
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
      renderTextList();
    });
    container.appendChild(el);
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
  } else if (selectedFolderId === '__recent__') {
    title.textContent = '最近複製';
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
      texts = found.node.children
        ? found.node.children.filter(n => n.type === 'text')
        : [];
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
        <button class="text-action-btn btn-edit-text" title="編輯">✏</button>
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
  sel.innerHTML = '<option value="__root__">（根目錄）</option>';
  const folders = flattenFolders(tree);
  for (const f of folders) {
    const opt = document.createElement('option');
    opt.value = f.id;
    opt.textContent = '\u00a0'.repeat(f.depth * 2) + f.name;
    if (f.id === selectedId) opt.selected = true;
    sel.appendChild(opt);
  }
  if (!selectedId || selectedId === '__root__') sel.value = '__root__';
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
  const folders = siblingNodes.filter(n => n.type === 'folder');
  const idx = folders.findIndex(n => n.id === id);
  if (idx <= 0) return;
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

  initTagInput();

  document.getElementById('tree-item-root').addEventListener('click', () => {
    selectedFolderId = '__root__';
    document.querySelectorAll('.tree-folder, .tree-item-root, .tree-tag-item').forEach(el => el.classList.remove('active'));
    document.getElementById('tree-item-root').classList.add('active');
    renderTextList();
  });

  document.getElementById('tree-item-recent').addEventListener('click', () => {
    selectedFolderId = '__recent__';
    document.querySelectorAll('.tree-folder, .tree-item-root, .tree-tag-item').forEach(el => el.classList.remove('active'));
    document.getElementById('tree-item-recent').classList.add('active');
    renderTextList();
  });

  document.getElementById('btn-toggle-hidden').addEventListener('click', () => {
    showHidden = !showHidden;
    document.getElementById('btn-toggle-hidden').classList.toggle('active', showHidden);
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

  document.getElementById('btn-import-export').addEventListener('click', () => {
    document.getElementById('import-textarea').value = '';
    document.getElementById('modal-ie').classList.remove('hidden');
  });
  document.getElementById('btn-export').addEventListener('click', doExport);
  document.getElementById('btn-import').addEventListener('click', doImport);

  document.getElementById('search-input').addEventListener('input', (e) => {
    searchQuery = e.target.value.trim();
    renderTextList();
  });
});
