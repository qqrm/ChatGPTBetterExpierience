import { describe, expect, it } from "vitest";
import { SETTINGS_DEFAULTS } from "../settings";
import { isElementVisible, isVisible, norm, normalizeSettings } from "../src/lib/utils";

describe("utils", () => {
  it("normalizes strings to lowercase", () => {
    expect(norm("HeLLo")).toBe("hello");
    expect(norm(null)).toBe("");
  });

  it("normalizes settings with defaults", () => {
    const input = {
      skipKey: "Alt",
      holdToSend: true,
      autoExpandChats: "no",
      autoTempChat: false,
      tempChatEnabled: "yes"
    } as Record<string, unknown>;

    const normalized = normalizeSettings(input);

    expect(normalized).toEqual({
      skipKey: "Alt",
      holdToSend: true,
      autoExpandChats: SETTINGS_DEFAULTS.autoExpandChats,
      autoTempChat: false,
      tempChatEnabled: SETTINGS_DEFAULTS.tempChatEnabled
    });
  });

  it("checks visibility based on bounding box", () => {
    const el = document.createElement("div");
    el.getBoundingClientRect = () => ({ width: 10, height: 10 }) as DOMRect;

    expect(isVisible(null)).toBe(false);
    expect(isVisible(el)).toBe(true);
  });

  it("checks element visibility using styles", () => {
    const el = document.createElement("div");
    el.getBoundingClientRect = () => ({ width: 10, height: 10 }) as DOMRect;
    document.body.appendChild(el);

    expect(isElementVisible(el)).toBe(true);

    el.style.display = "none";
    expect(isElementVisible(el)).toBe(false);

    el.style.display = "block";
    el.style.visibility = "hidden";
    expect(isElementVisible(el)).toBe(false);

    el.style.visibility = "visible";
    el.style.opacity = "0";
    expect(isElementVisible(el)).toBe(false);

    el.remove();
  });
});
