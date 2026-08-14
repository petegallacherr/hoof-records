const CONFIG = window.HOOF_RECORDS_CONFIG;
if (!CONFIG) throw new Error("Hoof Records configuration did not load.");

const APP_VERSION = CONFIG.appVersion;
const DATA_SCHEMA_VERSION = CONFIG.dataSchemaVersion;
const KEYS = CONFIG.storageKeys;
const PHOTO_DB_NAME = CONFIG.photoDb.name;
const PHOTO_DB_VERSION = CONFIG.photoDb.version;
const PHOTO_STORE = CONFIG.photoDb.store;
const MAX_PHOTOS_PER_COW = CONFIG.photos.maxPerCow;
const MAX_PHOTO_LONG_SIDE = CONFIG.photos.maxLongSide;
const PHOTO_JPEG_QUALITY = CONFIG.photos.jpegQuality;
const VETLIFE_LOGO_URL = new URL(CONFIG.brand.logoUrl, window.location.href).href;
const REPORT_STYLESHEET_URL = new URL("./report.css", window.location.href).href;
const VETLIFE_LOGO_PDF_WIDTH = CONFIG.brand.logoWidth;
const VETLIFE_LOGO_PDF_HEIGHT = CONFIG.brand.logoHeight;

const state = {
  severity: "",
  foot: [],
  activeFoot: "",
  defaultTreatments: [],
  hoofDetails: {},
  lesion: "",
  treatment: [],
  outcome: [],
  pendingPhotos: [],
  activeSession: null,
  lastSavedRecord: null
};

const byId = id => document.getElementById(id);

async function tryLockPortraitOrientation() {
  try {
    if (screen.orientation && typeof screen.orientation.lock === "function") {
      await screen.orientation.lock("portrait");
    }
  } catch (error) {
    // Normal browser tabs may reject orientation locking.
    // The landscape rotate-device screen remains the fallback.
  }
}

window.addEventListener("load", tryLockPortraitOrientation);
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) tryLockPortraitOrientation();
});

function loadJSON(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem(key)) ?? fallback;
  } catch {
    return fallback;
  }
}

function saveJSON(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

function allRecords() {
  return loadJSON(KEYS.records, []);
}

function allSessions() {
  return loadJSON(KEYS.sessions, []);
}

function migrateRecordToSchema1(record) {
  const migrated = { ...record };

  migrated.foot = (Array.isArray(migrated.foot) ? migrated.foot : (migrated.foot ? [migrated.foot] : []))
    .map(normalizeFootCode)
    .filter(Boolean);

  migrated.treatment = Array.isArray(migrated.treatment)
    ? migrated.treatment
    : (migrated.treatment ? [migrated.treatment] : []);

  migrated.outcome = Array.isArray(migrated.outcome)
    ? migrated.outcome
    : (migrated.outcome ? [migrated.outcome] : []);

  migrated.photoIds = Array.isArray(migrated.photoIds) ? migrated.photoIds : [];

  if (Array.isArray(migrated.hoofDetails)) {
    migrated.hoofDetails = migrated.hoofDetails.map(detail => ({
      ...detail,
      foot: normalizeFootCode(detail.foot),
      treatment: Array.isArray(detail.treatment)
        ? detail.treatment
        : (detail.treatment ? [detail.treatment] : [])
    }));
  }

  return migrated;
}

function runDataMigrations() {
  const storedVersion = Number(localStorage.getItem(KEYS.schema) || 0);

  if (storedVersion > DATA_SCHEMA_VERSION) {
    console.warn(
      `Stored Hoof Records schema ${storedVersion} is newer than this app supports (${DATA_SCHEMA_VERSION}).`
    );
    return;
  }

  if (storedVersion < 1) {
    const records = allRecords().map(migrateRecordToSchema1);
    const sessions = allSessions();
    saveJSON(KEYS.records, records);
    saveJSON(KEYS.sessions, sessions);
  }

  localStorage.setItem(KEYS.schema, String(DATA_SCHEMA_VERSION));
}

let photoDbPromise = null;
let activePhotoModalRecordId = "";
let activePhotoModalUrls = [];

function openPhotoDb() {
  if (!("indexedDB" in window)) {
    return Promise.reject(new Error("IndexedDB is not available on this device."));
  }
  if (photoDbPromise) return photoDbPromise;

  photoDbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(PHOTO_DB_NAME, PHOTO_DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(PHOTO_STORE)) {
        const store = db.createObjectStore(PHOTO_STORE, { keyPath: "id" });
        store.createIndex("recordId", "recordId", { unique: false });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("Photo storage could not be opened."));
  });

  return photoDbPromise;
}

async function saveStoredPhoto(photo) {
  const db = await openPhotoDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(PHOTO_STORE, "readwrite");
    tx.objectStore(PHOTO_STORE).put(photo);
    tx.oncomplete = () => resolve(photo.id);
    tx.onerror = () => reject(tx.error || new Error("Photo could not be saved."));
    tx.onabort = () => reject(tx.error || new Error("Photo save was cancelled."));
  });
}

async function getStoredPhoto(photoId) {
  if (!photoId) return null;
  const db = await openPhotoDb();
  return new Promise((resolve, reject) => {
    const request = db.transaction(PHOTO_STORE, "readonly").objectStore(PHOTO_STORE).get(photoId);
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error || new Error("Photo could not be loaded."));
  });
}

async function getStoredPhotos(photoIds) {
  const ids = Array.isArray(photoIds) ? photoIds.filter(Boolean) : [];
  if (!ids.length) return [];
  const results = await Promise.all(ids.map(id =>
    getStoredPhoto(id).catch(error => {
      console.warn("Photo could not be loaded", id, error);
      return null;
    })
  ));
  return results.filter(Boolean);
}

async function deleteStoredPhotos(photoIds) {
  const ids = Array.isArray(photoIds) ? photoIds.filter(Boolean) : [];
  if (!ids.length) return;

  const db = await openPhotoDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(PHOTO_STORE, "readwrite");
    const store = tx.objectStore(PHOTO_STORE);
    ids.forEach(id => store.delete(id));
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error("Photos could not be deleted."));
  });
}

async function clearStoredPhotos() {
  const db = await openPhotoDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(PHOTO_STORE, "readwrite");
    tx.objectStore(PHOTO_STORE).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error("Photo storage could not be cleared."));
  });
}

async function getAllStoredPhotos() {
  const db = await openPhotoDb();
  return new Promise((resolve, reject) => {
    const request = db.transaction(PHOTO_STORE, "readonly").objectStore(PHOTO_STORE).getAll();
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error || new Error("Stored photos could not be read."));
  });
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error || new Error("Photo could not be prepared for backup."));
    reader.readAsDataURL(blob);
  });
}

async function dataUrlToBlob(dataUrl) {
  const response = await fetch(dataUrl);
  return response.blob();
}

function formatBytes(bytes) {
  const value = Number(bytes || 0);
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  if (value < 1024 * 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)} MB`;
  return `${(value / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

async function renderStorageStatus() {
  const status = byId("storageStatus");
  if (!status) return;

  const recordCount = allRecords().length;
  let photoCountStored = 0;
  try {
    photoCountStored = (await getAllStoredPhotos()).length;
  } catch (error) {
    console.warn("Photo count could not be read.", error);
  }

  let estimateText = "";
  if (navigator.storage && typeof navigator.storage.estimate === "function") {
    try {
      const estimate = await navigator.storage.estimate();
      estimateText = estimate.quota
        ? ` · ${formatBytes(estimate.usage)} used of approximately ${formatBytes(estimate.quota)} available`
        : ` · ${formatBytes(estimate.usage)} used`;
    } catch (error) {
      console.warn("Browser storage estimate unavailable.", error);
    }
  }

  status.textContent = `${recordCount} cow record${recordCount === 1 ? "" : "s"} · ${photoCountStored} stored photo${photoCountStored === 1 ? "" : "s"}${estimateText}`;
}

async function backupAllDeviceData() {
  const button = byId("backupAllDataBtn");
  const originalText = button.textContent;
  button.disabled = true;
  button.textContent = "Preparing backup…";

  try {
    const storedPhotos = await getAllStoredPhotos();
    const photos = [];

    for (const photo of storedPhotos) {
      photos.push({
        id: photo.id,
        recordId: photo.recordId,
        createdAt: photo.createdAt || "",
        type: photo.blob?.type || "image/jpeg",
        dataUrl: await blobToDataUrl(photo.blob)
      });
    }

    const payload = {
      kind: "hoof-records-backup",
      backupVersion: 1,
      appVersion: APP_VERSION,
      schemaVersion: DATA_SCHEMA_VERSION,
      exportedAt: new Date().toISOString(),
      records: allRecords(),
      sessions: allSessions(),
      activeSession: loadJSON(KEYS.active, null),
      photos
    };

    const blob = new Blob([JSON.stringify(payload)], { type: "application/json" });
    const date = new Date().toISOString().slice(0, 10);
    downloadBlob(blob, `hoof-records-full-backup-${date}.json`);
    showToast("Full device backup downloaded");
  } catch (error) {
    console.error(error);
    alert("The full backup could not be created. No data was changed.");
  } finally {
    button.disabled = false;
    button.textContent = originalText;
  }
}

async function restoreDeviceBackup(file) {
  if (!file) return;

  let payload;
  try {
    payload = JSON.parse(await file.text());
  } catch (error) {
    alert("That file is not a valid Hoof Records backup.");
    return;
  }

  if (
    !payload ||
    payload.kind !== "hoof-records-backup" ||
    !Array.isArray(payload.records) ||
    !Array.isArray(payload.sessions) ||
    !Array.isArray(payload.photos)
  ) {
    alert("That file is not a complete Hoof Records backup.");
    return;
  }

  const backupSchema = Number(payload.schemaVersion || 1);
  if (backupSchema > DATA_SCHEMA_VERSION) {
    alert(`This backup uses data schema ${backupSchema}, which is newer than this release supports (${DATA_SCHEMA_VERSION}).`);
    return;
  }

  const confirmed = confirm(
    `Restore this backup?\n\nIt contains ${payload.records.length} cow record${payload.records.length === 1 ? "" : "s"} and ${payload.photos.length} photo${payload.photos.length === 1 ? "" : "s"}.\n\nCurrent Hoof Records data on this browser will be replaced.`
  );
  if (!confirmed) return;

  const restoreButton = byId("restoreBackupBtn");
  const originalText = restoreButton.textContent;
  restoreButton.disabled = true;
  restoreButton.textContent = "Restoring…";

  try {
    saveJSON(KEYS.records, payload.records);
    saveJSON(KEYS.sessions, payload.sessions);

    if (payload.activeSession) {
      saveJSON(KEYS.active, payload.activeSession);
    } else {
      localStorage.removeItem(KEYS.active);
    }

    localStorage.setItem(KEYS.schema, String(backupSchema));

    await clearStoredPhotos();
    for (const photo of payload.photos) {
      if (!photo.id || !photo.recordId || !photo.dataUrl) continue;
      await saveStoredPhoto({
        id: photo.id,
        recordId: photo.recordId,
        blob: await dataUrlToBlob(photo.dataUrl),
        createdAt: photo.createdAt || new Date().toISOString()
      });
    }

    runDataMigrations();
    alert("Backup restored successfully. Hoof Records will now reload.");
    window.location.reload();
  } catch (error) {
    console.error(error);
    alert("The backup could not be fully restored. Please keep the backup file and contact IT before recording more data.");
  } finally {
    restoreButton.disabled = false;
    restoreButton.textContent = originalText;
  }
}

function photoCount(record) {
  return Array.isArray(record?.photoIds) ? record.photoIds.length : 0;
}

function photoReferenceText(record) {
  const count = photoCount(record);
  return count ? `Photo reference available (${count})` : "—";
}

function clearPendingPhotos() {
  state.pendingPhotos.forEach(photo => {
    if (photo.previewUrl) URL.revokeObjectURL(photo.previewUrl);
  });
  state.pendingPhotos = [];
  renderPendingPhotos();
  const takeInput = byId("takePhotoInput");
  const chooseInput = byId("choosePhotoInput");
  if (takeInput) takeInput.value = "";
  if (chooseInput) chooseInput.value = "";
}

function renderPendingPhotos() {
  const grid = byId("pendingPhotoGrid");
  if (!grid) return;

  grid.innerHTML = "";
  if (!state.pendingPhotos.length) {
    grid.innerHTML = '<div class="photo-empty">No photos added.</div>';
    return;
  }

  state.pendingPhotos.forEach((photo, index) => {
    const item = document.createElement("div");
    item.className = "pending-photo-item";

    const image = document.createElement("img");
    image.src = photo.previewUrl;
    image.alt = `Cow photo ${index + 1}`;

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "pending-photo-remove";
    remove.dataset.removePendingPhoto = photo.tempId;
    remove.setAttribute("aria-label", `Remove photo ${index + 1}`);
    remove.textContent = "×";

    item.appendChild(image);
    item.appendChild(remove);
    grid.appendChild(item);
  });
}

async function resizePhotoFile(file) {
  if (!file || !String(file.type || "").startsWith("image/")) {
    throw new Error("Only image files can be added.");
  }

  const sourceUrl = URL.createObjectURL(file);

  try {
    const image = await new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("That image could not be read."));
      img.src = sourceUrl;
    });

    const width = image.naturalWidth || image.width;
    const height = image.naturalHeight || image.height;
    const longSide = Math.max(width, height);
    const scale = longSide > MAX_PHOTO_LONG_SIDE
      ? MAX_PHOTO_LONG_SIDE / longSide
      : 1;

    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));

    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Photo processing is unavailable.");

    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);

    return await new Promise((resolve, reject) => {
      canvas.toBlob(
        blob => blob ? resolve(blob) : reject(new Error("Photo could not be resized.")),
        "image/jpeg",
        PHOTO_JPEG_QUALITY
      );
    });
  } finally {
    URL.revokeObjectURL(sourceUrl);
  }
}

async function addPhotoFiles(fileList) {
  const files = Array.from(fileList || []).filter(file =>
    String(file.type || "").startsWith("image/")
  );
  if (!files.length) return;

  const remaining = MAX_PHOTOS_PER_COW - state.pendingPhotos.length;
  if (remaining <= 0) {
    showToast(`Maximum ${MAX_PHOTOS_PER_COW} photos per cow.`, true);
    return;
  }

  const selected = files.slice(0, remaining);
  if (files.length > remaining) {
    showToast(`Only ${remaining} more photo${remaining === 1 ? "" : "s"} can be added.`, true);
  }

  for (const file of selected) {
    try {
      const blob = await resizePhotoFile(file);
      state.pendingPhotos.push({
        tempId: `pending-photo-${Date.now()}-${Math.random().toString(16).slice(2)}`,
        blob,
        previewUrl: URL.createObjectURL(blob),
        createdAt: new Date().toISOString()
      });
      renderPendingPhotos();
    } catch (error) {
      console.error(error);
      showToast("One photo could not be added.", true);
    }
  }
}

function vetReferenceSummary(record) {
  const lines = [
    `${record.farm || "Farm"}${record.mob ? " · " + record.mob : ""}`,
    `Cow ${record.cow} · Severity ${record.severity || "-"}`,
    hoofDetailsText(record) || record.lesion || "Lesion not recorded",
    `Treatment: ${(record.treatment || []).join(" + ") || "-"}`,
    `Outcome: ${outcomeText(record) || "-"}`
  ];
  if (record.notes) lines.push(`Notes: ${record.notes}`);
  return lines.join("\n");
}

function closePhotoModal() {
  activePhotoModalUrls.forEach(url => URL.revokeObjectURL(url));
  activePhotoModalUrls = [];
  activePhotoModalRecordId = "";
  byId("photoModal").classList.add("hidden");
  byId("photoModalGrid").innerHTML = "";
}

async function openPhotoModal(recordId) {
  const record = allRecords().find(item => item.id === recordId);
  if (!record || !photoCount(record)) {
    showToast("No photos are stored for this cow.", true);
    return;
  }

  closePhotoModal();
  activePhotoModalRecordId = record.id;
  byId("photoModalTitle").textContent = `Cow ${record.cow} photos`;
  byId("photoModalSummary").textContent =
    `${record.farm || "Farm"}${record.mob ? " · " + record.mob : ""} · ${photoCount(record)} photo${photoCount(record) === 1 ? "" : "s"}`;
  byId("photoModalGrid").innerHTML = '<div class="photo-empty">Loading photos…</div>';
  byId("photoModal").classList.remove("hidden");

  const photos = await getStoredPhotos(record.photoIds);
  if (!photos.length) {
    byId("photoModalGrid").innerHTML =
      '<div class="photo-empty">The photo references exist, but the image files could not be loaded.</div>';
    return;
  }

  const grid = byId("photoModalGrid");
  grid.innerHTML = "";

  photos.forEach((photo, index) => {
    const url = URL.createObjectURL(photo.blob);
    activePhotoModalUrls.push(url);

    const item = document.createElement("div");
    item.className = "modal-photo-item";

    const image = document.createElement("img");
    image.src = url;
    image.alt = `Cow ${record.cow} photo ${index + 1}`;

    item.appendChild(image);
    grid.appendChild(item);
  });
}

function safeFilePart(value) {
  return String(value || "")
    .trim()
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase() || "record";
}

async function shareVetReference(recordId) {
  const record = allRecords().find(item => item.id === recordId);
  if (!record || !photoCount(record)) {
    showToast("No photos are stored for this cow.", true);
    return;
  }

  const storedPhotos = await getStoredPhotos(record.photoIds);
  if (!storedPhotos.length) {
    showToast("The saved photos could not be loaded.", true);
    return;
  }

  const farmPart = safeFilePart(record.farm || "farm");
  const cowPart = safeFilePart(record.cow || "cow");
  const datePart = record.date || new Date().toISOString().slice(0, 10);

  const files = storedPhotos.map((photo, index) =>
    new File(
      [photo.blob],
      `vet-reference-${farmPart}-cow-${cowPart}-${datePart}-${index + 1}.jpg`,
      { type: photo.blob?.type || "image/jpeg" }
    )
  );

  const summary = vetReferenceSummary(record);
  const shareData = {
    title: `Vet reference - Cow ${record.cow}`,
    text: summary,
    files
  };

  if (
    navigator.share &&
    navigator.canShare &&
    navigator.canShare({ files })
  ) {
    try {
      await navigator.share(shareData);
      return;
    } catch (error) {
      if (error && error.name === "AbortError") return;
      console.warn("Vet photo sharing failed; using fallback.", error);
    }
  }

  files.forEach(file => downloadBlob(file, file.name));

  const subject = `Vet reference - ${record.farm || "Farm"} - Cow ${record.cow}`;
  const body = [
    "Hi,",
    "",
    "Please see the attached reference photos and cow details:",
    "",
    summary,
    "",
    "The photos have downloaded to this device because direct file sharing is not available in this browser. Please attach them before sending.",
    "",
    "Regards"
  ].join("\n");

  window.setTimeout(() => openOutlookEmail(subject, body), 350);
}

function showScreen(id) {
  document.querySelectorAll(".screen").forEach(s => s.classList.remove("active"));
  byId(id).classList.add("active");

  document.querySelectorAll("[data-nav]").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.nav === id);
  });

  const inSession = !!state.activeSession;
  byId("bottomNav").classList.toggle("hidden", !inSession || id === "recordScreen");
  byId("finishSessionBtn").classList.toggle("hidden", !inSession || id !== "recordScreen");

  if (id === "summaryScreen") renderSummary();
  if (id === "historyScreen") renderHistory();
}

function setSingleChoice(groupName, value) {
  state[groupName] = value;
  document.querySelectorAll(`[data-group="${groupName}"] button`).forEach(btn => {
    btn.classList.toggle("selected", btn.dataset.value === value);
  });
}

function setMultiChoice(groupName, values) {
  state[groupName] = [...values];
  document.querySelectorAll(`[data-group="${groupName}"] button`).forEach(btn => {
    btn.classList.toggle("selected", values.includes(btn.dataset.value));
  });
}

document.querySelectorAll("[data-group]").forEach(group => {
  const name = group.dataset.group;
  const multiple = group.dataset.multiple === "true";

  if (["foot", "lesion", "treatment"].includes(name)) return;

  group.querySelectorAll("button").forEach(button => {
    button.addEventListener("click", () => {
      const value = button.dataset.value;

      if (multiple) {
        const next = state[name].includes(value)
          ? state[name].filter(item => item !== value)
          : [...state[name], value];
        setMultiChoice(name, next);
        if (name === "treatment") updateMedicinePanels();
      } else {
        setSingleChoice(name, value);

        if (name === "severity") {
          state.defaultTreatments = ["3", "4", "5"].includes(value)
            ? ["Block", "NSAID"]
            : [];

          if (state.activeFoot && state.defaultTreatments.length) {
            const detail = state.hoofDetails[state.activeFoot] || { lesion: "", treatment: [] };
            detail.treatment = uniqueValues([...detail.treatment, ...state.defaultTreatments]);
            state.hoofDetails[state.activeFoot] = detail;
            setMultiChoice("treatment", detail.treatment);
            renderHoofAssignments();
            updateMedicinePanels();
            showToast("Block and NSAID added to the active hoof");
          }
        }
      }
    });
  });
});


function updateMedicinePanels() {
  const activeTreatments = uniqueValues([...assignedTreatmentArray(), ...state.treatment]);
  const nsaid = activeTreatments.includes("NSAID");
  const antibiotic = activeTreatments.includes("Antibiotic");
  const nerveBlock = activeTreatments.includes("Nerve");
  byId("nsaidDetails").classList.toggle("hidden", !nsaid);
  byId("antibioticDetails").classList.toggle("hidden", !antibiotic);
  byId("localAnaestheticDetails").classList.toggle("hidden", !nerveBlock);
}

function chosenDrug(prefix) {
  const selected = byId(prefix + "Drug").value;
  return selected === "Other" ? byId(prefix + "OtherDrug").value.trim() : selected;
}

function clearMedicine(prefix) {
  byId(prefix + "Drug").value = "";
  byId(prefix + "OtherDrug").value = "";
  byId(prefix + "OtherDrug").classList.add("hidden");
  byId(prefix + "MilkWhp").value = "";
  byId(prefix + "MeatWhp").value = "";
  byId(prefix + "MilkUnit").value = "hours";
  byId(prefix + "MeatUnit").value = "days";
}

function medicineText(r) {
  const bits = [];
  if (r.nsaidDrug) {
    bits.push(`${r.nsaidDrug}${r.nsaidDoseMl ? ` ${r.nsaidDoseMl} mL` : ""}`);
  }
  if (r.antibioticDrug) {
    bits.push(`${r.antibioticDrug}${r.antibioticDoseMl ? ` ${r.antibioticDoseMl} mL` : ""}`);
  }
  if (r.localAnaestheticDoseMl) {
    bits.push(`Local anaesthetic ${r.localAnaestheticDoseMl} mL`);
  }
  return bits.join(" + ");
}

function outcomeArray(record) {
  return Array.isArray(record.outcome)
    ? record.outcome
    : (record.outcome ? [record.outcome] : []);
}

function outcomeText(record) {
  return outcomeArray(record).join(" + ");
}

function normalizeFootCode(foot) {
  if (foot === "LH") return "LR";
  if (foot === "RH") return "RR";
  return foot || "";
}

function footArray(record) {
  const feet = Array.isArray(record.foot)
    ? record.foot
    : (record.foot ? [record.foot] : []);
  return feet.map(normalizeFootCode).filter(Boolean);
}

function footText(record) {
  return footArray(record).join(" + ");
}

function uniqueValues(values) {
  return [...new Set((values || []).filter(Boolean))];
}

function hoofDetailArray(record) {
  if (Array.isArray(record?.hoofDetails)) {
    return record.hoofDetails.filter(detail => detail && detail.foot).map(detail => ({
      foot: normalizeFootCode(detail.foot),
      lesion: detail.lesion || "",
      treatment: [...(detail.treatment || [])]
    }));
  }
  if (record?.hoofDetails && typeof record.hoofDetails === "object") {
    return Object.entries(record.hoofDetails).filter(([foot]) => !!foot).map(([foot, detail]) => ({
      foot: normalizeFootCode(foot),
      lesion: detail?.lesion || "",
      treatment: [...(detail?.treatment || [])]
    }));
  }
  const feet = footArray(record);
  if (feet.length) {
    return feet.map(foot => ({
      foot,
      lesion: record?.lesion || "",
      treatment: [...(record?.treatment || [])]
    }));
  }
  return [];
}

function hoofDetailsText(record) {
  const details = hoofDetailArray(record);
  if (!details.length) return "";
  return details.map(detail => {
    const treatmentText = (detail.treatment || []).join(" + ");
    return `${detail.foot}: ${detail.lesion || "No lesion"}${treatmentText ? " · " + treatmentText : ""}`;
  }).join("; ");
}

function assignedTreatmentArray() {
  return uniqueValues(hoofDetailArray(state).flatMap(detail => detail.treatment || []));
}

function renderHoofAssignments() {
  const preview = byId("hoofAssignmentsPreview");
  if (!preview) return;

  document.querySelectorAll('[data-group="foot"] button').forEach(button => {
    const detail = state.hoofDetails[button.dataset.value];
    const hasDetails = !!detail && (!!detail.lesion || (detail.treatment || []).length > 0);
    button.classList.toggle("has-details", hasDetails);
  });

  byId("activeHoofHeading").textContent = state.activeFoot
    ? `${state.activeFoot} hoof`
    : "Choose a hoof tab";

  const details = hoofDetailArray(state)
    .filter(detail => detail.lesion || (detail.treatment || []).length);
  if (!details.length) {
    preview.className = "hoof-assignments-preview empty";
    preview.textContent = "No hoof details added yet.";
    return;
  }
  preview.className = "hoof-assignments-preview";
  preview.innerHTML = details.map(detail => `
    <div class="hoof-assignment-item">
      <div>
        <strong>${detail.foot}</strong>
        <div>${detail.lesion || "No lesion selected"}</div>
        <div class="hoof-assignment-meta">${(detail.treatment || []).join(" + ") || "No treatment selected"}</div>
      </div>
      <button type="button" class="hoof-remove-btn" data-remove-hoof="${detail.foot}" aria-label="Remove ${detail.foot}">×</button>
    </div>
  `).join("");
}

function ensureActiveHoofDetail() {
  if (!state.activeFoot) return null;

  if (!state.hoofDetails[state.activeFoot]) {
    state.hoofDetails[state.activeFoot] = {
      lesion: "",
      treatment: [...state.defaultTreatments]
    };
  }

  return state.hoofDetails[state.activeFoot];
}

function selectHoofTab(foot) {
  state.activeFoot = foot;
  state.foot = [foot];

  const detail = ensureActiveHoofDetail();
  setMultiChoice("foot", [foot]);
  setSingleChoice("lesion", detail?.lesion || "");
  setMultiChoice("treatment", detail?.treatment || []);
  byId("activeHoofHeading").textContent = `${foot} hoof`;
  updateMedicinePanels();
  renderHoofAssignments();
}

function clearActiveHoof() {
  if (!state.activeFoot) {
    showToast("Select a hoof tab first.", true);
    return;
  }

  const hoof = state.activeFoot;
  delete state.hoofDetails[hoof];
  setSingleChoice("lesion", "");
  setMultiChoice("treatment", []);
  updateMedicinePanels();
  renderHoofAssignments();
  showToast(`${hoof} cleared`);
}

function makeSessionId() {
  return `session-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function startSession() {
  const farm = byId("farmInput").value.trim();
  const mob = byId("mobInput").value.trim();
  const operator = byId("operatorInput").value.trim();

  if (!farm) {
    alert("Enter the farm name.");
    byId("farmInput").focus();
    return;
  }

  state.activeSession = {
    id: makeSessionId(),
    farm,
    mob,
    operator,
    startDateTime: new Date().toISOString(),
    finished: false
  };

  saveJSON(KEYS.active, state.activeSession);

  const sessions = allSessions();
  sessions.push(state.activeSession);
  saveJSON(KEYS.sessions, sessions);

  updateSessionHeader();
  showScreen("recordScreen");
  setTimeout(() => byId("cowNumber").focus(), 200);
}

function updateSessionHeader() {
  if (!state.activeSession) return;
  byId("sessionFarm").textContent = state.activeSession.farm;
  const bits = [
    state.activeSession.mob || "No mob entered",
    state.activeSession.operator || "No operator"
  ];
  byId("sessionMeta").textContent = bits.join(" · ");
  byId("headerSubtitle").textContent = `${state.activeSession.farm}${state.activeSession.mob ? " · " + state.activeSession.mob : ""} · 2.5`;
  refreshSessionStats();
}

function recordsForSession(sessionId) {
  if (!sessionId) return [];
  return allRecords().filter(record => record.sessionId === sessionId);
}

function currentSessionRecords() {
  if (!state.activeSession) return [];
  return recordsForSession(state.activeSession.id);
}

function clearCowForm(focus = true) {
  byId("cowNumber").value = "";
  byId("notes").value = "";
  setSingleChoice("severity", "");
  state.activeFoot = "";
  state.defaultTreatments = [];
  state.hoofDetails = {};
  setMultiChoice("foot", []);
  setSingleChoice("lesion", "");
  setMultiChoice("treatment", []);
  setMultiChoice("outcome", []);
  clearMedicine("nsaid");
  clearMedicine("antibiotic");
  byId("nsaidDoseMl").value = "";
  byId("antibioticDoseMl").value = "";
  byId("localAnaestheticDoseMl").value = "";
  clearPendingPhotos();
  updateMedicinePanels();
  renderHoofAssignments();

  if (focus) {
    setTimeout(() => {
      byId("cowNumber").focus();
      byId("cowNumber").click();
    }, 150);
  }
}

function showToast(message, isError = false) {
  const toast = byId("toast");
  toast.textContent = message;
  toast.classList.toggle("error", isError);
  toast.classList.add("show");
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.remove("show"), 2200);
}

async function saveCow() {
  if (!state.activeSession) return;

  const cow = byId("cowNumber").value.trim();
  const hoofDetails = hoofDetailArray(state)
    .filter(detail => detail.lesion || (detail.treatment || []).length);
  const allTreatments = uniqueValues(hoofDetails.flatMap(detail => detail.treatment || []));

  if (!cow || !state.severity || !hoofDetails.length) {
    showToast("Cow number, score and at least one completed hoof tab are required.", true);
    return;
  }

  if (allTreatments.includes("NSAID") && !chosenDrug("nsaid")) {
    showToast("Select or enter the NSAID drug.", true);
    return;
  }
  if (allTreatments.includes("NSAID") && !byId("nsaidDoseMl").value) {
    showToast("Enter the NSAID dose in mL.", true);
    return;
  }
  if (allTreatments.includes("Antibiotic") && !chosenDrug("antibiotic")) {
    showToast("Select or enter the antibiotic drug.", true);
    return;
  }
  if (allTreatments.includes("Antibiotic") && !byId("antibioticDoseMl").value) {
    showToast("Enter the antibiotic dose in mL.", true);
    return;
  }
  if (allTreatments.includes("Nerve") && !byId("localAnaestheticDoseMl").value) {
    showToast("Enter the local anaesthetic dose in mL.", true);
    return;
  }

  const recordId = `record-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const photoIds = state.pendingPhotos.map((photo, index) =>
    `${recordId}-photo-${index + 1}`
  );

  const record = {
    id: recordId,
    sessionId: state.activeSession.id,
    date: new Date().toISOString().slice(0, 10),
    time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    farm: state.activeSession.farm,
    mob: state.activeSession.mob,
    operator: state.activeSession.operator,
    cow,
    severity: state.severity,
    foot: hoofDetails.map(detail => detail.foot),
    hoofDetails,
    lesion: uniqueValues(hoofDetails.map(detail => detail.lesion)).join(" + "),
    treatment: allTreatments,
    nsaidDoseMl: allTreatments.includes("NSAID") ? byId("nsaidDoseMl").value : "",
    nsaidDrug: allTreatments.includes("NSAID") ? chosenDrug("nsaid") : "",
    nsaidMilkWhp: allTreatments.includes("NSAID") ? byId("nsaidMilkWhp").value : "",
    nsaidMilkUnit: allTreatments.includes("NSAID") ? byId("nsaidMilkUnit").value : "",
    nsaidMeatWhp: allTreatments.includes("NSAID") ? byId("nsaidMeatWhp").value : "",
    nsaidMeatUnit: allTreatments.includes("NSAID") ? byId("nsaidMeatUnit").value : "",
    antibioticDoseMl: allTreatments.includes("Antibiotic") ? byId("antibioticDoseMl").value : "",
    antibioticDrug: allTreatments.includes("Antibiotic") ? chosenDrug("antibiotic") : "",
    antibioticMilkWhp: allTreatments.includes("Antibiotic") ? byId("antibioticMilkWhp").value : "",
    antibioticMilkUnit: allTreatments.includes("Antibiotic") ? byId("antibioticMilkUnit").value : "",
    antibioticMeatWhp: allTreatments.includes("Antibiotic") ? byId("antibioticMeatWhp").value : "",
    antibioticMeatUnit: allTreatments.includes("Antibiotic") ? byId("antibioticMeatUnit").value : "",
    outcome: [...state.outcome],
    localAnaestheticDoseMl: allTreatments.includes("Nerve") ? byId("localAnaestheticDoseMl").value : "",
    photoIds,
    notes: byId("notes").value.trim()
  };

  const saveButton = byId("saveCowBtn");
  const originalButtonText = saveButton.textContent;
  saveButton.disabled = true;
  saveButton.textContent = state.pendingPhotos.length ? "Saving photos…" : "Saving…";

  const storedPhotoIds = [];

  try {
    for (let index = 0; index < state.pendingPhotos.length; index += 1) {
      const pending = state.pendingPhotos[index];
      const photoId = photoIds[index];

      await saveStoredPhoto({
        id: photoId,
        recordId,
        blob: pending.blob,
        createdAt: pending.createdAt || new Date().toISOString()
      });
      storedPhotoIds.push(photoId);
    }

    const records = allRecords();
    records.push(record);
    saveJSON(KEYS.records, records);

    state.lastSavedRecord = record;
    byId("lastSaved").textContent =
      `Last saved: Cow ${record.cow} · Score ${record.severity} · ${footText(record)}` +
      `${hoofDetailsText(record) ? " · " + hoofDetailsText(record) : ""}` +
      `${photoCount(record) ? ` · 📷 ${photoCount(record)}` : ""}`;

    showToast(
      `Cow ${cow} saved${photoCount(record) ? ` with ${photoCount(record)} photo${photoCount(record) === 1 ? "" : "s"}` : ""}`
    );
    clearCowForm(true);
    refreshSessionStats();
  } catch (error) {
    console.error(error);
    if (storedPhotoIds.length) {
      deleteStoredPhotos(storedPhotoIds).catch(console.warn);
    }
    showToast("Cow could not be saved because photo storage failed.", true);
  } finally {
    saveButton.disabled = false;
    saveButton.textContent = originalButtonText;
  }
}

function repeatLastTreatment() {
  const last = state.lastSavedRecord || currentSessionRecords().slice(-1)[0];
  if (!last) {
    showToast("No previous cow to repeat.", true);
    return;
  }

  state.activeFoot = "";
  state.foot = [];
  state.hoofDetails = {};
  hoofDetailArray(last).forEach(detail => {
    state.hoofDetails[detail.foot] = {
      lesion: detail.lesion || "",
      treatment: [...(detail.treatment || [])]
    };
  });

  setMultiChoice("foot", []);
  setSingleChoice("lesion", "");
  setMultiChoice("treatment", []);
  setMultiChoice("outcome", Array.isArray(last.outcome) ? last.outcome : (last.outcome ? [last.outcome] : []));
  renderHoofAssignments();
  updateMedicinePanels();

  if ((last.treatment || []).includes("NSAID")) {
    const known = ["Metacam", "Key 10%"].includes(last.nsaidDrug);
    byId("nsaidDrug").value = known ? last.nsaidDrug : (last.nsaidDrug ? "Other" : "");
    byId("nsaidOtherDrug").value = known ? "" : (last.nsaidDrug || "");
    byId("nsaidOtherDrug").classList.toggle("hidden", known || !last.nsaidDrug);
    byId("nsaidDoseMl").value = last.nsaidDoseMl || "";
    byId("nsaidMilkWhp").value = last.nsaidMilkWhp || "";
    byId("nsaidMilkUnit").value = last.nsaidMilkUnit || "hours";
    byId("nsaidMeatWhp").value = last.nsaidMeatWhp || "";
    byId("nsaidMeatUnit").value = last.nsaidMeatUnit || "days";
  }

  if ((last.treatment || []).includes("Antibiotic")) {
    const known = ["Intracillin 300", "Depocillin"].includes(last.antibioticDrug);
    byId("antibioticDrug").value = known ? last.antibioticDrug : (last.antibioticDrug ? "Other" : "");
    byId("antibioticOtherDrug").value = known ? "" : (last.antibioticDrug || "");
    byId("antibioticOtherDrug").classList.toggle("hidden", known || !last.antibioticDrug);
    byId("antibioticDoseMl").value = last.antibioticDoseMl || "";
    byId("antibioticMilkWhp").value = last.antibioticMilkWhp || "";
    byId("antibioticMilkUnit").value = last.antibioticMilkUnit || "hours";
    byId("antibioticMeatWhp").value = last.antibioticMeatWhp || "";
    byId("antibioticMeatUnit").value = last.antibioticMeatUnit || "days";
  }

  byId("localAnaestheticDoseMl").value = last.localAnaestheticDoseMl || "";
  showToast("Last treatment details copied");
}

async function undoLastCow() {
  const sessionRecords = currentSessionRecords();

  if (!sessionRecords.length) {
    showToast("No cow to undo.", true);
    return;
  }

  const last = sessionRecords[sessionRecords.length - 1];

  if (!confirm(`Remove Cow ${last.cow}, the last saved cow?`)) return;

  const records = allRecords();
  const lastIndex = records.findIndex(record => record.id === last.id);

  if (lastIndex === -1) {
    showToast("The last cow could not be found in records.", true);
    return;
  }

  records.splice(lastIndex, 1);
  saveJSON(KEYS.records, records);

  if (photoCount(last)) {
    try {
      await deleteStoredPhotos(last.photoIds);
    } catch (error) {
      console.warn("Cow record removed but one or more stored photos could not be deleted.", error);
    }
  }

  const remaining = currentSessionRecords();
  state.lastSavedRecord = remaining.length
    ? remaining[remaining.length - 1]
    : null;

  byId("lastSaved").textContent = state.lastSavedRecord
    ? `Last saved: Cow ${state.lastSavedRecord.cow} · Score ${state.lastSavedRecord.severity} · ${footText(state.lastSavedRecord)}`
    : "No cows saved this session.";

  refreshSessionStats();
  renderSummary();
  renderHistory();

  showToast(`Cow ${last.cow} removed from records`);
}

function refreshSessionStats() {
  const records = currentSessionRecords();
  byId("sessionCount").textContent = records.length;
  byId("sideTotal").textContent = records.length;
  byId("sideHigh").textContent = records.filter(r => Number(r.severity) >= 4).length;
  byId("sideBlocks").textContent = records.filter(r => (r.treatment || []).includes("Block")).length;
  byId("sideRechecks").textContent = records.filter(r => (Array.isArray(r.outcome) ? r.outcome : [r.outcome]).includes("Revisit")).length;
}

function finishSession() {
  if (!state.activeSession) return;
  const records = currentSessionRecords();

  if (!records.length && !confirm("Finish this session without any cow records?")) return;

  state.activeSession.finished = true;
  state.activeSession.endDateTime = new Date().toISOString();

  saveJSON(KEYS.active, state.activeSession);

  const sessions = allSessions().map(s =>
    s.id === state.activeSession.id ? state.activeSession : s
  );
  saveJSON(KEYS.sessions, sessions);

  showScreen("summaryScreen");
}

function mostCommon(values) {
  const counts = {};
  values.filter(Boolean).forEach(v => counts[v] = (counts[v] || 0) + 1);
  return Object.entries(counts).sort((a,b) => b[1] - a[1])[0]?.[0] || "–";
}

function renderSummary() {
  if (!state.activeSession) return;

  const records = currentSessionRecords();
  byId("summaryTitle").textContent = state.activeSession.farm;
  byId("summarySub").textContent = [
    state.activeSession.mob,
    new Date(state.activeSession.startDateTime).toLocaleDateString(),
    `${records.length} cows recorded`
  ].filter(Boolean).join(" · ");

  byId("metricTotal").textContent = records.length;
  byId("metricAverage").textContent = records.length
    ? (records.reduce((sum, r) => sum + Number(r.severity), 0) / records.length).toFixed(1)
    : "–";
  byId("metricLesion").textContent = mostCommon(records.flatMap(r => hoofDetailArray(r).map(detail => detail.lesion)));
  byId("metricFoot").textContent = mostCommon(records.flatMap(r => footArray(r)));

  const body = byId("summaryTableBody");
  body.innerHTML = "";

  if (!records.length) {
    body.innerHTML = '<tr><td colspan="6" class="empty-cell">No records in this session.</td></tr>';
    return;
  }

  records.forEach(r => {
    const row = document.createElement("tr");
    [
      r.cow,
      r.severity,
      footText(r) || "—",
      hoofDetailsText(r) || (r.lesion || "—"),
      (r.treatment || []).join(" + ") || "—",
      r.notes || "—"
    ].forEach(value => {
      const td = document.createElement("td");
      td.textContent = value;
      row.appendChild(td);
    });
    body.appendChild(row);
  });
}


function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function countValues(values) {
  const counts = {};
  values.filter(Boolean).forEach(value => {
    counts[value] = (counts[value] || 0) + 1;
  });
  return Object.entries(counts).sort((a, b) => b[1] - a[1]);
}

function formatWithholding(value, unit) {
  if (value === "" || value === null || value === undefined) return "—";
  const numeric = Number(value);
  const label = numeric === 1
    ? String(unit || "").replace(/s$/, "")
    : (unit || "");
  return `${value} ${label}`.trim();
}

function createFarmerReport() {
  if (!state.activeSession) return;

  const records = currentSessionRecords();
  if (!records.length) {
    alert("There are no cow records in this session.");
    return;
  }

  const session = state.activeSession;
  const averageSeverity = (
    records.reduce((sum, record) => sum + Number(record.severity || 0), 0) / records.length
  ).toFixed(1);

  const highSeverity = records.filter(record => Number(record.severity) >= 4).length;
  const treatmentCounts = countValues(records.flatMap(record => record.treatment || []));
  const lesionCounts = countValues(records.flatMap(record => hoofDetailArray(record).map(detail => detail.lesion)));
  const footCounts = countValues(records.flatMap(record => footArray(record)));
  const outcomeCounts = countValues(records.flatMap(record => Array.isArray(record.outcome) ? record.outcome : (record.outcome ? [record.outcome] : [])));

  const revisitRecords = records.filter(record => {
    const outcomes = Array.isArray(record.outcome) ? record.outcome : (record.outcome ? [record.outcome] : []);
    return outcomes.some(outcome => ["Revisit", "Arrange Vet Visit", "Claw Amp Candidate"].includes(outcome));
  });

  const medicines = [];
  records.forEach(record => {
    if (record.nsaidDrug) {
      medicines.push({
        cow: record.cow,
        type: "NSAID",
        drug: record.nsaidDrug,
        dose: record.nsaidDoseMl ? `${record.nsaidDoseMl} mL` : "—",
        milk: formatWithholding(record.nsaidMilkWhp, record.nsaidMilkUnit),
        meat: formatWithholding(record.nsaidMeatWhp, record.nsaidMeatUnit)
      });
    }
    if (record.antibioticDrug) {
      medicines.push({
        cow: record.cow,
        type: "Antibiotic",
        drug: record.antibioticDrug,
        dose: record.antibioticDoseMl ? `${record.antibioticDoseMl} mL` : "—",
        milk: formatWithholding(record.antibioticMilkWhp, record.antibioticMilkUnit),
        meat: formatWithholding(record.antibioticMeatWhp, record.antibioticMeatUnit)
      });
    }
    if (record.localAnaestheticDoseMl) {
      medicines.push({
        cow: record.cow,
        type: "Nerve block",
        drug: "Local anaesthetic",
        dose: `${record.localAnaestheticDoseMl} mL`,
        milk: "—",
        meat: "—"
      });
    }
  });

  const breakdownRows = (entries, emptyText = "None recorded") =>
    entries.length
      ? entries.map(([name, count]) =>
          `<tr><td>${escapeHtml(name)}</td><td class="number">${count}</td></tr>`
        ).join("")
      : `<tr><td colspan="2" class="empty">${emptyText}</td></tr>`;

  const medicineRows = medicines.length
    ? medicines.map(item => `
        <tr>
          <td>${escapeHtml(item.cow)}</td>
          <td>${escapeHtml(item.type)}</td>
          <td>${escapeHtml(item.drug)}</td>
          <td>${escapeHtml(item.dose || "—")}</td>
          <td>${escapeHtml(item.milk)}</td>
          <td>${escapeHtml(item.meat)}</td>
        </tr>`).join("")
    : `<tr><td colspan="6" class="empty">No medicines recorded.</td></tr>`;

  const followUpRows = revisitRecords.length
    ? revisitRecords.map(record => `
        <tr>
          <td>${escapeHtml(record.cow)}</td>
          <td>${escapeHtml(record.severity)}</td>
          <td>${escapeHtml(footText(record) || "—")}</td>
          <td>${escapeHtml(hoofDetailsText(record) || record.lesion || "—")}</td>
          <td>${escapeHtml((Array.isArray(record.outcome) ? record.outcome : (record.outcome ? [record.outcome] : [])).join(" + ") || "—")}</td>
          <td>${escapeHtml(photoReferenceText(record))}</td>
          <td>${escapeHtml(record.notes || "—")}</td>
        </tr>`).join("")
    : `<tr><td colspan="7" class="empty">No revisit, veterinary visit, or claw amputation candidates recorded.</td></tr>`;

  const recordRows = records.map(record => `
    <tr>
      <td>${escapeHtml(record.cow)}</td>
      <td>${escapeHtml(record.severity)}</td>
      <td>${escapeHtml(footText(record) || "—")}</td>
      <td>${escapeHtml(hoofDetailsText(record) || record.lesion || "—")}</td>
      <td>${escapeHtml((record.treatment || []).join(" + ") || "—")}</td>
      <td>${escapeHtml((Array.isArray(record.outcome) ? record.outcome : (record.outcome ? [record.outcome] : [])).join(" + ") || "—")}</td>
      <td>${escapeHtml(photoReferenceText(record))}</td>
      <td>${escapeHtml(record.notes || "—")}</td>
    </tr>`).join("");

  const reportDate = new Date(session.startDateTime).toLocaleDateString();
  const generatedDate = new Date().toLocaleString();

  const reportHtml = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Hoof Trimming Report - ${escapeHtml(session.farm)}</title>
<link rel="stylesheet" href="${REPORT_STYLESHEET_URL}">
</head>
<body>
  <div class="toolbar">
    <button id="reportPrintBtn" class="print-btn" type="button">Print / Save PDF</button>
    <button id="reportCloseBtn" class="close-btn" type="button">Close</button>
  </div>

  <main class="page">
    <header class="report-header">
      <div class="brand">
        <img src="${VETLIFE_LOGO_URL}" alt="Vetlife Animal Health Partners" class="vetlife-report-logo">
        <div class="report-title-block">
          <h1>Hoof Trimming Report</h1>
          <p class="subtitle">Session findings and treatment record</p>
        </div>
      </div>
      <div class="report-meta">
        <div><strong>Report date:</strong> ${escapeHtml(reportDate)}</div>
        <div><strong>Generated:</strong> ${escapeHtml(generatedDate)}</div>
      </div>
    </header>

    <div class="report-body">
    <section class="details">
      <div class="detail"><span>Farm</span><strong>${escapeHtml(session.farm || "—")}</strong></div>
      <div class="detail"><span>Mob</span><strong>${escapeHtml(session.mob || "—")}</strong></div>
      <div class="detail"><span>Operator</span><strong>${escapeHtml(session.operator || "—")}</strong></div>
      <div class="detail"><span>Session started</span><strong>${escapeHtml(new Date(session.startDateTime).toLocaleString())}</strong></div>
      <div class="detail"><span>Session completed</span><strong>${escapeHtml(session.endDateTime ? new Date(session.endDateTime).toLocaleString() : "Not recorded")}</strong></div>
    </section>

    <section class="metrics">
      <div class="metric"><span>Cows examined</span><strong>${records.length}</strong></div>
      <div class="metric"><span>Average severity</span><strong>${averageSeverity}</strong></div>
      <div class="metric"><span>Severity 4–5</span><strong>${highSeverity}</strong></div>
      <div class="metric"><span>Follow-up cows</span><strong>${revisitRecords.length}</strong></div>
    </section>

    <section class="medicine-section">
      <h2 class="section-title">Medicines and withholding periods</h2>
      <p class="section-help">Each row shows exactly which animal received each medicine or nerve block treatment.</p>
      <table>
        <thead><tr><th>Cow</th><th>Treatment</th><th>Medicine</th><th>Dose</th><th>Milk WHP</th><th>Meat WHP</th></tr></thead>
        <tbody>${medicineRows}</tbody>
      </table>
    </section>

    <section class="two-col avoid-break">
      <div class="report-card">
        <h2>Lesion breakdown</h2>
        <table><thead><tr><th>Lesion</th><th class="number">Cows</th></tr></thead>
        <tbody>${breakdownRows(lesionCounts)}</tbody></table>
      </div>
      <div class="report-card">
        <h2>Treatments provided</h2>
        <table><thead><tr><th>Treatment</th><th class="number">Cows</th></tr></thead>
        <tbody>${breakdownRows(treatmentCounts)}</tbody></table>
      </div>
    </section>

    <section class="two-col avoid-break">
      <div class="report-card">
        <h2>Affected feet</h2>
        <table><thead><tr><th>Hoof/Hooves</th><th class="number">Cows</th></tr></thead>
        <tbody>${breakdownRows(footCounts)}</tbody></table>
      </div>
      <div class="report-card">
        <h2>Recorded outcomes</h2>
        <table><thead><tr><th>Outcome</th><th class="number">Cows</th></tr></thead>
        <tbody>${breakdownRows(outcomeCounts)}</tbody></table>
      </div>
    </section>

    <section class="follow-up-section">
      <h2 class="section-title">Follow-up list</h2>
      <table>
        <thead><tr><th>Cow</th><th>Severity</th><th>Hoof/Hooves</th><th>Lesion</th><th>Outcome(s)</th><th>Photos</th><th>Notes</th></tr></thead>
        <tbody>${followUpRows}</tbody>
      </table>
    </section>

    <section class="complete-section">
      <h2 class="section-title">Complete cow record</h2>
      <table>
        <thead><tr><th>Cow</th><th>Severity</th><th>Hoof/Hooves</th><th>Lesion</th><th>Treatment</th><th>Outcome(s)</th><th>Photos</th><th>Notes</th></tr></thead>
        <tbody>${recordRows}</tbody>
      </table>
    </section>

    <div class="note">
      This report records the lesions and treatments entered during the hoof-trimming session.
      It does not include farm-management recommendations or results of a Hooflife investigation.
      Treatment and withholding information must be recorded and entered as per the farms animal health plan.
      All treatments and cow identity details are recorded to the best of our abilities.  
    </div>

    <footer class="footer">
      Generated by Hoof Records V${escapeHtml(APP_VERSION)}
    </footer>
    </div>
  </main>
</body>
</html>`;

  const reportWindow = window.open("", "_blank");
  if (!reportWindow) {
    alert("The report window was blocked. Allow pop-ups for this page, then try again.");
    return;
  }

  reportWindow.document.open();
  reportWindow.document.write(reportHtml);
  reportWindow.document.close();

  const reportPrintBtn = reportWindow.document.getElementById("reportPrintBtn");
  const reportCloseBtn = reportWindow.document.getElementById("reportCloseBtn");
  reportPrintBtn?.addEventListener("click", () => reportWindow.print());
  reportCloseBtn?.addEventListener("click", () => reportWindow.close());
}


function pdfPlainText(value) {
  return String(value ?? "")
    .replace(/[–—]/g, "-")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[^\x20-\x7E]/g, "?");
}

function pdfEscapeText(value) {
  return pdfPlainText(value)
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)");
}

function wrapPdfText(value, maxChars = 88) {
  const text = pdfPlainText(value).trim();
  if (!text) return [""];

  const words = text.split(/\s+/);
  const lines = [];
  let line = "";

  words.forEach(word => {
    if (!line) {
      line = word;
      return;
    }
    if ((line + " " + word).length <= maxChars) {
      line += " " + word;
    } else {
      lines.push(line);
      line = word;
    }
  });

  if (line) lines.push(line);
  return lines;
}

async function buildFarmerReportPdfBlob(sessionOverride = null, recordsOverride = null) {
  const session = sessionOverride || state.activeSession;
  if (!session) return null;

  const records = Array.isArray(recordsOverride)
    ? recordsOverride
    : recordsForSession(session.id);

  if (!records.length) return null;

  const logoResponse = await fetch(VETLIFE_LOGO_URL);
  if (!logoResponse.ok) throw new Error("Vetlife report logo could not be loaded.");
  const logoBytes = new Uint8Array(await logoResponse.arrayBuffer());
  const vetlifeLogoPdfHex = Array.from(
    logoBytes,
    byte => byte.toString(16).padStart(2, "0")
  ).join("").toUpperCase();

  const averageSeverity = (
    records.reduce((sum, record) => sum + Number(record.severity || 0), 0) / records.length
  ).toFixed(1);

  const highSeverity = records.filter(record => Number(record.severity) >= 4).length;
  const treatmentCounts = countValues(records.flatMap(record => record.treatment || []));
  const lesionCounts = countValues(
    records.flatMap(record => hoofDetailArray(record).map(detail => detail.lesion))
  );
  const footCounts = countValues(records.flatMap(record => footArray(record)));
  const outcomeCounts = countValues(records.flatMap(record => outcomeArray(record)));

  const revisitRecords = records.filter(record =>
    outcomeArray(record).some(outcome =>
      ["Revisit", "Arrange Vet Visit", "Claw Amp Candidate"].includes(outcome)
    )
  );

  const medicines = [];
  records.forEach(record => {
    if (record.nsaidDrug) {
      medicines.push({
        cow: String(record.cow || "-"),
        treatment: "NSAID",
        medicine: record.nsaidDrug,
        dose: `${record.nsaidDoseMl || "-"} mL`,
        milk: formatWithholding(record.nsaidMilkWhp, record.nsaidMilkUnit),
        meat: formatWithholding(record.nsaidMeatWhp, record.nsaidMeatUnit)
      });
    }
    if (record.antibioticDrug) {
      medicines.push({
        cow: String(record.cow || "-"),
        treatment: "Antibiotic",
        medicine: record.antibioticDrug,
        dose: `${record.antibioticDoseMl || "-"} mL`,
        milk: formatWithholding(record.antibioticMilkWhp, record.antibioticMilkUnit),
        meat: formatWithholding(record.antibioticMeatWhp, record.antibioticMeatUnit)
      });
    }
    if (record.localAnaestheticDoseMl) {
      medicines.push({
        cow: String(record.cow || "-"),
        treatment: "Nerve block",
        medicine: "Local anaesthetic",
        dose: `${record.localAnaestheticDoseMl} mL`,
        milk: "-",
        meat: "-"
      });
    }
  });

  const pages = [[]];
  let pageIndex = 0;
  let y = 800;
  const left = 42;
  const bottom = 48;

  const currentPage = () => pages[pageIndex];

  function newPage() {
    pages.push([]);
    pageIndex += 1;
    y = 800;

    // Continuation-page header so shared PDFs retain the same report identity.
    fillRect(0, 812, 595, 30, 0.965, 0.945, 0.92);
    fillRect(0, 812, 8, 30, 0.655, 0.565, 0.459);
    currentPage().push(
      `BT /F2 9 Tf 0.26 0.21 0.16 rg ${left} 823 Td (HOOF TRIMMING REPORT - ${pdfEscapeText(session.farm || "Farm")}) Tj ET`
    );
    currentPage().push(
      `BT /F1 8 Tf 0.45 0.40 0.35 rg 465 823 Td (Page ${pageIndex + 1}) Tj ET`
    );
    y = 794;
  }

  function ensureSpace(height) {
    if (y - height < bottom) newPage();
  }

  function addText(value, size = 10, bold = false, x = left) {
    ensureSpace(size + 7);
    currentPage().push(
      `BT /${bold ? "F2" : "F1"} ${size} Tf ${x} ${y} Td (${pdfEscapeText(value)}) Tj ET`
    );
    y -= size + 5;
  }

  function addWrapped(value, size = 9, bold = false, x = left, maxChars = 88) {
    wrapPdfText(value, maxChars).forEach(line => addText(line, size, bold, x));
  }

  function addGap(amount) {
    ensureSpace(amount);
    y -= amount;
  }

  function addRule() {
    ensureSpace(8);
    currentPage().push(`0.55 w 0.72 0.67 0.61 RG ${left} ${y} m 553 ${y} l S`);
    y -= 8;
  }

  function fillRect(x, yPos, width, height, r, g, b) {
    currentPage().push(`q ${r} ${g} ${b} rg ${x} ${yPos} ${width} ${height} re f Q`);
  }

  function strokeRect(x, yPos, width, height, r = 0.82, g = 0.78, b = 0.73) {
    currentPage().push(`q 0.65 w ${r} ${g} ${b} RG ${x} ${yPos} ${width} ${height} re S Q`);
  }

  function addMetricBox(label, value, x, width, fillR, fillG, fillB) {
    fillRect(x, y - 54, width, 50, fillR, fillG, fillB);
    currentPage().push(`BT /F2 8 Tf 1 1 1 rg ${x + 9} ${y - 17} Td (${pdfEscapeText(label)}) Tj ET`);
    currentPage().push(`BT /F2 18 Tf 1 1 1 rg ${x + 9} ${y - 40} Td (${pdfEscapeText(value)}) Tj ET`);
  }

  function addHeading(value) {
    addGap(9);
    ensureSpace(32);

    // Small Vetlife-style section tab, matching the visual report more closely.
    fillRect(left, y - 23, 250, 23, 0.36, 0.29, 0.23);
    fillRect(left, y - 23, 6, 23, 0.655, 0.565, 0.459);
    currentPage().push(
      `BT /F2 10 Tf 1 1 1 rg ${left + 14} ${y - 15.5} Td (${pdfEscapeText(value)}) Tj ET`
    );
    y -= 31;
  }

  function addPdfCellText(value, x, yPos, size = 7.2, bold = false, white = false) {
    const color = white ? "1 1 1 rg" : "0.25 0.21 0.17 rg";
    currentPage().push(
      `BT /${bold ? "F2" : "F1"} ${size} Tf ${color} ${x} ${yPos} Td (${pdfEscapeText(value)}) Tj ET`
    );
  }

  function addMedicineTableHeader(widths) {
    const labels = ["COW", "TREATMENT", "MEDICINE", "DOSE", "MILK WHP", "MEAT WHP"];
    const rowHeight = 20;

    fillRect(left, y - rowHeight, 511, rowHeight, 0.47, 0.39, 0.31);

    let x = left;
    labels.forEach((label, index) => {
      addPdfCellText(label, x + 5, y - 13.5, 7, true, true);
      x += widths[index];
    });

    y -= rowHeight;
  }

  function addMedicineTable(rows) {
    const widths = [48, 82, 118, 62, 98, 103];
    const rowHeight = 20;

    addMedicineTableHeader(widths);

    rows.forEach((row, rowIndex) => {
      if (y - rowHeight < bottom) {
        newPage();
        addHeading("MEDICINES AND WITHHOLDING PERIODS - CONTINUED");
        addMedicineTableHeader(widths);
      }

      if (rowIndex % 2 === 1) {
        fillRect(left, y - rowHeight, 511, rowHeight, 0.975, 0.965, 0.95);
      }

      strokeRect(left, y - rowHeight, 511, rowHeight, 0.87, 0.83, 0.78);

      const values = [
        row.cow,
        row.treatment,
        row.medicine,
        row.dose,
        row.milk,
        row.meat
      ];

      let x = left;
      values.forEach((value, index) => {
        addPdfCellText(
          value || "-",
          x + 5,
          y - 13.5,
          index === 2 ? 6.9 : 7.2,
          index === 0 || index === 1,
          false
        );
        x += widths[index];
      });

      y -= rowHeight;
    });

    addGap(3);
  }

  function breakdownCardHeight(entries) {
    return 30 + Math.max(1, entries.length) * 18 + 8;
  }

  function drawBreakdownCard(title, entries, x, width, topY, height) {
    // Card background and border.
    fillRect(x, topY - height, width, height, 0.985, 0.978, 0.968);
    strokeRect(x, topY - height, width, height, 0.84, 0.80, 0.75);

    // Header strip.
    fillRect(x, topY - 25, width, 25, 0.47, 0.39, 0.31);
    fillRect(x, topY - 25, 5, 25, 0.655, 0.565, 0.459);
    addPdfCellText(title, x + 12, topY - 16.5, 8.3, true, true);

    let rowY = topY - 39;
    const rows = entries.length ? entries : [["None recorded", ""]];

    rows.forEach(([name, count], index) => {
      if (index % 2 === 1) {
        fillRect(x + 1, rowY - 12, width - 2, 17, 0.965, 0.95, 0.93);
      }

      addPdfCellText(name, x + 10, rowY, 7.8, false, false);

      if (count !== "") {
        addPdfCellText(String(count), x + width - 25, rowY, 8, true, false);
      }

      rowY -= 18;
    });
  }

  function addBreakdownCardPair(leftTitle, leftEntries, rightTitle, rightEntries) {
    addGap(10);

    const gap = 12;
    const width = (511 - gap) / 2;
    const height = Math.max(
      breakdownCardHeight(leftEntries),
      breakdownCardHeight(rightEntries)
    );

    ensureSpace(height + 4);

    const topY = y;
    drawBreakdownCard(leftTitle, leftEntries, left, width, topY, height);
    drawBreakdownCard(
      rightTitle,
      rightEntries,
      left + width + gap,
      width,
      topY,
      height
    );

    y -= height + 6;
  }

  function addRecordCard(record, compact = false) {
    const title = `Cow ${record.cow}  |  Severity ${record.severity}`;
    const hoofLine = `Hoof/Hooves: ${footText(record) || "-"}`;
    const lesionLine = `Lesion: ${hoofDetailsText(record) || record.lesion || "-"}`;
    const treatmentLine =
      `Treatment: ${(record.treatment || []).join(" + ") || "-"} | Outcome: ${outcomeText(record) || "-"}` +
      `${photoCount(record) ? ` | Photos: ${photoCount(record)}` : ""}`;

    const noteLine = record.notes ? `Notes: ${record.notes}` : "";
    const lines = [
      ...wrapPdfText(hoofLine, 80),
      ...wrapPdfText(lesionLine, 80),
      ...wrapPdfText(treatmentLine, 80),
      ...(noteLine ? wrapPdfText(noteLine, 80) : [])
    ];

    const bodyLineHeight = compact ? 11 : 12;
    const height = 29 + Math.max(2, lines.length) * bodyLineHeight + 10;

    ensureSpace(height + 7);

    const topY = y;
    fillRect(left, topY - height, 511, height, 0.985, 0.978, 0.968);
    strokeRect(left, topY - height, 511, height, 0.84, 0.80, 0.75);

    fillRect(left, topY - 25, 511, 25, 0.47, 0.39, 0.31);
    fillRect(left, topY - 25, 6, 25, 0.655, 0.565, 0.459);
    addPdfCellText(title, left + 14, topY - 16.5, 8.5, true, true);

    let textY = topY - 40;
    lines.forEach((line, index) => {
      const isLabelLine =
        index === 0 ||
        line.startsWith("Lesion:") ||
        line.startsWith("Treatment:") ||
        line.startsWith("Notes:");

      addPdfCellText(
        line,
        left + 13,
        textY,
        compact ? 7.4 : 7.7,
        isLabelLine && index === 0,
        false
      );
      textY -= bodyLineHeight;
    });

    y -= height + 7;
  }

  function addNoteCard(text) {
    const lines = wrapPdfText(text, 92);
    const height = 25 + lines.length * 10 + 13;

    ensureSpace(height + 5);

    fillRect(left, y - height, 511, height, 0.965, 0.95, 0.93);
    strokeRect(left, y - height, 511, height, 0.84, 0.80, 0.75);
    fillRect(left, y - height, 6, height, 0.655, 0.565, 0.459);

    addPdfCellText("IMPORTANT NOTE", left + 14, y - 17, 8.5, true, false);

    let textY = y - 31;
    lines.forEach(line => {
      addPdfCellText(line, left + 14, textY, 7.1, false, false);
      textY -= 10;
    });

    y -= height + 5;
  }

  fillRect(0, 742, 595, 100, 0.965, 0.945, 0.92);
  fillRect(0, 742, 8, 100, 0.655, 0.565, 0.459);
  currentPage().push(`q 145 0 0 63 ${left} 764 cm /Im1 Do Q`);
  currentPage().push(`BT /F2 20 Tf 0.26 0.21 0.16 rg ${left + 168} 796 Td (HOOF TRIMMING REPORT) Tj ET`);
  currentPage().push(`BT /F1 10 Tf 0.45 0.40 0.35 rg ${left + 168} 778 Td (Session findings and treatment record) Tj ET`);

  y = 724;
  fillRect(left, y - 72, 511, 68, 0.965, 0.95, 0.93);
  strokeRect(left, y - 72, 511, 68);
  currentPage().push(`BT /F2 10 Tf 0.26 0.21 0.16 rg ${left + 12} ${y - 20} Td (Farm: ${pdfEscapeText(session.farm || "-")}) Tj ET`);
  currentPage().push(`BT /F1 9 Tf 0.30 0.25 0.21 rg ${left + 12} ${y - 37} Td (Mob: ${pdfEscapeText(session.mob || "-")}) Tj ET`);
  currentPage().push(`BT /F1 9 Tf 0.30 0.25 0.21 rg ${left + 12} ${y - 53} Td (Operator: ${pdfEscapeText(session.operator || "-")}) Tj ET`);
  currentPage().push(`BT /F1 8 Tf 0.45 0.40 0.35 rg ${left + 260} ${y - 22} Td (Started: ${pdfEscapeText(new Date(session.startDateTime).toLocaleString())}) Tj ET`);
  currentPage().push(`BT /F1 8 Tf 0.45 0.40 0.35 rg ${left + 260} ${y - 39} Td (Completed: ${pdfEscapeText(session.endDateTime ? new Date(session.endDateTime).toLocaleString() : "Not recorded")}) Tj ET`);

  y -= 86;
  const metricGap = 8;
  const metricWidth = (511 - metricGap * 3) / 4;
  addMetricBox("COWS EXAMINED", String(records.length), left, metricWidth, 0.36, 0.29, 0.23);
  addMetricBox("AVG SEVERITY", String(averageSeverity), left + (metricWidth + metricGap), metricWidth, 0.42, 0.35, 0.28);
  addMetricBox("SEVERITY 4-5", String(highSeverity), left + (metricWidth + metricGap) * 2, metricWidth, 0.48, 0.40, 0.32);
  addMetricBox("FOLLOW-UP", String(revisitRecords.length), left + (metricWidth + metricGap) * 3, metricWidth, 0.655, 0.565, 0.459);
  y -= 66;

  addHeading("MEDICINES AND WITHHOLDING PERIODS");
  if (!medicines.length) {
    addText("No medicines recorded.", 9, false, left + 8);
  } else {
    addMedicineTable(medicines);
  }

  addBreakdownCardPair(
    "LESION BREAKDOWN",
    lesionCounts,
    "TREATMENTS PROVIDED",
    treatmentCounts
  );

  addBreakdownCardPair(
    "AFFECTED FEET",
    footCounts,
    "RECORDED OUTCOMES",
    outcomeCounts
  );

  addHeading("FOLLOW-UP LIST");
  if (!revisitRecords.length) {
    fillRect(left, y - 34, 511, 34, 0.985, 0.978, 0.968);
    strokeRect(left, y - 34, 511, 34, 0.84, 0.80, 0.75);
    addPdfCellText(
      "No revisit, veterinary visit, or claw amputation candidates recorded.",
      left + 12,
      y - 21,
      8,
      false,
      false
    );
    y -= 40;
  } else {
    revisitRecords.forEach(record => addRecordCard(record, true));
  }

  addHeading("COMPLETE COW RECORD");
  records.forEach(record => addRecordCard(record, false));

  addHeading("IMPORTANT NOTE");
  addNoteCard(
    "This report records the lesions and treatments entered during the hoof-trimming session. It does not include farm-management recommendations or results of a Hooflife investigation. Treatment and withholding information must be recorded and entered as per the farm's animal health plan. All treatments and cow identity details are recorded to the best of our abilities."
  );

  const totalPages = pages.length;
  pages.forEach((commands, index) => {
    commands.push(
      `BT /F1 8 Tf ${left} 24 Td (Generated by Hoof Records V${pdfEscapeText(APP_VERSION)} - Page ${index + 1} of ${totalPages}) Tj ET`
    );
  });

  const objects = [];
  objects[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  objects[3] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>";
  objects[4] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>";
  objects[5] =
    `<< /Type /XObject /Subtype /Image /Width ${VETLIFE_LOGO_PDF_WIDTH} /Height ${VETLIFE_LOGO_PDF_HEIGHT} ` +
    `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter [/ASCIIHexDecode /DCTDecode] /Length ${vetlifeLogoPdfHex.length + 1} >>\nstream\n${vetlifeLogoPdfHex}>\nendstream`;

  const kids = [];
  pages.forEach((commands, index) => {
    const pageId = 6 + index * 2;
    const contentId = pageId + 1;
    kids.push(`${pageId} 0 R`);
    const stream = commands.join("\n");

    objects[pageId] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] ` +
      `/Resources << /Font << /F1 3 0 R /F2 4 0 R >> /XObject << /Im1 5 0 R >> >> ` +
      `/Contents ${contentId} 0 R >>`;

    objects[contentId] =
      `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
  });

  objects[2] =
    `<< /Type /Pages /Kids [${kids.join(" ")}] /Count ${pages.length} >>`;

  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  const maxId = objects.length - 1;

  for (let id = 1; id <= maxId; id += 1) {
    offsets[id] = pdf.length;
    pdf += `${id} 0 obj\n${objects[id]}\nendobj\n`;
  }

  const xrefOffset = pdf.length;
  pdf += `xref\n0 ${maxId + 1}\n`;
  pdf += "0000000000 65535 f \n";

  for (let id = 1; id <= maxId; id += 1) {
    pdf += `${String(offsets[id]).padStart(10, "0")} 00000 n \n`;
  }

  pdf +=
    `trailer\n<< /Size ${maxId + 1} /Root 1 0 R >>\n` +
    `startxref\n${xrefOffset}\n%%EOF`;

  return new Blob([pdf], { type: "application/pdf" });
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function shareFarmerReportForSession(session, records) {
  if (!session) return;

  if (!records.length) {
    alert("There are no cow records in this session.");
    return;
  }

  let reportBlob;
  try {
    reportBlob = await buildFarmerReportPdfBlob(session, records);
  } catch (error) {
    console.error(error);
    alert("The Farmer Report PDF could not be generated. Please reopen the app and try again.");
    return;
  }
  if (!reportBlob) return;

  const farm = session.farm || "Farm";
  const mob = session.mob || "";
  const reportDate = new Date(session.startDateTime || Date.now())
    .toISOString()
    .slice(0, 10);

  const safeFarm =
    farm.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase() ||
    "farm";

  const filename =
    `hoof-trimming-report-${safeFarm}-${reportDate}.pdf`;

  const file = new File([reportBlob], filename, {
    type: "application/pdf"
  });

  const shareData = {
    title: `Hoof Trimming Report - ${farm}`,
    text: `Hoof trimming report for ${farm}${mob ? ", " + mob : ""}.`,
    files: [file]
  };

  if (
    navigator.share &&
    navigator.canShare &&
    navigator.canShare({ files: [file] })
  ) {
    try {
      await navigator.share(shareData);
      return;
    } catch (error) {
      if (error && error.name === "AbortError") return;
      console.warn(
        "Direct file sharing was unavailable; using fallback.",
        error
      );
    }
  }

  downloadBlob(reportBlob, filename);

  const subject =
    `Hoof Trimming Report - ${farm} - ${reportDate}`;

  const body = [
    "Hi,",
    "",
    `Please find the hoof trimming report for ${farm}${mob ? ", " + mob : ""}, dated ${reportDate}.`,
    "",
    `Your device could not attach the PDF directly from the browser, so "${filename}" has been downloaded. Please attach it before sending.`,
    "",
    "Regards"
  ].join("\n");

  window.setTimeout(
    () => openOutlookEmail(subject, body),
    350
  );
}

async function shareFarmerReport() {
  if (!state.activeSession) return;
  return shareFarmerReportForSession(
    state.activeSession,
    currentSessionRecords()
  );
}

async function shareStoredSessionReport(sessionId) {
  const session = allSessions().find(item => item.id === sessionId);
  if (!session) {
    alert("That saved session could not be found.");
    return;
  }

  const records = recordsForSession(sessionId);
  return shareFarmerReportForSession(session, records);
}

function openOutlookEmail(subjectText, bodyText) {
  const mailto =
    `mailto:?subject=${encodeURIComponent(subjectText)}&body=${encodeURIComponent(bodyText)}`;
  window.location.href = mailto;
}

function exportRecords(records, filename) {
  if (!records.length) {
    alert("There are no records to export.");
    return;
  }

  const headers = [
    "Date", "Time", "Farm", "Mob", "Operator",
    "Cow Number", "Severity", "Hoof/Hooves", "Hoof Details", "Lesion", "Treatment",
    "NSAID Drug", "NSAID Dose mL", "NSAID Milk WHP", "NSAID Milk Unit", "NSAID Meat WHP", "NSAID Meat Unit",
    "Antibiotic Drug", "Antibiotic Dose mL", "Antibiotic Milk WHP", "Antibiotic Milk Unit", "Antibiotic Meat WHP", "Antibiotic Meat Unit",
    "Local Anaesthetic Dose mL", "Outcome(s)", "Notes"
  ];

  const rows = records.map(r => [
    r.date, r.time, r.farm, r.mob, r.operator,
    r.cow, r.severity, footText(r), hoofDetailsText(r), r.lesion, (r.treatment || []).join(" + "),
    r.nsaidDrug || "", r.nsaidDoseMl || "", r.nsaidMilkWhp || "", r.nsaidMilkUnit || "", r.nsaidMeatWhp || "", r.nsaidMeatUnit || "",
    r.antibioticDrug || "", r.antibioticDoseMl || "", r.antibioticMilkWhp || "", r.antibioticMilkUnit || "", r.antibioticMeatWhp || "", r.antibioticMeatUnit || "",
    r.localAnaestheticDoseMl || "", (Array.isArray(r.outcome) ? r.outcome : (r.outcome ? [r.outcome] : [])).join(" + "), r.notes
  ]);

  const escapeCsv = value => `"${String(value ?? "").replace(/"/g, '""')}"`;
  const csv = [headers, ...rows]
    .map(row => row.map(escapeCsv).join(","))
    .join("\n");

  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function renderHistorySessions() {
  const sessionList = byId("historySessionList");
  if (!sessionList) return;

  const records = allRecords();
  const sessions = allSessions()
    .map(session => ({
      session,
      records: records.filter(record => record.sessionId === session.id)
    }))
    .filter(item => item.records.length)
    .sort((a, b) =>
      new Date(b.session.startDateTime || 0) - new Date(a.session.startDateTime || 0)
    );

  sessionList.innerHTML = "";

  if (!sessions.length) {
    sessionList.innerHTML =
      '<div class="last-saved">No saved sessions with cow records yet.</div>';
    return;
  }

  sessions.forEach(({ session, records: sessionRecords }) => {
    const item = document.createElement("div");
    item.className = "history-session-item";

    const main = document.createElement("div");
    main.className = "history-session-main";

    const title = document.createElement("strong");
    title.textContent = session.farm || "Unnamed farm";

    const meta = document.createElement("span");
    const dateText = session.startDateTime
      ? new Date(session.startDateTime).toLocaleDateString()
      : (sessionRecords[0]?.date || "Date not recorded");

    meta.textContent = [
      dateText,
      session.mob || "No mob",
      `${sessionRecords.length} cow${sessionRecords.length === 1 ? "" : "s"}`
    ].join(" · ");

    const button = document.createElement("button");
    button.type = "button";
    button.className = "secondary-button";
    button.dataset.resendSessionReport = session.id;
    button.textContent = "Resend Farmer Report";

    main.appendChild(title);
    main.appendChild(meta);
    item.appendChild(main);
    item.appendChild(button);
    sessionList.appendChild(item);
  });
}

function renderHistory() {
  renderHistorySessions();
  renderStorageStatus();

  const query = byId("historySearch").value.trim().toLowerCase();
  const records = allRecords()
    .slice()
    .reverse()
    .filter(r => [
      r.date, r.farm, r.mob, r.cow, r.severity, footText(r),
      r.lesion, hoofDetailsText(r), (r.treatment || []).join(" "), r.notes
    ].join(" ").toLowerCase().includes(query));

  const body = byId("historyTableBody");
  body.innerHTML = "";

  if (!records.length) {
    body.innerHTML = '<tr><td colspan="10" class="empty-cell">No matching records.</td></tr>';
    return;
  }

  records.forEach(r => {
    const row = document.createElement("tr");
    [
      r.date,
      r.farm,
      r.mob || "—",
      r.cow,
      r.severity,
      footText(r) || "—",
      hoofDetailsText(r) || (r.lesion || "—"),
      (r.treatment || []).join(" + ") || "—"
    ].forEach(value => {
      const td = document.createElement("td");
      td.textContent = value;
      row.appendChild(td);
    });

    const photosTd = document.createElement("td");
    if (photoCount(r)) {
      const photoButton = document.createElement("button");
      photoButton.type = "button";
      photoButton.className = "history-photo-button";
      photoButton.dataset.viewCowPhotos = r.id;
      photoButton.textContent = `📷 ${photoCount(r)}`;
      photosTd.appendChild(photoButton);
    } else {
      photosTd.textContent = "—";
    }
    row.appendChild(photosTd);

    const vetTd = document.createElement("td");
    if (photoCount(r)) {
      const vetButton = document.createElement("button");
      vetButton.type = "button";
      vetButton.className = "history-vet-button";
      vetButton.dataset.shareVetReference = r.id;
      vetButton.textContent = "Share with Vet";
      vetTd.appendChild(vetButton);
    } else {
      vetTd.textContent = "—";
    }
    row.appendChild(vetTd);

    body.appendChild(row);
  });
}

function newSession() {
  state.activeSession = null;
  state.lastSavedRecord = null;
  localStorage.removeItem(KEYS.active);
  byId("farmInput").value = "";
  byId("mobInput").value = "";
  byId("headerSubtitle").textContent = "Private lameness recording · 2.5";
  byId("lastSaved").textContent = "No cows saved this session.";
  clearCowForm(false);
  showScreen("startScreen");
}

document.querySelectorAll('[data-group="foot"] button').forEach(button => {
  button.addEventListener("click", () => selectHoofTab(button.dataset.value));
});

document.querySelectorAll('[data-group="lesion"] button').forEach(button => {
  button.addEventListener("click", () => {
    if (!state.activeFoot) {
      showToast("Choose a hoof tab first.", true);
      return;
    }

    const detail = ensureActiveHoofDetail();
    detail.lesion = button.dataset.value;

    // Footrot workflow: automatically add Antibiotic to this hoof.
    // It remains manually deselectable if required.
    const antibioticAdded =
      detail.lesion === "Footrot" &&
      !detail.treatment.includes("Antibiotic");

    if (antibioticAdded) {
      detail.treatment = [...detail.treatment, "Antibiotic"];
    }

    setSingleChoice("lesion", detail.lesion);
    setMultiChoice("treatment", detail.treatment);
    renderHoofAssignments();
    updateMedicinePanels();

    if (antibioticAdded) {
      showToast("Antibiotic added for Footrot");
    }
  });
});

document.querySelectorAll('[data-group="treatment"] button').forEach(button => {
  button.addEventListener("click", () => {
    if (!state.activeFoot) {
      showToast("Choose a hoof tab first.", true);
      return;
    }

    const detail = ensureActiveHoofDetail();
    const value = button.dataset.value;
    detail.treatment = detail.treatment.includes(value)
      ? detail.treatment.filter(item => item !== value)
      : [...detail.treatment, value];

    setMultiChoice("treatment", detail.treatment);
    renderHoofAssignments();
    updateMedicinePanels();
  });
});

let cowNumberBlurAt = 0;
let intentionalNotesTap = false;
let movingFromCowNumber = false;

function moveCowNumberToHoofTabs() {
  const cowNumber = byId("cowNumber");
  if (!cowNumber.value.trim()) {
    showToast("Enter the cow number first.", true);
    cowNumber.focus();
    return;
  }

  if (movingFromCowNumber) return;
  movingFromCowNumber = true;

  // Close whichever field the phone keyboard has moved focus to.
  if (document.activeElement && typeof document.activeElement.blur === "function") {
    document.activeElement.blur();
  }

  // Move the page to hoof selection without selecting a hoof automatically.
  window.setTimeout(() => {
    const hoofTabsSection = byId("hoofTabsSection");
    if (hoofTabsSection) {
      hoofTabsSection.scrollIntoView({
        behavior: "smooth",
        block: "start"
      });
    }

    movingFromCowNumber = false;
    intentionalNotesTap = false;
  }, 100);
}

const cowNumberInput = byId("cowNumber");
const cowNumberNextTarget = byId("cowNumberNextTarget");
const notesInput = byId("notes");

// Android/Chrome and hardware keyboards normally send Enter.
["keydown", "keyup"].forEach(eventName => {
  cowNumberInput.addEventListener(eventName, event => {
    if (event.key !== "Enter") return;

    event.preventDefault();
    event.stopPropagation();

    if (eventName === "keydown") {
      moveCowNumberToHoofTabs();
    }
  });
});

// iPhone/iPad and some Android keyboards treat the keypad "Next" button as
// native focus navigation instead of an Enter key. The hidden target catches
// that navigation before it can reach Notes.
cowNumberNextTarget.addEventListener("focus", () => {
  moveCowNumberToHoofTabs();
});

// Fallback for browsers that skip the hidden target and move directly from
// Cow number to Notes. A deliberate tap on Notes is still allowed.
cowNumberInput.addEventListener("blur", () => {
  cowNumberBlurAt = Date.now();
});

notesInput.addEventListener("pointerdown", () => {
  intentionalNotesTap = true;
});

notesInput.addEventListener("touchstart", () => {
  intentionalNotesTap = true;
}, { passive: true });

notesInput.addEventListener("focus", () => {
  const cameStraightFromCowNumber =
    Date.now() - cowNumberBlurAt < 1200;

  if (cameStraightFromCowNumber && !intentionalNotesTap) {
    window.setTimeout(moveCowNumberToHoofTabs, 0);
    return;
  }

  intentionalNotesTap = false;
});

byId("takePhotoBtn").addEventListener("click", () => {
  if (state.pendingPhotos.length >= MAX_PHOTOS_PER_COW) {
    showToast(`Maximum ${MAX_PHOTOS_PER_COW} photos per cow.`, true);
    return;
  }
  byId("takePhotoInput").click();
});

byId("choosePhotoBtn").addEventListener("click", () => {
  if (state.pendingPhotos.length >= MAX_PHOTOS_PER_COW) {
    showToast(`Maximum ${MAX_PHOTOS_PER_COW} photos per cow.`, true);
    return;
  }
  byId("choosePhotoInput").click();
});

byId("takePhotoInput").addEventListener("change", async event => {
  await addPhotoFiles(event.target.files);
  event.target.value = "";
});

byId("choosePhotoInput").addEventListener("change", async event => {
  await addPhotoFiles(event.target.files);
  event.target.value = "";
});

byId("pendingPhotoGrid").addEventListener("click", event => {
  const button = event.target.closest("[data-remove-pending-photo]");
  if (!button) return;

  const index = state.pendingPhotos.findIndex(
    photo => photo.tempId === button.dataset.removePendingPhoto
  );
  if (index === -1) return;

  const [removed] = state.pendingPhotos.splice(index, 1);
  if (removed?.previewUrl) URL.revokeObjectURL(removed.previewUrl);
  renderPendingPhotos();
});

byId("historyTableBody").addEventListener("click", event => {
  const viewButton = event.target.closest("[data-view-cow-photos]");
  if (viewButton) {
    openPhotoModal(viewButton.dataset.viewCowPhotos);
    return;
  }

  const shareButton = event.target.closest("[data-share-vet-reference]");
  if (shareButton) {
    shareVetReference(shareButton.dataset.shareVetReference);
  }
});

byId("photoModalCloseBtn").addEventListener("click", closePhotoModal);
byId("photoModalCloseBottomBtn").addEventListener("click", closePhotoModal);
byId("photoModal").addEventListener("click", event => {
  if (event.target === byId("photoModal")) closePhotoModal();
});
byId("photoModalShareBtn").addEventListener("click", () => {
  if (activePhotoModalRecordId) shareVetReference(activePhotoModalRecordId);
});

byId("startSessionBtn").addEventListener("click", startSession);
byId("viewPreviousSessionsBtn").addEventListener("click", () => {
  showScreen("historyScreen");
});
byId("saveCowBtn").addEventListener("click", saveCow);
byId("clearCowBtn").addEventListener("click", () => clearCowForm(true));
byId("repeatLastBtn").addEventListener("click", repeatLastTreatment);
byId("undoBtn").addEventListener("click", undoLastCow);
byId("finishSessionBtn").addEventListener("click", finishSession);
byId("newSessionBtn").addEventListener("click", newSession);
byId("farmerReportBtn").addEventListener("click", createFarmerReport);
byId("shareFarmerReportBtn").addEventListener("click", shareFarmerReport);
byId("clearActiveHoofBtn").addEventListener("click", clearActiveHoof);
byId("clearHoofAssignmentsBtn").addEventListener("click", () => {
  state.activeFoot = "";
  state.foot = [];
  state.hoofDetails = {};
  setMultiChoice("foot", []);
  setSingleChoice("lesion", "");
  setMultiChoice("treatment", []);
  renderHoofAssignments();
  updateMedicinePanels();
  showToast("All hoof details cleared");
});
byId("hoofAssignmentsPreview").addEventListener("click", event => {
  const button = event.target.closest("[data-remove-hoof]");
  if (!button) return;

  const hoof = button.dataset.removeHoof;
  delete state.hoofDetails[hoof];

  if (state.activeFoot === hoof) {
    state.activeFoot = "";
    state.foot = [];
    setMultiChoice("foot", []);
    setSingleChoice("lesion", "");
    setMultiChoice("treatment", []);
  }

  renderHoofAssignments();
  updateMedicinePanels();
});

byId("exportCsvBtn").addEventListener("click", () => {
  if (!state.activeSession) return;

  const exportDate = new Date().toISOString().slice(0,10);
  const filename =
    `hoof-records-${state.activeSession.farm.replace(/\s+/g, "-").toLowerCase()}-${exportDate}.csv`;

  exportRecords(currentSessionRecords(), filename);

  const farm = state.activeSession.farm || "Farm";
  const mob = state.activeSession.mob || "Mob";
  const subject = `Hoof Records CSV - ${farm} - ${mob} - ${exportDate}`;
  const body = [
    "Hi,",
    "",
    `Please find attached the hoof records CSV for ${farm}, ${mob}, dated ${exportDate}.`,
    "",
    `The file "${filename}" has downloaded to this device.`,
    "Please attach it from the Downloads folder before sending.",
    "",
    "Regards"
  ].join("\\n");

  window.setTimeout(() => openOutlookEmail(subject, body), 350);
});

byId("exportAllBtn").addEventListener("click", () => {
  const exportDate = new Date().toISOString().slice(0,10);
  const filename = `hoof-records-all-${exportDate}.csv`;

  exportRecords(allRecords(), filename);

  const subject = `All Hoof Records CSV - ${exportDate}`;
  const body = [
    "Hi,",
    "",
    "Please find attached the complete hoof records CSV export.",
    "",
    `The file "${filename}" has downloaded to this device.`,
    "Please attach it from the Downloads folder before sending.",
    "",
    "Regards"
  ].join("\\n");

  window.setTimeout(() => openOutlookEmail(subject, body), 350);
});

byId("backToRecordsBtn").addEventListener("click", () => showScreen("historyScreen"));
byId("historyBackBtn").addEventListener("click", () => {
  showScreen(state.activeSession ? "summaryScreen" : "startScreen");
});

byId("historySearch").addEventListener("input", renderHistory);

byId("historySessionList").addEventListener("click", event => {
  const button = event.target.closest("[data-resend-session-report]");
  if (!button) return;

  shareStoredSessionReport(button.dataset.resendSessionReport);
});


function applyMedicineDefaults(prefix, drug) {
  byId(prefix + "OtherDrug").classList.toggle("hidden", drug !== "Other");

  const defaults = CONFIG.medicines[prefix]?.[drug];
  if (!defaults) {
    byId(prefix + "MilkWhp").value = "";
    byId(prefix + "MeatWhp").value = "";
    byId(prefix + "MilkUnit").value = "hours";
    byId(prefix + "MeatUnit").value = "days";
    return;
  }

  byId(prefix + "MilkWhp").value = String(defaults.milk.value);
  byId(prefix + "MilkUnit").value = defaults.milk.unit;
  byId(prefix + "MeatWhp").value = String(defaults.meat.value);
  byId(prefix + "MeatUnit").value = defaults.meat.unit;
}

byId("nsaidDrug").addEventListener("change", event => {
  applyMedicineDefaults("nsaid", event.target.value);
});

byId("antibioticDrug").addEventListener("change", event => {
  applyMedicineDefaults("antibiotic", event.target.value);
});

byId("clearAllBtn").addEventListener("click", async () => {
  if (!confirm("Delete all saved records, sessions, and cow photos from this device?")) return;
  localStorage.removeItem(KEYS.records);
  localStorage.removeItem(KEYS.sessions);
  localStorage.removeItem(KEYS.active);
  localStorage.setItem(KEYS.schema, String(DATA_SCHEMA_VERSION));
  try {
    await clearStoredPhotos();
  } catch (error) {
    console.warn("Records were cleared, but photo storage could not be fully cleared.", error);
  }
  renderHistory();
});

byId("backupAllDataBtn").addEventListener("click", backupAllDeviceData);
byId("restoreBackupBtn").addEventListener("click", () => byId("restoreBackupInput").click());
byId("restoreBackupInput").addEventListener("change", async event => {
  const file = event.target.files?.[0];
  event.target.value = "";
  await restoreDeviceBackup(file);
});

document.querySelectorAll("[data-nav]").forEach(button => {
  button.addEventListener("click", () => showScreen(button.dataset.nav));
});

runDataMigrations();
updateMedicinePanels();
const restored = loadJSON(KEYS.active, null);
if (restored && !restored.finished) {
  state.activeSession = restored;
  state.lastSavedRecord = currentSessionRecords().slice(-1)[0] || null;
  updateSessionHeader();
  if (state.lastSavedRecord) {
    byId("lastSaved").textContent =
      `Last saved: Cow ${state.lastSavedRecord.cow} · Score ${state.lastSavedRecord.severity} · ${footText(state.lastSavedRecord)}` +
      `${photoCount(state.lastSavedRecord) ? ` · 📷 ${photoCount(state.lastSavedRecord)}` : ""}`;
  }
  showScreen("recordScreen");
} else {
  showScreen("startScreen");
}
// PWA_INSTALL_LOGIC_V2
let deferredInstallPrompt=null;
const installAppBtn=document.getElementById("installAppBtn");
const standalone=window.matchMedia("(display-mode: standalone)").matches||navigator.standalone===true;
if(installAppBtn&&!standalone) installAppBtn.classList.remove("hidden");
window.addEventListener("beforeinstallprompt",e=>{e.preventDefault();deferredInstallPrompt=e;installAppBtn?.classList.remove("hidden");});
installAppBtn?.addEventListener("click",async()=>{if(deferredInstallPrompt){deferredInstallPrompt.prompt();await deferredInstallPrompt.userChoice;deferredInstallPrompt=null;}else{alert(/iphone|ipad|ipod/i.test(navigator.userAgent)?"In Safari, tap Share, then Add to Home Screen.":"Open your browser menu and choose Install app or Add to Home screen.");}});
window.addEventListener("appinstalled",()=>installAppBtn?.classList.add("hidden"));
if("serviceWorker" in navigator){window.addEventListener("load",()=>navigator.serviceWorker.register("./sw.js").catch(console.error));}
