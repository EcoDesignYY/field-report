'use strict';

/****************************************************
 * 現場問題提起ツール v0.1
 * GitHub Pages Frontend
 *
 * 機能:
 * - token取得
 * - カメラ撮影
 * - 画像選択
 * - 音声録音 最大60秒
 * - GASへ投稿
 ****************************************************/

const CONFIG = {
  // GAS WebアプリURL
  GAS_POST_URL: 'https://script.google.com/a/macros/ecodesign-labo.jp/s/AKfycbzyU4I8u5csBb7qRIWvSGwPBrDcYAv0p6rPO6-ModBzPCtwavFeeSaGcOf-TwJeyb7BfQ/exec',

  MAX_RECORDING_SECONDS: 60,
  IMAGE_MAX_WIDTH: 1280,
  IMAGE_JPEG_QUALITY: 0.82
};

const els = {
  titleInput: document.getElementById('titleInput'),
  memoInput: document.getElementById('memoInput'),

  startCameraButton: document.getElementById('startCameraButton'),
  captureButton: document.getElementById('captureButton'),
  stopCameraButton: document.getElementById('stopCameraButton'),
  cameraVideo: document.getElementById('cameraVideo'),
  captureCanvas: document.getElementById('captureCanvas'),

  imageFileInput: document.getElementById('imageFileInput'),
  imagePreviewArea: document.getElementById('imagePreviewArea'),
  imagePreview: document.getElementById('imagePreview'),
  clearImageButton: document.getElementById('clearImageButton'),

  startRecordingButton: document.getElementById('startRecordingButton'),
  stopRecordingButton: document.getElementById('stopRecordingButton'),
  clearAudioButton: document.getElementById('clearAudioButton'),
  recordingStatus: document.getElementById('recordingStatus'),
  recordingTimer: document.getElementById('recordingTimer'),
  audioPlayer: document.getElementById('audioPlayer'),

  submitButton: document.getElementById('submitButton'),
  statusBox: document.getElementById('statusBox')
};

let authToken = '';
let cameraStream = null;

let imageBlob = null;
let imageName = '';

let mediaRecorder = null;
let audioStream = null;
let audioChunks = [];
let audioBlob = null;

let recordingStartedAt = 0;
let recordingTimerId = null;
let recordingAutoStopId = null;

init();

function init() {
  authToken = getTokenFromUrlOrStorage();

  if (!authToken) {
    setStatus('GAS入口から開いてください。\n認証tokenがありません。', 'error');
    disableForm();
    return;
  }

  setStatus('認証済みです。投稿できます。', 'ok');
  bindEvents();
}

function bindEvents() {
  els.startCameraButton.addEventListener('click', startCamera);
  els.captureButton.addEventListener('click', captureImage);
  els.stopCameraButton.addEventListener('click', stopCamera);

  els.imageFileInput.addEventListener('change', handleImageFileChange);
  els.clearImageButton.addEventListener('click', clearImage);

  els.startRecordingButton.addEventListener('click', startRecording);
  els.stopRecordingButton.addEventListener('click', stopRecording);
  els.clearAudioButton.addEventListener('click', clearAudio);

  els.submitButton.addEventListener('click', submitReport);
}

function getTokenFromUrlOrStorage() {
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

async function startCamera() {
  try {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      throw new Error('このブラウザはカメラに対応していません。');
    }

    stopCamera();

    cameraStream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: { ideal: 'environment' },
        width: { ideal: 1280 },
        height: { ideal: 720 }
      },
      audio: false
    });

    els.cameraVideo.srcObject = cameraStream;
    els.cameraVideo.classList.add('active');

    els.captureButton.disabled = false;
    els.stopCameraButton.disabled = false;
    els.startCameraButton.disabled = true;

    setStatus('カメラを起動しました。', 'ok');

  } catch (error) {
    setStatus(`カメラ起動エラー: ${error.message}`, 'error');
  }
}

function captureImage() {
  if (!cameraStream) {
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

    imageBlob = blob;
    imageName = `capture_${formatDateForFile(new Date())}.jpg`;

    showImagePreview(blob);
    setStatus('画像を撮影しました。', 'ok');
  }, 'image/jpeg', CONFIG.IMAGE_JPEG_QUALITY);
}

function stopCamera() {
  if (cameraStream) {
    cameraStream.getTracks().forEach((track) => track.stop());
    cameraStream = null;
  }

  els.cameraVideo.srcObject = null;
  els.cameraVideo.classList.remove('active');

  els.captureButton.disabled = true;
  els.stopCameraButton.disabled = true;
  els.startCameraButton.disabled = false;
}

async function handleImageFileChange() {
  const file = els.imageFileInput.files && els.imageFileInput.files[0];

  if (!file) {
    return;
  }

  if (!file.type.startsWith('image/')) {
    setStatus('画像ファイルを選択してください。', 'error');
    return;
  }

  try {
    const resizedBlob = await resizeImageFile(file, CONFIG.IMAGE_MAX_WIDTH, CONFIG.IMAGE_JPEG_QUALITY);
    imageBlob = resizedBlob;
    imageName = normalizeFileName(file.name || `image_${formatDateForFile(new Date())}.jpg`, '.jpg');

    showImagePreview(imageBlob);
    setStatus('画像を選択しました。', 'ok');

  } catch (error) {
    setStatus(`画像処理エラー: ${error.message}`, 'error');
  }
}

function showImagePreview(blob) {
  const url = URL.createObjectURL(blob);
  els.imagePreview.src = url;
  els.imagePreviewArea.classList.remove('hidden');
}

function clearImage() {
  imageBlob = null;
  imageName = '';
  els.imagePreview.removeAttribute('src');
  els.imagePreviewArea.classList.add('hidden');
  els.imageFileInput.value = '';
  setStatus('画像を削除しました。', 'ok');
}

async function startRecording() {
  try {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      throw new Error('このブラウザは録音に対応していません。');
    }

    clearAudio();

    audioStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true
      },
      video: false
    });

    const mimeType = getSupportedAudioMimeType();

    mediaRecorder = new MediaRecorder(audioStream, mimeType ? { mimeType } : undefined);
    audioChunks = [];

    mediaRecorder.addEventListener('dataavailable', (event) => {
      if (event.data && event.data.size > 0) {
        audioChunks.push(event.data);
      }
    });

    mediaRecorder.addEventListener('stop', () => {
      const type = mimeType || 'audio/webm';
      audioBlob = new Blob(audioChunks, { type });

      els.audioPlayer.src = URL.createObjectURL(audioBlob);
      els.clearAudioButton.disabled = false;

      cleanupRecordingStream();
      stopRecordingTimer();

      els.recordingStatus.textContent = '録音完了';
      setStatus('録音が完了しました。', 'ok');
    });

    mediaRecorder.start();

    recordingStartedAt = Date.now();
    startRecordingTimer();

    recordingAutoStopId = window.setTimeout(() => {
      if (mediaRecorder && mediaRecorder.state === 'recording') {
        stopRecording();
      }
    }, CONFIG.MAX_RECORDING_SECONDS * 1000);

    els.startRecordingButton.disabled = true;
    els.stopRecordingButton.disabled = false;
    els.clearAudioButton.disabled = true;
    els.recordingStatus.textContent = '録音中';

    setStatus('録音中です。', 'ok');

  } catch (error) {
    cleanupRecordingStream();
    setStatus(`録音開始エラー: ${error.message}`, 'error');
  }
}

function stopRecording() {
  if (!mediaRecorder || mediaRecorder.state !== 'recording') {
    return;
  }

  mediaRecorder.stop();

  els.startRecordingButton.disabled = false;
  els.stopRecordingButton.disabled = true;

  if (recordingAutoStopId) {
    window.clearTimeout(recordingAutoStopId);
    recordingAutoStopId = null;
  }
}

function clearAudio() {
  if (mediaRecorder && mediaRecorder.state === 'recording') {
    mediaRecorder.stop();
  }

  cleanupRecordingStream();
  stopRecordingTimer();

  audioChunks = [];
  audioBlob = null;

  els.audioPlayer.removeAttribute('src');
  els.recordingStatus.textContent = '未録音';
  els.recordingTimer.textContent = '00:00';

  els.startRecordingButton.disabled = false;
  els.stopRecordingButton.disabled = true;
  els.clearAudioButton.disabled = true;
}

function cleanupRecordingStream() {
  if (audioStream) {
    audioStream.getTracks().forEach((track) => track.stop());
    audioStream = null;
  }
}

function startRecordingTimer() {
  stopRecordingTimer();

  recordingTimerId = window.setInterval(() => {
    const elapsedSeconds = Math.floor((Date.now() - recordingStartedAt) / 1000);
    els.recordingTimer.textContent = formatSeconds(elapsedSeconds);
  }, 250);
}

function stopRecordingTimer() {
  if (recordingTimerId) {
    window.clearInterval(recordingTimerId);
    recordingTimerId = null;
  }

  if (recordingAutoStopId) {
    window.clearTimeout(recordingAutoStopId);
    recordingAutoStopId = null;
  }
}

async function submitReport() {
  const title = els.titleInput.value.trim();
  const memo = els.memoInput.value.trim();

  if (!title) {
    setStatus('件名を入力してください。', 'error');
    return;
  }

  if (!imageBlob && !audioBlob) {
    setStatus('画像または音声のどちらかを添付してください。', 'error');
    return;
  }

  els.submitButton.disabled = true;
  setStatus('投稿データを準備しています...', '');

  try {
    const payload = {
      token: authToken,
      title,
      memo,
      clientCreatedAt: new Date().toISOString(),

      imageBase64: '',
      imageMimeType: '',
      imageName: '',

      audioBase64: '',
      audioMimeType: '',
      audioName: ''
    };

    if (imageBlob) {
      payload.imageBase64 = stripBase64Header(await blobToDataUrl(imageBlob));
      payload.imageMimeType = imageBlob.type || 'image/jpeg';
      payload.imageName = imageName || `image_${formatDateForFile(new Date())}.jpg`;
    }

    if (audioBlob) {
      payload.audioBase64 = stripBase64Header(await blobToDataUrl(audioBlob));
      payload.audioMimeType = audioBlob.type || 'audio/webm';
      payload.audioName = `audio_${formatDateForFile(new Date())}.webm`;
    }

    await postToGas(payload);

    setStatus(
      '投稿を送信しました。\nDrive保存とSpreadsheet記録を確認してください。\n\n※v0.1ではCORS制約回避のため、画面側ではGASの処理結果本文を取得しません。',
      'ok'
    );

    resetFormAfterSubmit();

  } catch (error) {
    setStatus(`投稿エラー: ${error.message}`, 'error');

  } finally {
    els.submitButton.disabled = false;
  }
}

/**
 * GitHub Pages -> GAS
 *
 * CORS制約を避けるため mode:no-cors を使用。
 * この場合、レスポンス本文は読めない。
 */
async function postToGas(payload) {
  const body = new URLSearchParams();
  body.set('payload', JSON.stringify(payload));

  await fetch(CONFIG.GAS_POST_URL, {
    method: 'POST',
    mode: 'no-cors',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8'
    },
    body
  });
}

function resetFormAfterSubmit() {
  els.titleInput.value = '';
  els.memoInput.value = '';
  clearImage();
  clearAudio();
}

function disableForm() {
  els.titleInput.disabled = true;
  els.memoInput.disabled = true;
  els.startCameraButton.disabled = true;
  els.captureButton.disabled = true;
  els.stopCameraButton.disabled = true;
  els.imageFileInput.disabled = true;
  els.startRecordingButton.disabled = true;
  els.stopRecordingButton.disabled = true;
  els.clearAudioButton.disabled = true;
  els.submitButton.disabled = true;
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

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onloadend = () => {
      if (typeof reader.result !== 'string') {
        reject(new Error('Base64変換に失敗しました。'));
        return;
      }

      resolve(reader.result);
    };

    reader.onerror = () => reject(new Error('ファイル読み込みに失敗しました。'));
    reader.readAsDataURL(blob);
  });
}

function stripBase64Header(dataUrl) {
  return dataUrl.replace(/^data:.*;base64,/, '');
}

function getSupportedAudioMimeType() {
  const candidates = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/mp4'
  ];

  for (const type of candidates) {
    if (window.MediaRecorder && MediaRecorder.isTypeSupported(type)) {
      return type;
    }
  }

  return '';
}

function normalizeFileName(name, fallbackExt) {
  const safeName = String(name)
    .replace(/[\\/:*?"<>|]/g, '_')
    .trim();

  if (!safeName) {
    return `image_${formatDateForFile(new Date())}${fallbackExt}`;
  }

  return safeName;
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

function formatSeconds(seconds) {
  const mm = String(Math.floor(seconds / 60)).padStart(2, '0');
  const ss = String(seconds % 60).padStart(2, '0');
  return `${mm}:${ss}`;
}
