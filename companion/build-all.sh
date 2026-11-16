#!/usr/bin/env bash
# West Companion'ın her Minecraft sürümü için ayrı derlemesi. Çıktılar launcher'a paketlenir.
# 26.x Java 25 ister; JAVA_HOME bir JDK 25 olmalı (eski sürümler toolchain ile derlenir).
set -euo pipefail
cd "$(dirname "$0")"
OUT=../src-tauri/resources/companion
for v in versions/*/; do
  name=$(basename "$v")            # ör. fabric-26.2
  echo "== $name"
  (cd "$v" && ./gradlew build --no-daemon -q)
  jar=$(ls "$v"build/libs/west-companion-*+"$name".jar | grep -v sources | head -1)
  cp "$jar" "$OUT/west-companion-$name.jar"
done
ls -la "$OUT"
