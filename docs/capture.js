'use strict';

/**
 * 撮影・添付画面 v0.1
 *
 * 役割:
 * - token確認
 * - カメラ撮影
 * - 画像ファイル添付
 * - 画像メモ入力
 * - 画像データをIndexedDBへ保存
 * - 次の投稿確認画面へ遷移
 *
 * この画面ではDrive保存・GAS送信は行わない。
 */

const CONFIG = {
  NEXT_PAGE_URL: './confirm.html',
  DB_NAME: 'field-report-draft-db',
  DB_VERSION: 1,
  STORE_NAME: 'draft',
  IMAGE_MAX_WIDTH: 1600,
  IMAGE_JPEG_QUALITY: 0.84
};

const els = {
  backButton: document.getElementById('backButton'),
  helpButton: document.getElementById('helpButton'),

  cameraStatusChip: document.getElementById('cameraStatusChip'),
  cameraStatusText: document.getElementById('cameraStatusText'),

  previewCard: document.querySelector('.preview-card'),
  cameraOverlay: document.getElementById('cameraOverlay'),
  cameraVideo: document.getElementById('cameraVideo'),
  emptyPreview: document.getElementById('emptyPreview'),
  imagePreview: document.getElementById('imagePreview'),
  captureCanvas: document.getElementById('captureCanvas'),

  retakeButton: document.getElementById('retakeButton'),
  shutterButton: document.getElementById('shutterButton'),

  imageFileInput: document.getElementById('imageFileInput'),
  imageFileInput2: document.getElementById('imageFileInput2'),

  cameraModeButton: document.getElementById('cameraModeButton'),

  imageMemoInput: document.getElementById('imageMemoInput'),

  statusBox: document.getElementById('statusBox'),

  nextButton: document.getElementById('nextButton'),
  skipButton: document.getElementById('skipButton')
};

const state = {
  authToken: '',
  cameraStream: null,
  imageBlob: null,
  imageFileName: '',
  imageMimeType: 'image/jpeg',
  objectUrl: ''
};

init();

async function init() {
  try {
    state.authToken = getTokenFromSession();

    if (!state.authToken) {
      setStatus(
        'このページは直接開けません。\nGAS入口から開いてください。',
        'error'
      );
      disableControls();
      setCameraStatus('認証が必要です', 'error');
      return;
    }

    if (!window.isSecureContext) {
      setStatus(
        'このページは安全な接続ではありません。\nカメラを使用するにはHTTPSで開いてください。',
        'error'
      );
      disableControls();
      setCameraStatus('HTTPSが必要です', 'error');
      return;
    }

    bindEvents();

    await restoreDraftImageIfExists();

    if (!state.imageBlob) {
      setCameraStatus('カメラ準備完了', 'ready');
      setStatus(getRecommendedBrowserMessage(), 'ok');
    }

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
      '撮影のコツ:\n' +
      '・対象物が全体的に写る距離で撮影してください。\n' +
      '・不具合箇所が小さい場合は、画像メモで補足してください。\n' +
      '・カメラが使えない場合は「画像を選択」から添付してください。',
      'ok'
    );
  });

  els.shutterButton.addEventListener('click', handleShutterButtonClick);
  els.retakeButton.addEventListener('click', retakeImage);

  els.imageFileInput.addEventListener('change', handleImageFileChange);
  els.imageFileInput2.addEventListener('change', handleImageFileChange);

  els.cameraModeButton.addEventListener('click', async () => {
    await startCamera();
  });

  els.nextButton.addEventListener('click', saveAndGoNext);
  els.skipButton.addEventListener('click', skipAndGoNext);

  window.addEventListener('pagehide', () => {
    stopCamera();
  });
}

function getTokenFromSession() {
  return sessionStorage.getItem('fieldReportToken') || '';
}

async function handleShutterButtonClick() {
  if (!state.cameraStream) {
    await startCamera();
    return;
  }

  captureImage();
}

async function startCamera() {
  try {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      throw new Error('このブラウザはカメラ取得に対応していません。');
    }

    clearPreviewOnly();
    stopCamera();

    state.cameraStream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: { ideal: 'environment' },
        width: { ideal: 1280 },
        height: { ideal: 960 }
      },
      audio: false
    });

    els.cameraVideo.srcObject = state.cameraStream;
    els.cameraVideo.classList.add('active');

    els.emptyPreview.classList.add('hidden');
    els.imagePreview.classList.add('hidden');
    els.cameraOverlay.classList.remove('hidden');

    els.shutterButton.innerHTML = '<span>📷</span>';
    els.retakeButton.disabled = true;
    els.nextButton.disabled = true;

    setCameraStatus('カメラ起動中', 'active');
    setStatus('カメラを起動しました。中央のボタンで撮影してください。', 'ok');

  } catch (error) {
    stopCamera();
    setCameraStatus('カメラ不可', 'error');

    setStatus(
      `カメラを起動できませんでした。\n\n` +
      `原因候補:\n` +
      `・カメラ権限が拒否されている\n` +
      `・アプリ内ブラウザで開いている\n` +
      `・端末側でカメラ使用が制限されている\n\n` +
      `対処:\n` +
      `・iPhoneはSafariで開いてください\n` +
      `・AndroidはChromeで開いてください\n` +
      `・ecodesignyy.github.io のカメラ権限を許可してください\n` +
      `・カメラ不可の場合は「画像を選択」から添付してください\n\n` +
      `詳細: ${error.message}`,
      'error'
    );
  }
}

function captureImage() {
  if (!state.cameraStream) {
    setStatus('カメラが起動していません。', 'error');
    return;
  }

  const video = els.cameraVideo;
  const canvas = els.captureCanvas;

  const sourceWidth = video.videoWidth;
  const sourceHeight = video.videoHeight;

  if (!sourceWidth || !sourceHeight) {
    setStatus('カメラ映像の取得に失敗しました。', 'error');
    return;
  }

  const size = calculateResizeSize(sourceWidth, sourceHeight, CONFIG.IMAGE_MAX_WIDTH);

  canvas.width = size.width;
  canvas.height = size.height;

  const context = canvas.getContext('2d');
  context.drawImage(video, 0, 0, size.width, size.height);

  canvas.toBlob((blob) => {
    if (!blob) {
      setStatus('画像生成に失敗しました。', 'error');
      return;
    }

    state.imageBlob = blob;
    state.imageMimeType = 'image/jpeg';
    state.imageFileName = `image_${formatDateForFile(new Date())}.jpg`;

    setupImagePreview(blob);
    stopCamera();

    els.retakeButton.disabled = false;
    els.nextButton.disabled = false;

    setCameraStatus('画像選択済み', 'ready');
    setStatus('画像を撮影しました。必要に応じて画像メモを入力してください。', 'ok');

  }, 'image/jpeg', CONFIG.IMAGE_JPEG_QUALITY);
}

async function handleImageFileChange(event) {
  const file = event.target.files && event.target.files[0];

  if (!file) {
    return;
  }

  if (!file.type.startsWith('image/')) {
    setStatus('画像ファイルを選択してください。', 'error');
    return;
  }

  try {
    stopCamera();

    const resizedBlob = await resizeImageFile(
      file,
      CONFIG.IMAGE_MAX_WIDTH,
      CONFIG.IMAGE_JPEG_QUALITY
    );

    state.imageBlob = resizedBlob;
    state.imageMimeType = 'image/jpeg';
    state.imageFileName = normalizeFileName(file.name || `image_${formatDateForFile(new Date())}.jpg`);

    setupImagePreview(resizedBlob);

    els.retakeButton.disabled = false;
    els.nextButton.disabled = false;

    setCameraStatus('画像選択済み', 'ready');
    setStatus('画像を選択しました。必要に応じて画像メモを入力してください。', 'ok');

  } catch (error) {
    setStatus(`画像処理エラー: ${error.message}`, 'error');
  } finally {
    els.imageFileInput.value = '';
    els.imageFileInput2.value = '';
  }
}

function setupImagePreview(blob) {
  if (state.objectUrl) {
    URL.revokeObjectURL(state.objectUrl);
  }

  state.objectUrl = URL.createObjectURL(blob);

  els.imagePreview.src = state.objectUrl;
  els.imagePreview.classList.remove('hidden');

  els.cameraVideo.classList.remove('active');
  els.emptyPreview.classList.add('hidden');
  els.cameraOverlay.classList.add('hidden');
}

async function retakeImage() {
  state.imageBlob = null;
  state.imageFileName = '';
  state.imageMimeType = 'image/jpeg';

  if (state.objectUrl) {
    URL.revokeObjectURL(state.objectUrl);
    state.objectUrl = '';
  }

  els.imagePreview.removeAttribute('src');
  els.imagePreview.classList.add('hidden');
  els.nextButton.disabled = true;
  els.retakeButton.disabled = true;

  await deleteDraftKey('imageBlob');
  await deleteDraftKey('imageMeta');

  await startCamera();
}

function clearPreviewOnly() {
  if (state.objectUrl) {
    URL.revokeObjectURL(state.objectUrl);
    state.objectUrl = '';
  }

  els.imagePreview.removeAttribute('src');
  els.imagePreview.classList.add('hidden');
  els.emptyPreview.classList.remove('hidden');
  els.cameraOverlay.classList.add('hidden');
}

function stopCamera() {
  if (state.cameraStream) {
    state.cameraStream.getTracks().forEach((track) => track.stop());
    state.cameraStream = null;
  }

  els.cameraVideo.srcObject = null;
  els.cameraVideo.classList.remove('active');
  els.cameraOverlay.classList.add('hidden');
}

async function saveAndGoNext() {
  try {
    if (!state.imageBlob) {
      setStatus('画像がありません。撮影または画像選択を行ってください。', 'error');
      return;
    }

    await saveDraftToIndexedDb();

    sessionStorage.setItem('fieldReportHasImage', '1');
    location.href = CONFIG.NEXT_PAGE_URL;

  } catch (error) {
    setStatus(`保存エラー: ${error.message}`, 'error');
  }
}

async function skipAndGoNext() {
  sessionStorage.setItem('fieldReportHasImage', '0');
  location.href = CONFIG.NEXT_PAGE_URL;
}

async function saveDraftToIndexedDb() {
  const memo = els.imageMemoInput.value.trim();

  if (state.imageBlob) {
    await putDraft('imageBlob', state.imageBlob);
  }

  await putDraft('imageMeta', {
    fileName: state.imageFileName,
    mimeType: state.imageMimeType,
    size: state.imageBlob ? state.imageBlob.size : 0,
    memo,
    savedAt: new Date().toISOString()
  });
}

async function restoreDraftImageIfExists() {
  const blob = await getDraft('imageBlob');
  const meta = await getDraft('imageMeta');

  if (!blob) {
    return;
  }

  state.imageBlob = blob;
  state.imageMimeType = meta && meta.mimeType ? meta.mimeType : blob.type || 'image/jpeg';
  state.imageFileName = meta && meta.fileName ? meta.fileName : `image_${formatDateForFile(new Date())}.jpg`;

  if (meta && meta.memo) {
    els.imageMemoInput.value = meta.memo;
  }

  setupImagePreview(blob);

  els.retakeButton.disabled = false;
  els.nextButton.disabled = false;

  setCameraStatus('画像復元済み', 'ready');
  setStatus('前回保存した画像データを復元しました。', 'ok');
}

function resizeImageFile(file, maxWidth, quality) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);

    img.onload = () => {
      try {
        const size = calculateResizeSize(img.naturalWidth, img.naturalHeight, maxWidth);
        const canvas = document.createElement('canvas');

        canvas.width = size.width;
        canvas.height = size.height;

        const context = canvas.getContext('2d');
        context.drawImage(img, 0, 0, size.width, size.height);

        canvas.toBlob((blob) => {
          URL.revokeObjectURL(url);

          if (!blob) {
            reject(new Error('画像圧縮に失敗しました。'));
            return;
          }

          resolve(blob);
        }, 'image/jpeg', quality);

      } catch (error) {
        URL.revokeObjectURL(url);
        reject(error);
      }
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('画像を読み込めませんでした。'));
    };

    img.src = url;
  });
}

function calculateResizeSize(width, height, maxWidth) {
  if (width <= maxWidth) {
    return { width, height };
  }

  const ratio = maxWidth / width;

  return {
    width: Math.round(width * ratio),
    height: Math.round(height * ratio)
  };
}

function normalizeFileName(name) {
  const safeName = String(name)
    .replace(/[\\/:*?"<>|]/g, '_')
    .trim();

  if (!safeName) {
    return `image_${formatDateForFile(new Date())}.jpg`;
  }

  if (!/\.(jpg|jpeg|png|webp)$/i.test(safeName)) {
    return `${safeName}.jpg`;
  }

  return safeName;
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

function setCameraStatus(text, mode) {
  els.cameraStatusText.textContent = text;
  els.cameraStatusChip.classList.remove('error', 'active');

  if (mode === 'error') {
    els.cameraStatusChip.classList.add('error');
  }

  if (mode === 'active') {
    els.cameraStatusChip.classList.add('active');
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
  els.shutterButton.disabled = true;
  els.retakeButton.disabled = true;
  els.nextButton.disabled = true;
  els.skipButton.disabled = true;
  els.imageFileInput.disabled = true;
  els.imageFileInput2.disabled = true;
}

function getRecommendedBrowserMessage() {
  const ua = navigator.userAgent || '';

  if (/iPhone|iPad|iPod/.test(ua) && /CriOS/.test(ua)) {
    return 'iPhoneのChromeではカメラ・録音が不安定な場合があります。\nSafariでの利用を推奨します。';
  }

  return '撮影準備ができました。中央のボタンでカメラを起動できます。';
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
