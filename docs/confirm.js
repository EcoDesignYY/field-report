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
    GOOGLE_CLIENT_ID: '866457692941-cro6etg365bkgq6m0qpor789677g11lq.apps.googleusercontent.com',
    GAS_WEB_APP_URL:
      'https://script.google.com/a/macros/ecodesign-labo.jp/s/' +
      'AKfycbyXfeS3QTVf_ROlbHnooRfNXITfEz8bkOF6QqHBB4BU0yNNmYwNMBYIcueFKYBVDgU/exec',
    DRIVE_ROOT_FOLDER_ID: '1oRhXuGn0YE1C-eKyG7MHNObLr1ficZ-p',
    DRIVE_SCOPE: 'https://www.googleapis.com/auth/drive',

    DB_NAME: 'field-report-draft-db',
    DB_VERSION: 1,
    STORE_NAME: 'draft',

    CONSENT_STORAGE_KEY: 'fieldReportDriveConsentGranted',
    AUTH_TOKEN_STORAGE_KEY: 'fieldReportAuthToken',
    APP_CONTEXT_STORAGE_KEY: 'fieldReportAppContext',

    DRIVE_TOKEN_TIMEOUT_MS: 12000,
    DRIVE_STARTUP_RETRY_COUNT: 2,
    DRIVE_RETRY_DELAY_MS: 1200,

    REQUIRE_IMAGE: false,
    FIRST_PAGE_URL: './input.html',
    AUTO_RETURN_DELAY_MS: 3000
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
    attachments: [],

    audioObjectUrl: '',
    imageObjectUrl: '',

    tokenClient: null,
    tokenResponse: null,
    accessToken: '',
    driveReady: false,
    driveCheckInProgress: false,
    pendingDriveTokenRequest: null,
    driveRecheckTimerId: null,

    isUploading: false,
    uploadResult: null,
    returnTimerId: null
  };

  const elements = {};

  document.addEventListener('DOMContentLoaded', initializePage);

  // ---------------------------------------------------------------------------
  // Page initialization
  // ---------------------------------------------------------------------------

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
      renderAttachmentSummary();
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
      prepareDriveAuthorizationOnDemand();
    } catch (error) {
      state.driveReady = false;
      setDriveStatus('Drive利用不可', 'error');
      showStatus('Google Drive認証の準備に失敗しました。\n' + getErrorMessage(error), 'error');
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

    elements.attachmentSummaryCard = document.getElementById('attachmentSummaryCard');
    elements.attachmentStatus = document.getElementById('attachmentStatus');
    elements.attachmentSummary = document.getElementById('attachmentSummary');
    elements.attachmentList = document.getElementById('attachmentList');

    elements.uploadButton = document.getElementById('uploadButton');
    elements.resultCard = document.getElementById('resultCard');
    elements.folderLink = document.getElementById('folderLink');
    elements.returnToStartButton = document.getElementById('returnToStartButton');
    elements.autoReturnText = document.getElementById('autoReturnText');
    elements.statusBox = document.getElementById('statusBox');
  }

  function bindEvents() {
    elements.backButton.addEventListener('click', () => {
      location.href = './capture.html';
    });

    // Drive認証はページ表示時に自動実行しない。
    // 「Google Driveへ投稿」のクリック操作から直接開始し、
    // iPhoneのポップアップブロックを回避する。
    elements.uploadButton.addEventListener('click', handleUploadClick);
    if (elements.returnToStartButton) {
      elements.returnToStartButton.addEventListener('click', returnToFirstPage);
    }
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

  // ---------------------------------------------------------------------------
  // Draft loading and validation
  // ---------------------------------------------------------------------------

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
    const storedAttachments = await getDraft('attachments');
    state.attachments = Array.isArray(storedAttachments) ? storedAttachments : [];

    if (!state.inputMode) {
      state.inputMode = state.textBody
        ? 'text'
        : state.attachments.length
          ? 'file'
          : 'audio';
    }
  }

  function validateDraftData() {
    if (state.inputMode === 'text' && !state.textBody) {
      throw new Error('テキスト入力モードですが、入力本文がありません。');
    }

    if (state.inputMode === 'audio' && !state.audioBlob) {
      throw new Error('録音モードですが、録音データがありません。');
    }

    if (!['text', 'file', 'audio'].includes(state.inputMode)) {
      throw new Error('入力方式を判定できません。入力方法選択画面からやり直してください。');
    }

    if (!['text', 'file'].includes(state.inputMode)) {
      state.attachments = [];
    }

    if (state.inputMode === 'file' && !state.attachments.length) {
      throw new Error('ファイル投稿ですが、関連ファイルがありません。');
    }

    const checked = FieldReportAttachments.validateCollection(
      state.attachments,
      state.imageBlob ? state.imageBlob.size : 0
    );
    state.attachments = checked.items;
  }

  // ---------------------------------------------------------------------------
  // Preview rendering
  // ---------------------------------------------------------------------------

  function renderInputSummary() {
    if (state.inputMode === 'text' || state.inputMode === 'file') {
      renderTextSummary();
      return;
    }
    renderAudioSummary();
  }

  function renderTextSummary() {
    elements.textSummaryCard.classList.remove('hidden');
    elements.audioSummaryCard.classList.add('hidden');
    elements.textStatus.textContent = state.inputMode === 'file' ? 'ファイルのみ' : '入力済み';
    elements.textStatus.style.background = '#dcfce7';
    elements.textStatus.style.color = '#166534';
    elements.textBodyPreview.textContent = state.textBody || '本文なし（関連ファイルのみで投稿）';
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

  function renderAttachmentSummary() {
    if (!['text', 'file'].includes(state.inputMode) || !state.attachments.length) {
      elements.attachmentSummaryCard.classList.add('hidden');
      elements.attachmentList.innerHTML = '';
      return;
    }

    elements.attachmentSummaryCard.classList.remove('hidden');
    elements.attachmentStatus.textContent = state.attachments.length + '件';
    const total = state.attachments.reduce(
      (sum, item) => {
        const size = Number(
          item.size ||
          (item.blob && item.blob.size) ||
          0
        );
        return sum + size;
      },
      0
    );
    elements.attachmentSummary.textContent =
      '関連ファイル：' +
      state.attachments.length +
      '件 / ' +
      formatBytes(total);
    elements.attachmentList.innerHTML = state.attachments.map(item => {
      const name = item.fileName || item.name || '添付ファイル';
      const categoryLabels = {
        document: '文書・コード',
        image: '画像',
        audio: '音声',
        video: '動画'
      };
      const category = categoryLabels[item.category] || 'ファイル';
      const size = Number(
        item.size ||
        (item.blob && item.blob.size) ||
        0
      );

      return (
        '<div class="attachment-summary-item">' +
          '<strong>' + escapeHtml(name) + '</strong>' +
          '<span>' +
            escapeHtml(category) +
            '・' +
            escapeHtml(formatBytes(size)) +
          '</span>' +
        '</div>'
      );
    }).join('');
  }

  // ---------------------------------------------------------------------------
  // User and department context
  // ---------------------------------------------------------------------------

  async function loadApplicationContext() {
    const raw = sessionStorage.getItem(CONFIG.APP_CONTEXT_STORAGE_KEY);

    if (!raw) {
      throw new Error('利用者情報がありません。GAS入口から開き直してください。');
    }

    let context;
    try {
      context = JSON.parse(raw);
    } catch (_) {
      sessionStorage.removeItem(CONFIG.APP_CONTEXT_STORAGE_KEY);
      throw new Error('保存された利用者情報を読み込めませんでした。');
    }

    if (!context || !(context.submitter || context.currentUser)) {
      throw new Error('保存された利用者情報が不正です。');
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
    const departments = Array.from(
      new Set(
        state.departments
          .map(value => String(value || '').trim())
          .filter(Boolean)
      )
    ).sort();

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

  // ---------------------------------------------------------------------------
  // Google Drive authorization
  // ---------------------------------------------------------------------------

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
      callback: handleDriveTokenResponse,
      error_callback: handleDriveTokenClientError
    });
  }

  function prepareDriveAuthorizationOnDemand() {
    state.accessToken = '';
    state.tokenResponse = null;
    state.driveReady = false;

    elements.drivePermissionCard.classList.add('hidden');
    setDriveStatus('投稿時にDrive確認', 'info');
    showStatus(
      '内容を確認し、「Google Driveへ投稿」を押してください。\n' +
      'Driveの確認後、そのまま自動で投稿します。',
      'info'
    );
    updateUploadButtonState();
  }

  async function checkDriveAuthorizationOnStartup() {
    if (localStorage.getItem(CONFIG.CONSENT_STORAGE_KEY) !== '1') {
      showDrivePermissionRequired('初回のみGoogle Driveの利用許可が必要です。');
      return;
    }

    await verifyDriveAuthorizationAutomatically({
      retryCount: CONFIG.DRIVE_STARTUP_RETRY_COUNT,
      showPermissionCardOnFailure: true
    });
  }

  async function authorizeDriveByUserAction() {
    try {
      elements.authorizeDriveButton.disabled = true;
      elements.authorizeDriveButton.textContent = '承認確認中...';
      setDriveStatus('Drive確認中', 'waiting');
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

  async function verifyDriveAuthorizationAutomatically(options = {}) {
    if (
      state.driveReady
      || state.driveCheckInProgress
      || state.pendingDriveTokenRequest
      || !state.tokenClient
    ) {
      return state.driveReady;
    }

    const retryCount = Math.max(0, Number(options.retryCount || 0));
    const showPermissionCardOnFailure = options.showPermissionCardOnFailure !== false;

    state.driveCheckInProgress = true;
    setDriveStatus('Drive確認中', 'waiting');
    showStatus('Google Driveの承認状態を確認しています...', 'info');

    let lastError = null;

    try {
      for (let attempt = 0; attempt <= retryCount; attempt += 1) {
        try {
          await requestDriveAccessToken('none');
          assertRequiredDriveScope();
          localStorage.setItem(CONFIG.CONSENT_STORAGE_KEY, '1');
          markDriveReady();
          showStatus('Google Driveへ保存できます。', 'success');
          return true;
        } catch (error) {
          lastError = error;

          if (attempt < retryCount) {
            await sleep(CONFIG.DRIVE_RETRY_DELAY_MS * (attempt + 1));
          }
        }
      }

      // タイムアウト後にGoogle側のcallbackが遅れて返る場合があるため、
      // 既存の承認済みフラグは削除せず、自動再確認できる状態を維持する。
      state.driveReady = false;
      setDriveStatus('Drive確認待ち', 'waiting');

      if (showPermissionCardOnFailure) {
        elements.drivePermissionCard.classList.remove('hidden');
      }

      showStatus(
        'Driveの確認に時間がかかっています。確認が完了すると自動で「Drive保存準備完了」に切り替わります。\n' +
        '切り替わらない場合は「Google Driveを許可する」を押してください。' +
        (lastError ? '\n詳細: ' + getErrorMessage(lastError) : ''),
        'warning'
      );
      updateUploadButtonState();
      return false;
    } finally {
      state.driveCheckInProgress = false;
    }
  }

  function scheduleDriveAuthorizationRecheck(delayMs) {
    if (
      state.driveReady
      || state.driveCheckInProgress
      || state.pendingDriveTokenRequest
      || state.isUploading
      || !state.tokenClient
      || localStorage.getItem(CONFIG.CONSENT_STORAGE_KEY) !== '1'
    ) {
      return;
    }

    if (state.driveRecheckTimerId) {
      clearTimeout(state.driveRecheckTimerId);
    }

    state.driveRecheckTimerId = setTimeout(() => {
      state.driveRecheckTimerId = null;
      verifyDriveAuthorizationAutomatically({
        retryCount: 1,
        showPermissionCardOnFailure: false
      }).catch(error => {
        console.warn('[drive] automatic recheck failed', error);
      });
    }, Math.max(0, Number(delayMs || 0)));
  }

  function requestDriveAccessToken(prompt, timeoutMs = CONFIG.DRIVE_TOKEN_TIMEOUT_MS) {
    if (!state.tokenClient) {
      return Promise.reject(new Error('Google認証クライアントが初期化されていません。'));
    }

    if (state.pendingDriveTokenRequest) {
      return state.pendingDriveTokenRequest.promise;
    }

    let resolvePromise;
    let rejectPromise;

    const promise = new Promise((resolve, reject) => {
      resolvePromise = resolve;
      rejectPromise = reject;
    });

    const timeoutId = setTimeout(() => {
      const pending = state.pendingDriveTokenRequest;
      if (!pending || pending.promise !== promise) return;

      state.pendingDriveTokenRequest = null;
      const error = new Error('Google Driveの確認がタイムアウトしました。');
      error.code = 'DRIVE_AUTH_TIMEOUT';
      rejectPromise(error);
    }, Math.max(3000, Number(timeoutMs || CONFIG.DRIVE_TOKEN_TIMEOUT_MS)));

    state.pendingDriveTokenRequest = {
      promise,
      resolve: resolvePromise,
      reject: rejectPromise,
      timeoutId
    };

    try {
      state.tokenClient.requestAccessToken({
        prompt: prompt == null ? '' : String(prompt)
      });
    } catch (error) {
      settlePendingDriveTokenRequest(error);
    }

    return promise;
  }

  function handleDriveTokenResponse(response) {
    if (!response || response.error) {
      const error = new Error(
        response && (response.error_description || response.error)
          ? response.error_description || response.error
          : 'Google Driveの認証に失敗しました。'
      );
      settlePendingDriveTokenRequest(error);
      return;
    }

    const accessToken = response.access_token || '';
    if (!accessToken) {
      settlePendingDriveTokenRequest(new Error('Google Driveアクセストークンを取得できませんでした。'));
      return;
    }

    state.tokenResponse = response;
    state.accessToken = accessToken;
    localStorage.setItem(CONFIG.CONSENT_STORAGE_KEY, '1');

    // callbackがタイムアウト後に遅れて返った場合でも、ここで画面を自動更新する。
    markDriveReady();
    showStatus('Google Driveへ保存できます。', 'success');

    settlePendingDriveTokenRequest(null, accessToken);
  }

  function handleDriveTokenClientError(error) {
    const message = error && (error.message || error.type)
      ? String(error.message || error.type)
      : 'Google Drive認証画面を開始できませんでした。';

    const authError = new Error(message);

    if (state.isUploading) {
      finishDriveAuthorizationFailure(authError);
      return;
    }

    settlePendingDriveTokenRequest(authError);
  }

  function settlePendingDriveTokenRequest(error, value) {
    const pending = state.pendingDriveTokenRequest;
    if (!pending) return;

    state.pendingDriveTokenRequest = null;
    clearTimeout(pending.timeoutId);

    if (error) {
      pending.reject(error);
    } else {
      pending.resolve(value);
    }
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
    elements.driveStatusBadge.classList.remove(
      'status-waiting',
      'status-ready',
      'status-error',
      'status-info'
    );
    elements.driveStatusBadge.classList.add(
      type === 'ready'
        ? 'status-ready'
        : type === 'error'
          ? 'status-error'
          : type === 'info'
            ? 'status-info'
            : 'status-waiting'
    );
  }

  // ---------------------------------------------------------------------------
  // Upload workflow
  // ---------------------------------------------------------------------------

  function handleUploadClick() {
    if (state.isUploading || !validateBeforeUpload()) return;

    state.isUploading = true;
    updateUploadButtonState();

    // すでにこのページ内でアクセストークンを取得済みなら、そのまま投稿する。
    if (state.accessToken && state.driveReady) {
      uploadAfterDriveAuthorization();
      return;
    }

    // 重要：requestAccessToken()をクリックイベントの同期処理内で直接呼ぶ。
    // ページロードやタイマーから呼ぶと、iPhoneではポップアップとして遮断されやすい。
    requestDriveAuthorizationFromUploadClick();
  }

  function requestDriveAuthorizationFromUploadClick() {
    if (!state.tokenClient) {
      finishDriveAuthorizationFailure(
        new Error('Google認証クライアントが初期化されていません。')
      );
      return;
    }

    setDriveStatus('Drive確認中', 'waiting');
    showStatus('Google Driveの承認状態を確認しています...', 'info');

    state.tokenClient.callback = response => {
      if (!response || response.error) {
        finishDriveAuthorizationFailure(new Error(
          response && (response.error_description || response.error)
            ? response.error_description || response.error
            : 'Google Driveの認証に失敗しました。'
        ));
        return;
      }

      const accessToken = response.access_token || '';
      if (!accessToken) {
        finishDriveAuthorizationFailure(
          new Error('Google Driveアクセストークンを取得できませんでした。')
        );
        return;
      }

      state.tokenResponse = response;
      state.accessToken = accessToken;

      try {
        assertRequiredDriveScope();
      } catch (error) {
        finishDriveAuthorizationFailure(error);
        return;
      }

      localStorage.setItem(CONFIG.CONSENT_STORAGE_KEY, '1');
      markDriveReady();
      showStatus('Google Driveへ投稿しています...', 'info');
      uploadAfterDriveAuthorization();
    };

    const hasConsent = localStorage.getItem(CONFIG.CONSENT_STORAGE_KEY) === '1';

    try {
      state.tokenClient.requestAccessToken({
        prompt: hasConsent ? '' : 'consent'
      });
    } catch (error) {
      finishDriveAuthorizationFailure(error);
    }
  }

  async function uploadAfterDriveAuthorization() {
    try {
      const result = await uploadReportCore();
      state.uploadResult = result;
      await putDraft('uploadResult', result);
      renderUploadResult(result);
      showStatus(
        '投稿が完了しました。Teams受付通知とAI解析はGAS側で順次実行されます。',
        'success'
      );
    } catch (error) {
      console.error(error);

      if (isAuthorizationError(error)) {
        resetDriveAuthorization();
        setDriveStatus('投稿時に再確認', 'info');
        showStatus(
          'Google Driveの認証期限が切れました。もう一度「Google Driveへ投稿」を押してください。',
          'warning'
        );
      } else {
        showStatus('投稿に失敗しました。\n' + getErrorMessage(error), 'error');
      }
    } finally {
      state.isUploading = false;
      updateUploadButtonState();
    }
  }

  function finishDriveAuthorizationFailure(error) {
    state.isUploading = false;
    state.driveReady = false;
    state.accessToken = '';
    state.tokenResponse = null;

    setDriveStatus('投稿時に再確認', 'info');
    showStatus(
      'Google Driveの確認を完了できませんでした。\n' +
      'もう一度「Google Driveへ投稿」を押してください。\n' +
      getErrorMessage(error),
      'warning'
    );
    updateUploadButtonState();
  }

  function validateBeforeUpload() {
    if (state.inputMode === 'text' && !state.textBody) {
      showStatus('テキスト入力内容がありません。', 'error');
      return false;
    }
    if (state.inputMode === 'file' && !state.attachments.length) {
      showStatus('関連ファイルがありません。', 'error');
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
    try {
      FieldReportAttachments.validateCollection(
        ['text', 'file'].includes(state.inputMode) ? state.attachments : [],
        state.imageBlob ? state.imageBlob.size : 0
      );
    } catch (error) {
      showStatus(getErrorMessage(error), 'error');
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

  // ---------------------------------------------------------------------------
  // Report files and metadata
  // ---------------------------------------------------------------------------

  async function uploadReportCore() {
    const targetDepartment = elements.targetDepartmentSelect.value;
    const reportId = buildReportId();
    const autoTitle = '現場投稿_' + formatTimestampForTitle(new Date()) + '_' + targetDepartment;
    const folderName = reportId + '_' + sanitizeFileName(targetDepartment);

    const folder = await createDriveFolder(folderName, CONFIG.DRIVE_ROOT_FOLDER_ID);
    const audioFile = await uploadAudioFileIfNeeded(reportId, folder.id);
    const imageFile = await uploadImageFileIfNeeded(reportId, folder.id);
    const attachmentFiles = await uploadAttachmentFilesIfNeeded(reportId, folder.id);

    let metadata = buildReportMetadata({
      reportId,
      autoTitle,
      targetDepartment,
      folder,
      audioFile,
      imageFile,
      attachmentFiles,
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
      attachmentFiles,
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

  async function uploadAttachmentFilesIfNeeded(reportId, folderId) {
    if (!['text', 'file'].includes(state.inputMode) || !state.attachments.length) return [];

    const results = [];
    for (let index = 0; index < state.attachments.length; index += 1) {
      const item = FieldReportAttachments.normalizeStoredAttachment(state.attachments[index]);
      if (!item.blob) throw new Error('添付ファイル本体を読み込めません: ' + item.fileName);
      const uploaded = await uploadFileResumable({
        name: 'attachment_' + String(index + 1).padStart(2, '0') + '_' + sanitizeFileName(item.fileName),
        mimeType: item.mimeType || item.blob.type || 'application/octet-stream',
        blob: item.blob,
        parentFolderId: folderId
      });
      results.push({ item, uploaded });
    }
    return results;
  }

  function buildReportMetadata(params) {
    const submitter = state.submitter || {};
    const audioMeta = state.audioMeta || {};
    const imageMeta = state.imageMeta || {};
    const textMeta = state.textMeta || {};
    const folderUrl = params.folder.webViewLink || buildDriveFolderUrl(params.folder.id);
    const attachments = (params.attachmentFiles || []).map(entry =>
      FieldReportAttachments.toMetadata(entry.item, entry.uploaded)
    );

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
      schemaVersion: 4,
      reportId: params.reportId,
      createdAt: state.draftStartedAt || new Date().toISOString(),
      clientCreatedAt: new Date().toISOString(),
      autoTitle: params.autoTitle,
      status: 'uploaded',

      inputMode: state.inputMode,
      input: {
        mode: state.inputMode,
        text: state.textBody || '',
        speechRequired: state.inputMode === 'audio'
      },
      text: state.textBody ? {
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
      attachments,

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
        attachmentFiles: attachments.map(function(item) {
          return {
            fileId: item.fileId,
            fileName: item.fileName,
            mimeType: item.mimeType,
            size: item.size,
            category: item.category,
            url: item.url
          };
        }),
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

  // ---------------------------------------------------------------------------
  // Google Drive API helpers
  // ---------------------------------------------------------------------------

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
    const blob = new Blob(
      [JSON.stringify(value, null, 2)],
      { type: 'application/json' }
    );
    return uploadFileResumable({
      name,
      mimeType: 'application/json',
      blob,
      parentFolderId
    });
  }

  async function uploadFileResumable({ name, mimeType, blob, parentFolderId }) {
    const initialization = await fetch(
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

  // ---------------------------------------------------------------------------
  // GAS upload-completed notification
  // ---------------------------------------------------------------------------

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
      attachments: Array.isArray(metadata.attachments) ? metadata.attachments : [],
      metadata
    };

    try {
      await fetchWithTimeout(CONFIG.GAS_WEB_APP_URL, {
        method: 'POST',
        mode: 'no-cors',
        headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
        body: JSON.stringify(payload)
      }, 12000);

      return { requested: true, warning: '' };
    } catch (error) {
      console.warn('[confirm] GAS uploadCompleted notification failed', error);
      return {
        requested: false,
        warning: 'GASへの投稿完了通知に失敗しました。Driveへの保存は完了しています。AI処理トリガーはmetadata.jsonから処理できます。'
      };
    }
  }

  function fetchWithTimeout(url, options, timeoutMs) {
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = controller
      ? setTimeout(() => controller.abort(), timeoutMs)
      : null;

    const requestOptions = controller
      ? { ...options, signal: controller.signal }
      : options;

    return fetch(url, requestOptions).finally(() => {
      if (timer) clearTimeout(timer);
    });
  }

  // ---------------------------------------------------------------------------
  // Completion, cleanup, and navigation
  // ---------------------------------------------------------------------------

  function renderUploadResult(result) {
    elements.resultCard.classList.remove('hidden');
    elements.folderLink.href = result.drive.folderUrl || '#';
    elements.folderLink.textContent = result.drive.folderUrl ? '投稿フォルダを開く' : '投稿フォルダURLなし';
    elements.uploadButton.disabled = true;
    elements.uploadButton.textContent = '投稿済み';
    window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
    startAutoReturnCountdown();
  }

  function startAutoReturnCountdown() {
    if (state.returnTimerId) {
      clearInterval(state.returnTimerId);
      state.returnTimerId = null;
    }

    const delayMs = Number(CONFIG.AUTO_RETURN_DELAY_MS || 0);
    if (delayMs <= 0) return;

    const startedAt = Date.now();

    const updateText = () => {
      const remainingMs = Math.max(0, delayMs - (Date.now() - startedAt));
      const remainingSec = Math.ceil(remainingMs / 1000);

      if (elements.autoReturnText) {
        elements.autoReturnText.textContent = remainingSec > 0
          ? remainingSec + '秒後に最初の画面へ戻ります。'
          : '最初の画面へ戻ります。';
      }

      if (remainingMs <= 0) {
        clearInterval(state.returnTimerId);
        state.returnTimerId = null;
        returnToFirstPage();
      }
    };

    updateText();
    state.returnTimerId = setInterval(updateText, 250);
  }

  async function returnToFirstPage() {
    if (state.returnTimerId) {
      clearInterval(state.returnTimerId);
      state.returnTimerId = null;
    }

    try {
      await clearDraftStore();
    } catch (error) {
      console.warn('投稿データの初期化に失敗しました。', error);
    }

    revokePreviewObjectUrls();
    location.replace(CONFIG.FIRST_PAGE_URL);
  }

  function clearDraftStore() {
    return new Promise((resolve, reject) => {
      if (!state.db) {
        resolve();
        return;
      }

      const transaction = state.db.transaction(CONFIG.STORE_NAME, 'readwrite');
      const request = transaction.objectStore(CONFIG.STORE_NAME).clear();

      request.onsuccess = () => resolve();
      request.onerror = event => reject(event.target.error || new Error('投稿データを初期化できませんでした。'));
      transaction.onerror = event => reject(event.target.error || new Error('投稿データの初期化トランザクションに失敗しました。'));
    });
  }

  function revokePreviewObjectUrls() {
    if (state.audioObjectUrl) {
      URL.revokeObjectURL(state.audioObjectUrl);
      state.audioObjectUrl = '';
    }

    if (state.imageObjectUrl) {
      URL.revokeObjectURL(state.imageObjectUrl);
      state.imageObjectUrl = '';
    }
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
    const hasSource = state.inputMode === 'audio'
      ? Boolean(state.audioBlob)
      : state.inputMode === 'file'
        ? state.attachments.length > 0
        : Boolean(state.textBody);
    const hasImage = Boolean(state.imageBlob);
    const hasDepartment = Boolean(elements.targetDepartmentSelect.value);

    // Drive認証前でも投稿ボタンは押せるようにする。
    // ボタンのクリック操作をそのままOAuth開始のユーザー操作として利用する。
    const canUpload = !state.isUploading
      && !state.uploadResult
      && hasDepartment
      && hasSource
      && (!CONFIG.REQUIRE_IMAGE || hasImage);

    elements.uploadButton.disabled = !canUpload;

    if (state.isUploading) {
      elements.uploadButton.textContent = state.driveReady
        ? '投稿中...'
        : 'Drive確認中...';
    } else if (state.uploadResult) {
      elements.uploadButton.textContent = '投稿済み';
    } else {
      elements.uploadButton.textContent = 'Google Driveへ投稿';
    }
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

  // ---------------------------------------------------------------------------
  // IndexedDB and generic utilities
  // ---------------------------------------------------------------------------

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
    return value === 'text' || value === 'file' || value === 'audio' ? value : '';
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

  function escapeHtml(value) {
    return String(value || '').replace(/[&<>'"]/g, character => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
    }[character]));
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
