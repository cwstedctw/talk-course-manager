(function () {
  "use strict";

  const FIELD_PATHS = {
    schoolName: "organization.schoolName",
    unitName: "organization.unitName",
    timeZone: "organization.timeZone",
    courseName: "course.name",
    semester: "course.semester",
    room: "course.room",
    talkCount: "course.talkCount",
    termStart: "schedule.termStart",
    termEnd: "schedule.termEnd",
    weekday: "schedule.weekday",
    startTime: "schedule.startTime",
    endTime: "schedule.endTime"
  };

  const REQUIRED_FIELD_IDS = [
    "school-name",
    "unit-name",
    "course-name",
    "semester",
    "time-zone",
    "term-start",
    "term-end",
    "weekday",
    "start-time",
    "end-time",
    "talk-count"
  ];

  const PATH_LABELS = {
    "organization.schoolName": "學校名稱",
    "organization.unitName": "開課單位",
    "organization.timeZone": "時區",
    "course.name": "課程名稱",
    "course.semester": "學期",
    "course.room": "教室",
    "course.talkCount": "演講場次",
    "schedule.termStart": "學期開始日",
    "schedule.termEnd": "學期結束日",
    "schedule.weekday": "每週上課日",
    "schedule.startTime": "開始時間",
    "schedule.endTime": "結束時間",
    "schedule.excludedDates": "排除日期"
  };

  const WEEKDAY_LABELS = ["星期日", "星期一", "星期二", "星期三", "星期四", "星期五", "星期六"];

  const elements = {
    form: document.querySelector("#setup-form"),
    jsonFile: document.querySelector("#json-file"),
    jsonInput: document.querySelector("#json-input"),
    importButton: document.querySelector("#import-json"),
    fileName: document.querySelector("#file-name"),
    importStatus: document.querySelector("#import-status"),
    confirmationFields: document.querySelector("#confirmation-fields"),
    exclusionList: document.querySelector("#exclusion-list"),
    exclusionTemplate: document.querySelector("#exclusion-template"),
    emptyExclusions: document.querySelector("#empty-exclusions"),
    addExclusion: document.querySelector("#add-exclusion"),
    validationSummary: document.querySelector("#validation-summary"),
    previewBody: document.querySelector("#preview-body"),
    assignedStat: document.querySelector("#stat-assigned"),
    availableStat: document.querySelector("#stat-available"),
    excludedStat: document.querySelector("#stat-excluded"),
    confirmConfig: document.querySelector("#confirm-config"),
    exportButton: document.querySelector("#export-config"),
    exportHint: document.querySelector("#export-hint"),
    progressText: document.querySelector("#progress-text"),
    progressCount: document.querySelector("#progress-count"),
    progressBar: document.querySelector("#progress-bar")
  };

  let importedNeedsConfirmation = [];
  let latestResult = { config: null, errors: [], warnings: [], schedule: null };
  let externalCore = null;
  let renderTimer = null;

  ensureDevelopmentStyles();
  init();

  function ensureDevelopmentStyles() {
    const style = document.querySelector("#setup-styles");
    if (!style || !style.textContent.includes("__SETUP_CSS__")) return;
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = "./styles.css";
    document.head.append(link);
  }

  function init() {
    bindEvents();
    void loadCoreApi();
    renderAll();
  }

  function bindEvents() {
    elements.form.addEventListener("input", scheduleRender);
    elements.form.addEventListener("change", scheduleRender);
    elements.addExclusion.addEventListener("click", function () {
      addExclusionRow();
      scheduleRender();
    });
    elements.exclusionList.addEventListener("click", function (event) {
      const button = event.target.closest(".remove-exclusion");
      if (!button) return;
      button.closest(".exclusion-row").remove();
      updateExclusionEmptyState();
      scheduleRender();
    });
    elements.jsonFile.addEventListener("change", importFile);
    elements.importButton.addEventListener("click", importTextarea);
    elements.confirmConfig.addEventListener("change", renderAll);
    elements.exportButton.addEventListener("click", exportConfig);
  }

  async function loadCoreApi() {
    if (globalThis.TalkCourseManagerCore) {
      externalCore = globalThis.TalkCourseManagerCore;
      renderAll();
      return;
    }

    if (window.location.protocol === "file:") return;

    try {
      // 共用 core 介面：validateCourseConfigSemantics(config) 與 buildCourseSchedule(config)。
      // 在 core 尚未建置或使用 file:// 時，設定精靈會使用下方等價的本機實作。
      const module = await import("../core/index.mjs");
      if (typeof module.validateCourseConfigSemantics === "function" || typeof module.buildCourseSchedule === "function") {
        externalCore = module;
        renderAll();
      }
    } catch (_error) {
      // Alpha 階段允許 core 尚未存在；靜態設定頁仍須能獨立運作。
    }
  }

  function scheduleRender(event) {
    if (event && event.target === elements.confirmConfig) return;
    window.clearTimeout(renderTimer);
    elements.confirmConfig.checked = false;
    renderTimer = window.setTimeout(renderAll, 80);
  }

  async function importFile(event) {
    const file = event.target.files && event.target.files[0];
    if (!file) return;

    elements.fileName.textContent = file.name;
    try {
      const text = await file.text();
      elements.jsonInput.value = text;
      importJsonText(text);
    } catch (error) {
      showImportStatus("讀取檔案失敗：" + error.message, "error");
    }
  }

  function importTextarea() {
    const text = elements.jsonInput.value.trim();
    if (!text) {
      showImportStatus("請先選擇 JSON 檔案，或貼上設定內容。", "error");
      return;
    }
    importJsonText(text);
  }

  function importJsonText(text) {
    try {
      const parsed = JSON.parse(text);
      const config = unwrapImportedConfig(parsed);
      assertSafeConfigShape(config);
      fillForm(config);
      importedNeedsConfirmation = Array.isArray(config.needsConfirmation)
        ? Array.from(new Set(config.needsConfirmation.filter(function (item) { return typeof item === "string"; })))
        : [];
      renderConfirmationFields();
      showImportStatus("已匯入設定草稿。請逐項核對表單與週曆，匯入不代表資料已確認。", "success");
      elements.confirmConfig.checked = false;
      renderAll();
      document.querySelector("#course-title").scrollIntoView({ behavior: "smooth", block: "start" });
    } catch (error) {
      showImportStatus("無法匯入：" + error.message, "error");
    }
  }

  function unwrapImportedConfig(parsed) {
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("JSON 最外層必須是物件。");
    }
    if (parsed.config && typeof parsed.config === "object" && !Array.isArray(parsed.config)) {
      return parsed.config;
    }
    return parsed;
  }

  function assertSafeConfigShape(config) {
    if (config.schemaVersion !== undefined && config.schemaVersion !== 1) {
      throw new Error("目前只支援 schemaVersion 1。");
    }
    const forbiddenKeys = ["sheetId", "spreadsheetId", "deploymentId", "scriptId", "apiKey", "oauthToken"];
    const found = [];

    walkObject(config, function (key) {
      if (forbiddenKeys.some(function (item) { return item.toLowerCase() === key.toLowerCase(); })) found.push(key);
    });

    if (found.length) {
      throw new Error("設定檔含有不應匯入的部署識別或憑證欄位：" + Array.from(new Set(found)).join("、") + "。");
    }
  }

  function walkObject(value, callback) {
    if (!value || typeof value !== "object") return;
    Object.keys(value).forEach(function (key) {
      callback(key);
      walkObject(value[key], callback);
    });
  }

  function fillForm(config) {
    const values = {
      "school-name": config.organization && config.organization.schoolName,
      "unit-name": config.organization && config.organization.unitName,
      "time-zone": config.organization && config.organization.timeZone,
      "course-name": config.course && config.course.name,
      semester: config.course && config.course.semester,
      room: config.course && config.course.room,
      "talk-count": config.course && config.course.talkCount,
      "term-start": config.schedule && config.schedule.termStart,
      "term-end": config.schedule && config.schedule.termEnd,
      weekday: config.schedule && config.schedule.weekday,
      "start-time": config.schedule && config.schedule.startTime,
      "end-time": config.schedule && config.schedule.endTime
    };

    Object.keys(values).forEach(function (id) {
      const element = document.getElementById(id);
      if (values[id] !== undefined && values[id] !== null) element.value = String(values[id]);
      else if (id !== "time-zone") element.value = "";
    });

    elements.exclusionList.replaceChildren();
    const exclusions = config.schedule && Array.isArray(config.schedule.excludedDates)
      ? config.schedule.excludedDates
      : [];
    exclusions.forEach(function (item) {
      addExclusionRow(item);
    });
    updateExclusionEmptyState();
  }

  function showImportStatus(message, type) {
    elements.importStatus.hidden = false;
    elements.importStatus.className = "inline-status " + (type === "success" ? "is-success" : "is-error");
    elements.importStatus.textContent = message;
  }

  function renderConfirmationFields() {
    if (!importedNeedsConfirmation.length) {
      elements.confirmationFields.hidden = true;
      elements.confirmationFields.replaceChildren();
      return;
    }

    const title = document.createElement("strong");
    title.textContent = "AI 草稿標示了 " + importedNeedsConfirmation.length + " 個待確認欄位";
    const description = document.createElement("span");
    description.textContent = "請在表單中補齊或核對：";
    const list = document.createElement("ul");
    importedNeedsConfirmation.forEach(function (path) {
      const item = document.createElement("li");
      item.textContent = PATH_LABELS[path] ? PATH_LABELS[path] + "（" + path + "）" : path;
      list.append(item);
    });
    elements.confirmationFields.replaceChildren(title, description, list);
    elements.confirmationFields.hidden = false;
  }

  function addExclusionRow(value) {
    const fragment = elements.exclusionTemplate.content.cloneNode(true);
    const row = fragment.querySelector(".exclusion-row");
    row.querySelector(".excluded-date").value = value && value.date ? value.date : "";
    row.querySelector(".excluded-reason").value = value && value.reason ? value.reason : "";
    elements.exclusionList.append(fragment);
    updateExclusionEmptyState();
  }

  function updateExclusionEmptyState() {
    elements.emptyExclusions.hidden = elements.exclusionList.children.length > 0;
  }

  function collectConfig() {
    const weekdayValue = document.querySelector("#weekday").value;
    const talkCountValue = document.querySelector("#talk-count").value;
    const exclusions = Array.from(elements.exclusionList.querySelectorAll(".exclusion-row")).map(function (row) {
      return {
        date: row.querySelector(".excluded-date").value,
        reason: row.querySelector(".excluded-reason").value.trim()
      };
    });

    return {
      schemaVersion: 1,
      organization: {
        schoolName: document.querySelector("#school-name").value.trim(),
        unitName: document.querySelector("#unit-name").value.trim(),
        timeZone: document.querySelector("#time-zone").value.trim()
      },
      course: {
        name: document.querySelector("#course-name").value.trim(),
        semester: document.querySelector("#semester").value.trim(),
        room: document.querySelector("#room").value.trim(),
        talkCount: talkCountValue === "" ? null : Number(talkCountValue)
      },
      schedule: {
        termStart: document.querySelector("#term-start").value,
        termEnd: document.querySelector("#term-end").value,
        weekday: weekdayValue === "" ? null : Number(weekdayValue),
        startTime: document.querySelector("#start-time").value,
        endTime: document.querySelector("#end-time").value,
        excludedDates: exclusions
      },
      features: {
        speakerLibrary: true,
        tasks: true,
        backup: true
      },
      needsConfirmation: importedNeedsConfirmation.slice()
    };
  }

  function renderAll() {
    const config = collectConfig();
    const localValidation = validateCourseConfig(config);
    const coreValidation = runExternalValidation(config);
    const errors = mergeErrors(localValidation.errors, coreValidation.errors);
    const schedule = buildCourseSchedule(config);

    if (schedule && schedule.error) {
      errors.push({ path: "schedule", message: schedule.error });
    }
    if (!externalCore && schedule && Number.isInteger(config.course.talkCount) && schedule.availableCount < config.course.talkCount) {
      errors.push({
        path: "course.talkCount",
        message: "只有 " + schedule.availableCount + " 個可用上課日，不足以安排 " + config.course.talkCount + " 場演講。"
      });
    }

    latestResult = {
      config: config,
      errors: dedupeErrors(errors),
      warnings: mergeErrors(
        mergeErrors(localValidation.warnings || [], coreValidation.warnings || []),
        schedule && schedule.warnings || []
      ),
      schedule: schedule
    };
    applyInvalidStates(latestResult.errors);
    renderValidation(latestResult);
    renderSchedule(schedule);
    renderProgress(latestResult);
    renderExportState(latestResult);
  }

  function runExternalValidation(config) {
    if (!externalCore || typeof externalCore.validateCourseConfigSemantics !== "function") return { errors: [], warnings: [] };
    try {
      const result = externalCore.validateCourseConfigSemantics(config);
      if (Array.isArray(result)) return { errors: normalizeErrors(result), warnings: [] };
      if (result && Array.isArray(result.errors)) {
        return {
          errors: normalizeErrors(result.errors),
          warnings: normalizeErrors(result.warnings || [])
        };
      }
      return { errors: [], warnings: [] };
    } catch (error) {
      return { errors: [{ path: "core", message: "共用驗證模組無法完成：" + error.message }], warnings: [] };
    }
  }

  function buildCourseSchedule(config) {
    if (externalCore && typeof externalCore.buildCourseSchedule === "function") {
      try {
        const result = externalCore.buildCourseSchedule(config, { makeupDates: [] });
        if (result && Array.isArray(result.weeklyDates)) return normalizeCoreSchedule(result, config);
      } catch (_error) {
        // 外部排程模組失敗時仍以本機等價實作顯示預覽。
      }
    }
    return buildCourseScheduleFallback(config);
  }

  function validateCourseConfig(config) {
    const errors = [];
    const warnings = [];
    requireText(errors, config.organization.schoolName, "organization.schoolName", 120);
    requireText(errors, config.organization.unitName, "organization.unitName", 120);
    requireText(errors, config.organization.timeZone, "organization.timeZone");
    requireText(errors, config.course.name, "course.name", 160);
    requireText(errors, config.course.semester, "course.semester", 40);

    if (config.course.room.length > 120) {
      errors.push({ path: "course.room", message: "教室不可超過 120 個字。" });
    }
    if (!Number.isInteger(config.course.talkCount) || config.course.talkCount < 1 || config.course.talkCount > 40) {
      errors.push({ path: "course.talkCount", message: "演講場次須為 1 到 40 的整數。" });
    }

    const start = parseIsoDate(config.schedule.termStart);
    const end = parseIsoDate(config.schedule.termEnd);
    if (!start) errors.push({ path: "schedule.termStart", message: "請填寫有效的學期開始日。" });
    if (!end) errors.push({ path: "schedule.termEnd", message: "請填寫有效的學期結束日。" });
    if (start && end && start > end) {
      errors.push({ path: "schedule.termEnd", message: "學期結束日不可早於開始日。" });
    }
    if (!Number.isInteger(config.schedule.weekday) || config.schedule.weekday < 0 || config.schedule.weekday > 6) {
      errors.push({ path: "schedule.weekday", message: "請選擇每週上課日。" });
    }
    if (!isValidTime(config.schedule.startTime)) {
      errors.push({ path: "schedule.startTime", message: "請填寫有效的開始時間。" });
    }
    if (!isValidTime(config.schedule.endTime)) {
      errors.push({ path: "schedule.endTime", message: "請填寫有效的結束時間。" });
    }
    if (isValidTime(config.schedule.startTime) && isValidTime(config.schedule.endTime)
      && config.schedule.startTime >= config.schedule.endTime) {
      errors.push({ path: "schedule.endTime", message: "結束時間必須晚於開始時間。" });
    }

    const seenDates = new Set();
    config.schedule.excludedDates.forEach(function (item, index) {
      const date = parseIsoDate(item.date);
      const path = "schedule.excludedDates[" + index + "]";
      if (!date) errors.push({ path: path + ".date", message: "第 " + (index + 1) + " 個排除日期無效。" });
      if (!item.reason) errors.push({ path: path + ".reason", message: "第 " + (index + 1) + " 個排除日期請填寫原因。" });
      if (item.reason.length > 120) errors.push({ path: path + ".reason", message: "排除原因不可超過 120 個字。" });
      if (item.date && seenDates.has(item.date)) errors.push({ path: path + ".date", message: "排除日期 " + item.date + " 重複。" });
      seenDates.add(item.date);
      if (date && start && end && (date < start || date > end)) {
        errors.push({ path: path + ".date", message: "排除日期 " + item.date + " 不在學期起訖範圍內。" });
      }
      if (date && Number.isInteger(config.schedule.weekday) && date.getDay() !== config.schedule.weekday) {
        warnings.push({ path: path + ".date", message: "排除日期 " + item.date + " 不是設定的上課星期，不會影響排程。" });
      }
    });

    return { valid: errors.length === 0, errors: errors, warnings: warnings };
  }

  function requireText(errors, value, path, maxLength) {
    const label = PATH_LABELS[path] || path;
    if (!value) errors.push({ path: path, message: "請填寫" + label + "。" });
    else if (maxLength && value.length > maxLength) errors.push({ path: path, message: label + "不可超過 " + maxLength + " 個字。" });
  }

  function buildCourseScheduleFallback(config) {
    const start = parseIsoDate(config.schedule.termStart);
    const end = parseIsoDate(config.schedule.termEnd);
    const weekday = config.schedule.weekday;
    if (!start || !end || start > end || !Number.isInteger(weekday) || weekday < 0 || weekday > 6) {
      return null;
    }

    const exclusionMap = new Map();
    config.schedule.excludedDates.forEach(function (item) {
      if (parseIsoDate(item.date) && !exclusionMap.has(item.date)) exclusionMap.set(item.date, item.reason);
    });

    const cursor = new Date(start.getTime());
    const offset = (weekday - cursor.getDay() + 7) % 7;
    cursor.setDate(cursor.getDate() + offset);

    const rows = [];
    let availableIndex = 0;
    while (cursor <= end) {
      const iso = formatIsoDate(cursor);
      const reason = exclusionMap.get(iso) || "";
      const excluded = exclusionMap.has(iso);
      let type = "available";
      let talkNumber = null;
      if (excluded) type = "excluded";
      else {
        availableIndex += 1;
        if (Number.isInteger(config.course.talkCount) && availableIndex <= config.course.talkCount) {
          type = "talk";
          talkNumber = availableIndex;
        }
      }
      rows.push({
        date: iso,
        weekday: weekday,
        type: type,
        talkNumber: talkNumber,
        reason: reason
      });
      cursor.setDate(cursor.getDate() + 7);
    }

    return {
      rows: rows,
      availableCount: availableIndex,
      assignedCount: Number.isInteger(config.course.talkCount) ? Math.min(config.course.talkCount, availableIndex) : 0,
      excludedCount: rows.filter(function (row) { return row.type === "excluded"; }).length,
      warnings: []
    };
  }

  function normalizeCoreSchedule(result, config) {
    const excludedMap = new Map((result.excludedDates || []).map(function (item) {
      return [item.date, item.reason || ""];
    }));
    const talkMap = new Map((result.talkSlots || []).map(function (item) {
      return [item.date, item.sequence];
    }));
    const availableSet = new Set((result.availableDates || []).map(function (item) { return item.date; }));
    const rows = (result.weeklyDates || []).map(function (date) {
      if (excludedMap.has(date)) {
        return {
          date: date,
          weekday: config.schedule.weekday,
          type: "excluded",
          talkNumber: null,
          reason: excludedMap.get(date)
        };
      }
      return {
        date: date,
        weekday: config.schedule.weekday,
        type: talkMap.has(date) ? "talk" : "available",
        talkNumber: talkMap.get(date) || null,
        reason: ""
      };
    });

    return {
      rows: rows,
      availableCount: availableSet.size,
      assignedCount: (result.talkSlots || []).length,
      excludedCount: (result.excludedDates || []).length,
      warnings: normalizeErrors(result.warnings || [])
    };
  }

  function renderValidation(result) {
    const summary = elements.validationSummary;
    summary.className = "validation-summary";
    summary.replaceChildren();

    const title = document.createElement("strong");
    if (!result.errors.length) {
      summary.classList.add("is-valid");
      title.textContent = "設定通過驗證";
      const text = document.createElement("p");
      text.textContent = result.warnings.length
        ? "設定可繼續，但請留意下列提醒。"
        : "請核對下方週曆，再勾選人工確認。";
      summary.append(title, text);
      if (result.warnings.length) summary.append(buildIssueList(result.warnings, 6));
      return;
    }

    summary.classList.add("is-invalid");
    title.textContent = "還有 " + result.errors.length + " 個項目需要處理";
    const list = document.createElement("ul");
    result.errors.slice(0, 10).forEach(function (error) {
      const item = document.createElement("li");
      item.textContent = error.message;
      list.append(item);
    });
    if (result.errors.length > 10) {
      const item = document.createElement("li");
      item.textContent = "另有 " + (result.errors.length - 10) + " 個項目，請繼續檢查表單。";
      list.append(item);
    }
    summary.append(title, list);
    if (result.warnings.length) {
      const warningTitle = document.createElement("strong");
      warningTitle.className = "warning-title";
      warningTitle.textContent = "另有 " + result.warnings.length + " 個提醒";
      summary.append(warningTitle, buildIssueList(result.warnings, 6));
    }
  }

  function buildIssueList(issues, limit) {
    const list = document.createElement("ul");
    issues.slice(0, limit).forEach(function (issue) {
      const item = document.createElement("li");
      item.textContent = issue.message;
      list.append(item);
    });
    if (issues.length > limit) {
      const item = document.createElement("li");
      item.textContent = "另有 " + (issues.length - limit) + " 個提醒。";
      list.append(item);
    }
    return list;
  }

  function renderSchedule(schedule) {
    if (!schedule || !Array.isArray(schedule.rows) || !schedule.rows.length) {
      const row = document.createElement("tr");
      row.className = "placeholder-row";
      const cell = document.createElement("td");
      cell.colSpan = 4;
      cell.textContent = "填寫學期與上課時間後，週曆會顯示在這裡。";
      row.append(cell);
      elements.previewBody.replaceChildren(row);
      elements.assignedStat.textContent = "—";
      elements.availableStat.textContent = "—";
      elements.excludedStat.textContent = "—";
      return;
    }

    const fragment = document.createDocumentFragment();
    schedule.rows.forEach(function (item) {
      const row = document.createElement("tr");
      if (item.type === "excluded") row.className = "is-excluded-row";

      const dateCell = document.createElement("td");
      dateCell.textContent = formatDisplayDate(item.date, item.weekday);
      const timeCell = document.createElement("td");
      timeCell.textContent = document.querySelector("#start-time").value && document.querySelector("#end-time").value
        ? document.querySelector("#start-time").value + "–" + document.querySelector("#end-time").value
        : "—";
      const typeCell = document.createElement("td");
      const pill = document.createElement("span");
      pill.className = "status-pill " + item.type;
      if (item.type === "talk") pill.textContent = "演講第 " + item.talkNumber + " 場";
      else if (item.type === "excluded") pill.textContent = "已排除";
      else pill.textContent = "可用上課日";
      typeCell.append(pill);
      const noteCell = document.createElement("td");
      noteCell.textContent = item.reason || "—";

      row.append(dateCell, timeCell, typeCell, noteCell);
      fragment.append(row);
    });
    elements.previewBody.replaceChildren(fragment);
    elements.assignedStat.textContent = String(schedule.assignedCount ?? schedule.rows.filter(function (row) { return row.type === "talk"; }).length);
    elements.availableStat.textContent = String(schedule.availableCount ?? schedule.rows.filter(function (row) { return row.type !== "excluded"; }).length);
    elements.excludedStat.textContent = String(schedule.excludedCount ?? schedule.rows.filter(function (row) { return row.type === "excluded"; }).length);
  }

  function renderProgress(result) {
    const completed = REQUIRED_FIELD_IDS.filter(function (id) {
      return Boolean(document.getElementById(id).value);
    }).length;
    const percent = Math.round((completed / REQUIRED_FIELD_IDS.length) * 100);
    elements.progressText.textContent = percent + "%";
    elements.progressCount.textContent = completed + " / " + REQUIRED_FIELD_IDS.length + " 個必要欄位";
    elements.progressBar.style.width = percent + "%";

    const courseDone = ["school-name", "unit-name", "course-name", "semester", "time-zone"].every(hasValue);
    const scheduleDone = ["term-start", "term-end", "weekday", "start-time", "end-time", "talk-count"].every(hasValue);
    setProgressState("course", courseDone);
    setProgressState("schedule", scheduleDone);
    setProgressState("validation", result.errors.length === 0);
    setProgressState("confirmation", result.errors.length === 0 && elements.confirmConfig.checked);
  }

  function renderExportState(result) {
    const valid = result.errors.length === 0;
    const confirmed = elements.confirmConfig.checked;
    elements.exportButton.disabled = !(valid && confirmed);
    if (!valid) elements.exportHint.textContent = "請先完成欄位並通過驗證。";
    else if (!confirmed) elements.exportHint.textContent = "請勾選人工確認。";
    else elements.exportHint.textContent = "設定已可匯出；這個動作不會部署系統。";
  }

  function exportConfig() {
    renderAll();
    if (latestResult.errors.length || !elements.confirmConfig.checked) return;

    const confirmedConfig = JSON.parse(JSON.stringify(latestResult.config));
    confirmedConfig.needsConfirmation = [];
    const blob = new Blob([JSON.stringify(confirmedConfig, null, 2) + "\n"], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "course.config.json";
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(function () { URL.revokeObjectURL(url); }, 0);
    elements.exportHint.textContent = "已產生 course.config.json。請妥善保存並進入後續人工安裝流程。";
  }

  function applyInvalidStates(errors) {
    document.querySelectorAll("[aria-invalid='true']").forEach(function (element) {
      element.removeAttribute("aria-invalid");
    });

    errors.forEach(function (error) {
      const directField = Object.keys(FIELD_PATHS).find(function (name) { return FIELD_PATHS[name] === error.path; });
      if (directField) {
        const element = elements.form.elements[directField];
        if (element) element.setAttribute("aria-invalid", "true");
      }
      const match = /^schedule\.excludedDates\[(\d+)]\.(date|reason)$/.exec(error.path || "");
      if (match) {
        const row = elements.exclusionList.children[Number(match[1])];
        if (row) row.querySelector(match[2] === "date" ? ".excluded-date" : ".excluded-reason").setAttribute("aria-invalid", "true");
      }
    });
  }

  function hasValue(id) {
    return Boolean(document.getElementById(id).value);
  }

  function setProgressState(name, done) {
    const item = document.querySelector("[data-progress='" + name + "']");
    item.classList.toggle("is-done", done);
  }

  function parseIsoDate(value) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value || "");
    if (!match) return null;
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const date = new Date(year, month - 1, day, 12, 0, 0, 0);
    if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null;
    return date;
  }

  function formatIsoDate(date) {
    return [date.getFullYear(), pad2(date.getMonth() + 1), pad2(date.getDate())].join("-");
  }

  function formatDisplayDate(iso, weekday) {
    const date = parseIsoDate(iso);
    if (!date) return iso;
    return date.getFullYear() + "/" + pad2(date.getMonth() + 1) + "/" + pad2(date.getDate()) + "（" + (WEEKDAY_LABELS[weekday] || "").replace("星期", "週") + "）";
  }

  function pad2(value) {
    return String(value).padStart(2, "0");
  }

  function isValidTime(value) {
    return /^([01]\d|2[0-3]):[0-5]\d$/.test(value || "");
  }

  function normalizeErrors(errors) {
    return errors.map(function (error) {
      if (typeof error === "string") return { path: "core", message: error };
      return {
        path: error.path || error.instancePath || "core",
        message: error.message || "設定不符合規格。"
      };
    });
  }

  function mergeErrors(first, second) {
    const preferred = first || [];
    const preferredPaths = new Set(preferred.map(function (error) { return String(error.path || ""); }));
    const remaining = (second || []).filter(function (error) {
      return !preferredPaths.has(String(error.path || ""));
    });
    return dedupeErrors(preferred.concat(remaining));
  }

  function dedupeErrors(errors) {
    const seen = new Set();
    return errors.filter(function (error) {
      const key = String(error.path) + "|" + String(error.message);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }
})();
