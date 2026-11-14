#!/usr/bin/env bash
# West Companion modunu (Fabric + NeoForge, MC 1.21.1) derler ve launcher kaynaklarına kopyalar.
set -euo pipefail
cd "$(dirname "$0")/../companion"
(cd fabric && gradle build --no-daemon -q)
(cd neoforge && gradle build --no-daemon -q)
mkdir -p ../src-tauri/resources/companion
cp fabric/build/libs/west-companion-*+fabric-1.21.1.jar ../src-tauri/resources/companion/west-companion-fabric.jar
cp neoforge/build/libs/west-companion-*+neoforge-1.21.1.jar ../src-tauri/resources/companion/west-companion-neoforge.jar
echo "West Companion jar'ları güncellendi."
