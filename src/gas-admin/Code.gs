/**
 * Talk Course Manager — container-bound Google Apps Script backend.
 *
 * Index.html is a generated build artifact. This backend only references it.
 * Runtime identifiers and user email addresses are discovered at install time;
 * none belong in source control.
 */

const TCM = Object.freeze({
  schemaVersion: 1,
  maxBatchSize: 1,
  maxCellChars: 45000,
  lockTimeoutMs: 30000,
  spreadsheetProperty: 'TCM_SPREADSHEET_ID',
  installedMarkerProperty: 'TCM_INSTALLED_AT',
  sheets: Object.freeze({
    Users: ['id', 'email', 'role', 'status', 'createdAt', 'updatedAt', 'deletedAt', 'version'],
    Settings: ['key', 'valueJson', 'updatedAt', 'updatedBy', 'version'],
    Speakers: ['id', 'name', 'title', 'organization', 'email', 'phone', 'notes', 'status', 'createdAt', 'updatedAt', 'deletedAt', 'version'],
    Talks: ['id', 'date', 'startTime', 'endTime', 'title', 'speakerId', 'room', 'status', 'notes', 'createdAt', 'updatedAt', 'deletedAt', 'version'],
    Tasks: ['id', 'talkId', 'title', 'dueDate', 'assigneeEmail', 'status', 'notes', 'createdAt', 'updatedAt', 'deletedAt', 'version'],
    AuditLog: ['id', 'timestamp', 'actorEmail', 'action', 'entityType', 'entityId', 'beforeJson', 'afterJson', 'requestId'],
    Transactions: ['id', 'status', 'entity', 'entityId', 'beforeJson', 'afterJson', 'baseRevision', 'nextRevision', 'actorEmail', 'action', 'createdAt', 'committedAt']
  }),
  entitySheets: Object.freeze({
    users: 'Users',
    speakers: 'Speakers',
    talks: 'Talks',
    tasks: 'Tasks'
  })
});

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Talk Course Manager')
    .addItem('安裝／修復系統', 'installSystem')
    .addItem('執行系統健檢', 'showHealthCheck')
    .addToUi();
}

function installSystem() {
  return withSystemLock_(function () {
    const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
    if (!spreadsheet) raise_('NO_CONTAINER', '請從綁定的 Google Sheet 執行安裝。');
    const properties = PropertiesService.getScriptProperties();
    const recordedSpreadsheetId = properties.getProperty(TCM.spreadsheetProperty);
    if (recordedSpreadsheetId && recordedSpreadsheetId !== spreadsheet.getId()) {
      raise_('CONTAINER_MISMATCH', '這份 Apps Script 已綁定另一份試算表，不能在此重新認領。');
    }
    const actorEmail = requireActiveEmail_();
    const actorDomain = workspaceDomainFromEmail_(actorEmail);
    const now = nowIso_();

    // Validate any surviving Settings before creating or changing sheets. This
    // prevents a failed/partial install from being reclaimed by another domain.
    const existingSettingsSheet = spreadsheet.getSheetByName('Settings');
    if (existingSettingsSheet && existingSettingsSheet.getLastRow() > 1) {
      const existingHeaders = existingSettingsSheet.getRange(1, 1, 1, existingSettingsSheet.getLastColumn()).getDisplayValues()[0];
      if (!arraysEqual_(existingHeaders, TCM.sheets.Settings)) {
        raise_('HEADER_MISMATCH', 'Settings 的欄位不符合目前 schema。');
      }
      const existingSettings = readRecordsFromSheet_(existingSettingsSheet, TCM.sheets.Settings);
      const existingDomain = settingValue_(existingSettings, 'workspaceDomain');
      if (existingDomain && String(existingDomain).toLowerCase() !== actorDomain) {
        raise_('DOMAIN_MISMATCH', '目前帳號不屬於這套系統既有的 Workspace 網域。');
      }
    }

    Object.keys(TCM.sheets).forEach(function (sheetName) {
      ensureSheet_(spreadsheet, sheetName, TCM.sheets[sheetName]);
    });

    const users = readRecords_('Users');
    const activeUsers = users.filter(isActiveRecord_);
    const wasInstalled = Boolean(properties.getProperty(TCM.installedMarkerProperty));
    let bootstrapped = false;

    if (activeUsers.length === 0) {
      if (wasInstalled) {
        raise_('OWNER_RECOVERY_REQUIRED', '系統曾完成安裝但目前沒有 active owner；為防止重新認領，請依復原文件處理。');
      }
      users.push({
        id: Utilities.getUuid(),
        email: actorEmail,
        role: 'owner',
        status: 'active',
        createdAt: now,
        updatedAt: now,
        deletedAt: '',
        version: 1
      });
      writeRecords_('Users', users);
      bootstrapped = true;
    } else {
      const actor = findUserByEmail_(users, actorEmail);
      if (!actor || actor.role !== 'owner' || !isActiveRecord_(actor)) {
        raise_('OWNER_REQUIRED', '只有既有 owner 可以重新執行安裝或修復。');
      }
    }

    const settings = readSettings_();
    const configuredDomain = settingValue_(settings, 'workspaceDomain');
    if (configuredDomain && String(configuredDomain).toLowerCase() !== actorDomain) {
      raise_('DOMAIN_MISMATCH', '目前帳號不屬於這套系統設定的 Workspace 網域。');
    }
    upsertSetting_(settings, 'workspaceDomain', actorDomain, actorEmail, now);
    if (settingValue_(settings, 'systemRevision') === null) {
      upsertSetting_(settings, 'systemRevision', 0, actorEmail, now);
    }
    upsertSetting_(settings, 'schemaVersion', TCM.schemaVersion, actorEmail, now);
    writeSettings_(settings);

    properties.setProperty(TCM.spreadsheetProperty, spreadsheet.getId());
    properties.setProperty(TCM.installedMarkerProperty, properties.getProperty(TCM.installedMarkerProperty) || now);

    appendAudit_({
      actorEmail: actorEmail,
      action: bootstrapped ? 'SYSTEM_BOOTSTRAP' : 'SYSTEM_REPAIR',
      entityType: 'system',
      entityId: 'bound-spreadsheet',
      before: null,
      after: { schemaVersion: TCM.schemaVersion, workspaceDomain: actorDomain },
      requestId: Utilities.getUuid()
    });

    return {
      ok: true,
      bootstrapped: bootstrapped,
      viewer: { email: actorEmail, role: 'owner', domain: actorDomain },
      health: healthCheckUnlocked_(actorEmail)
    };
  });
}

function showHealthCheck() {
  const result = healthCheck();
  SpreadsheetApp.getUi().alert(
    result.healthy ? '系統健檢通過' : '系統健檢發現問題',
    JSON.stringify(result, null, 2),
    SpreadsheetApp.getUi().ButtonSet.OK
  );
}

function doGet() {
  requireRole_(['owner', 'editor']);
  return HtmlService.createTemplateFromFile('Index')
    .evaluate()
    .setTitle('Talk Course Manager')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.DEFAULT);
}

function whoami() {
  const email = activeEmail_();
  const installed = isInstalled_();
  if (!email) {
    return { ok: true, email: '', domain: '', role: 'denied', installed: installed };
  }
  const users = installed ? readRecords_('Users') : [];
  const user = findUserByEmail_(users, email);
  const role = user && isActiveRecord_(user) ? user.role : 'denied';
  return {
    ok: true,
    email: email,
    domain: workspaceDomainFromEmail_(email, false),
    role: role,
    installed: installed
  };
}

function getSnapshot(options) {
  return withSystemLock_(function () {
    recoverPendingTransactions_();
    const viewer = requireRole_(['owner', 'editor']);
    const includeDeleted = Boolean(options && options.includeDeleted && viewer.role === 'owner');
    const settings = readSettings_();
    const config = settingValue_(settings, 'courseConfig');

    return {
      ok: true,
      revision: currentRevision_(settings),
      serverTime: nowIso_(),
      viewer: viewer,
      config: config,
      speakers: visibleRecords_(readRecords_('Speakers'), includeDeleted),
      talks: visibleRecords_(readRecords_('Talks'), includeDeleted),
      tasks: visibleRecords_(readRecords_('Tasks'), includeDeleted),
      users: viewer.role === 'owner' ? visibleRecords_(readRecords_('Users'), includeDeleted) : []
    };
  });
}

function saveBatch(payload) {
  return withSystemLock_(function () {
    recoverPendingTransactions_();
    const viewer = requireRole_(['owner', 'editor']);
    const request = requireObject_(payload, 'payload');
    const operations = request.operations;
    if (!Array.isArray(operations) || operations.length < 1 || operations.length > TCM.maxBatchSize) {
      raise_('INVALID_BATCH', 'operations 必須是 1 到 ' + TCM.maxBatchSize + ' 筆的陣列。');
    }

    const settings = readSettings_();
    const revision = currentRevision_(settings);
    requireBaseRevision_(request.baseRevision, revision);

    const states = {};
    Object.keys(TCM.entitySheets).forEach(function (entity) {
      states[entity] = readRecords_(TCM.entitySheets[entity]);
    });

    const now = nowIso_();
    const requestId = Utilities.getUuid();
    const audits = [];
    const results = [];

    operations.forEach(function (rawOperation, index) {
      const operation = normalizeOperation_(rawOperation, index);
      enforceEntityPermission_(viewer.role, operation.entity);
      const rows = states[operation.entity];
      const rowIndex = operation.id ? rows.findIndex(function (row) { return row.id === operation.id; }) : -1;
      let before = null;
      let after = null;

      if (operation.action === 'create') {
        const id = operation.id || Utilities.getUuid();
        if (rows.some(function (row) { return row.id === id; })) {
          raise_('DUPLICATE_ID', '第 ' + (index + 1) + ' 筆操作的 id 已存在。', { index: index, id: id });
        }
        after = createRecord_(operation.entity, id, operation.data, now);
        rows.push(after);
      } else {
        if (rowIndex < 0) {
          raise_('NOT_FOUND', '第 ' + (index + 1) + ' 筆操作找不到指定資料。', { index: index, id: operation.id });
        }
        before = clone_(rows[rowIndex]);
        if (!isActiveRecord_(before)) {
          raise_('ALREADY_DELETED', '已刪除的資料不能再修改。', { index: index, id: operation.id });
        }
        requireRowVersion_(operation.version, Number(before.version), index, operation.id);
        if (operation.action === 'update') {
          after = updateRecord_(operation.entity, before, operation.data, now);
        } else {
          after = clone_(before);
          after.status = 'deleted';
          after.deletedAt = now;
          after.updatedAt = now;
          after.version = Number(before.version) + 1;
        }
        rows[rowIndex] = after;
      }

      results.push({
        index: index,
        entity: operation.entity,
        action: operation.action,
        id: after.id,
        version: after.version
      });
      audits.push({
        actorEmail: viewer.email,
        action: operation.action.toUpperCase(),
        entityType: operation.entity,
        entityId: after.id,
        before: before,
        after: after,
        requestId: requestId
      });
    });

    validateState_(states, viewer.email);

    const transaction = {
      id: requestId,
      status: 'prepared',
      entity: results[0].entity,
      entityId: results[0].id,
      beforeJson: JSON.stringify(audits[0].before),
      afterJson: JSON.stringify(audits[0].after),
      baseRevision: revision,
      nextRevision: revision + 1,
      actorEmail: viewer.email,
      action: results[0].action,
      createdAt: now,
      committedAt: ''
    };
    appendTransaction_(transaction);

    writeRecords_(TCM.entitySheets[results[0].entity], [audits[0].after]);
    const nextRevision = revision + 1;
    const revisionSetting = upsertSetting_(settings, 'systemRevision', nextRevision, viewer.email, now);
    writeRecords_('Settings', [revisionSetting]);
    audits.forEach(appendAudit_);
    markTransactionCommitted_(requestId);

    return { ok: true, revision: nextRevision, results: results };
  });
}

function importCourseConfig(payload) {
  return withSystemLock_(function () {
    recoverPendingTransactions_();
    const viewer = requireRole_(['owner']);
    const request = requireObject_(payload, 'payload');
    const config = validateCourseConfig_(request.config);
    const settings = readSettings_();
    const revision = currentRevision_(settings);
    requireBaseRevision_(request.baseRevision, revision);

    const now = nowIso_();
    const existing = findSetting_(settings, 'courseConfig');
    const before = existing ? parseSettingJson_(existing.valueJson, 'courseConfig') : null;
    const updated = upsertSetting_(settings, 'courseConfig', config, viewer.email, now);
    const nextRevision = revision + 1;
    const revisionSetting = upsertSetting_(settings, 'systemRevision', nextRevision, viewer.email, now);
    const requestId = Utilities.getUuid();
    appendTransaction_({
      id: requestId,
      status: 'prepared',
      entity: 'settings',
      entityId: 'courseConfig',
      beforeJson: JSON.stringify(before),
      afterJson: JSON.stringify(config),
      baseRevision: revision,
      nextRevision: nextRevision,
      actorEmail: viewer.email,
      action: existing ? 'config_update' : 'config_import',
      createdAt: now,
      committedAt: ''
    });
    writeRecords_('Settings', [updated, revisionSetting]);
    appendAudit_({
      actorEmail: viewer.email,
      action: existing ? 'CONFIG_UPDATE' : 'CONFIG_IMPORT',
      entityType: 'settings',
      entityId: 'courseConfig',
      before: before,
      after: config,
      requestId: requestId
    });
    markTransactionCommitted_(requestId);

    return {
      ok: true,
      revision: nextRevision,
      config: config,
      settingsVersion: updated.version
    };
  });
}

function healthCheck() {
  return withSystemLock_(function () {
    recoverPendingTransactions_();
    const viewer = requireRole_(['owner']);
    return healthCheckUnlocked_(viewer.email);
  });
}

function healthCheckUnlocked_(actorEmail) {
  const spreadsheet = requireContainerSpreadsheet_();
  const checks = [];
  Object.keys(TCM.sheets).forEach(function (sheetName) {
    const sheet = spreadsheet.getSheetByName(sheetName);
    const actualHeaders = sheet && sheet.getLastColumn() > 0
      ? sheet.getRange(1, 1, 1, sheet.getLastColumn()).getDisplayValues()[0]
      : [];
    checks.push({
      sheet: sheetName,
      exists: Boolean(sheet),
      headersExact: Boolean(sheet) && arraysEqual_(actualHeaders, TCM.sheets[sheetName])
    });
  });

  const settings = readSettings_();
  const configuredDomain = settingValue_(settings, 'workspaceDomain');
  const users = readRecords_('Users');
  const activeOwners = users.filter(function (user) {
    return isActiveRecord_(user) && user.role === 'owner';
  });
  const actorDomain = workspaceDomainFromEmail_(actorEmail);
  const domainMatches = configuredDomain === actorDomain;
  const healthy = checks.every(function (check) {
    return check.exists && check.headersExact;
  }) && activeOwners.length > 0 && domainMatches;

  return {
    ok: true,
    healthy: healthy,
    schemaVersion: settingValue_(settings, 'schemaVersion'),
    revision: currentRevision_(settings),
    workspaceDomain: configuredDomain,
    domainMatches: domainMatches,
    activeOwnerCount: activeOwners.length,
    sheets: checks,
    checkedAt: nowIso_()
  };
}

function validateState_(states, actorEmail) {
  const users = states.users;
  const activeUsers = users.filter(isActiveRecord_);
  const activeOwners = activeUsers.filter(function (user) { return user.role === 'owner'; });
  if (activeOwners.length < 1) {
    raise_('LAST_OWNER', '系統至少必須保留一位 active owner。');
  }

  const configuredDomain = settingValue_(readSettings_(), 'workspaceDomain');
  const emails = {};
  activeUsers.forEach(function (user) {
    const email = normalizeEmail_(user.email);
    if (workspaceDomainFromEmail_(email) !== configuredDomain) {
      raise_('USER_DOMAIN_MISMATCH', 'Users 只能加入同一個 Workspace 網域。', { email: email });
    }
    if (emails[email]) {
      raise_('DUPLICATE_EMAIL', 'Users 不能有重複的 active email。', { email: email });
    }
    emails[email] = true;
  });

  const actor = findUserByEmail_(users, actorEmail);
  if (!actor || !isActiveRecord_(actor)) {
    raise_('SELF_LOCKOUT', '這批變更會移除目前操作者自己的存取權，因此已拒絕。');
  }

  const speakerIds = indexIds_(states.speakers);
  states.talks.filter(isActiveRecord_).forEach(function (talk) {
    if (talk.speakerId && !speakerIds[talk.speakerId]) {
      raise_('INVALID_REFERENCE', 'Talks 的 speakerId 找不到 speaker。', { talkId: talk.id, speakerId: talk.speakerId });
    }
    if (talk.startTime && talk.endTime && talk.startTime >= talk.endTime) {
      raise_('INVALID_TIME_RANGE', 'Talks.startTime 必須早於 endTime。', { talkId: talk.id });
    }
  });
  const talkIds = indexIds_(states.talks);
  states.tasks.filter(isActiveRecord_).forEach(function (task) {
    if (task.talkId && !talkIds[task.talkId]) {
      raise_('INVALID_REFERENCE', 'Tasks 的 talkId 找不到 talk。', { taskId: task.id, talkId: task.talkId });
    }
    if (task.assigneeEmail && !emails[task.assigneeEmail]) {
      raise_('INVALID_ASSIGNEE', 'Tasks.assigneeEmail 必須是 active Users 成員。', { taskId: task.id, email: task.assigneeEmail });
    }
  });
}

function normalizeOperation_(rawOperation, index) {
  const operation = requireObject_(rawOperation, 'operations[' + index + ']');
  const allowed = ['entity', 'action', 'id', 'version', 'data'];
  rejectUnknownKeys_(operation, allowed, 'operations[' + index + ']');
  if (!TCM.entitySheets[operation.entity]) {
    raise_('INVALID_ENTITY', '不支援的 entity。', { index: index, entity: operation.entity });
  }
  if (['create', 'update', 'delete'].indexOf(operation.action) < 0) {
    raise_('INVALID_ACTION', '不支援的 action。', { index: index, action: operation.action });
  }
  if (operation.action !== 'create') {
    requireId_(operation.id, 'operations[' + index + '].id');
    if (!Number.isInteger(operation.version) || operation.version < 1) {
      raise_('INVALID_VERSION', 'update/delete 必須提供正整數 version。', { index: index });
    }
  } else if (operation.id) {
    requireId_(operation.id, 'operations[' + index + '].id');
  }
  const data = operation.action === 'delete' ? {} : requireObject_(operation.data, 'operations[' + index + '].data');
  return {
    entity: operation.entity,
    action: operation.action,
    id: operation.id || '',
    version: operation.version,
    data: data
  };
}

function enforceEntityPermission_(role, entity) {
  if (entity === 'users' && role !== 'owner') {
    raise_('FORBIDDEN', '只有 owner 可以管理 Users。');
  }
}

function createRecord_(entity, id, data, now) {
  const normalized = normalizeEntityData_(entity, data, true);
  return Object.assign({ id: id }, normalized, {
    createdAt: now,
    updatedAt: now,
    deletedAt: '',
    version: 1
  });
}

function updateRecord_(entity, before, data, now) {
  const normalized = normalizeEntityData_(entity, data, false);
  const after = Object.assign({}, before, normalized);
  after.updatedAt = now;
  after.version = Number(before.version) + 1;
  return after;
}

function normalizeEntityData_(entity, data, isCreate) {
  const specs = {
    users: {
      keys: ['email', 'role', 'status'],
      defaults: { status: 'active' }
    },
    speakers: {
      keys: ['name', 'title', 'organization', 'email', 'phone', 'notes', 'status'],
      defaults: { name: '', title: '', organization: '', email: '', phone: '', notes: '', status: 'active' }
    },
    talks: {
      keys: ['date', 'startTime', 'endTime', 'title', 'speakerId', 'room', 'status', 'notes'],
      defaults: { date: '', startTime: '', endTime: '', title: '', speakerId: '', room: '', status: 'planned', notes: '' }
    },
    tasks: {
      keys: ['talkId', 'title', 'dueDate', 'assigneeEmail', 'status', 'notes'],
      defaults: { talkId: '', title: '', dueDate: '', assigneeEmail: '', status: 'pending', notes: '' }
    }
  };
  const spec = specs[entity];
  rejectUnknownKeys_(data, spec.keys, entity + '.data');
  const result = isCreate ? Object.assign({}, spec.defaults, data) : Object.assign({}, data);

  Object.keys(result).forEach(function (key) {
    if (typeof result[key] !== 'string') {
      raise_('INVALID_FIELD', entity + '.' + key + ' 必須是字串。');
    }
    result[key] = result[key].trim();
    const limit = key === 'notes' ? 5000 : 500;
    if (result[key].length > limit) {
      raise_('FIELD_TOO_LONG', entity + '.' + key + ' 超過長度限制。');
    }
  });

  if (entity === 'users') {
    if (!result.email && isCreate) raise_('REQUIRED_FIELD', 'Users.email 為必填。');
    if (result.email) result.email = normalizeEmail_(result.email);
    if (result.role && ['owner', 'editor'].indexOf(result.role) < 0) raise_('INVALID_ROLE', 'Users.role 只能是 owner 或 editor。');
    if (result.status && ['active', 'disabled'].indexOf(result.status) < 0) raise_('INVALID_STATUS', 'Users.status 只能是 active 或 disabled。');
    if (isCreate && !result.role) raise_('REQUIRED_FIELD', 'Users.role 為必填。');
  }
  if (entity === 'speakers' && result.status && ['active', 'inactive'].indexOf(result.status) < 0) {
    raise_('INVALID_STATUS', 'Speakers.status 只能是 active 或 inactive。');
  }
  if (entity === 'talks' && result.status && ['planned', 'confirmed', 'completed', 'cancelled'].indexOf(result.status) < 0) {
    raise_('INVALID_STATUS', 'Talks.status 不在允許清單中。');
  }
  if (entity === 'tasks' && result.status && ['pending', 'in_progress', 'done', 'cancelled'].indexOf(result.status) < 0) {
    raise_('INVALID_STATUS', 'Tasks.status 不在允許清單中。');
  }
  if (entity === 'speakers' && isCreate && !result.name) raise_('REQUIRED_FIELD', 'Speakers.name 為必填。');
  if (entity === 'tasks' && isCreate && !result.title) raise_('REQUIRED_FIELD', 'Tasks.title 為必填。');

  if (result.speakerId) requireId_(result.speakerId, 'Talks.speakerId');
  if (result.talkId) requireId_(result.talkId, 'Tasks.talkId');

  ['email', 'assigneeEmail'].forEach(function (field) {
    if (Object.prototype.hasOwnProperty.call(result, field) && result[field]) {
      result[field] = normalizeEmail_(result[field]);
    }
  });
  ['date', 'dueDate'].forEach(function (field) {
    if (Object.prototype.hasOwnProperty.call(result, field) && result[field]) requireDate_(result[field], entity + '.' + field);
  });
  ['startTime', 'endTime'].forEach(function (field) {
    if (Object.prototype.hasOwnProperty.call(result, field) && result[field]) requireTime_(result[field], entity + '.' + field);
  });
  return result;
}

function validateCourseConfig_(rawConfig) {
  const config = clone_(requireObject_(rawConfig, 'config'));
  rejectUnknownKeys_(config, ['schemaVersion', 'organization', 'course', 'schedule', 'features', 'needsConfirmation'], 'config');
  if (config.schemaVersion !== TCM.schemaVersion) raise_('UNSUPPORTED_SCHEMA', '目前只支援 schemaVersion 1。');

  const organization = requireObject_(config.organization, 'organization');
  rejectUnknownKeys_(organization, ['schoolName', 'unitName', 'timeZone'], 'organization');
  requireText_(organization.schoolName, 'organization.schoolName', 120, true);
  requireText_(organization.unitName, 'organization.unitName', 120, true);
  requireText_(organization.timeZone, 'organization.timeZone', 80, true);

  const course = requireObject_(config.course, 'course');
  rejectUnknownKeys_(course, ['name', 'semester', 'room', 'talkCount'], 'course');
  requireText_(course.name, 'course.name', 160, true);
  requireText_(course.semester, 'course.semester', 40, true);
  requireText_(course.room, 'course.room', 120, false);
  if (!Number.isInteger(course.talkCount) || course.talkCount < 1 || course.talkCount > 40) {
    raise_('INVALID_CONFIG', 'course.talkCount 必須是 1 到 40 的整數。');
  }

  const schedule = requireObject_(config.schedule, 'schedule');
  rejectUnknownKeys_(schedule, ['termStart', 'termEnd', 'weekday', 'startTime', 'endTime', 'excludedDates'], 'schedule');
  requireDate_(schedule.termStart, 'schedule.termStart');
  requireDate_(schedule.termEnd, 'schedule.termEnd');
  if (schedule.termStart > schedule.termEnd) raise_('INVALID_CONFIG', 'termStart 不得晚於 termEnd。');
  if (!Number.isInteger(schedule.weekday) || schedule.weekday < 0 || schedule.weekday > 6) raise_('INVALID_CONFIG', 'weekday 必須是 0 到 6 的整數。');
  requireTime_(schedule.startTime, 'schedule.startTime');
  requireTime_(schedule.endTime, 'schedule.endTime');
  if (schedule.startTime >= schedule.endTime) raise_('INVALID_CONFIG', 'startTime 必須早於 endTime。');
  if (!Array.isArray(schedule.excludedDates)) raise_('INVALID_CONFIG', 'excludedDates 必須是陣列。');
  const excluded = {};
  schedule.excludedDates.forEach(function (item, index) {
    const entry = requireObject_(item, 'excludedDates[' + index + ']');
    rejectUnknownKeys_(entry, ['date', 'reason'], 'excludedDates[' + index + ']');
    requireDate_(entry.date, 'excludedDates[' + index + '].date');
    requireText_(entry.reason, 'excludedDates[' + index + '].reason', 120, true);
    if (entry.date < schedule.termStart || entry.date > schedule.termEnd) raise_('INVALID_CONFIG', '排除日期必須位於學期範圍內。', { date: entry.date });
    if (excluded[entry.date]) raise_('INVALID_CONFIG', '排除日期不能重複。', { date: entry.date });
    excluded[entry.date] = true;
  });

  const features = requireObject_(config.features, 'features');
  rejectUnknownKeys_(features, ['speakerLibrary', 'tasks', 'backup'], 'features');
  ['speakerLibrary', 'tasks', 'backup'].forEach(function (key) {
    if (features[key] !== true) raise_('INVALID_CONFIG', '第一階段 features.' + key + ' 必須為 true。');
  });

  if (config.needsConfirmation === undefined) config.needsConfirmation = [];
  if (!Array.isArray(config.needsConfirmation)) raise_('INVALID_CONFIG', 'needsConfirmation 必須是陣列。');
  const confirmations = {};
  config.needsConfirmation.forEach(function (item) {
    requireText_(item, 'needsConfirmation[]', 300, true);
    if (confirmations[item]) raise_('INVALID_CONFIG', 'needsConfirmation 不能重複。');
    confirmations[item] = true;
  });
  if (config.needsConfirmation.length > 0) {
    raise_('CONFIG_NOT_CONFIRMED', '課程設定仍有待確認欄位，不能寫入正式 Settings。', {
      needsConfirmation: config.needsConfirmation
    });
  }

  const availableTalkDates = countAvailableTalkDates_(schedule, excluded);
  if (course.talkCount > availableTalkDates) {
    raise_('INSUFFICIENT_TALK_SLOTS', '演講場次超過學期內可用的固定上課日。', {
      requested: course.talkCount,
      available: availableTalkDates
    });
  }

  const serialized = JSON.stringify(config);
  if (serialized.length > TCM.maxCellChars) raise_('CONFIG_TOO_LARGE', '課程設定超過可安全寫入單一儲存格的大小。');
  return config;
}

function requireRole_(allowedRoles) {
  if (!isInstalled_()) raise_('NOT_INSTALLED', '請先從試算表選單執行 installSystem。');
  const email = requireActiveEmail_();
  const settings = readSettings_();
  const configuredDomain = settingValue_(settings, 'workspaceDomain');
  const emailDomain = workspaceDomainFromEmail_(email);
  if (!configuredDomain || emailDomain !== String(configuredDomain).toLowerCase()) {
    raise_('DOMAIN_DENIED', '目前帳號不屬於這套系統的 Workspace 網域。');
  }
  const user = findUserByEmail_(readRecords_('Users'), email);
  if (!user || !isActiveRecord_(user) || allowedRoles.indexOf(user.role) < 0) {
    raise_('FORBIDDEN', '目前帳號沒有執行這項操作的權限。');
  }
  return { email: email, role: user.role, domain: emailDomain };
}

function ensureSheet_(spreadsheet, sheetName, expectedHeaders) {
  let sheet = spreadsheet.getSheetByName(sheetName);
  if (!sheet) sheet = spreadsheet.insertSheet(sheetName);
  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, expectedHeaders.length).setValues([expectedHeaders]);
    sheet.setFrozenRows(1);
    return sheet;
  }
  const actualHeaders = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getDisplayValues()[0];
  if (!arraysEqual_(actualHeaders, expectedHeaders)) {
    raise_('HEADER_MISMATCH', sheetName + ' 的欄位不符合目前 schema；系統不會自動覆蓋既有資料。');
  }
  return sheet;
}

function readRecords_(sheetName) {
  const sheet = requireSheet_(sheetName);
  const headers = TCM.sheets[sheetName];
  return readRecordsFromSheet_(sheet, headers);
}

function readRecordsFromSheet_(sheet, headers) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  const values = sheet.getRange(2, 1, lastRow - 1, headers.length).getDisplayValues();
  return values.filter(function (row) {
    return row.some(function (cell) { return cell !== ''; });
  }).map(function (row) {
    const record = {};
    headers.forEach(function (header, index) {
      const value = decodeCell_(row[index]);
      record[header] = header === 'version' ? Number(value || 0) : value;
    });
    return record;
  });
}

function writeRecords_(sheetName, records) {
  const sheet = requireSheet_(sheetName);
  const headers = TCM.sheets[sheetName];
  if (!records.length) return;
  const keyField = sheetName === 'Settings' ? 'key' : 'id';
  const keyIndex = headers.indexOf(keyField);
  const existingRows = sheet.getLastRow() > 1
    ? sheet.getRange(2, 1, sheet.getLastRow() - 1, headers.length).getDisplayValues()
    : [];
  const rowByKey = Object.create(null);
  existingRows.forEach(function (row, index) {
    const key = decodeCell_(row[keyIndex]);
    if (!key) return;
    if (rowByKey[key]) raise_('DUPLICATE_STORAGE_KEY', sheetName + ' 含重複 key，已停止寫入。', { key: key });
    rowByKey[key] = index + 2;
  });
  records.forEach(function (record) {
    const key = String(record[keyField] || '');
    if (!key) raise_('MISSING_STORAGE_KEY', sheetName + ' 寫入資料缺少 ' + keyField + '。');
    const values = headers.map(function (header) { return encodeCell_(record[header]); });
    if (rowByKey[key]) {
      sheet.getRange(rowByKey[key], 1, 1, headers.length).setValues([values]);
    } else {
      sheet.appendRow(values);
      rowByKey[key] = sheet.getLastRow();
    }
  });
}

function readSettings_() {
  return readRecords_('Settings');
}

function writeSettings_(settings) {
  writeRecords_('Settings', settings);
}

function findSetting_(settings, key) {
  return settings.find(function (setting) { return setting.key === key; }) || null;
}

function settingValue_(settings, key) {
  const setting = findSetting_(settings, key);
  return setting ? parseSettingJson_(setting.valueJson, key) : null;
}

function parseSettingJson_(valueJson, key) {
  try {
    return JSON.parse(valueJson);
  } catch (error) {
    raise_('CORRUPT_SETTING', 'Settings.' + key + ' 不是有效的 JSON。');
  }
}

function upsertSetting_(settings, key, value, actorEmail, now) {
  const serialized = JSON.stringify(value);
  if (serialized.length > TCM.maxCellChars) raise_('SETTING_TOO_LARGE', 'Settings.' + key + ' 超過儲存格大小限制。');
  let setting = findSetting_(settings, key);
  if (!setting) {
    setting = { key: key, valueJson: serialized, updatedAt: now, updatedBy: actorEmail, version: 1 };
    settings.push(setting);
  } else {
    setting.valueJson = serialized;
    setting.updatedAt = now;
    setting.updatedBy = actorEmail;
    setting.version = Number(setting.version) + 1;
  }
  return setting;
}

function currentRevision_(settings) {
  const revision = settingValue_(settings, 'systemRevision');
  const number = Number(revision);
  if (!Number.isInteger(number) || number < 0) raise_('CORRUPT_REVISION', 'systemRevision 必須是非負整數。');
  return number;
}

function appendAudit_(entry) {
  const sheet = requireSheet_('AuditLog');
  const row = [
    Utilities.getUuid(),
    nowIso_(),
    entry.actorEmail,
    entry.action,
    entry.entityType,
    entry.entityId,
    truncateJson_(entry.before),
    truncateJson_(entry.after),
    entry.requestId
  ].map(encodeCell_);
  sheet.appendRow(row);
}

function appendTransaction_(transaction) {
  const sheet = requireSheet_('Transactions');
  const headers = TCM.sheets.Transactions;
  sheet.appendRow(headers.map(function (header) { return encodeCell_(transaction[header]); }));
}

function markTransactionCommitted_(transactionId) {
  const sheet = requireSheet_('Transactions');
  const rows = sheet.getLastRow() > 1
    ? sheet.getRange(2, 1, sheet.getLastRow() - 1, TCM.sheets.Transactions.length).getDisplayValues()
    : [];
  const index = rows.findIndex(function (row) { return decodeCell_(row[0]) === transactionId; });
  if (index < 0) raise_('TRANSACTION_MISSING', '找不到寫入交易紀錄，系統已停止後續寫入。');
  sheet.getRange(index + 2, 2).setValue('committed');
  sheet.getRange(index + 2, 12).setValue(nowIso_());
}

function recoverPendingTransactions_() {
  const transactions = readRecords_('Transactions').filter(function (transaction) {
    return transaction.status === 'prepared';
  });
  transactions.forEach(function (transaction) {
    const entity = transaction.entity;
    const before = parseTransactionJson_(transaction.beforeJson, transaction.id, 'beforeJson');
    const after = parseTransactionJson_(transaction.afterJson, transaction.id, 'afterJson');
    if (entity === 'settings') {
      const configSettings = readSettings_();
      const currentConfig = settingValue_(configSettings, transaction.entityId);
      if (!jsonValuesEquivalent_(currentConfig, after)) {
        if (!jsonValuesEquivalent_(currentConfig, before)) {
          raise_('TRANSACTION_RECOVERY_REQUIRED', '正式設定與未完成交易的 before/after 都不相符，已停止自動復原。', {
            transactionId: transaction.id,
            entityId: transaction.entityId
          });
        }
        const repairedSetting = upsertSetting_(configSettings, transaction.entityId, after, transaction.actorEmail, nowIso_());
        writeRecords_('Settings', [repairedSetting]);
      }
    } else {
      const sheetName = TCM.entitySheets[entity];
      if (!sheetName) raise_('TRANSACTION_CORRUPT', '交易紀錄含有未知 entity，需由 owner 人工復原。', { transactionId: transaction.id });
      const rows = readRecords_(sheetName);
      const rowIndex = rows.findIndex(function (row) { return row.id === transaction.entityId; });
      const current = rowIndex >= 0 ? rows[rowIndex] : null;

      if (!recordsEquivalent_(entity, current, after)) {
        if (!recordsEquivalent_(entity, current, before)) {
          raise_('TRANSACTION_RECOVERY_REQUIRED', '資料與未完成交易的 before/after 都不相符，已停止自動復原。', {
            transactionId: transaction.id,
            entity: entity,
            entityId: transaction.entityId
          });
        }
        writeRecords_(sheetName, [after]);
      }
    }

    const settings = readSettings_();
    const revision = currentRevision_(settings);
    const baseRevision = Number(transaction.baseRevision);
    const nextRevision = Number(transaction.nextRevision);
    if (revision === baseRevision) {
      const repairedRevision = upsertSetting_(settings, 'systemRevision', nextRevision, transaction.actorEmail, nowIso_());
      writeRecords_('Settings', [repairedRevision]);
    } else if (revision !== nextRevision) {
      raise_('TRANSACTION_REVISION_MISMATCH', '未完成交易的 revision 無法安全復原。', {
        transactionId: transaction.id,
        revision: revision,
        baseRevision: baseRevision,
        nextRevision: nextRevision
      });
    }

    if (!auditExists_(transaction.id)) {
      appendAudit_({
        actorEmail: transaction.actorEmail,
        action: String(transaction.action || '').toUpperCase(),
        entityType: entity,
        entityId: transaction.entityId,
        before: before,
        after: after,
        requestId: transaction.id
      });
    }
    markTransactionCommitted_(transaction.id);
  });
}

function parseTransactionJson_(json, transactionId, field) {
  try {
    return JSON.parse(json);
  } catch (error) {
    raise_('TRANSACTION_CORRUPT', '交易紀錄 JSON 損壞，需由 owner 人工復原。', { transactionId: transactionId, field: field });
  }
}

function recordsEquivalent_(entity, left, right) {
  if (left === null || right === null) return left === right;
  const headers = TCM.sheets[TCM.entitySheets[entity]];
  return headers.every(function (header) {
    return String(left[header] === undefined ? '' : left[header]) === String(right[header] === undefined ? '' : right[header]);
  });
}

function jsonValuesEquivalent_(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function auditExists_(requestId) {
  return readRecords_('AuditLog').some(function (entry) { return entry.requestId === requestId; });
}

function requireContainerSpreadsheet_() {
  const active = SpreadsheetApp.getActiveSpreadsheet();
  if (active) return active;
  const spreadsheetId = PropertiesService.getScriptProperties().getProperty(TCM.spreadsheetProperty);
  if (!spreadsheetId) raise_('NOT_INSTALLED', '找不到綁定試算表，請從 Sheet 選單重新執行 installSystem。');
  try {
    return SpreadsheetApp.openById(spreadsheetId);
  } catch (error) {
    raise_('SPREADSHEET_UNAVAILABLE', '無法開啟安裝時綁定的試算表，請由 owner 重新執行 installSystem。');
  }
}

function requireSheet_(sheetName) {
  const sheet = requireContainerSpreadsheet_().getSheetByName(sheetName);
  if (!sheet) raise_('NOT_INSTALLED', '缺少必要工作表：' + sheetName + '。');
  return sheet;
}

function isInstalled_() {
  try {
    const properties = PropertiesService.getScriptProperties();
    if (!properties.getProperty(TCM.installedMarkerProperty) || !properties.getProperty(TCM.spreadsheetProperty)) return false;
    const spreadsheet = requireContainerSpreadsheet_();
    return Object.keys(TCM.sheets).every(function (sheetName) { return Boolean(spreadsheet.getSheetByName(sheetName)); });
  } catch (error) {
    return false;
  }
}

function withSystemLock_(callback) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(TCM.lockTimeoutMs)) raise_('LOCK_TIMEOUT', '系統忙碌中，請稍後重試。');
  try {
    return callback();
  } finally {
    lock.releaseLock();
  }
}

function activeEmail_() {
  return String(Session.getActiveUser().getEmail() || '').trim().toLowerCase();
}

function requireActiveEmail_() {
  const email = activeEmail_();
  if (!email) raise_('EMAIL_UNAVAILABLE', '無法取得目前 Google Workspace 帳號，請確認部署與網域權限。');
  normalizeEmail_(email);
  return email;
}

function workspaceDomainFromEmail_(email, enforceWorkspace) {
  const normalized = normalizeEmail_(email);
  const domain = normalized.split('@')[1];
  if (enforceWorkspace !== false && ['gmail.com', 'googlemail.com'].indexOf(domain) >= 0) {
    raise_('WORKSPACE_REQUIRED', '第一階段只支援學校 Google Workspace 帳號。');
  }
  return domain;
}

function normalizeEmail_(email) {
  const normalized = String(email || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized) || normalized.length > 254) {
    raise_('INVALID_EMAIL', 'Email 格式不正確。');
  }
  return normalized;
}

function findUserByEmail_(users, email) {
  const normalized = String(email || '').trim().toLowerCase();
  return users.find(function (user) { return String(user.email).toLowerCase() === normalized; }) || null;
}

function isActiveRecord_(record) {
  return !record.deletedAt && record.status !== 'deleted' && record.status !== 'disabled';
}

function visibleRecords_(records, includeDeleted) {
  return records.filter(function (record) { return includeDeleted || !record.deletedAt; });
}

function indexIds_(records) {
  const result = Object.create(null);
  records.filter(isActiveRecord_).forEach(function (record) { result[record.id] = true; });
  return result;
}

function countAvailableTalkDates_(schedule, excludedByDate) {
  const start = new Date(schedule.termStart + 'T00:00:00Z');
  const end = new Date(schedule.termEnd + 'T00:00:00Z');
  let count = 0;
  for (let cursor = new Date(start.getTime()); cursor.getTime() <= end.getTime(); cursor.setUTCDate(cursor.getUTCDate() + 1)) {
    const iso = cursor.toISOString().slice(0, 10);
    if (cursor.getUTCDay() === schedule.weekday && !excludedByDate[iso]) count += 1;
  }
  return count;
}

function requireBaseRevision_(provided, actual) {
  if (!Number.isInteger(provided) || provided < 0) raise_('INVALID_REVISION', 'baseRevision 必須是非負整數。');
  if (provided !== actual) raise_('REVISION_CONFLICT', '資料已被其他人更新，請重新整理後再試。', { expected: provided, actual: actual });
}

function requireRowVersion_(provided, actual, index, id) {
  if (provided !== actual) raise_('VERSION_CONFLICT', '資料列版本衝突，請重新整理後再試。', { index: index, id: id, expected: provided, actual: actual });
}

function requireObject_(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) raise_('INVALID_OBJECT', label + ' 必須是物件。');
  return value;
}

function rejectUnknownKeys_(object, allowedKeys, label) {
  Object.keys(object).forEach(function (key) {
    if (allowedKeys.indexOf(key) < 0) raise_('UNKNOWN_FIELD', label + ' 含有不支援的欄位：' + key + '。');
  });
}

function requireId_(value, label) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9._:-]{1,100}$/.test(value)) raise_('INVALID_ID', label + ' 格式不正確。');
}

function requireText_(value, label, maxLength, required) {
  if (typeof value !== 'string') raise_('INVALID_FIELD', label + ' 必須是字串。');
  if (required && !value.trim()) raise_('REQUIRED_FIELD', label + ' 為必填。');
  if (value.length > maxLength) raise_('FIELD_TOO_LONG', label + ' 超過長度限制。');
}

function requireDate_(value, label) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) raise_('INVALID_DATE', label + ' 必須是 YYYY-MM-DD。');
  const date = new Date(value + 'T00:00:00Z');
  if (isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) raise_('INVALID_DATE', label + ' 不是有效日期。');
}

function requireTime_(value, label) {
  if (typeof value !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) raise_('INVALID_TIME', label + ' 必須是 HH:MM。');
}

function encodeCell_(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  const text = String(value);
  if (text.length > TCM.maxCellChars) raise_('CELL_TOO_LARGE', '資料超過單一儲存格的安全大小。');
  // Use a zero-width prefix instead of a quote. Sheets may consume a leading
  // quote as an input delimiter, which makes lossless round-tripping ambiguous.
  if (/^\u200B|^[\s]*[=+\-@]/.test(text)) return '\u200B' + text;
  return text;
}

function decodeCell_(value) {
  const text = String(value === null || value === undefined ? '' : value);
  if (/^\u200B(?:\u200B|[\s]*[=+\-@])/.test(text)) return text.slice(1);
  return text;
}

function truncateJson_(value) {
  const json = JSON.stringify(value === undefined ? null : value);
  return json.length <= TCM.maxCellChars ? json : JSON.stringify({ truncated: true });
}

function clone_(value) {
  return JSON.parse(JSON.stringify(value));
}

function arraysEqual_(left, right) {
  return left.length === right.length && left.every(function (value, index) { return value === right[index]; });
}

function nowIso_() {
  return new Date().toISOString();
}

function raise_(code, message, details) {
  throw new Error(JSON.stringify({ code: code, message: message, details: details || null }));
}
