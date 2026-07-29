(() => {
  'use strict';

  const CONFIG = {
    GAS_WEB_APP_URL: 'https://script.google.com/a/macros/ecodesign-labo.jp/s/AKfycbyXfeS3QTVf_ROlbHnooRfNXITfEz8bkOF6QqHBB4BU0yNNmYwNMBYIcueFKYBVDgU/exec',
    DB_NAME: 'field-report-draft-db',
    DB_VERSION: 1,
    STORE_NAME: 'draft',
    AUTH_TOKEN_STORAGE_KEY: 'fieldReportAuthToken'
  };

  const state = {
    authToken: '',
    db: null,
    context: null,
    isStarting: false
  };

  const elements = {};

  document.addEventListener('DOMContentLoaded', initializePage);

  async function initializePage() {
    collectElements();
    bindEvents();

    state.authToken = getAuthTokenFromUrlOrStorage();
    if (!state.authToken) {
      showFatalError('認証情報がありません。GAS入口から開き直してください。');
      return;
    }

    try {
      state.db = await openDatabase();
      state.context = await fetchApplicationContext(state.authToken);
      renderSubmitter(state.context.submitter || state.context.currentUser || {});
      setAuthStatus('利用者確認完了', 'ready');
      setModeButtonsEnabled(true);
    } catch (error) {
      showFatalError('利用者情報を取得できませんでした。\n' + getErrorMessage(error));
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
      'uploadResult'
    ];

    await Promise.all(keys.map(deleteDraft));
  }

  function renderSubmitter(submitter) {
    elements.submitterName.textContent = submitter.name || '-';
    elements.submitterDepartment.textContent = submitter.department || '-';
    elements.submitterEmail.textContent = submitter.email || '-';
  }

  function setAuthStatus(text, type) {
    elements.authStatusBadge.textContent = text;
    elements.authStatusBadge.classList.remove('status-waiting', 'status-ready', 'status-error');
    elements.authStatusBadge.classList.add(type === 'ready' ? 'status-ready' : type === 'error' ? 'status-error' : 'status-waiting');
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
      history.replaceState({}, document.title, url.toString());
      return tokenFromUrl;
    }

    return sessionStorage.getItem(CONFIG.AUTH_TOKEN_STORAGE_KEY)
      || sessionStorage.getItem('fieldReportToken')
      || '';
  }

  function fetchApplicationContext(token) {
    return new Promise((resolve, reject) => {
      const callbackName = '__fieldReportContext_' + Date.now() + '_' + Math.random().toString(36).slice(2);
      const script = document.createElement('script');
      const timeoutId = setTimeout(() => finish(new Error('利用者情報の取得がタイムアウトしました。')), 15000);

      function finish(error, value) {
        clearTimeout(timeoutId);
        delete window[callbackName];
        script.remove();
        error ? reject(error) : resolve(value);
      }

      window[callbackName] = response => {
        if (!response || !response.ok) {
          finish(new Error(response && response.error ? response.error : '利用者情報を取得できませんでした。'));
          return;
        }
        finish(null, response);
      };

      script.onerror = () => finish(new Error('GASへの接続に失敗しました。'));
      script.src = CONFIG.GAS_WEB_APP_URL
        + '?action=context&token=' + encodeURIComponent(token)
        + '&callback=' + encodeURIComponent(callbackName);
      document.head.appendChild(script);
    });
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
