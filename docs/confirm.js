(() => {
  'use strict';

  const CONFIG = {
    GOOGLE_CLIENT_ID: '866457692941-cro6etg365bkgq6m0qpor789677g11lq.apps.googleusercontent.com',
    GAS_WEB_APP_URL: 'https://script.google.com/a/macros/ecodesign-labo.jp/s/AKfycbzyU4I8u5csBb7qRIWvSGwPBrDcYAv0p6rPO6-ModBzPCtwavFeeSaGcOf-TwJeyb7BfQ/exec',
    DRIVE_ROOT_FOLDER_ID: '1oRhXuGn0YE1C-eKyG7MHNObLr1ficZ-p',
    DRIVE_SCOPE: 'https://www.googleapis.com/auth/drive',

    DB_NAME: 'field-report-draft-db',
    DB_VERSION: 1,
    STORE_NAME: 'draft',

    CONSENT_STORAGE_KEY: 'fieldReportDriveConsentGranted',
    AUTH_TOKEN_STORAGE_KEY: 'fieldReportAuthToken',
    REQUIRE_IMAGE: false
  };

  const FALLBACK_DEPARTMENTS = [
    '開発営業部',
    '設計部',
    '製造部',
    '技術部',
    '総務部',
    '業務部',
    '役員'
  ];

  const state = {
    authToken: '',
    appContext: null,
    submitter: null,
    departments: [],

    db: null,
    inputMode: '',
    draftStartedAt: '',
    textBody: '',
    textMeta: null,
    audioBlob: null,
    audioMeta: null,
    imageBlob: null,
    imageMeta: null,

    audioObjectUrl: '',
    imageObjectUrl: '',

    tokenClient: null,
    tokenResponse: null,
    accessToken: '',
    driveReady: false,

    isUploading: false,
    uploadResult: null
  };

  const elements = {};

  document.addEventListener('DOMContentLoaded', initializePage);

  async function initializePage() {
    collectElements();
    bindEvents();

    state.authToken = getAuthTokenFromUrlOrStorage();
    if (!state.authToken) {
      setFatalState('認証情報がありません。GAS入口から開き直してください。');
      return;
    }

    showStatus('投稿データを確認しています...', 'info');

    try {
      await loadDraftData();
      validateDraftData();
      renderInputSummary();
      renderImageSummary();
    } catch (error) {
      setFatalState('投稿データの読込に失敗しました。\n' + getErrorMessage(error));
      return;
    }

    try {
      await loadApplicationContext();
      renderUserAndDepartments();
    } catch (error) {
      state.submitter = { name: '', email: '', department: '', role: '' };
      state.departments = FALLBACK_DEPARTMENTS.slice();
      renderUserAndDepartments();
      showStatus(
        '従業員マスタ情報の取得に失敗したため、予備の部署一覧を表示しています。\n' + getErrorMessage(error),
        'warning'
      );
    }

    try {
      validateClientConfiguration();
      await waitForGoogleIdentityServices();
      setupDriveTokenClient();
      await checkDriveAuthorizationOnStartup();
    } catch (error) {
      state.driveReady = false;
      showDrivePermissionRequired('Google Driveの承認状態を確認できませんでした。');
      showStatus(getErrorMessage(error), 'warning');
    }

    updateUploadButtonState();
  }

  function collectElements() {
    elements.backButton = document.getElementById('backButton');
    elements.driveStatusBadge = document.getElementById('driveStatusBadge');
    elements.drivePermissionCard = document.getElementById('drivePermissionCard');
    elements.authorizeDriveButton = document.getElementById('authorizeDriveButton');

    elements.submitterName = document.getElementById('submitterName');
    elements.submitterDepartment = document.getElementById('submitterDepartment');
    elements.submitterEmail = document.getElementById('submitterEmail');
    elements.targetDepartmentSelect = document.getElementById('targetDepartmentSelect');

    elements.textSummaryCard = document.getElementById('textSummaryCard');
    elements.textStatus = document.getElementById('textStatus');
    elements.textBodyPreview = document.getElementById('textBodyPreview');

    elements.audioSummaryCard = document.getElementById('audioSummaryCard');
    elements.audioStatus = document.getElementById('audioStatus');
    elements.audioSummary = document.getElementById('audioSummary');
    elements.audioPlayer = document.getElementById('audioPlayer');
    elements.playAudioButton = document.getElementById('playAudioButton');
    elements.audioPlayStatus = document.getElementById('audioPlayStatus');
    elements.audioMemoText = document.getElementById('audioMemoText');

    elements.imageStatus = document.getElementById('imageStatus');
    elements.imageSummary = document.getElementById('imageSummary');
    elements.imagePreviewWrap = document.getElementById('imagePreviewWrap');
    elements.imagePreview = document.getElementById('imagePreview');
    elements.imageMemoText = document.getElementById('imageMemoText');

    elements.uploadButton = document.getElementById('uploadButton');
    elements.resultCard = document.getElementById('resultCard');
    elements.folderLink = document.getElementById('folderLink');
    elements.statusBox = document.getElementById('statusBox');
  }

  function bindEvents() {
    elements.backButton.addEventListener('click', () => {
      location.href = './capture.html';
    });

    elements.authorizeDriveButton.addEventListener('click', authorizeDriveByUserAction);
    elements.uploadButton.addEventListener('click', handleUploadClick);
    elements.playAudioButton.addEventListener('click', toggleAudioPlayback);
    elements.targetDepartmentSelect.addEventListener('change', updateUploadButtonState);

    elements.audioPlayer.addEventListener('ended', () => {
      elements.playAudioButton.textContent = '再生';
      elements.audioPlayStatus.textContent = '再生が終了しました';
    });
  }

  function validateClientConfiguration() {
    if (!CONFIG.GOOGLE_CLIENT_ID || CONFIG.GOOGLE_CLIENT_ID.includes('ここに')) {
      throw new Error('confirm.js の GOOGLE_CLIENT_ID を設定してください。');
    }
    if (!CONFIG.GAS_WEB_APP_URL) {
      throw new Error('confirm.js の GAS_WEB_APP_URL が未設定です。');
    }
    if (!CONFIG.DRIVE_ROOT_FOLDER_ID) {
      throw new Error('confirm.js の DRIVE_ROOT_FOLDER_ID が未設定です。');
    }
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

    return sessionStorage.getItem(CONFIG.AUTH_TOKEN_STORAGE_KEY)
      || sessionStorage.getItem('fieldReportToken')
      || '';
  }

  async function loadDraftData() {
    state.db = await openDatabase();

    state.inputMode = normalizeInputMode(await getDraft('inputMode'));
    state.draftStartedAt = String((await getDraft('draftStartedAt')) || '');
    state.textBody = String((await getDraft('textBody')) || '').trim();
    state.textMeta = await getDraft('textMeta');
    state.audioBlob = await getDraft('audioBlob');
    state.audioMeta = await getDraft('audioMeta');
    state.imageBlob = await getDraft('imageBlob');
    state.imageMeta = await getDraft('imageMeta');

    if (!state.inputMode) {
      state.inputMode = state.textBody ? 'text' : 'audio';
    }
  }

  function validateDraftData() {
    if (state.inputMode === 'text' && !state.textBody) {
      throw new Error('テキスト入力モードですが、入力本文がありません。');
    }

    if (state.inputMode === 'audio' && !state.audioBlob) {
      throw new Error('録音モードですが、録音データがありません。');
    }

    if (!['text', 'audio'].includes(state.inputMode)) {
      throw new Error('入力方式を判定できません。入力方法選択画面からやり直してください。');
    }
  }

  function renderInputSummary() {
    if (state.inputMode === 'text') {
      renderTextSummary();
      return;
    }
    renderAudioSummary();
  }

  function renderTextSummary() {
    elements.textSummaryCard.classList.remove('hidden');
    elements.audioSummaryCard.classList.add('hidden');
    elements.textStatus.textContent = '入力済み';
    elements.textStatus.style.background = '#dcfce7';
    elements.textStatus.style.color = '#166534';
    elements.textBodyPreview.textContent = state.textBody;
  }

  function renderAudioSummary() {
    elements.textSummaryCard.classList.add('hidden');
    elements.audioSummaryCard.classList.remove('hidden');

    if (state.audioObjectUrl) {
      URL.revokeObjectURL(state.audioObjectUrl);
    }

    state.audioObjectUrl = URL.createObjectURL(state.audioBlob);
    elements.audioPlayer.src = state.audioObjectUrl;
    elements.audioStatus.textContent = '録音あり';
    elements.audioStatus.style.background = '#dcfce7';
    elements.audioStatus.style.color = '#166534';

    const meta = state.audioMeta || {};
    const lines = [
      '音声サイズ：' + formatBytes(state.audioBlob.size),
      '音声形式：' + (state.audioBlob.type || meta.mimeType || '不明')
    ];

    if (meta.durationSec) {
      lines.push('録音時間：約' + Math.round(meta.durationSec) + '秒');
    }

    elements.audioSummary.textContent = lines.join('\n');
    elements.playAudioButton.disabled = false;
    elements.audioPlayStatus.textContent = '再生できます';
    elements.audioMemoText.textContent = meta.memo || meta.note || 'なし';
  }

  function renderImageSummary() {
    if (!state.imageBlob) {
      elements.imageStatus.textContent = CONFIG.REQUIRE_IMAGE ? '未添付' : '任意';
      elements.imageStatus.style.background = CONFIG.REQUIRE_IMAGE ? '#fee2e2' : '#f3f4f6';
      elements.imageStatus.style.color = CONFIG.REQUIRE_IMAGE ? '#991b1b' : '#374151';
      elements.imageSummary.textContent = CONFIG.REQUIRE_IMAGE
        ? '画像データがありません。撮影・添付画面に戻って画像を追加してください。'
        : '画像は添付されていません。画像なしでも投稿できます。';
      elements.imagePreviewWrap.classList.add('hidden');
      elements.imageMemoText.textContent = 'なし';
      return;
    }

    if (state.imageObjectUrl) {
      URL.revokeObjectURL(state.imageObjectUrl);
    }

    state.imageObjectUrl = URL.createObjectURL(state.imageBlob);
    elements.imagePreview.src = state.imageObjectUrl;
    elements.imagePreviewWrap.classList.remove('hidden');
    elements.imageStatus.textContent = '画像あり';
    elements.imageStatus.style.background = '#dcfce7';
    elements.imageStatus.style.color = '#166534';

    const meta = state.imageMeta || {};
    const lines = [
      '画像サイズ：' + formatBytes(state.imageBlob.size),
      '画像形式：' + (state.imageBlob.type || meta.mimeType || '不明')
    ];

    if (meta.width && meta.height) {
      lines.push('画像寸法：' + meta.width + ' × ' + meta.height);
    }

    elements.imageSummary.textContent = lines.join('\n');
    elements.imageMemoText.textContent = meta.memo || meta.note || 'なし';
  }

  async function loadApplicationContext() {
    const context = await fetchApplicationContextByJsonp(state.authToken);
    if (!context || !context.ok) {
      throw new Error(context && context.error ? context.error : 'アプリ情報を取得できませんでした。');
    }

    state.appContext = context;
    state.submitter = context.submitter || context.currentUser || {};
    state.departments = Array.isArray(context.departments) && context.departments.length
      ? context.departments
      : FALLBACK_DEPARTMENTS.slice();

    if (context.driveRootFolderId) {
      CONFIG.DRIVE_ROOT_FOLDER_ID = context.driveRootFolderId;
    }
  }

  function renderUserAndDepartments() {
    const submitter = state.submitter || {};
    const departments = Array.from(new Set(state.departments.map(value => String(value || '').trim()).filter(Boolean))).sort();

    elements.submitterName.textContent = submitter.name || '-';
    elements.submitterDepartment.textContent = submitter.department || '-';
    elements.submitterEmail.textContent = submitter.email || '-';

    elements.targetDepartmentSelect.innerHTML = '';
    elements.targetDepartmentSelect.appendChild(new Option('対象部署を選択', ''));

    departments.forEach(department => {
      elements.targetDepartmentSelect.appendChild(new Option(department, department));
    });

    if (submitter.department && departments.includes(submitter.department)) {
      elements.targetDepartmentSelect.value = submitter.department;
    }

    updateUploadButtonState();
  }

  function fetchApplicationContextByJsonp(token) {
    return new Promise((resolve, reject) => {
      const callbackName = '__fieldReportContext_' + Date.now() + '_' + Math.random().toString(36).slice(2);
      const script = document.createElement('script');
      const timeoutId = setTimeout(() => finish(new Error('アプリ情報の取得がタイムアウトしました。')), 15000);

      function finish(error, value) {
        clearTimeout(timeoutId);
        delete window[callbackName];
        script.remove();
        error ? reject(error) : resolve(value);
      }

      window[callbackName] = response => finish(null, response);
      script.onerror = () => finish(new Error('GASへの接続に失敗しました。'));
      script.src = CONFIG.GAS_WEB_APP_URL
        + '?action=context&token=' + encodeURIComponent(token)
        + '&callback=' + encodeURIComponent(callbackName);
      document.head.appendChild(script);
    });
  }

  async function waitForGoogleIdentityServices() {
    for (let i = 0; i < 80; i += 1) {
      if (window.google && google.accounts && google.accounts.oauth2) return;
      await sleep(100);
    }
    throw new Error('Google Identity Servicesを読み込めませんでした。通信環境を確認してください。');
  }

  function setupDriveTokenClient() {
    const submitter = state.submitter || {};

    state.tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: CONFIG.GOOGLE_CLIENT_ID,
      scope: CONFIG.DRIVE_SCOPE,
      login_hint: submitter.email || undefined,
      callback: () => {}
    });
  }

  async function checkDriveAuthorizationOnStartup() {
    if (localStorage.getItem(CONFIG.CONSENT_STORAGE_KEY) !== '1') {
      showDrivePermissionRequired('初回のみGoogle Driveの利用許可が必要です。');
      return;
    }

    try {
      setDriveStatus('Drive確認中', 'waiting');
      showStatus('Google Driveの承認状態を確認しています...', 'info');
      await requestDriveAccessToken('none');
      assertRequiredDriveScope();
      markDriveReady();
      showStatus('Google Driveへ保存できます。', 'success');
    } catch (error) {
      resetDriveAuthorization();
      showDrivePermissionRequired('Google Driveの再承認が必要です。');
      showStatus('「Google Driveを許可する」を押してください。', 'warning');
    }
  }

  async function authorizeDriveByUserAction() {
    try {
      elements.authorizeDriveButton.disabled = true;
      elements.authorizeDriveButton.textContent = '承認確認中...';
      showStatus('Google Driveの利用許可を確認しています...', 'info');

      await requestDriveAccessToken('consent');
      assertRequiredDriveScope();
      localStorage.setItem(CONFIG.CONSENT_STORAGE_KEY, '1');
      markDriveReady();
      showStatus('Google Driveへ保存できます。', 'success');
    } catch (error) {
      resetDriveAuthorization();
      setDriveStatus('Drive未承認', 'error');
      showStatus('Google Driveの利用許可を取得できませんでした。\n' + getErrorMessage(error), 'error');
    } finally {
      elements.authorizeDriveButton.disabled = false;
      elements.authorizeDriveButton.textContent = 'Google Driveを許可する';
      updateUploadButtonState();
    }
  }

  function requestDriveAccessToken(prompt) {
    if (!state.tokenClient) {
      return Promise.reject(new Error('Google認証クライアントが初期化されていません。'));
    }

    return new Promise((resolve, reject) => {
      state.tokenClient.callback = response => {
        if (!response || response.error) {
          reject(new Error(response && (response.error_description || response.error) || 'Google Driveの認証に失敗しました。'));
          return;
        }

        state.tokenResponse = response;
        state.accessToken = response.access_token || '';
        state.accessToken ? resolve(state.accessToken) : reject(new Error('Google Driveアクセストークンを取得できませんでした。'));
      };

      state.tokenClient.requestAccessToken({ prompt: prompt == null ? '' : String(prompt) });
    });
  }

  function assertRequiredDriveScope() {
    if (
      window.google
      && google.accounts.oauth2.hasGrantedAllScopes
      && state.tokenResponse
      && !google.accounts.oauth2.hasGrantedAllScopes(state.tokenResponse, CONFIG.DRIVE_SCOPE)
    ) {
      throw new Error('Google Driveへの保存権限が不足しています。');
    }
  }

  function markDriveReady() {
    state.driveReady = true;
    elements.drivePermissionCard.classList.add('hidden');
    setDriveStatus('Drive保存準備完了', 'ready');
    updateUploadButtonState();
  }

  function resetDriveAuthorization() {
    state.accessToken = '';
    state.tokenResponse = null;
    state.driveReady = false;
    localStorage.removeItem(CONFIG.CONSENT_STORAGE_KEY);
  }

  function showDrivePermissionRequired(message) {
    state.driveReady = false;
    elements.drivePermissionCard.classList.remove('hidden');
    setDriveStatus('Drive未承認', 'error');
    if (message) showStatus(message, 'warning');
    updateUploadButtonState();
  }

  function setDriveStatus(text, type) {
    elements.driveStatusBadge.textContent = text;
    elements.driveStatusBadge.classList.remove('status-waiting', 'status-ready', 'status-error', 'status-info');
    elements.driveStatusBadge.classList.add(
      type === 'ready' ? 'status-ready' : type === 'error' ? 'status-error' : type === 'info' ? 'status-info' : 'status-waiting'
    );
  }

  async function handleUploadClick() {
    if (state.isUploading || !validateBeforeUpload()) return;

    state.isUploading = true;
    updateUploadButtonState();
    showStatus('Google Driveへ投稿しています...', 'info');

    try {
      const result = await uploadReportWithReauthorization();
      state.uploadResult = result;
      await putDraft('uploadResult', result);
      renderUploadResult(result);
      showStatus('投稿が完了しました。Teams受付通知とAI解析はGAS側で順次実行されます。', 'success');
    } catch (error) {
      console.error(error);
      showStatus('投稿に失敗しました。\n' + getErrorMessage(error), 'error');
    } finally {
      state.isUploading = false;
      updateUploadButtonState();
    }
  }

  function validateBeforeUpload() {
    if (state.inputMode === 'text' && !state.textBody) {
      showStatus('テキスト入力内容がありません。', 'error');
      return false;
    }
    if (state.inputMode === 'audio' && !state.audioBlob) {
      showStatus('録音データがありません。', 'error');
      return false;
    }
    if (CONFIG.REQUIRE_IMAGE && !state.imageBlob) {
      showStatus('画像データがありません。', 'error');
      return false;
    }
    if (!elements.targetDepartmentSelect.value) {
      showStatus('対象部署を選択してください。', 'error');
      return false;
    }
    if (!state.driveReady) {
      showDrivePermissionRequired('投稿前にGoogle Driveを許可してください。');
      return false;
    }
    return true;
  }

  async function uploadReportWithReauthorization() {
    try {
      await ensureDriveReadyBeforeUpload();
      return await uploadReportCore();
    } catch (error) {
      if (!isAuthorizationError(error)) throw error;

      resetDriveAuthorization();
      setDriveStatus('再承認が必要', 'error');
      showStatus('Google Driveを再承認しています...', 'warning');

      await requestDriveAccessToken('consent');
      assertRequiredDriveScope();
      localStorage.setItem(CONFIG.CONSENT_STORAGE_KEY, '1');
      markDriveReady();

      return uploadReportCore();
    }
  }

  async function ensureDriveReadyBeforeUpload() {
    if (state.accessToken && state.driveReady) return;

    const hasConsent = localStorage.getItem(CONFIG.CONSENT_STORAGE_KEY) === '1';
    await requestDriveAccessToken(hasConsent ? '' : 'consent');
    assertRequiredDriveScope();
    localStorage.setItem(CONFIG.CONSENT_STORAGE_KEY, '1');
    markDriveReady();
  }

  async function uploadReportCore() {
    const targetDepartment = elements.targetDepartmentSelect.value;
    const reportId = buildReportId();
    const autoTitle = '現場投稿_' + formatTimestampForTitle(new Date()) + '_' + targetDepartment;
    const folderName = reportId + '_' + sanitizeFileName(targetDepartment);

    const folder = await createDriveFolder(folderName, CONFIG.DRIVE_ROOT_FOLDER_ID);
    const audioFile = await uploadAudioFileIfNeeded(reportId, folder.id);
    const imageFile = await uploadImageFileIfNeeded(reportId, folder.id);

    let metadata = buildReportMetadata({
      reportId,
      autoTitle,
      targetDepartment,
      folder,
      audioFile,
      imageFile,
      metadataFile: null
    });

    const metadataFile = await uploadJsonFile('metadata.json', metadata, folder.id);

    metadata = buildReportMetadata({
      reportId,
      autoTitle,
      targetDepartment,
      folder,
      audioFile,
      imageFile,
      metadataFile
    });

    await updateJsonFile(metadataFile.id, metadata);
    await notifyGasUploadCompleted(metadata);

    return metadata;
  }

  async function uploadAudioFileIfNeeded(reportId, folderId) {
    if (state.inputMode !== 'audio' || !state.audioBlob) return null;

    const mimeType = state.audioBlob.type || 'audio/webm';
    return uploadFileResumable({
      name: 'audio_' + reportId + '.' + getExtensionFromMimeType(mimeType, 'webm'),
      mimeType,
      blob: state.audioBlob,
      parentFolderId: folderId
    });
  }

  async function uploadImageFileIfNeeded(reportId, folderId) {
    if (!state.imageBlob) return null;

    const mimeType = state.imageBlob.type || 'image/jpeg';
    return uploadFileResumable({
      name: 'image_' + reportId + '.' + getExtensionFromMimeType(mimeType, 'jpg'),
      mimeType,
      blob: state.imageBlob,
      parentFolderId: folderId
    });
  }

  function buildReportMetadata(params) {
    const submitter = state.submitter || {};
    const audioMeta = state.audioMeta || {};
    const imageMeta = state.imageMeta || {};
    const textMeta = state.textMeta || {};
    const folderUrl = params.folder.webViewLink || buildDriveFolderUrl(params.folder.id);

    const audio = params.audioFile ? {
      id: params.audioFile.id,
      name: params.audioFile.name,
      mimeType: params.audioFile.mimeType || state.audioBlob.type || '',
      url: params.audioFile.webViewLink || buildDriveFileUrl(params.audioFile.id),
      size: state.audioBlob ? state.audioBlob.size : 0,
      memo: audioMeta.memo || audioMeta.note || '',
      durationSec: audioMeta.durationSec || null
    } : null;

    const image = params.imageFile ? {
      id: params.imageFile.id,
      name: params.imageFile.name,
      mimeType: params.imageFile.mimeType || state.imageBlob.type || '',
      url: params.imageFile.webViewLink || buildDriveFileUrl(params.imageFile.id),
      size: state.imageBlob ? state.imageBlob.size : 0,
      memo: imageMeta.memo || imageMeta.note || '',
      width: imageMeta.width || null,
      height: imageMeta.height || null
    } : null;

    const metadataFileUrl = params.metadataFile
      ? params.metadataFile.webViewLink || buildDriveFileUrl(params.metadataFile.id)
      : '';

    return {
      schemaVersion: 2,
      reportId: params.reportId,
      createdAt: state.draftStartedAt || new Date().toISOString(),
      clientCreatedAt: new Date().toISOString(),
      autoTitle: params.autoTitle,
      status: 'uploaded',

      inputMode: state.inputMode,
      input: {
        mode: state.inputMode,
        text: state.inputMode === 'text' ? state.textBody : '',
        speechRequired: state.inputMode === 'audio'
      },
      text: state.inputMode === 'text' ? {
        body: state.textBody,
        createdAt: textMeta.createdAt || state.draftStartedAt || '',
        characterCount: state.textBody.length
      } : null,

      submitter: {
        name: submitter.name || '',
        email: submitter.email || '',
        department: submitter.department || '',
        role: submitter.role || submitter.position || '',
        employeeNo: submitter.employeeNo || submitter.no || ''
      },

      targetDepartment: params.targetDepartment,
      folder: {
        id: params.folder.id,
        name: params.folder.name,
        url: folderUrl
      },
      audio,
      image,

      drive: {
        folderId: params.folder.id,
        folderName: params.folder.name,
        folderUrl,
        audioFileId: audio ? audio.id : '',
        audioFileName: audio ? audio.name : '',
        audioMimeType: audio ? audio.mimeType : '',
        audioFileUrl: audio ? audio.url : '',
        imageFileId: image ? image.id : '',
        imageFileName: image ? image.name : '',
        imageMimeType: image ? image.mimeType : '',
        imageFileUrl: image ? image.url : '',
        metadataFileId: params.metadataFile ? params.metadataFile.id : '',
        metadataFileName: params.metadataFile ? params.metadataFile.name : 'metadata.json',
        metadataFileUrl
      },

      source: {
        app: 'field-report',
        page: 'confirm.html',
        uploader: 'github-pages-drive-api'
      }
    };
  }

  async function createDriveFolder(name, parentFolderId) {
    const response = await fetch(
      'https://www.googleapis.com/drive/v3/files?supportsAllDrives=true&fields=id,name,mimeType,webViewLink',
      {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + state.accessToken,
          'Content-Type': 'application/json; charset=UTF-8'
        },
        body: JSON.stringify({
          name,
          mimeType: 'application/vnd.google-apps.folder',
          parents: [parentFolderId]
        })
      }
    );

    return parseDriveResponse(response, '投稿フォルダ作成');
  }

  function uploadJsonFile(name, value, parentFolderId) {
    const blob = new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' });
    return uploadFileResumable({ name, mimeType: 'application/json', blob, parentFolderId });
  }

  async function uploadFileResumable({ name, mimeType, blob, parentFolderId }) {
    const initialization = await fetch(
      'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&supportsAllDrives=true&fields=id,name,mimeType,webViewLink,size',
      {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + state.accessToken,
          'Content-Type': 'application/json; charset=UTF-8',
          'X-Upload-Content-Type': mimeType,
          'X-Upload-Content-Length': String(blob.size)
        },
        body: JSON.stringify({ name, mimeType, parents: [parentFolderId] })
      }
    );

    if (!initialization.ok) {
      await parseDriveResponse(initialization, name + ' アップロード開始');
    }

    const uploadUrl = initialization.headers.get('Location');
    if (!uploadUrl) throw new Error(name + ' のアップロードURLを取得できませんでした。');

    const response = await fetch(uploadUrl, {
      method: 'PUT',
      headers: {
        'Content-Type': mimeType,
        'Content-Range': 'bytes 0-' + (blob.size - 1) + '/' + blob.size
      },
      body: blob
    });

    return parseDriveResponse(response, name + ' アップロード');
  }

  async function updateJsonFile(fileId, value) {
    const response = await fetch(
      'https://www.googleapis.com/upload/drive/v3/files/' + encodeURIComponent(fileId)
        + '?uploadType=media&supportsAllDrives=true&fields=id,name,mimeType,webViewLink,size',
      {
        method: 'PATCH',
        headers: {
          Authorization: 'Bearer ' + state.accessToken,
          'Content-Type': 'application/json; charset=UTF-8'
        },
        body: JSON.stringify(value, null, 2)
      }
    );

    return parseDriveResponse(response, 'metadata.json 更新');
  }

  async function parseDriveResponse(response, label) {
    const text = await response.text();
    let data = {};

    if (text) {
      try { data = JSON.parse(text); } catch (_) { data = { raw: text }; }
    }

    if (!response.ok) {
      const firstError = data && data.error && Array.isArray(data.error.errors) ? data.error.errors[0] || {} : {};
      const error = new Error(data && data.error && data.error.message
        ? label + 'に失敗しました。\n' + data.error.message
        : label + 'に失敗しました。HTTP ' + response.status);
      error.status = response.status;
      error.reason = firstError.reason || '';
      error.raw = data;
      throw error;
    }

    return data;
  }

  function isAuthorizationError(error) {
    const status = Number(error && error.status || 0);
    const reason = String(error && error.reason || '');
    const message = String(error && error.message || '').toLowerCase();

    return status === 401 || (status === 403 && (
      reason === 'insufficientPermissions'
      || reason === 'insufficientFilePermissions'
      || reason === 'appNotAuthorizedToFile'
      || message.includes('permission')
      || message.includes('authorized')
    ));
  }

  async function notifyGasUploadCompleted(metadata) {
    const drive = metadata.drive || {};

    const payload = {
      action: 'uploadCompleted',
      token: state.authToken,
      reportId: metadata.reportId,
      createdAt: metadata.createdAt,
      targetDepartment: metadata.targetDepartment,
      folderId: drive.folderId || '',
      folderUrl: drive.folderUrl || '',
      audioFileId: drive.audioFileId || '',
      audioFileUrl: drive.audioFileUrl || '',
      imageFileId: drive.imageFileId || '',
      imageFileUrl: drive.imageFileUrl || '',
      metadataFileId: drive.metadataFileId || '',
      metadataFileUrl: drive.metadataFileUrl || '',
      metadata
    };

    await fetch(CONFIG.GAS_WEB_APP_URL, {
      method: 'POST',
      mode: 'no-cors',
      headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
      body: JSON.stringify(payload)
    });
  }

  function renderUploadResult(result) {
    elements.resultCard.classList.remove('hidden');
    elements.folderLink.href = result.drive.folderUrl || '#';
    elements.folderLink.textContent = result.drive.folderUrl ? '投稿フォルダを開く' : '投稿フォルダURLなし';
    elements.uploadButton.disabled = true;
    elements.uploadButton.textContent = '投稿済み';
    window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
  }

  function toggleAudioPlayback() {
    if (!state.audioBlob) return;

    if (elements.audioPlayer.paused) {
      elements.audioPlayer.play().then(() => {
        elements.playAudioButton.textContent = '停止';
        elements.audioPlayStatus.textContent = '再生中';
      }).catch(error => showStatus('音声を再生できませんでした。\n' + getErrorMessage(error), 'error'));
      return;
    }

    elements.audioPlayer.pause();
    elements.audioPlayer.currentTime = 0;
    elements.playAudioButton.textContent = '再生';
    elements.audioPlayStatus.textContent = '停止しました';
  }

  function updateUploadButtonState() {
    const hasSource = state.inputMode === 'text' ? Boolean(state.textBody) : Boolean(state.audioBlob);
    const hasImage = Boolean(state.imageBlob);
    const hasDepartment = Boolean(elements.targetDepartmentSelect.value);

    const canUpload = !state.isUploading
      && !state.uploadResult
      && state.driveReady
      && hasDepartment
      && hasSource
      && (!CONFIG.REQUIRE_IMAGE || hasImage);

    elements.uploadButton.disabled = !canUpload;
    if (state.isUploading) elements.uploadButton.textContent = '投稿中...';
    else if (state.uploadResult) elements.uploadButton.textContent = '投稿済み';
    else elements.uploadButton.textContent = 'Google Driveへ投稿';
  }

  function setFatalState(message) {
    setDriveStatus('利用不可', 'error');
    elements.uploadButton.disabled = true;
    showStatus(message, 'error');
  }

  function showStatus(message, type) {
    if (!message) {
      elements.statusBox.className = 'status-box hidden';
      elements.statusBox.textContent = '';
      return;
    }

    elements.statusBox.className = 'status-box ' + (type || 'info');
    elements.statusBox.textContent = message;
  }

  function openDatabase() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(CONFIG.DB_NAME, CONFIG.DB_VERSION);

      request.onupgradeneeded = event => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains(CONFIG.STORE_NAME)) db.createObjectStore(CONFIG.STORE_NAME);
      };

      request.onsuccess = event => resolve(event.target.result);
      request.onerror = event => reject(event.target.error);
    });
  }

  function getDraft(key) {
    return new Promise((resolve, reject) => {
      const transaction = state.db.transaction(CONFIG.STORE_NAME, 'readonly');
      const request = transaction.objectStore(CONFIG.STORE_NAME).get(key);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = event => reject(event.target.error);
    });
  }

  function putDraft(key, value) {
    return new Promise((resolve, reject) => {
      const transaction = state.db.transaction(CONFIG.STORE_NAME, 'readwrite');
      const request = transaction.objectStore(CONFIG.STORE_NAME).put(value, key);
      request.onsuccess = () => resolve();
      request.onerror = event => reject(event.target.error);
    });
  }

  function normalizeInputMode(mode) {
    const value = String(mode || '').toLowerCase();
    return value === 'text' || value === 'audio' ? value : '';
  }

  function buildReportId() {
    const date = new Date();
    const random = Math.random().toString(36).slice(2, 8).toUpperCase();
    return 'RPT-'
      + date.getFullYear() + pad2(date.getMonth() + 1) + pad2(date.getDate())
      + '-' + pad2(date.getHours()) + pad2(date.getMinutes()) + pad2(date.getSeconds())
      + '-' + random;
  }

  function formatTimestampForTitle(date) {
    return date.getFullYear()
      + pad2(date.getMonth() + 1)
      + pad2(date.getDate())
      + '_' + pad2(date.getHours())
      + pad2(date.getMinutes())
      + pad2(date.getSeconds());
  }

  function sanitizeFileName(value) {
    return String(value || '').replace(/[\\/:*?"<>|]/g, '_').replace(/\s+/g, '_').slice(0, 80);
  }

  function getExtensionFromMimeType(mimeType, fallback) {
    const extensions = {
      'audio/webm': 'webm',
      'audio/mp4': 'mp4',
      'audio/aac': 'aac',
      'audio/mpeg': 'mp3',
      'image/jpeg': 'jpg',
      'image/png': 'png',
      'image/webp': 'webp'
    };
    return extensions[mimeType] || fallback;
  }

  function buildDriveFileUrl(fileId) {
    return fileId ? 'https://drive.google.com/file/d/' + encodeURIComponent(fileId) + '/view' : '';
  }

  function buildDriveFolderUrl(folderId) {
    return folderId ? 'https://drive.google.com/drive/folders/' + encodeURIComponent(folderId) : '';
  }

  function formatBytes(bytes) {
    const value = Number(bytes || 0);
    if (value < 1024) return value + ' B';
    if (value < 1024 * 1024) return (value / 1024).toFixed(1) + ' KB';
    return (value / 1024 / 1024).toFixed(1) + ' MB';
  }

  function getErrorMessage(error) {
    return error && error.message ? String(error.message) : String(error || '不明なエラーです。');
  }

  function pad2(value) {
    return String(value).padStart(2, '0');
  }

  function sleep(milliseconds) {
    return new Promise(resolve => setTimeout(resolve, milliseconds));
  }
})();
