'use strict';

/**
 * 録音画面 v0.1
 *
 * 役割:
 * - GAS入口から受け取ったtokenを保持
 * - iPhone Safari / Android Chrome / PC Chromeで録音
 * - 録音データをIndexedDBに保存
 * - 次画面へ遷移
 *
 * この画面ではDrive保存・GAS送信は行わない。
 */

const CONFIG = {
  NEXT_PAGE_URL: './capture.html',
  MAX_RECORDING_SECONDS: 120,
  DB_NAME: 'field-report-draft-db',
  DB_VERSION: 1,
  STORE_NAME: 'draft'
};

const els = {
  backButton: document.getElementById('backButton'),
  helpButton: document.getElementById('helpButton'),

  micStatusChip: document.getElementById('micStatusChip'),
  micStatusText: document.getElementById('micStatusText'),

  timerText: document.getElementById('timerText'),
  limitText: document.getElementById('limitText'),

  waveCanvas: document.getElementById('waveCanvas'),

  mainRecordButton: document.getElementById('mainRecordButton'),
  recordIcon: document.getElementById('recordIcon'),
  recordStateText: document.getElementById('recordStateText'),

  pauseButton: document.getElementById('pauseButton'),
  pauseText: document.getElementById('pauseText'),
  pauseIcon: document.getElementById('pauseIcon'),

  resetButton: document.getElementById('resetButton'),

  playbackCard: document.getElementById('playbackCard'),
  audioPlayer: document.getElementById('audioPlayer'),
  playButton: document.getElementById('playButton'),
  playbackStatus: document.getElementById('playbackStatus'),

  recordMemoInput: document.getElementById('recordMemoInput'),

  statusBox: document.getElementById('statusBox'),

  nextButton: document.getElementById('nextButton'),
  skipButton: document.getElementById('skipButton')
};

const state = {
  authToken: '',
  mediaRecorder: null,
  audioStream: null,
  audioChunks: [],
  audioBlob: null,
  audioMimeType: '',
  audioFileName: '',
  startedAt: 0,
  elapsedBeforePauseMs: 0,
  timerId: null,
  autoStopId: null,
  isRecording: false,
  isPaused: false,

  audioContext: null,
  analyser: null,
  analyserSource: null,
  waveAnimationId: null,
  waveData: [],
  levelData: new Uint8Array(128)
};

init();

async function init() {
  try {
    state.authToken = getTokenFromUrlOrSession();

    if (!state.authToken) {
      setStatus(
        'このページは直接開けません。\nGAS入口から開いてください。',
        'error'
      );
      disableControls();
      setMicStatus('認証が必要です', 'error');
      return;
    }

    if (!window.isSecureContext) {
      setStatus(
        'このページは安全な接続ではありません。\nカメラ・マイクを使用するにはHTTPSで開いてください。',
        'error'
      );
      disableControls();
      setMicStatus('HTTPSが必要です', 'error');
      return;
    }

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setStatus('このブラウザはマイク取得に対応していません。', 'error');
      disableControls();
      setMicStatus('非対応ブラウザ', 'error');
      return;
    }

    if (!window.MediaRecorder) {
      setStatus('このブラウザは録音機能に対応していません。', 'error');
      disableControls();
      setMicStatus('録音非対応', 'error');
      return;
    }

    bindEvents();
    drawIdleWave();
    els.limitText.textContent = `最大 ${formatSeconds(CONFIG.MAX_RECORDING_SECONDS)}`;
    setMicStatus('マイク準備完了', 'ready');
    setStatus(getRecommendedBrowserMessage(), 'ok');

    await restoreDraftAudioIfExists();

  } catch (error) {
    setStatus(`初期化エラー: ${error.message}`, 'error');
    disableControls();
  }
}

function bindEvents() {
  els.backButton.addEventListener('click', () => {
    history.back();
  });

  els.helpButton.addEventListener('click', () => {
    setStatus(
      '録音のコツ:\n' +
      '・現場の状況を30秒〜2分で話してください。\n' +
      '・異音がある場合は、音の発生箇所に近づけて録音してください。\n' +
      '・iPhoneはSafariでの利用を推奨します。',
      'ok'
    );
  });

  els.mainRecordButton.addEventListener('click', handleMainRecordButtonClick);
  els.pauseButton.addEventListener('click', togglePauseRecording);
  els.resetButton.addEventListener('click', resetRecording);
  els.playButton.addEventListener('click', togglePlayback);

  els.audioPlayer.addEventListener('ended', () => {
    els.playButton.textContent = '再生';
    els.playbackStatus.textContent = '再生終了';
  });

  els.nextButton.addEventListener('click', saveAndGoNext);
  els.skipButton.addEventListener('click', skipAndGoNext);
}

function getTokenFromUrlOrSession() {
  const url = new URL(location.href);
  const tokenFromUrl = url.searchParams.get('token');

  if (tokenFromUrl) {
    sessionStorage.setItem('fieldReportToken', tokenFromUrl);

    url.searchParams.delete('token');
    history.replaceState({}, document.title, url.toString());

    return tokenFromUrl;
  }

  return sessionStorage.getItem('fieldReportToken') || '';
}

async function handleMainRecordButtonClick() {
  if (!state.isRecording && !state.audioBlob) {
    await startRecording();
    return;
  }

  if (state.isRecording) {
    stopRecording();
    return;
  }

  if (state.audioBlob) {
    await startRecording();
  }
}

async function startRecording() {
  try {
    await resetRecording({ silent: true });

    state.audioStream = await navigator.mediaDevices.getUserMedia({
      audio: true,
      video: false
    });

    state.audioMimeType = getSupportedAudioMimeType();

    if (!state.audioMimeType) {
      throw new Error('このブラウザで利用可能な録音形式が見つかりません。');
    }

    state.mediaRecorder = new MediaRecorder(state.audioStream, {
      mimeType: state.audioMimeType
    });

    state.audioChunks = [];

    state.mediaRecorder.addEventListener('dataavailable', (event) => {
      if (event.data && event.data.size > 0) {
        state.audioChunks.push(event.data);
      }
    });

    state.mediaRecorder.addEventListener('stop', handleRecordingStopped);

    setupWaveAnalyser(state.audioStream);

    state.mediaRecorder.start(250);
    state.startedAt = Date.now();
    state.elapsedBeforePauseMs = 0;
    state.isRecording = true;
    state.isPaused = false;

    startTimer();
    startWaveAnimation();

    state.autoStopId = window.setTimeout(() => {
      if (state.isRecording) {
        stopRecording();
      }
    }, CONFIG.MAX_RECORDING_SECONDS * 1000);

    updateRecordingUi('recording');
    setMicStatus('録音中', 'recording');
    setStatus('録音中です。停止するとプレビューできます。', 'ok');

  } catch (error) {
    cleanupRecordingResources();
    updateRecordingUi('idle');
    setMicStatus('録音できません', 'error');

    setStatus(
      `録音を開始できませんでした。\n\n` +
      `原因候補:\n` +
      `・マイク権限が拒否されている\n` +
      `・iPhoneのChromeで開いている\n` +
      `・Safari以外のアプリ内ブラウザで開いている\n` +
      `・端末側でマイク使用が制限されている\n\n` +
      `対処:\n` +
      `・iPhoneはSafariで開いてください\n` +
      `・ecodesignyy.github.io のマイク権限を許可してください\n` +
      `・一度ブラウザを閉じ、GAS入口から開き直してください\n\n` +
      `詳細: ${error.message}`,
      'error'
    );
  }
}

function stopRecording() {
  if (!state.mediaRecorder || !state.isRecording) {
    return;
  }

  if (state.mediaRecorder.state !== 'inactive') {
    state.mediaRecorder.stop();
  }

  state.isRecording = false;
  state.isPaused = false;

  stopTimer();
  stopWaveAnimation();
  cleanupStreamOnly();

  if (state.autoStopId) {
    window.clearTimeout(state.autoStopId);
    state.autoStopId = null;
  }

  updateRecordingUi('stopping');
  setMicStatus('録音処理中', 'ready');
}

async function handleRecordingStopped() {
  try {
    state.audioBlob = new Blob(state.audioChunks, {
      type: state.audioMimeType
    });

    state.audioFileName = buildAudioFileName(state.audioMimeType);

    setupPlayback(state.audioBlob);

    await saveDraftToIndexedDb();

    updateRecordingUi('recorded');
    setMicStatus('録音完了', 'ready');
    setStatus('録音が完了しました。必要に応じて再生確認できます。', 'ok');

  } catch (error) {
    setStatus(`録音保存エラー: ${error.message}`, 'error');
  } finally {
    cleanupRecordingResources();
  }
}

function togglePauseRecording() {
  if (!state.mediaRecorder || !state.isRecording) {
    return;
  }

  if (!state.isPaused) {
    if (state.mediaRecorder.state === 'recording') {
      state.mediaRecorder.pause();
    }

    state.elapsedBeforePauseMs += Date.now() - state.startedAt;
    state.isPaused = true;

    stopTimer();
    stopWaveAnimation();

    els.pauseText.textContent = '再開';
    els.pauseIcon.textContent = '▶';
    els.recordStateText.textContent = '一時停止中';
    els.recordStateText.classList.remove('recording');
    els.mainRecordButton.classList.remove('recording');
    els.mainRecordButton.classList.add('paused');
    setMicStatus('一時停止中', 'ready');

  } else {
    if (state.mediaRecorder.state === 'paused') {
      state.mediaRecorder.resume();
    }

    state.startedAt = Date.now();
    state.isPaused = false;

    startTimer();
    startWaveAnimation();

    els.pauseText.textContent = '一時停止';
    els.pauseIcon.textContent = 'Ⅱ';
    els.recordStateText.textContent = '録音中';
    els.recordStateText.classList.add('recording');
    els.mainRecordButton.classList.remove('paused');
    els.mainRecordButton.classList.add('recording');
    setMicStatus('録音中', 'recording');
  }
}

async function resetRecording(options = {}) {
  const silent = Boolean(options.silent);

  if (state.mediaRecorder && state.mediaRecorder.state !== 'inactive') {
    try {
      state.mediaRecorder.stop();
    } catch (_) {
      // ignore
    }
  }

  stopTimer();
  stopWaveAnimation();
  cleanupRecordingResources();

  if (state.audioPlayerUrl) {
    URL.revokeObjectURL(state.audioPlayerUrl);
    state.audioPlayerUrl = '';
  }

  state.audioChunks = [];
  state.audioBlob = null;
  state.audioMimeType = '';
  state.audioFileName = '';
  state.startedAt = 0;
  state.elapsedBeforePauseMs = 0;
  state.isRecording = false;
  state.isPaused = false;

  els.audioPlayer.pause();
  els.audioPlayer.removeAttribute('src');
  els.audioPlayer.load();
  els.playbackCard.classList.add('hidden');
  els.playButton.textContent = '再生';
  els.playbackStatus.textContent = '未録音';

  els.timerText.textContent = '00:00';

  updateRecordingUi('idle');
  drawIdleWave();

  await deleteDraftKey('audioBlob');
  await deleteDraftKey('audioMeta');

  if (!silent) {
    setMicStatus('マイク準備完了', 'ready');
    setStatus('録音をリセットしました。', 'ok');
  }
}

async function saveAndGoNext() {
  try {
    if (!state.audioBlob) {
      setStatus('録音データがありません。録音してから次へ進んでください。', 'error');
      return;
    }

    await saveDraftToIndexedDb();

    sessionStorage.setItem('fieldReportHasAudio', '1');
    location.href = CONFIG.NEXT_PAGE_URL;

  } catch (error) {
    setStatus(`保存エラー: ${error.message}`, 'error');
  }
}

async function skipAndGoNext() {
  sessionStorage.setItem('fieldReportHasAudio', '0');
  location.href = CONFIG.NEXT_PAGE_URL;
}

function setupPlayback(blob) {
  const oldUrl = els.audioPlayer.dataset.objectUrl;
  if (oldUrl) {
    URL.revokeObjectURL(oldUrl);
  }

  const url = URL.createObjectURL(blob);
  els.audioPlayer.src = url;
  els.audioPlayer.dataset.objectUrl = url;

  els.playbackCard.classList.remove('hidden');
  els.playButton.textContent = '再生';
  els.playbackStatus.textContent = '録音済み・再生できます';
}

async function togglePlayback() {
  if (!els.audioPlayer.src) {
    setStatus('再生できる音声がありません。', 'error');
    return;
  }

  try {
    if (els.audioPlayer.paused) {
      await els.audioPlayer.play();
      els.playButton.textContent = '停止';
      els.playbackStatus.textContent = '再生中';
    } else {
      els.audioPlayer.pause();
      els.playButton.textContent = '再生';
      els.playbackStatus.textContent = '一時停止中';
    }
  } catch (error) {
    setStatus(`音声の再生に失敗しました: ${error.message}`, 'error');
  }
}

function updateRecordingUi(mode) {
  els.mainRecordButton.classList.remove('idle', 'recording', 'paused');
  els.recordStateText.classList.remove('recording');

  switch (mode) {
    case 'recording':
      els.mainRecordButton.classList.add('recording');
      els.recordStateText.textContent = '録音中';
      els.recordStateText.classList.add('recording');
      els.pauseButton.disabled = false;
      els.resetButton.disabled = false;
      els.nextButton.disabled = true;
      els.pauseText.textContent = '一時停止';
      els.pauseIcon.textContent = 'Ⅱ';
      break;

    case 'stopping':
      els.mainRecordButton.classList.add('paused');
      els.recordStateText.textContent = '保存中';
      els.pauseButton.disabled = true;
      els.resetButton.disabled = true;
      els.nextButton.disabled = true;
      break;

    case 'recorded':
      els.mainRecordButton.classList.add('idle');
      els.recordStateText.textContent = '録音済み';
      els.pauseButton.disabled = true;
      els.resetButton.disabled = false;
      els.nextButton.disabled = false;
      break;

    case 'idle':
    default:
      els.mainRecordButton.classList.add('idle');
      els.recordStateText.textContent = '録音開始';
      els.pauseButton.disabled = true;
      els.resetButton.disabled = true;
      els.nextButton.disabled = true;
      els.pauseText.textContent = '一時停止';
      els.pauseIcon.textContent = 'Ⅱ';
      break;
  }
}

function startTimer() {
  stopTimer();

  state.timerId = window.setInterval(() => {
    const elapsed = getElapsedMs();
    const seconds = Math.floor(elapsed / 1000);

    els.timerText.textContent = formatSeconds(seconds);

    if (seconds >= CONFIG.MAX_RECORDING_SECONDS) {
      stopRecording();
    }
  }, 250);
}

function stopTimer() {
  if (state.timerId) {
    window.clearInterval(state.timerId);
    state.timerId = null;
  }

  if (state.autoStopId) {
    window.clearTimeout(state.autoStopId);
    state.autoStopId = null;
  }
}

function getElapsedMs() {
  if (!state.isRecording) {
    return state.elapsedBeforePauseMs;
  }

  if (state.isPaused) {
    return state.elapsedBeforePauseMs;
  }

  return state.elapsedBeforePauseMs + (Date.now() - state.startedAt);
}

function setupWaveAnalyser(stream) {
  try {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) {
      return;
    }

    state.audioContext = new AudioContextClass();
    state.analyser = state.audioContext.createAnalyser();
    state.analyser.fftSize = 256;

    state.analyserSource = state.audioContext.createMediaStreamSource(stream);
    state.analyserSource.connect(state.analyser);

    state.levelData = new Uint8Array(state.analyser.frequencyBinCount);
    state.waveData = [];

  } catch (_) {
    // 波形が使えなくても録音は継続する
  }
}

function startWaveAnimation() {
  stopWaveAnimation();

  const canvas = els.waveCanvas;
  const ctx = canvas.getContext('2d');

  const draw = () => {
    drawWave(ctx, canvas);
    state.waveAnimationId = window.requestAnimationFrame(draw);
  };

  draw();
}

function stopWaveAnimation() {
  if (state.waveAnimationId) {
    window.cancelAnimationFrame(state.waveAnimationId);
    state.waveAnimationId = null;
  }
}

function drawWave(ctx, canvas) {
  const width = canvas.width;
  const height = canvas.height;
  const centerY = height / 2;

  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);

  let volume = 0.02;

  if (state.analyser) {
    state.analyser.getByteFrequencyData(state.levelData);

    let sum = 0;
    for (let i = 0; i < state.levelData.length; i += 1) {
      sum += state.levelData[i];
    }

    volume = Math.max(0.02, Math.min(1, sum / state.levelData.length / 128));
  }

  state.waveData.push(volume);

  const maxBars = 70;
  if (state.waveData.length > maxBars) {
    state.waveData.shift();
  }

  const barWidth = width / maxBars;
  const gap = 3;

  ctx.strokeStyle = '#009688';
  ctx.lineWidth = 3;
  ctx.lineCap = 'round';

  for (let i = 0; i < state.waveData.length; i += 1) {
    const value = state.waveData[i];
    const x = i * barWidth + barWidth / 2;
    const barHeight = Math.max(6, value * height * 0.78);

    ctx.beginPath();
    ctx.moveTo(x, centerY - barHeight / 2);
    ctx.lineTo(x, centerY + barHeight / 2);
    ctx.stroke();
  }

  ctx.strokeStyle = '#0f766e';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(width - 10, 28);
  ctx.lineTo(width - 10, height - 28);
  ctx.stroke();

  ctx.fillStyle = '#009688';
  ctx.beginPath();
  ctx.arc(width - 10, centerY, 5, 0, Math.PI * 2);
  ctx.fill();
}

function drawIdleWave() {
  const canvas = els.waveCanvas;
  const ctx = canvas.getContext('2d');

  const width = canvas.width;
  const height = canvas.height;
  const centerY = height / 2;

  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);

  ctx.strokeStyle = '#b6c7d8';
  ctx.lineWidth = 3;
  ctx.lineCap = 'round';

  const bars = 50;
  const barWidth = width / bars;

  for (let i = 0; i < bars; i += 1) {
    const x = i * barWidth + barWidth / 2;
    const base = Math.sin(i * 0.72) * 0.5 + 0.5;
    const barHeight = 8 + base * 42;

    ctx.beginPath();
    ctx.moveTo(x, centerY - barHeight / 2);
    ctx.lineTo(x, centerY + barHeight / 2);
    ctx.stroke();
  }
}

function cleanupRecordingResources() {
  cleanupStreamOnly();

  if (state.analyserSource) {
    try {
      state.analyserSource.disconnect();
    } catch (_) {
      // ignore
    }
    state.analyserSource = null;
  }

  if (state.audioContext) {
    try {
      state.audioContext.close();
    } catch (_) {
      // ignore
    }
    state.audioContext = null;
  }

  state.analyser = null;
}

function cleanupStreamOnly() {
  if (state.audioStream) {
    state.audioStream.getTracks().forEach((track) => track.stop());
    state.audioStream = null;
  }
}

function getSupportedAudioMimeType() {
  const candidates = [
    'audio/mp4',
    'audio/aac',
    'audio/webm;codecs=opus',
    'audio/webm'
  ];

  for (const type of candidates) {
    if (MediaRecorder.isTypeSupported(type)) {
      return type;
    }
  }

  return '';
}

function buildAudioFileName(mimeType) {
  const ext = mimeType.includes('mp4')
    ? 'mp4'
    : mimeType.includes('aac')
      ? 'aac'
      : 'webm';

  return `audio_${formatDateForFile(new Date())}.${ext}`;
}

async function saveDraftToIndexedDb() {
  const memo = els.recordMemoInput.value.trim();

  if (state.audioBlob) {
    await putDraft('audioBlob', state.audioBlob);
  }

  await putDraft('audioMeta', {
    fileName: state.audioFileName,
    mimeType: state.audioMimeType,
    size: state.audioBlob ? state.audioBlob.size : 0,
    memo,
    savedAt: new Date().toISOString()
  });
}

async function restoreDraftAudioIfExists() {
  const blob = await getDraft('audioBlob');
  const meta = await getDraft('audioMeta');

  if (!blob) {
    return;
  }

  state.audioBlob = blob;
  state.audioMimeType = meta && meta.mimeType ? meta.mimeType : blob.type;
  state.audioFileName = meta && meta.fileName ? meta.fileName : buildAudioFileName(state.audioMimeType);

  if (meta && meta.memo) {
    els.recordMemoInput.value = meta.memo;
  }

  setupPlayback(blob);
  updateRecordingUi('recorded');
  setStatus('前回保存した録音データを復元しました。', 'ok');
}

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(CONFIG.DB_NAME, CONFIG.DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(CONFIG.STORE_NAME)) {
        db.createObjectStore(CONFIG.STORE_NAME);
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error('IndexedDBを開けませんでした。'));
  });
}

async function putDraft(key, value) {
  const db = await openDb();

  return new Promise((resolve, reject) => {
    const tx = db.transaction(CONFIG.STORE_NAME, 'readwrite');
    tx.objectStore(CONFIG.STORE_NAME).put(value, key);
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      db.close();
      reject(new Error('下書き保存に失敗しました。'));
    };
  });
}

async function getDraft(key) {
  const db = await openDb();

  return new Promise((resolve, reject) => {
    const tx = db.transaction(CONFIG.STORE_NAME, 'readonly');
    const request = tx.objectStore(CONFIG.STORE_NAME).get(key);

    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(new Error('下書き取得に失敗しました。'));

    tx.oncomplete = () => db.close();
  });
}

async function deleteDraftKey(key) {
  const db = await openDb();

  return new Promise((resolve, reject) => {
    const tx = db.transaction(CONFIG.STORE_NAME, 'readwrite');
    tx.objectStore(CONFIG.STORE_NAME).delete(key);
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      db.close();
      reject(new Error('下書き削除に失敗しました。'));
    };
  });
}

function setMicStatus(text, mode) {
  els.micStatusText.textContent = text;
  els.micStatusChip.classList.remove('error', 'recording');

  if (mode === 'error') {
    els.micStatusChip.classList.add('error');
  }

  if (mode === 'recording') {
    els.micStatusChip.classList.add('recording');
  }
}

function setStatus(message, type) {
  els.statusBox.textContent = message;
  els.statusBox.classList.remove('ok', 'error');

  if (type === 'ok') {
    els.statusBox.classList.add('ok');
  }

  if (type === 'error') {
    els.statusBox.classList.add('error');
  }
}

function disableControls() {
  els.mainRecordButton.disabled = true;
  els.pauseButton.disabled = true;
  els.resetButton.disabled = true;
  els.nextButton.disabled = true;
  els.skipButton.disabled = true;
}

function getRecommendedBrowserMessage() {
  const ua = navigator.userAgent || '';

  if (/iPhone|iPad|iPod/.test(ua) && /CriOS/.test(ua)) {
    return 'iPhoneのChromeでは録音できない場合があります。\nSafariでの利用を推奨します。';
  }

  return '録音準備ができました。';
}

function formatSeconds(totalSeconds) {
  const seconds = Math.max(0, Number(totalSeconds) || 0);
  const mm = String(Math.floor(seconds / 60)).padStart(2, '0');
  const ss = String(seconds % 60).padStart(2, '0');
  return `${mm}:${ss}`;
}

function formatDateForFile(date) {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  const hh = String(date.getHours()).padStart(2, '0');
  const mi = String(date.getMinutes()).padStart(2, '0');
  const ss = String(date.getSeconds()).padStart(2, '0');

  return `${yyyy}${mm}${dd}_${hh}${mi}${ss}`;
}
