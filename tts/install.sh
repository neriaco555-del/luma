#!/usr/bin/env bash
# Installs the local Hebrew voice for Luma (Linux, per user, no root):
# a private Python environment, the Phonikud + Piper models, and a background service
# on http://127.0.0.1:5577. The models are for non-commercial use (see phonikud-tts).
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$HOME/.local/share/luma-tts"
PY="$ROOT/venv/bin/python"

mkdir -p "$ROOT/models"
[ -x "$PY" ] || python3 -m venv --without-pip "$ROOT/venv"
pip() { python3 -m pip --python "$PY" "$@"; }
pip install -q onnxruntime numpy soundfile tokenizers colorlog num2words regex phonemizer-fork espeakng-loader
# Installed without dependency resolution: phonikud declares Python < 3.13 although it is
# pure Python, and piper-onnx's dependencies are already listed above.
pip install -q --no-deps --ignore-requires-python phonikud==0.4.1 phonikud-onnx piper-onnx

fetch() { [ -s "$ROOT/models/$1" ] || curl -sSL --fail -o "$ROOT/models/$1" "$2"; }
fetch phonikud-1.0.int8.onnx https://huggingface.co/thewh1teagle/phonikud-onnx/resolve/main/phonikud-1.0.int8.onnx
fetch tts-model.onnx https://huggingface.co/thewh1teagle/phonikud-tts-checkpoints/resolve/main/shaul.onnx
fetch tts-model.config.json https://huggingface.co/thewh1teagle/phonikud-tts-checkpoints/resolve/main/model.config.json

cp "$HERE/server.py" "$ROOT/server.py"
mkdir -p "$HOME/.config/systemd/user"
cat > "$HOME/.config/systemd/user/luma-tts.service" <<UNIT
[Unit]
Description=Luma local Hebrew voice

[Service]
ExecStart=$PY -I $ROOT/server.py $ROOT/models
Restart=on-failure

[Install]
WantedBy=default.target
UNIT
systemctl --user daemon-reload
systemctl --user enable --now luma-tts.service
systemctl --user restart luma-tts.service
echo "Luma voice is running on http://127.0.0.1:5577"
