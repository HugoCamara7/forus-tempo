<p align="center"><img src="assets/logo-forus-tempo.png" alt="Forus Tempo" width="420"></p>

# Forus Tempo

*Tu organizador personal de tareas y tiempos.*

Organizador de tareas personal, en una sola página web (`index.html`), sin instalación ni servidor.
Tus datos se guardan **solo en tu navegador**.

## Qué incluye

- **Panel**: tareas pendientes, para hoy y vencidas, hechas en los últimos 7 días, carga por área, próximos vencimientos, prioridades y clientes con más pendientes.
- **Tablero** (Por hacer, En curso, Hecho, con arrastrar y soltar) y **Lista**.
- **Tareas** con prioridad, fecha límite, área, pasos, notas, y campos opcionales: cliente, horas estimadas y enlace.
- **Notas**: anota todo lo que tengas pendiente, una idea por línea. Se guardan solas, se pueden fijar arriba y buscar, y con **Convertir en tareas** cada línea pasa a ser una tarea (con prioridad, área y fecha para todas a la vez).
- **Desde un correo**: pega un correo y se crea una tarea con su asunto como título y el texto en las notas.
- **Ajustes** para personalizarlo: tu nombre, el título del tablero, color principal, tema claro/oscuro, tipo de letra, densidad, esquinas, tus propias áreas con color y qué campos mostrar.
- **Interfaz móvil**: navegación inferior (Panel, Tablero, Lista, Ajustes), botón «+» para añadir tareas, hojas que suben desde abajo, tablero por columnas con deslizamiento lateral y opción de deshacer.
- **Instalable y con uso sin conexión** (PWA): se añade a la pantalla de inicio como una app.
- **Exportar e importar** copias de seguridad en JSON.

## Publicarlo en GitHub Pages

1. En el repositorio ve a **Settings → Pages** y, en **Build and deployment → Source**, elige **GitHub Actions**. Hazlo antes de subir cambios a `main`; si no, el flujo de publicación fallará.
2. Sube los cambios a la rama `main`. El flujo de `.github/workflows/pages.yml` publica la página cada vez.
3. Sigue el progreso en la pestaña **Actions**. Cuando termine (1–2 minutos), la app estará en `https://hugocamara7.github.io/forus-tempo/`.

Si prefieres no usar Actions: en **Settings → Pages** elige **Deploy from a branch**, rama `main` y carpeta `/ (root)`.

En un repositorio privado, GitHub Pages solo está disponible con un plan de pago. Con el plan gratuito, el repositorio debe ser público (tus tareas no se suben: viven en tu navegador).

## Avisos (notificaciones)

La app puede avisarte **la tarde anterior** (18:00) y **la mañana del día** (08:00) en que vence una tarea, aunque esté cerrada. Las horas se cambian en **Ajustes → Avisos**.

- Funciona en iPhone (iOS 16.4 o posterior, **solo con la app instalada** en la pantalla de inicio), Android y en el PC con Chrome, Edge, Firefox o Safari. En el PC, el navegador tiene que estar abierto o funcionando en segundo plano.
- Se activa en cada dispositivo, y cada uno avisa de las tareas guardadas en él.
- Los avisos los envía un pequeño servidor gratuito en Cloudflare (carpeta `push/`). Para poder avisarte guarda el título y la fecha de tus tareas pendientes, nada más.

### Puesta en marcha del servidor (una sola vez)

1. Crea una cuenta gratuita en [Cloudflare](https://dash.cloudflare.com/sign-up).
2. En Cloudflare: **My Profile → API Tokens → Create Token**, plantilla **Edit Cloudflare Workers**, y copia el token.
3. Copia tu **Account ID** (aparece en la página principal de tu cuenta de Cloudflare).
4. En GitHub: **Settings → Secrets and variables → Actions → New repository secret** y crea `CLOUDFLARE_API_TOKEN` y `CLOUDFLARE_ACCOUNT_ID`.
5. En **Actions**, ejecuta **Desplegar servidor de avisos**. Al terminar muestra la dirección del servidor (`https://forus-tempo-push.….workers.dev`).
6. Pon esa dirección en la constante `PUSH_URL` de `index.html` y sube el cambio. A partir de ahí aparece **Avisos** en Ajustes.

## Instalarla en el móvil

Primero publícala (arriba) y abre la dirección de GitHub Pages en el móvil.

- **iPhone (Safari):** botón Compartir → **Añadir a pantalla de inicio**.
- **Android (Chrome):** menú ⋮ → **Instalar app** (o **Añadir a pantalla de inicio**).

Importante en iPhone: la app instalada y Safari guardan los datos por separado. Instálala primero y úsala desde su icono. Si ya habías creado tareas en Safari, exporta una copia allí e impórtala en la app instalada.

## Usarlo sin publicar

Abre `index.html` con doble clic en tu navegador. Funciona igual.

## Sobre tus datos

- Se guardan en el almacenamiento local del navegador (`localStorage`), separado por dirección web. La versión publicada en GitHub Pages y la que abres como archivo tienen datos distintos.
- Si borras los datos del navegador, se pierden las tareas. Usa **Exportar copia** (botón al pie de la página) de vez en cuando.
- Para pasar tus datos a otro dispositivo, exporta allí e importa aquí. Al importar, las tareas se combinan con las que ya tienes.
- Aunque el repositorio sea público, tus tareas **no** están en él: solo está el código.

## Personalizar el código

Todo está en `index.html` (el servidor de avisos está aparte, en `push/`; además están `manifest.webmanifest` y `sw.js`, que permiten instalarla y usarla sin conexión, los iconos `favicon.png`, `icon-192.png`, `icon-512.png`, `icon-maskable-512.png` y `apple-touch-icon.png`, y el logo en `assets/`):

- Colores y temas: variables CSS al inicio del `<style>`.
- Colores sugeridos del selector: constante `PRESETS` en el script.
- Áreas iniciales: función `defaults()`.

La página carga las fuentes de Google Fonts. Si quieres que funcione sin conexión, quita las líneas `<link>` de fuentes y se usará la letra del sistema.
