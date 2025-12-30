export interface Settings {
  skipKey: string;
  holdToSend: boolean;
  autoExpandChats: boolean;
  autoTempChat: boolean;
  tempChatEnabled: boolean;
  oneClickDelete: boolean;
}

export type SettingsRecord = Settings & Record<string, unknown>;

export const SETTINGS_DEFAULTS: SettingsRecord = {
  skipKey: "Shift",
  holdToSend: false,
  autoExpandChats: true,
  autoTempChat: false,
  tempChatEnabled: false,
  oneClickDelete: false
};
