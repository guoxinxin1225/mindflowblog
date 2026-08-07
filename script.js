"use strict";

const APP_KEY = "heguang-blog:v1";
const SETTINGS_KEY = "heguang-blog:site-settings-v2";
const COPY_KEY = "heguang-blog:copy-v2";
const MEDIA_DB_NAME = "heguang-blog-media";
const MEDIA_STORE_NAME = "photos";
const MEDIA_DB_VERSION = 1;
const MAX_PHOTO_BYTES = 30 * 1024 * 1024;
const DEFAULT_SETTINGS = Object.freeze({
  style: "maia",
  baseColor: "zinc",
  appearance: "dark",
  accent: "orange",
  radius: "md",
  fontScale: "md",
  columns: "4",
  density: "default",
  sidebarWidth: "default",
  imageRatio: "landscape",
  cardVariant: "outline",
  buttonVariant: "default",
  brandTitleSize: 17,
  eyebrowTitleSize: 17,
  heroTitleSize: 41,
  cardTitleSize: 17,
  articleTitleSize: 35,
  contentH2Size: 24,
  contentH3Size: 19,
  sidebarTitleSize: 13,
  panelTitleSize: 18,
  showStats: true,
  showExcerpts: true,
  stickyHeader: true
});
const DEFAULT_COPY = Object.freeze({
  brandName: "和光",
  profileName: "和光 evolution",
  profileBio: "微博文章与生活记录归档",
  eyebrow: "PERSONAL ARCHIVE · 2011—2026",
  heroTitle: "心 流 号 空 间 站",
  heroCopy: "我的时空旅行日志"
});
const SETTING_OPTIONS = Object.freeze({
  style: new Set(["vega", "nova", "maia", "lyra", "mira"]),
  baseColor: new Set(["neutral", "stone", "zinc", "mauve", "olive", "mist", "taupe"]),
  appearance: new Set(["system", "light", "dark"]),
  accent: new Set(["neutral", "blue", "green", "orange", "rose", "violet"]),
  radius: new Set(["none", "sm", "md", "lg", "full"]),
  fontScale: new Set(["sm", "md", "lg"]),
  columns: new Set(["2", "3", "4"]),
  density: new Set(["compact", "default", "comfortable"]),
  sidebarWidth: new Set(["compact", "default", "wide"]),
  imageRatio: new Set(["landscape", "square", "portrait"]),
  cardVariant: new Set(["outline", "elevated", "flat"]),
  buttonVariant: new Set(["default", "outline", "secondary", "ghost"])
});
const SETTING_RANGES = Object.freeze({
  brandTitleSize: [11, 24],
  eyebrowTitleSize: [8, 18],
  heroTitleSize: [28, 84],
  cardTitleSize: [12, 28],
  articleTitleSize: [28, 76],
  contentH2Size: [18, 40],
  contentH3Size: [16, 32],
  sidebarTitleSize: [10, 22],
  panelTitleSize: [14, 30]
});
const SETTING_SIZE_VARIABLES = Object.freeze({
  brandTitleSize: "--brand-title-size",
  eyebrowTitleSize: "--eyebrow-title-size",
  heroTitleSize: "--hero-title-size",
  cardTitleSize: "--card-title-size",
  articleTitleSize: "--article-title-size",
  contentH2Size: "--content-h2-size",
  contentH3Size: "--content-h3-size",
  sidebarTitleSize: "--sidebar-title-size",
  panelTitleSize: "--panel-title-size"
});
const VALID_FILTERS = new Set(["all", "favorites", "images", "trash"]);
const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

const importedArticles = [
  ...(Array.isArray(window.BLOG_ARTICLES) ? window.BLOG_ARTICLES : []),
  ...(Array.isArray(window.BLOG_DIARIES_2010) ? window.BLOG_DIARIES_2010 : []),
  ...(Array.isArray(window.BLOG_DIARIES_2022) ? window.BLOG_DIARIES_2022 : []),
  ...(Array.isArray(window.BLOG_WECHAT_ARTICLES) ? window.BLOG_WECHAT_ARTICLES : []),
  ...(Array.isArray(window.BLOG_LOCAL_ENTRIES) ? window.BLOG_LOCAL_ENTRIES : []),
  ...(Array.isArray(window.BLOG_MARKDOWN_ARTICLES) ? window.BLOG_MARKDOWN_ARTICLES : [])
];
const toast = $("#toast");
const saveStatus = $("#saveStatus");
const bodyField = $("#articleBody");
let saveTimer;
let toastTimer;
let lastBodyRange = null;
let storageAvailable = true;
let editMode = false;
let mediaDatabasePromise = null;
let photoImportInProgress = false;
const mediaUrlCache = new Map();
const managedObjectUrls = new Set();

function makeId() {
  return globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function localDateString(date = new Date()) {
  const offset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 10);
}

function parseDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value))) return null;
  const date = new Date(`${value}T12:00:00`);
  return Number.isNaN(date.getTime()) || localDateString(date) !== value ? null : date;
}

function formatDate(value) {
  const date = parseDate(value);
  if (!date) return value || "日期未定";
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "long"
  }).format(date);
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  })[character]);
}

function stripHtml(value) {
  const container = document.createElement("div");
  container.innerHTML = String(value ?? "");
  return (container.textContent || "").replace(/\u00a0/g, " ").trim();
}

function sanitizeRichHtml(value) {
  const template = document.createElement("template");
  template.innerHTML = String(value ?? "");
  const allowed = new Set([
    "P", "BR", "BLOCKQUOTE", "STRONG", "B", "EM", "I", "DEL",
    "UL", "OL", "LI", "H1", "H2", "H3", "A", "HR", "PRE", "CODE",
    "IMG", "TABLE", "THEAD", "TBODY", "TR", "TH", "TD"
  ]);

  [...template.content.querySelectorAll("*")].forEach((element) => {
    if (!allowed.has(element.tagName)) {
      element.replaceWith(...element.childNodes);
      return;
    }
    if (element.tagName === "A") {
      const href = element.getAttribute("href") || "";
      [...element.attributes].forEach((attribute) => element.removeAttribute(attribute.name));
      if (/^https?:\/\//i.test(href)) {
        element.setAttribute("href", href);
        element.setAttribute("target", "_blank");
        element.setAttribute("rel", "noopener noreferrer");
      }
    } else if (element.tagName === "IMG") {
      const src = (element.getAttribute("src") || "").replaceAll("\\", "/");
      const alt = stripHtml(element.getAttribute("alt") || "").slice(0, 200);
      [...element.attributes].forEach((attribute) => element.removeAttribute(attribute.name));
      if (/^(?:assets\/posts\/[\w./%-]+|https?:\/\/)/i.test(src) && !src.split("/").includes("..")) {
        element.setAttribute("src", src);
        element.setAttribute("alt", alt);
        element.setAttribute("loading", "lazy");
        element.setAttribute("decoding", "async");
      } else {
        element.remove();
      }
    } else {
      [...element.attributes].forEach((attribute) => element.removeAttribute(attribute.name));
    }
  });

  return template.innerHTML || "<p><br></p>";
}

function uniqueTags(tags) {
  const seen = new Set();
  return (Array.isArray(tags) ? tags : [])
    .map((tag) => stripHtml(tag).replace(/^#\s*/, "").trim())
    .filter((tag) => {
      const key = tag.toLocaleLowerCase("zh-CN");
      if (!tag || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function normalizeImages(images) {
  return (Array.isArray(images) ? images : []).map((image, index) => ({
    src: String(image?.src || "").replaceAll("\\", "/"),
    thumb: String(image?.thumb || "").replaceAll("\\", "/"),
    alt: stripHtml(image?.alt).trim() || `文章图片 ${index + 1}`,
    inline: Boolean(image?.inline),
    storageKey: /^[\w.-]+$/.test(String(image?.storageKey || "")) ? String(image.storageKey) : ""
  })).filter((image) => image.storageKey || (image.src && (/^assets\/posts\/[\w./%-]+$/i.test(image.src) || /^https?:\/\//i.test(image.src))))
    .map((image) => ({
      ...image,
      src: image.storageKey ? "" : image.src,
      thumb: image.storageKey ? "" : (/^assets\/thumbs\/[\w./%-]+$/i.test(image.thumb) ? image.thumb : image.src)
    }));
}

function normalizeEntry(raw = {}) {
  const timestamp = new Date().toISOString();
  const date = parseDate(raw.date) ? raw.date : localDateString();
  const body = sanitizeRichHtml(raw.body);
  return {
    id: String(raw.id || makeId()),
    date,
    title: stripHtml(raw.title).trim() || "无题文章",
    summary: stripHtml(raw.summary).trim(),
    body,
    text: stripHtml(raw.text || body),
    images: normalizeImages(raw.images),
    tags: uniqueTags(raw.tags),
    source: /^https?:\/\//i.test(String(raw.source || "")) ? String(raw.source) : "",
    notion: /^https?:\/\//i.test(String(raw.notion || "")) ? String(raw.notion) : "",
    favorite: Boolean(raw.favorite),
    deletedAt: typeof raw.deletedAt === "string" && raw.deletedAt ? raw.deletedAt : null,
    createdAt: typeof raw.createdAt === "string" && raw.createdAt ? raw.createdAt : timestamp,
    updatedAt: typeof raw.updatedAt === "string" && raw.updatedAt ? raw.updatedAt : timestamp
  };
}

function safeGet(key) {
  try {
    return localStorage.getItem(key);
  } catch (error) {
    storageAvailable = false;
    console.warn("无法读取本地存储。", error);
    return null;
  }
}

function safeSet(key, value) {
  try {
    localStorage.setItem(key, value);
    storageAvailable = true;
    return true;
  } catch (error) {
    storageAvailable = false;
    console.warn("无法写入本地存储。", error);
    return false;
  }
}

function openMediaDatabase() {
  if (!globalThis.indexedDB) return Promise.reject(new Error("当前浏览器不支持照片存储"));
  if (mediaDatabasePromise) return mediaDatabasePromise;
  mediaDatabasePromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(MEDIA_DB_NAME, MEDIA_DB_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(MEDIA_STORE_NAME)) database.createObjectStore(MEDIA_STORE_NAME, { keyPath: "id" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("无法打开照片存储"));
    request.onblocked = () => reject(new Error("照片存储正在被其他窗口占用"));
  }).catch((error) => {
    mediaDatabasePromise = null;
    throw error;
  });
  return mediaDatabasePromise;
}

async function mediaRequest(mode, operation) {
  const database = await openMediaDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(MEDIA_STORE_NAME, mode);
    const store = transaction.objectStore(MEDIA_STORE_NAME);
    const request = operation(store);
    let result;
    request.onsuccess = () => { result = request.result; };
    request.onerror = () => reject(request.error || new Error("照片存储操作失败"));
    transaction.oncomplete = () => resolve(result);
    transaction.onabort = () => reject(transaction.error || new Error("照片存储事务已中止"));
  });
}

function getStoredPhoto(id) {
  return mediaRequest("readonly", (store) => store.get(id));
}

function putStoredPhoto(record) {
  return mediaRequest("readwrite", (store) => store.put(record));
}

function deleteStoredPhotoRecord(id) {
  return mediaRequest("readwrite", (store) => store.delete(id));
}

function revokeMediaUrls(id) {
  const cached = mediaUrlCache.get(id);
  if (!cached) return;
  [cached.src, cached.thumb].forEach((url) => {
    if (url && managedObjectUrls.has(url)) {
      URL.revokeObjectURL(url);
      managedObjectUrls.delete(url);
    }
  });
  mediaUrlCache.delete(id);
}

function urlsForStoredPhoto(record) {
  const cached = mediaUrlCache.get(record.id);
  if (cached) return cached;
  const src = URL.createObjectURL(record.full);
  const thumb = URL.createObjectURL(record.thumb || record.full);
  managedObjectUrls.add(src);
  managedObjectUrls.add(thumb);
  const urls = { src, thumb };
  mediaUrlCache.set(record.id, urls);
  return urls;
}

async function createPhotoThumbnail(file) {
  if (!globalThis.createImageBitmap) return file;
  let bitmap;
  try {
    bitmap = await createImageBitmap(file);
    const scale = Math.min(1, 720 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext("2d");
    if (!context) return file;
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return await new Promise((resolve) => canvas.toBlob((blob) => resolve(blob || file), "image/webp", .82));
  } catch (error) {
    console.warn("无法生成照片缩略图，将使用原图。", error);
    return file;
  } finally {
    bitmap?.close?.();
  }
}

async function hydrateStoredImages({ rerender = true } = {}) {
  const storedImages = state.entries.flatMap((entry) => entry.images).filter((image) => image.storageKey);
  const keys = [...new Set(storedImages.map((image) => image.storageKey))];
  if (!keys.length) return;
  await Promise.all(keys.map(async (key) => {
    try {
      const record = await getStoredPhoto(key);
      if (!record?.full) {
        storedImages.filter((image) => image.storageKey === key).forEach((image) => { image.loadFailed = true; });
        return;
      }
      const urls = urlsForStoredPhoto(record);
      storedImages.filter((image) => image.storageKey === key).forEach((image) => Object.assign(image, urls, { loadFailed: false }));
    } catch (error) {
      storedImages.filter((image) => image.storageKey === key).forEach((image) => { image.loadFailed = true; });
      console.warn(`无法加载照片 ${key}。`, error);
    }
  }));
  if (!rerender) return;
  if (state.screen === "article") renderArticle();
  else renderCatalog();
}

function photoKeyStillUsed(storageKey) {
  return state.entries.some((entry) => entry.images.some((image) => image.storageKey === storageKey));
}

async function cleanupStoredPhoto(storageKey) {
  if (!storageKey || photoKeyStillUsed(storageKey)) return;
  try {
    await deleteStoredPhotoRecord(storageKey);
    revokeMediaUrls(storageKey);
  } catch (error) {
    console.warn(`无法清理照片 ${storageKey}。`, error);
  }
}

function readStoredObject(key) {
  const raw = safeGet(key);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch (error) {
    console.warn(`无法读取设置 ${key}。`, error);
    return {};
  }
}

function normalizedSettings(raw = {}) {
  const next = { ...DEFAULT_SETTINGS };
  Object.entries(SETTING_OPTIONS).forEach(([key, values]) => {
    const value = String(raw[key] ?? "");
    if (values.has(value)) next[key] = value;
  });
  ["showStats", "showExcerpts", "stickyHeader"].forEach((key) => {
    if (typeof raw[key] === "boolean") next[key] = raw[key];
  });
  Object.entries(SETTING_RANGES).forEach(([key, [minimum, maximum]]) => {
    const value = Number(raw[key]);
    if (Number.isFinite(value)) next[key] = Math.min(maximum, Math.max(minimum, Math.round(value)));
  });
  return next;
}

function normalizedCopy(raw = {}) {
  const limits = { brandName: 30, profileName: 40, profileBio: 80, eyebrow: 80, heroTitle: 120, heroCopy: 180 };
  return Object.fromEntries(Object.entries(DEFAULT_COPY).map(([key, fallback]) => {
    const value = typeof raw[key] === "string" ? stripHtml(raw[key]).trim().slice(0, limits[key]) : "";
    return [key, value || fallback];
  }));
}

let siteSettings = normalizedSettings(readStoredObject(SETTINGS_KEY));
let siteCopy = normalizedCopy(readStoredObject(COPY_KEY));

function resolvedDarkMode() {
  return siteSettings.appearance === "dark" || (
    siteSettings.appearance === "system" && globalThis.matchMedia?.("(prefers-color-scheme: dark)").matches
  );
}

function applyCopy() {
  const targets = {
    brandName: "#brandName",
    profileName: "#profileName",
    profileBio: "#profileBio",
    eyebrow: "#heroEyebrow",
    heroTitle: "#heroTitle",
    heroCopy: "#heroCopy"
  };
  Object.entries(targets).forEach(([key, selector]) => {
    const element = $(selector);
    if (element && element.textContent !== siteCopy[key]) element.textContent = siteCopy[key];
  });
  $$('[data-copy-input]').forEach((input) => {
    const value = siteCopy[input.dataset.copyInput] ?? "";
    if (input.value !== value) input.value = value;
  });
  document.title = `${siteCopy.brandName} · 文章归档`;
  const description = $('meta[name="description"]');
  if (description) description.content = `${siteCopy.profileName}：${siteCopy.profileBio}`;
}

function syncSettingsControls() {
  $$('[data-setting-control]').forEach((group) => {
    const value = siteSettings[group.dataset.settingControl];
    $$('[data-value]', group).forEach((button) => {
      const selected = button.dataset.value === value;
      button.classList.toggle("active", selected);
      button.setAttribute("aria-pressed", String(selected));
    });
  });
  $$('[data-setting-select]').forEach((select) => {
    select.value = siteSettings[select.dataset.settingSelect];
  });
  $$('[data-setting-toggle]').forEach((toggle) => {
    toggle.checked = Boolean(siteSettings[toggle.dataset.settingToggle]);
  });
  $$('[data-setting-range]').forEach((range) => {
    const key = range.dataset.settingRange;
    range.value = String(siteSettings[key]);
    const output = $(`[data-setting-output="${key}"]`);
    if (output) output.textContent = `${siteSettings[key]} px`;
  });
}

function applySiteSettings() {
  const body = document.body;
  body.dataset.style = siteSettings.style;
  body.dataset.base = siteSettings.baseColor;
  body.dataset.accent = siteSettings.accent;
  body.dataset.radius = siteSettings.radius;
  body.dataset.fontScale = siteSettings.fontScale;
  body.dataset.columns = siteSettings.columns;
  body.dataset.density = siteSettings.density;
  body.dataset.sidebar = siteSettings.sidebarWidth;
  body.dataset.imageRatio = siteSettings.imageRatio;
  body.dataset.card = siteSettings.cardVariant;
  body.dataset.button = siteSettings.buttonVariant;
  Object.entries(SETTING_SIZE_VARIABLES).forEach(([key, variable]) => {
    body.style.setProperty(variable, `${siteSettings[key]}px`);
  });
  body.classList.toggle("dark", resolvedDarkMode());
  body.classList.toggle("hide-excerpts", !siteSettings.showExcerpts);
  body.classList.toggle("sticky-header", siteSettings.stickyHeader);
  $("#archiveStats").hidden = !siteSettings.showStats;
  $("#themeToggle").setAttribute("aria-pressed", String(body.classList.contains("dark")));
  $("#themeToggle").title = editMode
    ? (body.classList.contains("dark") ? "切换到浅色模式" : "切换到深色模式")
    : "请先点击左侧栏的“编辑”";
  syncSettingsControls();
}

function saveSiteSettings(feedback = false) {
  const saved = safeSet(SETTINGS_KEY, JSON.stringify(siteSettings));
  const status = $("#settingsSaveState");
  if (status) status.textContent = saved ? "设置已保存" : "保存失败";
  if (feedback) showToast(saved ? "网站设置已保存" : "设置保存失败");
  return saved;
}

function updateSiteSetting(key, value) {
  if (!requireEditMode("调整网站设置")) return;
  if (SETTING_OPTIONS[key] && SETTING_OPTIONS[key].has(String(value))) siteSettings[key] = String(value);
  else if (SETTING_RANGES[key]) {
    const [minimum, maximum] = SETTING_RANGES[key];
    const number = Number(value);
    if (!Number.isFinite(number)) return;
    siteSettings[key] = Math.min(maximum, Math.max(minimum, Math.round(number)));
  }
  else if (["showStats", "showExcerpts", "stickyHeader"].includes(key)) siteSettings[key] = Boolean(value);
  else return;
  applySiteSettings();
  saveSiteSettings();
}

function saveCopy(feedback = false) {
  const saved = safeSet(COPY_KEY, JSON.stringify(siteCopy));
  if (feedback) showToast(saved ? "首页文字已保存" : "首页文字保存失败");
  return saved;
}

function loadEntries() {
  const bundledEntries = importedArticles.map((article) => normalizeEntry({
    ...article,
    id: /^(?:local|markdown)-/.test(String(article.id)) ? String(article.id) : `notion-${article.id}`,
    createdAt: article.createdAt || `${article.date}T12:00:00.000Z`,
    updatedAt: article.updatedAt || `${article.date}T12:00:00.000Z`
  }));
  const raw = safeGet(APP_KEY);
  if (raw !== null) {
    try {
      const saved = JSON.parse(raw);
      if (Array.isArray(saved.entries)) {
        const savedEntries = saved.entries.map(normalizeEntry);
        const savedIds = new Set(savedEntries.map((entry) => entry.id));
        return [
          ...savedEntries,
          ...bundledEntries.filter((entry) => !savedIds.has(entry.id))
        ];
      }
    } catch (error) {
      console.warn("本地文章数据已损坏，将恢复 Notion 归档。", error);
    }
  }
  return bundledEntries;
}

let state = {
  entries: loadEntries(),
  activeId: null,
  screen: "catalog",
  filter: "all",
  query: "",
  tag: null,
  year: null
};

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("show"), 2000);
}

function requireEditMode(action = "修改网页") {
  if (editMode) return true;
  showToast(`${action}前，请先点击左侧栏的“编辑”并输入密码`);
  return false;
}

function syncEditModeUi() {
  document.body.classList.toggle("edit-mode", editMode);
  $$('[data-copy-key]').forEach((element) => { element.contentEditable = String(editMode); });
  $$('[data-copy-input]').forEach((input) => { input.disabled = !editMode; });
  $$('[data-setting-control] button, [data-setting-select], [data-setting-toggle], [data-setting-range]').forEach((control) => { control.disabled = !editMode; });
  $("#resetSettingsButton").disabled = !editMode;

  const button = $("#editModeButton");
  button.classList.toggle("active", editMode);
  button.setAttribute("aria-pressed", String(editMode));
  $("#editModeLabel").textContent = editMode ? "完成编辑" : "编辑";
  $("#editModeStatus").textContent = editMode ? "已开启" : "已锁定";
  $("#editModeHint").textContent = editMode ? "文字编辑已开启，完成后请再次点击。" : "开启后才能修改首页文字与文章内容。";
  $("#contentEditHint").textContent = editMode
    ? "文字编辑已开启；也可以直接点击首页眉标题、主标题或说明文字。"
    : "文字当前已锁定。请先点击左侧边栏的“编辑”。";

  $("#newEntryButton").classList.toggle("is-locked", !editMode);
  $("#newEntryButton").setAttribute("aria-disabled", String(!editMode));
  $("#newEntryButton").title = editMode ? "新建文章" : "请先点击左侧边栏的“编辑”";
  $("#themeToggle").classList.toggle("is-locked", !editMode);
  $("#themeToggle").setAttribute("aria-disabled", String(!editMode));
  $("#themeToggle").title = editMode
    ? (document.body.classList.contains("dark") ? "切换到浅色模式" : "切换到深色模式")
    : "请先点击左侧栏的“编辑”";

  const entry = activeEntry();
  const writable = Boolean(entry && !entry.deletedAt && editMode);
  $(`[data-field="title"]`).contentEditable = String(writable);
  bodyField.contentEditable = String(writable);
  $$('[data-command]').forEach((formatButton) => { formatButton.disabled = !writable; });
  $("#addTagButton").hidden = !writable;
  $("#favoriteButton").disabled = !writable;
  $("#photoInput").disabled = !writable;
  $("#photoImportPanel").classList.toggle("locked", !writable);
  $("#photoImportHint").textContent = writable ? "可一次选择多张图片。" : "请先解锁编辑模式后导入照片。";
  if (entry) {
    const readOnly = Boolean(entry.deletedAt);
    $("#restoreButton").hidden = !readOnly || !editMode;
    $("#changeDateButton").hidden = readOnly || !editMode;
    $("#duplicateButton").hidden = readOnly || !editMode;
    $("#deleteButton").hidden = !editMode;
  }
  if (entry) saveStatus.textContent = idleStatus();
}

function setEditMode(enabled, feedback = true) {
  if (!enabled && photoImportInProgress) {
    showToast("照片仍在保存，请稍候再完成编辑");
    return;
  }
  editMode = Boolean(enabled);
  syncEditModeUi();
  if (state.screen === "article" && activeEntry()) renderArticle();
  closeActionMenu();
  toggleMobileMenu(false);
  if (feedback) showToast(editMode ? "编辑模式已开启" : "网页文字已锁定");
}

function idleStatus() {
  const entry = activeEntry();
  if (!storageAvailable) return "本地保存失败";
  if (entry?.deletedAt) return "回收站内只读，可恢复后编辑";
  if (!editMode) return "查看模式；点击侧栏“编辑”后修改";
  return "所有更改已保存";
}

function saveState(showFeedback = false) {
  const saved = safeSet(APP_KEY, JSON.stringify({ entries: state.entries }));
  clearTimeout(saveTimer);
  if (!saved) {
    saveStatus.textContent = "本地保存失败";
    if (showFeedback) showToast("保存失败：请检查浏览器存储权限");
    return false;
  }
  saveStatus.textContent = "正在保存…";
  saveTimer = setTimeout(() => {
    saveStatus.textContent = idleStatus();
    if (showFeedback) showToast("更改已保存");
  }, 220);
  return true;
}

function activeEntry() {
  return state.entries.find((entry) => entry.id === state.activeId) || null;
}

function activeEntries() {
  return state.entries.filter((entry) => !entry.deletedAt);
}

function sortedEntries(entries) {
  return [...entries].sort((a, b) => b.date.localeCompare(a.date) || b.updatedAt.localeCompare(a.updatedAt));
}

function filteredEntries() {
  const keyword = state.query.trim().toLocaleLowerCase("zh-CN");
  return sortedEntries(state.entries.filter((entry) => {
    if (state.filter === "trash") {
      if (!entry.deletedAt) return false;
    } else if (entry.deletedAt) {
      return false;
    }
    if (state.filter === "favorites" && !entry.favorite) return false;
    if (state.filter === "images" && !entry.images.length) return false;
    if (state.tag && !entry.tags.includes(state.tag)) return false;
    if (state.year && !entry.date.startsWith(`${state.year}-`)) return false;
    if (!keyword) return true;
    return [entry.title, entry.text, entry.date, ...entry.tags]
      .join(" ")
      .toLocaleLowerCase("zh-CN")
      .includes(keyword);
  }));
}

function tagCounts() {
  const counts = new Map();
  activeEntries().forEach((entry) => entry.tags.forEach((tag) => counts.set(tag, (counts.get(tag) || 0) + 1)));
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "zh-CN"));
}

function yearCounts() {
  const counts = new Map();
  activeEntries().forEach((entry) => {
    const year = entry.date.slice(0, 4);
    counts.set(year, (counts.get(year) || 0) + 1);
  });
  return [...counts.entries()].sort((a, b) => b[0].localeCompare(a[0]));
}

function renderSidebar() {
  const entries = activeEntries();
  $("#allCount").textContent = entries.length;
  $("#favoriteCount").textContent = entries.filter((entry) => entry.favorite).length;
  $("#imageCount").textContent = entries.filter((entry) => entry.images.length).length;
  $("#trashCount").textContent = state.entries.filter((entry) => entry.deletedAt).length;

  $$(".nav-item").forEach((button) => button.classList.toggle("active", button.dataset.filter === state.filter));

  const tags = tagCounts();
  $("#sidebarTags").innerHTML = tags.map(([tag, count]) => `
    <button type="button" class="sidebar-tag ${state.tag === tag ? "active" : ""}" data-tag="${escapeHtml(tag)}">
      <span>${escapeHtml(tag)}</span><small>${count}</small>
    </button>`).join("");
  $("#clearTagButton").disabled = !state.tag && !state.year;

  const years = yearCounts();
  $("#yearTotal").textContent = `${years.length} 年`;
  $("#yearList").innerHTML = years.map(([year, count]) => `
    <button type="button" class="year-item ${state.year === year ? "active" : ""}" data-year="${year}">
      <span>${year}</span><small>${count} 篇</small>
    </button>`).join("");
}

function renderStats() {
  const entries = activeEntries();
  const years = yearCounts().map(([year]) => Number(year));
  $("#articleTotal").textContent = entries.length;
  $("#photoTotal").textContent = entries.reduce((total, entry) => total + entry.images.length, 0);
  $("#yearSpan").textContent = years.length ? Math.max(...years) - Math.min(...years) + 1 : 0;
}

function cardMarkup(entry, index) {
  const excerpt = (entry.summary || entry.text).replace(/\s+/g, " ").trim() || "这篇文章以图片为主。";
  const coverIndex = entry.images.findIndex((image) => image.thumb || image.src);
  const cover = coverIndex >= 0 ? entry.images[coverIndex] : null;
  const coverSource = cover ? (cover.thumb || cover.src) : "";
  const coverCandidateIndex = [...new Set(entry.images.flatMap((image) => [image.thumb, image.src]).filter(Boolean))].indexOf(coverSource);
  const media = cover
    ? `<div class="card-image"><img class="card-cover" src="${escapeHtml(coverSource)}" alt="${escapeHtml(cover.alt)}" data-cover-entry="${escapeHtml(entry.id)}" data-cover-index="${Math.max(0, coverCandidateIndex)}" loading="${index < 6 ? "eager" : "lazy"}" decoding="async"${index < 3 ? ' fetchpriority="high"' : ""}><span>${entry.images.length} 张图片</span></div>`
    : entry.images.length
      ? `<div class="card-placeholder loading-photo"><span>${entry.date.slice(0, 4)}</span><i>${entry.images.every((image) => image.loadFailed) ? "照片不可用" : "照片加载中"}</i></div>`
      : `<div class="card-placeholder"><span>${entry.date.slice(0, 4)}</span><i>和光</i></div>`;
  return `<article class="article-card ${entry.deletedAt ? "deleted" : ""}">
    <button type="button" class="card-open" data-entry-id="${escapeHtml(entry.id)}" aria-label="打开《${escapeHtml(entry.title)}》">
      ${media}
      <div class="card-content">
        <div class="card-meta"><time>${escapeHtml(entry.date)}</time>${entry.favorite ? "<span>♥ 已收藏</span>" : ""}${entry.deletedAt ? "<span>回收站</span>" : ""}</div>
        <h2>${escapeHtml(entry.title)}</h2>
        <p>${escapeHtml(excerpt.slice(0, 118))}${excerpt.length > 118 ? "…" : ""}</p>
        <div class="card-tags">${entry.tags.slice(0, 3).map((tag) => `<span># ${escapeHtml(tag)}</span>`).join("")}</div>
      </div>
    </button>
  </article>`;
}

function renderCatalog() {
  const entries = filteredEntries();
  const tags = tagCounts();
  $("#tagBar").innerHTML = [
    `<button type="button" class="tag-filter ${!state.tag ? "active" : ""}" data-tag="">全部</button>`,
    ...tags.map(([tag]) => `<button type="button" class="tag-filter ${state.tag === tag ? "active" : ""}" data-tag="${escapeHtml(tag)}">${escapeHtml(tag)}</button>`)
  ].join("");

  const conditions = [];
  if (state.filter === "favorites") conditions.push("收藏");
  if (state.filter === "images") conditions.push("影像");
  if (state.filter === "trash") conditions.push("回收站");
  if (state.tag) conditions.push(`#${state.tag}`);
  if (state.year) conditions.push(state.year);
  if (state.query) conditions.push(`“${state.query}”`);
  $("#resultSummary").textContent = `${conditions.join(" · ") || "全部文章"} · ${entries.length} 篇`;
  $("#articleGrid").innerHTML = entries.map(cardMarkup).join("");
  $("#emptyCatalog").hidden = Boolean(entries.length);
  renderStats();
  renderSidebar();
}

function renderArticleTags(entry) {
  const readOnly = Boolean(entry.deletedAt);
  const writable = !readOnly && editMode;
  $("#articleTags").innerHTML = entry.tags.map((tag, index) => `
    <span class="article-tag">
      <button type="button" class="tag-name" data-open-tag="${escapeHtml(tag)}"># ${escapeHtml(tag)}</button>
      ${writable ? `<button type="button" class="tag-remove" data-remove-tag="${index}" aria-label="删除标签 ${escapeHtml(tag)}">×</button>` : ""}
    </span>`).join("");
  $("#addTagButton").hidden = !writable;
}

function renderGallery(entry) {
  const gallery = $("#imageGallery");
  const galleryImages = entry.images.filter((image) => !image.inline);
  gallery.hidden = !galleryImages.length;
  gallery.className = `image-gallery count-${Math.min(galleryImages.length, 5)}`;
  const writable = editMode && !entry.deletedAt;
  gallery.innerHTML = galleryImages.map((image) => {
    const index = entry.images.indexOf(image);
    return `
    <div class="gallery-item ${image.src ? "" : "loading"}">
      ${image.src ? `<button class="gallery-open" type="button" data-image-index="${index}" aria-label="查看大图：${escapeHtml(image.alt)}"><img src="${escapeHtml(image.src)}" alt="${escapeHtml(image.alt)}" loading="lazy"></button>` : `<div class="gallery-loading">${image.loadFailed ? "照片不可用" : "照片加载中…"}</div>`}
      ${writable ? `<button class="gallery-remove" type="button" data-remove-image="${index}" aria-label="移除照片：${escapeHtml(image.alt)}">×</button>` : ""}
    </div>`;
  }).join("");
}

async function importPhotos(fileList) {
  if (!requireEditMode("导入照片")) return;
  const entry = activeEntry();
  if (!entry || entry.deletedAt) return;
  const files = [...fileList];
  const validFiles = files.filter((file) => file.type.startsWith("image/") && file.size > 0 && file.size <= MAX_PHOTO_BYTES);
  const skipped = files.length - validFiles.length;
  if (!validFiles.length) {
    showToast(skipped ? "请选择不超过 30MB 的有效图片" : "没有选择照片");
    return;
  }

  const input = $("#photoInput");
  const panel = $("#photoImportPanel");
  photoImportInProgress = true;
  input.disabled = true;
  panel.classList.add("busy");
  $("#photoImportHint").textContent = `正在保存 ${validFiles.length} 张照片…`;
  let imported = 0;

  for (const file of validFiles) {
    try {
      const id = `photo-${makeId()}`;
      const thumb = await createPhotoThumbnail(file);
      const record = {
        id,
        full: file,
        thumb,
        name: stripHtml(file.name).slice(0, 120) || `日志照片 ${entry.images.length + 1}`,
        type: file.type,
        createdAt: new Date().toISOString()
      };
      await putStoredPhoto(record);
      const urls = urlsForStoredPhoto(record);
      entry.images.push({ ...urls, alt: record.name, storageKey: id });
      imported += 1;
    } catch (error) {
      console.warn(`照片 ${file.name} 导入失败。`, error);
    }
  }

  input.value = "";
  photoImportInProgress = false;
  panel.classList.remove("busy");
  entry.updatedAt = new Date().toISOString();
  saveState();
  renderGallery(entry);
  renderSidebar();
  renderStats();
  syncEditModeUi();
  const failed = validFiles.length - imported + skipped;
  showToast(imported ? `已导入 ${imported} 张照片${failed ? `，${failed} 张未导入` : ""}` : "照片导入失败，请检查浏览器存储权限");
}

async function removeImage(index) {
  if (!requireEditMode("移除照片")) return;
  const entry = activeEntry();
  const image = entry?.images[index];
  if (!entry || entry.deletedAt || !image) return;
  const confirmed = await requestConfirmation({
    title: "移除这张照片？",
    message: `“${image.alt}”会从当前文章中移除。`,
    confirmLabel: "移除照片",
    destructive: true
  });
  if (!confirmed || activeEntry()?.id !== entry.id) return;
  const [removed] = entry.images.splice(index, 1);
  entry.updatedAt = new Date().toISOString();
  saveState();
  renderGallery(entry);
  renderSidebar();
  renderStats();
  await cleanupStoredPhoto(removed.storageKey);
  showToast("照片已移除");
}

function navigationEntries(entry) {
  return sortedEntries(state.entries.filter((item) => entry.deletedAt ? Boolean(item.deletedAt) : !item.deletedAt));
}

function renderArticleNavigation(entry) {
  const entries = navigationEntries(entry);
  const index = entries.findIndex((item) => item.id === entry.id);
  const previous = entries[index + 1] || null;
  const next = entries[index - 1] || null;
  const previousButton = $("#previousArticle");
  const nextButton = $("#nextArticle");
  previousButton.disabled = !previous;
  nextButton.disabled = !next;
  previousButton.dataset.entryId = previous?.id || "";
  nextButton.dataset.entryId = next?.id || "";
  $("strong", previousButton).textContent = previous?.title || "已经是最早一篇";
  $("strong", nextButton).textContent = next?.title || "已经是最新一篇";
}

function renderArticle() {
  const entry = activeEntry();
  if (!entry) return navigateCatalog(true);
  const readOnly = Boolean(entry.deletedAt);
  const writable = !readOnly && editMode;
  $("#articleDate").textContent = formatDate(entry.date);
  const sourceLink = $("#sourceLink");
  sourceLink.hidden = !entry.source;
  sourceLink.href = entry.source || "#";
  $("[data-field='title']").textContent = entry.title;
  $("[data-field='title']").contentEditable = String(writable);
  bodyField.innerHTML = entry.body;
  bodyField.contentEditable = String(writable);
  renderArticleTags(entry);
  renderGallery(entry);
  renderArticleNavigation(entry);
  $("#favoriteButton").textContent = entry.favorite ? "♥" : "♡";
  $("#favoriteButton").classList.toggle("is-favorite", entry.favorite);
  $("#favoriteButton").setAttribute("aria-pressed", String(entry.favorite));
  $("#favoriteButton").disabled = !writable;
  $$("[data-command]").forEach((button) => { button.disabled = !writable; });
  $("#restoreButton").hidden = !readOnly || !editMode;
  $("#changeDateButton").hidden = readOnly || !editMode;
  $("#duplicateButton").hidden = readOnly || !editMode;
  $("#deleteButton").hidden = !editMode;
  $("#deleteButton").textContent = readOnly ? "永久删除" : "移到回收站";
  saveStatus.textContent = idleStatus();
  syncEditModeUi();
}

function toggleMobileMenu(open) {
  document.body.classList.toggle("mobile-menu-open", open);
  $("#mobileMenuButton").setAttribute("aria-expanded", String(open));
}

function closeActionMenu() {
  $("#actionMenu").classList.remove("show");
  $("#moreButton").setAttribute("aria-expanded", "false");
}

function catalogUrl() {
  return "#catalog";
}

function navigateCatalog(replace = false) {
  state.screen = "catalog";
  state.activeId = null;
  $("#catalogPage").hidden = false;
  $("#articlePage").hidden = true;
  renderCatalog();
  closeActionMenu();
  toggleMobileMenu(false);
  if (location.hash !== "#catalog") history[replace ? "replaceState" : "pushState"]({}, "", catalogUrl());
  window.scrollTo({ top: 0, behavior: replace ? "auto" : "smooth" });
}

function openArticle(id, updateHistory = true) {
  const entry = state.entries.find((item) => item.id === id);
  if (!entry) return navigateCatalog(true);
  state.activeId = id;
  state.screen = "article";
  $("#catalogPage").hidden = true;
  $("#articlePage").hidden = false;
  renderArticle();
  closeActionMenu();
  toggleMobileMenu(false);
  if (updateHistory) history.pushState({}, "", `#article=${encodeURIComponent(id)}`);
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function applyFilter(filter) {
  if (!VALID_FILTERS.has(filter)) return;
  state.filter = filter;
  state.tag = null;
  state.year = null;
  navigateCatalog();
}

function applyTag(tag) {
  state.filter = "all";
  state.tag = tag || null;
  state.year = null;
  navigateCatalog();
}

function applyYear(year) {
  state.filter = "all";
  state.year = year || null;
  state.tag = null;
  navigateCatalog();
}

function resetFilters() {
  state.filter = "all";
  state.tag = null;
  state.year = null;
  state.query = "";
  $("#searchInput").value = "";
  navigateCatalog();
}

function selectContent(element) {
  const range = document.createRange();
  range.selectNodeContents(element);
  const selection = window.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
}

function newEntry() {
  if (!editMode) {
    showToast("请先点击左侧边栏的“编辑”");
    return;
  }
  const timestamp = new Date().toISOString();
  const entry = normalizeEntry({
    id: `local-${makeId()}`,
    date: localDateString(),
    title: "无题文章",
    body: "<p>从这里开始，写下新的文章……</p>",
    tags: ["日常"],
    createdAt: timestamp,
    updatedAt: timestamp
  });
  state.entries.unshift(entry);
  saveState();
  renderSidebar();
  openArticle(entry.id);
  const title = $("[data-field='title']");
  title.focus();
  selectContent(title);
  showToast("新文章已创建");
}

let confirmationResolver = null;

function requestConfirmation({ title, message, confirmLabel = "确认", destructive = false }) {
  const dialog = $("#confirmDialog");
  $("#confirmTitle").textContent = title;
  $("#confirmMessage").textContent = message;
  const action = $("#confirmActionButton");
  action.textContent = confirmLabel;
  action.classList.toggle("danger-button", destructive);
  action.classList.toggle("primary-button", !destructive);
  if (typeof dialog.showModal === "function") dialog.showModal();
  else dialog.setAttribute("open", "");
  return new Promise((resolve) => { confirmationResolver = resolve; });
}

function resolveConfirmation(accepted) {
  const dialog = $("#confirmDialog");
  if (typeof dialog.close === "function" && dialog.open) dialog.close();
  else dialog.removeAttribute("open");
  const resolve = confirmationResolver;
  confirmationResolver = null;
  resolve?.(accepted);
}

async function softDeleteEntry() {
  if (!requireEditMode("删除文章")) return;
  const entry = activeEntry();
  if (!entry || entry.deletedAt) return;
  const confirmed = await requestConfirmation({
    title: "移到回收站？",
    message: `《${entry.title}》会从目录中隐藏，你仍可以在回收站恢复它。`,
    confirmLabel: "移到回收站",
    destructive: true
  });
  if (!confirmed || activeEntry()?.id !== entry.id) return;
  entry.deletedAt = new Date().toISOString();
  entry.updatedAt = entry.deletedAt;
  saveState();
  state.filter = "all";
  navigateCatalog();
  showToast("文章已移到回收站");
}

async function permanentlyDeleteEntry() {
  if (!requireEditMode("永久删除文章")) return;
  const entry = activeEntry();
  if (!entry || !entry.deletedAt) return;
  const confirmed = await requestConfirmation({
    title: "永久删除文章？",
    message: `《${entry.title}》将被永久删除，此操作无法撤销。`,
    confirmLabel: "永久删除",
    destructive: true
  });
  if (!confirmed || activeEntry()?.id !== entry.id) return;
  const storedPhotoKeys = [...new Set(entry.images.map((image) => image.storageKey).filter(Boolean))];
  state.entries = state.entries.filter((item) => item.id !== entry.id);
  saveState();
  state.filter = "trash";
  navigateCatalog();
  await Promise.all(storedPhotoKeys.map(cleanupStoredPhoto));
  showToast("文章已永久删除");
}

function restoreEntry() {
  if (!requireEditMode("恢复文章")) return;
  const entry = activeEntry();
  if (!entry || !entry.deletedAt) return;
  entry.deletedAt = null;
  entry.updatedAt = new Date().toISOString();
  state.filter = "all";
  saveState();
  renderArticle();
  renderSidebar();
  showToast("文章已恢复");
}

function duplicateEntry() {
  if (!requireEditMode("复制文章")) return;
  const source = activeEntry();
  if (!source || source.deletedAt) return;
  const timestamp = new Date().toISOString();
  const copy = normalizeEntry({
    ...source,
    id: `local-${makeId()}`,
    title: `${source.title}（副本）`,
    favorite: false,
    deletedAt: null,
    createdAt: timestamp,
    updatedAt: timestamp
  });
  copy.images = source.images.map((image) => ({ ...image }));
  state.entries.unshift(copy);
  saveState();
  openArticle(copy.id);
  showToast("文章副本已创建");
}

function changeEntryDate() {
  if (!requireEditMode("修改发布日期")) return;
  const entry = activeEntry();
  if (!entry || entry.deletedAt || !editMode) return;
  const input = prompt("请输入发布日期（YYYY-MM-DD）", entry.date);
  if (input === null) return;
  const date = input.trim();
  if (!parseDate(date)) return showToast("日期格式不正确，请使用 YYYY-MM-DD");
  entry.date = date;
  entry.updatedAt = new Date().toISOString();
  saveState();
  renderArticle();
  showToast("发布日期已修改");
}

function exportEntry() {
  const entry = activeEntry();
  if (!entry) return;
  const content = `${entry.title}\n${entry.date}\n${entry.tags.map((tag) => `#${tag}`).join(" ")}\n\n${stripHtml(entry.body)}\n\n原文：${entry.source || "无"}`;
  const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${entry.date}-${entry.title.replace(/[\\/:*?"<>|]/g, "-").slice(0, 80)}.txt`;
  link.hidden = true;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
  closeActionMenu();
  showToast("文章已导出");
}

function addTag() {
  if (!requireEditMode("添加标签")) return;
  const entry = activeEntry();
  if (!entry || entry.deletedAt || !editMode) return;
  const input = prompt("请输入新标签");
  if (input === null) return;
  const tag = stripHtml(input).replace(/^#\s*/, "").trim();
  if (!tag) return showToast("标签不能为空");
  entry.tags = uniqueTags([...entry.tags, tag]);
  entry.updatedAt = new Date().toISOString();
  saveState();
  renderArticleTags(entry);
  renderSidebar();
  showToast("标签已添加");
}

function removeTag(index) {
  if (!requireEditMode("删除标签")) return;
  const entry = activeEntry();
  if (!entry || entry.deletedAt || !editMode || index < 0 || index >= entry.tags.length) return;
  entry.tags.splice(index, 1);
  entry.updatedAt = new Date().toISOString();
  saveState();
  renderArticleTags(entry);
  renderSidebar();
  showToast("标签已删除");
}

function openLightbox(index) {
  const entry = activeEntry();
  const image = entry?.images[index];
  if (!image?.src) return showToast("照片仍在加载，请稍后再试");
  $("#lightboxImage").src = image.src;
  $("#lightboxImage").alt = image.alt;
  $("#lightboxCaption").textContent = `${image.alt} · ${index + 1} / ${entry.images.length}`;
  const dialog = $("#lightbox");
  if (typeof dialog.showModal === "function") dialog.showModal();
  else dialog.setAttribute("open", "");
}

function closeLightbox() {
  const dialog = $("#lightbox");
  if (typeof dialog.close === "function" && dialog.open) dialog.close();
  else dialog.removeAttribute("open");
}

$("#homeButton").addEventListener("click", () => navigateCatalog());
$("#backButton").addEventListener("click", () => navigateCatalog());
$("#newEntryButton").addEventListener("click", newEntry);
$("#editModeButton").addEventListener("click", () => setEditMode(!editMode));

$$(".nav-item").forEach((button) => button.addEventListener("click", () => applyFilter(button.dataset.filter)));
$("#sidebarTags").addEventListener("click", (event) => {
  const button = event.target.closest("[data-tag]");
  if (button) applyTag(button.dataset.tag);
});
$("#tagBar").addEventListener("click", (event) => {
  const button = event.target.closest("[data-tag]");
  if (button) applyTag(button.dataset.tag);
});
$("#yearList").addEventListener("click", (event) => {
  const button = event.target.closest("[data-year]");
  if (button) applyYear(button.dataset.year);
});
$("#clearTagButton").addEventListener("click", resetFilters);
$("#resetFiltersButton").addEventListener("click", resetFilters);

$("#articleGrid").addEventListener("click", (event) => {
  const button = event.target.closest("[data-entry-id]");
  if (button) openArticle(button.dataset.entryId);
});

$("#articleGrid").addEventListener("error", (event) => {
  const image = event.target.closest?.("img[data-cover-entry]");
  if (!image) return;
  const entry = state.entries.find((item) => item.id === image.dataset.coverEntry);
  const candidates = [...new Set((entry?.images || []).flatMap((item) => [item.thumb, item.src]).filter(Boolean))];
  const nextIndex = Number(image.dataset.coverIndex || 0) + 1;
  if (candidates[nextIndex]) {
    image.dataset.coverIndex = String(nextIndex);
    image.src = candidates[nextIndex];
    return;
  }
  const media = image.closest(".card-image");
  if (media) {
    media.className = "card-placeholder image-unavailable";
    media.innerHTML = `<span>${escapeHtml(entry?.date?.slice(0, 4) || "")}</span><i>图片暂不可用</i>`;
  }
}, true);

$("#searchInput").addEventListener("input", (event) => {
  state.query = event.target.value;
  if (state.screen !== "catalog") {
    state.screen = "catalog";
    state.activeId = null;
    $("#catalogPage").hidden = false;
    $("#articlePage").hidden = true;
    history.pushState({}, "", catalogUrl());
  }
  renderCatalog();
});

$("[data-field='title']").addEventListener("input", (event) => {
  const entry = activeEntry();
  if (!entry || entry.deletedAt || !editMode) return;
  entry.title = event.target.textContent;
  entry.updatedAt = new Date().toISOString();
  saveState();
});

$("[data-field='title']").addEventListener("blur", (event) => {
  const entry = activeEntry();
  if (!entry || entry.deletedAt || !editMode) return;
  entry.title = event.target.textContent.trim() || "无题文章";
  event.target.textContent = entry.title;
  entry.updatedAt = new Date().toISOString();
  saveState(true);
});

$("[data-field='title']").addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    event.target.blur();
  }
});

bodyField.addEventListener("input", () => {
  const entry = activeEntry();
  if (!entry || entry.deletedAt || !editMode) return;
  entry.body = bodyField.innerHTML;
  entry.text = stripHtml(entry.body);
  entry.updatedAt = new Date().toISOString();
  saveState();
});

bodyField.addEventListener("blur", () => {
  const entry = activeEntry();
  if (!entry || entry.deletedAt || !editMode) return;
  entry.body = sanitizeRichHtml(bodyField.innerHTML);
  entry.text = stripHtml(entry.body);
  bodyField.innerHTML = entry.body;
  entry.updatedAt = new Date().toISOString();
  saveState(true);
});

document.addEventListener("selectionchange", () => {
  const selection = window.getSelection();
  if (!selection.rangeCount || !bodyField.contains(selection.anchorNode)) return;
  lastBodyRange = selection.getRangeAt(0).cloneRange();
});

$$("[data-command]").forEach((button) => {
  button.addEventListener("mousedown", (event) => {
    event.preventDefault();
    const entry = activeEntry();
    if (!entry || entry.deletedAt || !editMode) return;
    bodyField.focus();
    const selection = window.getSelection();
    if (lastBodyRange) {
      selection.removeAllRanges();
      selection.addRange(lastBodyRange);
    }
    if (typeof document.execCommand === "function") {
      document.execCommand(button.dataset.command, false);
      bodyField.dispatchEvent(new Event("input", { bubbles: true }));
    }
  });
});

$("#favoriteButton").addEventListener("click", () => {
  if (!requireEditMode("修改收藏")) return;
  const entry = activeEntry();
  if (!entry || entry.deletedAt) return;
  entry.favorite = !entry.favorite;
  entry.updatedAt = new Date().toISOString();
  saveState();
  renderArticle();
  renderSidebar();
  showToast(entry.favorite ? "已加入收藏" : "已取消收藏");
});

$("#moreButton").addEventListener("click", (event) => {
  event.stopPropagation();
  const open = !$("#actionMenu").classList.contains("show");
  $("#actionMenu").classList.toggle("show", open);
  $("#moreButton").setAttribute("aria-expanded", String(open));
});
$("#restoreButton").addEventListener("click", restoreEntry);
$("#changeDateButton").addEventListener("click", changeEntryDate);
$("#duplicateButton").addEventListener("click", duplicateEntry);
$("#exportButton").addEventListener("click", exportEntry);
$("#deleteButton").addEventListener("click", () => activeEntry()?.deletedAt ? permanentlyDeleteEntry() : softDeleteEntry());
document.addEventListener("click", (event) => {
  if (!event.target.closest(".reader-actions")) closeActionMenu();
});

$("#articleTags").addEventListener("click", (event) => {
  const remove = event.target.closest("[data-remove-tag]");
  if (remove) return removeTag(Number(remove.dataset.removeTag));
  const open = event.target.closest("[data-open-tag]");
  if (open) applyTag(open.dataset.openTag);
});
$("#addTagButton").addEventListener("click", addTag);
$("#photoInput").addEventListener("change", (event) => importPhotos(event.target.files));

$("#imageGallery").addEventListener("click", (event) => {
  const remove = event.target.closest("[data-remove-image]");
  if (remove) return removeImage(Number(remove.dataset.removeImage));
  const button = event.target.closest("[data-image-index]");
  if (button) openLightbox(Number(button.dataset.imageIndex));
});
$("#closeLightbox").addEventListener("click", closeLightbox);
$("#lightbox").addEventListener("click", (event) => {
  if (event.target === $("#lightbox")) closeLightbox();
});

$("#confirmCancelButton").addEventListener("click", () => resolveConfirmation(false));
$("#confirmActionButton").addEventListener("click", () => resolveConfirmation(true));
$("#confirmDialog").addEventListener("cancel", (event) => {
  event.preventDefault();
  resolveConfirmation(false);
});
$("#confirmDialog").addEventListener("click", (event) => {
  if (event.target === $("#confirmDialog")) resolveConfirmation(false);
});

[$("#previousArticle"), $("#nextArticle")].forEach((button) => button.addEventListener("click", () => {
  if (button.dataset.entryId) openArticle(button.dataset.entryId);
}));

$("#themeToggle").addEventListener("click", () => {
  if (!requireEditMode("切换网站主题")) return;
  siteSettings.appearance = document.body.classList.contains("dark") ? "light" : "dark";
  applySiteSettings();
  saveSiteSettings();
  showToast(document.body.classList.contains("dark") ? "已切换夜间模式" : "已切换明亮模式");
});

function openSettings() {
  applyCopy();
  syncSettingsControls();
  syncEditModeUi();
  const dialog = $("#settingsDialog");
  if (typeof dialog.showModal === "function") dialog.showModal();
  else dialog.setAttribute("open", "");
}

function closeSettings() {
  const dialog = $("#settingsDialog");
  if (typeof dialog.close === "function" && dialog.open) dialog.close();
  else dialog.removeAttribute("open");
}

$("#settingsButton").addEventListener("click", openSettings);
$("#closeSettingsButton").addEventListener("click", closeSettings);
$("#doneSettingsButton").addEventListener("click", () => {
  saveSiteSettings(true);
  saveCopy();
  closeSettings();
});
$("#settingsDialog").addEventListener("click", (event) => {
  if (event.target === $("#settingsDialog")) closeSettings();
});

$(".settings-tabs").addEventListener("click", (event) => {
  const button = event.target.closest("[data-settings-tab]");
  if (!button) return;
  $$('[data-settings-tab]').forEach((item) => {
    const active = item === button;
    item.classList.toggle("active", active);
    item.setAttribute("aria-selected", String(active));
  });
  $$('[data-settings-panel]').forEach((panel) => panel.classList.toggle("active", panel.dataset.settingsPanel === button.dataset.settingsTab));
});

$$('[data-setting-control]').forEach((group) => group.addEventListener("click", (event) => {
  const button = event.target.closest("[data-value]");
  if (button) updateSiteSetting(group.dataset.settingControl, button.dataset.value);
}));

$$('[data-setting-select]').forEach((select) => select.addEventListener("change", () => {
  updateSiteSetting(select.dataset.settingSelect, select.value);
}));

$$('[data-setting-toggle]').forEach((toggle) => toggle.addEventListener("change", () => {
  updateSiteSetting(toggle.dataset.settingToggle, toggle.checked);
}));

$$('[data-setting-range]').forEach((range) => range.addEventListener("input", () => {
  updateSiteSetting(range.dataset.settingRange, range.value);
}));

$$('[data-copy-input]').forEach((input) => {
  input.addEventListener("input", () => {
    if (!editMode) return;
    const key = input.dataset.copyInput;
    siteCopy[key] = stripHtml(input.value).slice(0, input.maxLength > 0 ? input.maxLength : 180);
    applyCopy();
    saveCopy();
  });
  input.addEventListener("blur", () => {
    if (!editMode) return;
    const key = input.dataset.copyInput;
    if (!siteCopy[key].trim()) siteCopy[key] = DEFAULT_COPY[key];
    applyCopy();
    saveCopy();
  });
});

$$('[data-copy-key]').forEach((element) => {
  element.addEventListener("blur", () => {
    if (!editMode) return;
    const key = element.dataset.copyKey;
    const value = element.innerText.replace(/\n{3,}/g, "\n\n").trim();
    siteCopy[key] = value.slice(0, key === "heroTitle" ? 120 : key === "heroCopy" ? 180 : 80) || DEFAULT_COPY[key];
    applyCopy();
    saveCopy(true);
  });
  element.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && (element.dataset.copyKey !== "heroTitle" || event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      element.blur();
    }
  });
});

$("#resetSettingsButton").addEventListener("click", () => {
  if (!requireEditMode("恢复网站设置")) return;
  siteSettings = { ...DEFAULT_SETTINGS };
  siteCopy = { ...DEFAULT_COPY };
  applySiteSettings();
  applyCopy();
  saveSiteSettings();
  saveCopy();
  showToast("已恢复默认设置");
});

$("#mobileMenuButton").addEventListener("click", () => toggleMobileMenu(!document.body.classList.contains("mobile-menu-open")));
$("#mobileBackdrop").addEventListener("click", () => toggleMobileMenu(false));

document.addEventListener("keydown", (event) => {
  const modifier = event.ctrlKey || event.metaKey;
  if (modifier && event.key.toLowerCase() === "k") {
    event.preventDefault();
    $("#searchInput").focus();
  } else if (modifier && event.key.toLowerCase() === "s") {
    event.preventDefault();
    saveState(true);
  } else if (modifier && event.key.toLowerCase() === "n") {
    event.preventDefault();
    newEntry();
  } else if (event.key === "Escape") {
    closeActionMenu();
    toggleMobileMenu(false);
  }
});

window.addEventListener("popstate", () => {
  const match = location.hash.match(/^#article=(.+)$/);
  if (match) openArticle(decodeURIComponent(match[1]), false);
  else navigateCatalog(true);
});

window.addEventListener("storage", (event) => {
  if (event.key === SETTINGS_KEY && event.newValue) {
    siteSettings = normalizedSettings(readStoredObject(SETTINGS_KEY));
    applySiteSettings();
    showToast("已同步另一窗口中的网站设置");
    return;
  }
  if (event.key === COPY_KEY && event.newValue) {
    siteCopy = normalizedCopy(readStoredObject(COPY_KEY));
    applyCopy();
    showToast("已同步另一窗口中的首页文字");
    return;
  }
  if (event.key !== APP_KEY || !event.newValue) return;
  try {
    const saved = JSON.parse(event.newValue);
    if (!Array.isArray(saved.entries)) return;
    state.entries = saved.entries.map(normalizeEntry);
    if (state.screen === "article" && !activeEntry()) navigateCatalog(true);
    else if (state.screen === "article") renderArticle();
    else renderCatalog();
    hydrateStoredImages();
    showToast("已同步另一窗口中的更改");
  } catch (error) {
    console.warn("无法同步另一窗口中的数据。", error);
  }
});

globalThis.matchMedia?.("(prefers-color-scheme: dark)").addEventListener?.("change", () => {
  if (siteSettings.appearance === "system") applySiteSettings();
});
applyCopy();
applySiteSettings();
setEditMode(false, false);
$(".search-box kbd").textContent = navigator.userAgent.includes("Mac") ? "⌘ K" : "Ctrl K";
renderCatalog();
const initialArticle = location.hash.match(/^#article=(.+)$/);
if (initialArticle) openArticle(decodeURIComponent(initialArticle[1]), false);
hydrateStoredImages();
window.addEventListener("beforeunload", () => {
  managedObjectUrls.forEach((url) => URL.revokeObjectURL(url));
  managedObjectUrls.clear();
});
