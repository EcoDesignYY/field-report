(() => {
  const CONFIG = {
    GOOGLE_CLIENT_ID: '866457692941-cro6etg365bkgq6m0qpor789677g11lq.apps.googleusercontent.com',

    // GAS WebアプリURL
    GAS_WEB_APP_URL: 'https://script.google.com/a/macros/ecodesign-labo.jp/s/AKfycbzyU4I8u5csBb7qRIWvSGwPBrDcYAv0p6rPO6-ModBzPCtwavFeeSaGcOf-TwJeyb7BfQ/exec',

    // 投稿用ルートフォルダ
    DRIVE_ROOT_FOLDER_ID: '1oRhXuGn0YE1C-eKyG7MHNObLr1ficZ-p',

    // 既存の社内共有フォルダ直下に作成するため、権限不足を避ける目的でfull drive scopeを使用。
    // 最小権限で検証する場合は https://www.googleapis.com/auth/drive.file に変更。
    DRIVE_SCOPE: 'https://www.googleapis.com/auth/drive',

    DB_NAME: 'field-report-draft-db',
    DB_VERSION: 1,
    STORE_NAME: 'draft',

    REQUIRE_AUDIO: true,
    REQUIRE_IMAGE: false,

    CONSENT_STORAGE_KEY: 'fieldReportDriveConsentGranted',
    AUTH_TOKEN_STORAGE_KEY: 'fieldReportAuthToken'
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

    setStatus('投稿データを確認しています...', 'info');

    try {
      await loadDraftData();
      renderDraftSummary();
    } catch (error) {
      setFatalState('録音・画像データの読込に失敗しました。\n' + getErrorMessage(error));
      return;
    }

    try {
      await loadAppContext();
      renderUserAndDepartments();
    } catch (error) {
      setStatus(
        '従業員マスタ情報の取得に失敗しました。部署リストは予備設定で表示します。\n' +
        getErrorMessage(error),
        'warning'
      );

      state.submitter = {
        name: '',
        email: '',
        department: '',
        position: ''
      };
      state.departments = FALLBACK_DEPARTMENTS.slice();
      renderUserAndDepartments();
    }

    try {
      validateClientConfig();
      await waitForGoogleIdentityServices();
      setupTokenClient();
      await checkDriveAuthorizationOnStartup();
    } catch (error) {
      state.driveReady = false;
      showDrivePermissionRequired(
        'Google Driveの承認状態を確認できませんでした。必要に応じて承認してください。'
      );
      setStatus(getErrorMessage(error), 'warning');
    }

    updateUploadButtonState();
  }

  function collectElements() {
    els.backButton = document.getElementById('backButton');

    els.driveStatusBadge = document.getElementById('driveStatusBadge');
    els.drivePermissionCard = document.getElementById('drivePermissionCard');
    els.authorizeDriveButton = document.getElementById('authorizeDriveButton');

    els.submitterName = document.getElementById('submitterName');
    els.submitterDepartment = document.getElementById('submitterDepartment');
    els.submitterEmail = document.getElementById('submitterEmail');
    els.targetDepartmentSelect = document.getElementById('targetDepartmentSelect');

    els.audioStatus = document.getElementById('audioStatus');
    els.audioSummary = document.getElementById('audioSummary');
    els.audioPlayer = document.getElementById('audioPlayer');
    els.playAudioButton = document.getElementById('playAudioButton');
    els.audioPlayStatus = document.getElementById('audioPlayStatus');
    els.audioMemoText = document.getElementById('audioMemoText');

    els.imageStatus = document.getElementById('imageStatus');
    els.imageSummary = document.getElementById('imageSummary');
    els.imagePreviewWrap = document.getElementById('imagePreviewWrap');
    els.imagePreview = document.getElementById('imagePreview');
    els.imageMemoText = document.getElementById('imageMemoText');

    els.uploadButton = document.getElementById('uploadButton');
    els.resultCard = document.getElementById('resultCard');
    els.folderLink = document.getElementById('folderLink');
    els.statusBox = document.getElementById('statusBox');
  }

  function bindEvents() {
    els.backButton.addEventListener('click', () => {
      location.href = './capture.html';
    });

    els.authorizeDriveButton.addEventListener('click', authorizeDriveByUserAction);
    els.uploadButton.addEventListener('click', handleUploadClick);
    els.playAudioButton.addEventListener('click', toggleAudioPlayback);

    els.audioPlayer.addEventListener('ended', () => {
      els.playAudioButton.textContent = '再生';
      els.audioPlayStatus.textContent = '再生が終了しました';
    });

    els.targetDepartmentSelect.addEventListener('change', updateUploadButtonState);
  }

  function validateClientConfig() {
    if (!CONFIG.GOOGLE_CLIENT_ID || CONFIG.GOOGLE_CLIENT_ID.includes('ここに')) {
      throw new Error('confirm.js の GOOGLE_CLIENT_ID を設定してください。');
    }

    if (!CONFIG.GAS_WEB_APP_URL || CONFIG.GAS_WEB_APP_URL.includes('ここに')) {
      throw new Error('confirm.js の GAS_WEB_APP_URL を設定してください。');
    }

    if (!CONFIG.DRIVE_ROOT_FOLDER_ID) {
      throw new Error('DRIVE_ROOT_FOLDER_ID が未設定です。');
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

    return (
      sessionStorage.getItem(CONFIG.AUTH_TOKEN_STORAGE_KEY) ||
      sessionStorage.getItem('fieldReportToken') ||
      ''
    );
  }

  async function loadAppContext() {
    const context = await fetchAppContextByJsonp(state.authToken);

    if (!context || !context.ok) {
      throw new Error(context && context.error ? context.error : 'アプリ情報を取得できませんでした。');
    }

    state.appContext = context;
    state.submitter = context.submitter || {};
    state.departments = Array.isArray(context.departments) && context.departments.length
      ? context.departments
      : FALLBACK_DEPARTMENTS.slice();

    if (context.driveRootFolderId) {
      CONFIG.DRIVE_ROOT_FOLDER_ID = context.driveRootFolderId;
    }
  }

  function fetchAppContextByJsonp(token) {
    return new Promise((resolve, reject) => {
      const callbackName =
        '__fieldReportContext_' + Date.now() + '_' + Math.random().toString(36).slice(2);

      const script = document.createElement('script');

      const cleanup = () => {
        try {
          delete window[callbackName];
        } catch (_) {
          window[callbackName] = undefined;
        }

        if (script.parentNode) {
          script.parentNode.removeChild(script);
        }
      };

      const timer = window.setTimeout(() => {
        cleanup();
        reject(new Error('GASからアプリ情報を取得できませんでした。'));
      }, 15000);

      window[callbackName] = data => {
        window.clearTimeout(timer);
        cleanup();
        resolve(data);
      };

      const url =
        CONFIG.GAS_WEB_APP_URL +
        '?action=context' +
        '&token=' + encodeURIComponent(token) +
        '&callback=' + encodeURIComponent(callbackName) +
        '&t=' + Date.now();

      script.onerror = () => {
        window.clearTimeout(timer);
        cleanup();
        reject(new Error('GASアプリ情報取得リクエストに失敗しました。'));
      };

      script.src = url;
      document.head.appendChild(script);
    });
  }

  function renderUserAndDepartments() {
    const submitter = state.submitter || {};

    els.submitterName.textContent = submitter.name || '未取得';
    els.submitterDepartment.textContent = submitter.department || '未取得';
    els.submitterEmail.textContent = submitter.email || 'メール未取得';

    const departments = state.departments && state.departments.length
      ? state.departments
      : FALLBACK_DEPARTMENTS;

    els.targetDepartmentSelect.innerHTML = '';

    const empty = document.createElement('option');
    empty.value = '';
    empty.textContent = '対象部署を選択';
    els.targetDepartmentSelect.appendChild(empty);

    departments.forEach(department => {
      const option = document.createElement('option');
      option.value = department;
      option.textContent = department;
      els.targetDepartmentSelect.appendChild(option);
    });

    if (submitter.department && departments.includes(submitter.department)) {
      els.targetDepartmentSelect.value = submitter.department;
    }

    updateUploadButtonState();
  }

  async function loadDraftData() {
    state.db = await openDb();

    state.audioBlob = await getDraft('audioBlob');
    state.audioMeta = await getDraft('audioMeta');

    state.imageBlob = await getDraft('imageBlob');
    state.imageMeta = await getDraft('imageMeta');
  }

  function renderDraftSummary() {
    renderAudioSummary();
    renderImageSummary();
  }

  function renderAudioSummary() {
    if (!state.audioBlob) {
      els.audioStatus.textContent = '未録音';
      els.audioStatus.style.background = '#fee2e2';
      els.audioStatus.style.color = '#991b1b';
      els.audioSummary.textContent = '録音データがありません。録音画面に戻って録音してください。';
      els.playAudioButton.disabled = true;
      els.audioPlayStatus.textContent = '録音なし';
      return;
    }

    if (state.audioObjectUrl) {
      URL.revokeObjectURL(state.audioObjectUrl);
    }

    state.audioObjectUrl = URL.createObjectURL(state.audioBlob);
    els.audioPlayer.src = state.audioObjectUrl;

    els.audioStatus.textContent = '録音あり';
    els.audioStatus.style.background = '#dcfce7';
    els.audioStatus.style.color = '#166534';

    const meta = state.audioMeta || {};
    const lines = [
      '音声サイズ：' + formatBytes(state.audioBlob.size),
      '音声形式：' + (state.audioBlob.type || meta.mimeType || '不明')
    ];

    if (meta.durationSec) {
      lines.push('録音時間：約' + Math.round(meta.durationSec) + '秒');
    }

    els.audioSummary.textContent = lines.join('\n');
    els.playAudioButton.disabled = false;
    els.audioPlayStatus.textContent = '再生できます';

    const memo = meta.memo || meta.note || '';
    els.audioMemoText.textContent = memo || 'なし';
  }

  function renderImageSummary() {
    if (!state.imageBlob) {
      els.imageStatus.textContent = CONFIG.REQUIRE_IMAGE ? '未添付' : '任意';
      els.imageStatus.style.background = CONFIG.REQUIRE_IMAGE ? '#fee2e2' : '#f3f4f6';
      els.imageStatus.style.color = CONFIG.REQUIRE_IMAGE ? '#991b1b' : '#374151';
      els.imageSummary.textContent = CONFIG.REQUIRE_IMAGE
        ? '画像データがありません。撮影・添付画面に戻って画像を追加してください。'
        : '画像は添付されていません。画像なしでも投稿できます。';
      els.imagePreviewWrap.classList.add('hidden');
      return;
    }

    if (state.imageObjectUrl) {
      URL.revokeObjectURL(state.imageObjectUrl);
    }

    state.imageObjectUrl = URL.createObjectURL(state.imageBlob);
    els.imagePreview.src = state.imageObjectUrl;
    els.imagePreviewWrap.classList.remove('hidden');

    els.imageStatus.textContent = '画像あり';
    els.imageStatus.style.background = '#dcfce7';
    els.imageStatus.style.color = '#166534';

    const meta = state.imageMeta || {};
    const lines = [
      '画像サイズ：' + formatBytes(state.imageBlob.size),
      '画像形式：' + (state.imageBlob.type || meta.mimeType || '不明')
    ];

    if (meta.width && meta.height) {
      lines.push('画像寸法：' + meta.width + ' × ' + meta.height);
    }

    els.imageSummary.textContent = lines.join('\n');

    const memo = meta.memo || meta.note || '';
    els.imageMemoText.textContent = memo || 'なし';
  }

  async function waitForGoogleIdentityServices() {
    for (let i = 0; i < 80; i++) {
      if (
        window.google &&
        google.accounts &&
        google.accounts.oauth2 &&
        typeof google.accounts.oauth2.initTokenClient === 'function'
      ) {
        return;
      }

      await sleep(100);
    }

    throw new Error('Google Identity Servicesを読み込めませんでした。通信環境を確認してください。');
  }

  function setupTokenClient() {
    const submitter = state.submitter || {};

    state.tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: CONFIG.GOOGLE_CLIENT_ID,
      scope: CONFIG.DRIVE_SCOPE,
      login_hint: submitter.email || undefined,
      callback: () => {}
    });
  }

  async function checkDriveAuthorizationOnStartup() {
    const hasConsent = localStorage.getItem(CONFIG.CONSENT_STORAGE_KEY) === '1';

    if (!hasConsent) {
      showDrivePermissionRequired('初回のみGoogle Driveの利用許可が必要です。');
      return;
    }

    try {
      setDriveStatus('Drive確認中', 'waiting');
      setStatus('Google Driveの承認状態を確認しています...', 'info');

      await requestDriveAccessToken({ prompt: 'none' });

      if (!hasRequiredDriveScope()) {
        throw new Error('Google Driveへの保存権限が不足しています。');
      }

      state.driveReady = true;
      hideDrivePermissionCard();
      setDriveStatus('Drive保存準備完了', 'ready');
      setStatus('Google Driveへ保存できます。', 'success');

    } catch (error) {
      state.accessToken = '';
      state.tokenResponse = null;
      state.driveReady = false;

      localStorage.removeItem(CONFIG.CONSENT_STORAGE_KEY);

      showDrivePermissionRequired('Google Driveの再承認が必要です。');
      setStatus(
        'Google Driveの承認状態を確認できませんでした。\n「Google Driveを許可する」を押してください。',
        'warning'
      );
    }
  }

  async function authorizeDriveByUserAction() {
    try {
      els.authorizeDriveButton.disabled = true;
      els.authorizeDriveButton.textContent = '承認確認中...';

      setStatus('Google Driveの利用許可を確認しています...', 'info');

      await requestDriveAccessToken({ prompt: 'consent' });

      if (!hasRequiredDriveScope()) {
        throw new Error('Google Driveへの保存権限が許可されていません。');
      }

      localStorage.setItem(CONFIG.CONSENT_STORAGE_KEY, '1');

      state.driveReady = true;
      hideDrivePermissionCard();
      setDriveStatus('Drive保存準備完了', 'ready');
      setStatus('Google Driveへ保存できます。', 'success');

    } catch (error) {
      state.accessToken = '';
      state.tokenResponse = null;
      state.driveReady = false;

      setDriveStatus('Drive未承認', 'error');
      setStatus(
        'Google Driveの利用許可を取得できませんでした。\n' + getErrorMessage(error),
        'error'
      );

    } finally {
      els.authorizeDriveButton.disabled = false;
      els.authorizeDriveButton.textContent = 'Google Driveを許可する';
      updateUploadButtonState();
    }
  }

  function requestDriveAccessToken(options = {}) {
    const prompt = options.prompt == null ? '' : String(options.prompt);

    if (!state.tokenClient) {
      throw new Error('Google認証クライアントが初期化されていません。');
    }

    return new Promise((resolve, reject) => {
      state.tokenClient.callback = response => {
        if (!response || response.error) {
          const error = new Error(
            response && response.error_description
              ? response.error_description
              : response && response.error
                ? response.error
                : 'Google Driveの認証に失敗しました。'
          );

          error.authResponse = response;
          reject(error);
          return;
        }

        state.accessToken = response.access_token || '';
        state.tokenResponse = response;

        if (!state.accessToken) {
          reject(new Error('Google Driveアクセストークンを取得できませんでした。'));
          return;
        }

        resolve(state.accessToken);
      };

      try {
        state.tokenClient.requestAccessToken({ prompt });
      } catch (error) {
        reject(error);
      }
    });
  }

  function hasRequiredDriveScope() {
    if (
      window.google &&
      google.accounts &&
      google.accounts.oauth2 &&
      typeof google.accounts.oauth2.hasGrantedAllScopes === 'function' &&
      state.tokenResponse
    ) {
      return google.accounts.oauth2.hasGrantedAllScopes(
        state.tokenResponse,
        CONFIG.DRIVE_SCOPE
      );
    }

    return true;
  }

  function showDrivePermissionRequired(message) {
    state.driveReady = false;
    els.drivePermissionCard.classList.remove('hidden');
    setDriveStatus('Drive未承認', 'error');

    if (message) {
      setStatus(message, 'warning');
    }

    updateUploadButtonState();
  }

  function hideDrivePermissionCard() {
    els.drivePermissionCard.classList.add('hidden');
  }

  function setDriveStatus(text, type) {
    els.driveStatusBadge.textContent = text;

    els.driveStatusBadge.classList.remove(
      'status-waiting',
      'status-ready',
      'status-error',
      'status-info'
    );

    if (type === 'ready') {
      els.driveStatusBadge.classList.add('status-ready');
    } else if (type === 'error') {
      els.driveStatusBadge.classList.add('status-error');
    } else if (type === 'info') {
      els.driveStatusBadge.classList.add('status-info');
    } else {
      els.driveStatusBadge.classList.add('status-waiting');
    }
  }

  async function handleUploadClick() {
    if (state.isUploading) return;

    if (!validateBeforeUpload()) return;

    try {
      state.isUploading = true;
      updateUploadButtonState();

      setStatus('Google Driveへ投稿しています...', 'info');

      const result = await uploadReportWithReauthRetry();

      state.uploadResult = result;
      await putDraft('uploadResult', result);

      renderUploadResult(result);

      setStatus('投稿が完了しました。', 'success');

    } catch (error) {
      console.error(error);
      setStatus('投稿に失敗しました。\n' + getErrorMessage(error), 'error');

    } finally {
      state.isUploading = false;
      updateUploadButtonState();
    }
  }

  function validateBeforeUpload() {
    if (!state.audioBlob && CONFIG.REQUIRE_AUDIO) {
      setStatus('録音データがありません。録音画面に戻って録音してください。', 'error');
      return false;
    }

    if (!state.imageBlob && CONFIG.REQUIRE_IMAGE) {
      setStatus('画像データがありません。撮影・添付画面に戻って画像を追加してください。', 'error');
      return false;
    }

    if (!els.targetDepartmentSelect.value) {
      setStatus('対象部署を選択してください。', 'error');
      return false;
    }

    if (!state.driveReady) {
      setStatus('Google Driveの利用許可が必要です。', 'error');
      showDrivePermissionRequired('投稿前にGoogle Driveを許可してください。');
      return false;
    }

    return true;
  }

  async function uploadReportWithReauthRetry() {
    try {
      await ensureDriveReadyBeforeUpload();
      return await uploadReportCore();

    } catch (error) {
      if (!isAuthOrScopeError(error)) {
        throw error;
      }

      localStorage.removeItem(CONFIG.CONSENT_STORAGE_KEY);

      state.accessToken = '';
      state.tokenResponse = null;
      state.driveReady = false;

      setDriveStatus('再承認が必要', 'error');
      setStatus(
        'Google Driveへの権限が不足している可能性があります。\n再度Google承認を行います。',
        'warning'
      );

      await requestDriveAccessToken({ prompt: 'consent' });

      if (!hasRequiredDriveScope()) {
        throw new Error('Google Driveへの保存権限が許可されていません。');
      }

      localStorage.setItem(CONFIG.CONSENT_STORAGE_KEY, '1');

      state.driveReady = true;
      setDriveStatus('Drive保存準備完了', 'ready');

      try {
        return await uploadReportCore();
      } catch (retryError) {
        if (isAuthOrScopeError(retryError)) {
          throw new Error(
            'Google Driveへの保存権限を再承認しても投稿できませんでした。\n' +
            '投稿データフォルダへの書き込み権限、またはOAuthスコープを確認してください。'
          );
        }

        throw retryError;
      }
    }
  }

  async function ensureDriveReadyBeforeUpload() {
    if (state.accessToken && state.driveReady) {
      return;
    }

    const hasConsent = localStorage.getItem(CONFIG.CONSENT_STORAGE_KEY) === '1';

    await requestDriveAccessToken({
      prompt: hasConsent ? '' : 'consent'
    });

    if (!hasRequiredDriveScope()) {
      throw new Error('Google Driveへの保存権限が不足しています。');
    }

    localStorage.setItem(CONFIG.CONSENT_STORAGE_KEY, '1');

    state.driveReady = true;
    setDriveStatus('Drive保存準備完了', 'ready');
  }

  async function uploadReportCore() {
    const targetDepartmentName = els.targetDepartmentSelect.value;
    const reportId = buildReportId();
    const timestampText = formatTimestampForTitle(new Date());

    const autoTitle = '現場投稿_' + timestampText + '_' + targetDepartmentName;
    const folderName = reportId + '_' + sanitizeFileName(targetDepartmentName);

    const folder = await createDriveFolder(folderName, CONFIG.DRIVE_ROOT_FOLDER_ID);

    let audioFile = null;
    let imageFile = null;

    if (state.audioBlob) {
      const audioMime = state.audioBlob.type || 'audio/webm';
      const audioExt = getExtensionFromMimeType(audioMime, 'webm');
      const audioName = 'audio_' + reportId + '.' + audioExt;

      audioFile = await uploadFileResumable({
        name: audioName,
        mimeType: audioMime,
        blob: state.audioBlob,
        parentFolderId: folder.id
      });
    }

    if (state.imageBlob) {
      const imageMime = state.imageBlob.type || 'image/jpeg';
      const imageExt = getExtensionFromMimeType(imageMime, 'jpg');
      const imageName = 'image_' + reportId + '.' + imageExt;

      imageFile = await uploadFileResumable({
        name: imageName,
        mimeType: imageMime,
        blob: state.imageBlob,
        parentFolderId: folder.id
      });
    }

    const metadata = buildReportMetadata({
      reportId,
      autoTitle,
      targetDepartmentName,
      folder,
      audioFile,
      imageFile
    });

    const metadataBlob = new Blob(
      [JSON.stringify(metadata, null, 2)],
      { type: 'application/json' }
    );

    const metadataFile = await uploadFileResumable({
      name: 'metadata.json',
      mimeType: 'application/json',
      blob: metadataBlob,
      parentFolderId: folder.id
    });

    // metadata.jsonアップロード後に、GAS通知用のmetadataへmetadataFile情報も補完する。
    // Drive上のmetadata.json自体には自身のfileIdは含まれないが、GAS通知payloadには含める。
    metadata.drive.metadataFileId = metadataFile.id || '';
    metadata.drive.metadataFileName = metadataFile.name || 'metadata.json';
    metadata.drive.metadataMimeType = metadataFile.mimeType || 'application/json';
    metadata.drive.metadataFileUrl = metadataFile.webViewLink || buildDriveFileUrl(metadataFile.id);

    const uploadResult = {
      ...metadata,
      metadataFile: {
        id: metadataFile.id,
        name: metadataFile.name,
        mimeType: metadataFile.mimeType,
        url: metadataFile.webViewLink || buildDriveFileUrl(metadataFile.id)
      },
      uploadedAt: new Date().toISOString()
    };

    await notifyGasUploadCompleted(uploadResult);

    return uploadResult;
  }

  function buildReportMetadata(params) {
    const submitter = state.submitter || {};
    const audioMeta = state.audioMeta || {};
    const imageMeta = state.imageMeta || {};
    const createdAt = new Date().toISOString();

    const folderId = params.folder.id || '';
    const folderUrl = params.folder.webViewLink || buildDriveFolderUrl(folderId);

    const audioId = params.audioFile ? params.audioFile.id || '' : '';
    const audioName = params.audioFile ? params.audioFile.name || '' : '';
    const audioMimeType = params.audioFile
      ? params.audioFile.mimeType || state.audioBlob.type || ''
      : '';
    const audioUrl = params.audioFile
      ? params.audioFile.webViewLink || buildDriveFileUrl(audioId)
      : '';

    const imageId = params.imageFile ? params.imageFile.id || '' : '';
    const imageName = params.imageFile ? params.imageFile.name || '' : '';
    const imageMimeType = params.imageFile
      ? params.imageFile.mimeType || state.imageBlob.type || ''
      : '';
    const imageUrl = params.imageFile
      ? params.imageFile.webViewLink || buildDriveFileUrl(imageId)
      : '';

    return {
      schemaVersion: 2,
      reportId: params.reportId,
      autoTitle: params.autoTitle,
      title: params.autoTitle,
      userTitle: '',
      status: 'uploaded',
      createdAt: createdAt,
      clientCreatedAt: createdAt,

      submitter: {
        name: submitter.name || '',
        email: submitter.email || '',
        masterEmail: submitter.masterEmail || '',
        department: submitter.department || '',
        role: submitter.role || submitter.position || '',
        position: submitter.position || submitter.role || '',
        employeeNo: submitter.employeeNo || submitter.no || '',
        no: submitter.no || submitter.employeeNo || ''
      },

      targetDepartment: params.targetDepartmentName,
      targetDepartmentName: params.targetDepartmentName,

      // AI解析・GAS受付処理が参照する標準Drive情報。
      drive: {
        folderId: folderId,
        folderName: params.folder.name || '',
        folderUrl: folderUrl,

        audioFileId: audioId,
        audioFileName: audioName,
        audioMimeType: audioMimeType,
        audioFileUrl: audioUrl,

        imageFileId: imageId,
        imageFileName: imageName,
        imageMimeType: imageMimeType,
        imageFileUrl: imageUrl,

        metadataFileId: '',
        metadataFileName: 'metadata.json',
        metadataMimeType: 'application/json',
        metadataFileUrl: ''
      },

      // 旧形式互換: 既存の画面・処理が参照しても壊れないよう残す。
      folder: {
        id: folderId,
        name: params.folder.name || '',
        url: folderUrl
      },

      audio: params.audioFile
        ? {
            id: audioId,
            name: audioName,
            mimeType: audioMimeType,
            url: audioUrl,
            size: state.audioBlob ? state.audioBlob.size : 0,
            memo: audioMeta.memo || audioMeta.note || '',
            durationSec: audioMeta.durationSec || null
          }
        : null,

      image: params.imageFile
        ? {
            id: imageId,
            name: imageName,
            mimeType: imageMimeType,
            url: imageUrl,
            size: state.imageBlob ? state.imageBlob.size : 0,
            memo: imageMeta.memo || imageMeta.note || '',
            width: imageMeta.width || null,
            height: imageMeta.height || null
          }
        : null,

      source: {
        app: 'field-report',
        page: 'confirm.html',
        uploader: 'github-pages-drive-api'
      }
    };
  }

  async function createDriveFolder(name, parentFolderId) {
    const metadata = {
      name: name,
      mimeType: 'application/vnd.google-apps.folder',
      parents: [parentFolderId]
    };

    const response = await fetch(
      'https://www.googleapis.com/drive/v3/files?supportsAllDrives=true&fields=id,name,mimeType,webViewLink',
      {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + state.accessToken,
          'Content-Type': 'application/json; charset=UTF-8'
        },
        body: JSON.stringify(metadata)
      }
    );

    return parseDriveResponse(response, '投稿フォルダ作成');
  }

  async function uploadFileResumable(options) {
    const { name, mimeType, blob, parentFolderId } = options;

    const metadata = {
      name: name,
      mimeType: mimeType,
      parents: [parentFolderId]
    };

    const initResponse = await fetch(
      'https://www.googleapis.com/upload/drive/v3/files' +
      '?uploadType=resumable' +
      '&supportsAllDrives=true' +
      '&fields=id,name,mimeType,webViewLink,size',
      {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + state.accessToken,
          'Content-Type': 'application/json; charset=UTF-8',
          'X-Upload-Content-Type': mimeType,
          'X-Upload-Content-Length': String(blob.size)
        },
        body: JSON.stringify(metadata)
      }
    );

    if (!initResponse.ok) {
      await parseDriveResponse(initResponse, name + ' アップロード開始');
    }

    const uploadUrl = initResponse.headers.get('Location');

    if (!uploadUrl) {
      throw new Error(name + ' のアップロードURLを取得できませんでした。');
    }

    const endByte = blob.size - 1;

    const uploadResponse = await fetch(uploadUrl, {
      method: 'PUT',
      headers: {
        'Content-Type': mimeType,
        'Content-Range': 'bytes 0-' + endByte + '/' + blob.size
      },
      body: blob
    });

    return parseDriveResponse(uploadResponse, name + ' アップロード');
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
      const firstError =
        data &&
        data.error &&
        Array.isArray(data.error.errors) &&
        data.error.errors[0]
          ? data.error.errors[0]
          : {};

      const error = new Error(
        data && data.error && data.error.message
          ? label + 'に失敗しました。\n' + data.error.message
          : label + 'に失敗しました。HTTP ' + response.status
      );

      error.status = response.status;
      error.reason = firstError.reason || '';
      error.domain = firstError.domain || '';
      error.raw = data;

      throw error;
    }

    return data;
  }

  function isAuthOrScopeError(error) {
    const status = Number(error && error.status ? error.status : 0);
    const reason = String(error && error.reason ? error.reason : '');
    const message = String(error && error.message ? error.message : '').toLowerCase();

    if (status === 401) return true;

    if (status === 403) {
      return (
        reason === 'insufficientPermissions' ||
        reason === 'insufficientFilePermissions' ||
        reason === 'appNotAuthorizedToFile' ||
        message.includes('insufficient') ||
        message.includes('permission') ||
        message.includes('not authorized')
      );
    }

    return false;
  }

  async function notifyGasUploadCompleted(uploadResult) {
    if (!CONFIG.GAS_WEB_APP_URL) return;

    const metadata = uploadResult || {};
    const drive = metadata.drive || {};

    // GAS側 Code.gs の doPost(e) は JSON.parse(e.postData.contents) で受ける。
    // Teams通知用のキーや通知API URLはGitHub側に置かず、GAS側で処理する。
    const payload = {
      action: 'uploadCompleted',
      token: state.authToken,

      reportId: metadata.reportId || '',
      createdAt: metadata.createdAt || metadata.clientCreatedAt || '',
      targetDepartment: metadata.targetDepartment || metadata.targetDepartmentName || '',

      folderId: drive.folderId || metadata.folder?.id || '',
      folderUrl: drive.folderUrl || metadata.folder?.url || '',

      audioFileId: drive.audioFileId || metadata.audio?.id || '',
      audioFileUrl: drive.audioFileUrl || metadata.audio?.url || '',

      imageFileId: drive.imageFileId || metadata.image?.id || '',
      imageFileUrl: drive.imageFileUrl || metadata.image?.url || '',

      metadataFileId: drive.metadataFileId || metadata.metadataFile?.id || '',
      metadataFileUrl: drive.metadataFileUrl || metadata.metadataFile?.url || '',

      metadata: metadata
    };

    await fetch(CONFIG.GAS_WEB_APP_URL, {
      method: 'POST',
      mode: 'no-cors',
      headers: {
        'Content-Type': 'text/plain;charset=utf-8'
      },
      body: JSON.stringify(payload)
    });
  }


  function buildDriveFileUrl(fileId) {
    if (!fileId) return '';
    return 'https://drive.google.com/file/d/' + encodeURIComponent(fileId) + '/view';
  }

  function buildDriveFolderUrl(folderId) {
    if (!folderId) return '';
    return 'https://drive.google.com/drive/folders/' + encodeURIComponent(folderId);
  }

  function renderUploadResult(result) {
    els.resultCard.classList.remove('hidden');

    if (result.folder && result.folder.url) {
      els.folderLink.href = result.folder.url;
      els.folderLink.textContent = '投稿フォルダを開く';
    } else {
      els.folderLink.href = '#';
      els.folderLink.textContent = '投稿フォルダURLなし';
    }

    window.scrollTo({
      top: document.body.scrollHeight,
      behavior: 'smooth'
    });
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

  function updateUploadButtonState() {
    const hasAudio = Boolean(state.audioBlob);
    const hasImage = Boolean(state.imageBlob);
    const hasDepartment = Boolean(els.targetDepartmentSelect.value);

    const canUpload =
      !state.isUploading &&
      state.driveReady &&
      hasDepartment &&
      (!CONFIG.REQUIRE_AUDIO || hasAudio) &&
      (!CONFIG.REQUIRE_IMAGE || hasImage);

    els.uploadButton.disabled = !canUpload;

    if (state.isUploading) {
      els.uploadButton.textContent = '投稿中...';
    } else {
      els.uploadButton.textContent = 'Google Driveへ投稿';
    }
  }

  function setFatalState(message) {
    setStatus(message, 'error');
    setDriveStatus('利用不可', 'error');
    els.uploadButton.disabled = true;
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

  function buildReportId() {
    const d = new Date();
    const y = d.getFullYear();
    const m = pad2(d.getMonth() + 1);
    const day = pad2(d.getDate());
    const hh = pad2(d.getHours());
    const mm = pad2(d.getMinutes());
    const ss = pad2(d.getSeconds());
    const rand = Math.random().toString(36).slice(2, 8).toUpperCase();

    return 'RPT-' + y + m + day + '-' + hh + mm + ss + '-' + rand;
  }

  function formatTimestampForTitle(date) {
    return (
      date.getFullYear() +
      pad2(date.getMonth() + 1) +
      pad2(date.getDate()) +
      '_' +
      pad2(date.getHours()) +
      pad2(date.getMinutes()) +
      pad2(date.getSeconds())
    );
  }

  function sanitizeFileName(value) {
    return String(value || '')
      .replace(/[\\/:*?"<>|]/g, '_')
      .replace(/\s+/g, '_')
      .slice(0, 80);
  }

  function getExtensionFromMimeType(mimeType, fallback) {
    const map = {
      'audio/webm': 'webm',
      'audio/mp4': 'mp4',
      'audio/aac': 'aac',
      'audio/mpeg': 'mp3',
      'image/jpeg': 'jpg',
      'image/png': 'png',
      'image/webp': 'webp',
      'application/json': 'json'
    };

    return map[mimeType] || fallback;
  }

  function formatBytes(bytes) {
    const n = Number(bytes || 0);

    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';

    return (n / 1024 / 1024).toFixed(1) + ' MB';
  }

  function getErrorMessage(error) {
    if (!error) return '不明なエラーです。';
    if (error.message) return String(error.message);
    return String(error);
  }

  function pad2(n) {
    return String(n).padStart(2, '0');
  }

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
})();

