(() => {
  'use strict';

  const CONFIG = {
    DB_NAME: 'field-report-draft-db',
    DB_VERSION: 1,
    STORE_NAME: 'draft',
    AUTH_TOKEN_STORAGE_KEY: 'fieldReportAuthToken',
    APP_CONTEXT_STORAGE_KEY: 'fieldReportAppContext'
  };

  const state = {
    authToken: '',
    db: null,
    context: null,
    isStarting: false
  };

  const elements = {};

  document.addEventListener('DOMContentLoaded', initializePage);

  // ---------------------------------------------------------------------------
  // Page initialization
  // ---------------------------------------------------------------------------

  async function initializePage() {
    collectElements();
    bindEvents();

    try {
      const bootstrapContext = consumeBootstrapContext();

      state.authToken = getAuthTokenFromUrlOrStorage();
      if (!state.authToken) {
        showFatalError('認証情報がありません。GAS入口から開き直してください。');
        return;
      }

      state.db = await openDatabase();
      state.context = bootstrapContext || getStoredApplicationContext();

      if (!state.context) {
        throw new Error('利用者情報がありません。GAS入口から開き直してください。');
      }

      const submitter = state.context.submitter || state.context.currentUser || {};
      if (!submitter.email) {
        throw new Error('利用者情報にメールアドレスがありません。');
      }

      renderSubmitter(submitter);
      setAuthStatus('利用者確認完了', 'ready');
      setModeButtonsEnabled(true);
      showStatus('', '');

    } catch (error) {
      showFatalError('利用者情報を読み込めませんでした。\n' + getErrorMessage(error));
    }
  }

  function collectElements() {
    elements.helpButton = document.getElementById('helpButton');
    elements.authStatusBadge = document.getElementById('authStatusBadge');
    elements.submitterName = document.getElementById('submitterName');
    elements.submitterDepartment = document.getElementById('submitterDepartment');
    elements.submitterEmail = document.getElementById('submitterEmail');
    elements.textModeButton = document.getElementById('textModeButton');
    elements.audioModeButton = document.getElementById('audioModeButton');
    elements.statusBox = document.getElementById('statusBox');

    const required = [
      'helpButton',
      'authStatusBadge',
      'submitterName',
      'submitterDepartment',
      'submitterEmail',
      'textModeButton',
      'audioModeButton',
      'statusBox'
    ];

    const missing = required.filter(name => !elements[name]);
    if (missing.length) {
      throw new Error('input.html に必要な要素がありません: ' + missing.join(', '));
    }
  }

  function bindEvents() {
    elements.helpButton.addEventListener('click', () => {
      showStatus(
        'テキスト入力は入力内容をそのままAI解析します。録音は投稿後に文字起こししてからAI解析します。',
        'info'
      );
    });

    elements.textModeButton.addEventListener('click', () => startInputMode('text'));
    elements.audioModeButton.addEventListener('click', () => startInputMode('audio'));
  }

  // ---------------------------------------------------------------------------
  // Input-mode selection and draft reset
  // ---------------------------------------------------------------------------

  async function startInputMode(mode) {
    if (state.isStarting) return;

    state.isStarting = true;
    setModeButtonsEnabled(false);
    showStatus('入力画面を準備しています...', 'info');

    try {
      await clearPreviousDraft();
      await putDraft('inputMode', mode);
      await putDraft('draftStartedAt', new Date().toISOString());

      location.href = mode === 'text' ? './text.html' : './record.html';
    } catch (error) {
      state.isStarting = false;
      setModeButtonsEnabled(true);
      showStatus('入力画面を開始できませんでした。\n' + getErrorMessage(error), 'error');
    }
  }

  async function clearPreviousDraft() {
    const keys = [
      'inputMode',
      'draftStartedAt',
      'textBody',
      'textMeta',
      'audioBlob',
      'audioMeta',
      'imageBlob',
      'imageMeta',
      'attachments',
      'uploadResult'
    ];

    await Promise.all(keys.map(deleteDraft));
  }

  // ---------------------------------------------------------------------------
  // Bootstrap context and authentication token
  // ---------------------------------------------------------------------------

  function consumeBootstrapContext() {
    const url = new URL(location.href);

    // v2: クエリパラメータを優先。v1互換としてフラグメントも読む。
    let encoded = url.searchParams.get('bootstrap') || '';

    if (!encoded) {
      const rawHash = String(url.hash || '').replace(/^#/, '');
      if (rawHash) {
        encoded = new URLSearchParams(rawHash).get('bootstrap') || '';
      }
    }

    if (!encoded) {
      return null;
    }

    try {
      const payload = JSON.parse(decodeBase64UrlUtf8(encoded));

      if (!payload || !payload.token) {
        throw new Error('初期情報にtokenがありません。');
      }
      if (!payload.submitter || !payload.submitter.email) {
        throw new Error('初期情報に投稿者情報がありません。');
      }

      const context = {
        ok: true,
        submitter: payload.submitter,
        currentUser: payload.submitter,
        departments: Array.isArray(payload.departments) ? payload.departments : [],
        driveRootFolderId: payload.driveRootFolderId || '',
        issuedAt: payload.issuedAt || '',
        entryVersion: payload.version || 1
      };

      sessionStorage.setItem(CONFIG.AUTH_TOKEN_STORAGE_KEY, payload.token);
      sessionStorage.setItem('fieldReportToken', payload.token);
      sessionStorage.setItem(CONFIG.APP_CONTEXT_STORAGE_KEY, JSON.stringify(context));

      removeBootstrapFromAddressBar();
      return context;

    } catch (error) {
      removeBootstrapFromAddressBar();
      throw new Error(
        'GAS入口から受け取った初期情報を解析できませんでした。\n' + getErrorMessage(error)
      );
    }
  }

  function removeBootstrapFromAddressBar() {
    const url = new URL(location.href);
    url.searchParams.delete('bootstrap');
    url.searchParams.delete('token');
    url.searchParams.delete('entryVersion');
    url.hash = '';

    history.replaceState(
      {},
      document.title,
      url.pathname + (url.searchParams.toString() ? '?' + url.searchParams.toString() : '')
    );
  }

  function getStoredApplicationContext() {
    const raw = sessionStorage.getItem(CONFIG.APP_CONTEXT_STORAGE_KEY);
    if (!raw) return null;

    try {
      const context = JSON.parse(raw);
      return context && context.submitter ? context : null;
    } catch (_) {
      sessionStorage.removeItem(CONFIG.APP_CONTEXT_STORAGE_KEY);
      return null;
    }
  }

  function decodeBase64UrlUtf8(value) {
    const base64 = String(value || '')
      .replace(/-/g, '+')
      .replace(/_/g, '/');

    const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
    const binary = atob(padded);
    const bytes = Uint8Array.from(binary, character => character.charCodeAt(0));

    if (typeof TextDecoder === 'function') {
      return new TextDecoder('utf-8').decode(bytes);
    }

    let escaped = '';
    bytes.forEach(byte => {
      escaped += '%' + byte.toString(16).padStart(2, '0');
    });
    return decodeURIComponent(escaped);
  }

  function renderSubmitter(submitter) {
    elements.submitterName.textContent = submitter.name || '-';
    elements.submitterDepartment.textContent = submitter.department || '-';
    elements.submitterEmail.textContent = submitter.email || '-';
  }

  function setAuthStatus(text, type) {
    elements.authStatusBadge.textContent = text;
    elements.authStatusBadge.classList.remove('status-waiting', 'status-ready', 'status-error');
    elements.authStatusBadge.classList.add(
      type === 'ready' ? 'status-ready' : type === 'error' ? 'status-error' : 'status-waiting'
    );
  }

  function setModeButtonsEnabled(enabled) {
    elements.textModeButton.disabled = !enabled;
    elements.audioModeButton.disabled = !enabled;
  }

  function showFatalError(message) {
    setAuthStatus('利用不可', 'error');
    setModeButtonsEnabled(false);
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

    return sessionStorage.getItem(CONFIG.AUTH_TOKEN_STORAGE_KEY)
      || sessionStorage.getItem('fieldReportToken')
      || '';
  }

  // ---------------------------------------------------------------------------
  // IndexedDB and generic utilities
  // ---------------------------------------------------------------------------

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
      request.onsuccess = () => resolve(request.result);
      request.onerror = event => reject(event.target.error);
    });
  }

  function getErrorMessage(error) {
    return error && error.message ? String(error.message) : String(error || '不明なエラーです。');
  }
})();
