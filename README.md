# BROOM ROYALE — Duelo Arcano 3D & WebXR VR

Battle Royale aéreo en escobas voladoras con hechizos (`Ignis`, `Glacies`, `Fulgur`, `Scutum`), mapa estilo castillo gótico con arquitectura PBR + voxel, motor de renderizado Pro HDR y soporte completo para navegador PC y gafas VR (WebXR 6DoF).

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/elcanop/broom-royale)

## Despliegue en la Nube (Gratis en Render)

El repositorio incluye [`render.yaml`](./render.yaml) configurado en `plan: free` con soporte completo para HTTP estático (`dist/`), comprobación de salud (`/health`) y servidor multijugador WebSocket (`/ws`).

## Desarrollo Local

```bash
npm install
npm run dev
```

- Cliente Vite: `http://localhost:5173`
- Servidor WebSocket / Producción: `http://localhost:8787`

## Producción

```bash
npm run build
npm start
```
