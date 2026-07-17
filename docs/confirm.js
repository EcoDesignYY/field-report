'use strict';

/**
 * 投稿確認・Google Driveアップロード画面 v0.1
 *
 * 役割:
 * - record.html / capture.html で保存したIndexedDB下書きを読み込む
 * - 件名・対象部署を入力する
 * - Google Identity ServicesでDrive APIアクセストークンを取得する
 * - Google Driveに1投稿1フォルダを作成する
 * - audio / image / metadata.json をアップロードする
 * - 任意でGASの処理発火POSTを送る
 */

const CONFIG = {
  GOOGLE_CLIENT_ID: '866457692941-cro6etg365bkgq6m0qpor789677g11lq.apps.googleusercontent.com',

  // 既存の投稿ルートフォルダIDを入れてください
  DRIVE_ROOT_FOLDER_ID: '1oRhXuGn0YE1C-eKyG7MHNObLr1ficZ-p',

  // 次工程で設定。今は空でOK
  GAS_TRIGGER_URL: '',

  DRIVE_SCOPE: 'https://www.googleapis.com/auth/drive.file',

  DB_NAME: 'field-report-draft-db',
  DB_VERSION: 1,
  STORE_NAME: 'draft',

  REQUIRE_AUDIO: true,
  REQUIRE_IMAGE: false
};

const DEPARTMENT_LABELS = {
  maintenance: '保全部',
  quality: '品質管理部',
  production: '製造部',
  design: '設計部',
  general_affairs: '総務部'
};

const els = {
  backButton: document.getElementById('backButton'),
  helpButton: document.getElementById('helpButton'),

  titleInput: document.getElementById('titleInput'),
  departmentSelect: document.getElementById('departmentSelect'),

  audioStatusBadge: document.getElementById('audioStatusBadge'),
  audioSummary: document.getElementById('audioSummary'),
  audioPreviewArea: document.getElementById('audioPreviewArea'),
  playAudioButton: document.getElementById('playAudioButton'),
  audioPlayStatus: document.getElementById('audioPlayStatus'),
  audioPlayer: document.getElementById('audioPlayer'),

  imageStatusBadge: document.getElementById('imageStatusBadge'),
  imageSummary: document.getElementById('imageSummary'),
  imagePreview: document.getElementById('imagePreview'),

  audioMemoText: document.getElementById('audioMemoText'),
  imageMemoText: document.getElementById('imageMemoText'),

  driveAuthText: document.getElementById('driveAuthText'),
  authorizeButton: document.getElementById('authorizeButton'),

  statusBox: document.getElementById('statusBox'),
  resultCard: document.getElementById('resultCard'),
  folderLink: document.getElementById('folderLink'),

  uploadButton: document.getElementById('uploadButton'),
  backToCaptureButton: document.getElementById('backToCaptureButton')
};

const state = {
  authToken: '',
  accessToken: '',
  tokenClient: null,

  audioBlob: null,
  audioMeta: null,
  imageBlob: null,
  imageMeta: null,

  audioObjectUrl: '',
  imageObjectUrl: '',

  isUploading: false
};

init();

async function init() {
  try {
    state.authToken = sessionStorage.getItem('fieldReportToken') || '';

    if (!state.authToken) {
      setStatus('このページは直接開けません。\nGAS入口から開いてください。', 'error');
      disableAll();
      return;
    }

    bindEvents();

    await waitForGoogleIdentityServices();
    setupTokenClient();

    await loadDraftData();
    renderDraftSummary();
    updateUploadButtonState();

  } catch (error) {
    setStatus(`初期化エラー: ${error.message}`, 'error');
  }
}

function bindEvents() {
  els.backButton.addEventListener('click', () => {
    history.back();
  });

  els.helpButton.addEventListener('click', () => {
    setStatus(
      '投稿前の確認画面です。\n' +
      'Driveへ接続後、録音・画像・metadata.jsonを指定フォルダへ保存します。\n' +
      'GASへの処理発火は次工程で追加します。',
      'ok'
    );
  });

  els.titleInput.addEventListener('input', updateUploadButtonState);
  els.departmentSelect.addEventListener('change', updateUploadButtonState);

  els.authorizeButton.addEventListener('click', authorizeDrive);
  els.uploadButton.addEventListener('click', uploadReportToDrive);

  els.backToCaptureButton.addEventListener('click', () => {
    location.href = './capture.html';
  });

  els.playAudioButton.addEventListener('click', toggleAudioPlayback);

  els.audioPlayer.addEventListener('ended', () => {
    els.playAudioButton.textContent = '再生';
    els.audioPlayStatus.textContent = '再生終了';
  });
}

function waitForGoogleIdentityServices() {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();

    const timerId = window.setInterval(() => {
      if (window.google && google.accounts && google.accounts.oauth2) {
        window.clearInterval(timerId);
        resolve();
        return;
      }

      if (Date.now() - startedAt > 10000) {
        window.clearInterval(timerId);
        reject(new Error('Google Identity Servicesを読み込めませんでした。'));
      }
    }, 100);
  });
}

function setupTokenClient() {
  state.tokenClient = google.accounts.oauth2.initTokenClient({
    client_id: CONFIG.GOOGLE_CLIENT_ID,
    scope: CONFIG.DRIVE_SCOPE,
    callback: () => {}
  });
}

function authorizeDrive() {
  if (!state.tokenClient) {
    setStatus('Google認証の初期化が完了していません。', 'error');
    return;
  }

  requestAccessToken()
    .then(() => {
      els.driveAuthText.textContent = 'Driveへ接続済みです。投稿データを保存できます。';
      els.authorizeButton.textContent = '接続済み';
      updateUploadButtonState();
      setStatus('Google Driveへの接続を許可しました。', 'ok');
    })
    .catch((error) => {
      setStatus(`Drive接続に失敗しました。\n${error.message}`, 'error');
    });
}

function requestAccessToken() {
  return new Promise((resolve, reject) => {
    state.tokenClient.callback = (response) => {
      if (response.error) {
        reject(new Error(response.error));
        return;
      }

      state.accessToken = response.access_token || '';

      if (!state.accessToken) {
        reject(new Error('アクセストークンを取得できませんでした。'));
        return;
      }

      resolve(state.accessToken);
    };

    state.tokenClient.requestAccessToken({
      prompt: state.accessToken ? '' : 'consent'
    });
  });
}

async function loadDraftData() {
  state.audioBlob = await getDraft('audioBlob');
  state.audioMeta = await getDraft('audioMeta');

  state.imageBlob = await getDraft('imageBlob');
  state.imageMeta = await getDraft('imageMeta');
}

function renderDraftSummary() {
  renderAudioSummary();
  renderImageSummary();
  renderMemoSummary();
}

function renderAudioSummary() {
  if (!state.audioBlob) {
    setBadge(els.audioStatusBadge, CONFIG.REQUIRE_AUDIO ? '必須不足' : 'なし', 'error');
    els.audioSummary.textContent = CONFIG.REQUIRE_AUDIO
      ? '録音データがありません。録音画面に戻って録音してください。'
      : '録音データはありません。';
    els.audioPreviewArea.classList.add('hidden');
    return;
  }

  const sizeText = formatBytes(state.audioBlob.size);
  const fileName = state.audioMeta && state.audioMeta.fileName
    ? state.audioMeta.fileName
    : 'audio';

  setBadge(els.audioStatusBadge, '保存済み', 'ok');
  els.audioSummary.textContent = `${fileName}\n${sizeText}`;

  if (state.audioObjectUrl) {
    URL.revokeObjectURL(state.audioObjectUrl);
  }

  state.audioObjectUrl = URL.createObjectURL(state.audioBlob);
  els.audioPlayer.src = state.audioObjectUrl;
  els.audioPreviewArea.classList.remove('hidden');
}

function renderImageSummary() {
  if (!state.imageBlob) {
    setBadge(els.imageStatusBadge, CONFIG.REQUIRE_IMAGE ? '必須不足' : '任意なし', CONFIG.REQUIRE_IMAGE ? 'error' : 'gray');
    els.imageSummary.textContent = CONFIG.REQUIRE_IMAGE
      ? '画像データがありません。撮影または添付してください。'
      : '画像データはありません。画像なしでも投稿できます。';
    els.imagePreview.classList.add('hidden');
    return;
  }

  const sizeText = formatBytes(state.imageBlob.size);
  const fileName = state.imageMeta && state.imageMeta.fileName
    ? state.imageMeta.fileName
    : 'image.jpg';

  setBadge(els.imageStatusBadge, '保存済み', 'ok');
  els.imageSummary.textContent = `${fileName}\n${sizeText}`;

  if (state.imageObjectUrl) {
    URL.revokeObjectURL(state.imageObjectUrl);
  }

  state.imageObjectUrl = URL.createObjectURL(state.imageBlob);
  els.imagePreview.src = state.imageObjectUrl;
  els.imagePreview.classList.remove('hidden');
}

function renderMemoSummary() {
  const audioMemo = state.audioMeta && state.audioMeta.memo
    ? state.audioMeta.memo
    : 'なし';

  const imageMemo = state.imageMeta && state.imageMeta.memo
    ? state.imageMeta.memo
    : 'なし';

  els.audioMemoText.textContent = audioMemo;
  els.imageMemoText.textContent = imageMemo;
}

async function toggleAudioPlayback() {
  if (!els.audioPlayer.src) {
    setStatus('再生できる音声がありません。', 'error');
    return;
  }

  try {
    if (els.audioPlayer.paused) {
      await els.audioPlayer.play();
      els.playAudioButton.textContent = '停止';
      els.audioPlayStatus.textContent = '再生中';
    } else {
      els.audioPlayer.pause();
      els.playAudioButton.textContent = '再生';
      els.audioPlayStatus.textContent = '一時停止中';
    }
  } catch (error) {
    setStatus(`音声再生に失敗しました。\n${error.message}`, 'error');
  }
}

function updateUploadButtonState() {
  const title = els.titleInput.value.trim();
  const department = els.departmentSelect.value;

  const hasRequiredAudio = !CONFIG.REQUIRE_AUDIO || Boolean(state.audioBlob);
  const hasRequiredImage = !CONFIG.REQUIRE_IMAGE || Boolean(state.imageBlob);
  const hasToken = Boolean(state.accessToken);

  els.uploadButton.disabled = !(
    title &&
    department &&
    hasRequiredAudio &&
    hasRequiredImage &&
    hasToken &&
    !state.isUploading
  );
}

async function uploadReportToDrive() {
  if (state.isUploading) {
    return;
  }

  const title = els.titleInput.value.trim();
  const department = els.departmentSelect.value;

  if (!title) {
    setStatus('件名を入力してください。', 'error');
    return;
  }

  if (!department) {
    setStatus('対象部署を選択してください。', 'error');
    return;
  }

  if (CONFIG.REQUIRE_AUDIO && !state.audioBlob) {
    setStatus('録音データがありません。録音画面に戻って録音してください。', 'error');
    return;
  }

  if (CONFIG.REQUIRE_IMAGE && !state.imageBlob) {
    setStatus('画像データがありません。撮影または添付してください。', 'error');
    return;
  }

  try {
    state.isUploading = true;
    updateUploadButtonState();

    setStatus('投稿フォルダを作成しています...', 'ok');

    const reportId = buildReportId();
    const folderName = buildFolderName(reportId, title);

    const reportFolder = await createDriveFolder(folderName, CONFIG.DRIVE_ROOT_FOLDER_ID);

    const uploadedFiles = {};

    if (state.audioBlob) {
      setStatus('音声ファイルをアップロードしています...', 'ok');

      const audioName = state.audioMeta && state.audioMeta.fileName
        ? state.audioMeta.fileName
        : `audio_${reportId}.webm`;

      uploadedFiles.audio = await uploadMultipartFile({
        fileName: audioName,
        mimeType: state.audioBlob.type || 'application/octet-stream',
        blob: state.audioBlob,
        parentFolderId: reportFolder.id
      });
    }

    if (state.imageBlob) {
      setStatus('画像ファイルをアップロードしています...', 'ok');

      const imageName = state.imageMeta && state.imageMeta.fileName
        ? state.imageMeta.fileName
        : `image_${reportId}.jpg`;

      uploadedFiles.image = await uploadMultipartFile({
        fileName: imageName,
        mimeType: state.imageBlob.type || 'image/jpeg',
        blob: state.imageBlob,
        parentFolderId: reportFolder.id
      });
    }

    setStatus('metadata.jsonを作成しています...', 'ok');

    const metadata = buildReportMetadata({
      reportId,
      title,
      department,
      reportFolder,
      uploadedFiles
    });

    const metadataBlob = new Blob(
      [JSON.stringify(metadata, null, 2)],
      { type: 'application/json' }
    );

    uploadedFiles.metadata = await uploadMultipartFile({
      fileName: 'metadata.json',
      mimeType: 'application/json',
      blob: metadataBlob,
      parentFolderId: reportFolder.id
    });

    await putDraft('uploadResult', {
      reportId,
      folderId: reportFolder.id,
      folderName: reportFolder.name,
      folderUrl: reportFolder.webViewLink || '',
      files: uploadedFiles,
      uploadedAt: new Date().toISOString()
    });

    await triggerGasProcessing();

    setStatus('', '');
    showUploadResult(reportFolder);

  } catch (error) {
    setStatus(`Drive保存に失敗しました。\n${error.message}`, 'error');
  } finally {
    state.isUploading = false;
    updateUploadButtonState();
  }
}

async function createDriveFolder(folderName, parentFolderId) {
  const metadata = {
    name: folderName,
    mimeType: 'application/vnd.google-apps.folder',
    parents: [parentFolderId]
  };

  const url =
    'https://www.googleapis.com/drive/v3/files' +
    '?supportsAllDrives=true' +
    '&fields=id,name,mimeType,webViewLink';

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${state.accessToken}`,
      'Content-Type': 'application/json; charset=UTF-8'
    },
    body: JSON.stringify(metadata)
  });

  return parseDriveResponse(response, '投稿フォルダ作成');
}

async function uploadMultipartFile({ fileName, mimeType, blob, parentFolderId }) {
  const boundary = `field_report_boundary_${Date.now()}_${Math.random().toString(36).slice(2)}`;

  const metadata = {
    name: fileName,
    mimeType,
    parents: [parentFolderId]
  };

  const multipartBody = new Blob([
    `--${boundary}\r\n`,
    'Content-Type: application/json; charset=UTF-8\r\n\r\n',
    JSON.stringify(metadata),
    `\r\n--${boundary}\r\n`,
    `Content-Type: ${mimeType}\r\n\r\n`,
    blob,
    `\r\n--${boundary}--`
  ], {
    type: `multipart/related; boundary=${boundary}`
  });

  const url =
    'https://www.googleapis.com/upload/drive/v3/files' +
    '?uploadType=multipart' +
    '&supportsAllDrives=true' +
    '&fields=id,name,mimeType,webViewLink,size';

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${state.accessToken}`
    },
    body: multipartBody
  });

  return parseDriveResponse(response, `${fileName} アップロード`);
}

async function parseDriveResponse(response, label) {
  const text = await response.text();

  let data = {};
  if (text) {
    try {
      data = JSON.parse(text);
    } catch (_) {
      data = { raw: text };
    }
  }

  if (!response.ok) {
    const message = data && data.error && data.error.message
      ? data.error.message
      : text || `HTTP ${response.status}`;

    throw new Error(`${label}に失敗しました。\n${message}`);
  }

  return data;
}

function buildReportMetadata({ reportId, title, department, reportFolder, uploadedFiles }) {
  return {
    schemaVersion: 1,
    reportId,
    clientCreatedAt: new Date().toISOString(),
    title,
    targetDepartment: department,
    targetDepartmentName: DEPARTMENT_LABELS[department] || department,
    status: 'uploaded',
    folder: {
      id: reportFolder.id,
      name: reportFolder.name,
      url: reportFolder.webViewLink || ''
    },
    audio: uploadedFiles.audio
      ? {
          id: uploadedFiles.audio.id,
          name: uploadedFiles.audio.name,
          mimeType: uploadedFiles.audio.mimeType,
          url: uploadedFiles.audio.webViewLink || '',
          memo: state.audioMeta && state.audioMeta.memo ? state.audioMeta.memo : ''
        }
      : null,
    image: uploadedFiles.image
      ? {
          id: uploadedFiles.image.id,
          name: uploadedFiles.image.name,
          mimeType: uploadedFiles.image.mimeType,
          url: uploadedFiles.image.webViewLink || '',
          memo: state.imageMeta && state.imageMeta.memo ? state.imageMeta.memo : ''
        }
      : null,
    source: {
      app: 'field-report',
      page: 'confirm.html'
    }
  };
}

async function triggerGasProcessing() {
  if (!CONFIG.GAS_TRIGGER_URL) {
    return;
  }

  try {
    await fetch(CONFIG.GAS_TRIGGER_URL, {
      method: 'POST',
      mode: 'no-cors',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8'
      },
      body: 'trigger=1'
    });
  } catch (_) {
    // no-corsの発火POSTなので、失敗してもDrive保存自体は成功扱いにする
  }
}

function showUploadResult(reportFolder) {
  els.resultCard.classList.remove('hidden');

  if (reportFolder.webViewLink) {
    els.folderLink.href = reportFolder.webViewLink;
    els.folderLink.classList.remove('hidden');
  } else {
    els.folderLink.classList.add('hidden');
  }

  setStatus('投稿データをDriveへ保存しました。', 'ok');
}

function buildReportId() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  const ss = String(now.getSeconds()).padStart(2, '0');
  const rand = Math.random().toString(36).slice(2, 8).toUpperCase();

  return `RPT-${y}${m}${d}-${hh}${mm}${ss}-${rand}`;
}

function buildFolderName(reportId, title) {
  const safeTitle = String(title)
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 40);

  return `${reportId}_${safeTitle || 'no-title'}`;
}

function setBadge(element, text, type) {
  element.textContent = text;
  element.classList.remove('gray', 'ok', 'error');
  element.classList.add(type || 'gray');
}

function setStatus(message, type) {
  if (!message) {
    els.statusBox.textContent = '';
    els.statusBox.classList.add('hidden');
    els.statusBox.classList.remove('ok', 'error');
    return;
  }

  els.statusBox.textContent = message;
  els.statusBox.classList.remove('hidden', 'ok', 'error');

  if (type === 'ok') {
    els.statusBox.classList.add('ok');
  }

  if (type === 'error') {
    els.statusBox.classList.add('error');
  }
}

function disableAll() {
  els.titleInput.disabled = true;
  els.departmentSelect.disabled = true;
  els.authorizeButton.disabled = true;
  els.uploadButton.disabled = true;
}

function formatBytes(bytes) {
  const value = Number(bytes) || 0;

  if (value < 1024) {
    return `${value} B`;
  }

  if (value < 1024 * 1024) {
    return `${(value / 1024).toFixed(1)} KB`;
  }

  return `${(value / 1024 / 1024).toFixed(1)} MB`;
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
