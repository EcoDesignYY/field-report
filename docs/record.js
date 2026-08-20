(() => {
  'use strict';

  // ---------------------------------------------------------------------------
  // Attachment rules
  //
  // This page keeps its own local copy of the attachment validator. The three
  // pages that use attachments are intentionally self-contained so deployment
  // does not depend on a separate script loading before the page script.
  // ---------------------------------------------------------------------------

  const FieldReportAttachments = createFieldReportAttachments();

  function createFieldReportAttachments() {
    const MAX_FILES = 5;
    const MAX_FILE_BYTES = 12 * 1024 * 1024;
    const MAX_TOTAL_BYTES = 12 * 1024 * 1024;

    const DEFINITIONS = {
      pdf:  { category: 'document', mimes: ['application/pdf'] },
      txt:  { category: 'document', mimes: ['text/plain'] },
      html: { category: 'document', mimes: ['text/html'] },
      htm:  { category: 'document', mimes: ['text/html'] },
      css:  { category: 'document', mimes: ['text/css'] },
      js: {
        category: 'document',
        mimes: [
          'text/javascript',
          'application/javascript',
          'application/x-javascript'
        ]
      },
      ts: {
        category: 'document',
        mimes: [
          'text/x-typescript',
          'application/x-typescript',
          'text/plain'
        ]
      },
      csv: {
        category: 'document',
        mimes: [
          'text/csv',
          'application/csv',
          'text/plain'
        ]
      },
      md: {
        category: 'document',
        mimes: ['text/markdown', 'text/plain']
      },
      py: {
        category: 'document',
        mimes: [
          'text/x-python',
          'application/x-python-code',
          'text/plain'
        ]
      },
      json: {
        category: 'document',
        mimes: [
          'application/json',
          'text/json',
          'text/plain'
        ]
      },
      xml: {
        category: 'document',
        mimes: [
          'application/xml',
          'text/xml',
          'text/plain'
        ]
      },
      rtf: {
        category: 'document',
        mimes: ['application/rtf', 'text/rtf']
      },

      jpeg: { category: 'image', mimes: ['image/jpeg'] },
      jpg:  { category: 'image', mimes: ['image/jpeg'] },
      png:  { category: 'image', mimes: ['image/png'] },
      webp: { category: 'image', mimes: ['image/webp'] },
      heic: {
        category: 'image',
        mimes: ['image/heic', 'image/heic-sequence']
      },
      heif: {
        category: 'image',
        mimes: ['image/heif', 'image/heif-sequence']
      },

      wav: {
        category: 'audio',
        mimes: ['audio/wav', 'audio/x-wav']
      },
      mp3: {
        category: 'audio',
        mimes: ['audio/mpeg', 'audio/mp3']
      },
      aiff: {
        category: 'audio',
        mimes: ['audio/aiff', 'audio/x-aiff']
      },
      aif: {
        category: 'audio',
        mimes: ['audio/aiff', 'audio/x-aiff']
      },
      aac: {
        category: 'audio',
        mimes: ['audio/aac', 'audio/x-aac']
      },
      ogg: {
        category: 'audio',
        mimes: ['audio/ogg', 'application/ogg']
      },
      flac: {
        category: 'audio',
        mimes: ['audio/flac', 'audio/x-flac']
      },

      mp4:  { category: 'video', mimes: ['video/mp4'] },
      mpeg: { category: 'video', mimes: ['video/mpeg'] },
      mpg:  { category: 'video', mimes: ['video/mpeg'] },
      mov:  { category: 'video', mimes: ['video/quicktime'] },
      avi: {
        category: 'video',
        mimes: ['video/x-msvideo', 'video/avi']
      },
      flv:  { category: 'video', mimes: ['video/x-flv'] },
      webm: { category: 'video', mimes: ['video/webm'] },
      wmv:  { category: 'video', mimes: ['video/x-ms-wmv'] },
      '3gp':  { category: 'video', mimes: ['video/3gpp'] },
      '3gpp': { category: 'video', mimes: ['video/3gpp'] }
    };

    const ACCEPT = Object.keys(DEFINITIONS)
      .map(extension => '.' + extension)
      .join(',');

    function extensionOf(fileName) {
      const value = String(fileName || '').trim();
      const index = value.lastIndexOf('.');

      return index >= 0
        ? value.slice(index + 1).toLowerCase()
        : '';
    }

    function sanitizeFileName(fileName) {
      const value = String(fileName || '').trim();

      if (!value) {
        throw new Error('ファイル名がありません。');
      }

      if (/[\\/:*?"<>|\u0000-\u001f]/.test(value)) {
        throw new Error(
          'ファイル名に使用できない文字が含まれています: ' + value
        );
      }

      return value.slice(0, 180);
    }

    function validateFile(file) {
      if (!file) {
        throw new Error('ファイルを読み込めませんでした。');
      }

      const fileName = sanitizeFileName(
        file.name || file.fileName || ''
      );
      const extension = extensionOf(fileName);
      const definition = DEFINITIONS[extension];
      const size = Number(file.size || 0);
      const mimeType = String(file.type || file.mimeType || '')
        .toLowerCase()
        .trim();

      if (!definition) {
        throw new Error(
          '対応していないファイル形式です: ' + fileName
        );
      }

      if (size <= 0) {
        throw new Error(
          '0バイトのファイルは添付できません: ' + fileName
        );
      }

      if (size > MAX_FILE_BYTES) {
        throw new Error(
          '1ファイルの上限12MiBを超えています: ' + fileName
        );
      }

      const canUseExtensionOnly =
        !mimeType || mimeType === 'application/octet-stream';

      if (
        !canUseExtensionOnly &&
        definition.mimes.indexOf(mimeType) === -1
      ) {
        throw new Error(
          '拡張子とファイル形式が一致しません: ' +
          fileName +
          ' (' + mimeType + ')'
        );
      }

      return {
        fileName,
        extension,
        mimeType: mimeType || definition.mimes[0],
        category: definition.category,
        size
      };
    }

    function createId() {
      const cryptoApi = window.crypto || null;

      if (
        cryptoApi &&
        typeof cryptoApi.randomUUID === 'function'
      ) {
        return cryptoApi.randomUUID();
      }

      return (
        'ATT-' +
        Date.now() +
        '-' +
        Math.random().toString(36).slice(2, 10)
      );
    }

    function normalizeStoredAttachment(item) {
      if (!item) {
        return null;
      }

      const blob = item.blob || item.file || null;
      const checked = validateFile({
        name: item.fileName || item.name || (blob && blob.name) || '',
        size: item.size || (blob && blob.size) || 0,
        type: item.mimeType || (blob && blob.type) || ''
      });

      return {
        id: String(item.id || createId()),
        fileName: checked.fileName,
        extension: checked.extension,
        mimeType: checked.mimeType,
        category: checked.category,
        size: checked.size,
        addedAt: item.addedAt || new Date().toISOString(),
        blob
      };
    }

    function fromFile(file) {
      const checked = validateFile(file);

      return {
        id: createId(),
        fileName: checked.fileName,
        extension: checked.extension,
        mimeType: checked.mimeType,
        category: checked.category,
        size: checked.size,
        addedAt: new Date().toISOString(),
        blob: file
      };
    }

    function validateCollection(items, extraBytes = 0) {
      const normalized = (Array.isArray(items) ? items : [])
        .map(normalizeStoredAttachment)
        .filter(Boolean);

      if (normalized.length > MAX_FILES) {
        throw new Error('添付できるファイルは最大5件です。');
      }

      const attachmentBytes = normalized.reduce(
        (sum, item) => sum + item.size,
        0
      );
      const totalBytes = attachmentBytes + Number(extraBytes || 0);

      if (totalBytes > MAX_TOTAL_BYTES) {
        throw new Error(
          '添付ファイルと撮影画像の合計が12MiBを超えています。'
        );
      }

      return {
        items: normalized,
        totalBytes
      };
    }

    function toMetadata(item, uploadedFile) {
      const url = uploadedFile &&
        (uploadedFile.webViewLink || uploadedFile.url)
        ? (uploadedFile.webViewLink || uploadedFile.url)
        : '';

      return {
        fileId: uploadedFile && uploadedFile.id
          ? uploadedFile.id
          : '',
        fileName: item.fileName,
        extension: item.extension,
        mimeType: uploadedFile && uploadedFile.mimeType
          ? uploadedFile.mimeType
          : item.mimeType,
        size: item.size,
        category: item.category,
        url
      };
    }

    function formatBytes(bytes) {
      const value = Number(bytes || 0);

      if (value < 1024) {
        return value + ' B';
      }

      if (value < 1024 * 1024) {
        return (value / 1024).toFixed(1) + ' KiB';
      }

      return (value / 1024 / 1024).toFixed(1) + ' MiB';
    }

    return Object.freeze({
      MAX_FILES,
      MAX_FILE_BYTES,
      MAX_TOTAL_BYTES,
      DEFINITIONS,
      ACCEPT,
      extensionOf,
      validateFile,
      validateCollection,
      normalizeStoredAttachment,
      fromFile,
      toMetadata,
      formatBytes
    });
  }


  const CONFIG = {
    DB_NAME: 'field-report-draft-db',
    DB_VERSION: 1,
    STORE_NAME: 'draft',
    AUTH_TOKEN_STORAGE_KEY: 'fieldReportAuthToken',
    MIN_RECORDING_SECONDS: 30,
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
    recordingSequence: 0,
    attachments: [],
    imageBlob: null
  };

  const els = {};

  document.addEventListener('DOMContentLoaded', init);
  window.addEventListener('pagehide', releaseRecordingResources);

  // ---------------------------------------------------------------------------
  // Page initialization
  // ---------------------------------------------------------------------------

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

      const storedAttachments = await getDraft('attachments');
      state.imageBlob = await getDraft('imageBlob');
      state.attachments = FieldReportAttachments.validateCollection(
        Array.isArray(storedAttachments) ? storedAttachments : [],
        state.imageBlob ? state.imageBlob.size : 0
      ).items;
      els.attachmentFileInput.accept = FieldReportAttachments.ACCEPT;

      clearWaveform();
      await loadExistingDraft();
      renderAttachmentState();

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
    els.selectAttachmentsButton = document.getElementById('selectAttachmentsButton');
    els.attachmentFileInput = document.getElementById('attachmentFileInput');
    els.attachmentCount = document.getElementById('attachmentCount');
    els.attachmentUsage = document.getElementById('attachmentUsage');
    els.attachmentList = document.getElementById('attachmentList');
    els.attachmentEmpty = document.getElementById('attachmentEmpty');
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
      'selectAttachmentsButton',
      'attachmentFileInput',
      'attachmentCount',
      'attachmentUsage',
      'attachmentList',
      'attachmentEmpty',
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
        '録音は短時間でも保存できます。2分で自動停止します。\n' +
        '録音しない場合でも、関連ファイルが1件以上あれば次へ進めます。\n' +
        'マイク許可を求められた場合は「許可」を選択してください。',
        'info'
      );
    });

    els.recordButton.addEventListener('click', handleRecordButtonClick);
    els.pauseButton.addEventListener('click', togglePauseRecording);
    els.resetButton.addEventListener('click', () => resetRecording(true));
    els.playAudioButton.addEventListener('click', toggleAudioPlayback);
    els.selectAttachmentsButton.addEventListener('click', () => els.attachmentFileInput.click());
    els.attachmentFileInput.addEventListener('change', handleAttachmentSelection);
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

  // ---------------------------------------------------------------------------
  // Recording lifecycle
  // ---------------------------------------------------------------------------

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

  // ---------------------------------------------------------------------------
  // Browser and MIME compatibility
  // ---------------------------------------------------------------------------

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

  async function stopRecording(autoStopped = false) {
    const recorder = state.mediaRecorder;

    if (!recorder || state.status === 'stopping') return;

    try {
      if (state.status === 'recording') {
        state.elapsedMs += Date.now() - state.startedAt;
      }

      state.elapsedMs = Math.min(
        state.elapsedMs,
        CONFIG.MAX_RECORDING_SECONDS * 1000
      );

      state.status = 'stopping';
      stopTimer();
      setRecordStatus('録音を保存中', 'ready');
      els.recordButton.disabled = true;
      els.pauseButton.disabled = true;
      els.resetButton.disabled = true;
      els.nextButton.disabled = true;

      if (autoStopped) {
        setStatus(
          '2分に達したため、録音を自動停止しました。保存処理が終わるまでお待ちください。',
          'warning'
        );
      }

      if (recorder.state !== 'inactive') {
        recorder.stop();
      }
    } catch (error) {
      state.status = 'idle';
      els.recordButton.disabled = false;
      setStatus('録音停止に失敗しました。\n' + getErrorMessage(error), 'error');
      renderState();
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

    if (state.elapsedMs >= CONFIG.MAX_RECORDING_SECONDS * 1000) {
      setStatus('2分の録音が完了しました。内容を確認して次へ進んでください。', 'success');
    } else {
      setStatus('録音が完了しました。内容を確認して次へ進んでください。', 'success');
    }

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

  async function handleAttachmentSelection(event) {
    const selected = Array.from(event.target.files || []);
    event.target.value = '';
    if (!selected.length) return;
    try {
      const next = state.attachments.slice();
      selected.forEach(file => next.push(FieldReportAttachments.fromFile(file)));
      state.attachments = FieldReportAttachments.validateCollection(next, state.imageBlob ? state.imageBlob.size : 0).items;
      await putDraft('attachments', state.attachments);
      renderAttachmentState();
      setStatus('関連ファイルを追加しました。', 'success');
    } catch (error) { setStatus(getErrorMessage(error), 'error'); }
  }

  async function removeAttachment(id) {
    state.attachments = state.attachments.filter(item => item.id !== id);
    await putDraft('attachments', state.attachments);
    renderAttachmentState();
  }

  function renderAttachmentState() {
    const result = FieldReportAttachments.validateCollection(state.attachments, state.imageBlob ? state.imageBlob.size : 0);
    els.attachmentCount.textContent = state.attachments.length + ' / ' + FieldReportAttachments.MAX_FILES + '件';
    els.attachmentUsage.textContent = FieldReportAttachments.formatBytes(result.totalBytes) + ' / 12 MiB';
    els.attachmentEmpty.classList.toggle('hidden', state.attachments.length > 0);
    els.attachmentList.innerHTML = state.attachments.map(item => '<div class="attachment-item"><div><div class="attachment-name">' + escapeHtml(item.fileName) + '</div><div class="attachment-meta">' + escapeHtml(categoryLabel(item.category)) + '・' + escapeHtml(item.extension.toUpperCase()) + '・' + escapeHtml(FieldReportAttachments.formatBytes(item.size)) + '</div></div><button type="button" class="remove-attachment" data-remove-id="' + escapeHtml(item.id) + '">削除</button></div>').join('');
    els.attachmentList.querySelectorAll('[data-remove-id]').forEach(button => button.addEventListener('click', () => removeAttachment(button.dataset.removeId)));
    renderState();
  }

  function categoryLabel(category) {
    const labels = { document:'文書・コード', image:'画像', audio:'音声', video:'動画' };
    return labels[category] || 'ファイル';
  }

  // ---------------------------------------------------------------------------
  // Playback and draft persistence
  // ---------------------------------------------------------------------------

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
    const hasAttachments = state.attachments.length > 0;

    if (!state.audioBlob && !hasAttachments) {
      setStatus(
        '録音または関連ファイルがありません。録音するか、関連ファイルを1件以上追加してください。',
        'error'
      );
      return;
    }

    if (
      state.audioBlob &&
      state.elapsedMs < CONFIG.MIN_RECORDING_SECONDS * 1000
    ) {
      setStatus('録音時間が30秒未満です。30秒以上録音してから次へ進んでください。', 'warning');
      return;
    }

    try {
      const checked = FieldReportAttachments.validateCollection(
        state.attachments,
        state.imageBlob ? state.imageBlob.size : 0
      );

      await putDraft('inputMode', 'audio');
      await putDraft('attachments', checked.items);

      if (state.audioBlob) {
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
        await putDraft('audioBlob', state.audioBlob);
        await putDraft('audioMeta', meta);
      } else {
        // 過去の録音下書きが残っていると、添付のみ投稿でも確認画面で
        // 古い録音が復元されるため明示的に削除する。
        await deleteDraft('audioBlob');
        await deleteDraft('audioMeta');
      }

      location.href = CONFIG.NEXT_PAGE_URL;
    } catch (error) {
      setStatus('投稿データの保存に失敗しました。\n' + getErrorMessage(error), 'error');
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

  // ---------------------------------------------------------------------------
  // Waveform and timer rendering
  // ---------------------------------------------------------------------------

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
        stopRecording(true);
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
    const isStopping = state.status === 'stopping';
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

    if (isStopping) {
      els.recordButton.disabled = true;
      els.recordLabel.textContent = '保存中';
      els.pauseButton.disabled = true;
      els.pauseButton.textContent = '一時停止';
      els.resetButton.disabled = true;
      els.nextButton.disabled = true;
      return;
    }

    if (isRecorded) {
      const hasMinimumDuration = state.elapsedMs >= CONFIG.MIN_RECORDING_SECONDS * 1000;
      els.recordButton.disabled = false;
      els.recordLabel.textContent = '録り直す';
      els.pauseButton.disabled = true;
      els.pauseButton.textContent = '一時停止';
      els.resetButton.disabled = false;
      els.nextButton.disabled = !hasMinimumDuration;
      setRecordStatus(hasMinimumDuration ? '録音済み' : '30秒未満', hasMinimumDuration ? 'ready' : 'error');
      return;
    }

    els.recordButton.disabled = false;
    els.recordLabel.textContent = '録音開始';
    els.pauseButton.disabled = true;
    els.pauseButton.textContent = '一時停止';
    els.resetButton.disabled = true;
    els.nextButton.disabled = state.attachments.length === 0;
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

  // ---------------------------------------------------------------------------
  // Platform diagnostics and error messages
  // ---------------------------------------------------------------------------

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

  // ---------------------------------------------------------------------------
  // IndexedDB and generic utilities
  // ---------------------------------------------------------------------------

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
