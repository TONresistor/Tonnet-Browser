import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { resolve } from 'path'
import { readFileSync } from 'fs'

const pkg = JSON.parse(readFileSync('package.json', 'utf-8'))
const lottiePlayerJs = readFileSync('node_modules/lottie-web/build/player/lottie_light.min.js', 'utf-8')
const loadingAnimationJson = readFileSync('src/renderer/src/assets/loading.json', 'utf-8')

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    define: {
      __APP_VERSION__: JSON.stringify(pkg.version),
      __LOTTIE_PLAYER_JS__: JSON.stringify(lottiePlayerJs),
      __LOADING_ANIMATION_JSON__: loadingAnimationJson,
    },
    build: {
      minify: 'esbuild',
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/main/index.ts'),
        },
      },
    },
    resolve: {
      alias: {
        '@shared': resolve(__dirname, 'src/shared'),
      },
    },
  },
  preload: {
    plugins: [],
    define: { __APP_VERSION__: JSON.stringify(pkg.version) },
    build: {
      minify: 'esbuild',
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/preload/index.ts'),
        },
        output: {
          format: 'cjs',
          entryFileNames: '[name].js',
        },
      },
    },
    resolve: {
      alias: {
        '@shared': resolve(__dirname, 'src/shared'),
      },
    },
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    build: {
      chunkSizeWarningLimit: 1500,
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/renderer/index.html'),
        },
        output: {
          manualChunks: {
            i18n: ['i18next', 'react-i18next'],
            dnd: ['@dnd-kit/core', '@dnd-kit/sortable', '@dnd-kit/utilities'],
            lottie: ['lottie-react', 'lottie-web'],
          },
        },
      },
    },
    plugins: [
      react({
        babel: {
          plugins: [['babel-plugin-react-compiler', {}]],
        },
      }),
      tailwindcss(),
    ],
    define: { __APP_VERSION__: JSON.stringify(pkg.version) },
    resolve: {
      alias: {
        '@': resolve(__dirname, 'src/renderer/src'),
        '@shared': resolve(__dirname, 'src/shared'),
      },
    },
  },
})
