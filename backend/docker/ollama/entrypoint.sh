#!/bin/sh

set -e

ollama serve &

echo "Waiting for Ollama..."

until ollama list >/dev/null 2>&1; do
  sleep 1
done

echo "Ollama is ready."

if ! ollama list | grep -q "qwen3:8b"; then
  echo "Pulling qwen3:8b..."
  ollama pull qwen3:8b
else
  echo "qwen3:8b already exists."
fi

wait
