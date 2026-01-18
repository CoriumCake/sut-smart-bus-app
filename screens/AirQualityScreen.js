import React, { useState, useEffect, useRef, useCallback } from 'react';
import { View, Text, StyleSheet, FlatList, Platform, TouchableOpacity, Alert } from 'react-native';
import * as Location from 'expo-location';
import axios from 'axios';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { getApiUrl, checkApiKey, getApiHeaders } from '../config/api'; // Removed MQTT_CONFIG, getConnectionMode
import { useDebug } from '../contexts/DebugContext';
// import { useServerConfig } from '../hooks/useServerConfig'; // Removed unused hook
import { useData } from '../contexts/DataContext'; // <-- ADDED
import { getAirQualityStatus } from '../utils/airQuality';
import AirQualityMap from '../components/AirQualityMap';


const AirQualityScreen = () => {
  const navigation = useNavigation();
  const { debugMode } = useDebug();
  // const { serverIp } = useServerConfig(); // Removed: Not needed for local MQTT anymore
  const { buses } = useData(); // <-- ADDED: Consume Context
  const [error, setError] = useState(null);
  const mapRef = useRef(null);

  // Destination marker states (for debug mode)
  const [destinationMarkers, setDestinationMarkers] = useState({});
  const [busDirections, setBusDirections] = useState({}); // Track bus movement directions
  const previousBusPositions = useRef({});
  const [userLocation, setUserLocation] = useState(null);

  // Time filter state for heatmap
  const [timeRange, setTimeRange] = useState('1h');

  // Simulation state
  const [fakeBusPos, setFakeBusPos] = useState(null);
  const [pmRange, setPmRange] = useState({ min: 10, max: 100 });
  const [isDebugFabExpanded, setIsDebugFabExpanded] = useState(false);
  const simulationInterval = useRef(null);

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

  // Auto-zoom to user position when clicking tab
  useFocusEffect(
    useCallback(() => {
      if (userLocation && mapRef.current) {
        mapRef.current.animateToRegion({
          latitude: userLocation.latitude,
          longitude: userLocation.longitude,
          latitudeDelta: 0.005,
          longitudeDelta: 0.005,
        });
      }
    }, [userLocation])
  );

  // Cleanup effect: Remove fake bus trail when debug mode is disabled
  useEffect(() => {
    if (!debugMode) {
      const clearFakeTrail = async () => {
        try {
          const url = await getApiUrl();
          await axios.delete(`${url}/api/debug/location/FAKE_PM_BUS`, {
            headers: getApiHeaders()
          });
          // Also remove the local fake bus marker if it exists
          setFakeBusPos(null);
        } catch (e) {
          console.log("Error cleaning up fake trail:", e);
        }
      };
      clearFakeTrail();
    }
  }, [debugMode]);

  // Use DataContext buses to update directions
  useEffect(() => {
    if (buses && buses.length > 0) {
      buses.forEach(bus => {
        if (bus.current_lat && bus.current_lon) {
          handleDirectionUpdate({
            bus_mac: bus.bus_mac || bus.mac_address || bus.id,
            lat: bus.current_lat,
            lon: bus.current_lon
          });
        }
      });
    }
  }, [buses]);

  // Reload buses when screen gains focus (sync deletion) -> No longer needed, Context handles it
  // But we might want to refresh? Context handles auto-refresh.

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


  const handleLongPress = (e) => {
    if (!debugMode) return;
    const { coordinate } = e.nativeEvent;

    // Use a specific marker for debug bus destination if desired, 
    // or just use common destination logic but for simulation.
    setDestinationMarkers(prev => ({
      ...prev,
      ['FAKE_PM_BUS']: coordinate
    }));
  };

  const toggleFakeBus = async () => {
    if (fakeBusPos) {
      setFakeBusPos(null);
      // Immediately clear simulation trail from server when removed
      try {
        const url = await getApiUrl();
        await axios.delete(`${url}/api/debug/location/FAKE_PM_BUS`, {
          headers: getApiHeaders()
        });
        // Force map to refresh so the trail disappears instantly
        if (mapRef.current?.refreshHeatmap) {
          mapRef.current.refreshHeatmap(true);
        }
      } catch (e) {
        console.log("Error cleaning up fake trail:", e);
      }
    } else {
      const center = mapRef.current?.props?.initialRegion || SUT_COORDINATES;
      const initialPos = { latitude: center.latitude, longitude: center.longitude };
      setFakeBusPos(initialPos);
      sendFakeData(initialPos);
    }
    setIsDebugFabExpanded(false);
  };

  const handleDragFakeBus = (e) => {
    const { coordinate } = e.nativeEvent;
    setFakeBusPos(coordinate);
    sendFakeData(coordinate);
  };

  const sendFakeData = async (coord) => {
    try {
      const url = await getApiUrl();
      const pmValue = Math.floor(Math.random() * (pmRange.max - pmRange.min + 1)) + pmRange.min;
      await axios.post(`${url}/api/debug/location`, {
        bus_mac: "FAKE_PM_BUS",
        lat: coord.latitude,
        lon: coord.longitude,
        pm2_5: pmValue,
        pm10: pmValue * 1.2
      }, { headers: getApiHeaders() });

      // Tell map to refresh its grid data to show the new point
      if (mapRef.current?.refreshHeatmap) {
        mapRef.current.refreshHeatmap();
      }
    } catch (err) {
      console.log("Error sending fake PM data:", err);
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

  const renderBusItem = ({ item }) => {
    const { status, solidColor } = getAirQualityStatus(item.pm2_5);
    const hasDestination = destinationMarkers[item.mac_address];

    // Check if offline (> 1 minute silence)
    // Use (item.last_updated || 0) to handle null/undefined/0.
    const isOffline = (Date.now() - (item.last_updated || 0)) > 60000;
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
          timeRange={timeRange}
          onTimeRangeChange={setTimeRange}
          fakeBusPos={fakeBusPos}
          onDragFakeBus={handleDragFakeBus}
        />

        {/* Debug FAB (Top Left) */}
        {debugMode && (
          <View style={styles.debugFabContainer}>
            <TouchableOpacity
              style={styles.debugFab}
              onPress={() => setIsDebugFabExpanded(!isDebugFabExpanded)}
            >
              <Ionicons name={isDebugFabExpanded ? "close" : "bug"} size={20} color="white" />
            </TouchableOpacity>
            {isDebugFabExpanded && (
              <View style={styles.debugPanel}>
                <Text style={styles.debugPanelTitle}>PM Simulation Tools</Text>
                <TouchableOpacity style={styles.debugActionBtn} onPress={toggleFakeBus}>
                  <Text style={styles.debugActionText}>
                    {fakeBusPos ? "🛑 Remove Fake Bus" : "🚌 Spawn Fake Bus"}
                  </Text>
                </TouchableOpacity>

                <View style={styles.pmRangeRow}>
                  <Text style={styles.rangeLabel}>PM Range:</Text>
                  <TouchableOpacity onPress={() => setPmRange({ min: 10, max: 40 })} style={[styles.rangeBtn, pmRange.max <= 40 && styles.rangeBtnActive]}>
                    <Text style={styles.rangeBtnText}>Low</Text>
                  </TouchableOpacity>
                  <TouchableOpacity onPress={() => setPmRange({ min: 40, max: 80 })} style={[styles.rangeBtn, pmRange.max > 40 && pmRange.max <= 80 && styles.rangeBtnActive]}>
                    <Text style={styles.rangeBtnText}>Med</Text>
                  </TouchableOpacity>
                  <TouchableOpacity onPress={() => setPmRange({ min: 80, max: 150 })} style={[styles.rangeBtn, pmRange.max > 80 && styles.rangeBtnActive]}>
                    <Text style={styles.rangeBtnText}>High</Text>
                  </TouchableOpacity>
                </View>
                <Text style={styles.rangeHint}>Drag bus to paint trail ({pmRange.min}-{pmRange.max} µg/m³)</Text>
              </View>
            )}
          </View>
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
  timeFilterContainer: {
    flexDirection: 'row',
    gap: 5,
  },
  timeFilterBtn: {
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 12,
    backgroundColor: '#e5e7eb',
  },
  timeFilterBtnActive: {
    backgroundColor: '#3b82f6',
  },
  timeFilterText: {
    fontSize: 11,
    fontWeight: 'bold',
    color: '#666',
  },
  timeFilterTextActive: {
    color: 'white',
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
  debugFabContainer: {
    position: 'absolute',
    top: 60,
    left: 20,
    alignItems: 'flex-start',
    zIndex: 2000,
  },
  debugFab: {
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: '#ef4444',
    justifyContent: 'center',
    alignItems: 'center',
    elevation: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 4.65,
  },
  debugPanel: {
    backgroundColor: 'white',
    borderRadius: 15,
    padding: 15,
    marginTop: 10,
    width: 250,
    elevation: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 4.65,
  },
  debugPanelTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    marginBottom: 10,
    color: '#333',
  },
  debugActionBtn: {
    backgroundColor: '#ef4444',
    padding: 10,
    borderRadius: 8,
    alignItems: 'center',
    marginBottom: 15,
  },
  debugActionText: {
    color: 'white',
    fontWeight: 'bold',
  },
  pmRangeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  rangeLabel: {
    fontSize: 12,
    color: '#666',
    fontWeight: '600',
  },
  rangeBtn: {
    paddingVertical: 5,
    paddingHorizontal: 10,
    backgroundColor: '#f3f4f6',
    borderRadius: 15,
  },
  rangeBtnActive: {
    backgroundColor: '#2196F3',
  },
  rangeBtnText: {
    fontSize: 10,
    fontWeight: 'bold',
    color: '#444',
  },
  rangeHint: {
    fontSize: 10,
    color: '#999',
    fontStyle: 'italic',
    textAlign: 'center',
  },
});

export default AirQualityScreen;
