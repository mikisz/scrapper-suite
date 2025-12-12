import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';
import path from 'path';

export default defineConfig({
    plugins: [viteSingleFile()],
    build: {
        target: 'esnext',
        assetsInlineLimit: 100000000,
        chunkSizeWarningLimit: 100000000,
        cssCodeSplit: false,
        outDir: 'dist',
        emptyOutDir: true,
        rollupOptions: {
            input: {
                ui: path.resolve(__dirname, 'src/ui.html'),
            },
            output: {
                entryFileNames: 'ui.js', // Not used by singlefile but good to have
            },
        },
    },
});
