(() => {
  'use strict';

  const CONFIG = {
    DB_NAME: 'field-report-draft-db',
    DB_VERSION: 1,
    STORE_NAME: 'draft',
    AUTH_TOKEN_STORAGE_KEY: 'fieldReportAuthToken',
    MAX_RECORDING_SECONDS: 120,
    NEXT_PAGE_URL: './capture.html',
    PREVIOUS_PAGE_URL: './input.html'
  };

  const PLATFORM = detectPlatform();

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
    requestedMimeType: '',
    actualMimeType: '',
    recordingSequence: 0
  };

  const els = {};

  document.addEventListener('DOMContentLoaded', init);
  window.addEventListener('pagehide', releaseRecordingResources);

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

      await putDraft('inputMode', 'audio');
      await deleteDraft('textBody');
      await deleteDraft('textMeta');

      clearWaveform();
      await loadExistingDraft();

      logRecordingEnvironment();
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

    const requiredElements = [
      'backButton',
      'helpButton',
      'recordStatusBadge',
      'timerText',
      'waveCanvas',
      'recordButton',
      'recordLabel',
      'pauseButton',
      'resetButton',
      'audioPreviewArea',
      'playAudioButton',
      'audioPlayStatus',
      'audioPlayer',
      'audioMemoInput',
      'nextButton',
      'statusBox'
    ];

    const missing = requiredElements.filter(name => !els[name]);

    if (missing.length > 0) {
      throw new Error('record.html に必要な要素がありません: ' + missing.join(', '));
    }

    els.audioPlayer.playsInline = true;
  }

  function bindEvents() {
    els.backButton.addEventListener('click', () => {
      location.href = CONFIG.PREVIOUS_PAGE_URL;
    });

    els.helpButton.addEventListener('click', () => {
      setStatus(
        '録音ボタンを押すと録音を開始します。もう一度押すと停止します。\n' +
        'マイク許可を求められた場合は「許可」を選択してください。',
        'info'
      );
    });

    els.recordButton.addEventListener('click', handleRecordButtonClick);
    els.pauseButton.addEventListener('click', togglePauseRecording);
    els.resetButton.addEventListener('click', () => resetRecording(true));
    els.playAudioButton.addEventListener('click', toggleAudioPlayback);
    els.nextButton.addEventListener('click', saveAndGoNext);

    els.audioPlayer.addEventListener('ended', () => {
      els.playAudioButton.textContent = '再生';
      els.audioPlayStatus.textContent = '再生が終了しました';
    });

    els.audioPlayer.addEventListener('error', () => {
      setStatus(
        '録音データの再生に失敗しました。録音形式が端末に対応していない可能性があります。録り直してください。',
        'error'
      );
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
    const sequence = ++state.recordingSequence;

    try {
      resetRecording(false, { keepSequence: true });
      validateRecordingEnvironment();

      setRecordStatus('マイク確認中', 'ready');
      setStatus('マイクへのアクセスを確認しています。', 'info');

      const stream = await getMicrophoneStream();

      if (sequence !== state.recordingSequence) {
        stream.getTracks().forEach(track => track.stop());
        return;
      }

      const audioTrack = stream.getAudioTracks()[0];

      if (!audioTrack || audioTrack.readyState !== 'live') {
        stream.getTracks().forEach(track => track.stop());
        throw new Error('利用可能なマイク音声トラックを取得できませんでした。');
      }

      state.mediaStream = stream;

      const recorderInfo = createCompatibleMediaRecorder(stream);
      const recorder = recorderInfo.recorder;
      const chunks = [];

      state.mediaRecorder = recorder;
      state.audioChunks = chunks;
      state.requestedMimeType = recorderInfo.requestedMimeType;
      state.actualMimeType = recorder.mimeType || recorderInfo.requestedMimeType || '';

      recorder.ondataavailable = event => {
        if (event.data && event.data.size > 0) {
          chunks.push(event.data);
        }
      };

      recorder.onerror = event => {
        const recorderError = event && event.error ? event.error : event;
        setStatus('録音中にエラーが発生しました。\n' + getErrorMessage(recorderError), 'error');
      };

      recorder.onstop = () => {
        handleRecorderStop({
          recorder,
          chunks,
          sequence,
          requestedMimeType: recorderInfo.requestedMimeType
        });
      };

      await setupWaveform(stream);

      state.startedAt = Date.now();
      state.elapsedMs = 0;
      state.status = 'recording';

      /*
       * iOS系ブラウザでは、細切れのtimesliceを指定せず、停止時に1つのBlobを
       * 受け取る方が安定するため、引数なしで開始する。
       */
      recorder.start();

      startTimer();
      startWaveform();
      renderState();
      setStatus('', '');

      console.info('[record] started', {
        platform: PLATFORM,
        requestedMimeType: state.requestedMimeType,
        actualMimeType: recorder.mimeType,
        trackSettings: safeGetTrackSettings(audioTrack)
      });
    } catch (error) {
      cleanupStream();
      stopWaveform();
      state.status = 'idle';
      renderState();
      setRecordStatus('録音不可', 'error');
      setStatus(buildRecordingErrorMessage(error), 'error');

      console.error('[record] start failed', error);
    }
  }

  function validateRecordingEnvironment() {
    if (!window.isSecureContext) {
      throw createNamedError(
        'SecurityError',
        '録音にはHTTPS環境が必要です。GitHub PagesのURLを直接開いてください。'
      );
    }

    if (!navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== 'function') {
      throw createNamedError(
        'NotSupportedError',
        'このブラウザではマイク取得機能を利用できません。Chromeを最新版に更新してください。'
      );
    }

    if (typeof window.MediaRecorder === 'undefined') {
      throw createNamedError(
        'NotSupportedError',
        'このブラウザでは録音機能を利用できません。Chromeを最新版に更新してください。'
      );
    }
  }

  async function getMicrophoneStream() {
    /*
     * iPhone / iPadでは単純なaudio:trueを優先する。
     * Androidなどでは一般的な音声補正を要求し、失敗時はaudio:trueへ戻す。
     */
    if (PLATFORM.isIOS) {
      return navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    }

    try {
      return await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          channelCount: 1
        },
        video: false
      });
    } catch (error) {
      if (
        error &&
        (error.name === 'OverconstrainedError' || error.name === 'ConstraintNotSatisfiedError' || error.name === 'TypeError')
      ) {
        return navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      }

      throw error;
    }
  }

  function createCompatibleMediaRecorder(stream) {
    const candidates = getMimeTypeCandidates();
    const errors = [];

    for (const mimeType of candidates) {
      if (!isMimeTypeSupported(mimeType)) {
        continue;
      }

      try {
        const recorder = new MediaRecorder(stream, {
          mimeType,
          audioBitsPerSecond: 64000
        });

        return {
          recorder,
          requestedMimeType: mimeType
        };
      } catch (error) {
        errors.push(mimeType + ': ' + getErrorMessage(error));
      }
    }

    /*
     * isTypeSupported()の結果と実際のコンストラクタ挙動が一致しない端末に備え、
     * 最後はブラウザ既定形式で生成する。
     */
    try {
      return {
        recorder: new MediaRecorder(stream),
        requestedMimeType: ''
      };
    } catch (error) {
      const detail = errors.length > 0 ? '\n試行結果: ' + errors.join(' / ') : '';
      throw createNamedError(
        error && error.name ? error.name : 'NotSupportedError',
        'この端末で利用可能な録音形式を作成できませんでした。' + detail
      );
    }
  }

  function getMimeTypeCandidates() {
    if (PLATFORM.isIOS) {
      return [
        'audio/mp4;codecs=mp4a.40.2',
        'audio/mp4',
        'audio/webm;codecs=opus',
        'audio/webm'
      ];
    }

    return [
      'audio/webm;codecs=opus',
      'audio/webm',
      'audio/mp4;codecs=mp4a.40.2',
      'audio/mp4'
    ];
  }

  function isMimeTypeSupported(mimeType) {
    if (!mimeType) return false;

    if (typeof MediaRecorder.isTypeSupported !== 'function') {
      return PLATFORM.isIOS ? mimeType.indexOf('audio/mp4') === 0 : true;
    }

    try {
      return MediaRecorder.isTypeSupported(mimeType);
    } catch (_) {
      return false;
    }
  }

  async function stopRecording() {
    const recorder = state.mediaRecorder;

    if (!recorder) return;

    try {
      if (state.status === 'recording') {
        state.elapsedMs += Date.now() - state.startedAt;
      }

      stopTimer();
      setRecordStatus('録音を保存中', 'ready');
      els.recordButton.disabled = true;
      els.pauseButton.disabled = true;

      if (recorder.state !== 'inactive') {
        recorder.stop();
      }
    } catch (error) {
      els.recordButton.disabled = false;
      setStatus('録音停止に失敗しました。\n' + getErrorMessage(error), 'error');
    }
  }

  function handleRecorderStop({ recorder, chunks, sequence, requestedMimeType }) {
    if (sequence !== state.recordingSequence) {
      return;
    }

    stopTimer();
    stopWaveform();

    const actualMimeType =
      recorder.mimeType ||
      (chunks[0] && chunks[0].type) ||
      requestedMimeType ||
      (PLATFORM.isIOS ? 'audio/mp4' : 'audio/webm');

    state.actualMimeType = actualMimeType;
    state.audioBlob = new Blob(chunks, { type: actualMimeType });

    cleanupStream();
    state.mediaRecorder = null;
    els.recordButton.disabled = false;

    if (!state.audioBlob || state.audioBlob.size <= 0) {
      state.status = 'idle';
      setRecordStatus('録音失敗', 'error');
      setStatus(
        '録音データが作成されませんでした。Chromeのマイク権限を確認し、他の通話アプリを終了してから録り直してください。',
        'error'
      );
      renderState();
      return;
    }

    if (state.audioObjectUrl) {
      URL.revokeObjectURL(state.audioObjectUrl);
    }

    state.audioObjectUrl = URL.createObjectURL(state.audioBlob);
    els.audioPlayer.src = state.audioObjectUrl;
    els.audioPlayer.load();

    state.status = 'recorded';
    setRecordStatus('録音済み', 'ready');
    els.audioPreviewArea.classList.remove('hidden');
    els.playAudioButton.disabled = false;
    els.audioPlayStatus.textContent = '再生できます';

    renderState();

    console.info('[record] stopped', {
      mimeType: actualMimeType,
      size: state.audioBlob.size,
      chunks: chunks.length,
      durationSec: Math.max(1, Math.round(state.elapsedMs / 1000))
    });
  }

  function togglePauseRecording() {
    const recorder = state.mediaRecorder;

    if (!recorder) return;

    try {
      if (recorder.state === 'recording') {
        if (typeof recorder.pause !== 'function') {
          setStatus('この端末では一時停止を利用できません。停止して保存してください。', 'warning');
          return;
        }

        recorder.pause();
        state.elapsedMs += Date.now() - state.startedAt;
        state.status = 'paused';
        stopTimer();
        setRecordStatus('一時停止中', 'paused');
        renderState();
        return;
      }

      if (recorder.state === 'paused') {
        if (typeof recorder.resume !== 'function') {
          setStatus('この端末では録音再開を利用できません。停止して保存してください。', 'warning');
          return;
        }

        recorder.resume();
        state.startedAt = Date.now();
        state.status = 'recording';
        startTimer();
        setRecordStatus('録音中', 'recording');
        renderState();
      }
    } catch (error) {
      setStatus('一時停止・再開に失敗しました。\n' + getErrorMessage(error), 'error');
    }
  }

  function resetRecording(showMessage = true, options = {}) {
    stopTimer();
    stopWaveform();

    if (!options.keepSequence) {
      state.recordingSequence += 1;
    }

    const recorder = state.mediaRecorder;

    if (recorder && recorder.state !== 'inactive') {
      try {
        recorder.ondataavailable = null;
        recorder.onstop = null;
        recorder.onerror = null;
        recorder.stop();
      } catch (_) {
        // リセット処理なので停止エラーは無視する。
      }
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
    state.requestedMimeType = '';
    state.actualMimeType = '';

    els.audioPlayer.pause();
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

  function releaseRecordingResources() {
    stopTimer();
    stopWaveform();
    cleanupStream();
  }

  function toggleAudioPlayback() {
    if (!state.audioBlob) return;

    if (els.audioPlayer.paused) {
      els.audioPlayer
        .play()
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
      const mimeType = state.audioBlob.type || state.actualMimeType || state.requestedMimeType;
      const meta = {
        mimeType: mimeType || (PLATFORM.isIOS ? 'audio/mp4' : 'audio/webm'),
        fileExtension: getExtensionFromMimeType(mimeType),
        size: state.audioBlob.size,
        durationSec: Math.max(1, Math.round(state.elapsedMs / 1000)),
        memo: els.audioMemoInput.value.trim(),
        savedAt: new Date().toISOString(),
        browser: PLATFORM.browser,
        os: PLATFORM.os
      };

      await putDraft('inputMode', 'audio');
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

    if (!audioBlob) {
      renderState();
      return;
    }

    state.audioBlob = audioBlob;
    state.actualMimeType = audioBlob.type || (audioMeta && audioMeta.mimeType) || '';
    state.status = 'recorded';
    state.elapsedMs = audioMeta && audioMeta.durationSec
      ? Number(audioMeta.durationSec) * 1000
      : 0;

    if (state.audioObjectUrl) {
      URL.revokeObjectURL(state.audioObjectUrl);
    }

    state.audioObjectUrl = URL.createObjectURL(audioBlob);
    els.audioPlayer.src = state.audioObjectUrl;
    els.audioPlayer.load();
    els.audioPreviewArea.classList.remove('hidden');
    els.playAudioButton.disabled = false;
    els.audioPlayStatus.textContent = '再生できます';

    if (audioMeta && audioMeta.memo) {
      els.audioMemoInput.value = audioMeta.memo;
    }

    renderTimer(state.elapsedMs);
    renderState();
  }

  async function setupWaveform(stream) {
    try {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;

      if (!AudioContextClass) {
        return;
      }

      state.audioContext = new AudioContextClass();

      if (state.audioContext.state === 'suspended') {
        await state.audioContext.resume();
      }

      const source = state.audioContext.createMediaStreamSource(stream);
      state.analyser = state.audioContext.createAnalyser();
      state.analyser.fftSize = 2048;
      source.connect(state.analyser);
      state.waveformData = new Uint8Array(state.analyser.fftSize);
    } catch (error) {
      console.warn('[record] waveform disabled', error);
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

      for (let i = 0; i < state.waveformData.length; i += 1) {
        const v = state.waveformData[i] / 128.0;
        const y = (v * canvas.height) / 2;

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
      } catch (_) {
        // 終了処理なので無視する。
      }
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
      els.recordButton.disabled = false;
      els.recordLabel.textContent = '録音中';
      els.pauseButton.disabled = false;
      els.pauseButton.textContent = '一時停止';
      els.resetButton.disabled = false;
      els.nextButton.disabled = true;
      setRecordStatus('録音中', 'recording');
      return;
    }

    if (isPaused) {
      els.recordButton.disabled = false;
      els.recordLabel.textContent = '停止して保存';
      els.pauseButton.disabled = false;
      els.pauseButton.textContent = '再開';
      els.resetButton.disabled = false;
      els.nextButton.disabled = true;
      setRecordStatus('一時停止中', 'paused');
      return;
    }

    if (isRecorded) {
      els.recordButton.disabled = false;
      els.recordLabel.textContent = '録り直す';
      els.pauseButton.disabled = true;
      els.pauseButton.textContent = '一時停止';
      els.resetButton.disabled = false;
      els.nextButton.disabled = false;
      setRecordStatus('録音済み', 'ready');
      return;
    }

    els.recordButton.disabled = false;
    els.recordLabel.textContent = '録音開始';
    els.pauseButton.disabled = true;
    els.pauseButton.textContent = '一時停止';
    els.resetButton.disabled = true;
    els.nextButton.disabled = true;
  }

  function setRecordStatus(text, type) {
    els.recordStatusBadge.textContent = text;
    els.recordStatusBadge.classList.remove(
      'status-ready',
      'status-recording',
      'status-paused',
      'status-error'
    );

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
    if (!state.mediaStream) return;

    state.mediaStream.getTracks().forEach(track => {
      try {
        track.stop();
      } catch (_) {
        // 終了処理なので無視する。
      }
    });

    state.mediaStream = null;
  }

  function buildRecordingErrorMessage(error) {
    const name = error && error.name ? String(error.name) : '';
    const originalMessage = getErrorMessage(error);

    if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
      if (PLATFORM.isIOS) {
        return (
          'マイクの使用が許可されていません。\n' +
          '1. iPhoneの「設定」→「Chrome」→「マイク」をオン\n' +
          '2. Chromeでこのサイトを開き、アドレスバー左側のマイク権限を許可\n' +
          '3. Chromeを完全に終了して開き直す\n\n' +
          '詳細: ' + originalMessage
        );
      }

      return (
        'マイクの使用が許可されていません。\n' +
        'Chromeの「設定」→「サイトの設定」→「マイク」で、このサイトを許可してください。\n\n' +
        '詳細: ' + originalMessage
      );
    }

    if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
      return '利用可能なマイクが見つかりません。端末のマイク設定を確認してください。';
    }

    if (name === 'NotReadableError' || name === 'TrackStartError') {
      return (
        'マイクを開始できません。通話・録音・カメラなど、マイクを使用中の他アプリを終了してから再試行してください。\n\n' +
        '詳細: ' + originalMessage
      );
    }

    if (name === 'SecurityError') {
      return '録音にはHTTPS接続とブラウザのマイク許可が必要です。GitHub PagesのURLを直接開いてください。';
    }

    if (name === 'AbortError') {
      return 'マイクの開始が中断されました。Chromeを開き直して再試行してください。';
    }

    if (name === 'InvalidStateError') {
      return 'ブラウザの状態により録音を開始できません。ページを再読み込みしてください。';
    }

    if (name === 'NotSupportedError') {
      return originalMessage;
    }

    return '録音を開始できませんでした。\n' + originalMessage;
  }

  function getExtensionFromMimeType(mimeType) {
    const type = String(mimeType || '').toLowerCase();

    if (type.includes('mp4') || type.includes('m4a')) return 'm4a';
    if (type.includes('webm')) return 'webm';
    if (type.includes('ogg')) return 'ogg';
    if (type.includes('mpeg') || type.includes('mp3')) return 'mp3';
    if (type.includes('wav')) return 'wav';
    if (type.includes('aac')) return 'aac';

    return PLATFORM.isIOS ? 'm4a' : 'webm';
  }

  function safeGetTrackSettings(track) {
    try {
      return track && typeof track.getSettings === 'function' ? track.getSettings() : {};
    } catch (_) {
      return {};
    }
  }

  function logRecordingEnvironment() {
    const supportedMimeTypes = getMimeTypeCandidates().filter(isMimeTypeSupported);

    console.info('[record] environment', {
      platform: PLATFORM,
      secureContext: window.isSecureContext,
      hasMediaDevices: Boolean(navigator.mediaDevices),
      hasGetUserMedia: Boolean(
        navigator.mediaDevices && typeof navigator.mediaDevices.getUserMedia === 'function'
      ),
      hasMediaRecorder: typeof window.MediaRecorder !== 'undefined',
      supportedMimeTypes
    });
  }

  function detectPlatform() {
    const ua = navigator.userAgent || '';
    const platform = navigator.platform || '';
    const maxTouchPoints = navigator.maxTouchPoints || 0;

    const isIOS =
      /iPhone|iPad|iPod/i.test(ua) ||
      (platform === 'MacIntel' && maxTouchPoints > 1);

    const isAndroid = /Android/i.test(ua);
    const isChromeIOS = /CriOS/i.test(ua);
    const isChromeAndroid = /Chrome/i.test(ua) && isAndroid;

    return {
      isIOS,
      isAndroid,
      isChromeIOS,
      isChromeAndroid,
      browser: isChromeIOS
        ? 'Chrome iOS'
        : isChromeAndroid
          ? 'Chrome Android'
          : /Safari/i.test(ua) && !/Chrome|CriOS|Android/i.test(ua)
            ? 'Safari'
            : 'Other',
      os: isIOS ? 'iOS/iPadOS' : isAndroid ? 'Android' : 'Other',
      userAgent: ua
    };
  }

  function createNamedError(name, message) {
    const error = new Error(message);
    error.name = name;
    return error;
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

  function deleteDraft(key) {
    return new Promise((resolve, reject) => {
      const tx = state.db.transaction(CONFIG.STORE_NAME, 'readwrite');
      const store = tx.objectStore(CONFIG.STORE_NAME);
      const req = store.delete(key);

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

  function pad2(value) {
    return String(value).padStart(2, '0');
  }
})();
