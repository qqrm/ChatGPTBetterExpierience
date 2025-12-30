import { startContentScript } from "./src/application/contentScript";
import { StorageApi } from "./src/lib/storage";

declare const chrome: {
  runtime?: { lastError?: unknown };
  storage?: StorageApi;
};

declare const browser: {
  storage?: StorageApi;
};

const storageApi = (
  (typeof browser !== "undefined" ? browser : chrome) as { storage?: StorageApi } | undefined
)?.storage;

const lastError = () => chrome?.runtime?.lastError ?? null;

startContentScript({ storageApi, lastError });
