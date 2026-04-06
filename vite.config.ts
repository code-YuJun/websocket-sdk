import { defineConfig } from 'vite'
import { resolve } from 'path'

export default defineConfig({
  build: {
    lib: {
      entry: resolve(__dirname, 'src/index.js'),
      name: 'WsSocket',
      fileName: (format) => `websocket-sdk.${format}.js`
    },
    rollupOptions: {
      output: [
        {
          format: 'es',
          dir: 'dist/es'
        },
        {
          format: 'umd',
          dir: 'dist/umd',
          name: 'WsSocket'
        }
      ]
    },
    outDir: 'dist'
  }
})
