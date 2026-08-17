import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.elim.app',
  appName: 'ELIM',
  webDir: 'dist',
  plugins: {
    EdgeToEdge: {
      // Cold-start colour, before any JS runs and can read the system theme.
      // Matches the light page background; App.tsx re-applies the correct
      // light/dark colour as soon as it mounts.
      backgroundColor: '#fffaf4'
    }
  }
};

export default config;
