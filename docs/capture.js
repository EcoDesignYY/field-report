(() => {
  'use strict';

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

      if (!['text', 'audio'].includes(state.inputMode)) {
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
    const attachmentBytes = state.inputMode === 'text'
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
    const attachmentBytes = state.inputMode === 'text'
      ? state.attachments.reduce((sum, item) => {
          return sum + Number(
            item.size || (item.blob && item.blob.size) || 0
          );
        }, 0)
      : 0;
    els.imageSizeText.textContent = state.imageBlob
      ? '画像 ' + FieldReportAttachments.formatBytes(imageBytes)
      : '画像なし';
    els.totalUsageText.textContent = state.inputMode === 'text'
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
      if (state.inputMode === 'text') {
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
