'use strict';

const DRAFT_DB_NAME = 'fieldReportDraftDb';
const DRAFT_STORE_NAME = 'drafts';
const DRAFT_KEY = 'currentDraft';

let draft = null;
let stream = null;

document.addEventListener('DOMContentLoaded', init);

async function init() {
  document.getElementById('startCameraBtn').addEventListener('click', startCamera);
  document.getElementById('captureBtn').addEventListener('click', captureImage);
  document.getElementById('fileInput').addEventListener('change', onFileChange);
  document.getElementById('clearBtn').addEventListener('click', clearImage);
  document.getElementById('backBtn').addEventListener('click', goBack);
  document.getElementById('nextBtn').addEventListener('click', goNext);

  try {
    draft = await loadDraft();
    if (!draft) throw new Error('下書きがありません。入力方法選択からやり直してください。');
    if (draft.image && draft.image.blob) renderPreview(draft.image.blob);
  } catch (err) {
    setStatus(errorToString(err));
    document.getElementById('nextBtn').disabled = true;
  }
}

async function startCamera() {
  try {
    stopCamera();
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: false
    });
    const video = document.getElementById('video');
    video.srcObject = stream;
    video.hidden = false;
    document.getElementById('captureBtn').disabled = false;
    setStatus('カメラを起動しました。');
  } catch (err) {
    setStatus('カメラを起動できません: ' + errorToString(err));
  }
}

function captureImage() {
  const video = document.getElementById('video');
  const canvas = document.getElementById('canvas');
  const width = video.videoWidth || 1280;
  const height = video.videoHeight || 720;
  canvas.width = width;
  canvas.height = height;
  canvas.getContext('2d').drawImage(video, 0, 0, width, height);
  canvas.toBlob(async blob => {
    await setImageBlob(blob, 'image.jpg', 'image/jpeg');
    stopCamera();
    setStatus('画像を保存しました。');
  }, 'image/jpeg', 0.88);
}

async function onFileChange(event) {
  const file = event.target.files && event.target.files[0];
  if (!file) return;
  if (!file.type || !file.type.startsWith('image/')) {
    setStatus('画像ファイルを選択してください。');
    return;
  }
  await setImageBlob(file, file.name || 'image.jpg', file.type || 'image/jpeg');
  setStatus('画像を選択しました。');
}

async function setImageBlob(blob, fileName, mimeType) {
  draft.image = {
    blob,
    fileName: fileName || 'image.jpg',
    mimeType: mimeType || blob.type || 'image/jpeg',
    capturedAt: new Date().toISOString()
  };
  draft.updatedAt = new Date().toISOString();
  await saveDraft(draft);
  renderPreview(blob);
}

async function clearImage() {
  draft.image = null;
  draft.updatedAt = new Date().toISOString();
  await saveDraft(draft);
  document.getElementById('preview').hidden = true;
  document.getElementById('preview').src = '';
  setStatus('画像をクリアしました。');
}

function renderPreview(blob) {
  const img = document.getElementById('preview');
  img.src = URL.createObjectURL(blob);
  img.hidden = false;
}

function goBack() {
  stopCamera();
  const token = getToken();
  const target = draft && draft.inputMode === 'text' ? 'text.html' : 'record.html';
  location.href = target + (token ? '?token=' + encodeURIComponent(token) : '');
}

async function goNext() {
  stopCamera();
  await saveDraft(draft);
  const token = getToken();
  location.href = 'confirm.html' + (token ? '?token=' + encodeURIComponent(token) : '');
}

function stopCamera() {
  if (stream) stream.getTracks().forEach(t => t.stop());
  stream = null;
  const video = document.getElementById('video');
  if (video) {
    video.srcObject = null;
    video.hidden = true;
  }
  document.getElementById('captureBtn').disabled = true;
}

function getToken() {
  const params = new URLSearchParams(location.search);
  return params.get('token') || sessionStorage.getItem('fieldReportToken') || (draft && draft.token) || '';
}
function setStatus(text) { document.getElementById('status').textContent = text || ''; }
function loadDraft() { return openDb().then(db => new Promise((resolve, reject) => { const tx = db.transaction(DRAFT_STORE_NAME, 'readonly'); const req = tx.objectStore(DRAFT_STORE_NAME).get(DRAFT_KEY); req.onsuccess = () => resolve(req.result || null); req.onerror = () => reject(req.error); })); }
function saveDraft(value) { return openDb().then(db => new Promise((resolve, reject) => { const tx = db.transaction(DRAFT_STORE_NAME, 'readwrite'); tx.objectStore(DRAFT_STORE_NAME).put(value, DRAFT_KEY); tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); })); }
function openDb() { return new Promise((resolve, reject) => { const req = indexedDB.open(DRAFT_DB_NAME, 1); req.onupgradeneeded = () => { const db = req.result; if (!db.objectStoreNames.contains(DRAFT_STORE_NAME)) db.createObjectStore(DRAFT_STORE_NAME); }; req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error); }); }
function errorToString(err) { return err && (err.message || err.stack) ? (err.message || err.stack) : String(err); }
