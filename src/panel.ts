import { Assistant, AssistantError, type Reply } from "./assistant";
import { applyFills, clickElement, snapshotPage, type FillResult } from "./page";

const log = document.getElementById("log")!;
const explainButton = document.getElementById("explain") as HTMLButtonElement;
const resetButton = document.getElementById("reset") as HTMLButtonElement;
const replyForm = document.getElementById("reply") as HTMLFormElement;
const textBox = document.getElementById("text") as HTMLTextAreaElement;

const smallerButton = document.getElementById("smaller") as HTMLButtonElement;
const biggerButton = document.getElementById("bigger") as HTMLButtonElement;
const speakToggle = document.getElementById("speak") as HTMLButtonElement;

const assistant = new Assistant();

// ---- Comfort settings: text size and reading aloud, remembered between visits ----

const SIZES = [16, 18, 20, 23, 26, 30, 34];
const VOICE_LANGUAGE: Record<string, string> = {
  "עברית": "he",
  "العربية": "ar",
  "Русский": "ru",
  "አማርኛ": "am",
  English: "en",
  "Français": "fr",
  "Español": "es",
};
let sizeIndex = 2;
let readAloud = false;
let voiceLanguage = "he";

function applySize() {
  document.documentElement.style.setProperty("--size", `${SIZES[sizeIndex]}px`);
  smallerButton.disabled = sizeIndex === 0;
  biggerButton.disabled = sizeIndex === SIZES.length - 1;
}

function changeSize(step: number) {
  sizeIndex = Math.min(SIZES.length - 1, Math.max(0, sizeIndex + step));
  applySize();
  chrome.storage.local.set({ sizeIndex });
}

/** Older browsers and Hebrew speakers call the language "iw", so both spellings count. */
const voiceFor = (language: string) =>
  speechSynthesis
    .getVoices()
    .find((voice) => voice.lang.toLowerCase().startsWith(language) || (language === "he" && voice.lang.toLowerCase().startsWith("iw")));

function speak(text: string) {
  speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  const voice = voiceFor(voiceLanguage);
  if (voice) utterance.voice = voice;
  utterance.lang = voice?.lang ?? voiceLanguage;
  utterance.rate = 0.9;
  speechSynthesis.speak(utterance);
}

function speakButton(text: string) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "speak";
  button.textContent = "🔊 הקרא לי";
  button.addEventListener("click", () => speak(text));
  return button;
}

function setReadAloud(on: boolean) {
  readAloud = on;
  speakToggle.setAttribute("aria-pressed", String(on));
  if (!on) speechSynthesis.cancel();
}

smallerButton.addEventListener("click", () => changeSize(-1));
biggerButton.addEventListener("click", () => changeSize(1));
speakToggle.addEventListener("click", () => {
  setReadAloud(!readAloud);
  chrome.storage.local.set({ readAloud });
  if (!readAloud) return;
  if (voiceFor(voiceLanguage)) speak("מעכשיו אקריא את התשובות בקול.");
  else show("error", "במחשב הזה לא מותקן קול בשפה שלך, אז ייתכן שההקראה לא תישמע. אפשר להתקין קול בהגדרות המחשב.");
});

chrome.storage.local.get(["sizeIndex", "readAloud", "language"]).then((saved) => {
  if (typeof saved.sizeIndex === "number") sizeIndex = saved.sizeIndex;
  applySize();
  setReadAloud(saved.readAloud === true);
  voiceLanguage = VOICE_LANGUAGE[saved.language as string] ?? "he";
});
chrome.storage.onChanged.addListener((changes) => {
  if (changes.language) voiceLanguage = VOICE_LANGUAGE[changes.language.newValue as string] ?? "he";
});

function welcome() {
  show(
    "assistant",
    "שלום, אני Luma. אני יכול להסביר מה כתוב בדף, למלא טפסים, או לפתוח את האתר שצריך. אפשר ללחוץ על הכפתור הכחול למעלה, או לכתוב לי למטה.",
  );
}

function show(kind: "assistant" | "user" | "error" | "status", text: string, filled: FillResult[] = []) {
  const bubble = document.createElement("div");
  bubble.className = `msg ${kind}`;
  bubble.textContent = text;
  bubble.dir = "auto";
  if (kind === "error") bubble.setAttribute("role", "alert");
  if (filled.length > 0) {
    const list = document.createElement("ul");
    list.className = "filled";
    for (const { label, value } of filled) {
      const item = document.createElement("li");
      item.textContent = `${label || "שדה"}: ${value === "true" ? "✓" : value}`;
      list.append(item);
    }
    bubble.append(list);
  }
  log.append(bubble);
  bubble.scrollIntoView({ block: "end" });
  return bubble;
}

/** The details the assistant needs, as one form; submitting sends the answers back to it. */
function questionForm(questions: Reply["questions"]) {
  const form = document.createElement("form");
  form.className = "questions";
  const answers: (() => string)[] = [];
  questions.forEach(({ label, options }, index) => {
    const group = document.createElement(options.length > 0 ? "fieldset" : "label");
    const caption = document.createElement(options.length > 0 ? "legend" : "span");
    caption.textContent = label;
    group.append(caption);
    if (options.length > 0) {
      for (const option of options) {
        const choice = document.createElement("label");
        choice.className = "choice";
        const radio = document.createElement("input");
        radio.type = "radio";
        radio.name = `q${index}`;
        radio.value = option;
        choice.append(radio, option);
        group.append(choice);
      }
      answers.push(() => new FormData(form).get(`q${index}`)?.toString() ?? "");
    } else {
      const input = document.createElement("input");
      input.type = "text";
      input.autocomplete = "off";
      input.dir = "auto";
      group.append(input);
      answers.push(() => input.value.trim());
    }
    form.append(group);
  });
  const submit = document.createElement("button");
  submit.type = "submit";
  submit.className = "primary";
  submit.textContent = "מלא בשבילי";
  form.append(submit);
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const lines = questions.map(({ label }, index) => [label, answers[index]()]).filter(([, answer]) => answer);
    if (lines.length > 0) ask(lines.map(([label, answer]) => `${label}: ${answer}`).join("\n"));
  });
  return form;
}

function suggestionButtons(suggestions: string[]) {
  const row = document.createElement("div");
  row.className = "suggestions";
  for (const suggestion of suggestions.slice(0, 4)) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "secondary";
    button.textContent = suggestion;
    button.addEventListener("click", () => ask(suggestion));
    row.append(button);
  }
  return row;
}

function showMissingKey() {
  const bubble = show("error", "לפני שמתחילים צריך להדביק מפתח API בהגדרות. ");
  const open = document.createElement("button");
  open.className = "primary";
  open.textContent = "פתח הגדרות";
  open.addEventListener("click", () => chrome.runtime.openOptionsPage());
  bubble.append(open);
}

/** Screenshots are downscaled so long conversations stay within the API's image size limits. */
async function captureScreenshot(windowId: number): Promise<string> {
  const MAX_EDGE = 1568;
  const dataUrl = await chrome.tabs.captureVisibleTab(windowId, { format: "jpeg", quality: 80 });
  const bitmap = await createImageBitmap(await (await fetch(dataUrl)).blob());
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const canvas = new OffscreenCanvas(Math.round(bitmap.width * scale), Math.round(bitmap.height * scale));
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const blob = await canvas.convertToBlob({ type: "image/jpeg", quality: 0.8 });
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

// Notes the extension sends on its own; the system prompt tells the assistant how to read them.
const UNREADABLE_NOTE =
  "[Luma: the open tab cannot be read or changed (a page of the browser itself, such as a new tab or settings, or a page that blocked access). You can still talk with the person or open a website for them.]";
const OPENED_NOTE = "[Luma: the website you asked for is now open. This is the new page. The person has not said anything new.]";
const CLICKED_NOTE = "[Luma: the person approved and the button was pressed. This is the page now. The person has not said anything new.]";

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Waits for the tab to finish loading after a press or a new address. */
async function settle(tabId: number) {
  await pause(1200);
  for (let i = 0; i < 30 && (await chrome.tabs.get(tabId)).status !== "complete"; i++) await pause(500);
}

/** The assistant never presses anything on its own: the person approves each press here. */
function clickApproval(tabId: number, click: NonNullable<Reply["click"]>) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "primary approve";
  button.textContent = `לחץ בשבילי: ${click.description}`;
  button.addEventListener("click", async () => {
    button.disabled = true;
    try {
      const [{ result }] = await chrome.scripting.executeScript({ target: { tabId }, func: clickElement, args: [click.id] });
      if (!result) throw new Error("element is gone");
    } catch (error) {
      console.error(error);
      show("error", "הכפתור כבר לא נמצא בדף. בקש ממני שוב.");
      return;
    }
    await settle(tabId);
    await ask(CLICKED_NOTE, true);
  });
  return button;
}

/** `auto` turns are started by the extension after it acted, so there is nothing of the person's to show. */
async function ask(userText: string, auto = false) {
  // Forms and buttons from earlier replies belong to a page state that is now stale.
  const stale = [...log.querySelectorAll<HTMLButtonElement | HTMLInputElement>("button:enabled:not(.speak), input:enabled")];
  for (const control of stale) control.disabled = true;
  speechSynthesis.cancel();
  if (!auto) show("user", userText);
  const waiting = show("status", "רגע…");
  for (const control of [explainButton, resetButton, textBox]) control.disabled = true;
  let followUp: string | null = null;
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id === undefined) throw new AssistantError("לא מצאתי דף פתוח.");
    const tabId = tab.id;

    // Chrome never lets extensions read its own pages (settings, extensions, new tab, web store);
    // for those the tab's address is hidden from us or is not a web address. The assistant is
    // still asked, without a page, so it can offer to open the site the person needs.
    const url = tab.url ?? "";
    let page = null;
    let screenshot = null;
    if (/^(https?|file):/.test(url) && !url.startsWith("https://chromewebstore.google.com")) {
      try {
        [{ result: page }] = await chrome.scripting.executeScript({ target: { tabId }, func: snapshotPage });
        screenshot = await captureScreenshot(tab.windowId);
      } catch (error) {
        console.error(error);
        if (url.startsWith("file:")) {
          throw new AssistantError('כדי שאוכל לקרוא קובץ מהמחשב צריך להדליק בפרטי התוסף את "מתן גישה לכתובות URL של קבצים".');
        }
        page = null;
      }
    }

    const reply = await assistant.send(page ? userText : `${UNREADABLE_NOTE}\n${userText}`, page ?? null, screenshot);

    let filled: FillResult[] = [];
    if (reply.fills.length > 0 || reply.highlightId !== null) {
      const [{ result }] = await chrome.scripting.executeScript({
        target: { tabId },
        func: applyFills,
        args: [reply.fills, reply.highlightId],
      });
      filled = result ?? [];
    }
    const bubble = show("assistant", reply.message, filled);
    if (reply.questions.length > 0) bubble.append(questionForm(reply.questions));
    if (reply.click) bubble.append(clickApproval(tabId, reply.click));
    if (reply.suggestions.length > 0) bubble.append(suggestionButtons(reply.suggestions));
    bubble.append(speakButton(reply.message));
    if (readAloud) speak(reply.message);
    bubble.scrollIntoView({ block: "start" });

    // One address per request from the person: a page that opened by itself cannot send them onward.
    if (reply.openUrl && !auto) {
      const opening = show("status", `פותח את ${new URL(reply.openUrl).hostname}…`);
      await chrome.tabs.update(tabId, { url: reply.openUrl });
      await settle(tabId);
      opening.remove();
      followUp = OPENED_NOTE;
    }
  } catch (error) {
    // Nothing was sent or applied, so the person can retry without retyping their answers.
    for (const control of stale) control.disabled = false;
    if (error instanceof AssistantError && error.message === "NO_KEY") showMissingKey();
    else if (error instanceof AssistantError) show("error", error.message);
    else {
      console.error(error);
      show("error", "משהו השתבש. נסה שוב.");
    }
  } finally {
    waiting.remove();
    for (const control of [explainButton, resetButton, textBox]) control.disabled = false;
    (log.querySelector<HTMLInputElement>(".msg:last-child .questions input") ?? textBox).focus();
  }
  if (followUp) await ask(followUp, true);
}

explainButton.addEventListener("click", () => ask("אני צריך עזרה עם הדף הזה."));

resetButton.addEventListener("click", () => {
  assistant.reset();
  speechSynthesis.cancel();
  log.replaceChildren();
  welcome();
});

welcome();

replyForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const text = textBox.value.trim();
  if (!text || textBox.disabled) return;
  textBox.value = "";
  ask(text);
});

textBox.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    replyForm.requestSubmit();
  }
});
