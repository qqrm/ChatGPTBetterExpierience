const hintEl = document.getElementById("hint");
const selectEl = document.getElementById("skipKey");
const holdEl = document.getElementById("holdToSend");
const autoExpandEl = document.getElementById("autoExpandChats");
const autoTempChatEl = document.getElementById("autoTempChat");

function setHint(skipKey, holdToSend) {
    if (skipKey === "None") {
        hintEl.textContent = holdToSend
            ? "Auto-send is disabled because no modifier key is selected."
            : "Auto-send always happens when you accept dictation.";
        return;
    }

    hintEl.textContent = holdToSend
        ? `Auto-send happens only while holding ${skipKey} when you accept dictation.`
        : `Hold ${skipKey} while accepting dictation to skip auto-send.`;
}

function getStorageArea(preferSync = true) {
    const api = typeof browser !== "undefined" ? browser : chrome;
    const storage = api && api.storage ? api.storage : null;
    if (!storage) return null;
    if (preferSync && storage.sync) return storage.sync;
    if (storage.local) return storage.local;
    return null;
}

async function storageGet(keys) {
    const areaSync = getStorageArea(true);
    const areaLocal = getStorageArea(false);

    const tryGet = (area) =>
        new Promise((resolve, reject) => {
            try {
                const r = area.get(keys, (res) => {
                    const err = chrome && chrome.runtime ? chrome.runtime.lastError : null;
                    if (err) reject(err);
                    else resolve(res);
                });
                if (r && typeof r.then === "function") r.then(resolve, reject);
            } catch (e) {
                reject(e);
            }
        });

    try {
        if (areaSync) return await tryGet(areaSync);
    } catch { }

    if (areaLocal) return await tryGet(areaLocal);
    return {};
}

async function storageSet(obj) {
    const areaSync = getStorageArea(true);
    const areaLocal = getStorageArea(false);

    const trySet = (area) =>
        new Promise((resolve, reject) => {
            try {
                const r = area.set(obj, () => {
                    const err = chrome && chrome.runtime ? chrome.runtime.lastError : null;
                    if (err) reject(err);
                    else resolve();
                });
                if (r && typeof r.then === "function") r.then(resolve, reject);
            } catch (e) {
                reject(e);
            }
        });

    let syncOk = false;
    try {
        if (areaSync) {
            await trySet(areaSync);
            syncOk = true;
        }
    } catch { }

    if (!syncOk && areaLocal) {
        await trySet(areaLocal);
    }
}

async function load() {
    const data = await storageGet({
        skipKey: "Shift",
        holdToSend: false,
        autoExpandChats: true,
        autoTempChat: false
    });
    const skipKey = data && data.skipKey ? data.skipKey : "Shift";
    const holdToSend = !!(data && data.holdToSend);
    const autoExpandChats = data && "autoExpandChats" in data ? !!data.autoExpandChats : true;
    const autoTempChat = data && "autoTempChat" in data ? !!data.autoTempChat : false;

    selectEl.value = skipKey;
    holdEl.checked = holdToSend;
    autoExpandEl.checked = autoExpandChats;
    autoTempChatEl.checked = autoTempChat;

    setHint(skipKey, holdToSend);
}

async function save() {
    const skipKey = selectEl.value;
    const holdToSend = !!holdEl.checked;
    const autoExpandChats = !!autoExpandEl.checked;
    const autoTempChat = !!autoTempChatEl.checked;

    await storageSet({ skipKey, holdToSend, autoExpandChats, autoTempChat, tempChatEnabled: autoTempChat });

    setHint(skipKey, holdToSend);
}

selectEl.addEventListener("change", () => save().catch(() => { }));
holdEl.addEventListener("change", () => save().catch(() => { }));
autoExpandEl.addEventListener("change", () => save().catch(() => { }));
autoTempChatEl.addEventListener("change", () => save().catch(() => { }));

load().catch(() => { });
