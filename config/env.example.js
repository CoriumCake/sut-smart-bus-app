// SUT Smart Bus - Environment Configuration Template
// ==================================================
// 
// INSTRUCTIONS:
// 1. Copy this file to "env.js" in the same folder
// 2. Edit the values below with your server settings
// 3. Restart the Expo app to apply changes
//
// NOTE: env.js is gitignored to protect your configuration

export const ENV = {
    // ===========================================
    // Connection Mode (Choose ONE)
    // ===========================================
    // Set to 'tunnel' for Cloudflare Tunnel (public internet)
    // Set to 'local' for direct IP connection (campus network)
    CONNECTION_MODE: 'tunnel',

    // ===========================================
    // Cloudflare Tunnel Settings (if CONNECTION_MODE = 'tunnel')
    // ===========================================
    // Full URLs for Cloudflare Tunnel (no port needed, uses HTTPS)
    API_URL: 'https://smartbus.catcode.tech',
    MQTT_WS_URL: 'wss://mqtt.catcode.tech',

    // ===========================================
    // Local Network Settings (if CONNECTION_MODE = 'local')
    // ===========================================
    // Your backend server IP address
    EXPO_PUBLIC_SERVER_IP: '192.168.1.100',

    // API port (default: 8000)
    EXPO_PUBLIC_API_PORT: '8000',

    // MQTT broker host (usually same as server IP)
    MQTT_BROKER_HOST: '192.168.1.100',

    // MQTT broker port (default: 1883, WebSocket: 9001)
    MQTT_BROKER_PORT: 1883,
    MQTT_WEBSOCKET_PORT: 9001,

    // ===========================================
    // API Authentication (Optional)
    // ===========================================

    // If your server has API_SECRET_KEY set, add it here
    // IMPORTANT: Use the same key as your server's .env file
    API_SECRET_KEY: '',

    // ===========================================
    // Optional Settings
    // ===========================================

    // Google Maps API Key (for web version)
    GOOGLE_MAPS_API_KEY: '',

    // App timezone
    TIMEZONE: 'Asia/Bangkok',
};

