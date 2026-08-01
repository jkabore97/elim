import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.ccelim.app',
  appName: 'ELIM',
  webDir: 'dist',
  plugins: {
    EdgeToEdge: {
      backgroundColor: '#0f172a'
    }
  }
};

export default config;
