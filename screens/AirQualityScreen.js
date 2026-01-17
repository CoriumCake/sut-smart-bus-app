import React, { useState, useEffect, useRef, useCallback } from 'react';
import { View, Text, StyleSheet, FlatList, Platform, TouchableOpacity, Alert } from 'react-native';
import * as Location from 'expo-location';
import axios from 'axios';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { getApiUrl, checkApiKey, getApiHeaders, getConnectionMode } from '../config/api';
import { useDebug } from '../contexts/DebugContext';
import { useServerConfig } from '../hooks/useServerConfig';
import { getAirQualityStatus } from '../utils/airQuality';
import AirQualityMap from '../components/AirQualityMap';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as mqtt from 'mqtt';


const AirQualityScreen = () => {
  const navigation = useNavigation();
  const { debugMode } = useDebug();
  const { serverIp } = useServerConfig(); // Use hook
  const [buses, setBuses] = useState([]);
  const [error, setError] = useState(null);
  const mapRef = useRef(null);

  // Destination marker states (for debug mode)
  const [destinationMarkers, setDestinationMarkers] = useState({});
  const [busDirections, setBusDirections] = useState({}); // Track bus movement directions
  const previousBusPositions = useRef({});
  const [userLocation, setUserLocation] = useState(null);

  const SUT_COORDINATES = {
    latitude: 14.8820,
    longitude: 102.0207,
    latitudeDelta: 0.005,
    longitudeDelta: 0.005,
  };

  // Force re-render periodically to update offline status
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const interval = setInterval(() => setTick(t => t + 1), 10000); // Check every 10s
    return () => clearInterval(interval);
  }, []);

  // Fetch buses API function
  const fetchBusesAPI = useCallback(async () => {
    try {
      const apiKey = await checkApiKey();
      if (!apiKey) return;

      const apiUrl = await getApiUrl();
      const response = await axios.get(`${apiUrl}/api/buses`, {
        headers: getApiHeaders(),
        timeout: 5000
      });
      const newBuses = response.data;

      // Check for valid array before processing
      if (newBuses && Array.isArray(newBuses)) {
        // Add timestamp to initial fetch
        const busesWithTime = newBuses.map(b => ({
          ...b,
          last_updated: Date.now() // Assume fresh on fetch
        }));
        updateBusesState(busesWithTime);
      }
    } catch (err) {
      console.log('Fetch failed (server may be offline):', err.message);
    }
  }, []);

  // ... (useFocusEffect and useEffect for MQTT stay same until setBuses) 
  // Wait, I can't easily replace just the MQTT handler inner logic with replace_file_content safely due to indentation.
  // I will use multi_replace.

  const renderBusItem = ({ item }) => {
    const { status, solidColor } = getAirQualityStatus(item.pm2_5);
    const hasDestination = destinationMarkers[item.mac_address];

    // Check if offline (> 1 minute silence)
    const isOffline = item.last_updated && (Date.now() - item.last_updated > 60000);
    const opacity = isOffline ? 0.4 : 1.0;

    return (
      <TouchableOpacity
        style={[styles.card, { opacity }]}
        onPress={() => zoomToBus(item)}
        activeOpacity={0.7}
      >
        <View style={styles.cardHeader}>
          <Text style={styles.busName}>{item.bus_name || `Bus ${item.mac_address.slice(-5)}`}</Text>
          <View style={{ flexDirection: 'row', gap: 5 }}>
            {/* Show OFFLINE badge if offline */}
            {isOffline && (
              <Text style={[styles.statusBadge, { backgroundColor: '#9e9e9e' }]}>OFFLINE</Text>
            )}
            {hasDestination && (
              <TouchableOpacity
                style={[styles.statusBadge, { backgroundColor: '#F57C00' }]}
                onPress={() => {
                  setDestinationMarkers(prev => {
                    const updated = { ...prev };
                    delete updated[item.mac_address];
                    return updated;
                  });
                }}
              >
                <Text style={{ color: '#fff', fontSize: 10 }}>📍 Clear</Text>
              </TouchableOpacity>
            )}
            <Text style={[styles.statusBadge, { backgroundColor: solidColor }]}>{status}</Text>
          </View>
        </View>
        <View style={styles.cardBody}>
          <Text style={styles.metric}>PM2.5: <Text style={styles.bold}>{item.pm2_5 !== undefined && item.pm2_5 !== null ? item.pm2_5.toFixed(1) : '--'}</Text> µg/m³</Text>
          <Text style={styles.metric}>PM10: <Text style={styles.bold}>{item.pm10 !== undefined && item.pm10 !== null ? item.pm10.toFixed(1) : '--'}</Text> µg/m³</Text>
        </View>
        <View style={[styles.cardBody, { marginTop: 5 }]}>
          <Text style={styles.metric}>Temp: <Text style={styles.bold}>{item.temp !== undefined && item.temp !== null ? item.temp.toFixed(1) : '--'}</Text> °C</Text>
          <Text style={styles.metric}>Hum: <Text style={styles.bold}>{item.hum !== undefined && item.hum !== null ? item.hum.toFixed(0) : '--'}</Text> %</Text>
        </View>
        {hasDestination && (
          <Text style={styles.destinationText}>🎯 Destination set</Text>
        )}
      </TouchableOpacity>
    );
  };

  // Reload buses when screen gains focus (sync deletion)
  useFocusEffect(
    useCallback(() => {
      fetchBusesAPI();
    }, [fetchBusesAPI])
  );

  useEffect(() => {
    // Initial fetch
    fetchBusesAPI();

    // POLLING MECHANISM (HTTP-Only Mode)
    // Replace MQTT with 2-second interval polling
    const pollInterval = setInterval(() => {
      fetchBusesAPI();
    }, 2000);

    return () => {
      clearInterval(pollInterval);
    };
  }, [fetchBusesAPI]);

  const getLocation = async () => {
    try {
      let { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission denied', 'Location permission is required to zoom to your location.');
        return;
      }

      const enabled = await Location.hasServicesEnabledAsync();
      if (!enabled) {
        console.warn('Location Services Disabled');
        return;
      }

      // Try to get last known position first
      let location = await Location.getLastKnownPositionAsync({});
      if (!location) {
        // If no last known location, try to get current position
        location = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        });
      }

      if (location) {
        setUserLocation(location.coords);
      }
    } catch (e) {
      console.error("Error getting location:", e);
    }
  };

  const zoomToLocation = async () => {
    if (!userLocation) {
      await getLocation();
    }

    if (userLocation && mapRef.current) {
      mapRef.current.animateToRegion({
        latitude: userLocation.latitude,
        longitude: userLocation.longitude,
        latitudeDelta: 0.005,
        longitudeDelta: 0.005,
      });
    } else {
      // Fallback to SUT
      if (mapRef.current) {
        mapRef.current.animateToRegion(SUT_COORDINATES);
        Alert.alert('Location Unavailable', 'Zooming to Suranaree University of Technology (Default).');
      }
    }
  };

  // Helper to handle direction updates from single data points
  const handleDirectionUpdate = (data) => {
    const busId = data.bus_mac;
    const prevPos = previousBusPositions.current[busId];

    // If we have a previous position and it's different
    if (prevPos && (prevPos.lat !== data.lat || prevPos.lon !== data.lon)) {
      const direction = {
        lat: data.lat - prevPos.lat,
        lon: data.lon - prevPos.lon,
      };

      setBusDirections(prev => {
        const prevDirection = prev[busId];
        if (prevDirection) {
          const dotProduct = direction.lat * prevDirection.lat + direction.lon * prevDirection.lon;
          const magnitude1 = Math.sqrt(direction.lat ** 2 + direction.lon ** 2);
          const magnitude2 = Math.sqrt(prevDirection.lat ** 2 + prevDirection.lon ** 2);
          // Avoid division by zero
          if (magnitude1 > 0 && magnitude2 > 0) {
            const cosAngle = dotProduct / (magnitude1 * magnitude2);
            if (cosAngle < 0.7) {
              setDestinationMarkers(d => {
                const updated = { ...d };
                delete updated[busId];
                return updated;
              });
            }
          }
        }
        return { ...prev, [busId]: direction };
      });
    }

    // Update the ref
    previousBusPositions.current[busId] = {
      lat: data.lat,
      lon: data.lon
    };
  };

  const updateBusesState = (newBuses) => {
    setBuses(newBuses);
    // Initialize previous positions
    newBuses.forEach(bus => {
      if (bus.current_lat && bus.current_lon) {
        previousBusPositions.current[bus.mac_address] = {
          lat: bus.current_lat,
          lon: bus.current_lon
        };
      }
    });
  };


  const handleLongPress = (e) => {
    if (!debugMode) return;

    const { coordinate } = e.nativeEvent;

    // Find closest bus to assign destination
    if (buses.length > 0) {
      let closestBus = buses[0];
      let minDistance = Infinity;

      buses.forEach(bus => {
        if (!bus.current_lat || !bus.current_lon) return;
        const distance = Math.sqrt(
          Math.pow(bus.current_lat - coordinate.latitude, 2) +
          Math.pow(bus.current_lon - coordinate.longitude, 2)
        );
        if (distance < minDistance) {
          minDistance = distance;
          closestBus = bus;
        }
      });

      // Set destination for closest bus
      setDestinationMarkers(prev => ({
        ...prev,
        [closestBus.mac_address]: coordinate,
      }));
    }
  };

  // Zoom to specific bus
  const zoomToBus = (bus) => {
    if (bus.current_lat && bus.current_lon && mapRef.current) {
      mapRef.current.animateToRegion({
        latitude: bus.current_lat,
        longitude: bus.current_lon,
        latitudeDelta: 0.005,
        longitudeDelta: 0.005,
      });
    } else {
      Alert.alert('Location unavailable', 'This bus has no current location data.');
    }
  };



  if (Platform.OS === 'web') {
    return (
      <View style={styles.container}>
        <Text style={styles.title}>Air Quality Monitoring</Text>
        <FlatList
          data={buses}
          renderItem={renderBusItem}
          keyExtractor={(item) => item.mac_address}
          contentContainerStyle={styles.listContainer}
        />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={{ flex: 1, position: 'relative' }}>
        <AirQualityMap
          mapRef={mapRef}
          buses={buses}
          userLocation={userLocation}
          destinationMarkers={destinationMarkers}
          onLongPress={handleLongPress}
          onZoomToLocation={zoomToLocation}
        />

        {/* PM Zone Editor Launch Button */}
        {debugMode && (
          <TouchableOpacity
            style={{
              position: 'absolute',
              bottom: 40,
              left: 20,
              backgroundColor: '#ef4444',
              borderRadius: 50,
              width: 50,
              height: 50,
              justifyContent: 'center',
              alignItems: 'center',
              elevation: 5,
              shadowColor: '#000',
              shadowOffset: { width: 0, height: 2 },
              shadowOpacity: 0.25,
              shadowRadius: 3.84,
              zIndex: 1000
            }}
            onPress={() => navigation.navigate('PMZoneEditor')}
          >
            <Ionicons name="map" size={24} color="white" />
          </TouchableOpacity>
        )}
      </View>

      {debugMode && (
        <View style={styles.debugBanner}>
          <Text style={styles.debugText}>🛠️ Debug Mode: Long press to set destination</Text>
        </View>
      )}

      <View style={styles.listContainer}>
        <View style={styles.listHeader}>
          <Text style={styles.listTitle}>Live Bus Air Quality</Text>
          <TouchableOpacity
            style={styles.dashboardButton}
            onPress={() => navigation.navigate('AirQualityDashboard', { buses })}
          >
            <Ionicons name="stats-chart" size={22} color="#2196F3" />
          </TouchableOpacity>
        </View>
        {error && <Text style={styles.error}>{error}</Text>}
        <FlatList
          data={buses}
          renderItem={renderBusItem}
          keyExtractor={(item) => item.mac_address}
          style={styles.list}
        />
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  map: {
    flex: 1,
  },
  listContainer: {
    flex: 1,
    padding: 10,
    backgroundColor: '#fff',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    marginTop: -20, // Overlap map slightly
    shadowColor: "#000",
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.1,
    shadowRadius: 5,
    elevation: 5,
  },
  listHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  dashboardButton: {
    padding: 8,
    borderRadius: 8,
    backgroundColor: 'rgba(33, 150, 243, 0.1)',
  },
  listTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    marginBottom: 10,
    textAlign: 'center',
    color: '#333',
  },
  card: {
    backgroundColor: '#fff',
    borderRadius: 10,
    padding: 15,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#eee',
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 2,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  busName: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#333',
  },
  statusBadge: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 15,
    color: '#fff',
    fontWeight: 'bold',
    fontSize: 12,
    overflow: 'hidden',
  },
  cardBody: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  metric: {
    fontSize: 14,
    color: '#666',
  },
  bold: {
    fontWeight: 'bold',
    color: '#333',
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    margin: 20,
    textAlign: 'center',
  },
  error: {
    color: 'red',
    textAlign: 'center',
    marginBottom: 10,
  },
  list: {
    flex: 1,
  },
  destinationText: {
    marginTop: 8,
    fontSize: 12,
    color: '#F57C00',
    fontWeight: '600',
  },
  debugBanner: {
    position: 'absolute',
    top: 10,
    left: 10,
    right: 10,
    backgroundColor: 'rgba(255, 152, 0, 0.9)',
    padding: 10,
    borderRadius: 8,
    zIndex: 1000,
  },
  debugText: {
    color: '#fff',
    fontWeight: 'bold',
    textAlign: 'center',
    fontSize: 14,
  },
});

export default AirQualityScreen;
