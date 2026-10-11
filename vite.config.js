import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath } from 'node:url';

export default defineConfig(({command,mode}) => {
  // Fail safely BEFORE publishing an unusable customer production site.
  // Preview/CI builds may have placeholder values; they are not production releases.
  if (command === 'build' && process.env.VERCEL_ENV === 'production') {
    const env = loadEnv(mode,process.cwd(),'VITE_');
    if (!['true','false'].includes(env.VITE_REPCOUNT_DEMO_MODE)) {
      throw new Error('[RepCount setup] Set VITE_REPCOUNT_DEMO_MODE explicitly to false for a gym (true only for the public fictional demo).');
    }
    if (env.VITE_REPCOUNT_DEMO_MODE === 'false') {
      const url=String(env.VITE_SUPABASE_URL||'').replace(/\/$/,'');
      const key=String(env.VITE_SUPABASE_PUBLISHABLE_KEY||'');
      if (!/^https:\/\/[a-z0-9]{20}\.supabase\.co$/.test(url)) {
        throw new Error('[RepCount setup] Invalid VITE_SUPABASE_URL. Use THIS GYM\'S https://<project-ref>.supabase.co in Vercel Production.');
      }
      if (!key || /PLACEHOLDER|REPLACE|PASTE|BUILD_CHECK/i.test(key) ||
          !(key.startsWith('sb_publishable_')||key.startsWith('eyJ'))) {
        throw new Error('[RepCount setup] Add THIS GYM\'S real VITE_SUPABASE_PUBLISHABLE_KEY to Vercel Production. Never use a service role key.');
      }
    }
  }
  return {
    plugins: [react(), tailwindcss()],
    build: { target:'esnext' },
    resolve: {
      alias: {'@':fileURLToPath(new URL('./src',import.meta.url))}
    }
  };
});
