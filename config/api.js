import AsyncStorage from '@react-native-async-storage/async-storage';

import { ENV } from './env';

// Determine connection mode
const isTunnelMode = ENV.CONNECTION_MODE === 'tunnel';

// Construct the base URL based on connection mode
export const API_BASE = isTunnelMode
  ? ENV.API_URL
  : `http://${ENV.EXPO_PUBLIC_SERVER_IP}:${ENV.EXPO_PUBLIC_API_PORT}`;

// MQTT Configuration (exported for use in screens)
export const MQTT_CONFIG = isTunnelMode
  ? {
    // Cloudflare Tunnel mode - use WebSocket URL
    wsUrl: ENV.MQTT_WS_URL,
    useSecure: true,
  }
  : {
    // Local mode - use IP and ports
    host: ENV.MQTT_BROKER_HOST || ENV.EXPO_PUBLIC_SERVER_IP,
    port: ENV.MQTT_BROKER_PORT || 1883,
    wsPort: ENV.MQTT_WEBSOCKET_PORT || 9001,
    useSecure: false,
  };

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