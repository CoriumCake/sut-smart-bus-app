import React, { useState, useEffect, useRef, useMemo } from 'react';
import { View, StyleSheet, TouchableOpacity, Text, Alert, Platform, Image, Animated, Easing, Dimensions } from 'react-native';
import { useFocusEffect, useRoute, useNavigation } from '@react-navigation/native';
import * as Location from 'expo-location';
import axios from 'axios';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useDebug } from '../contexts/DebugContext';
import { useTheme } from '../contexts/ThemeContext';
import { API_BASE, getApiUrl, checkApiKey, getApiHeaders, MQTT_CONFIG } from '../config/api';
import { getRouteIdForBus } from '../utils/busRouteMapping';
import { loadRoute } from '../utils/routeStorage';
import * as mqtt from 'mqtt'; // <-- ADDED: MQTT Client
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { whiteMapStyle, darkMapStyle } from '../utils/mapStyles';

// Import custom bus icon
const busIcon = require('../assets/W-bus-icon.png');

// Helper to calculate total distance of a route and segment distances
const getRouteMetrics = (waypoints) => {
  let totalDistance = 0;
  const segmentDistances = [];
  for (let i = 0; i < waypoints.length - 1; i++) {
    const d = getDistanceFromLatLonInM_Static(
      waypoints[i].latitude, waypoints[i].longitude,
      waypoints[i + 1].latitude, waypoints[i + 1].longitude
    );
    totalDistance += d;
    segmentDistances.push(d);
  }
  return { totalDistance, segmentDistances };
};

// Static version for helpers (copied from component)
const deg2rad_Static = (deg) => deg * (Math.PI / 180);
const getDistanceFromLatLonInM_Static = (lat1, lon1, lat2, lon2) => {
  var R = 6371; // Radius of the earth in km
  var dLat = deg2rad_Static(lat2 - lat1);
  var dLon = deg2rad_Static(lon2 - lon1);
  var a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(deg2rad_Static(lat1)) * Math.cos(deg2rad_Static(lat1)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  var c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  var d = R * c; // Distance in km
  return d * 1000; // Distance in m
};

// Grid Overlay Component for Visual Alignment
const GridOverlay = () => {
  const { width, height } = Dimensions.get('window');
  const gridSize = width / 20; // 20 columns = 5% width squares
  const verticalLines = Math.ceil(width / gridSize);
  const horizontalLines = Math.ceil(height / gridSize);

  return (
    <View style={StyleSheet.absoluteFillObject} pointerEvents="none">
      {/* Vertical Lines */}
      {Array.from({ length: verticalLines }).map((_, i) => (
        <View
          key={`v-${i}`}
          style={{
            position: 'absolute',
            left: i * gridSize,
            top: 0,
            bottom: 0,
            width: 1,
            backgroundColor: i === 10 ? 'rgba(255,0,0,0.5)' : 'rgba(0,0,0,0.1)', // Center line stronger
          }}
        />
      ))}
      {/* Horizontal Lines */}
      {Array.from({ length: horizontalLines }).map((_, i) => (
        <View
          key={`h-${i}`}
          style={{
            position: 'absolute',
            top: i * gridSize,
            left: 0,
            right: 0,
            height: 1,
            backgroundColor: 'rgba(0,0,0,0.1)',
          }}
        />
      ))}
      {/* Center Horizontal Line (Screen Center) */}
      <View
        style={{
          position: 'absolute',
          top: height / 2,
          left: 0,
          right: 0,
          height: 2,
          backgroundColor: 'rgba(255,0,0,0.3)',
        }}
      />
    </View>
  );
};

// Dynamic Import Wrapper for Callout
let Callout;
if (Platform.OS !== 'web') {
  try {
    const Maps = require('react-native-maps');
    Callout = Maps.Callout;
  } catch (e) {
    console.warn('Callout not available in web or error loading maps');
  }
}

let client = null;

const MapScreen = () => {
  const route = useRoute();
  const navigation = useNavigation();
  const { selectedRoute } = route.params || {};

  const { debugMode } = useDebug();
  const { isDark } = useTheme();
  const mapStyle = isDark ? darkMapStyle : whiteMapStyle;
  const [buses, setBuses] = useState([]);
  const [routes, setRoutes] = useState([]);
  const [userLocation, setUserLocation] = useState(null);
  const [simulationBus, setSimulationBus] = useState(null); // Ghost bus for route animation
  const [remainingRoute, setRemainingRoute] = useState([]); // For eating line animation
  const [pathMode, setPathMode] = useState(false);
  const [waypoints, setWaypoints] = useState([]); // Waypoints for custom path
  const [errorMsg, setErrorMsg] = useState(null);
  const mapRef = useRef(null);
  const [hasInitialZoomed, setHasInitialZoomed] = useState(false);
  const [ridingBus, setRidingBus] = useState(null); // Track which bus user is on
  const [personCounts, setPersonCounts] = useState({ entering: 0, exiting: 0 }); // Real-time counts
  const [showControls, setShowControls] = useState(false); // Toggle debug controls
  const [showGrid, setShowGrid] = useState(false); // Grid overlay state
  const [animatingBus, setAnimatingBus] = useState(null);
  const [busSelectedRoute, setBusSelectedRoute] = useState(null); // Route loaded when tapping a bus
  const [currentStopIndex, setCurrentStopIndex] = useState(0); // Track which stop the bus is nearest to
  const [simulationSpeed, setSimulationSpeed] = useState(20); // Simulation speed in m/s (default 20 = ~72km/h)
  const [currentStopName, setCurrentStopName] = useState(null); // Show stop name when bus arrives

  // Debug Location Override - allows testing anywhere by faking user position
  const [debugLocationEnabled, setDebugLocationEnabled] = useState(false);
  const [debugLocation, setDebugLocation] = useState(null); // {latitude, longitude}

  // Effective user location (debug override or real GPS)
  const effectiveUserLocation = debugMode && debugLocationEnabled && debugLocation
    ? debugLocation
    : userLocation;

  // Active route is either from navigation (selectedRoute) or from tapping a bus (busSelectedRoute)
  const activeRoute = selectedRoute || busSelectedRoute;

  // Calculate user's closest stop index based on their (or debug) location
  // This is used to show "Next Stop" from the user's perspective
  const userStopIndex = useMemo(() => {
    if (!activeRoute?.waypoints || !effectiveUserLocation) return 0;

    const stops = activeRoute.waypoints.filter(wp => wp.isStop && wp.stopName);
    if (stops.length === 0) return 0;

    // Find the closest stop to user's location
    let closestIndex = 0;
    let minDistance = Infinity;

    stops.forEach((stop, index) => {
      const dist = getDistanceFromLatLonInM_Static(
        effectiveUserLocation.latitude, effectiveUserLocation.longitude,
        stop.latitude, stop.longitude
      );
      if (dist < minDistance) {
        minDistance = dist;
        closestIndex = index;
      }
    });

    // If user is close to a stop (within 100m), consider it passed and show next stop
    // Otherwise show the closest stop as the upcoming one
    if (minDistance < 100) {
      return closestIndex + 1; // Next stop after the one they're at
    }
    return closestIndex;
  }, [activeRoute, effectiveUserLocation]);

  // Use userStopIndex when debug location is enabled, otherwise use bus-based currentStopIndex
  const effectiveStopIndex = (debugMode && debugLocationEnabled && debugLocation)
    ? userStopIndex
    : currentStopIndex;

  // Animation Refs
  const animationRef = useRef(null);
  const simulationAnim = useRef(new Animated.ValueXY({ x: 0, y: 0 })).current; // Controls Simulation Bus Position
  // We keep a ref to the current route coordinate to update the line efficiently (though render still needs state)
  const activeRouteRef = useRef([]);
  const currentSegmentIndexRef = useRef(0); // Track current segment for slicing
  const lastLineUpdateRef = useRef(0); // Throttle for line updates
  const simulationSpeedRef = useRef(20); // Speed ref for animation closures

  const [MapView, setMapView] = useState(null);
  const [Marker, setMarker] = useState(null);
  const [Polyline, setPolyline] = useState(null);
  const [Circle, setCircle] = useState(null);
  const [busSignal, setBusSignal] = useState(null); // RSSI value
  const [snappedLocation, setSnappedLocation] = useState(null); // For visual snapping
  const [snappedBusId, setSnappedBusId] = useState(null); // ID of the bus currently snapping

  // Track progress to prevent backward jumps
  const lastProgressRef = useRef(0);
  const lastSnappedIndexRef = useRef(0); // <-- ADDED: Track route index
  // Refs for infinite-closure access in MQTT
  const busesRef = useRef([]);
  const selectedRouteRef = useRef(null);
  const ridingBusRef = useRef(null);
  const lastShownStopRef = useRef(null); // Prevent flickering stop popup
  const [markersReady, setMarkersReady] = useState(false); // Track if markers have rendered

  useEffect(() => {
    busesRef.current = buses;
  }, [buses]);

  useEffect(() => {
    selectedRouteRef.current = selectedRoute;
  }, [selectedRoute]);

  useEffect(() => {
    ridingBusRef.current = ridingBus;
  }, [ridingBus]);

  // Memoize route segments for performance
  // Uses remainingRoute for real-time eating ONLY during simulation
  // Otherwise uses stop-based calculation for better performance
  const routeSegments = useMemo(() => {
    if (!activeRoute?.waypoints) return { passed: [], upcoming: [], distant: [], routeColor: '#e11d48' };

    const routeColor = activeRoute.routeColor || '#e11d48';
    const fullWaypoints = activeRoute.waypoints;

    // Get all stops with their waypoint indices
    const stopsWithIndices = fullWaypoints
      .map((wp, idx) => ({ ...wp, waypointIndex: idx }))
      .filter(wp => wp.isStop && wp.stopName);

    // Find stop waypoint indices for segment calculation
    const currentStop = stopsWithIndices[currentStopIndex - 1];
    const currentWaypointIdx = currentStop ? currentStop.waypointIndex : 0;

    const secondUpcomingStop = stopsWithIndices[currentStopIndex + 1];
    const upcomingStopWaypointIdx = secondUpcomingStop
      ? secondUpcomingStop.waypointIndex
      : fullWaypoints.length - 1;

    let passedSegment = [];
    let upcomingSegment = [];
    let distantSegment = [];

    if (simulationBus && remainingRoute.length > 0) {
      // SIMULATION MODE: Use real-time remainingRoute for smooth eating
      const passedCount = Math.max(0, fullWaypoints.length - remainingRoute.length);
      passedSegment = passedCount > 0 ? fullWaypoints.slice(0, passedCount + 1) : [];

      const upcomingEnd = Math.min(upcomingStopWaypointIdx - passedCount + 1, remainingRoute.length);
      upcomingSegment = remainingRoute.slice(0, upcomingEnd);
      distantSegment = fullWaypoints.slice(upcomingStopWaypointIdx);
    } else {
      // STATIC MODE: Use stop-based calculation (no simulation, better performance)
      passedSegment = currentWaypointIdx > 0 ? fullWaypoints.slice(0, currentWaypointIdx + 1) : [];
      upcomingSegment = fullWaypoints.slice(currentWaypointIdx, upcomingStopWaypointIdx + 1);
      distantSegment = fullWaypoints.slice(upcomingStopWaypointIdx);
    }

    return { passed: passedSegment, upcoming: upcomingSegment, distant: distantSegment, routeColor };
  }, [activeRoute, simulationBus, remainingRoute, currentStopIndex]);

  // Memoize stop markers data with loop detection
  // Hides distant stops that are geographically close to upcoming stops
  // Uses effectiveStopIndex to show correct stops based on user's (or debug) position
  const stopMarkers = useMemo(() => {
    if (!activeRoute?.waypoints) return [];

    const allStops = activeRoute.waypoints
      .filter(wp => wp.isStop && wp.stopName)
      .map((stop, index) => ({
        ...stop,
        index,
        stopNumber: index + 1,
        stopsAhead: index - effectiveStopIndex,
        isUpcoming: (index - effectiveStopIndex) >= 0 && (index - effectiveStopIndex) < 2, // Only next 2 stops
        isPassed: (index - effectiveStopIndex) < 0,
        isHiddenByNearby: false, // Will be set below
      }));

    // Detect nearby stops and hide the further one (loop detection)
    // Distance threshold: ~50 meters (roughly 0.00045 degrees)
    const NEARBY_THRESHOLD = 0.00045;

    for (let i = 0; i < allStops.length; i++) {
      const stopA = allStops[i];
      if (stopA.isPassed) continue; // Skip passed stops

      for (let j = i + 1; j < allStops.length; j++) {
        const stopB = allStops[j];
        if (stopB.isPassed || stopB.isHiddenByNearby) continue;

        // Check if geographically close
        const latDiff = Math.abs(stopA.latitude - stopB.latitude);
        const lonDiff = Math.abs(stopA.longitude - stopB.longitude);

        if (latDiff < NEARBY_THRESHOLD && lonDiff < NEARBY_THRESHOLD) {
          // stopB (further in route) should be hidden while stopA is still ahead
          if (stopA.isUpcoming && !stopA.isPassed) {
            allStops[j].isHiddenByNearby = true;
          }
        }
      }
    }

    return allStops;
  }, [activeRoute, effectiveStopIndex]);

  const [mapLoadError, setMapLoadError] = useState(false);

  useEffect(() => {
    let isMounted = true;
    if (Platform.OS !== 'web') {
      import('react-native-maps').then((maps) => {
        if (isMounted) {
          setMapView(() => maps.default);
          setMarker(() => maps.Marker);
          setPolyline(() => maps.Polyline);
          setCircle(() => maps.Circle);
        }
      }).catch((error) => {
        console.log('Failed to load react-native-maps:', error.message);
        if (isMounted) {
          setMapLoadError(true);
        }
      });
    } else {
      setMapLoadError(true); // Maps not available on web
    }
    return () => { isMounted = false; };
  }, []);

  // Update waypoints when activeRoute changes (from navigation or bus tap)
  useEffect(() => {
    if (activeRoute && activeRoute.waypoints) {
      setWaypoints(activeRoute.waypoints);
      setRemainingRoute(activeRoute.waypoints); // Initialize route for display
      setCurrentStopIndex(0); // Reset stop tracking

      // Reset markersReady, then set to true after brief delay for initial render
      setMarkersReady(false);
      const timer = setTimeout(() => setMarkersReady(true), 500);
      return () => clearTimeout(timer);
    }
    // Clear previous snap state when route changes
    setSnappedLocation(null);
    setSnappedBusId(null);
    lastSnappedIndexRef.current = 0; // Reset index tracker
  }, [activeRoute]);

  // Load user location and fetch initial data
  useEffect(() => {
    getLocation();
    fetchBuses();
    fetchRoutes();

    // Auto-refresh buses every 5s if not using MQTT
    const interval = setInterval(fetchBuses, 5000);
    return () => clearInterval(interval);
  }, []);

  const connectMqtt = async () => {
    if (Platform.OS !== 'web') {
      // --- MQTT Integration (using config) ---
      try {
        // Import MQTT config - get host from AsyncStorage override or config
        const { MQTT_CONFIG } = require('../config/api');
        const overrideIp = await AsyncStorage.getItem('serverIp');
        const host = overrideIp || MQTT_CONFIG.host;
        const mqttUrl = `ws://${host}:${MQTT_CONFIG.wsPort}`;

        if (mqtt && typeof mqtt.connect === 'function') {
          client = mqtt.connect(mqttUrl);

          client.on('connect', () => {
            console.log('Connected to MQTT Broker');
            setErrorMsg(null);

            client.subscribe('sut/app/bus/location', (err) => {
              if (err) console.error('Subscription error:', err);
            });
            client.subscribe('sut/bus/gps/fast', (err) => {
              if (err) console.error('GPS Fast subscription error:', err);
              else console.log('Subscribed to fast GPS topic');
            });
            // Subscribe directly to ESP32 sensor data (includes PM, temp, humidity)
            client.subscribe('sut/bus/gps', (err) => {
              if (err) console.error('GPS sensor subscription error:', err);
              else console.log('Subscribed to sut/bus/gps (sensor data)');
            });
            client.subscribe('sut/person-detection', (err) => {
              if (err) console.error('Sub error person:', err);
            });
            client.subscribe('sut/bus/+/status', (err) => {
              if (err) console.error('Sub error status:', err);
            });

          });

          client.on('message', (topic, message) => {
            try {
              const data = JSON.parse(message.toString());

              if (topic === 'sut/app/bus/location' || topic === 'sut/bus/gps') {
                // Handle both server-bridged data and direct ESP32 sensor data
                setBuses(prevBuses => {
                  const existingBusIndex = prevBuses.findIndex(b => b.bus_mac === data.bus_mac);
                  if (existingBusIndex > -1) {
                    const updatedBuses = [...prevBuses];
                    const oldBus = updatedBuses[existingBusIndex];

                    updatedBuses[existingBusIndex] = {
                      ...oldBus,
                      current_lat: (data.lat !== null && data.lat !== undefined) ? data.lat : oldBus.current_lat,
                      current_lon: (data.lon !== null && data.lon !== undefined) ? data.lon : oldBus.current_lon,
                      seats_available: data.seats_available ?? oldBus.seats_available,
                      pm2_5: data.pm2_5 ?? oldBus.pm2_5,
                      pm10: data.pm10 ?? oldBus.pm10,
                      temp: data.temp ?? oldBus.temp,
                      hum: data.hum ?? oldBus.hum,
                    };
                    return updatedBuses;
                  } else {
                    return [...prevBuses, {
                      id: data.bus_mac,
                      bus_mac: data.bus_mac,
                      bus_name: data.bus_name,
                      current_lat: data.lat,
                      current_lon: data.lon,
                      seats_available: data.seats_available,
                      pm2_5: data.pm2_5,
                      pm10: data.pm10,
                      temp: data.temp,
                      hum: data.hum,
                    }];
                  }
                });
              } else if (topic === 'sut/person-detection') {
                const newCount = data.count;
                // 1. Update personCounts state
                setPersonCounts(prevCounts => ({
                  entering: newCount !== undefined ? newCount : (prevCounts.entering || 0),
                  exiting: 0,
                }));
                // 2. Sync count to ALL buses for marker display (test mode assumption)
                if (newCount !== undefined) {
                  setBuses(prev => prev.map(b => ({ ...b, seats_occupied: newCount })));
                }
              } else if (topic === 'sut/bus/gps/fast') {
                // Fast GPS-only update (lat, lon only - every 500ms)
                setBuses(prevBuses => {
                  const idx = prevBuses.findIndex(b => b.bus_mac === data.bus_mac);
                  if (idx > -1 && data.lat != null && data.lon != null) {
                    const updated = [...prevBuses];
                    updated[idx] = {
                      ...updated[idx],
                      current_lat: data.lat,
                      current_lon: data.lon
                    };
                    return updated;
                  }
                  return prevBuses;
                });
              } else if (topic.includes('/status')) {
                // sut/bus/ESP32-CAM-01/status
                // Check if topic matches the riding bus ID, MAC, or explicitly the known ESP32 ID
                if (ridingBus && (topic.includes(ridingBus.bus_mac) || topic.includes(ridingBus.id) || topic.includes('ESP32-CAM-01'))) {
                  setBusSignal(data.rssi);
                }
              }

              // --- SMART ROUTE ANIMATION ---
              // --- SMART ROUTE ANIMATION ---
              const currentSelectedRoute = selectedRouteRef.current;
              const currentBuses = busesRef.current;
              const currentRidingBus = ridingBusRef.current;

              if (currentSelectedRoute) {
                const targetBusId = currentSelectedRoute.bus_id || currentSelectedRoute.busId;

                // Use Ref data for search
                const activeBus = currentRidingBus || currentBuses.find(b => (b.bus_mac || b.mac_address) === targetBusId);
                const activeBusMac = activeBus?.bus_mac || activeBus?.mac_address || activeBus?.id;

                if (activeBus && data.bus_mac === activeBusMac) {
                  // Check if data has valid coords
                  if (data.lat && data.lon) {
                    updateRouteProgress({ latitude: data.lat, longitude: data.lon }, data.bus_mac);
                  }
                }
              }
            } catch (error) {
              console.error('Error parsing MQTT message:', error);
            }
          });

          client.on('error', (err) => {
            // Silence errors
          });

          client.on('close', () => {
            // Silence
          });
        }
      } catch (e) {
        console.error("Failed to initialize MQTT:", e);
      }
    }
  };

  useEffect(() => {
    connectMqtt(); // Enable MQTT for person detection
    return () => {
      if (client) {
        try {
          client.end();
        } catch (e) { }
      }
    };
  }, []);

  // --- FETCH INITIAL PERSON COUNT ---
  // Fetch current count from API on start/resume to ensure sync
  const lastCountRef = React.useRef(null);
  useEffect(() => {
    const fetchCount = async () => {
      try {
        const response = await fetch(`${API_BASE}/count`, { headers: getApiHeaders() });
        if (response.ok) {
          const data = await response.json();
          // Only update if value changed (prevents unnecessary re-renders)
          if (data.passengers !== undefined && data.passengers !== lastCountRef.current) {
            lastCountRef.current = data.passengers;
            console.log("Passenger count updated:", data.passengers);
            setPersonCounts({ entering: data.passengers, exiting: 0 });
            setBuses(prev => prev.map(b => ({ ...b, seats_occupied: data.passengers })));
          }
        }
      } catch (err) {
        // Silent fail
      }
    };

    fetchCount();
    // Poll every 15 seconds (reduced from 5s for performance)
    const interval = setInterval(fetchCount, 15000);
    return () => clearInterval(interval);
  }, []);

  // Ensure ridingBus state stays fresh when server sends updates (e.g. seats, pm2.5)
  useEffect(() => {
    if (ridingBus) {
      const liveBus = buses.find(b => b.id === ridingBus.id || b.bus_mac === ridingBus.bus_mac);
      // Determine if we need to update (simple ref check might be enough if setBuses returns new objects)
      if (liveBus && liveBus !== ridingBus) {
        setRidingBus(liveBus);
      }
    }
  }, [buses]);

  // --- AUTO-EXIT LOGIC ---
  // If user moves far from the bus, assume they got off and exit Riding Mode
  // Uses effectiveUserLocation to work with debug location override
  useEffect(() => {
    const currentUserLoc = effectiveUserLocation;
    if (ridingBus && currentUserLoc && ridingBus.current_lat) {
      // Find current position of the riding bus (streaming updates)
      const currentBus = buses.find(b => b.id === ridingBus.id || b.bus_mac === ridingBus.bus_mac);
      if (currentBus) {
        const dist = getDistanceFromLatLonInM_Static(
          currentUserLoc.latitude, currentUserLoc.longitude,
          currentBus.current_lat, currentBus.current_lon
        );

        // Threshold: 100 meters (disable in debug mode with fake location to allow testing)
        if (dist > 100 && !debugLocationEnabled) {
          console.log(`[AutoExit] Distance ${dist}m > 100m. Exiting bus mode.`);
          setRidingBus(null);
          setBusSignal(null);
          Alert.alert("Auto-Exit", "You have moved away from the bus.");
        }
      }
    }
  }, [effectiveUserLocation, buses, ridingBus, debugLocationEnabled]);

  useFocusEffect(
    React.useCallback(() => {
      autoZoom();
    }, [userLocation, mapRef.current])
  );

  const autoZoom = async () => {
    if (mapRef.current && Platform.OS !== 'web' && !hasInitialZoomed) {
      await getLocation();
      setTimeout(() => {
        if (userLocation && mapRef.current) {
          mapRef.current.animateToRegion({
            latitude: userLocation.latitude,
            longitude: userLocation.longitude,
            latitudeDelta: 0.005,
            longitudeDelta: 0.005,
          });
          setHasInitialZoomed(true);
        }
      }, 500);
    }
  };


  const fetchBuses = async () => {
    try {
      const apiKey = await checkApiKey();
      if (!apiKey) return;
      const apiUrl = await getApiUrl();
      const response = await axios.get(`${apiUrl}/api/buses`, {
        headers: getApiHeaders(),
        timeout: 5000
      });
      if (response.data && Array.isArray(response.data)) {
        setBuses(response.data);
      }
    } catch (error) {
      console.log('Error fetching buses (server may be offline):', error.message);
      // Don't crash - just leave buses empty
    }
  };

  const fetchRoutes = async () => {
    try {
      const apiKey = await checkApiKey();
      if (!apiKey) return;
      const apiUrl = await getApiUrl();
      const response = await axios.get(`${apiUrl}/api/routes`, {
        headers: getApiHeaders(),
        timeout: 5000
      });
      const routesData = response.data;
      if (!routesData || !Array.isArray(routesData)) {
        console.log('No routes data received');
        return;
      }
      const routesWithStops = await Promise.all(
        routesData.map(async (route) => {
          try {
            const stopsResponse = await axios.get(`${apiUrl}/api/routes/${route.id}/stops`, {
              headers: getApiHeaders(),
              timeout: 5000
            });
            return {
              ...route,
              stops: stopsResponse.data || [],
            };
          } catch (e) {
            return { ...route, stops: [] };
          }
        })
      );
      setRoutes(routesWithStops);
    } catch (error) {
      console.log('Error fetching routes (server may be offline):', error.message);
      // Don't crash - just leave routes empty
    }
  };

  const SUT_COORDINATES = {
    latitude: 14.8820,
    longitude: 102.0207,
    latitudeDelta: 0.005,
    longitudeDelta: 0.005,
  };

  const getLocation = async () => {
    try {
      let { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') return;

      const enabled = await Location.hasServicesEnabledAsync();
      if (!enabled) return;

      let location = await Location.getLastKnownPositionAsync({});
      if (!location) {
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
    // Use debug location if enabled
    const targetLocation = effectiveUserLocation;

    if (!targetLocation) {
      await getLocation();
    }

    if (targetLocation && mapRef.current) {
      mapRef.current.animateToRegion({
        latitude: targetLocation.latitude,
        longitude: targetLocation.longitude,
        latitudeDelta: 0.005,
        longitudeDelta: 0.005,
      });
    } else {
      if (mapRef.current) {
        mapRef.current.animateToRegion(SUT_COORDINATES);
        Alert.alert('Location Unavailable', 'Zooming to Suranaree University of Technology (Default).');
      }
    }
  };

  // Initialize debug location to SUT campus center when enabled
  const enableDebugLocation = () => {
    if (!debugLocation) {
      setDebugLocation({
        latitude: SUT_COORDINATES.latitude,
        longitude: SUT_COORDINATES.longitude,
      });
    }
    setDebugLocationEnabled(true);
  };

  // Handle dragging the debug location marker
  const handleDebugMarkerDrag = (e) => {
    setDebugLocation(e.nativeEvent.coordinate);
  };

  const getAirQualityStatus = (value) => {
    if (value == null) return { status: 'No Data', color: 'gray' };
    if (value <= 25) return { status: 'Good', color: 'rgba(0, 255, 0, 0.4)', solidColor: 'green' };
    if (value <= 50) return { status: 'Moderate', color: 'rgba(255, 255, 0, 0.4)', solidColor: '#CCCC00' };
    if (value <= 75) return { status: 'Unhealthy (Sensitive)', color: 'rgba(255, 165, 0, 0.4)', solidColor: 'orange' };
    return { status: 'Unhealthy', color: 'rgba(255, 0, 0, 0.4)', solidColor: 'red' };
  };

  const handleMapPress = (e) => {
    if (pathMode) {
      setWaypoints([...waypoints, e.nativeEvent.coordinate]);
    }
  };

  // Handle bus marker press - load and display assigned route
  const handleBusPress = async (bus) => {
    const busMac = bus.bus_mac || bus.mac_address || bus.id;
    console.log('[BusPress] Tapped bus:', busMac);

    try {
      const routeId = await getRouteIdForBus(busMac);
      console.log('[BusPress] Assigned route ID:', routeId);

      if (routeId) {
        const route = await loadRoute(routeId);
        if (route) {
          console.log('[BusPress] Loaded route:', route.routeName);
          setBusSelectedRoute(route);
          setRemainingRoute(route.waypoints || []);
          // Also set ridingBus for potential ring functionality
          setRidingBus(bus);
        } else {
          console.log('[BusPress] Route not found in storage');
          Alert.alert('Route Not Found', 'The assigned route could not be loaded.');
        }
      } else {
        console.log('[BusPress] No route assigned to this bus');
        // Clear previous route if tapping unassigned bus
        setBusSelectedRoute(null);
        setRemainingRoute([]);
      }
    } catch (error) {
      console.error('[BusPress] Error loading route:', error);
    }
  };

  // --- OPTIMIZED ANIMATION LOGIC ---

  const simulateRoute = () => {
    const routeToUse = selectedRoute && selectedRoute.waypoints ? selectedRoute.waypoints : waypoints;
    if (!routeToUse || routeToUse.length < 2) {
      Alert.alert('Error', 'Invalid route for animation');
      return;
    }

    const activeWaypoints = [...routeToUse];
    const busId = 'sim-bus-' + Date.now();

    // 1. Initialize Bus State (for Markers to render)
    // We use simulationBus for the ID/metadata, but position is controlled by simulationAnim
    setSimulationBus({
      id: busId,
      bus_mac: 'SIMULATED',
      bus_name: 'Test Bus',
      seats_available: 25,
      pm2_5: 15,
    });

    // 2. Initialize Position
    const startPoint = activeWaypoints[0];
    simulationAnim.setValue({ x: startPoint.latitude, y: startPoint.longitude });

    // 3. Initialize Route
    activeRouteRef.current = activeWaypoints;
    setRemainingRoute(activeWaypoints);
    setCurrentStopIndex(0); // Reset stop tracking
    lastShownStopRef.current = null; // Reset stop popup tracking

    // 4. Add Listener for Continuous Line Clearing - THROTTLED for performance
    simulationAnim.removeAllListeners();
    let lastStopIdx = 0; // Track last stop index to avoid redundant updates

    simulationAnim.addListener(({ x, y }) => {
      const now = Date.now();
      if (now - lastLineUpdateRef.current > 250) { // Update every 250ms (reduced from 100ms)
        lastLineUpdateRef.current = now;
        const currentIdx = currentSegmentIndexRef.current;
        const nextPoints = activeRouteRef.current.slice(currentIdx + 1);
        setRemainingRoute([{ latitude: x, longitude: y }, ...nextPoints]);

        // Update currentStopIndex only when it changes
        let passedStops = 0;
        for (let i = 0; i <= currentIdx; i++) {
          if (activeRouteRef.current[i]?.isStop && activeRouteRef.current[i]?.stopName) {
            passedStops++;
          }
        }
        if (passedStops !== lastStopIdx) {
          lastStopIdx = passedStops;
          setCurrentStopIndex(passedStops);
        }

        // Show stop name when bus reaches a NEW stop (prevent flickering)
        const currentWaypoint = activeRouteRef.current[currentIdx];
        if (currentWaypoint?.isStop && currentWaypoint?.stopName) {
          // Only show if this is a different stop than last shown
          if (lastShownStopRef.current !== currentWaypoint.stopName) {
            lastShownStopRef.current = currentWaypoint.stopName;
            setCurrentStopName(currentWaypoint.stopName);
            // Auto-hide after 2 seconds
            setTimeout(() => setCurrentStopName(null), 2000);
          }
        }
      }
    });

    // 5. Start Recursive Animation
    startSegmentAnimation(0, activeWaypoints);
  };

  const startSegmentAnimation = (index, allWaypoints) => {
    if (index >= allWaypoints.length - 1) {
      stopAnimation();
      return;
    }

    currentSegmentIndexRef.current = index; // Update current segment tracker

    const start = allWaypoints[index];
    const end = allWaypoints[index + 1];

    // Calculate Distance & Duration using dynamic speed
    const dist = getDistanceFromLatLonInM_Static(start.latitude, start.longitude, end.latitude, end.longitude);
    const speed = simulationSpeedRef.current; // Use ref for dynamic speed
    const duration = (dist / speed) * 1000; // ms

    // Use Animated.timing for smooth interpolation between coords
    Animated.timing(simulationAnim, {
      toValue: { x: end.latitude, y: end.longitude },
      duration: duration,
      easing: Easing.linear,
      useNativeDriver: false, // Coordinates require JS driver generally
    }).start(({ finished }) => {
      if (finished) {
        // Proceed to next segment
        startSegmentAnimation(index + 1, allWaypoints);
      }
    });

    // We store the animation handle implicitly in the Animated framework. 
    // To stop, we call simulationAnim.stopAnimation(), handled in stopAnimation function.
  };

  const stopAnimation = () => {
    simulationAnim.stopAnimation(); // Stop current segment
    simulationAnim.removeAllListeners(); // Cleanup listener
    setAnimatingBus(null);
    setSimulationBus(null);
    setRemainingRoute([]);
  };

  const updateRouteProgress = (busLocation, busId) => {
    // 1. Get current full path
    const fullPath = selectedRoute?.waypoints;
    if (!fullPath || fullPath.length < 2) {
      return;
    }

    // 2. Find closest segment
    let minDistance = Infinity;
    let closestSegmentIndex = -1;
    let projectedPoint = null;

    // Optimization: Start from last known index to avoid backward jumps? 
    // For now, scan all (route isn't huge) or scan localized window.
    // Scan all is safer for "skipping" stops.

    // Optimization: Lookahead Window
    // Start slightly back (-2) to catch corners, look forward (+15)
    // If we have no lock (0), we still scan the first 15 segments.
    // This PREVENTS jumping to index 100 which might be physically close but logically far.
    const startIndex = Math.max(0, lastSnappedIndexRef.current - 2);
    const searchWindow = 15;
    const endIndex = Math.min(fullPath.length - 1, startIndex + searchWindow);

    // console.log(`[DEBUG-SNAP] Searching segments ${startIndex} to ${endIndex}`);

    for (let i = startIndex; i < endIndex; i++) {
      const start = fullPath[i];
      const end = fullPath[i + 1];

      const p = getProjectedPoint(busLocation, start, end);
      const dist = getDistanceFromLatLonInM_Static(busLocation.latitude, busLocation.longitude, p.latitude, p.longitude);

      if (dist < minDistance) {
        minDistance = dist;
        closestSegmentIndex = i;
        projectedPoint = p;
      }
    }

    // 3. Update remaining route
    if (closestSegmentIndex !== -1 && minDistance < 100) { // Increased threshold slightly for corner cutting

      // Update our anchor point so we don't look back or too far forward next time
      lastSnappedIndexRef.current = closestSegmentIndex;

      // --- FORWARD ONLY & SMOOTHNESS CHECK ---
      let currentProgress = 0;
      // Sum distance of previous segments
      for (let i = 0; i < closestSegmentIndex; i++) {
        currentProgress += getDistanceFromLatLonInM_Static(fullPath[i].latitude, fullPath[i].longitude, fullPath[i + 1].latitude, fullPath[i + 1].longitude);
      }
      // Add distance on current segment
      currentProgress += getDistanceFromLatLonInM_Static(fullPath[closestSegmentIndex].latitude, fullPath[closestSegmentIndex].longitude, projectedPoint.latitude, projectedPoint.longitude);

      const lastProgress = lastProgressRef.current;
      const delta = currentProgress - lastProgress;

      // Rule 1: Must be moving forward (delta > 0) or essentially same spot
      // Rule 2: Must move at least 2m (lowered from 10m) to register walking, but filter pure noise
      if (delta < -5) { // Allow tiny noise, but reject real backward jumps
        return;
      }
      if (Math.abs(delta) < 2 && lastProgress > 0) {
        // console.log(`[DEBUG-SNAP] Ignored Micro-Move: Delta=${delta}m`);
        return;
      }

      // Valid Update
      lastProgressRef.current = currentProgress;
      // ---------------------------------------

      // Snap Bus Visual
      setSnappedLocation(projectedPoint);
      setSnappedBusId(busId);

      // Update current stop index for opacity highlighting
      // Count how many stops are before the current segment
      let passedStopsCount = 0;
      for (let i = 0; i <= closestSegmentIndex; i++) {
        if (fullPath[i].isStop) {
          passedStopsCount++;
        }
      }
      setCurrentStopIndex(passedStopsCount);

      // New route starts from projected point
      const newRoute = [projectedPoint, ...fullPath.slice(closestSegmentIndex + 1)];
      setRemainingRoute(newRoute);
    } else {
      // STRICT LOCK - Out of range, maintain current state
    }
  };

  // ------------------------------

  const handleRing = async () => {
    if (!ridingBus) return;
    try {
      const apiUrl = API_BASE; // Use centralized config
      const targetMac = ridingBus.bus_mac || ridingBus.id || 'ESP32-CAM-01';

      const response = await axios.post(`${apiUrl}/api/ring`, {
        bus_mac: targetMac
      }, {
        timeout: 5000  // 5 second timeout
      });

      console.log('Ring response:', response.data);
      Alert.alert('Success', 'Driver notified!');
    } catch (e) {
      console.log('Ring error:', e.message);
      // Still show success if it was a timeout (ring might have worked)
      if (e.code === 'ECONNABORTED') {
        Alert.alert('Sent', 'Signal sent (response delayed)');
      } else {
        Alert.alert('Error', 'Could not connect to bus system');
      }
    }
  };

  // Show fallback if maps failed to load (missing API key, etc.)
  if (mapLoadError) {
    return (
      <View style={styles.mapFallback}>
        <Text style={{ fontSize: 48, marginBottom: 10 }}>🗺️</Text>
        <Text style={{ fontSize: 20, fontWeight: 'bold', color: '#666', marginBottom: 10 }}>
          Map Unavailable
        </Text>
        <Text style={{ fontSize: 14, color: '#999', textAlign: 'center', paddingHorizontal: 40 }}>
          Maps require Google Play Services and a valid API key. Please check your configuration.
        </Text>
      </View>
    );
  }

  if (!MapView || !Marker || !Polyline) {
    return <View style={styles.loading}><Text>Loading Maps...</Text></View>;
  }

  return (
    <View style={styles.container}>
      <MapView
        ref={mapRef}
        style={styles.map}
        initialRegion={SUT_COORDINATES}
        onPress={handleMapPress}
        showsUserLocation={true}
        showsMyLocationButton={false}
        customMapStyle={mapStyle}
        userInterfaceStyle={isDark ? 'dark' : 'light'}
      >
        {buses.map((bus, i) => {
          // ... (Existing Bus Rendering Code)
          // Use snapped location if this is the active bus and we have one
          const busMac = bus.bus_mac || bus.mac_address || bus.id;
          const isRiding = ridingBus && (ridingBus.id === bus.id || ridingBus.bus_mac === busMac);
          const targetBusId = selectedRoute?.bus_id || selectedRoute?.busId;
          const isLinkedRouteBus = selectedRoute && targetBusId === busMac;

          let latitude = bus.lat || bus.current_lat;
          let longitude = bus.lon || bus.current_lon;

          // SNAP LOGIC: If this is the route bus and we have a snap point, use it!
          // Constraint: Only snap if the IDs match explicitly
          if (snappedLocation && snappedBusId && (busMac == snappedBusId)) {
            // console.log(`[DEBUG-SNAP] Rendering SNAPPED loc for ${bus.bus_mac}`);
            latitude = snappedLocation.latitude;
            longitude = snappedLocation.longitude;
          } else if (isLinkedRouteBus) {
            // console.log(`[DEBUG-SNAP] Rendering RAW loc for ${bus.bus_mac} (No snap/ID mismatch: SnapID=${snappedBusId})`);
          }

          if (!latitude || !longitude) return null;
          // Show Occupancy (Synced from MQTT/API)
          let occupied = bus.seats_occupied;
          if (occupied === undefined || occupied === null) {
            // Fallback to personCounts if not synced
            occupied = personCounts?.entering || 0;
          }
          const description = `Passengers: ${occupied}/33`;

          return (
            <Marker.Animated
              key={`bus-${i}-${bus.id || bus.bus_mac}`}
              coordinate={{ latitude, longitude }}
              title={bus.bus_name || "Bus"}
              description={description}
              onPress={() => handleBusPress(bus)}
            >
              <Image source={busIcon} style={{ width: 40, height: 40 }} resizeMode="contain" />
            </Marker.Animated>
          );
        })}


        {/* Polylines for Server Routes */}
        {routes.map((route, i) => (
          <Polyline
            key={`route-${i}-${route.id}`}
            coordinates={route.stops.map((stop) => ({ latitude: stop.lat, longitude: stop.lon }))}
            strokeColor="#2563eb"
            strokeWidth={3}
          />
        ))}

        {/* Render Selected Route with 3 Segments in Draw Order (last = on top) */}
        {activeRoute && (
          <>
            {/* 1. DISTANT segment (very faded, thin) - drawn FIRST = bottom layer */}
            {routeSegments.distant.length > 1 && (
              <Polyline
                coordinates={routeSegments.distant}
                strokeColor={(routeSegments.routeColor || '#e11d48') + '30'} // 19% opacity - very faded
                strokeWidth={2}
                lineDashPattern={[8, 4]}
                zIndex={1}
              />
            )}

            {/* 2. PASSED segment (gray faded) - drawn second = middle layer */}
            {routeSegments.passed.length > 1 && (
              <Polyline
                coordinates={routeSegments.passed}
                strokeColor="#88888888" // Gray 53% opacity
                strokeWidth={3}
                zIndex={5}
              />
            )}

            {/* 3. UPCOMING segment (bright, solid, thick) - drawn LAST = top layer */}
            {routeSegments.upcoming.length > 1 && (
              <Polyline
                coordinates={routeSegments.upcoming}
                strokeColor={routeSegments.routeColor || '#e11d48'}
                strokeWidth={6}
                zIndex={100}
              />
            )}
          </>
        )}

        {/* Render Stop Stations from Selected Route with Dynamic Opacity (Memoized) */}
        {activeRoute && stopMarkers.map((stop) => {
          const stopName = stop.stopName || `Stop ${stop.stopNumber}`;
          const routeColor = activeRoute.routeColor || '#e11d48';

          // Handle hidden-by-nearby stops (loop detection)
          if (stop.isHiddenByNearby) {
            // Very faded, small marker for hidden stops
            return (
              <Marker
                key={`stop-${stop.index}-${stop.latitude}-${stop.longitude}`}
                coordinate={{ latitude: stop.latitude, longitude: stop.longitude }}
                anchor={{ x: 0.5, y: 0.5 }}
                opacity={0.15}
                zIndex={1}
                tracksViewChanges={!markersReady}
              >
                <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: '#ccc' }} />
              </Marker>
            );
          }

          const markerOpacity = stop.isPassed ? 0.3 : (stop.isUpcoming ? 1.0 : 0.4);
          const markerSize = stop.isUpcoming ? 28 : 20;

          return (
            <Marker
              key={`stop-${stop.index}-${stop.latitude}-${stop.longitude}`}
              coordinate={{ latitude: stop.latitude, longitude: stop.longitude }}
              anchor={{ x: 0.5, y: 0.5 }}
              opacity={markerOpacity}
              zIndex={stop.isUpcoming ? 100 : (stop.isPassed ? 1 : 50)}
              tracksViewChanges={!markersReady}
              title={`🚏 Stop #${stop.stopNumber}`}
              description={stopName}
            >
              {/* Custom Stop Marker */}
              <View style={{ alignItems: 'center', justifyContent: 'center' }}>
                <View style={{
                  width: markerSize,
                  height: markerSize,
                  borderRadius: markerSize / 2,
                  backgroundColor: stop.isPassed ? '#999' : routeColor,
                  borderWidth: 2,
                  borderColor: 'white',
                  alignItems: 'center',
                  justifyContent: 'center',
                  shadowColor: '#000',
                  shadowOffset: { width: 0, height: 2 },
                  shadowOpacity: 0.3,
                  shadowRadius: 2,
                  elevation: 3,
                }}>
                  {/* Show actual stop number (1 to N) */}
                  <Text style={{
                    color: 'white',
                    fontWeight: 'bold',
                    fontSize: markerSize * 0.4
                  }}>
                    {stop.stopNumber}
                  </Text>
                </View>
              </View>

              {Callout && (
                <Callout tooltip>
                  <View style={{
                    backgroundColor: 'white',
                    padding: 12,
                    borderRadius: 10,
                    minWidth: 140,
                    maxWidth: 200,
                    shadowColor: '#000',
                    shadowOffset: { width: 0, height: 2 },
                    shadowOpacity: 0.25,
                    shadowRadius: 4,
                    elevation: 5,
                    borderLeftWidth: 4,
                    borderLeftColor: routeColor,
                  }}>
                    <Text style={{ fontSize: 11, color: '#888', marginBottom: 4 }}>
                      {stop.isPassed ? `✓ Stop #${stop.stopNumber} - Passed` : `🚏 Stop #${stop.stopNumber}`}
                    </Text>
                    <Text style={{ fontWeight: 'bold', fontSize: 14, color: '#333' }}>
                      {stopName}
                    </Text>
                  </View>
                </Callout>
              )}
            </Marker>
          );
        })}

        {/* Red Line hidden if active route/snapping is happening to prevent double lines */}
        {waypoints.length > 1 && !simulationBus && !selectedRoute && (
          <Polyline
            coordinates={waypoints}
            strokeColor="red"
            strokeWidth={2}
          />
        )}

        {/* Render Eating Line - Hidden since we now use the enhanced route display */}
        {/* simulationBus eating line is no longer needed - route line updates dynamically */}

        {/* OPTIMIZED SIMULATION BUS MARKER */}
        {simulationBus && (
          <Marker.Animated
            key={simulationBus.id}
            coordinate={{ latitude: simulationAnim.x, longitude: simulationAnim.y }} // Mapped from ValueXY
            title={simulationBus.bus_name}
            description="Simulated Bus"
            anchor={{ x: 0.5, y: 0.5 }} // Center icon
          >
            <Image
              source={busIcon}
              style={{ width: 40, height: 40, transform: [{ scale: 1.2 }] }} // Slightly larger active bus
              resizeMode="contain"
            />
          </Marker.Animated>
        )}

        {/* Draggable Markers - Only for path drawing mode, hide when route selected */}
        {!selectedRoute && waypoints.map((wp, index) => (
          <Marker
            key={`wp-${index}-${wp.latitude}-${wp.longitude}`}
            coordinate={wp}
            title={`Waypoint ${index + 1}`}
            pinColor="orange"
            draggable
            onDragEnd={(e) => {
              const newWaypoints = [...waypoints];
              newWaypoints[index] = e.nativeEvent.coordinate;
              setWaypoints(newWaypoints);
            }}
          >
            {Callout && (
              <Callout tooltip onPress={() => {
                const newWaypoints = [...waypoints];
                newWaypoints.splice(index, 1);
                setWaypoints(newWaypoints);
              }}>
                <View style={{ backgroundColor: 'white', padding: 10, borderRadius: 10 }}>
                  <Text style={{ fontWeight: 'bold' }}>Waypoint {index + 1}</Text>
                  <Text style={{ color: 'red' }}>🗑 Delete</Text>
                </View>
              </Callout>
            )}
          </Marker>
        ))}

        {/* Debug Location Marker - Draggable fake user position */}
        {debugMode && debugLocationEnabled && debugLocation && (
          <Marker
            coordinate={debugLocation}
            title="📍 Debug Location"
            description="Drag to simulate your position"
            pinColor="blue"
            draggable
            onDragEnd={handleDebugMarkerDrag}
            anchor={{ x: 0.5, y: 0.5 }}
          >
            <View style={{
              backgroundColor: '#3b82f6',
              width: 40,
              height: 40,
              borderRadius: 20,
              borderWidth: 3,
              borderColor: 'white',
              justifyContent: 'center',
              alignItems: 'center',
              shadowColor: '#000',
              shadowOffset: { width: 0, height: 2 },
              shadowOpacity: 0.3,
              shadowRadius: 3,
              elevation: 5,
            }}>
              <Ionicons name="person" size={22} color="white" />
            </View>
          </Marker>
        )}
      </MapView>

      {showGrid && <GridOverlay />}

      {/* Debug Controls */}
      {debugMode && (
        <View style={styles.debugControls}>
          {!showControls ? (
            <TouchableOpacity onPress={() => setShowControls(true)} style={styles.debugToggle}>
              <Text style={styles.debugText}>🛠 Debug</Text>
            </TouchableOpacity>
          ) : (
            <View style={[styles.controlPanel, { maxHeight: 300 }]}>
              <View style={styles.panelHeader}>
                <Text style={styles.panelTitle}>Simulation Controls</Text>
                <TouchableOpacity onPress={() => setShowGrid(!showGrid)} style={{ marginRight: 10 }}>
                  <Text style={{ fontSize: 20 }}>#️⃣</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => setShowControls(false)}>
                  <Ionicons name="close-circle" size={24} color="#666" />
                </TouchableOpacity>
              </View>

              <TouchableOpacity
                style={[styles.actionBtn, { backgroundColor: '#10b981' }]}
                onPress={simulateRoute}
              >
                <Text style={styles.actionBtnText}>▶ Test Animation</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.actionBtn, { backgroundColor: '#ef4444', marginTop: 10 }]}
                onPress={stopAnimation}
              >
                <Text style={styles.actionBtnText}>⏹ Stop</Text>
              </TouchableOpacity>

              {/* Speed Control */}
              <View style={{ marginTop: 15 }}>
                <Text style={{ fontSize: 12, color: '#666', marginBottom: 5 }}>Speed: {simulationSpeed} m/s (~{Math.round(simulationSpeed * 3.6)} km/h)</Text>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <TouchableOpacity
                    style={[styles.speedBtn, simulationSpeed === 10 && styles.speedBtnActive]}
                    onPress={() => { setSimulationSpeed(10); simulationSpeedRef.current = 10; }}
                  >
                    <Text style={styles.speedBtnText}>🐢 Slow</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.speedBtn, simulationSpeed === 20 && styles.speedBtnActive]}
                    onPress={() => { setSimulationSpeed(20); simulationSpeedRef.current = 20; }}
                  >
                    <Text style={styles.speedBtnText}>🚌 Normal</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.speedBtn, simulationSpeed === 50 && styles.speedBtnActive]}
                    onPress={() => { setSimulationSpeed(50); simulationSpeedRef.current = 50; }}
                  >
                    <Text style={styles.speedBtnText}>🚀 Fast</Text>
                  </TouchableOpacity>
                </View>
              </View>

              <View style={{ marginTop: 10, borderTopWidth: 1, borderColor: '#eee', paddingTop: 5 }}>
                <TouchableOpacity onPress={() => setWaypoints([])}>
                  <Text style={{ color: 'red', fontSize: 12 }}>Clear Path</Text>
                </TouchableOpacity>
              </View>

              {/* Debug Location Override Toggle */}
              <View style={{ marginTop: 10, borderTopWidth: 1, borderColor: '#eee', paddingTop: 10 }}>
                <Text style={{ fontSize: 12, fontWeight: 'bold', color: '#333', marginBottom: 5 }}>📍 Fake Location</Text>
                <TouchableOpacity
                  style={[styles.actionBtn, { backgroundColor: debugLocationEnabled ? '#3b82f6' : '#9ca3af' }]}
                  onPress={() => {
                    if (debugLocationEnabled) {
                      setDebugLocationEnabled(false);
                    } else {
                      enableDebugLocation();
                    }
                  }}
                >
                  <Text style={styles.actionBtnText}>
                    {debugLocationEnabled ? '📍 Location Override ON' : '📍 Enable Fake Location'}
                  </Text>
                </TouchableOpacity>
                {debugLocationEnabled && debugLocation && (
                  <Text style={{ fontSize: 10, color: '#666', marginTop: 5 }}>
                    Drag the blue marker to move your position
                  </Text>
                )}
              </View>

              {/* Force Ride Bus Debug Button */}
              <View style={{ marginTop: 10, borderTopWidth: 1, borderColor: '#eee', paddingTop: 10 }}>
                <Text style={{ fontSize: 12, fontWeight: 'bold', color: '#333', marginBottom: 5 }}>🚌 Riding Card Test</Text>
                {ridingBus ? (
                  <TouchableOpacity
                    style={[styles.actionBtn, { backgroundColor: '#ef4444' }]}
                    onPress={() => {
                      setRidingBus(null);
                      setBusSignal(null);
                    }}
                  >
                    <Text style={styles.actionBtnText}>🚫 Exit Riding Mode</Text>
                  </TouchableOpacity>
                ) : (
                  <TouchableOpacity
                    style={[styles.actionBtn, { backgroundColor: '#8b5cf6' }]}
                    onPress={() => {
                      if (buses.length > 0) {
                        const testBus = buses[0];
                        setRidingBus(testBus);
                        setBusSignal(-55); // Mock signal
                        // Also load the bus route if available
                        handleBusPress(testBus);
                        Alert.alert('Debug', `Now riding: ${testBus.bus_name || testBus.bus_mac}`);
                      } else {
                        Alert.alert('No Buses', 'No buses available. Make sure the server is running.');
                      }
                    }}
                  >
                    <Text style={styles.actionBtnText}>🚌 Force Ride First Bus</Text>
                  </TouchableOpacity>
                )}
              </View>
            </View>
          )}
        </View>
      )}

      <TouchableOpacity style={styles.locationButton} onPress={zoomToLocation}>
        <Ionicons name="navigate" size={24} color="white" />
      </TouchableOpacity>

      {errorMsg && (
        <View style={styles.errorContainer}>
          <Text style={styles.errorText}>{errorMsg}</Text>
        </View>
      )}

      {/* Stop Name Popup - Shows when simulation bus reaches a stop */}
      {currentStopName && (
        <View style={styles.stopNamePopup}>
          <View style={styles.stopNameCard}>
            <Text style={styles.stopNameIcon}>🚏</Text>
            <Text style={styles.stopNameText}>{currentStopName}</Text>
          </View>
        </View>
      )}

      {ridingBus && (() => {
        // Prepare Data for the Card
        // Use API-fetched passenger count directly
        const passengerCount = personCounts?.entering || 0;
        const isCrowded = passengerCount > 20;

        const pmValue = ridingBus.pm2_5 || 0;
        const { status: pmStatus, color: pmColor, solidColor: pmSolidColor } = getAirQualityStatus(pmValue);

        // Calculate Next Stop
        // We use stopMarkers which implies activeRoute is set. If not, fallback.
        const nextStop = stopMarkers.find(s => !s.isPassed && s.isUpcoming) || stopMarkers.find(s => !s.isPassed);
        const nextStopName = nextStop ? (nextStop.stopName || `Stop #${nextStop.stopNumber}`) : 'Terminus';

        return (
          <View style={styles.ridingCard}>
            {/* Header: Bus Info & Signal */}
            <View style={styles.ridingHeader}>
              <View>
                <Text style={styles.ridingTitle}>{ridingBus.bus_name || `Bus ${ridingBus.id}`}</Text>
                <Text style={styles.ridingSubtitle}>
                  {activeRoute ? activeRoute.routeName : 'No Route Selected'}
                </Text>
              </View>

              {/* Signal Indicator */}
              {busSignal !== null && (
                <View style={styles.signalContainer}>
                  {(() => {
                    let iconName = 'wifi-strength-outline';
                    let color = '#ef4444'; // Red default (weak/none)
                    let label = 'Offline';

                    if (busSignal >= -55) {
                      iconName = 'wifi-strength-4';
                      color = '#10b981'; // Green
                      label = 'Excellent';
                    } else if (busSignal >= -65) {
                      iconName = 'wifi-strength-3';
                      color = '#10b981';
                      label = 'Good';
                    } else if (busSignal >= -75) {
                      iconName = 'wifi-strength-2';
                      color = '#f59e0b'; // Yellow
                      label = 'Fair';
                    } else if (busSignal >= -85) {
                      iconName = 'wifi-strength-1';
                      color = '#f97316'; // Orange
                      label = 'Weak';
                    } else {
                      iconName = 'wifi-strength-alert-outline'; // Or strength-outline
                      color = '#ef4444';
                      label = 'Poor';
                    }

                    return (
                      <View style={{ alignItems: 'flex-end' }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                          {/* Using larger icon for emphasis */}
                          <MaterialCommunityIcons name={iconName} size={24} color={color} />
                          <Text style={{ fontSize: 14, color: color, marginLeft: 4, fontWeight: 'bold' }}>
                            {busSignal} dBm
                          </Text>
                        </View>
                        <Text style={{ fontSize: 10, color: '#9ca3af' }}>{label}</Text>
                      </View>
                    );
                  })()}
                </View>
              )}
            </View>

            {/* Info Grid: Next Stop, Seats, PM */}
            <View style={styles.ridingInfoGrid}>
              {/* Next Stop */}
              <View style={[styles.infoItem, { flex: 2, borderRightWidth: 1, borderColor: '#eee' }]}>
                <Text style={styles.infoLabel}>NEXT STOP</Text>
                <Text style={styles.infoValue} numberOfLines={1}>
                  {nextStopName}
                </Text>
              </View>

              {/* Passengers */}
              <View style={[styles.infoItem, { flex: 1, alignItems: 'center', borderRightWidth: 1, borderColor: '#eee' }]}>
                <Text style={styles.infoLabel}>PASSENGERS</Text>
                <Text style={[styles.infoValue, { color: isCrowded ? '#ef4444' : '#333' }]}>
                  {passengerCount}/33
                </Text>
              </View>

              {/* PM 2.5 */}
              <View style={[styles.infoItem, { flex: 1, alignItems: 'flex-end' }]}>
                <Text style={styles.infoLabel}>PM 2.5</Text>
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                  <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: pmSolidColor, marginRight: 4 }} />
                  <Text style={styles.infoValue}>{pmValue}</Text>
                </View>
              </View>
            </View>

            {/* Controls */}
            <TouchableOpacity
              style={[
                styles.ringButton,
                (busSignal !== null && busSignal <= -80) && styles.disabledButton
              ]}
              onPress={handleRing}
              disabled={busSignal !== null && busSignal <= -80}
            >
              <Ionicons name="notifications" size={24} color={busSignal !== null && busSignal <= -80 ? "#666" : "black"} style={{ marginRight: 8 }} />
              <Text style={styles.ringButtonText}>
                {(busSignal !== null && busSignal <= -80) ? "Signal Weak" : "RING BELL"}
              </Text>
            </TouchableOpacity>

            {/* Exit Button Removed per Auto-Detect Logic */}
          </View>
        );
      })()}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  map: {
    width: '100%',
    height: '100%',
  },
  loading: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  errorContainer: {
    position: 'absolute',
    top: 50,
    left: 20,
    right: 20,
    backgroundColor: 'rgba(255, 0, 0, 0.8)',
    padding: 10,
    borderRadius: 8,
  },
  errorText: {
    color: 'white',
    textAlign: 'center',
  },
  locationButton: {
    position: 'absolute',
    bottom: 100,
    right: 20,
    backgroundColor: '#2563eb',
    width: 50,
    height: 50,
    borderRadius: 25,
    justifyContent: 'center',
    alignItems: 'center',
    elevation: 5,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
  },
  ridingCard: {
    position: 'absolute',
    bottom: 20, // Lower
    left: 15,
    right: 15,
    backgroundColor: 'white',
    padding: 15, // Compact padding
    borderRadius: 20,
    elevation: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 10,
  },
  ridingHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 10, // Reduced margin
  },
  ridingTitle: {
    fontSize: 18, // Smaller title
    fontWeight: '800',
    color: '#1f2937',
    marginBottom: 2,
  },
  ridingSubtitle: {
    fontSize: 12,
    color: '#6b7280',
    fontWeight: '500',
  },
  signalContainer: {
    backgroundColor: '#f3f4f6',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  ridingInfoGrid: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 15, // Reduced margin
    backgroundColor: '#f9fafb',
    padding: 10, // Compact
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#e5e7eb',
  },
  infoItem: {
    // Flex set inline
  },
  infoLabel: {
    fontSize: 10,
    color: '#9ca3af',
    fontWeight: '700',
    letterSpacing: 0.5,
    marginBottom: 2,
    textTransform: 'uppercase',
  },
  infoValue: {
    fontSize: 14, // Slightly smaller
    fontWeight: '700',
    color: '#1f2937',
  },
  ringButton: {
    backgroundColor: '#fbbf24',
    paddingVertical: 12, // Compact
    borderRadius: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#fbbf24',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 8,
    elevation: 4,
    marginBottom: 0, // No exit button below
  },
  disabledButton: {
    backgroundColor: '#e5e7eb',
    shadowOpacity: 0,
    elevation: 0,
  },
  ringButtonText: {
    fontSize: 16, // Smaller text
    fontWeight: '800',
    color: '#000',
    letterSpacing: 0.5,
  },
  // exitButton removed
  debugControls: {
    position: 'absolute',
    top: 100,
    left: 10,
  },
  debugToggle: {
    backgroundColor: 'rgba(0,0,0,0.7)',
    padding: 8,
    borderRadius: 20,
  },
  debugText: {
    color: 'white',
    fontWeight: 'bold',
    fontSize: 12,
  },
  controlPanel: {
    backgroundColor: 'white',
    padding: 15,
    borderRadius: 10,
    width: 200,
    elevation: 5,
  },
  panelHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  panelTitle: {
    fontWeight: 'bold',
  },
  actionBtn: {
    padding: 10,
    borderRadius: 5,
    alignItems: 'center',
  },
  actionBtnText: {
    color: 'white',
    fontWeight: 'bold',
  },
  mapFallback: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#e8f4f8',
  },
  // Speed Control Buttons
  speedBtn: {
    flex: 1,
    marginHorizontal: 3,
    paddingVertical: 8,
    backgroundColor: '#f3f4f6',
    borderRadius: 8,
    alignItems: 'center',
  },
  speedBtnActive: {
    backgroundColor: '#10b981',
  },
  speedBtnText: {
    fontSize: 11,
    fontWeight: '600',
  },
  // Stop Name Popup
  stopNamePopup: {
    position: 'absolute',
    top: 100,
    left: 20,
    right: 20,
    alignItems: 'center',
    zIndex: 1000,
  },
  stopNameCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'white',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 25,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 5,
    elevation: 8,
    borderLeftWidth: 4,
    borderLeftColor: '#10b981',
  },
  stopNameIcon: {
    fontSize: 24,
    marginRight: 10,
  },
  stopNameText: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#333',
    flexShrink: 1,
  },
});

export default MapScreen;


// --- VECTOR MATH HELPERS ---

const getProjectedPoint = (P, A, B) => {
  // Use static helper from top of file
  const lat1 = deg2rad_Static(A.latitude);
  const lon1 = deg2rad_Static(A.longitude);
  const lat2 = deg2rad_Static(B.latitude);
  const lon2 = deg2rad_Static(B.longitude);
  const lat3 = deg2rad_Static(P.latitude);
  const lon3 = deg2rad_Static(P.longitude);

  const x = (lon3 - lon1) * Math.cos((lat1 + lat3) / 2);
  const y = lat3 - lat1;
  const dx = (lon2 - lon1) * Math.cos((lat1 + lat2) / 2);
  const dy = lat2 - lat1;

  const dot = x * dx + y * dy;
  const len_sq = dx * dx + dy * dy;

  let param = -1;
  if (len_sq !== 0) param = dot / len_sq;

  let lat, lon;
  if (param < 0) {
    lat = A.latitude;
    lon = A.longitude;
  } else if (param > 1) {
    lat = B.latitude;
    lon = B.longitude;
  } else {
    lat = A.latitude + param * (B.latitude - A.latitude);
    lon = A.longitude + param * (B.longitude - A.longitude);
  }

  return { latitude: lat, longitude: lon };
};

const dist2 = (v, w) => {
  return (v.x - w.x) * (v.x - w.x) + (v.y - w.y) * (v.y - w.y);
};
