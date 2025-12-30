import { SETTINGS_DEFAULTS, Settings } from "../domain/settings";
import { StorageApi, storageGet, storageSet } from "../lib/storage";
import { normalizeSettings } from "../lib/utils";

export interface PopupStorageDeps {
  storageApi: StorageApi | null | undefined;
  lastError: () => unknown;
}

export interface PopupSettingsState {
  settings: Settings;
  hint: string;
}

export function buildAutoSendHint(skipKey: string, holdToSend: boolean): string {
  if (skipKey === "None") {
    return holdToSend
      ? "Auto-send is disabled because no modifier key is selected."
      : "Auto-send always happens when you accept dictation.";
  }

  return holdToSend
    ? `Auto-send happens only while holding ${skipKey} when you accept dictation.`
    : `Hold ${skipKey} while accepting dictation to skip auto-send.`;
}

export async function loadPopupSettings({ storageApi, lastError }: PopupStorageDeps) {
  const data = await storageGet(SETTINGS_DEFAULTS, storageApi, lastError);
  const settings = normalizeSettings(data);
  return {
    settings,
    hint: buildAutoSendHint(settings.skipKey, settings.holdToSend)
  } satisfies PopupSettingsState;
}

export interface PopupSettingsInput {
  skipKey: string;
  holdToSend: boolean;
  autoExpandChats: boolean;
  autoTempChat: boolean;
  oneClickDelete: boolean;
}

export async function savePopupSettings(
  { storageApi, lastError }: PopupStorageDeps,
  input: PopupSettingsInput
) {
  await storageSet(
    {
      ...input,
      tempChatEnabled: input.autoTempChat
    },
    storageApi,
    lastError
  );

  return {
    hint: buildAutoSendHint(input.skipKey, input.holdToSend)
  };
}
