import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.elim.app',
  appName: 'ELIM',
  webDir: 'dist',
  // The app loads the LIVE site instead of the bundled copy, so publishing the
  // website (ccelim.com) updates the installed Android app instantly - no new
  // AAB per change. The web code already branches on Capacitor.isNativePlatform(),
  // so native push/features keep working here while the browser uses the web
  // path. The bundled `dist` stays as the fallback shipped inside the app.
  server: {
    url: 'https://ccelim.com',
    cleartext: false,
  },
  plugins: {
    EdgeToEdge: {
      // Cold-start colour, before any JS runs and can read the system theme.
      // Matches the light page background; App.tsx re-applies the correct
      // light/dark colour as soon as it mounts.
      backgroundColor: '#fff2e0'
    }
  }
};

export default config;
