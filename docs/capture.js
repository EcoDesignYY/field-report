(() => {
  const CONFIG = {
    DB_NAME: 'field-report-draft-db',
    DB_VERSION: 1,
    STORE_NAME: 'draft',
    AUTH_TOKEN_STORAGE_KEY: 'fieldReportAuthToken',
    NEXT_PAGE_URL: './confirm.html',
    IMAGE_MAX_WIDTH: 1600,
    IMAGE_JPEG_QUALITY: 0.82
  };

  const state = {
    db: null,
    authToken: '',
    stream: null,
    videoTrack: null,
    imageBlob: null,
    imageObjectUrl: '',
    imageMeta: null,
    isGridEnabled: false,
    zoomSupported: false,
    zoomMin: 1,
    zoomMax: 1,
    zoomStep: 0.1
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
      await loadExistingDraft();
      setStatus('', '');
      setCameraStatus('カメラ準備完了', 'ready');
    } catch (error) {
      setFatalState('初期化に失敗しました。\n' + getErrorMessage(error));
    }
  }

  function collectElements() {
    els.backButton = document.getElementById('backButton');
    els.helpButton = document.getElementById('helpButton');
    els.cameraStatusBadge = document.getElementById('cameraStatusBadge');
    els.cameraVideo = document.getElementById('cameraVideo');
    els.imagePreview = document.getElementById('imagePreview');
    els.emptyPreview = document.getElementById('emptyPreview');
    els.gridOverlay = document.getElementById('gridOverlay');
    els.gridToggleButton = document.getElementById('gridToggleButton');
    els.zoomBadge = document.getElementById('zoomBadge');
    els.zoomControl = document.getElementById('zoomControl');
    els.zoomValueText = document.getElementById('zoomValueText');
    els.zoomRange = document.getElementById('zoomRange');
    els.startCameraButton = document.getElementById('startCameraButton');
    els.captureButton = document.getElementById('captureButton');
    els.fileSelectButton = document.getElementById('fileSelectButton');
    els.imageFileInput = document.getElementById('imageFileInput');
    els.resetImageButton = document.getElementById('resetImageButton');
    els.stopCameraButton = document.getElementById('stopCameraButton');
    els.imageMemoInput = document.getElementById('imageMemoInput');
    els.nextButton = document.getElementById('nextButton');
    els.statusBox = document.getElementById('statusBox');
  }

  function bindEvents() {
    els.backButton.addEventListener('click', () => {
      location.href = './record.html';
    });

    els.helpButton.addEventListener('click', () => {
      setStatus(
        'カメラ起動後に中央の丸いボタンで撮影できます。\n画像ファイルを選択することもできます。画像なしでも次へ進めます。',
        'info'
      );
    });

    els.startCameraButton.addEventListener('click', startCamera);
    els.captureButton.addEventListener('click', captureImage);
    els.fileSelectButton.addEventListener('click', () => els.imageFileInput.click());
    els.imageFileInput.addEventListener('change', handleImageFileChange);
    els.resetImageButton.addEventListener('click', resetImage);
    els.stopCameraButton.addEventListener('click', stopCamera);
    els.gridToggleButton.addEventListener('click', toggleGrid);
    els.zoomRange.addEventListener('input', handleZoomInput);
    els.zoomRange.addEventListener('change', handleZoomChange);
    els.nextButton.addEventListener('click', saveAndGoNext);
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

  async function startCamera() {
    try {
      if (!window.isSecureContext) {
        throw new Error('カメラにはHTTPS環境が必要です。GitHub PagesのURLを直接開いてください。');
      }

      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error('このブラウザはカメラ機能に対応していません。');
      }

      stopCamera();

      const constraints = {
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1280 },
          height: { ideal: 720 }
        },
        audio: false
      };

      state.stream = await navigator.mediaDevices.getUserMedia(constraints);
      els.cameraVideo.srcObject = state.stream;
      await els.cameraVideo.play();

      state.videoTrack = state.stream.getVideoTracks()[0] || null;

      els.cameraVideo.classList.remove('hidden');
      els.emptyPreview.classList.add('hidden');
      els.captureButton.disabled = false;
      els.stopCameraButton.disabled = false;

      setCameraStatus('カメラ起動中', 'active');
      setupZoomControl();

    } catch (error) {
      stopCamera();
      setCameraStatus('カメラ不可', 'error');
      setStatus('カメラを起動できませんでした。\n' + getErrorMessage(error), 'error');
    }
  }

  async function captureImage() {
    if (!els.cameraVideo.videoWidth || !els.cameraVideo.videoHeight) {
      setStatus('カメラ映像を取得できていません。少し待ってから撮影してください。', 'warning');
      return;
    }

    try {
      const sourceWidth = els.cameraVideo.videoWidth;
      const sourceHeight = els.cameraVideo.videoHeight;

      const scale = Math.min(1, CONFIG.IMAGE_MAX_WIDTH / sourceWidth);
      const width = Math.round(sourceWidth * scale);
      const height = Math.round(sourceHeight * scale);

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;

      const ctx = canvas.getContext('2d');
      ctx.drawImage(els.cameraVideo, 0, 0, width, height);

      const blob = await canvasToBlob(canvas, 'image/jpeg', CONFIG.IMAGE_JPEG_QUALITY);

      setImageBlob(blob, {
        source: 'camera',
        width,
        height,
        mimeType: blob.type,
        size: blob.size,
        capturedAt: new Date().toISOString()
      });

      stopCamera();
      setStatus('画像を撮影しました。', 'success');

    } catch (error) {
      setStatus('撮影に失敗しました。\n' + getErrorMessage(error), 'error');
    }
  }

  async function handleImageFileChange(event) {
    const file = event.target.files && event.target.files[0];

    if (!file) return;

    if (!file.type || !file.type.startsWith('image/')) {
      setStatus('画像ファイルを選択してください。', 'error');
      return;
    }

    try {
      const normalized = await normalizeImageFile(file);

      setImageBlob(normalized.blob, {
        source: 'file',
        originalName: file.name,
        width: normalized.width,
        height: normalized.height,
        mimeType: normalized.blob.type,
        size: normalized.blob.size,
        selectedAt: new Date().toISOString()
      });

      stopCamera();
      setStatus('画像を読み込みました。', 'success');

    } catch (error) {
      setStatus('画像の読込に失敗しました。\n' + getErrorMessage(error), 'error');
    } finally {
      els.imageFileInput.value = '';
    }
  }

  function setImageBlob(blob, meta) {
    if (state.imageObjectUrl) {
      URL.revokeObjectURL(state.imageObjectUrl);
    }

    state.imageBlob = blob;
    state.imageMeta = meta || {};
    state.imageObjectUrl = URL.createObjectURL(blob);

    els.imagePreview.src = state.imageObjectUrl;
    els.imagePreview.classList.remove('hidden');
    els.emptyPreview.classList.add('hidden');
    els.resetImageButton.disabled = false;
  }

  function resetImage() {
    if (state.imageObjectUrl) {
      URL.revokeObjectURL(state.imageObjectUrl);
      state.imageObjectUrl = '';
    }

    state.imageBlob = null;
    state.imageMeta = null;
    els.imagePreview.removeAttribute('src');
    els.imagePreview.classList.add('hidden');

    if (!state.stream) {
      els.emptyPreview.classList.remove('hidden');
    }

    els.resetImageButton.disabled = true;
    setStatus('画像を削除しました。', 'info');
  }

  function stopCamera() {
    if (state.stream) {
      state.stream.getTracks().forEach(track => track.stop());
    }

    state.stream = null;
    state.videoTrack = null;
    els.cameraVideo.srcObject = null;
    els.captureButton.disabled = true;
    els.stopCameraButton.disabled = true;
    els.zoomControl.classList.add('hidden');
    els.zoomBadge.classList.add('hidden');

    if (!state.imageBlob) {
      els.emptyPreview.classList.remove('hidden');
    }

    setCameraStatus('カメラ準備完了', 'ready');
  }

  function toggleGrid() {
    state.isGridEnabled = !state.isGridEnabled;
    renderGridState();
  }

  function renderGridState() {
    if (state.isGridEnabled) {
      els.gridOverlay.classList.remove('hidden');
      els.gridToggleButton.textContent = 'グリッド ON';
    } else {
      els.gridOverlay.classList.add('hidden');
      els.gridToggleButton.textContent = 'グリッド OFF';
    }
  }

  function setupZoomControl() {
    state.zoomSupported = false;
    els.zoomControl.classList.add('hidden');
    els.zoomBadge.classList.add('hidden');

    if (!state.videoTrack || typeof state.videoTrack.getCapabilities !== 'function') {
      return;
    }

    const caps = state.videoTrack.getCapabilities();

    if (!caps || !caps.zoom) {
      return;
    }

    state.zoomSupported = true;
    state.zoomMin = caps.zoom.min || 1;
    state.zoomMax = caps.zoom.max || 1;
    state.zoomStep = caps.zoom.step || 0.1;

    els.zoomRange.min = String(state.zoomMin);
    els.zoomRange.max = String(state.zoomMax);
    els.zoomRange.step = String(state.zoomStep);
    els.zoomRange.value = String(state.zoomMin);

    renderZoomValue(state.zoomMin);

    els.zoomControl.classList.remove('hidden');
    els.zoomBadge.classList.remove('hidden');
  }

  function handleZoomInput() {
    const value = Number(els.zoomRange.value || state.zoomMin);
    renderZoomValue(value);
  }

  async function handleZoomChange() {
    const value = Number(els.zoomRange.value || state.zoomMin);
    await applyZoom(value);
  }

  async function applyZoom(value) {
    if (!state.videoTrack || !state.zoomSupported) return;

    try {
      await state.videoTrack.applyConstraints({
        advanced: [{ zoom: value }]
      });

      renderZoomValue(value);

    } catch (error) {
      setStatus('倍率変更に対応していない端末です。', 'warning');
    }
  }

  function renderZoomValue(value) {
    const text = Number(value).toFixed(1) + 'x';
    els.zoomValueText.textContent = text;
    els.zoomBadge.textContent = text;
  }

  async function saveAndGoNext() {
    try {
      const memo = els.imageMemoInput.value.trim();

      if (state.imageBlob) {
        const meta = {
          ...(state.imageMeta || {}),
          memo,
          savedAt: new Date().toISOString()
        };

        await putDraft('imageBlob', state.imageBlob);
        await putDraft('imageMeta', meta);
      } else {
        await deleteDraft('imageBlob');
        await deleteDraft('imageMeta');
      }

      stopCamera();
      location.href = CONFIG.NEXT_PAGE_URL;

    } catch (error) {
      setStatus('画像データの保存に失敗しました。\n' + getErrorMessage(error), 'error');
    }
  }

  async function loadExistingDraft() {
    const imageBlob = await getDraft('imageBlob');
    const imageMeta = await getDraft('imageMeta');

    if (imageBlob) {
      setImageBlob(imageBlob, imageMeta || {});

      if (imageMeta && imageMeta.memo) {
        els.imageMemoInput.value = imageMeta.memo;
      }
    }
  }

  function normalizeImageFile(file) {
    return new Promise((resolve, reject) => {
      const objectUrl = URL.createObjectURL(file);
      const img = new Image();

      img.onload = async () => {
        try {
          const sourceWidth = img.naturalWidth;
          const sourceHeight = img.naturalHeight;
          const scale = Math.min(1, CONFIG.IMAGE_MAX_WIDTH / sourceWidth);
          const width = Math.round(sourceWidth * scale);
          const height = Math.round(sourceHeight * scale);

          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;

          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, width, height);

          const blob = await canvasToBlob(canvas, 'image/jpeg', CONFIG.IMAGE_JPEG_QUALITY);

          URL.revokeObjectURL(objectUrl);

          resolve({
            blob,
            width,
            height
          });

        } catch (error) {
          URL.revokeObjectURL(objectUrl);
          reject(error);
        }
      };

      img.onerror = () => {
        URL.revokeObjectURL(objectUrl);
        reject(new Error('画像ファイルを読み込めませんでした。'));
      };

      img.src = objectUrl;
    });
  }

  function canvasToBlob(canvas, type, quality) {
    return new Promise((resolve, reject) => {
      canvas.toBlob(blob => {
        if (!blob) {
          reject(new Error('画像Blobの作成に失敗しました。'));
          return;
        }

        resolve(blob);
      }, type, quality);
    });
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

  function setCameraStatus(text, type) {
    els.cameraStatusBadge.textContent = text;
    els.cameraStatusBadge.classList.remove('status-ready', 'status-active', 'status-error');

    if (type === 'active') {
      els.cameraStatusBadge.classList.add('status-active');
    } else if (type === 'error') {
      els.cameraStatusBadge.classList.add('status-error');
    } else {
      els.cameraStatusBadge.classList.add('status-ready');
    }
  }

  function setFatalState(message) {
    setCameraStatus('利用不可', 'error');
    setStatus(message, 'error');
    els.startCameraButton.disabled = true;
    els.captureButton.disabled = true;
    els.fileSelectButton.disabled = true;
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
})();
