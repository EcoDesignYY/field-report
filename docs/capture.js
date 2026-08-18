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
    NEXT_PAGE_URL: './confirm.html'
  };

  const state = {
    db: null,
    authToken: '',
    inputMode: '',
    stream: null,
    imageBlob: null,
    imageMeta: null,
    attachments: [],
    objectUrl: ''
  };
  const els = {};

  document.addEventListener('DOMContentLoaded', initializePage);
  window.addEventListener('pagehide', stopCamera);

  async function initializePage() {
    collectElements();
    bindEvents();
    state.authToken = getAuthTokenFromUrlOrStorage();

    if (!state.authToken) {
      setFatalState('認証情報がありません。GAS入口から開き直してください。');
      return;
    }

    try {
      state.db = await openDatabase();
      state.inputMode = String((await getDraft('inputMode')) || '');
      state.imageBlob = await getDraft('imageBlob');
      state.imageMeta = await getDraft('imageMeta');
      const storedAttachments = await getDraft('attachments');
      state.attachments = Array.isArray(storedAttachments) ? storedAttachments : [];

      if (!['text', 'file', 'audio'].includes(state.inputMode)) {
        throw new Error('入力方式がありません。入力方法選択からやり直してください。');
      }

      if (state.imageBlob) renderPreview(state.imageBlob);
      if (state.imageMeta && state.imageMeta.memo) els.imageMemoInput.value = state.imageMeta.memo;
      renderUsage();
      showStatus('', '');
    } catch (error) {
      setFatalState('下書きを読み込めませんでした。\n' + getErrorMessage(error));
    }
  }

  function collectElements() {
    [
      'backButton','helpButton','cameraStatusBadge','cameraVideo','imagePreview','emptyPreview',
      'captureCanvas','startCameraButton','captureButton','fileSelectButton','resetImageButton',
      'stopCameraButton','imageFileInput','imageSizeText','totalUsageText','imageMemoInput',
      'nextButton','statusBox'
    ].forEach(id => { els[id] = document.getElementById(id); });
    const missing = Object.keys(els).filter(id => !els[id]);
    if (missing.length) throw new Error('capture.html に必要な要素がありません: ' + missing.join(', '));
  }

  function bindEvents() {
    els.backButton.addEventListener('click', () => {
      stopCamera();
      location.href = state.inputMode === 'audio' ? './record.html' : './text.html';
    });
    els.helpButton.addEventListener('click', () => {
      showStatus(
        '画像は任意です。テキスト投稿では関連ファイルと画像の合計が12MiB以内になるようにしてください。',
        'info'
      );
    });
    els.startCameraButton.addEventListener('click', startCamera);
    els.captureButton.addEventListener('click', captureImage);
    els.fileSelectButton.addEventListener('click', () => els.imageFileInput.click());
    els.imageFileInput.addEventListener('change', handleImageFile);
    els.resetImageButton.addEventListener('click', clearImage);
    els.stopCameraButton.addEventListener('click', stopCamera);
    els.nextButton.addEventListener('click', saveAndGoNext);
  }

  // ---------------------------------------------------------------------------
  // Camera lifecycle
  // ---------------------------------------------------------------------------

  async function startCamera() {
    try {
      stopCamera();
      state.stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1920 },
          height: { ideal: 1080 }
        },
        audio: false
      });
      els.cameraVideo.srcObject = state.stream;
      els.cameraVideo.classList.remove('hidden');
      els.emptyPreview.classList.add('hidden');
      els.captureButton.disabled = false;
      els.stopCameraButton.disabled = false;
      els.startCameraButton.disabled = true;
      setCameraStatus('カメラ起動中', 'ready');
      showStatus('撮影ボタンを押してください。', 'info');
    } catch (error) {
      showStatus('カメラを起動できません。\n' + getErrorMessage(error), 'error');
    }
  }

  // ---------------------------------------------------------------------------
  // Image capture, selection, and preview
  // ---------------------------------------------------------------------------

  function captureImage() {
    const width = els.cameraVideo.videoWidth || 1280;
    const height = els.cameraVideo.videoHeight || 720;
    els.captureCanvas.width = width;
    els.captureCanvas.height = height;
    els.captureCanvas.getContext('2d').drawImage(els.cameraVideo, 0, 0, width, height);
    els.captureCanvas.toBlob(async blob => {
      if (!blob) {
        showStatus('撮影画像を作成できませんでした。', 'error');
        return;
      }
      try {
        await setImage(blob, 'captured-image.jpg', 'image/jpeg', width, height);
        stopCamera();
        showStatus('画像を保存しました。', 'success');
      } catch (error) {
        showStatus(getErrorMessage(error), 'error');
      }
    }, 'image/jpeg', 0.88);
  }

  async function handleImageFile(event) {
    const file = event.target.files && event.target.files[0];
    event.target.value = '';
    if (!file) return;
    const mimeType = String(file.type || '').toLowerCase();
    const extension = String(file.name || '').split('.').pop().toLowerCase();
    const allowedExtensions = ['jpg', 'jpeg', 'png', 'webp'];
    const allowedMimeTypes = [
      'image/jpeg',
      'image/png',
      'image/webp',
      ''
    ];

    const allowed =
      allowedExtensions.includes(extension) &&
      allowedMimeTypes.includes(mimeType);
    if (!allowed) {
      showStatus(
        'AI画像解析用の画像はJPEG、PNG、WebPから選択してください。HEIC等は前画面の関連ファイルへ添付できます。',
        'error'
      );
      return;
    }
    try {
      await setImage(file, file.name || 'image', mimeType || 'image/jpeg', null, null);
      stopCamera();
      showStatus('画像を選択しました。', 'success');
    } catch (error) {
      showStatus(getErrorMessage(error), 'error');
    }
  }

  async function setImage(blob, fileName, mimeType, width, height) {
    if (!blob || blob.size <= 0) throw new Error('0バイトの画像は保存できません。');
    const attachmentBytes = ['text', 'file'].includes(state.inputMode)
      ? state.attachments.reduce((sum, item) => {
          return sum + Number(
            item.size || (item.blob && item.blob.size) || 0
          );
        }, 0)
      : 0;
    if (attachmentBytes + blob.size > FieldReportAttachments.MAX_TOTAL_BYTES) {
      throw new Error(
        '関連ファイルと撮影画像の合計が12MiBを超えています。画像を小さくするか、関連ファイルを減らしてください。'
      );
    }

    state.imageBlob = blob;
    state.imageMeta = {
      fileName: fileName || 'image.jpg',
      mimeType: mimeType || blob.type || 'image/jpeg',
      size: blob.size,
      width: width || null,
      height: height || null,
      memo: els.imageMemoInput.value.trim(),
      savedAt: new Date().toISOString()
    };
    await putDraft('imageBlob', state.imageBlob);
    await putDraft('imageMeta', state.imageMeta);
    renderPreview(blob);
    renderUsage();
  }

  async function clearImage() {
    stopCamera();
    state.imageBlob = null;
    state.imageMeta = null;
    await deleteDraft('imageBlob');
    await deleteDraft('imageMeta');
    if (state.objectUrl) URL.revokeObjectURL(state.objectUrl);
    state.objectUrl = '';
    els.imagePreview.removeAttribute('src');
    els.imagePreview.classList.add('hidden');
    els.emptyPreview.classList.remove('hidden');
    els.resetImageButton.disabled = true;
    setCameraStatus('画像は任意です', 'ready');
    renderUsage();
    showStatus('画像を削除しました。', 'info');
  }

  function renderPreview(blob) {
    if (state.objectUrl) URL.revokeObjectURL(state.objectUrl);
    state.objectUrl = URL.createObjectURL(blob);
    els.imagePreview.src = state.objectUrl;
    els.imagePreview.classList.remove('hidden');
    els.emptyPreview.classList.add('hidden');
    els.resetImageButton.disabled = false;
    const statusText = blob.size > 6 * 1024 * 1024
      ? '保存のみ（AI画像解析対象外）'
      : '画像保存済み';

    setCameraStatus(statusText, 'ready');
  }

  function renderUsage() {
    const imageBytes = state.imageBlob ? state.imageBlob.size : 0;
    const attachmentBytes = ['text', 'file'].includes(state.inputMode)
      ? state.attachments.reduce((sum, item) => {
          return sum + Number(
            item.size || (item.blob && item.blob.size) || 0
          );
        }, 0)
      : 0;
    els.imageSizeText.textContent = state.imageBlob
      ? '画像 ' + FieldReportAttachments.formatBytes(imageBytes)
      : '画像なし';
    els.totalUsageText.textContent = ['text', 'file'].includes(state.inputMode)
      ? '投稿ファイル合計 ' +
        FieldReportAttachments.formatBytes(imageBytes + attachmentBytes) +
        ' / 12 MiB'
      : '画像 ' + FieldReportAttachments.formatBytes(imageBytes);
  }

  // ---------------------------------------------------------------------------
  // Draft persistence and navigation
  // ---------------------------------------------------------------------------

  async function saveAndGoNext() {
    try {
      if (state.imageBlob) {
        state.imageMeta = Object.assign({}, state.imageMeta || {}, {
          memo: els.imageMemoInput.value.trim(),
          size: state.imageBlob.size,
          savedAt: new Date().toISOString()
        });
        await putDraft('imageMeta', state.imageMeta);
      }
      if (['text', 'file'].includes(state.inputMode)) {
        FieldReportAttachments.validateCollection(
          state.attachments,
          state.imageBlob ? state.imageBlob.size : 0
        );
      }
      stopCamera();
      location.href = CONFIG.NEXT_PAGE_URL;
    } catch (error) {
      showStatus('確認画面へ進めません。\n' + getErrorMessage(error), 'error');
    }
  }

  function stopCamera() {
    if (state.stream) state.stream.getTracks().forEach(track => track.stop());
    state.stream = null;
    if (els.cameraVideo) {
      els.cameraVideo.srcObject = null;
      els.cameraVideo.classList.add('hidden');
    }
    if (els.captureButton) els.captureButton.disabled = true;
    if (els.stopCameraButton) els.stopCameraButton.disabled = true;
    if (els.startCameraButton) els.startCameraButton.disabled = false;
    if (!state.imageBlob && els.emptyPreview) els.emptyPreview.classList.remove('hidden');
  }

  // ---------------------------------------------------------------------------
  // Status, authentication, and IndexedDB helpers
  // ---------------------------------------------------------------------------

  function setCameraStatus(text, type) {
    const statusClass = type === 'error'
      ? 'status-error'
      : 'status-ready';

    els.cameraStatusBadge.textContent = text;
    els.cameraStatusBadge.className = 'status-badge ' + statusClass;
  }

  function setFatalState(message) {
    els.nextButton.disabled = true;
    els.startCameraButton.disabled = true;
    els.fileSelectButton.disabled = true;
    showStatus(message, 'error');
  }

  function showStatus(message, type) {
    if (!message) {
      els.statusBox.className = 'status-box hidden';
      els.statusBox.textContent = '';
      return;
    }

    els.statusBox.className = 'status-box ' + (type || 'info');
    els.statusBox.textContent = message;
  }

  function getAuthTokenFromUrlOrStorage() {
    const url = new URL(location.href);
    const token = url.searchParams.get('token');

    if (token) {
      sessionStorage.setItem(CONFIG.AUTH_TOKEN_STORAGE_KEY, token);
      sessionStorage.setItem('fieldReportToken', token);
      url.searchParams.delete('token');
      history.replaceState(
        {},
        document.title,
        url.pathname + url.search + url.hash
      );
      return token;
    }

    return (
      sessionStorage.getItem(CONFIG.AUTH_TOKEN_STORAGE_KEY) ||
      sessionStorage.getItem('fieldReportToken') ||
      ''
    );
  }

  function openDatabase() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(
        CONFIG.DB_NAME,
        CONFIG.DB_VERSION
      );

      request.onupgradeneeded = (event) => {
        const database = event.target.result;

        if (!database.objectStoreNames.contains(CONFIG.STORE_NAME)) {
          database.createObjectStore(CONFIG.STORE_NAME);
        }
      };

      request.onsuccess = (event) => {
        resolve(event.target.result);
      };

      request.onerror = (event) => {
        reject(event.target.error);
      };
    });
  }

  function getDraft(key) {
    return runStoreRequest(
      'readonly',
      (store) => store.get(key)
    );
  }

  function putDraft(key, value) {
    return runStoreRequest(
      'readwrite',
      (store) => store.put(value, key)
    );
  }

  function deleteDraft(key) {
    return runStoreRequest(
      'readwrite',
      (store) => store.delete(key)
    );
  }

  function runStoreRequest(mode, requestFactory) {
    return new Promise((resolve, reject) => {
      const transaction = state.db.transaction(
        CONFIG.STORE_NAME,
        mode
      );
      const store = transaction.objectStore(CONFIG.STORE_NAME);
      const request = requestFactory(store);

      request.onsuccess = () => {
        resolve(request.result);
      };

      request.onerror = (event) => {
        reject(event.target.error);
      };
    });
  }

  function getErrorMessage(error) {
    return error && error.message
      ? String(error.message)
      : String(error || '不明なエラーです。');
  }
})();
