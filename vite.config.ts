import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      // ✅ "prompt" permite mostrar aviso "Nova versão disponível" dentro do app
      registerType: "prompt",

      includeAssets: [
        "favicon.ico",
        "favicon.png",
        "pwa-192x192.png",
        "pwa-512x512.png"
      ],

      workbox: {
        cleanupOutdatedCaches: true
      },

      manifest: {
        name: "RDO Turno",
        short_name: "RDO", // ✅ recomendado: nome curto no ícone
        description: "Relatório de Turno Offline",
        theme_color: "#111827",
        background_color: "#111827",
        display: "standalone",
        scope: "/",
        start_url: "/",
        icons: [
          { src: "/pwa-192x192.png", sizes: "192x192", type: "image/png" },
          { src: "/pwa-512x512.png", sizes: "512x512", type: "image/png" }
        ]
      }
    })
  ]
});
