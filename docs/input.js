'use strict';

const GAS_WEB_APP_URL = 'https://script.google.com/a/macros/ecodesign-labo.jp/s/AKfycbzyU4I8u5csBb7qRIWvSGwPBrDcYAv0p6rPO6-ModBzPCtwavFeeSaGcOf-TwJeyb7BfQ/exec';
const DRAFT_DB_NAME = 'fieldReportDraftDb';
const DRAFT_STORE_NAME = 'drafts';
const DRAFT_KEY = 'currentDraft';

const state = {
  token: '',
  context: null
};

document.addEventListener('DOMContentLoaded', init);

async function init() {
  const params = new URLSearchParams(location.search);
  state.token = params.get('token') || sessionStorage.getItem('fieldReportToken') || '';

  if (!state.token) {
    setStatus('tokenがありません。GAS承認画面から開き直してください。');
    disableButtons(true);
    return;
  }

  sessionStorage.setItem('fieldReportToken', state.token);

  try {
    state.context = await fetchContextJsonp(state.token);
    if (!state.context || !state.context.ok) {
      throw new Error((state.context && state.context.error) || 'context取得に失敗しました。');
    }

    renderUser(state.context.submitter || state.context.currentUser || {});
    setStatus('入力方法を選択してください。');
    disableButtons(false);
  } catch (err) {
    setStatus('認証情報の確認に失敗しました: ' + errorToString(err));
    disableButtons(true);
  }

  document.getElementById('textModeBtn').addEventListener('click', () => startMode('text'));
  document.getElementById('audioModeBtn').addEventListener('click', () => startMode('audio'));
}

async function startMode(mode) {
  try {
    disableButtons(true);
    setStatus('準備しています...');

    const draft = {
      version: 2,
      inputMode: mode,
      token: state.token,
      context: state.context,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      text: null,
      audio: null,
      image: null
    };

    await saveDraft(draft);

    const target = mode === 'text' ? 'text.html' : 'record.html';
    location.href = target + '?token=' + encodeURIComponent(state.token);
  } catch (err) {
    setStatus('開始処理に失敗しました: ' + errorToString(err));
    disableButtons(false);
  }
}

function fetchContextJsonp(token) {
  return new Promise((resolve, reject) => {
    const callbackName = 'fieldReportContext_' + Date.now() + '_' + Math.floor(Math.random() * 100000);
    const script = document.createElement('script');
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error('context取得がタイムアウトしました。'));
    }, 15000);

    window[callbackName] = data => {
      clearTimeout(timeout);
      cleanup();
      resolve(data);
    };

    script.onerror = () => {
      clearTimeout(timeout);
      cleanup();
      reject(new Error('context取得用スクリプトの読み込みに失敗しました。'));
    };

    const url = new URL(GAS_WEB_APP_URL);
    url.searchParams.set('action', 'context');
    url.searchParams.set('token', token);
    url.searchParams.set('callback', callbackName);
    script.src = url.toString();
    document.body.appendChild(script);

    function cleanup() {
      try { delete window[callbackName]; } catch (e) { window[callbackName] = undefined; }
      if (script.parentNode) script.parentNode.removeChild(script);
    }
  });
}

function renderUser(user) {
  const box = document.getElementById('userBox');
  box.hidden = false;
  box.innerHTML = [
    '<strong>ログインユーザー</strong>',
    '氏名：' + escapeHtml(user.name || '-'),
    'メール：' + escapeHtml(user.email || '-'),
    '所属：' + escapeHtml(user.department || '-')
  ].join('<br>');
}

function disableButtons(disabled) {
  document.getElementById('textModeBtn').disabled = disabled;
  document.getElementById('audioModeBtn').disabled = disabled;
}

function setStatus(text) {
  document.getElementById('status').textContent = text || '';
}

function saveDraft(draft) {
  return openDb().then(db => new Promise((resolve, reject) => {
    const tx = db.transaction(DRAFT_STORE_NAME, 'readwrite');
    tx.objectStore(DRAFT_STORE_NAME).put(draft, DRAFT_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  }));
}

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DRAFT_DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(DRAFT_STORE_NAME)) db.createObjectStore(DRAFT_STORE_NAME);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function escapeHtml(value) {
  return String(value || '').replace(/[&<>'"]/g, s => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[s]));
}

function errorToString(err) {
  return err && (err.message || err.stack) ? (err.message || err.stack) : String(err);
}
