# Sala de Proyección

Backend inicial para generar vídeo mediante IA desde texto.

## Proveedor inicial

La integración usa la API gratuita de **LTX 2.5 Free de Pixazo**. El endpoint oficial documentado actualmente es:

`POST https://gateway.pixazo.ai/ltx-video/v1/text-to-video`

La API es asíncrona: devuelve un `request_id` y después se consulta el estado en:

`GET https://gateway.pixazo.ai/v2/requests/status/{request_id}`

## Configuración

1. Instala Node.js 18 o superior.
2. Ejecuta `npm install`.
3. Copia `.env.example` a `.env`.
4. Introduce tu clave en `PIXAZO_API_KEY`.
5. Ejecuta `npm start`.

Nunca pongas la API key en el frontend ni la subas al repositorio.

## Endpoints internos

### Salud

`GET /api/health`

### Generar vídeo

`POST /api/video/generate`

Ejemplo:

```json
{
  "prompt": "A cinematic night drive through a futuristic city, realistic camera movement, rain and neon reflections",
  "aspect": "16:9",
  "num_frames": 121,
  "frame_rate": 24
}
```

La respuesta contiene el `request_id` de Pixazo.

### Consultar estado

`GET /api/video/status/:requestId`

Cuando Pixazo devuelve `COMPLETED`, el resultado contiene la URL del MP4.

## Notas

La documentación actual de Pixazo identifica LTX 2.5 Free como una API gratuita, aunque su disponibilidad, límites y condiciones pueden cambiar. Antes de uso comercial se deben revisar los términos y derechos del modelo.
