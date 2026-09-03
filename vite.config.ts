import { defineConfig } from 'vite';

/**
 * Build + dev-server configuration.
 *
 * SECURE DEFAULTS (docs/SECURITY.md): the dev server previously ran
 * `host: true`, which binds EVERY interface — anyone on the network
 * could read it, and published advisories against the dev server
 * (esbuild GHSA-67mh-4wv8-2f99, "any website can send requests to the
 * development server and read the response") make that materially
 * worse. The dev server now binds loopback, refuses cross-origin
 * reads, and will not serve outside the project root.
 *
 * Exposing it deliberately is still possible — `PAYLOAD_DEV_HOST=0.0.0.0`
 * — but it is now an explicit act rather than the default.
 */
const devHost = process.env.PAYLOAD_DEV_HOST ?? '127.0.0.1';

export default defineConfig({
  base: './',
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1500,
  },
  server: {
    // The instrument panels are loaded on first open (see lazyPanel in
    // src/main.ts). In a production build those are static chunks, but a
    // COLD dev server discovers their module graph at that moment and
    // can re-optimize dependencies — which forces a full page reload
    // mid-session, exactly when the operator asked to open something.
    // Warming them at startup moves that discovery to boot, where it
    // costs nothing anyone is waiting on.
    warmup: {
      clientFiles: [
        './src/ui/securityPanel.ts',
        './src/ui/ecosystemPanel.ts',
        './src/ui/notationPanel.ts',
        './src/ui/vocabularyPanel.ts',
        './src/ui/corpusPanel.ts',
        './src/ui/compilerPanel.ts',
        './src/ui/refusalsPanel.ts',
        './src/ui/vocabPanel.ts',
      ],
    },
    host: devHost,
    strictPort: false,
    // the dev server is a build tool, not an API: nothing legitimate
    // reads it cross-origin
    cors: false,
    fs: {
      // never serve files outside the project root
      strict: true,
      deny: ['.env', '.env.*', '*.pem', '*.key', '.live-cache/**'],
    },
  },
  preview: {
    host: devHost,
    cors: false,
  },
});
