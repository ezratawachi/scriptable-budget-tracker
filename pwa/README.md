# Presupuesto PWA

## Instalar en iPhone

La PWA debe abrirse desde HTTPS para poder instalarse y usar service worker. `http://127.0.0.1:4173/` sirve para probar en tu Mac, pero no sirve como app instalable en tu iPhone.

Opciones recomendadas para publicarla:

1. Sube la carpeta `pwa/` a un hosting estático con HTTPS, por ejemplo Cloudflare Pages, Netlify, Vercel o GitHub Pages.
2. Abre la URL HTTPS en Safari del iPhone.
3. Toca Compartir.
4. Toca Agregar a pantalla de inicio.
5. Abre la app desde el icono nuevo.

## Importar data actual de Scriptable

1. Abre el tracker actual en Scriptable.
2. Ve a Categorías.
3. Toca Datos.
4. Toca Exportar JSON completo.
5. Guarda el archivo en iCloud Drive o compártelo a tu iPhone.
6. Abre la PWA.
7. Ve a Categorías > Datos.
8. Toca Importar JSON y selecciona el archivo exportado.

## Sobre guardado en la nube

La app guarda primero localmente para que funcione offline, y además sincroniza con Supabase cuando inicias sesión por magic link.

Proyecto conectado:

1. Supabase project: `budget-tracker`.
2. Tabla: `public.budget_sync`.
3. Auth: magic link por email.
4. PWA publicada: `https://ezratawachi.github.io/scriptable-budget-tracker/pwa/`.

Al conectar el email por primera vez, la PWA sube tu data actual a Supabase si todavía no existe una copia en la nube. Después de eso, cada gasto, categoría, preset o deseo se sube automáticamente.
