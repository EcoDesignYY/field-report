'use strict';

const GAS_WEB_APP_URL = 'https://script.google.com/a/macros/ecodesign-labo.jp/s/AKfycbzyU4I8u5csBb7qRIWvSGwPBrDcYAv0p6rPO6-ModBzPCtwavFeeSaGcOf-TwJeyb7BfQ/exec';
const DRIVE_ROOT_FOLDER_ID = '1oRhXuGn0YE1C-eKyG7MHNObLr1ficZ-p';
const GOOGLE_CLIENT_ID = '866457692941-cro6etg365bkgq6m0qpor789677g11lq.apps.googleusercontent.com';
const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive';

const DRAFT_DB_NAME = 'fieldReportDraftDb';
const DRAFT_STORE_NAME = 'drafts';
const DRAFT_KEY = 'currentDraft';

let draft = null;
let context = null;
let driveAccessToken = '';

document.addEventListener('DOMContentLoaded', init);

async function init() {
  document.getElementById('backBtn').addEventListener('click', goBack);
  document.getElementById('submitBtn').addEventListener('click', submitReport);

  try {
    draft = await loadDraft();
    if (!draft) throw new Error('下書きがありません。入力方法選択からやり直してください。');

    const token = getToken();
    if (!token) throw new Error('tokenがありません。GAS承認画面から開き直してください。');
    sessionStorage.setItem('fieldReportToken', token);

    context = draft.context || await fetchContextJsonp(token);
    if (!context || !context.ok) throw new Error((context && context.error) || 'context取得に失敗しました。');
    draft.context = context;
    await saveDraft(draft);

    renderDepartmentOptions(context.departments || []);
    renderSummary();
    setStatus('内容を確認して投稿してください。');
  } catch (err) {
    setStatus(errorToString(err));
    document.getElementById('submitBtn').disabled = true;
  }
}

function renderDepartmentOptions(departments) {
  const select = document.getElementById('targetDepartment');
  select.innerHTML = '';
  const placeholder = document.createElement('option');
  placeholder.value = '';
  placeholder.textContent = '選択してください';
  select.appendChild(placeholder);

  departments.forEach(dep => {
    const opt = document.createElement('option');
    opt.value = dep;
    opt.textContent = dep;
    select.appendChild(opt);
  });

  if (draft.targetDepartment) select.value = draft.targetDepartment;
}

function renderSummary() {
  const summary = document.getElementById('summary');
  const user = (context && (context.submitter || context.currentUser)) || {};
  const inputMode = draft.inputMode === 'text' ? 'テキスト入力' : '録音';
  const html = [];

  html.push('<h2>投稿者</h2>');
  html.push('<div>氏名：' + escapeHtml(user.name || '-') + '</div>');
  html.push('<div>所属：' + escapeHtml(user.department || '-') + '</div>');
  html.push('<div>メール：' + escapeHtml(user.email || '-') + '</div>');

  html.push('<h2>入力方式</h2>');
  html.push('<div>' + escapeHtml(inputMode) + '</div>');

  if (draft.inputMode === 'text') {
    html.push('<h2>入力本文</h2>');
    html.push('<pre>' + escapeHtml((draft.text && draft.text.body) || '') + '</pre>');
  } else {
    html.push('<h2>録音</h2>');
    html.push(draft.audio && draft.audio.blob ? '<audio controls src="' + URL.createObjectURL(draft.audio.blob) + '"></audio>' : '<div>録音データなし</div>');
  }

  html.push('<h2>画像</h2>');
  if (draft.image && draft.image.blob) {
    html.push('<img class="preview" src="' + URL.createObjectURL(draft.image.blob) + '" alt="添付画像">');
  } else {
    html.push('<div>画像なし</div>');
  }

  summary.innerHTML = html.join('');
}

async function submitReport() {
  const submitBtn = document.getElementById('submitBtn');
  submitBtn.disabled = true;

  try {
    const targetDepartment = document.getElementById('targetDepartment').value;
    if (!targetDepartment) throw new Error('対象部署を選択してください。');

    draft.targetDepartment = targetDepartment;
    draft.updatedAt = new Date().toISOString();
    await saveDraft(draft);

    validateDraftForSubmit(draft);

    setStatus('Google Drive認証を確認しています...');
    driveAccessToken = await getDriveAccessToken();

    const reportId = buildReportId();
    const folderName = reportId + '_' + sanitizeFileName(targetDepartment || '未指定');

    setStatus('投稿フォルダを作成しています...');
    const folder = await createDriveFolder(folderName, DRIVE_ROOT_FOLDER_ID);
    const folderId = folder.id;
    const folderUrl = buildDriveFolderUrl(folderId);

    let audioFile = null;
    let imageFile = null;

    if (draft.inputMode === 'audio') {
      setStatus('音声データをアップロードしています...');
      audioFile = await uploadDriveFile({
        name: (draft.audio && draft.audio.fileName) || 'audio.mp4',
        mimeType: (draft.audio && draft.audio.mimeType) || (draft.audio && draft.audio.blob && draft.audio.blob.type) || 'audio/mp4',
        blob: draft.audio.blob,
        parentFolderId: folderId
      });
    }

    if (draft.image && draft.image.blob) {
      setStatus('画像データをアップロードしています...');
      imageFile = await uploadDriveFile({
        name: draft.image.fileName || 'image.jpg',
        mimeType: draft.image.mimeType || draft.image.blob.type || 'image/jpeg',
        blob: draft.image.blob,
        parentFolderId: folderId
      });
    }

    const user = (context && (context.submitter || context.currentUser)) || {};
    const metadata = buildMetadata({
      reportId,
      folderId,
      folderUrl,
      audioFile,
      imageFile,
      targetDepartment,
      submitter: user
    });

    setStatus('metadata.jsonを保存しています...');
    const metadataBlob = new Blob([JSON.stringify(metadata, null, 2)], { type: 'application/json' });
    const metadataFile = await uploadDriveFile({
      name: 'metadata.json',
      mimeType: 'application/json',
      blob: metadataBlob,
      parentFolderId: folderId
    });

    metadata.drive.metadataFileId = metadataFile.id;
    metadata.drive.metadataFileName = metadataFile.name || 'metadata.json';
    metadata.drive.metadataFileUrl = buildDriveFileUrl(metadataFile.id);

    setStatus('GASへ投稿完了を通知しています...');
    await notifyUploadCompletedToGas({
      action: 'uploadCompleted',
      token: getToken(),
      reportId,
      folderId,
      folderUrl,
      audioFileId: audioFile ? audioFile.id : '',
      audioFileUrl: audioFile ? buildDriveFileUrl(audioFile.id) : '',
      imageFileId: imageFile ? imageFile.id : '',
      imageFileUrl: imageFile ? buildDriveFileUrl(imageFile.id) : '',
      metadataFileId: metadataFile.id,
      metadataFileUrl: buildDriveFileUrl(metadataFile.id),
      targetDepartment,
      metadata
    });

    await clearDraft();
    setStatus('投稿が完了しました。AI解析は順次実行されます。\n投稿ID: ' + reportId);
  } catch (err) {
    setStatus('投稿に失敗しました: ' + errorToString(err));
    submitBtn.disabled = false;
  }
}

function validateDraftForSubmit(draft) {
  if (!draft.inputMode) throw new Error('入力方式が不明です。');
  if (draft.inputMode === 'text') {
    const text = draft.text && draft.text.body ? draft.text.body.trim() : '';
    if (!text) throw new Error('テキスト本文がありません。');
  } else if (draft.inputMode === 'audio') {
    if (!draft.audio || !draft.audio.blob) throw new Error('録音データがありません。');
  } else {
    throw new Error('未対応の入力方式です: ' + draft.inputMode);
  }
}

function buildMetadata(args) {
  const audioFile = args.audioFile;
  const imageFile = args.imageFile;
  const inputMode = draft.inputMode || 'audio';

  return {
    version: 2,
    reportId: args.reportId,
    inputMode,
    createdAt: draft.createdAt || new Date().toISOString(),
    submittedAt: new Date().toISOString(),
    targetDepartment: args.targetDepartment,
    autoTitle: '現場投稿_' + args.reportId,
    submitter: {
      name: args.submitter.name || '',
      email: args.submitter.email || '',
      department: args.submitter.department || '',
      role: args.submitter.role || ''
    },
    text: inputMode === 'text' ? {
      body: (draft.text && draft.text.body) || '',
      createdAt: (draft.text && draft.text.createdAt) || '',
      updatedAt: (draft.text && draft.text.updatedAt) || ''
    } : null,
    audio: inputMode === 'audio' ? {
      fileName: (draft.audio && draft.audio.fileName) || '',
      mimeType: (draft.audio && draft.audio.mimeType) || '',
      durationSec: (draft.audio && draft.audio.durationSec) || '',
      recordedAt: (draft.audio && draft.audio.recordedAt) || ''
    } : null,
    image: draft.image ? {
      fileName: draft.image.fileName || '',
      mimeType: draft.image.mimeType || '',
      capturedAt: draft.image.capturedAt || ''
    } : null,
    drive: {
      folderId: args.folderId,
      folderUrl: args.folderUrl,
      audioFileId: audioFile ? audioFile.id : '',
      audioFileName: audioFile ? audioFile.name : '',
      audioMimeType: audioFile ? audioFile.mimeType : '',
      audioFileUrl: audioFile ? buildDriveFileUrl(audioFile.id) : '',
      imageFileId: imageFile ? imageFile.id : '',
      imageFileName: imageFile ? imageFile.name : '',
      imageMimeType: imageFile ? imageFile.mimeType : '',
      imageFileUrl: imageFile ? buildDriveFileUrl(imageFile.id) : '',
      metadataFileId: '',
      metadataFileName: 'metadata.json',
      metadataFileUrl: ''
    },
    status: 'uploaded'
  };
}

function getDriveAccessToken() {
  return new Promise((resolve, reject) => {
    if (!window.google || !google.accounts || !google.accounts.oauth2) {
      reject(new Error('Google Identity Servicesが読み込まれていません。'));
      return;
    }
    if (!GOOGLE_CLIENT_ID || GOOGLE_CLIENT_ID.indexOf('YOUR_') === 0) {
      reject(new Error('confirm.js の GOOGLE_CLIENT_ID を設定してください。'));
      return;
    }
    const client = google.accounts.oauth2.initTokenClient({
      client_id: GOOGLE_CLIENT_ID,
      scope: DRIVE_SCOPE,
      callback: response => {
        if (response && response.access_token) resolve(response.access_token);
        else reject(new Error('Drive APIのアクセストークン取得に失敗しました。'));
      },
      error_callback: err => reject(new Error('Drive認証に失敗しました: ' + JSON.stringify(err || {})))
    });
    client.requestAccessToken({ prompt: '' });
  });
}

async function createDriveFolder(name, parentFolderId) {
  const res = await fetch('https://www.googleapis.com/drive/v3/files?fields=id,name,mimeType,webViewLink&supportsAllDrives=true', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + driveAccessToken, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, mimeType: 'application/vnd.google-apps.folder', parents: [parentFolderId] })
  });
  if (!res.ok) throw new Error('Driveフォルダ作成失敗 HTTP ' + res.status + ': ' + await res.text());
  return res.json();
}

async function uploadDriveFile({ name, mimeType, blob, parentFolderId }) {
  const boundary = '-------fieldReportBoundary' + Date.now();
  const metadata = { name, mimeType, parents: [parentFolderId] };
  const body = new Blob([
    '--' + boundary + '\r\n',
    'Content-Type: application/json; charset=UTF-8\r\n\r\n',
    JSON.stringify(metadata),
    '\r\n--' + boundary + '\r\n',
    'Content-Type: ' + mimeType + '\r\n\r\n',
    blob,
    '\r\n--' + boundary + '--'
  ], { type: 'multipart/related; boundary=' + boundary });

  const res = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,mimeType,webViewLink&supportsAllDrives=true', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + driveAccessToken },
    body
  });
  if (!res.ok) throw new Error('Driveファイルアップロード失敗 HTTP ' + res.status + ': ' + await res.text());
  return res.json();
}

async function notifyUploadCompletedToGas(payload) {
  await fetch(GAS_WEB_APP_URL, {
    method: 'POST',
    mode: 'no-cors',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify(payload)
  });
}

function fetchContextJsonp(token) {
  return new Promise((resolve, reject) => {
    const callbackName = 'fieldReportContext_' + Date.now() + '_' + Math.floor(Math.random() * 100000);
    const script = document.createElement('script');
    const timeout = setTimeout(() => { cleanup(); reject(new Error('context取得がタイムアウトしました。')); }, 15000);
    window[callbackName] = data => { clearTimeout(timeout); cleanup(); resolve(data); };
    script.onerror = () => { clearTimeout(timeout); cleanup(); reject(new Error('context取得用スクリプトの読み込みに失敗しました。')); };
    const url = new URL(GAS_WEB_APP_URL);
    url.searchParams.set('action', 'context');
    url.searchParams.set('token', token);
    url.searchParams.set('callback', callbackName);
    script.src = url.toString();
    document.body.appendChild(script);
    function cleanup() { try { delete window[callbackName]; } catch (e) { window[callbackName] = undefined; } if (script.parentNode) script.parentNode.removeChild(script); }
  });
}

function goBack() {
  const token = getToken();
  const target = draft && draft.inputMode === 'text' ? 'capture.html' : 'capture.html';
  location.href = target + (token ? '?token=' + encodeURIComponent(token) : '');
}

function buildReportId() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  const ss = String(now.getSeconds()).padStart(2, '0');
  const rand = Math.random().toString(36).slice(2, 8).toUpperCase();
  return `RPT-${y}${m}${d}-${hh}${mm}${ss}-${rand}`;
}
function buildDriveFileUrl(fileId) { return fileId ? `https://drive.google.com/file/d/${encodeURIComponent(fileId)}/view` : ''; }
function buildDriveFolderUrl(folderId) { return folderId ? `https://drive.google.com/drive/folders/${encodeURIComponent(folderId)}` : ''; }
function sanitizeFileName(value) { return String(value || '').replace(/[\\/:*?"<>|]/g, '_').slice(0, 80); }
function getToken() { const params = new URLSearchParams(location.search); return params.get('token') || sessionStorage.getItem('fieldReportToken') || (draft && draft.token) || ''; }
function setStatus(text) { document.getElementById('status').textContent = text || ''; }
function loadDraft() { return openDb().then(db => new Promise((resolve, reject) => { const tx = db.transaction(DRAFT_STORE_NAME, 'readonly'); const req = tx.objectStore(DRAFT_STORE_NAME).get(DRAFT_KEY); req.onsuccess = () => resolve(req.result || null); req.onerror = () => reject(req.error); })); }
function saveDraft(value) { return openDb().then(db => new Promise((resolve, reject) => { const tx = db.transaction(DRAFT_STORE_NAME, 'readwrite'); tx.objectStore(DRAFT_STORE_NAME).put(value, DRAFT_KEY); tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); })); }
function clearDraft() { return openDb().then(db => new Promise((resolve, reject) => { const tx = db.transaction(DRAFT_STORE_NAME, 'readwrite'); tx.objectStore(DRAFT_STORE_NAME).delete(DRAFT_KEY); tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); })); }
function openDb() { return new Promise((resolve, reject) => { const req = indexedDB.open(DRAFT_DB_NAME, 1); req.onupgradeneeded = () => { const db = req.result; if (!db.objectStoreNames.contains(DRAFT_STORE_NAME)) db.createObjectStore(DRAFT_STORE_NAME); }; req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error); }); }
function escapeHtml(value) { return String(value || '').replace(/[&<>'"]/g, s => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[s])); }
function errorToString(err) { return err && (err.message || err.stack) ? (err.message || err.stack) : String(err); }
