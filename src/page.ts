// These two functions are injected into the web page with chrome.scripting.executeScript,
// which serializes each function on its own. They must not reference anything outside
// their own body.

export interface Field {
  id: string;
  kind: string;
  label: string;
  placeholder?: string;
  required?: boolean;
  value?: string;
  checked?: boolean;
  group?: string;
  options?: string[];
  /** Passwords, payment details and file pickers: the person fills these in themselves. */
  manual?: boolean;
}

export interface PageSnapshot {
  title: string;
  url: string;
  text: string;
  textTruncated: boolean;
  fields: Field[];
}

export interface Fill {
  id: string;
  value: string;
}

export interface FillResult {
  label: string;
  value: string;
}

export function snapshotPage(): PageSnapshot {
  const MAX_TEXT = 20000;
  const MAX_LINKS = 80;
  let links = 0;
  const clean = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim().slice(0, 200);

  const isManual = (el: Element) => {
    if (!(el instanceof HTMLInputElement)) return false;
    if (el.type === "password" || el.type === "file") return true;
    if (el.type === "checkbox" || el.type === "radio") return false;
    return /cc-|card.?(number|num|no)\b|ccnum|cvv|cvc|security.?code/.test(`${el.autocomplete} ${el.name} ${el.id}`.toLowerCase());
  };

  const labelOf = (el: HTMLElement) => {
    const labelled = (el.getAttribute("aria-labelledby") ?? "")
      .split(/\s+/)
      .map((id) => document.getElementById(id)?.innerText)
      .join(" ");
    const own = "labels" in el ? (el as HTMLInputElement).labels?.[0]?.innerText : "";
    return (
      clean(own) ||
      clean(el.getAttribute("aria-label")) ||
      clean(labelled) ||
      clean(el.getAttribute("placeholder")) ||
      clean(el.title) ||
      clean(el instanceof HTMLInputElement && /submit|button/.test(el.type) ? el.value : el.innerText) ||
      clean(el.getAttribute("name"))
    );
  };

  document.querySelectorAll("[data-luma-id]").forEach((el) => el.removeAttribute("data-luma-id"));

  const fields: Field[] = [];
  const candidates = document.querySelectorAll<HTMLElement>(
    "input:not([type=hidden]), textarea, select, button, [role=button], a[href]",
  );
  for (const el of candidates) {
    const style = getComputedStyle(el);
    if (el.getClientRects().length === 0 || style.visibility === "hidden") continue;
    if ((el as HTMLInputElement).disabled) continue;
    const isLink = el instanceof HTMLAnchorElement && el.getAttribute("role") !== "button";
    if (isLink && (!labelOf(el) || ++links > MAX_LINKS)) continue;

    const id = `f${fields.length + 1}`;
    el.setAttribute("data-luma-id", id);
    const field: Field = { id, kind: isLink ? "link" : "button", label: labelOf(el) };

    if (el instanceof HTMLSelectElement) {
      field.kind = "select";
      field.options = [...el.options].map((o) => clean(o.text)).filter(Boolean);
      field.value = clean(el.selectedOptions[0]?.text);
      field.required = el.required;
    } else if (el instanceof HTMLTextAreaElement) {
      field.kind = "textarea";
      field.value = el.value;
      field.required = el.required;
    } else if (el instanceof HTMLInputElement && !/submit|button|reset|image/.test(el.type)) {
      field.kind = el.type;
      field.required = el.required;
      if (el.placeholder) field.placeholder = clean(el.placeholder);
      if (el.type === "checkbox" || el.type === "radio") {
        field.checked = el.checked;
        if (el.name) field.group = el.name;
      } else if (isManual(el)) {
        field.manual = true;
      } else {
        field.value = el.value;
      }
    }
    fields.push(field);
  }

  const text = document.body?.innerText ?? "";
  return {
    title: document.title,
    url: location.href,
    text: text.slice(0, MAX_TEXT),
    textTruncated: text.length > MAX_TEXT,
    fields,
  };
}

export function applyFills(fills: Fill[], highlightId: string | null): FillResult[] {
  const MARK = "data-luma-mark";
  document.querySelectorAll<HTMLElement>(`[${MARK}]`).forEach((el) => {
    el.style.outline = "";
    el.removeAttribute(MARK);
  });
  const mark = (el: HTMLElement, color: string) => {
    el.style.outline = `4px solid ${color}`;
    el.style.outlineOffset = "2px";
    el.setAttribute(MARK, "");
  };
  const find = (id: string) => document.querySelector<HTMLElement>(`[data-luma-id="${CSS.escape(id)}"]`);
  const changed = (el: HTMLElement) => {
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  };
  const label = (el: HTMLElement) =>
    ((el as HTMLInputElement).labels?.[0]?.innerText || el.getAttribute("aria-label") || el.getAttribute("name") || "")
      .replace(/\s+/g, " ")
      .trim();

  const done: FillResult[] = [];
  for (const { id, value } of fills) {
    const el = find(id);
    if (!el) continue;

    if (el instanceof HTMLSelectElement) {
      const want = value.trim().toLowerCase();
      const option = [...el.options].find(
        (o) => o.text.trim().toLowerCase() === want || o.value.toLowerCase() === want,
      );
      if (!option) continue;
      el.value = option.value;
      changed(el);
    } else if (el instanceof HTMLTextAreaElement) {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(el, value);
      changed(el);
    } else if (el instanceof HTMLInputElement) {
      // Never type secrets or press buttons on the person's behalf.
      if (/password|file|submit|button|reset|image/.test(el.type)) continue;
      if (el.type === "checkbox" || el.type === "radio") {
        const want = value === "true";
        if (el.type === "radio" && !want) continue;
        // click() rather than setting .checked so the page's own handlers run.
        if (el.checked !== want) el.click();
      } else {
        // Same payment-field test as snapshotPage; repeated because each function is injected alone.
        const hint = `${el.autocomplete} ${el.name} ${el.id}`.toLowerCase();
        if (/cc-|card.?(number|num|no)\b|ccnum|cvv|cvc|security.?code/.test(hint)) continue;
        // Framework-controlled inputs (React etc.) only notice the native setter.
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, value);
        changed(el);
        if (el.value !== value) continue; // the browser rejected it, e.g. a malformed date
      }
    } else {
      continue;
    }
    mark(el, "#16a34a");
    done.push({ label: label(el), value });
  }

  const target = highlightId ? find(highlightId) : null;
  if (target) {
    mark(target, "#f59e0b");
    target.scrollIntoView({
      block: "center",
      behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
    });
  }
  return done;
}

export function clickElement(id: string): boolean {
  const el = document.querySelector<HTMLElement>(`[data-luma-id="${CSS.escape(id)}"]`);
  if (!el) return false;
  el.click();
  return true;
}
