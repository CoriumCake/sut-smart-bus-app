# SUT Smart Bus - Mobile App

A React Native/Expo mobile application for tracking campus buses at Suranaree University of Technology.

## Features

- 🗺️ Real-time bus tracking on map
- 📍 Route visualization with stops
- 🚌 Bus arrival estimates
- 🌡️ Air quality monitoring (PM2.5)
- 👥 Passenger count display
- 🔔 Driver notification (ring bell)
- 🌙 Dark mode support
- 🌐 Thai/English language

## Getting Started

### Prerequisites

- Node.js 18+
- npm or yarn
- Expo CLI: `npm install -g expo-cli`
- Expo Go app on your phone

### Installation

```bash
# Install dependencies
npm install

# Configure server (edit with your server IP)
cp config/env.example.js config/env.js
nano config/env.js

# Start development server
npx expo start
```

### Configuration

Edit `config/env.js` to set your connection mode:

**Option 1: Cloudflare Tunnel (Public Internet)**
```javascript
export const ENV = {
    CONNECTION_MODE: 'tunnel',
    API_URL: 'https://smartbus.catcode.tech',
    MQTT_WS_URL: 'wss://mqtt.catcode.tech',
    API_SECRET_KEY: 'your-api-key-here',
};
```

**Option 2: Local Network (Campus WiFi/VPN)**
```javascript
export const ENV = {
    CONNECTION_MODE: 'local',
    EXPO_PUBLIC_SERVER_IP: 'YOUR_SERVER_IP',
    EXPO_PUBLIC_API_PORT: '8000',
    MQTT_BROKER_HOST: 'YOUR_SERVER_IP',
};
```

## Project Structure

```
├── App.js              # Main app entry
├── screens/            # Screen components
├── components/         # Reusable components
├── contexts/           # React contexts (theme, language, etc.)
├── config/             # Configuration files
├── utils/              # Utility functions
├── assets/             # Images and icons
└── routes/             # Route data (JSON)
```

## Building for Production

```bash
# Build for Android
npx expo build:android

# Build for iOS
npx expo build:ios

# Or use EAS Build
eas build --platform android
```

## Related Repositories

- [sut-smart-bus-server](https://github.com/YOUR_USERNAME/sut-smart-bus-server) - Backend API
- [sut-smart-bus-hardware](https://github.com/YOUR_USERNAME/sut-smart-bus-hardware) - ESP32 firmware

## License

MIT License
