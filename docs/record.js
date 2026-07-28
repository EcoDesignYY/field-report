'use strict';

const DRAFT_DB_NAME = 'fieldReportDraftDb';
const DRAFT_STORE_NAME = 'drafts';
const DRAFT_KEY = 'currentDraft';
const MAX_RECORDING_MS = 2 * 60 * 1000;

let draft = null;
let mediaRecorder = null;
let stream = null;
let chunks = [];
let startedAt = 0;
let timerId = null;
let audioBlob = null;
let audioMimeType = '';

document.addEventListener('DOMContentLoaded', init);

async function init() {
  document.getElementById('backBtn').addEventListener('click', goBack);
  document.getElementById('startBtn').addEventListener('click', startRecording);
  document.getElementById('stopBtn').addEventListener('click', stopRecording);
  document.getElementById('nextBtn').addEventListener('click', goNext);

  try {
    draft = await loadDraft();
    if (!draft) throw new Error('下書きがありません。入力方法選択からやり直してください。');
    draft.inputMode = 'audio';
    draft.text = null;

    if (draft.audio && draft.audio.blob) {
      audioBlob = draft.audio.blob;
      audioMimeType = draft.audio.mimeType || audioBlob.type || 'audio/mp4';
      renderAudioPreview(audioBlob);
      document.getElementById('nextBtn').disabled = false;
      setStatus('録音済みです。必要に応じて録り直してください。');
    }
  } catch (err) {
    setStatus(errorToString(err));
    document.getElementById('startBtn').disabled = true;
  }
}

async function startRecording() {
  try {
    chunks = [];
    audioBlob = null;
    audioMimeType = getSupportedMimeType();

    stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    mediaRecorder = new MediaRecorder(stream, audioMimeType ? { mimeType: audioMimeType } : undefined);

    mediaRecorder.ondataavailable = event => {
      if (event.data && event.data.size > 0) chunks.push(event.data);
    };
    mediaRecorder.onstop = onRecorderStop;

    mediaRecorder.start();
    startedAt = Date.now();
    updateTimer();
    timerId = setInterval(updateTimer, 250);

    setButtons(true);
    setStatus('録音中です。');
    document.getElementById('recState').textContent = '録音中';

    setTimeout(() => {
      if (mediaRecorder && mediaRecorder.state === 'recording') stopRecording();
    }, MAX_RECORDING_MS + 300);
  } catch (err) {
    setStatus('録音を開始できません: ' + errorToString(err));
    stopStream();
  }
}

function stopRecording() {
  if (mediaRecorder && mediaRecorder.state === 'recording') mediaRecorder.stop();
}

async function onRecorderStop() {
  clearInterval(timerId);
  timerId = null;
  stopStream();

  audioBlob = new Blob(chunks, { type: audioMimeType || 'audio/mp4' });
  renderAudioPreview(audioBlob);

  const durationSec = Math.round((Date.now() - startedAt) / 1000);
  draft.inputMode = 'audio';
  draft.audio = {
    blob: audioBlob,
    mimeType: audioBlob.type || audioMimeType || 'audio/mp4',
    fileName: buildAudioFileName(audioBlob.type || audioMimeType || 'audio/mp4'),
    durationSec,
    recordedAt: new Date().toISOString()
  };
  draft.text = null;
  draft.updatedAt = new Date().toISOString();
  await saveDraft(draft);

  setButtons(false);
  document.getElementById('nextBtn').disabled = false;
  document.getElementById('recState').textContent = '録音完了';
  setStatus('録音を保存しました。');
}

async function goNext() {
  if (!audioBlob) {
    setStatus('先に録音してください。');
    return;
  }
  await saveDraft(draft);
  const token = getToken();
  location.href = 'capture.html' + (token ? '?token=' + encodeURIComponent(token) : '');
}

function goBack() {
  const token = getToken();
  location.href = 'input.html' + (token ? '?token=' + encodeURIComponent(token) : '');
}

function setButtons(recording) {
  document.getElementById('startBtn').disabled = recording;
  document.getElementById('stopBtn').disabled = !recording;
}

function updateTimer() {
  const sec = Math.min(Math.floor((Date.now() - startedAt) / 1000), 120);
  const m = String(Math.floor(sec / 60)).padStart(2, '0');
  const s = String(sec % 60).padStart(2, '0');
  document.getElementById('timer').textContent = `${m}:${s}`;
}

function renderAudioPreview(blob) {
  const audio = document.getElementById('audioPreview');
  audio.src = URL.createObjectURL(blob);
  audio.hidden = false;
}

function stopStream() {
  if (stream) stream.getTracks().forEach(t => t.stop());
  stream = null;
}

function getSupportedMimeType() {
  const candidates = ['audio/mp4', 'audio/aac', 'audio/webm;codecs=opus', 'audio/webm'];
  for (const type of candidates) {
    if (window.MediaRecorder && MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(type)) return type;
  }
  return '';
}

function buildAudioFileName(mimeType) {
  const ext = mimeType.includes('webm') ? 'webm' : mimeType.includes('aac') ? 'aac' : 'mp4';
  return 'audio.' + ext;
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
