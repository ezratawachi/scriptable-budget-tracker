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

La versión actual guarda los datos localmente en el navegador del dispositivo. Eso funciona offline, pero no es sincronización cloud automática.

Para nube real entre iPhone/Mac/dispositivos, hay que conectar un backend. La opción recomendada es Supabase:

1. Crear un proyecto en Supabase.
2. Crear una tabla para guardar un JSON por usuario.
3. Activar autenticación por email.
4. Conectar la PWA con `SUPABASE_URL` y `SUPABASE_ANON_KEY`.

Hasta que eso esté conectado, usa Exportar JSON como respaldo frecuente en iCloud Drive.
