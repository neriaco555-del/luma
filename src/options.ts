const key = document.getElementById("key") as HTMLInputElement;
const provider = document.getElementById("provider") as HTMLSelectElement;
const language = document.getElementById("language") as HTMLSelectElement;
const memory = document.getElementById("memory") as HTMLTextAreaElement;
const saved = document.getElementById("saved") as HTMLElement;

chrome.storage.local.get(["apiKey", "provider", "language", "memory"]).then((s) => {
  key.value = (s.apiKey as string) ?? "";
  provider.value = (s.provider as string) ?? "anthropic";
  memory.value = ((s.memory as string[]) ?? []).join("\n");
  language.value = (s.language as string) ?? "עברית";
});

document.getElementById("form")!.addEventListener("submit", async (e) => {
  e.preventDefault();
  await chrome.storage.local.set({ apiKey: key.value.trim(), provider: provider.value,
    language: language.value,
    memory: memory.value.split("\n").map((note) => note.trim()).filter(Boolean),
   });
  saved.hidden = false;
});
