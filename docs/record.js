(() => {
  const CONFIG = {
    DB_NAME: 'field-report-draft-db',
    DB_VERSION: 1,
    STORE_NAME: 'draft',
    AUTH_TOKEN_STORAGE_KEY: 'fieldReportAuthToken',
    MAX_RECORDING_SECONDS: 120,
    NEXT_PAGE_URL: './capture.html'
  };

  const state = {
    db: null,
    authToken: '',
    mediaStream: null,
    mediaRecorder: null,
    audioChunks: [],
    audioBlob: null,
    audioObjectUrl: '',
    audioContext: null,
    analyser: null,
    waveformData: null,
    animationId: null,
    startedAt: 0,
    elapsedMs: 0,
    timerId: null,
    status: 'idle',
    mimeType: ''
  };

  const els = {};

  document.addEventListener('DOMContentLoaded', init);

  async function init() {
    collectElements();
    bindEvents();

    state.authToken = getAuthTokenFromUrlOrStorage();

    if (!state.authToken) {
      setFatalState('認証情報がありません。GAS入口から開き直してください。');
      return;
    }

    try {
      state.db = await openDb();
      clearWaveform();
      await loadExistingDraft();
      setStatus('', '');
      setRecordStatus('マイク準備完了', 'ready');
    } catch (error) {
      setFatalState('初期化に失敗しました。\n' + getErrorMessage(error));
    }
  }

  function collectElements() {
    els.backButton = document.getElementById('backButton');
    els.helpButton = document.getElementById('helpButton');
    els.recordStatusBadge = document.getElementById('recordStatusBadge');
    els.timerText = document.getElementById('timerText');
    els.waveCanvas = document.getElementById('waveCanvas');
    els.recordButton = document.getElementById('recordButton');
    els.recordIcon = document.getElementById('recordIcon');
    els.recordLabel = document.getElementById('recordLabel');
    els.pauseButton = document.getElementById('pauseButton');
    els.resetButton = document.getElementById('resetButton');
    els.audioPreviewArea = document.getElementById('audioPreviewArea');
    els.playAudioButton = document.getElementById('playAudioButton');
    els.audioPlayStatus = document.getElementById('audioPlayStatus');
    els.audioPlayer = document.getElementById('audioPlayer');
    els.audioMemoInput = document.getElementById('audioMemoInput');
    els.nextButton = document.getElementById('nextButton');
    els.statusBox = document.getElementById('statusBox');
  }

  function bindEvents() {
    els.backButton.addEventListener('click', () => {
      history.back();
    });

    els.helpButton.addEventListener('click', () => {
      setStatus(
        '録音ボタンを押すと録音を開始します。もう一度押すと停止します。\n録音後、必要に応じて再生確認してから次へ進んでください。',
        'info'
      );
    });

    els.recordButton.addEventListener('click', handleRecordButtonClick);
    els.pauseButton.addEventListener('click', togglePauseRecording);
    els.resetButton.addEventListener('click', resetRecording);
    els.playAudioButton.addEventListener('click', toggleAudioPlayback);
    els.nextButton.addEventListener('click', saveAndGoNext);

    els.audioPlayer.addEventListener('ended', () => {
      els.playAudioButton.textContent = '再生';
      els.audioPlayStatus.textContent = '再生が終了しました';
    });
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

    return (
      sessionStorage.getItem(CONFIG.AUTH_TOKEN_STORAGE_KEY) ||
      sessionStorage.getItem('fieldReportToken') ||
      ''
    );
  }

  async function handleRecordButtonClick() {
    if (state.status === 'idle' || state.status === 'recorded') {
      await startRecording();
      return;
    }

    if (state.status === 'recording' || state.status === 'paused') {
      await stopRecording();
    }
  }

  async function startRecording() {
    try {
      resetRecording(false);

      if (!window.isSecureContext) {
        throw new Error('録音にはHTTPS環境が必要です。GitHub PagesのURLを直接開いてください。');
      }

      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error('このブラウザは録音機能に対応していません。iPhoneはSafari、AndroidはChromeを使用してください。');
      }

      if (typeof MediaRecorder === 'undefined') {
        throw new Error('このブラウザはMediaRecorderに対応していません。');
      }

      state.mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      state.mimeType = getSupportedAudioMimeType();

      const options = state.mimeType ? { mimeType: state.mimeType } : undefined;
      state.mediaRecorder = new MediaRecorder(state.mediaStream, options);
      state.audioChunks = [];

      state.mediaRecorder.ondataavailable = event => {
        if (event.data && event.data.size > 0) {
          state.audioChunks.push(event.data);
        }
      };

      state.mediaRecorder.onerror = event => {
        setStatus('録音中にエラーが発生しました。\n' + getErrorMessage(event.error || event), 'error');
      };

      state.mediaRecorder.onstop = handleRecorderStop;

      setupWaveform(state.mediaStream);

      state.startedAt = Date.now();
      state.elapsedMs = 0;
      state.status = 'recording';
      state.mediaRecorder.start(1000);

      startTimer();
      startWaveform();

      renderState();
      setStatus('', '');

    } catch (error) {
      cleanupStream();
      setRecordStatus('録音不可', 'error');
      setStatus('録音を開始できませんでした。\n' + getErrorMessage(error), 'error');
    }
  }

  async function stopRecording() {
    if (!state.mediaRecorder) return;

    try {
      if (state.status === 'recording') {
        state.elapsedMs += Date.now() - state.startedAt;
      }

      if (state.mediaRecorder.state !== 'inactive') {
        state.mediaRecorder.stop();
      }
    } catch (error) {
      setStatus('録音停止に失敗しました。\n' + getErrorMessage(error), 'error');
    }
  }

  function handleRecorderStop() {
    stopTimer();
    stopWaveform();

    const mimeType = state.mimeType || (state.audioChunks[0] ? state.audioChunks[0].type : '') || 'audio/webm';
    state.audioBlob = new Blob(state.audioChunks, { type: mimeType });

    cleanupStream();

    if (state.audioBlob.size <= 0) {
      state.status = 'idle';
      setRecordStatus('録音失敗', 'error');
      setStatus('録音データが作成されませんでした。もう一度録音してください。', 'error');
      renderState();
      return;
    }

    if (state.audioObjectUrl) {
      URL.revokeObjectURL(state.audioObjectUrl);
    }

    state.audioObjectUrl = URL.createObjectURL(state.audioBlob);
    els.audioPlayer.src = state.audioObjectUrl;

    state.status = 'recorded';
    setRecordStatus('録音済み', 'ready');
    els.audioPreviewArea.classList.remove('hidden');
    els.playAudioButton.disabled = false;
    els.audioPlayStatus.textContent = '再生できます';

    renderState();
  }

  function togglePauseRecording() {
    if (!state.mediaRecorder) return;

    if (state.mediaRecorder.state === 'recording') {
      state.mediaRecorder.pause();
      state.elapsedMs += Date.now() - state.startedAt;
      state.status = 'paused';
      stopTimer();
      setRecordStatus('一時停止中', 'paused');
      renderState();
      return;
    }

    if (state.mediaRecorder.state === 'paused') {
      state.mediaRecorder.resume();
      state.startedAt = Date.now();
      state.status = 'recording';
      startTimer();
      setRecordStatus('録音中', 'recording');
      renderState();
    }
  }

  function resetRecording(showMessage = true) {
    stopTimer();
    stopWaveform();

    if (state.mediaRecorder && state.mediaRecorder.state !== 'inactive') {
      try {
        state.mediaRecorder.stop();
      } catch (_) {}
    }

    cleanupStream();

    if (state.audioObjectUrl) {
      URL.revokeObjectURL(state.audioObjectUrl);
      state.audioObjectUrl = '';
    }

    state.mediaRecorder = null;
    state.audioChunks = [];
    state.audioBlob = null;
    state.startedAt = 0;
    state.elapsedMs = 0;
    state.status = 'idle';
    state.mimeType = '';

    els.audioPlayer.removeAttribute('src');
    els.audioPlayer.load();
    els.audioPreviewArea.classList.add('hidden');
    els.playAudioButton.disabled = true;
    els.playAudioButton.textContent = '再生';
    els.audioPlayStatus.textContent = '未録音';

    renderTimer(0);
    clearWaveform();
    renderState();

    if (showMessage) {
      setStatus('録音をリセットしました。', 'info');
    }
  }

  function toggleAudioPlayback() {
    if (!state.audioBlob) return;

    if (els.audioPlayer.paused) {
      els.audioPlayer.play()
        .then(() => {
          els.playAudioButton.textContent = '停止';
          els.audioPlayStatus.textContent = '再生中';
        })
        .catch(error => {
          setStatus('音声を再生できませんでした。\n' + getErrorMessage(error), 'error');
        });
    } else {
      els.audioPlayer.pause();
      els.audioPlayer.currentTime = 0;
      els.playAudioButton.textContent = '再生';
      els.audioPlayStatus.textContent = '停止しました';
    }
  }

  async function saveAndGoNext() {
    if (!state.audioBlob) {
      setStatus('録音データがありません。録音してから次へ進んでください。', 'error');
      return;
    }

    try {
      const meta = {
        mimeType: state.audioBlob.type || state.mimeType || 'audio/webm',
        size: state.audioBlob.size,
        durationSec: Math.max(1, Math.round(state.elapsedMs / 1000)),
        memo: els.audioMemoInput.value.trim(),
        savedAt: new Date().toISOString()
      };

      await putDraft('audioBlob', state.audioBlob);
      await putDraft('audioMeta', meta);

      location.href = CONFIG.NEXT_PAGE_URL;

    } catch (error) {
      setStatus('録音データの保存に失敗しました。\n' + getErrorMessage(error), 'error');
    }
  }

  async function loadExistingDraft() {
    const audioBlob = await getDraft('audioBlob');
    const audioMeta = await getDraft('audioMeta');

    if (audioBlob) {
      state.audioBlob = audioBlob;
      state.status = 'recorded';
      state.elapsedMs = audioMeta && audioMeta.durationSec ? Number(audioMeta.durationSec) * 1000 : 0;

      if (state.audioObjectUrl) {
        URL.revokeObjectURL(state.audioObjectUrl);
      }

      state.audioObjectUrl = URL.createObjectURL(audioBlob);
      els.audioPlayer.src = state.audioObjectUrl;
      els.audioPreviewArea.classList.remove('hidden');
      els.playAudioButton.disabled = false;
      els.audioPlayStatus.textContent = '再生できます';

      if (audioMeta && audioMeta.memo) {
        els.audioMemoInput.value = audioMeta.memo;
      }

      renderTimer(state.elapsedMs);
      renderState();
    } else {
      renderState();
    }
  }

  function setupWaveform(stream) {
    try {
      state.audioContext = new (window.AudioContext || window.webkitAudioContext)();
      const source = state.audioContext.createMediaStreamSource(stream);
      state.analyser = state.audioContext.createAnalyser();
      state.analyser.fftSize = 2048;
      source.connect(state.analyser);
      state.waveformData = new Uint8Array(state.analyser.fftSize);
    } catch (_) {
      state.audioContext = null;
      state.analyser = null;
      state.waveformData = null;
    }
  }

  function startWaveform() {
    const canvas = els.waveCanvas;
    const ctx = canvas.getContext('2d');

    const draw = () => {
      state.animationId = requestAnimationFrame(draw);

      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = '#f8fafc';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      if (!state.analyser || !state.waveformData) {
        drawFlatLine(ctx, canvas);
        return;
      }

      state.analyser.getByteTimeDomainData(state.waveformData);

      ctx.lineWidth = 4;
      ctx.strokeStyle = '#0f172a';
      ctx.beginPath();

      const sliceWidth = canvas.width / state.waveformData.length;
      let x = 0;

      for (let i = 0; i < state.waveformData.length; i++) {
        const v = state.waveformData[i] / 128.0;
        const y = v * canvas.height / 2;

        if (i === 0) {
          ctx.moveTo(x, y);
        } else {
          ctx.lineTo(x, y);
        }

        x += sliceWidth;
      }

      ctx.lineTo(canvas.width, canvas.height / 2);
      ctx.stroke();
    };

    draw();
  }

  function stopWaveform() {
    if (state.animationId) {
      cancelAnimationFrame(state.animationId);
      state.animationId = null;
    }

    if (state.audioContext) {
      try {
        state.audioContext.close();
      } catch (_) {}
    }

    state.audioContext = null;
    state.analyser = null;
    state.waveformData = null;
  }

  function clearWaveform() {
    const canvas = els.waveCanvas;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#f8fafc';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    drawFlatLine(ctx, canvas);
  }

  function drawFlatLine(ctx, canvas) {
    ctx.lineWidth = 3;
    ctx.strokeStyle = '#cbd5e1';
    ctx.beginPath();
    ctx.moveTo(0, canvas.height / 2);
    ctx.lineTo(canvas.width, canvas.height / 2);
    ctx.stroke();
  }

  function startTimer() {
    stopTimer();

    state.timerId = window.setInterval(() => {
      const ms = getCurrentElapsedMs();
      renderTimer(ms);

      if (ms >= CONFIG.MAX_RECORDING_SECONDS * 1000) {
        stopRecording();
      }
    }, 250);
  }

  function stopTimer() {
    if (state.timerId) {
      window.clearInterval(state.timerId);
      state.timerId = null;
    }
  }

  function getCurrentElapsedMs() {
    if (state.status === 'recording') {
      return state.elapsedMs + (Date.now() - state.startedAt);
    }

    return state.elapsedMs;
  }

  function renderTimer(ms) {
    const totalSec = Math.max(0, Math.floor(ms / 1000));
    const min = Math.floor(totalSec / 60);
    const sec = totalSec % 60;
    els.timerText.textContent = pad2(min) + ':' + pad2(sec);
  }

  function renderState() {
    const isRecording = state.status === 'recording';
    const isPaused = state.status === 'paused';
    const isRecorded = state.status === 'recorded';

    els.recordButton.classList.toggle('recording', isRecording);
    els.recordButton.classList.toggle('paused', isPaused);

    if (isRecording) {
      els.recordLabel.textContent = '録音中';
      els.pauseButton.disabled = false;
      els.pauseButton.textContent = '一時停止';
      els.resetButton.disabled = false;
      els.nextButton.disabled = true;
      setRecordStatus('録音中', 'recording');
    } else if (isPaused) {
      els.recordLabel.textContent = '停止して保存';
      els.pauseButton.disabled = false;
      els.pauseButton.textContent = '再開';
      els.resetButton.disabled = false;
      els.nextButton.disabled = true;
      setRecordStatus('一時停止中', 'paused');
    } else if (isRecorded) {
      els.recordLabel.textContent = '録り直す';
      els.pauseButton.disabled = true;
      els.pauseButton.textContent = '一時停止';
      els.resetButton.disabled = false;
      els.nextButton.disabled = false;
      setRecordStatus('録音済み', 'ready');
    } else {
      els.recordLabel.textContent = '録音開始';
      els.pauseButton.disabled = true;
      els.pauseButton.textContent = '一時停止';
      els.resetButton.disabled = true;
      els.nextButton.disabled = true;
    }
  }

  function setRecordStatus(text, type) {
    els.recordStatusBadge.textContent = text;
    els.recordStatusBadge.classList.remove('status-ready', 'status-recording', 'status-paused', 'status-error');

    if (type === 'recording') {
      els.recordStatusBadge.classList.add('status-recording');
    } else if (type === 'paused') {
      els.recordStatusBadge.classList.add('status-paused');
    } else if (type === 'error') {
      els.recordStatusBadge.classList.add('status-error');
    } else {
      els.recordStatusBadge.classList.add('status-ready');
    }
  }

  function cleanupStream() {
    if (state.mediaStream) {
      state.mediaStream.getTracks().forEach(track => track.stop());
      state.mediaStream = null;
    }
  }

  function getSupportedAudioMimeType() {
    const candidates = [
      'audio/mp4',
      'audio/aac',
      'audio/webm;codecs=opus',
      'audio/webm',
      'audio/mpeg'
    ];

    for (const type of candidates) {
      if (MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(type)) {
        return type;
      }
    }

    return '';
  }

  function openDb() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(CONFIG.DB_NAME, CONFIG.DB_VERSION);

      req.onupgradeneeded = event => {
        const db = event.target.result;

        if (!db.objectStoreNames.contains(CONFIG.STORE_NAME)) {
          db.createObjectStore(CONFIG.STORE_NAME);
        }
      };

      req.onsuccess = event => resolve(event.target.result);
      req.onerror = event => reject(event.target.error);
    });
  }

  function getDraft(key) {
    return new Promise((resolve, reject) => {
      const tx = state.db.transaction(CONFIG.STORE_NAME, 'readonly');
      const store = tx.objectStore(CONFIG.STORE_NAME);
      const req = store.get(key);

      req.onsuccess = () => resolve(req.result || null);
      req.onerror = event => reject(event.target.error);
    });
  }

  function putDraft(key, value) {
    return new Promise((resolve, reject) => {
      const tx = state.db.transaction(CONFIG.STORE_NAME, 'readwrite');
      const store = tx.objectStore(CONFIG.STORE_NAME);
      const req = store.put(value, key);

      req.onsuccess = () => resolve();
      req.onerror = event => reject(event.target.error);
    });
  }

  function setFatalState(message) {
    setRecordStatus('利用不可', 'error');
    setStatus(message, 'error');
    els.recordButton.disabled = true;
    els.pauseButton.disabled = true;
    els.resetButton.disabled = true;
    els.nextButton.disabled = true;
  }

  function setStatus(message, type = 'info') {
    if (!message) {
      els.statusBox.classList.add('hidden');
      els.statusBox.textContent = '';
      return;
    }

    els.statusBox.classList.remove('hidden', 'info', 'success', 'error', 'warning');
    els.statusBox.classList.add(type);
    els.statusBox.textContent = message;
  }

  function getErrorMessage(error) {
    if (!error) return '不明なエラーです。';
    if (error.message) return String(error.message);
    return String(error);
  }

  function pad2(n) {
    return String(n).padStart(2, '0');
  }
})();
