import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { ENV } from './env';

// Determine connection mode
const isTunnelMode = ENV.CONNECTION_MODE === 'tunnel';

// Construct the base URL based on connection mode
export const API_BASE = (() => {
  if (isTunnelMode) return ENV.API_URL;

  let host = ENV.EXPO_PUBLIC_SERVER_IP;
  // Fix for Android Emulator trying to access localhost
  if (Platform.OS === 'android' && (host === 'localhost' || host === '127.0.0.1')) {
    host = '10.0.2.2';
  }
  return `http://${host}:${ENV.EXPO_PUBLIC_API_PORT}`;
})();

// MQTT Configuration Removed (HTTP Only)
// export const MQTT_CONFIG = ...

// Get headers for API requests (includes auth if configured)
export const getApiHeaders = () => {
  const headers = {
    'Content-Type': 'application/json',
  };

  // Add API key if configured
  if (ENV.API_SECRET_KEY) {
    headers['X-API-Key'] = ENV.API_SECRET_KEY;
  }

  return headers;
};

export const getApiUrl = async () => {
  return API_BASE;
};

export const checkApiKey = async () => {
  return ENV.API_SECRET_KEY ? "authenticated" : "open-access";
};

// Helper to check connection mode
export const getConnectionMode = () => ENV.CONNECTION_MODE || 'local';