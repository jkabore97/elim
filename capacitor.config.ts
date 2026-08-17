import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.elim.app',
  appName: 'ELIM',
  webDir: 'dist',
  plugins: {
    EdgeToEdge: {
      // Matches the light app background so the system-bar areas and the
      // cold-start splash don't flash dark before the light UI appears.
      backgroundColor: '#fbfaf6'
    }
  }
};

export default config;
