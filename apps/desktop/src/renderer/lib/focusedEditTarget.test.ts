// @vitest-environment jsdom

import { describe, expect, it } from "vitest";

import { isKeyboardOwnedFormControl, resolveFocusedEditTarget } from "./focusedEditTarget";

describe("focusedEditTarget", () => {
  it("detects editable text inputs", () => {
    const input = document.createElement("input");
    input.type = "text";

    expect(resolveFocusedEditTarget(input)).toBe("editable-text");
  });

  it("detects search inputs", () => {
    const input = document.createElement("input");
    input.type = "search";

    expect(resolveFocusedEditTarget(input)).toBe("editable-text");
  });

  it("detects textareas", () => {
    const textarea = document.createElement("textarea");

    expect(resolveFocusedEditTarget(textarea)).toBe("editable-text");
  });

  it("detects contenteditable descendants", () => {
    const wrapper = document.createElement("div");
    wrapper.setAttribute("contenteditable", "true");
    const child = document.createElement("span");
    wrapper.append(child);

    expect(resolveFocusedEditTarget(child)).toBe("editable-text");
  });

  it("classifies readonly text inputs separately", () => {
    const input = document.createElement("input");
    input.type = "email";
    input.readOnly = true;

    expect(resolveFocusedEditTarget(input)).toBe("readonly-text");
  });

  it("treats disabled text inputs as non-text", () => {
    const input = document.createElement("input");
    input.type = "text";
    input.disabled = true;

    expect(resolveFocusedEditTarget(input)).toBe("non-text");
  });

  it("rejects selects", () => {
    const select = document.createElement("select");

    expect(resolveFocusedEditTarget(select)).toBe("non-text");
    expect(isKeyboardOwnedFormControl(select)).toBe(true);
  });

  it("rejects color inputs", () => {
    const input = document.createElement("input");
    input.type = "color";

    expect(resolveFocusedEditTarget(input)).toBe("non-text");
  });

  it("rejects non-text input types", () => {
    const types = ["checkbox", "radio", "range", "file", "button"];

    for (const type of types) {
      const input = document.createElement("input");
      input.type = type;
      expect(resolveFocusedEditTarget(input)).toBe("non-text");
    }
  });

  it("honors editable custom markers", () => {
    const wrapper = document.createElement("div");
    wrapper.dataset.nativeTextEdit = "true";
    const child = document.createElement("span");
    wrapper.append(child);

    expect(resolveFocusedEditTarget(child)).toBe("editable-text");
  });

  it("honors readonly custom markers", () => {
    const wrapper = document.createElement("div");
    wrapper.dataset.nativeTextEdit = "readonly";
    const child = document.createElement("span");
    wrapper.append(child);

    expect(resolveFocusedEditTarget(child)).toBe("readonly-text");
  });
});
