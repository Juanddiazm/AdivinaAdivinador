# 🔮 Adivina Adivinador

Juego de adivinanzas para jugar en grupo con el celular. Una persona crea la partida (**anfitrión**) y los demás se unen desde la app o desde el navegador. Aparece una pista (una bandera, una foto, un logo, emojis, letras revueltas…) y todos escriben la respuesta. **Aunque la escribas mal, algo te llevas:** si era *Colombia* y escribiste *Olombia*, ganas parte de los puntos.

## 📲 Instalar

Descarga **[`release/AdivinaAdivinador.apk`](release/AdivinaAdivinador.apk)** en el celular (Android 7.0 o más nuevo), ábrelo y acepta *"Instalar apps de origen desconocido"* si te lo pide.

Solo el anfitrión necesita la app. Los demás pueden instalarla también o simplemente abrir en el navegador la dirección que aparece en la pantalla del anfitrión (por ejemplo `192.168.1.23:8080`).

## 🎮 Cómo se juega

1. El anfitrión toca **Crear partida** y elige el **modo de juego**, categorías, número de preguntas, segundos por pregunta y qué tan exigentes serán con la ortografía.
2. Todos se conectan al **mismo Wi-Fi**, o al **punto de acceso (hotspot)** del anfitrión si no hay Wi-Fi. No se necesita internet.
3. Los jugadores tocan **Unirme**: la app busca sola las partidas cercanas. Si no aparece, escriben la dirección que ve el anfitrión.
4. En cada ronda aparece la pista y todos responden. A mitad del tiempo puede salir una ayuda: `C _ _ _ _ _ _ _`.
5. Al final de cada ronda se ve qué respondió cada uno y cuántos puntos ganó; al final, el podio 🏆.

### Modos de juego

| | Modo | Cómo se responde | Ayuda a mitad de tiempo |
|---|---|---|---|
| ✍️ | **Escribir** | Cada uno escribe la respuesta; con errores de ortografía gana una parte | Primera letra y cuántas letras tiene |
| 🔘 | **Opciones** | Se toca una de 4 opciones (la buena y 3 de la misma categoría) | 50/50: quita dos opciones malas |

En modo opciones solo la respuesta correcta suma, con el mismo bono por rapidez y por ser el primero; al revelar se ve cuántos eligieron cada opción.

### Puntos

| Lo que escribes (si era *Colombia*) | Modo normal |
|---|---|
| `Colombia`, `colombia`, `COLOMBIA ` (tildes, mayúsculas y espacios no importan) | 100 % |
| `Olombia`, `Colonbia`, `Colmobia` (una letra mal, de más, de menos o volteada) | 80 % |
| Hasta ~20 % de letras mal | 60 % |
| Hasta ~34 % de letras mal (`Kolombya`) | 35 % |
| Otra respuesta válida de la misma categoría (`Irak` cuando era `Irán`) | 0 % |

- El porcentaje se multiplica por la rapidez: entre **400 y 1000 puntos** según el tiempo que quedaba.
- ⚡ **+100** al primero que responda exacto.
- 🔥 Se muestran las rachas de respuestas buenas seguidas.
- El anfitrión puede elegir **Estricto** (solo se perdona un error de dedo en palabras largas) o **Generoso** (ideal para niños).
- Cada respuesta acepta varias formas: *EEUU / USA / Estados Unidos*, *Holanda / Países Bajos*, *Mc Donalds / McDonald's*…

## 🗂️ Categorías incluidas (481 preguntas)

| | Categoría | Cómo se muestra | Preguntas |
|---|---|---|---|
| 🌎 | Países por bandera | Bandera | 73 |
| 🏛️ | Capitales | País → capital | 54 |
| 🏷️ | Marcas | Logo real (los que muestran el nombre empiezan pixelados y se van aclarando) | 46 |
| 🗺️ | Lugares famosos | Foto + bandera del país | 37 |
| 🎬 | Películas en emojis | Emojis | 38 |
| 📺 | Series y dibujos | Emojis | 28 |
| 🐾 | Animales | Foto | 34 |
| 🍲 | Comidas del mundo | Foto + bandera del país | 34 |
| 🔀 | Palabras revueltas | Letras mezcladas al azar | 46 |
| 🌟 | Personajes famosos | Foto + bandera | 35 |
| 🗣️ | Completa el refrán | Inicio del refrán | 30 |
| ⚽ | Deportes | Foto | 26 |
| ✍️ | **Personalizada** | El anfitrión escribe sus propias preguntas: `pista = respuesta / otra forma` | ∞ |

Las preguntas están en [`app/src/main/assets/data/categorias.json`](app/src/main/assets/data/categorias.json); agregar más es solo añadir líneas `["pista", "respuesta", "alias1", "alias2"]`.

## 💡 Más ideas de categorías

- **Siluetas de países o departamentos de Colombia** (con imágenes SVG del mapa).
- **Escudos de equipos de fútbol** (con imágenes, como las marcas).
- **Canciones en emojis** o **«continúa la letra»** de canciones famosas.
- **¿Quién lo dijo?**: frases célebres de personajes, películas o memes.
- **Adivina el año**: «¿En qué año llegó el hombre a la Luna?» (puntos según qué tan cerca).
- **Sonidos**: animales, instrumentos o intros de series (con audio).
- **Zoom**: una foto muy acercada que se va alejando con el tiempo.
- **Pokémon, superhéroes, personajes de Disney o de videojuegos** por pista.
- **Ciudades de Colombia** por sus platos, ferias o apodos («La ciudad de la eterna primavera»).
- **Matemáticas rápidas** o **traducciones** (palabra en inglés → español) para jugar en clase.
- **Equipos**: jugar por parejas o equipos y sumar puntos en grupo.
- **Modo dibujo**: uno dibuja en su pantalla y los demás adivinan (tipo Pictionary).

## 🛠️ Para desarrolladores

Todo es Java (sin librerías) + una página web:

| Archivo | Qué hace |
|---|---|
| `app/src/main/java/.../MainActivity.java` | WebView, botón atrás y puente con la página de inicio |
| `.../GameServer.java` | Servidor HTTP que corre en el celular del anfitrión (puerto 8080) |
| `.../Game.java` | Reglas: jugadores, rondas, tiempo, pistas y puntajes |
| `.../Matcher.java` | Puntaje por ortografía (distancia de Damerau-Levenshtein) |
| `.../Discovery.java` | Encuentra partidas en la red por UDP (puerto 8766) |
| `app/src/main/assets/home.html` | Pantalla de inicio de la app |
| `app/src/main/assets/web/` | Juego (lo ven la app y los navegadores) |

### Imágenes

Las fotos y logos salen de [Wikimedia Commons](https://commons.wikimedia.org) (solo licencias libres) y van dentro del APK, así que el juego sigue funcionando sin internet. Los créditos de cada imagen están en la app (*¿Cómo se juega?* → *Créditos*) y en [`creditos.html`](app/src/main/assets/web/creditos.html).

- [`tools/imagenes-fuentes.json`](tools/imagenes-fuentes.json): qué archivo de Commons usa cada respuesta y si se pixela (`"pixelar": true`, para logos que muestran el nombre).
- `tools/fetch_images.py resolve`: para respuestas nuevas, busca en Wikidata la foto principal (o el logo/ícono en las marcas).
- `tools/fetch_images.py build`: descarga, reduce a WebP, genera los niveles pixelados y escribe `data/imagenes.json` y los créditos.
- `tools/fetch_images.py sheet`: hojas de contacto en `build/revision/` para revisar las imágenes a ojo.

Los archivos tienen nombres al azar para que la dirección de la imagen no delate la respuesta, y el servidor solo entrega el nivel de pixelado que toca en cada momento. Si una respuesta no tiene imagen, se usa la pista de texto de `categorias.json`.

### Compilar el APK

- **Sin Android Studio** (Linux, JDK 17+): `tools/build_apk.sh` → `build/AdivinaAdivinador.apk`. Descarga una sola vez `android.jar`, `aapt2`, `dx` y `apksig`.
- **Con Android Studio**: abrir la carpeta del proyecto y darle *Run* (AGP 8.7, Gradle 8.14).

Ambos firman con la llave de pruebas `tools/adivina-debug.p12` (clave `android`), así el APK se puede actualizar sin desinstalar. Para publicar en Play Store usa tu propia llave (`KEYSTORE=... KEYSTORE_PASS=... KEY_ALIAS=... tools/build_apk.sh`).

### Probar en el computador

```bash
tools/dev_server.sh            # luego abre http://localhost:8080/#host=dev&name=Yo
                               # y en otras pestañas/teléfonos http://TU-IP:8080
```
