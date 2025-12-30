export interface Settings {
  skipKey: string;
  holdToSend: boolean;
  allowAutoSendInCodex: boolean;
  autoExpandChats: boolean;
  autoTempChat: boolean;
  tempChatEnabled: boolean;
  oneClickDelete: boolean;
}

export type SettingsRecord = Settings & Record<string, unknown>;

export const SETTINGS_DEFAULTS: SettingsRecord = {
  skipKey: "Shift",
  holdToSend: false,
  allowAutoSendInCodex: false,
  autoExpandChats: true,
  autoTempChat: false,
  tempChatEnabled: false,
  oneClickDelete: false
};
