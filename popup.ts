import { SETTINGS_DEFAULTS } from "./settings";
import { StorageApi, storageGet, storageSet } from "./src/lib/storage";
import { normalizeSettings } from "./src/lib/utils";

declare const chrome: {
  runtime?: { lastError?: unknown };
  storage?: StorageApi;
};

declare const browser: {
  storage?: StorageApi;
};

function mustGetElement<T extends HTMLElement>(id: string) {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing element: ${id}`);
  return el as T;
}

const hintEl = mustGetElement<HTMLElement>("hint");
const selectEl = mustGetElement<HTMLSelectElement>("skipKey");
const holdEl = mustGetElement<HTMLInputElement>("holdToSend");
const autoExpandEl = mustGetElement<HTMLInputElement>("autoExpandChats");
const autoTempChatEl = mustGetElement<HTMLInputElement>("autoTempChat");

function setHint(skipKey: string, holdToSend: boolean) {
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

const storageApi = (
  (typeof browser !== "undefined" ? browser : chrome) as { storage?: StorageApi } | undefined
)?.storage;

const lastError = () => chrome?.runtime?.lastError ?? null;

async function load() {
  const data = await storageGet(SETTINGS_DEFAULTS, storageApi, lastError);
  const settings = normalizeSettings(data);

  selectEl.value = settings.skipKey;
  holdEl.checked = settings.holdToSend;
  autoExpandEl.checked = settings.autoExpandChats;
  autoTempChatEl.checked = settings.autoTempChat;

  setHint(settings.skipKey, settings.holdToSend);
}

async function save() {
  const skipKey = selectEl.value;
  const holdToSend = !!holdEl.checked;
  const autoExpandChats = !!autoExpandEl.checked;
  const autoTempChat = !!autoTempChatEl.checked;

  await storageSet(
    {
      skipKey,
      holdToSend,
      autoExpandChats,
      autoTempChat,
      tempChatEnabled: autoTempChat
    },
    storageApi,
    lastError
  );

  setHint(skipKey, holdToSend);
}

selectEl.addEventListener("change", () => void save().catch(() => {}));
holdEl.addEventListener("change", () => void save().catch(() => {}));
autoExpandEl.addEventListener("change", () => void save().catch(() => {}));
autoTempChatEl.addEventListener("change", () => void save().catch(() => {}));

void load().catch(() => {});
