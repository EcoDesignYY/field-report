'use strict';

const DRAFT_DB_NAME = 'fieldReportDraftDb';
const DRAFT_STORE_NAME = 'drafts';
const DRAFT_KEY = 'currentDraft';

let draft = null;

document.addEventListener('DOMContentLoaded', init);

async function init() {
  const textarea = document.getElementById('problemText');
  textarea.addEventListener('input', updateCount);
  document.getElementById('backBtn').addEventListener('click', goBack);
  document.getElementById('nextBtn').addEventListener('click', goNext);

  try {
    draft = await loadDraft();
    if (!draft) throw new Error('下書きがありません。入力方法選択からやり直してください。');
    draft.inputMode = 'text';

    if (draft.text && draft.text.body) textarea.value = draft.text.body;
    updateCount();
  } catch (err) {
    setStatus(errorToString(err));
    document.getElementById('nextBtn').disabled = true;
  }
}

async function goBack() {
  const token = getToken();
  location.href = 'input.html' + (token ? '?token=' + encodeURIComponent(token) : '');
}

async function goNext() {
  try {
    const body = document.getElementById('problemText').value.trim();
    if (!body) {
      setStatus('問題内容を入力してください。');
      return;
    }

    draft.inputMode = 'text';
    draft.text = {
      body,
      createdAt: draft.text && draft.text.createdAt ? draft.text.createdAt : new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    draft.audio = null;
    draft.updatedAt = new Date().toISOString();

    await saveDraft(draft);
    const token = getToken();
    location.href = 'capture.html' + (token ? '?token=' + encodeURIComponent(token) : '');
  } catch (err) {
    setStatus('保存に失敗しました: ' + errorToString(err));
  }
}

function updateCount() {
  document.getElementById('charCount').textContent = String(document.getElementById('problemText').value.length);
}

function getToken() {
  const params = new URLSearchParams(location.search);
  return params.get('token') || sessionStorage.getItem('fieldReportToken') || (draft && draft.token) || '';
}

function setStatus(text) { document.getElementById('status').textContent = text || ''; }

function loadDraft() {
  return openDb().then(db => new Promise((resolve, reject) => {
    const tx = db.transaction(DRAFT_STORE_NAME, 'readonly');
    const req = tx.objectStore(DRAFT_STORE_NAME).get(DRAFT_KEY);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  }));
}

function saveDraft(value) {
  return openDb().then(db => new Promise((resolve, reject) => {
    const tx = db.transaction(DRAFT_STORE_NAME, 'readwrite');
    tx.objectStore(DRAFT_STORE_NAME).put(value, DRAFT_KEY);
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

function errorToString(err) { return err && (err.message || err.stack) ? (err.message || err.stack) : String(err); }
