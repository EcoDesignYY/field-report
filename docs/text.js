(() => {
  'use strict';

  const CONFIG = {
    DB_NAME: 'field-report-draft-db',
    DB_VERSION: 1,
    STORE_NAME: 'draft',
    AUTH_TOKEN_STORAGE_KEY: 'fieldReportAuthToken',
    MIN_TEXT_LENGTH: 10,
    MAX_TEXT_LENGTH: 4000,
    NEXT_PAGE_URL: './capture.html',
    PREVIOUS_PAGE_URL: './input.html'
  };

  const state = { db: null, authToken: '', attachments: [], imageBlob: null };
  const els = {};

  document.addEventListener('DOMContentLoaded', initializePage);

  // ---------------------------------------------------------------------------
  // Page initialization
  // ---------------------------------------------------------------------------

  async function initializePage() {
    collectElements();
    bindEvents();

    state.authToken = getAuthTokenFromUrlOrStorage();
    if (!state.authToken) {
      setFatalState('認証情報がありません。GAS入口から開き直してください。');
      return;
    }

    try {
      state.db = await openDatabase();
      await putDraft('inputMode', 'text');
      await deleteDraft('audioBlob');
      await deleteDraft('audioMeta');

      const textBody = String((await getDraft('textBody')) || '');
      const storedAttachments = await getDraft('attachments');
      state.imageBlob = await getDraft('imageBlob');
      state.attachments = FieldReportAttachments
        .validateCollection(
          Array.isArray(storedAttachments) ? storedAttachments : [],
          state.imageBlob ? state.imageBlob.size : 0
        )
        .items;

      els.textBodyInput.value = textBody;
      els.attachmentFileInput.accept = FieldReportAttachments.ACCEPT;
      renderAll();
      showStatus('', '');
    } catch (error) {
      setFatalState('下書きを読み込めませんでした。\n' + getErrorMessage(error));
    }
  }

  function collectElements() {
    [
      'backButton','helpButton','inputStatusBadge','textBodyInput','characterCount',
      'selectAttachmentsButton','attachmentFileInput','attachmentCount','attachmentUsage',
      'attachmentList','attachmentEmpty','nextButton','statusBox'
    ].forEach(id => { els[id] = document.getElementById(id); });

    const missing = Object.keys(els).filter(id => !els[id]);
    if (missing.length) throw new Error('text.html に必要な要素がありません: ' + missing.join(', '));
  }

  function bindEvents() {
    els.backButton.addEventListener('click', () => { location.href = CONFIG.PREVIOUS_PAGE_URL; });
    els.helpButton.addEventListener('click', () => {
      showStatus(
        '本文は10文字以上入力してください。添付は最大5件、撮影画像を含む合計12MiBまでです。',
        'info'
      );
    });
    els.textBodyInput.addEventListener('input', renderTextState);
    els.selectAttachmentsButton.addEventListener('click', () => els.attachmentFileInput.click());
    els.attachmentFileInput.addEventListener('change', handleAttachmentSelection);
    els.nextButton.addEventListener('click', saveAndGoNext);
  }

  async function handleAttachmentSelection(event) {
    const selected = Array.from(event.target.files || []);
    event.target.value = '';
    if (!selected.length) return;

    try {
      const next = state.attachments.slice();
      selected.forEach(file => next.push(FieldReportAttachments.fromFile(file)));
      state.attachments = FieldReportAttachments
        .validateCollection(next, state.imageBlob ? state.imageBlob.size : 0)
        .items;
      await putDraft('attachments', state.attachments);
      renderAttachmentState();
      showStatus('添付ファイルを追加しました。', 'success');
    } catch (error) {
      showStatus(getErrorMessage(error), 'error');
    }
  }

  async function removeAttachment(id) {
    state.attachments = state.attachments.filter(item => item.id !== id);
    await putDraft('attachments', state.attachments);
    renderAttachmentState();
    showStatus('添付ファイルを削除しました。', 'info');
  }

  function renderAll() {
    renderTextState();
    renderAttachmentState();
  }

  function renderTextState() {
    const length = els.textBodyInput.value.length;
    els.characterCount.textContent = length + ' / ' + CONFIG.MAX_TEXT_LENGTH;
    els.nextButton.disabled = length < CONFIG.MIN_TEXT_LENGTH;
    els.inputStatusBadge.textContent = length >= CONFIG.MIN_TEXT_LENGTH
      ? '入力内容を保存できます'
      : '10文字以上入力';
    const statusClass = length >= CONFIG.MIN_TEXT_LENGTH
      ? 'status-ready'
      : 'status-error';
    els.inputStatusBadge.className = 'status-badge ' + statusClass;
  }

  function renderAttachmentState() {
    const result = FieldReportAttachments.validateCollection(
      state.attachments,
      state.imageBlob ? state.imageBlob.size : 0
    );
    els.attachmentCount.textContent = state.attachments.length + ' / ' + FieldReportAttachments.MAX_FILES + '件';
    els.attachmentUsage.textContent = FieldReportAttachments.formatBytes(result.totalBytes) + ' / 12 MiB';
    els.attachmentEmpty.classList.toggle('hidden', state.attachments.length > 0);
    els.attachmentList.innerHTML = state.attachments.map(item => `
      <div class="attachment-item">
        <div>
          <div class="attachment-name">${escapeHtml(item.fileName)}</div>
          <div class="attachment-meta">
            ${escapeHtml(categoryLabel(item.category))}・
            ${escapeHtml(item.extension.toUpperCase())}・
            ${escapeHtml(FieldReportAttachments.formatBytes(item.size))}
          </div>
        </div>
        <button type="button" class="remove-attachment" data-remove-id="${escapeHtml(item.id)}">削除</button>
      </div>
    `).join('');

    els.attachmentList.querySelectorAll('[data-remove-id]').forEach(button => {
      button.addEventListener('click', () => removeAttachment(button.dataset.removeId));
    });
  }

  // ---------------------------------------------------------------------------
  // Draft persistence and navigation
  // ---------------------------------------------------------------------------

  async function saveAndGoNext() {
    const body = els.textBodyInput.value.trim();
    if (body.length < CONFIG.MIN_TEXT_LENGTH) {
      showStatus('問題内容を10文字以上入力してください。', 'error');
      return;
    }

    try {
      const checked = FieldReportAttachments.validateCollection(
        state.attachments,
        state.imageBlob ? state.imageBlob.size : 0
      );
      await putDraft('inputMode', 'text');
      await putDraft('textBody', body);
      await putDraft('textMeta', {
        length: body.length,
        savedAt: new Date().toISOString(),
        attachmentCount: checked.items.length,
        attachmentBytes: checked.items.reduce((sum, item) => sum + item.size, 0)
      });
      await putDraft('attachments', checked.items);
      location.href = CONFIG.NEXT_PAGE_URL;
    } catch (error) {
      showStatus('入力内容を保存できませんでした。\n' + getErrorMessage(error), 'error');
    }
  }

  function categoryLabel(category) {
    const labels = {
      document: '文書・コード',
      image: '画像',
      audio: '音声',
      video: '動画'
    };

    return labels[category] || 'ファイル';
  }

  function setFatalState(message) {
    els.nextButton.disabled = true;
    els.selectAttachmentsButton.disabled = true;
    els.textBodyInput.disabled = true;
    showStatus(message, 'error');
  }

  function showStatus(message, type) {
    if (!message) {
      els.statusBox.className = 'status-box hidden';
      els.statusBox.textContent = '';
      return;
    }
    els.statusBox.className = 'status-box ' + (type || 'info');
    els.statusBox.textContent = message;
  }

  function getAuthTokenFromUrlOrStorage() {
    const url = new URL(location.href);
    const tokenFromUrl = url.searchParams.get('token');
    if (tokenFromUrl) {
      sessionStorage.setItem(CONFIG.AUTH_TOKEN_STORAGE_KEY, tokenFromUrl);
      sessionStorage.setItem('fieldReportToken', tokenFromUrl);
      url.searchParams.delete('token');
      history.replaceState({}, document.title, url.pathname + url.search + url.hash);
      return tokenFromUrl;
    }
    return sessionStorage.getItem(CONFIG.AUTH_TOKEN_STORAGE_KEY) || sessionStorage.getItem('fieldReportToken') || '';
  }

  // ---------------------------------------------------------------------------
  // IndexedDB and generic utilities
  // ---------------------------------------------------------------------------

  function openDatabase() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(CONFIG.DB_NAME, CONFIG.DB_VERSION);
      request.onupgradeneeded = event => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains(CONFIG.STORE_NAME)) db.createObjectStore(CONFIG.STORE_NAME);
      };
      request.onsuccess = event => resolve(event.target.result);
      request.onerror = event => reject(event.target.error);
    });
  }

  function getDraft(key) { return runStoreRequest('readonly', store => store.get(key)); }
  function putDraft(key, value) { return runStoreRequest('readwrite', store => store.put(value, key)); }
  function deleteDraft(key) { return runStoreRequest('readwrite', store => store.delete(key)); }
  function runStoreRequest(mode, requestFactory) {
    return new Promise((resolve, reject) => {
      const transaction = state.db.transaction(CONFIG.STORE_NAME, mode);
      const request = requestFactory(transaction.objectStore(CONFIG.STORE_NAME));
      request.onsuccess = () => resolve(request.result);
      request.onerror = event => reject(event.target.error);
    });
  }

  function escapeHtml(value) {
    const entities = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      "'": '&#39;',
      '"': '&quot;'
    };

    return String(value || '').replace(
      /[&<>'"]/g,
      (character) => entities[character]
    );
  }
  function getErrorMessage(error) {
    return error && error.message
      ? String(error.message)
      : String(error || '不明なエラーです。');
  }
})();
