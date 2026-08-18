(() => {
  'use strict';

  // ---------------------------------------------------------------------------
  // Attachment rules
  //
  // This page keeps its own local copy of the attachment validator. The three
  // pages that use attachments are intentionally self-contained so deployment
  // does not depend on a separate script loading before the page script.
  // ---------------------------------------------------------------------------

  const FieldReportAttachments = createFieldReportAttachments();

  function createFieldReportAttachments() {
    const MAX_FILES = 5;
    const MAX_FILE_BYTES = 12 * 1024 * 1024;
    const MAX_TOTAL_BYTES = 12 * 1024 * 1024;

    const DEFINITIONS = {
      pdf:  { category: 'document', mimes: ['application/pdf'] },
      txt:  { category: 'document', mimes: ['text/plain'] },
      html: { category: 'document', mimes: ['text/html'] },
      htm:  { category: 'document', mimes: ['text/html'] },
      css:  { category: 'document', mimes: ['text/css'] },
      js: {
        category: 'document',
        mimes: [
          'text/javascript',
          'application/javascript',
          'application/x-javascript'
        ]
      },
      ts: {
        category: 'document',
        mimes: [
          'text/x-typescript',
          'application/x-typescript',
          'text/plain'
        ]
      },
      csv: {
        category: 'document',
        mimes: [
          'text/csv',
          'application/csv',
          'text/plain'
        ]
      },
      md: {
        category: 'document',
        mimes: ['text/markdown', 'text/plain']
      },
      py: {
        category: 'document',
        mimes: [
          'text/x-python',
          'application/x-python-code',
          'text/plain'
        ]
      },
      json: {
        category: 'document',
        mimes: [
          'application/json',
          'text/json',
          'text/plain'
        ]
      },
      xml: {
        category: 'document',
        mimes: [
          'application/xml',
          'text/xml',
          'text/plain'
        ]
      },
      rtf: {
        category: 'document',
        mimes: ['application/rtf', 'text/rtf']
      },

      jpeg: { category: 'image', mimes: ['image/jpeg'] },
      jpg:  { category: 'image', mimes: ['image/jpeg'] },
      png:  { category: 'image', mimes: ['image/png'] },
      webp: { category: 'image', mimes: ['image/webp'] },
      heic: {
        category: 'image',
        mimes: ['image/heic', 'image/heic-sequence']
      },
      heif: {
        category: 'image',
        mimes: ['image/heif', 'image/heif-sequence']
      },

      wav: {
        category: 'audio',
        mimes: ['audio/wav', 'audio/x-wav']
      },
      mp3: {
        category: 'audio',
        mimes: ['audio/mpeg', 'audio/mp3']
      },
      aiff: {
        category: 'audio',
        mimes: ['audio/aiff', 'audio/x-aiff']
      },
      aif: {
        category: 'audio',
        mimes: ['audio/aiff', 'audio/x-aiff']
      },
      aac: {
        category: 'audio',
        mimes: ['audio/aac', 'audio/x-aac']
      },
      ogg: {
        category: 'audio',
        mimes: ['audio/ogg', 'application/ogg']
      },
      flac: {
        category: 'audio',
        mimes: ['audio/flac', 'audio/x-flac']
      },

      mp4:  { category: 'video', mimes: ['video/mp4'] },
      mpeg: { category: 'video', mimes: ['video/mpeg'] },
      mpg:  { category: 'video', mimes: ['video/mpeg'] },
      mov:  { category: 'video', mimes: ['video/quicktime'] },
      avi: {
        category: 'video',
        mimes: ['video/x-msvideo', 'video/avi']
      },
      flv:  { category: 'video', mimes: ['video/x-flv'] },
      webm: { category: 'video', mimes: ['video/webm'] },
      wmv:  { category: 'video', mimes: ['video/x-ms-wmv'] },
      '3gp':  { category: 'video', mimes: ['video/3gpp'] },
      '3gpp': { category: 'video', mimes: ['video/3gpp'] }
    };

    const ACCEPT = Object.keys(DEFINITIONS)
      .map(extension => '.' + extension)
      .join(',');

    function extensionOf(fileName) {
      const value = String(fileName || '').trim();
      const index = value.lastIndexOf('.');

      return index >= 0
        ? value.slice(index + 1).toLowerCase()
        : '';
    }

    function sanitizeFileName(fileName) {
      const value = String(fileName || '').trim();

      if (!value) {
        throw new Error('ファイル名がありません。');
      }

      if (/[\\/:*?"<>|\u0000-\u001f]/.test(value)) {
        throw new Error(
          'ファイル名に使用できない文字が含まれています: ' + value
        );
      }

      return value.slice(0, 180);
    }

    function validateFile(file) {
      if (!file) {
        throw new Error('ファイルを読み込めませんでした。');
      }

      const fileName = sanitizeFileName(
        file.name || file.fileName || ''
      );
      const extension = extensionOf(fileName);
      const definition = DEFINITIONS[extension];
      const size = Number(file.size || 0);
      const mimeType = String(file.type || file.mimeType || '')
        .toLowerCase()
        .trim();

      if (!definition) {
        throw new Error(
          '対応していないファイル形式です: ' + fileName
        );
      }

      if (size <= 0) {
        throw new Error(
          '0バイトのファイルは添付できません: ' + fileName
        );
      }

      if (size > MAX_FILE_BYTES) {
        throw new Error(
          '1ファイルの上限12MiBを超えています: ' + fileName
        );
      }

      const canUseExtensionOnly =
        !mimeType || mimeType === 'application/octet-stream';

      if (
        !canUseExtensionOnly &&
        definition.mimes.indexOf(mimeType) === -1
      ) {
        throw new Error(
          '拡張子とファイル形式が一致しません: ' +
          fileName +
          ' (' + mimeType + ')'
        );
      }

      return {
        fileName,
        extension,
        mimeType: mimeType || definition.mimes[0],
        category: definition.category,
        size
      };
    }

    function createId() {
      const cryptoApi = window.crypto || null;

      if (
        cryptoApi &&
        typeof cryptoApi.randomUUID === 'function'
      ) {
        return cryptoApi.randomUUID();
      }

      return (
        'ATT-' +
        Date.now() +
        '-' +
        Math.random().toString(36).slice(2, 10)
      );
    }

    function normalizeStoredAttachment(item) {
      if (!item) {
        return null;
      }

      const blob = item.blob || item.file || null;
      const checked = validateFile({
        name: item.fileName || item.name || (blob && blob.name) || '',
        size: item.size || (blob && blob.size) || 0,
        type: item.mimeType || (blob && blob.type) || ''
      });

      return {
        id: String(item.id || createId()),
        fileName: checked.fileName,
        extension: checked.extension,
        mimeType: checked.mimeType,
        category: checked.category,
        size: checked.size,
        addedAt: item.addedAt || new Date().toISOString(),
        blob
      };
    }

    function fromFile(file) {
      const checked = validateFile(file);

      return {
        id: createId(),
        fileName: checked.fileName,
        extension: checked.extension,
        mimeType: checked.mimeType,
        category: checked.category,
        size: checked.size,
        addedAt: new Date().toISOString(),
        blob: file
      };
    }

    function validateCollection(items, extraBytes = 0) {
      const normalized = (Array.isArray(items) ? items : [])
        .map(normalizeStoredAttachment)
        .filter(Boolean);

      if (normalized.length > MAX_FILES) {
        throw new Error('添付できるファイルは最大5件です。');
      }

      const attachmentBytes = normalized.reduce(
        (sum, item) => sum + item.size,
        0
      );
      const totalBytes = attachmentBytes + Number(extraBytes || 0);

      if (totalBytes > MAX_TOTAL_BYTES) {
        throw new Error(
          '添付ファイルと撮影画像の合計が12MiBを超えています。'
        );
      }

      return {
        items: normalized,
        totalBytes
      };
    }

    function toMetadata(item, uploadedFile) {
      const url = uploadedFile &&
        (uploadedFile.webViewLink || uploadedFile.url)
        ? (uploadedFile.webViewLink || uploadedFile.url)
        : '';

      return {
        fileId: uploadedFile && uploadedFile.id
          ? uploadedFile.id
          : '',
        fileName: item.fileName,
        extension: item.extension,
        mimeType: uploadedFile && uploadedFile.mimeType
          ? uploadedFile.mimeType
          : item.mimeType,
        size: item.size,
        category: item.category,
        url
      };
    }

    function formatBytes(bytes) {
      const value = Number(bytes || 0);

      if (value < 1024) {
        return value + ' B';
      }

      if (value < 1024 * 1024) {
        return (value / 1024).toFixed(1) + ' KiB';
      }

      return (value / 1024 / 1024).toFixed(1) + ' MiB';
    }

    return Object.freeze({
      MAX_FILES,
      MAX_FILE_BYTES,
      MAX_TOTAL_BYTES,
      DEFINITIONS,
      ACCEPT,
      extensionOf,
      validateFile,
      validateCollection,
      normalizeStoredAttachment,
      fromFile,
      toMetadata,
      formatBytes
    });
  }


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
        '本文10文字以上、または関連ファイル1件以上で次へ進めます。添付は最大5件、撮影画像を含む合計12MiBまでです。',
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
    const hasAttachments = state.attachments.length > 0;
    const canContinue = length >= CONFIG.MIN_TEXT_LENGTH || hasAttachments;
    els.nextButton.disabled = !canContinue;
    els.inputStatusBadge.textContent = canContinue
      ? (length >= CONFIG.MIN_TEXT_LENGTH ? '入力内容を保存できます' : 'ファイルのみで投稿できます')
      : '本文10文字以上 または ファイル添付';
    const statusClass = canContinue
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

    renderTextState();
  }

  // ---------------------------------------------------------------------------
  // Draft persistence and navigation
  // ---------------------------------------------------------------------------

  async function saveAndGoNext() {
    const body = els.textBodyInput.value.trim();
    if (body.length < CONFIG.MIN_TEXT_LENGTH && !state.attachments.length) {
      showStatus('問題内容を10文字以上入力するか、関連ファイルを1件以上添付してください。', 'error');
      return;
    }

    try {
      const checked = FieldReportAttachments.validateCollection(
        state.attachments,
        state.imageBlob ? state.imageBlob.size : 0
      );
      const inputMode = body ? 'text' : 'file';
      await putDraft('inputMode', inputMode);
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
