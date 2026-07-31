import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.ccelim.app',
  appName: 'ELIM',
  webDir: 'dist',
  plugins: {
    EdgeToEdge: {
      backgroundColor: '#ffffff'
    }
  }
};

export default config;
