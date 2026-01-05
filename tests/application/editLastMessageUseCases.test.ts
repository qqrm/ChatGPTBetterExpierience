import { describe, expect, it } from "vitest";
import { shouldTriggerArrowUpEdit } from "../../src/application/editLastMessageUseCases";

describe("shouldTriggerArrowUpEdit", () => {
  it("requires the feature to be enabled and the key to be ArrowUp", () => {
    expect(
      shouldTriggerArrowUpEdit({
        enabled: false,
        key: "ArrowUp",
        inputText: ""
      })
    ).toBe(false);

    expect(
      shouldTriggerArrowUpEdit({
        enabled: true,
        key: "Enter",
        inputText: ""
      })
    ).toBe(false);
  });

  it("skips when modifiers or composition are active", () => {
    expect(
      shouldTriggerArrowUpEdit({
        enabled: true,
        key: "ArrowUp",
        inputText: "",
        shiftKey: true
      })
    ).toBe(false);

    expect(
      shouldTriggerArrowUpEdit({
        enabled: true,
        key: "ArrowUp",
        inputText: "",
        isComposing: true
      })
    ).toBe(false);
  });

  it("triggers only when the input is empty", () => {
    expect(
      shouldTriggerArrowUpEdit({
        enabled: true,
        key: "ArrowUp",
        inputText: "Hello"
      })
    ).toBe(false);

    expect(
      shouldTriggerArrowUpEdit({
        enabled: true,
        key: "ArrowUp",
        inputText: "   "
      })
    ).toBe(true);
  });
});
