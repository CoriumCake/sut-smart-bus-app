import './shim';
import 'react-native-gesture-handler';
import React, { useEffect } from 'react';
import { StatusBar } from 'expo-status-bar';
import { View, Text, ActivityIndicator } from 'react-native'; // <-- ADDED
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Ionicons } from '@expo/vector-icons';

import { DataProvider, useData } from './contexts/DataContext'; // <-- ADDED useData
import { DebugProvider, useDebug } from './contexts/DebugContext';
import { ThemeProvider, useTheme } from './contexts/ThemeContext';
import { LanguageProvider } from './contexts/LanguageContext';
import { NotificationProvider } from './contexts/NotificationContext';
import ErrorBoundary from './components/ErrorBoundary';
import MapScreen from './screens/MapScreen';
import RoutesScreen from './screens/RoutesScreen';
import AirQualityScreen from './screens/AirQualityScreen';
import SettingsScreen from './screens/SettingsScreen';
import RouteEditorScreen from './screens/RouteEditorScreen';
import BusRouteAdminScreen from './screens/BusRouteAdminScreen';
import BusManagementScreen from './screens/BusManagementScreen';
import AirQualityDashboardScreen from './screens/AirQualityDashboardScreen';
import AboutScreen from './screens/AboutScreen';
import { createStackNavigator } from '@react-navigation/stack';
import { loadDefaultRoutes } from './utils/defaultRoutes';
import { fetchAndSyncMappings } from './utils/busRouteMapping';

const Tab = createBottomTabNavigator();

const TabNavigator = () => {
  const { debugMode } = useDebug();
  const { theme } = useTheme();

  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarActiveTintColor: theme.primary,
        tabBarInactiveTintColor: theme.textMuted,
        tabBarStyle: {
          backgroundColor: theme.tabBar,
          borderTopColor: theme.tabBarBorder,
        },
        tabBarIcon: ({ color, size }) => {
          const iconMap = {
            Map: 'map',
            Routes: 'list',
            'Air Quality': 'cloud',
            Settings: 'settings',
            Testing: 'bug',
          };
          const iconName = iconMap[route.name] || 'ellipse';
          return <Ionicons name={iconName} size={size} color={color} />;
        },
      })}
    >
      <Tab.Screen name="Map" component={MapScreen} />
      <Tab.Screen name="Routes" component={RoutesScreen} />
      <Tab.Screen name="Air Quality" component={AirQualityScreen} />
      <Tab.Screen name="Settings" component={SettingsScreen} />
    </Tab.Navigator>
  );
};

const Stack = createStackNavigator();

const AppNavigator = () => {
  const { theme } = useTheme();

  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="MainTabs" component={TabNavigator} />
      <Stack.Screen name="RouteEditor" component={RouteEditorScreen} />
      <Stack.Screen name="BusRouteAdmin" component={BusRouteAdminScreen} />
      <Stack.Screen name="BusManagement" component={BusManagementScreen} />
      <Stack.Screen name="AirQualityDashboard" component={AirQualityDashboardScreen} />
      <Stack.Screen name="About" component={AboutScreen} />
    </Stack.Navigator>
  );
};

// Inner app that needs access to theme
const ThemedApp = () => {
  const { theme } = useTheme();
  const { loading } = useData(); // <-- ADDED: Check global loading state

  // Load default bundled routes and sync bus-route mappings on first launch
  useEffect(() => {
    loadDefaultRoutes();
    // Fetch latest bus-route mappings from server
    fetchAndSyncMappings().then(updated => {
      if (updated) console.log('[App] Bus route mappings updated from server');
    });
  }, []);

  // Show splash/loading screen while initial data is fetching
  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.background, justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator size="large" color={theme.primary} />
        <Text style={{ marginTop: 20, color: theme.text, fontSize: 16, fontWeight: '500' }}>
          Loading Smart Bus Data...
        </Text>
      </View>
    );
  }

  return (
    <NavigationContainer>
      <StatusBar style={theme.statusBar} />
      <AppNavigator />
    </NavigationContainer>
  );
};

const App = () => (
  <ThemeProvider>
    <LanguageProvider>
      <NotificationProvider>
        <DebugProvider>
          <DataProvider>
            <ErrorBoundary>
              <ThemedApp />
            </ErrorBoundary>
          </DataProvider>
        </DebugProvider>
      </NotificationProvider>
    </LanguageProvider>
  </ThemeProvider>
);

export default App;
