import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Production-only Content Security Policy. It forbids every network connection,
 * remote script, style, font and image, so the built app cannot phone home.
 * Development servers need inline scripts for hot reload, so the policy is
 * injected only into the production build.
 */
function contentSecurityPolicy(): Plugin {
  return {
    name: 'feed-repair-desk-csp',
    apply: 'build',
    transformIndexHtml(html) {
      return {
        html,
        tags: [
          {
            tag: 'meta',
            injectTo: 'head-prepend',
            attrs: {
              'http-equiv': 'Content-Security-Policy',
              content:
                "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'none'; form-action 'none'; base-uri 'none'; object-src 'none'",
            },
          },
        ],
      };
    },
  };
}

// Built for a repository subpath on GitHub Pages; the release owner publishes separately.
export default defineConfig({
  base: '/feed-repair-desk/',
  plugins: [react(), contentSecurityPolicy()],
  build: {
    target: 'es2022',
    sourcemap: false,
    modulePreload: { polyfill: false },
  },
  server: { host: '127.0.0.1' },
  preview: { host: '127.0.0.1' },
});
