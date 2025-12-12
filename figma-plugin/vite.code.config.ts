import { defineConfig } from 'vite';
import path from 'path';

export default defineConfig({
    build: {
        emptyOutDir: false,
        outDir: 'dist',
        target: 'es6',
        minify: false,
        lib: {
            entry: path.resolve(__dirname, 'src/code.ts'),
            name: 'code',
            fileName: 'code',
            formats: ['es'],
        },
        rollupOptions: {
            output: {
                entryFileNames: 'code.js',
            }
        }
    }
});
