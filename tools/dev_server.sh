#!/usr/bin/env bash
# Corre el servidor del juego en el computador (sin teléfono) para probar la interfaz.
# Abre http://localhost:8080/#host=dev&name=Yo como anfitrión y http://TU-IP:8080 en otros dispositivos.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TOOLS="${TOOLS_DIR:-$ROOT/.build-tools}"
OUT="$ROOT/build/dev"
JSON_JAR="$TOOLS/org-json.jar"
mkdir -p "$TOOLS" "$OUT"
[ -s "$JSON_JAR" ] || curl -fsSL -o "$JSON_JAR" https://repo1.maven.org/maven2/org/json/json/20240303/json-20240303.jar
J="$ROOT/app/src/main/java/com/adivinaadivinador/app"
javac -nowarn -encoding UTF-8 -cp "$JSON_JAR" -d "$OUT" \
  "$J/Matcher.java" "$J/Game.java" "$J/GameServer.java" "$J/Discovery.java" \
  "$ROOT/tools/DevServer.java" "$ROOT/tools/MatcherCheck.java"
java -cp "$OUT:$JSON_JAR" MatcherCheck | tail -1
cd "$ROOT" && exec java -cp "$OUT:$JSON_JAR" DevServer app/src/main/assets
