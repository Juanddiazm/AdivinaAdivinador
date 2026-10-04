#!/usr/bin/env bash
# Compila el APK sin Android Studio ni Gradle.
# Requisitos: JDK 17 o más nuevo, curl, unzip, zip (Linux x86-64).
# Las herramientas de Android se descargan una vez en .build-tools/:
#   - android.jar (API 34)        -> raw.githubusercontent.com/Reginer/aosp-android-jar
#   - aapt2 (viene dentro de apktool-lib), dx y apksig -> Maven Central
# Si tienes el SDK de Android instalado (ANDROID_HOME), se usan sus archivos.
#
# Uso: tools/build_apk.sh            -> build/AdivinaAdivinador.apk
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TOOLS="${TOOLS_DIR:-$ROOT/.build-tools}"
BUILD="$ROOT/build"
SRC="$ROOT/app/src/main"

PACKAGE="com.adivinaadivinador.app"
VERSION_CODE=1
VERSION_NAME="1.0"
MIN_SDK=24
TARGET_SDK=34

KEYSTORE="${KEYSTORE:-$ROOT/tools/adivina-debug.p12}"
KEYSTORE_PASS="${KEYSTORE_PASS:-android}"
KEY_ALIAS="${KEY_ALIAS:-adivina}"

MAVEN="https://repo1.maven.org/maven2"
mkdir -p "$TOOLS"

fetch() { # url destino
  if [ ! -s "$2" ]; then
    echo "Descargando $(basename "$2")…"
    curl -fsSL --retry 3 -o "$2.tmp" "$1"
    mv "$2.tmp" "$2"
  fi
}

# --- herramientas -----------------------------------------------------------
ANDROID_JAR="$TOOLS/android-34.jar"
if [ -n "${ANDROID_HOME:-}" ] && [ -f "$ANDROID_HOME/platforms/android-34/android.jar" ]; then
  ANDROID_JAR="$ANDROID_HOME/platforms/android-34/android.jar"
else
  fetch "https://raw.githubusercontent.com/Reginer/aosp-android-jar/main/android-34/android.jar" "$ANDROID_JAR"
fi

AAPT2="$TOOLS/aapt2"
if [ ! -x "$AAPT2" ]; then
  fetch "$MAVEN/org/apktool/apktool-lib/3.0.3/apktool-lib-3.0.3.jar" "$TOOLS/apktool-lib.jar"
  unzip -o -q -j "$TOOLS/apktool-lib.jar" prebuilt/linux/aapt2 -d "$TOOLS"
  chmod +x "$AAPT2"
fi

DX_JAR="$TOOLS/dalvik-dx.jar"
fetch "$MAVEN/com/jakewharton/android/repackaged/dalvik-dx/16.0.1/dalvik-dx-16.0.1.jar" "$DX_JAR"
APKSIG_JAR="$TOOLS/apksig.jar"
fetch "$MAVEN/com/android/tools/build/apksig/2.3.0/apksig-2.3.0.jar" "$APKSIG_JAR"

# --- compilación --------------------------------------------------------------
rm -rf "$BUILD"
mkdir -p "$BUILD/classes" "$BUILD/dex" "$BUILD/tool"

echo "1/5 Recursos (aapt2)"
"$AAPT2" compile --dir "$SRC/res" -o "$BUILD/res.zip"
sed "s#<manifest #<manifest package=\"$PACKAGE\" #" "$SRC/AndroidManifest.xml" > "$BUILD/AndroidManifest.xml"
"$AAPT2" link -o "$BUILD/base.apk" -I "$ANDROID_JAR" \
  --manifest "$BUILD/AndroidManifest.xml" -A "$SRC/assets" \
  --min-sdk-version "$MIN_SDK" --target-sdk-version "$TARGET_SDK" \
  --version-code "$VERSION_CODE" --version-name "$VERSION_NAME" \
  "$BUILD/res.zip"

echo "2/5 Java (javac)"
find "$SRC/java" -name '*.java' > "$BUILD/sources.txt"
javac -nowarn -Xlint:-options -encoding UTF-8 -source 8 -target 8 \
  -bootclasspath "$ANDROID_JAR" -d "$BUILD/classes" @"$BUILD/sources.txt"

echo "3/5 Dex (dx)"
java -cp "$DX_JAR" com.android.dx.command.Main --dex --min-sdk-version="$MIN_SDK" \
  --output="$BUILD/dex/classes.dex" "$BUILD/classes"

echo "4/5 Empaquetar"
cp "$BUILD/base.apk" "$BUILD/unsigned.apk"
(cd "$BUILD/dex" && zip -q -9 "$BUILD/unsigned.apk" classes.dex)

echo "5/5 Firmar (apksig, esquema v2)"
javac -nowarn -cp "$APKSIG_JAR" -d "$BUILD/tool" "$ROOT/tools/ApkSign.java"
java --add-exports java.base/sun.security.x509=ALL-UNNAMED \
  -cp "$APKSIG_JAR:$BUILD/tool" ApkSign "$BUILD/unsigned.apk" "$BUILD/AdivinaAdivinador.apk" \
  "$KEYSTORE" "$KEYSTORE_PASS" "$KEY_ALIAS" "$MIN_SDK"

echo
echo "Listo: $BUILD/AdivinaAdivinador.apk ($(du -h "$BUILD/AdivinaAdivinador.apk" | cut -f1))"
