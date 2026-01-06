import { describe, expect, it } from "vitest";
import { buildWideChatStyleText, updateWideChatStyle } from "../../src/application/wideChat";

describe("wide chat style", () => {
  it("builds consistent CSS for the same inputs", () => {
    const cssText = buildWideChatStyleText({
      basePx: 600,
      wideChatWidth: 50,
      windowWidth: 1000
    });

    expect(cssText).toContain("--wide-chat-target-max-width");
    expect(cssText).toContain("--wide-chat-side-margin");
    expect(cssText).toContain("--wide-chat-max-allowed");
  });

  it("skips reapplying identical styles", () => {
    const style = document.createElement("style");
    const inputs = {
      basePx: 640,
      wideChatWidth: 40,
      windowWidth: 1200
    };

    expect(updateWideChatStyle(style, inputs)).toBe(true);
    const firstText = style.textContent;

    expect(updateWideChatStyle(style, inputs)).toBe(false);
    expect(style.textContent).toBe(firstText);

    expect(updateWideChatStyle(style, { ...inputs, windowWidth: 1400 })).toBe(true);
  });
});
