import { loadPopupSettings, savePopupSettings } from "./src/application/popupUseCases";
import { StorageApi } from "./src/lib/storage";

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
const oneClickDeleteEl = mustGetElement<HTMLInputElement>("oneClickDelete");

const storageApi = (
  (typeof browser !== "undefined" ? browser : chrome) as { storage?: StorageApi } | undefined
)?.storage;

const lastError = () => chrome?.runtime?.lastError ?? null;

const popupDeps = { storageApi, lastError };

async function load() {
  const { settings, hint } = await loadPopupSettings(popupDeps);

  selectEl.value = settings.skipKey;
  holdEl.checked = settings.holdToSend;
  autoExpandEl.checked = settings.autoExpandChats;
  autoTempChatEl.checked = settings.autoTempChat;
  oneClickDeleteEl.checked = settings.oneClickDelete;

  hintEl.textContent = hint;
}

async function save() {
  const input = {
    skipKey: selectEl.value,
    holdToSend: !!holdEl.checked,
    autoExpandChats: !!autoExpandEl.checked,
    autoTempChat: !!autoTempChatEl.checked,
    oneClickDelete: !!oneClickDeleteEl.checked
  };

  const { hint } = await savePopupSettings(popupDeps, input);
  hintEl.textContent = hint;
}

selectEl.addEventListener("change", () => void save().catch(() => {}));
holdEl.addEventListener("change", () => void save().catch(() => {}));
autoExpandEl.addEventListener("change", () => void save().catch(() => {}));
autoTempChatEl.addEventListener("change", () => void save().catch(() => {}));
oneClickDeleteEl.addEventListener("change", () => void save().catch(() => {}));

void load().catch(() => {});
