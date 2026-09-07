# Sala de Proyección

Aplicación web para preparar, organizar y generar vídeos con IA desde texto.

## Estado actual

La aplicación ya incluye:

- Interfaz web responsive.
- Creación de proyectos y borradores.
- Historial local de producciones.
- Plantillas de prompts para cine, redes, producto y viajes.
- Selección de formato y calidad para la preparación de cada proyecto.
- Reproductor y enlace del vídeo generado cuando el proveedor devuelve una URL.
- Indicadores de estado y manejo de errores.
- Ajustes locales de idioma y autoguardado.
- API key protegida en el servidor.
- Dockerfile y configuración `render.yaml` para despliegue.

Los proyectos y preferencias de la interfaz se almacenan localmente en el navegador. No se necesita una base de datos para esta fase.

## Proveedor de vídeo

El proveedor inicial es **LTX de Pixazo**. La página oficial de APIs gratuitas actualmente documenta el endpoint gratuito unificado:

`POST https://gateway.pixazo.ai/ltx/text-to-video`

La API utiliza una clave enviada mediante `Ocp-Apim-Subscription-Key` y el flujo de generación es asíncrono: se obtiene un `request_id` y se consulta posteriormente el estado.

La disponibilidad, límites y derechos de uso del nivel gratuito pueden cambiar. Para un lanzamiento comercial hay que revisar los términos vigentes del modelo y del proveedor.

## Configuración local

1. Instala Node.js 18 o superior.
2. Ejecuta `npm install`.
3. Copia `.env.example` a `.env`.
4. Introduce la clave en `PIXAZO_API_KEY` cuando esté disponible.
5. Ejecuta `npm start`.
6. Abre `http://localhost:3000`.

La interfaz puede abrirse y utilizarse para preparar proyectos incluso antes de configurar la API key. La generación real necesita una clave válida.

## Variables de entorno

- `PORT`: puerto HTTP, por defecto `3000`.
- `VIDEO_PROVIDER`: proveedor seleccionado, por defecto `pixazo-ltx`.
- `PIXAZO_API_KEY`: clave secreta del proveedor; nunca debe publicarse.
- `PIXAZO_VIDEO_URL`: permite cambiar el endpoint sin modificar el código.
- `PIXAZO_STATUS_URL`: permite cambiar el endpoint de consulta de estado.

## API interna

### Salud

`GET /api/health`

Indica si el servidor está vivo y si el proveedor está configurado.

### Generar vídeo

`POST /api/video/generate`

Body mínimo:

```json
{
  "prompt": "A cinematic night drive through a futuristic city, realistic camera movement, rain and neon reflections"
}
```

### Consultar estado

`GET /api/video/status/:requestId`

## Seguridad

- Nunca colocar la API key en JavaScript del navegador.
- Nunca subir `.env` a GitHub.
- No guardar claves en localStorage.
- Mantener la clave como variable secreta en el servicio de despliegue.

## Despliegue

El repositorio incluye `Dockerfile` y `render.yaml` para facilitar un despliegue como servicio web Node. La API key debe configurarse como secreto en el proveedor de hosting, no dentro del repositorio.

## Verificación de despliegue

Esta versión del repositorio se mantiene en la rama `main`. Si un servicio de hosting muestra una interfaz antigua (por ejemplo, la antigua pantalla de Wan2.2/Hugging Face), debe comprobarse que el servicio está conectado a este repositorio y a `main`, y que el despliegue utiliza el commit más reciente.

<!-- deployment-verification: 2026-09-07 -->
