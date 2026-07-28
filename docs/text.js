(() => {
  'use strict';

  const CONFIG = {
    DB_NAME: 'field-report-draft-db',
    DB_VERSION: 1,
    STORE_NAME: 'draft',
    AUTH_TOKEN_STORAGE_KEY: 'fieldReportAuthToken',
    MIN_LENGTH: 10,
    MAX_LENGTH: 4000,
    NEXT_PAGE_URL: './capture.html',
    PREVIOUS_PAGE_URL: './input.html'
  };

  const state = {
    authToken: '',
    db: null,
    isSaving: false
  };

  const elements = {};

  document.addEventListener('DOMContentLoaded', initializePage);

  async function initializePage() {
    collectElements();
    bindEvents();

    state.authToken = getStoredAuthToken();
    if (!state.authToken) {
      showFatalError('認証情報がありません。GAS入口から開き直してください。');
      return;
    }

    try {
      state.db = await openDatabase();
      await putDraft('inputMode', 'text');
      await deleteDraft('audioBlob');
      await deleteDraft('audioMeta');
      await restoreExistingText();
      updateInputState();
    } catch (error) {
      showFatalError('入力画面の初期化に失敗しました。\n' + getErrorMessage(error));
    }
  }

  function collectElements() {
    elements.backButton = document.getElementById('backButton');
    elements.helpButton = document.getElementById('helpButton');
    elements.inputStatusBadge = document.getElementById('inputStatusBadge');
    elements.textBodyInput = document.getElementById('textBodyInput');
    elements.characterCount = document.getElementById('characterCount');
    elements.nextButton = document.getElementById('nextButton');
    elements.statusBox = document.getElementById('statusBox');
  }

  function bindEvents() {
    elements.backButton.addEventListener('click', () => {
      location.href = CONFIG.PREVIOUS_PAGE_URL;
    });

    elements.helpButton.addEventListener('click', () => {
      showStatus(
        '見たこと・聞いたこと・発生場所・発生時期を分かる範囲で入力してください。推測は「〜と思う」のように区別してください。',
        'info'
      );
    });

    elements.textBodyInput.addEventListener('input', updateInputState);
    elements.nextButton.addEventListener('click', saveAndGoNext);
  }

  async function restoreExistingText() {
    const existingText = await getDraft('textBody');
    if (existingText) {
      elements.textBodyInput.value = String(existingText).slice(0, CONFIG.MAX_LENGTH);
    }
  }

  function updateInputState() {
    const length = elements.textBodyInput.value.trim().length;
    elements.characterCount.textContent = length + ' / ' + CONFIG.MAX_LENGTH;
    elements.nextButton.disabled = state.isSaving || length < CONFIG.MIN_LENGTH;

    if (length >= CONFIG.MIN_LENGTH) {
      setInputStatus('入力内容を保存できます', 'ready');
    } else {
      setInputStatus('あと' + (CONFIG.MIN_LENGTH - length) + '文字入力してください', 'ready');
    }
  }

  async function saveAndGoNext() {
    const body = elements.textBodyInput.value.trim();

    if (body.length < CONFIG.MIN_LENGTH) {
      showStatus(CONFIG.MIN_LENGTH + '文字以上入力してください。', 'error');
      return;
    }

    state.isSaving = true;
    updateInputState();
    showStatus('入力内容を保存しています...', 'info');

    try {
      await putDraft('inputMode', 'text');
      await putDraft('textBody', body);
      await putDraft('textMeta', {
        createdAt: new Date().toISOString(),
        characterCount: body.length
      });

      location.href = CONFIG.NEXT_PAGE_URL;
    } catch (error) {
      state.isSaving = false;
      updateInputState();
      showStatus('入力内容を保存できませんでした。\n' + getErrorMessage(error), 'error');
    }
  }

  function setInputStatus(text, type) {
    elements.inputStatusBadge.textContent = text;
    elements.inputStatusBadge.classList.remove('status-ready', 'status-error');
    elements.inputStatusBadge.classList.add(type === 'error' ? 'status-error' : 'status-ready');
  }

  function showFatalError(message) {
    setInputStatus('利用不可', 'error');
    elements.textBodyInput.disabled = true;
    elements.nextButton.disabled = true;
    showStatus(message, 'error');
  }

  function showStatus(message, type) {
    if (!message) {
      elements.statusBox.className = 'status-box hidden';
      elements.statusBox.textContent = '';
      return;
    }

    elements.statusBox.className = 'status-box ' + (type || 'info');
    elements.statusBox.textContent = message;
  }

  function getStoredAuthToken() {
    return sessionStorage.getItem(CONFIG.AUTH_TOKEN_STORAGE_KEY)
      || sessionStorage.getItem('fieldReportToken')
      || '';
  }

  function openDatabase() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(CONFIG.DB_NAME, CONFIG.DB_VERSION);

      request.onupgradeneeded = event => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains(CONFIG.STORE_NAME)) {
          db.createObjectStore(CONFIG.STORE_NAME);
        }
      };

      request.onsuccess = event => resolve(event.target.result);
      request.onerror = event => reject(event.target.error);
    });
  }

  function getDraft(key) {
    return runStoreRequest('readonly', store => store.get(key));
  }

  function putDraft(key, value) {
    return runStoreRequest('readwrite', store => store.put(value, key));
  }

  function deleteDraft(key) {
    return runStoreRequest('readwrite', store => store.delete(key));
  }

  function runStoreRequest(mode, requestFactory) {
    return new Promise((resolve, reject) => {
      const transaction = state.db.transaction(CONFIG.STORE_NAME, mode);
      const request = requestFactory(transaction.objectStore(CONFIG.STORE_NAME));
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = event => reject(event.target.error);
    });
  }

  function getErrorMessage(error) {
    return error && error.message ? String(error.message) : String(error || '不明なエラーです。');
  }
})();
