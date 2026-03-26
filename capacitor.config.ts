import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'app.lovable.0664b92985614c0ebe90b14e3fcda8e1',
  appName: 'Insight DesignCheck',
  webDir: 'dist',
  server: {
    url: 'https://0664b929-8561-4c0e-be90-b14e3fcda8e1.lovableproject.com?forceHideBadge=true',
    cleartext: true,
  },
  ios: {
    contentInset: 'automatic',
    backgroundColor: '#0f4c5c',
  },
  android: {
    backgroundColor: '#0f4c5c',
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 2000,
      backgroundColor: '#0f4c5c',
      showSpinner: false,
      androidScaleType: 'CENTER_CROP',
    },
    StatusBar: {
      style: 'LIGHT',
      backgroundColor: '#0f4c5c',
    },
  },
};

export default config;
