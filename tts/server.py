"""Local Hebrew text-to-speech for the Luma extension.

Listens on 127.0.0.1 only. POST /speak with {"text": "..."} returns a WAV file.
Usage: python -I server.py <models-directory>
"""

import io
import json
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import soundfile
from phonikud import phonemize
from phonikud_onnx import Phonikud
from piper_onnx import Piper

PORT = 5577
MAX_CHARS = 3000

models = Path(sys.argv[1])
diacritizer = Phonikud(str(models / "phonikud-1.0.int8.onnx"))
voice = Piper(str(models / "tts-model.onnx"), str(models / "tts-model.config.json"))
synthesis = threading.Lock()  # the models are not safe to run from two requests at once


def synthesize(text: str) -> bytes:
    # The voice only knows Hebrew letters, so the assistant's own name is spelled out for it.
    text = text.replace("Luma", "לוּמָה")
    with synthesis:
        phonemes = phonemize(diacritizer.add_diacritics(text))
        samples, sample_rate = voice.create(phonemes, is_phonemes=True)
    wav = io.BytesIO()
    soundfile.write(wav, samples, sample_rate, format="WAV")
    return wav.getvalue()


class Handler(BaseHTTPRequestHandler):
    def reply(self, status: int, body: bytes = b"", content_type: str = "text/plain") -> None:
        self.send_response(status)
        origin = self.headers.get("Origin", "")
        if origin.startswith("chrome-extension://"):
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Access-Control-Allow-Headers", "Content-Type")
            self.send_header("Access-Control-Allow-Private-Network", "true")
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def from_web_page(self) -> bool:
        # Any website the person visits can reach 127.0.0.1; only the extension may use the voice.
        return self.headers.get("Origin", "").startswith(("http://", "https://"))

    def do_OPTIONS(self) -> None:
        self.reply(403 if self.from_web_page() else 204)

    def do_GET(self) -> None:
        self.reply(200, b"ok") if self.path == "/health" and not self.from_web_page() else self.reply(404)

    def do_POST(self) -> None:
        if self.path != "/speak":
            return self.reply(404)
        if self.from_web_page() or self.headers.get("Content-Type", "").split(";")[0] != "application/json":
            return self.reply(403)
        length = int(self.headers.get("Content-Length") or 0)
        if not 0 < length <= MAX_CHARS * 4:
            return self.reply(413)
        try:
            text = json.loads(self.rfile.read(length))["text"]
            if not isinstance(text, str) or not text.strip() or len(text) > MAX_CHARS:
                raise ValueError
        except (ValueError, KeyError, TypeError):
            return self.reply(400)
        self.reply(200, synthesize(text), "audio/wav")

    def log_message(self, *args) -> None:  # spoken text is private; keep it out of the system log
        pass


ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
