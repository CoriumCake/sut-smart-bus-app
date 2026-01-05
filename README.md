# SUT Smart Bus - Mobile App

React Native/Expo mobile application for tracking campus buses at Suranaree University of Technology.

## Features

- 🗺️ Real-time bus tracking on map
- 📍 Route visualization with stops
- 🚌 Bus arrival estimates
- 🌡️ Air quality monitoring (PM2.5/PM10)
- 👥 Live passenger count display
- 🔔 Driver notification (ring bell)
- 🌙 Dark/Light mode
- 🌐 Thai/English language support
- 🛠️ Route editor (admin mode)
- 📊 Debug/testing tools

## Screens

| Screen | Description |
|--------|-------------|
| Map | Real-time bus tracking with route overlay |
| Routes | Browse available bus routes |
| Air Quality | PM2.5/PM10 readings from buses |
| Settings | Theme, language, connection mode |
| Testing | Debug tools, fake bus simulation |
| Route Editor | Create/edit routes (admin) |

## Getting Started

### Prerequisites

- Node.js 18+
- npm or yarn
- Expo Go app on your phone

### Installation

```bash
# Clone and enter directory
cd sut-smart-bus-app

# Install dependencies
npm install

# Configure server connection
cp config/env.example.js config/env.js

# Start development server
npx expo start
```

### Configuration

Edit `config/env.js` to connect to your server:

#### Option 1: Docker on Local Network
```javascript
export const ENV = {
    CONNECTION_MODE: 'local',
    EXPO_PUBLIC_SERVER_IP: '192.168.1.100',  // Your Docker host IP
    EXPO_PUBLIC_API_PORT: '8000',
    MQTT_BROKER_HOST: '192.168.1.100',
    MQTT_BROKER_PORT: 1883,
    MQTT_WEBSOCKET_PORT: 9001,
    API_SECRET_KEY: '',  // If server has API_SECRET_KEY set
};
```

#### Option 2: Cloudflare Tunnel (Public Internet)
```javascript
export const ENV = {
    CONNECTION_MODE: 'tunnel',
    API_URL: 'https://smartbus.catcode.tech',
    MQTT_WS_URL: 'wss://mqtt.catcode.tech',
    API_SECRET_KEY: 'your-api-key-here',
};
```

## Project Structure

```
├── App.js                 # Main app entry with navigation
├── screens/
│   ├── MapScreen.js       # Real-time bus tracking
│   ├── RoutesScreen.js    # Route list
│   ├── AirQualityScreen.js# PM2.5/PM10 display
│   ├── SettingsScreen.js  # App settings
│   ├── TestingScreen.js   # Debug tools
│   ├── RouteEditorScreen.js# Route creation/editing
│   └── ...
├── components/            # Reusable UI components
├── contexts/              # React contexts
│   ├── ThemeContext.js    # Dark/light mode
│   ├── LanguageContext.js # i18n
│   └── DebugContext.js    # Debug settings
├── config/
│   ├── env.js             # Server configuration (gitignored)
│   ├── env.example.js     # Configuration template
│   └── api.js             # API client
├── utils/                 # Helper functions
├── routes/                # Route JSON data
└── assets/                # Images and icons
```

## MQTT Subscriptions

The app subscribes to these topics for real-time updates:

| Topic | Data |
|-------|------|
| `sut/app/bus/location` | Bus GPS + sensor data |
| `bus/door/count` | Passenger enter/exit events |
| `sut/bus/+/status` | Device status (RSSI, uptime) |

## Building for Production

```bash
# Install EAS CLI
npm install -g eas-cli

# Login to Expo
eas login

# Build for Android
eas build --platform android

# Build for iOS
eas build --platform ios
```

## Debug Mode

Access debug features in Settings → Enable Debug Mode:
- Fake bus simulation (draggable marker)
- Server connection status
- MQTT message inspector
- Route sync tools

## Related Repositories

- [sut-smart-bus-server](../sut-smart-bus-server) - Backend API (FastAPI + Docker)
- [sut-smart-bus-hardware](../sut-smart-bus-hardware) - ESP32 firmware

## License

MIT License
