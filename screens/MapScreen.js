import React, { useState, useEffect, useRef, useMemo } from 'react';
import { View, StyleSheet, TouchableOpacity, Text, Alert, Platform, Image, Animated, Easing, Dimensions, ScrollView } from 'react-native';
import { useFocusEffect, useRoute, useNavigation } from '@react-navigation/native';
import * as Location from 'expo-location';
import axios from 'axios';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useDebug } from '../contexts/DebugContext';
import { useTheme } from '../contexts/ThemeContext';
import { API_BASE, getApiUrl, checkApiKey, getApiHeaders } from '../config/api';
import { getRouteIdForBus } from '../utils/busRouteMapping';
import { loadRoute, getAllRoutes } from '../utils/routeStorage';
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

// PERFORMANCE: Douglas-Peucker polyline simplification
// Reduces points while preserving shape - tolerance in degrees (~5m per 0.00005)
const perpendicularDistance = (point, lineStart, lineEnd) => {
  const dx = lineEnd.longitude - lineStart.longitude;
  const dy = lineEnd.latitude - lineStart.latitude;
  const mag = Math.sqrt(dx * dx + dy * dy);
  if (mag === 0) return 0;
  const u = ((point.longitude - lineStart.longitude) * dx + (point.latitude - lineStart.latitude) * dy) / (mag * mag);
  const closestX = lineStart.longitude + u * dx;
  const closestY = lineStart.latitude + u * dy;
  return Math.sqrt(Math.pow(point.longitude - closestX, 2) + Math.pow(point.latitude - closestY, 2));
};

const simplifyPolyline = (points, tolerance = 0.00003) => {
  if (!points || points.length < 3) return points;

  let maxDist = 0;
  let maxIdx = 0;

  for (let i = 1; i < points.length - 1; i++) {
    const dist = perpendicularDistance(points[i], points[0], points[points.length - 1]);
    if (dist > maxDist) {
      maxDist = dist;
      maxIdx = i;
    }
  }

  if (maxDist > tolerance) {
    const left = simplifyPolyline(points.slice(0, maxIdx + 1), tolerance);
    const right = simplifyPolyline(points.slice(maxIdx), tolerance);
    return [...left.slice(0, -1), ...right];
  }

  return [points[0], points[points.length - 1]];
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

import PMZoneMarker from '../components/PMZoneMarker';



const MapScreen = () => {
  const route = useRoute();
  const navigation = useNavigation();
  const { selectedRoute, focusBus } = route.params || {};

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

  // PM Zone Management
  const [pmZones, setPmZones] = useState([]);
  const [isAddingZone, setIsAddingZone] = useState(false);

  // Fake Bus for testing proximity boarding
  const [fakeBusEnabled, setFakeBusEnabled] = useState(false);
  const [fakeBusLocation, setFakeBusLocation] = useState(null); // {latitude, longitude}

  // Debug panel tab state: 'simulation' or 'testing'
  const [debugTab, setDebugTab] = useState('simulation');

  // All routes for displaying all stops on map load
  const [allRoutes, setAllRoutes] = useState([]);
  const [highlightedRouteId, setHighlightedRouteId] = useState(null);

  // PERFORMANCE: Track map region for viewport culling
  const [mapRegion, setMapRegion] = useState({
    latitude: 14.8820,
    longitude: 102.0207,
    latitudeDelta: 0.02,
    longitudeDelta: 0.02,
  });
  const regionDebounceRef = useRef(null);

  // MARKER RENDERING: Allow initial render, then disable for performance
  const [markersReady, setMarkersReady] = useState(false);

  // Effective user location (debug override or real GPS)
  const effectiveUserLocation = debugMode && debugLocationEnabled && debugLocation
    ? debugLocation
    : userLocation;

  // Merge fake bus into buses array when enabled
  const busesWithFake = useMemo(() => {
    if (!debugMode || !fakeBusEnabled || !fakeBusLocation) return buses;

    const fakeBus = {
      id: 'FAKE-BUS-TEST',
      bus_mac: 'FAKE-BUS-TEST',
      bus_name: '🧪 Fake Test Bus',
      current_lat: fakeBusLocation.latitude,
      current_lon: fakeBusLocation.longitude,
      seats_available: 30,
      pm2_5: 12,
      isFake: true
    };

    return [...buses, fakeBus];
  }, [buses, debugMode, fakeBusEnabled, fakeBusLocation]);

  // Active route is either from navigation (selectedRoute) or from tapping a bus (busSelectedRoute)
  const activeRoute = selectedRoute || busSelectedRoute;

  // Calculate bus's stop index based on its position ALONG THE ROUTE PATH
  // This tracks which stops the bus has passed by projecting its position onto the route
  // OPTIMIZED: Only extract target bus location to avoid recalculating on every bus update
  const targetBusLocation = useMemo(() => {
    if (!activeRoute?.waypoints) return null;

    // For fake bus testing, use the fake bus location when available
    if (debugMode && fakeBusEnabled && fakeBusLocation) {
      return {
        latitude: fakeBusLocation.latitude,
        longitude: fakeBusLocation.longitude
      };
    }

    // Check if this route is for the fake bus (no assigned bus_id or bus_id is FAKE-BUS-TEST)
    const targetBusId = activeRoute.bus_id || activeRoute.busId;

    // If no bus_id and fake bus is enabled, use fake bus location from busesWithFake
    if (!targetBusId && debugMode && fakeBusEnabled) {
      // Find fake bus in the bus list
      const fakeBus = busesWithFake.find(b => b.isFake);
      if (fakeBus && fakeBus.current_lat && fakeBus.current_lon) {
        return {
          latitude: fakeBus.current_lat,
          longitude: fakeBus.current_lon
        };
      }
    }

    const routeBus = buses.find(b =>
      (b.bus_mac || b.mac_address || b.id) === targetBusId
    );

    if (!routeBus || !routeBus.current_lat || !routeBus.current_lon) {
      return null;
    }

    return {
      latitude: routeBus.current_lat,
      longitude: routeBus.current_lon
    };
  }, [activeRoute, buses, busesWithFake, debugMode, fakeBusEnabled, fakeBusLocation]);

  // Throttle busBasedStopIndex to only update when bus moves significantly
  // Also track routeId to invalidate cache when switching routes
  const lastBusStopCalc = useRef({ lat: 0, lon: 0, result: 0, routeId: null });

  const busBasedStopIndex = useMemo(() => {
    if (!activeRoute?.waypoints || activeRoute.waypoints.length < 2 || !targetBusLocation) {
      return 0;
    }

    // Skip recalculation if same route and bus hasn't moved more than 20 meters
    const lastCalc = lastBusStopCalc.current;
    const isSameRoute = lastCalc.routeId === activeRoute.routeId;
    const moveDist = getDistanceFromLatLonInM_Static(
      lastCalc.lat, lastCalc.lon,
      targetBusLocation.latitude, targetBusLocation.longitude
    );
    if (isSameRoute && moveDist < 20 && lastCalc.result > 0) {
      return lastCalc.result;
    }

    const fullPath = activeRoute.waypoints;

    // Find the closest segment on the route to the bus
    let minDistance = Infinity;
    let closestSegmentIndex = 0;

    for (let i = 0; i < fullPath.length - 1; i++) {
      const segStart = fullPath[i];
      const segEnd = fullPath[i + 1];

      // Calculate perpendicular distance from bus to segment
      const dx = segEnd.latitude - segStart.latitude;
      const dy = segEnd.longitude - segStart.longitude;
      const lenSq = dx * dx + dy * dy;

      if (lenSq === 0) continue;

      // Project bus onto segment
      const t = Math.max(0, Math.min(1, (
        ((targetBusLocation.latitude - segStart.latitude) * dx) +
        ((targetBusLocation.longitude - segStart.longitude) * dy)
      ) / lenSq));

      const projLat = segStart.latitude + t * dx;
      const projLon = segStart.longitude + t * dy;

      // Approximate distance (faster than haversine for short distances)
      const dLat = targetBusLocation.latitude - projLat;
      const dLon = targetBusLocation.longitude - projLon;
      const dist = dLat * dLat + dLon * dLon; // Squared distance for comparison

      if (dist < minDistance) {
        minDistance = dist;
        closestSegmentIndex = i;
      }
    }

    // Count how many stops are BEFORE or AT the current segment
    let passedStopsCount = 0;
    for (let i = 0; i <= closestSegmentIndex; i++) {
      if (fullPath[i].isStop && fullPath[i].stopName) {
        passedStopsCount++;
      }
    }

    // Cache result with routeId to invalidate when switching routes
    lastBusStopCalc.current = {
      lat: targetBusLocation.latitude,
      lon: targetBusLocation.longitude,
      result: passedStopsCount,
      routeId: activeRoute.routeId
    };

    return passedStopsCount;
  }, [activeRoute, targetBusLocation]);

  // Calculate user's closest stop index based on their (or debug) location
  // This is only used when debug location is enabled (for testing)
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

  // Priority: 1) Real-time currentStopIndex from MQTT, 2) busBasedStopIndex, 3) userStopIndex for debug
  const effectiveStopIndex = (debugMode && debugLocationEnabled && debugLocation)
    ? userStopIndex
    : (currentStopIndex > 0 ? currentStopIndex : busBasedStopIndex);


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
  const busesRef = useRef([]);
  const selectedRouteRef = useRef(null);
  const ridingBusRef = useRef(null);
  const lastShownStopRef = useRef(null); // Prevent flickering stop popup

  // Proximity-based boarding detection: tracks consecutive times user is near each bus
  // Format: { busId: consecutiveCount }
  const proximityCountRef = useRef({});
  const PROXIMITY_THRESHOLD_M = 30; // Must be within 30 meters
  const PROXIMITY_CONSECUTIVE_NEEDED = 4; // Need 4 consecutive near readings to auto-board

  // Auto-exit detection: tracks consecutive times user is far from the riding bus
  const exitCountRef = useRef(0);
  const AUTO_EXIT_THRESHOLD_M = 100; // Must be more than 100 meters away
  const AUTO_EXIT_CONSECUTIVE_NEEDED = 4; // Need 4 consecutive far readings to auto-exit
  const lastNetworkCheckRef = useRef(Date.now()); // Track when we last had good network

  // Bus movement tracking: only auto-board if bus is moving
  // Format: { busId: { lat, lon, timestamp } }
  const prevBusPositionsRef = useRef({});
  const BUS_MOVING_THRESHOLD_M = 5; // Bus must have moved at least 5 meters to be considered "moving"

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
  // Otherwise uses effectiveStopIndex for stop-based calculation
  const routeSegments = useMemo(() => {
    if (!activeRoute?.waypoints) return { passed: [], upcoming: [], distant: [], routeColor: '#e11d48' };

    const routeColor = activeRoute.routeColor || '#e11d48';
    const fullWaypoints = activeRoute.waypoints;

    // Get all stops with their waypoint indices
    const stopsWithIndices = fullWaypoints
      .map((wp, idx) => ({ ...wp, waypointIndex: idx }))
      .filter(wp => wp.isStop && wp.stopName);

    // Use effectiveStopIndex for segment calculation (includes bus position calculation)
    const currentStop = stopsWithIndices[effectiveStopIndex - 1];
    const currentWaypointIdx = currentStop ? currentStop.waypointIndex : 0;

    // Show upcoming segment to next 2 stops (3 total visible ahead)
    const upcomingStop = stopsWithIndices[Math.min(effectiveStopIndex + 2, stopsWithIndices.length - 1)];
    const upcomingStopWaypointIdx = upcomingStop
      ? upcomingStop.waypointIndex
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
    // PERFORMANCE: Apply polyline simplification to reduce point count
    return {
      passed: simplifyPolyline(passedSegment),
      upcoming: simplifyPolyline(upcomingSegment),
      distant: simplifyPolyline(distantSegment),
      routeColor
    };
  }, [activeRoute, simulationBus, remainingRoute, effectiveStopIndex]);

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
        isUpcoming: (index - effectiveStopIndex) >= 0 && (index - effectiveStopIndex) <= 2, // Current + next 2 stops (3 total)
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

    // Return all stops - simpler approach
    // The rendering will handle visual differentiation (upcoming, passed, etc.)
    return allStops;
  }, [activeRoute, effectiveStopIndex, ridingBus, userStopIndex]);

  // Memoize ALL stop markers from ALL routes for default display
  // Only includes actual bus stops (isStop && stopName), not intermediate waypoints
  const allStopMarkers = useMemo(() => {
    const stops = [];
    allRoutes.forEach(route => {
      if (!route.waypoints) return;
      // Only include waypoints that are actual bus stops
      route.waypoints
        .filter(wp => wp.isStop && wp.stopName)
        .forEach((wp, idx) => {
          stops.push({
            ...wp,
            routeId: route.routeId,
            routeName: route.routeName,
            routeColor: route.routeColor || '#2563eb',
            stopNumber: idx + 1,
            isHighlighted: route.routeId === highlightedRouteId,
          });
        });
    });
    return stops;
  }, [allRoutes, highlightedRouteId]);

  // PERFORMANCE: Viewport culling - only render visible markers with HARD LIMIT
  const visibleStopMarkers = useMemo(() => {
    const padding = 0.002; // Reduced padding to limit markers
    const minLat = mapRegion.latitude - mapRegion.latitudeDelta - padding;
    const maxLat = mapRegion.latitude + mapRegion.latitudeDelta + padding;
    const minLon = mapRegion.longitude - mapRegion.longitudeDelta - padding;
    const maxLon = mapRegion.longitude + mapRegion.longitudeDelta + padding;

    const visible = allStopMarkers.filter(stop =>
      stop.latitude >= minLat && stop.latitude <= maxLat &&
      stop.longitude >= minLon && stop.longitude <= maxLon
    );

    // MEMORY FIX: Hard limit on BACKGROUND markers to prevent OOM crash
    // NOTE: This only affects stops when NO route is selected
    // When activeRoute is set, ALL its stops are shown separately (no limit)
    const MARKER_LIMIT = 50;
    if (visible.length > MARKER_LIMIT) {
      const highlighted = visible.filter(s => s.isHighlighted);
      const others = visible.filter(s => !s.isHighlighted).slice(0, MARKER_LIMIT - highlighted.length);
      return [...highlighted, ...others];
    }
    return visible;
  }, [allStopMarkers, mapRegion]);

  // WAITING AT STOP: Detect if user is near a bus stop (within 50m)
  const nearbyStop = useMemo(() => {
    if (!effectiveUserLocation || allStopMarkers.length === 0) return null;

    const NEARBY_THRESHOLD = 50; // 50 meters
    let closestStop = null;
    let closestDistance = Infinity;

    for (const stop of allStopMarkers) {
      const distance = getDistanceFromLatLonInM_Static(
        effectiveUserLocation.latitude,
        effectiveUserLocation.longitude,
        stop.latitude,
        stop.longitude
      );
      if (distance < NEARBY_THRESHOLD && distance < closestDistance) {
        closestDistance = distance;
        closestStop = { ...stop, distance };
      }
    }
    return closestStop;
  }, [effectiveUserLocation, allStopMarkers]);

  // INCOMING BUSES: Calculate which buses are heading to the nearby stop
  const incomingBuses = useMemo(() => {
    if (!nearbyStop || buses.length === 0 || allRoutes.length === 0) return [];

    const incoming = [];
    const AVG_BUS_SPEED_MS = 25 * 1000 / 3600; // 25 km/h in m/s

    for (const bus of buses) {
      const busLat = bus.current_lat || bus.lat;
      const busLon = bus.current_lon || bus.lon;
      if (!busLat || !busLon) continue;

      // Find if this bus is on a route that passes through the nearby stop
      const stopRoute = allRoutes.find(r => r.routeId === nearbyStop.routeId);
      if (!stopRoute || !stopRoute.waypoints) continue;

      // Find the index of the nearby stop in this route
      const stopIdx = stopRoute.waypoints.findIndex(wp =>
        wp.isStop && wp.stopName === nearbyStop.stopName
      );
      if (stopIdx === -1) continue;

      // Find bus position on this route (which segment is it closest to)
      let busSegmentIdx = -1;
      let minBusDist = Infinity;
      for (let i = 0; i < stopRoute.waypoints.length - 1; i++) {
        const wp = stopRoute.waypoints[i];
        const dist = getDistanceFromLatLonInM_Static(busLat, busLon, wp.latitude, wp.longitude);
        if (dist < minBusDist) {
          minBusDist = dist;
          busSegmentIdx = i;
        }
      }

      // Only include if bus is BEFORE the stop (heading toward it)
      if (busSegmentIdx >= stopIdx) continue; // Bus has passed the stop

      // Calculate distance from bus to stop along the route
      let routeDistance = 0;
      for (let i = busSegmentIdx; i < stopIdx; i++) {
        const wp1 = stopRoute.waypoints[i];
        const wp2 = stopRoute.waypoints[i + 1];
        routeDistance += getDistanceFromLatLonInM_Static(
          wp1.latitude, wp1.longitude,
          wp2.latitude, wp2.longitude
        );
      }

      // Calculate ETA
      const etaSeconds = routeDistance / AVG_BUS_SPEED_MS;
      const etaMinutes = Math.round(etaSeconds / 60);

      incoming.push({
        bus,
        routeName: stopRoute.routeName,
        routeColor: stopRoute.routeColor || '#2563eb',
        distanceM: Math.round(routeDistance),
        etaMinutes: etaMinutes < 1 ? 1 : etaMinutes, // At least 1 minute
        stopsAway: stopIdx - busSegmentIdx,
      });
    }

    // Sort by ETA
    incoming.sort((a, b) => a.etaMinutes - b.etaMinutes);
    return incoming;
  }, [nearbyStop, buses, allRoutes]);

  // PERFORMANCE: Debounced region change handler
  const handleRegionChange = (region) => {
    if (regionDebounceRef.current) {
      clearTimeout(regionDebounceRef.current);
    }
    regionDebounceRef.current = setTimeout(() => {
      setMapRegion(region);
    }, 200); // 200ms debounce
  };

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
    } else {
      // When route is cleared, also reset markersReady so stops can re-render
      setMarkersReady(false);
      const timer = setTimeout(() => setMarkersReady(true), 300);
      // Clear previous snap state when route changes
      setSnappedLocation(null);
      setSnappedBusId(null);
      lastSnappedIndexRef.current = 0; // Reset index tracker
      return () => clearTimeout(timer);
    }
  }, [activeRoute]);

  // Load user location and fetch initial data
  useEffect(() => {
    getLocation();
    // fetchBuses(); // Now handled by Polling useEffect
    fetchRoutes();

    // Auto-refresh buses every 5s if not using MQTT -> REMOVED in favor of 2s polling above
    // const interval = setInterval(fetchBuses, 5000);
    // return () => clearInterval(interval);
  }, []);

  // Fetch PM Zones on mount and refresh periodically
  const fetchPmZones = async () => {
    try {
      const url = await getApiUrl();
      const response = await axios.get(`${url}/api/pm-zones`);
      setPmZones(response.data);
    } catch (error) {
      console.log('Error fetching PM Zones:', error);
    }
  };

  useEffect(() => {
    fetchPmZones();
  }, []);

  // Load all routes on mount for displaying all stops
  useEffect(() => {
    const loadAllRoutes = async () => {
      try {
        const routes = await getAllRoutes();
        setAllRoutes(routes);
        // After routes load, allow markers to render initially, then disable tracking
        setMarkersReady(false);
        setTimeout(() => setMarkersReady(true), 800);
      } catch (error) {
        console.log('Error loading all routes:', error);
      }
    };
    loadAllRoutes();
  }, []);

  // Set highlighted route when selectedRoute changes (from Routes screen)
  useEffect(() => {
    if (selectedRoute?.routeId) {
      setHighlightedRouteId(selectedRoute.routeId);
    }
  }, [selectedRoute]);

  // Zoom to bus when focusBus is provided (from Routes screen bus card)
  useEffect(() => {
    if (focusBus && mapRef.current) {
      const busLat = focusBus.current_lat || focusBus.lat;
      const busLon = focusBus.current_lon || focusBus.lon;
      if (busLat && busLon) {
        // Small delay to ensure map is ready
        setTimeout(() => {
          mapRef.current?.animateToRegion({
            latitude: busLat,
            longitude: busLon,
            latitudeDelta: 0.008,
            longitudeDelta: 0.008,
          }, 500);
        }, 300);
      }
    }
  }, [focusBus]);

  // POLLING (HTTP-Only)
  // Replaces MQTT
  useEffect(() => {
    // Initial fetch
    fetchBuses();

    const interval = setInterval(() => {
      fetchBuses();
    }, 2000); // 2s polling

    return () => clearInterval(interval);
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
        // Also sync signal if available in liveBus (from MQTT status)
        if (liveBus.rssi !== undefined) {
          setBusSignal(liveBus.rssi);
        }
      }
    }
  }, [buses]);

  // --- AUTO-EXIT LOGIC ---
  // If user moves far from the bus for multiple consecutive readings, assume they got off
  // Only counts when we have fresh bus location data (indicates good network)
  useEffect(() => {
    const currentUserLoc = effectiveUserLocation;
    if (!ridingBus || !currentUserLoc) {
      return;
    }

    // Disable auto-exit when using debug fake location (for testing)
    if (debugLocationEnabled) {
      return;
    }

    // Find current position of the riding bus (streaming updates)
    const currentBus = buses.find(b => b.id === ridingBus.id || b.bus_mac === ridingBus.bus_mac);
    if (!currentBus || !currentBus.current_lat) {
      // Bus not found or no location - don't count (might be network issue)
      return;
    }

    // Check if bus location is fresh (updated within last 10 seconds)
    // This indicates we have good network connectivity
    const now = Date.now();
    const busLastUpdate = currentBus.lastUpdate || currentBus.updated_at;
    const isBusLocationFresh = busLastUpdate
      ? (now - new Date(busLastUpdate).getTime()) < 10000
      : true; // Assume fresh if no timestamp (conservative)

    if (!isBusLocationFresh) {
      console.log('[AutoExit] Bus location stale, skipping count (possible network issue)');
      return;
    }

    const dist = getDistanceFromLatLonInM_Static(
      currentUserLoc.latitude, currentUserLoc.longitude,
      currentBus.current_lat, currentBus.current_lon
    );

    if (dist > AUTO_EXIT_THRESHOLD_M) {
      // User is far from bus, increment count
      exitCountRef.current += 1;
      console.log(`[AutoExit] Far from bus: ${exitCountRef.current}/${AUTO_EXIT_CONSECUTIVE_NEEDED} (${dist.toFixed(0)}m)`);

      if (exitCountRef.current >= AUTO_EXIT_CONSECUTIVE_NEEDED) {
        console.log(`[AutoExit] ✅ ${AUTO_EXIT_CONSECUTIVE_NEEDED} consecutive far readings. Exiting bus mode.`);
        setRidingBus(null);
        setBusSignal(null);
        exitCountRef.current = 0; // Reset for next time
        Alert.alert("Auto-Exit", "You have moved away from the bus.");
      }
    } else {
      // User is close to bus, reset count
      if (exitCountRef.current > 0) {
        console.log('[AutoExit] Back near bus, resetting count');
        exitCountRef.current = 0;
      }
    }
  }, [effectiveUserLocation, buses, ridingBus, debugLocationEnabled]);

  // --- PROXIMITY-BASED AUTO-BOARDING DETECTION ---
  // Automatically detect when user is riding a bus by tracking consecutive near readings
  useEffect(() => {
    const currentUserLoc = effectiveUserLocation;

    // Skip if already riding a bus or no location
    if (ridingBus || !currentUserLoc) {
      return;
    }

    // Get buses to check (including fake bus if enabled)
    const busesToCheck = fakeBusEnabled && fakeBusLocation
      ? [...buses, {
        id: 'FAKE-BUS-TEST',
        bus_mac: 'FAKE-BUS-TEST',
        bus_name: '🧪 Fake Test Bus',
        current_lat: fakeBusLocation.latitude,
        current_lon: fakeBusLocation.longitude,
        isFake: true,
      }]
      : buses;

    if (busesToCheck.length === 0) return;

    // Check distance to each bus
    const newCounts = { ...proximityCountRef.current };
    let boardedBus = null;

    busesToCheck.forEach(bus => {
      if (!bus.current_lat || !bus.current_lon) return;

      const busId = bus.id || bus.bus_mac;

      // Check if bus is moving (skip for fake bus - always allow for testing)
      const prevPos = prevBusPositionsRef.current[busId];
      const now = Date.now();
      let isBusMoving = bus.isFake; // Fake buses are always "moving" for testing

      if (!bus.isFake && prevPos) {
        const busMoveDistance = getDistanceFromLatLonInM_Static(
          prevPos.lat, prevPos.lon,
          bus.current_lat, bus.current_lon
        );
        isBusMoving = busMoveDistance >= BUS_MOVING_THRESHOLD_M;

        if (!isBusMoving && newCounts[busId]) {
          console.log(`[ProximityBoarding] Bus ${busId} is stationary, not counting`);
        }
      }

      // Update previous position
      prevBusPositionsRef.current[busId] = {
        lat: bus.current_lat,
        lon: bus.current_lon,
        timestamp: now,
      };

      const dist = getDistanceFromLatLonInM_Static(
        currentUserLoc.latitude, currentUserLoc.longitude,
        bus.current_lat, bus.current_lon
      );

      if (dist <= PROXIMITY_THRESHOLD_M && isBusMoving) {
        // User is near this moving bus, increment count
        newCounts[busId] = (newCounts[busId] || 0) + 1;
        console.log(`[ProximityBoarding] Near moving bus ${busId}: ${newCounts[busId]}/${PROXIMITY_CONSECUTIVE_NEEDED} (${dist.toFixed(0)}m)`);

        // Check if threshold reached
        if (newCounts[busId] >= PROXIMITY_CONSECUTIVE_NEEDED && !boardedBus) {
          boardedBus = bus;
        }
      } else if (dist > PROXIMITY_THRESHOLD_M) {
        // User moved away from this bus, reset count
        if (newCounts[busId]) {
          console.log(`[ProximityBoarding] Moved away from bus ${busId}, resetting count`);
          delete newCounts[busId];
        }
      }
      // Note: if near but bus not moving, we just don't increment (keep existing count)
    });

    proximityCountRef.current = newCounts;

    // Auto-board if threshold reached
    if (boardedBus) {
      const busId = boardedBus.id || boardedBus.bus_mac;
      console.log(`[ProximityBoarding] ✅ Auto-boarding bus ${busId}!`);
      setRidingBus(boardedBus);

      // Try to load the bus's assigned route
      (async () => {
        try {
          const routeId = await getRouteIdForBus(busId);
          if (routeId) {
            const route = await loadRoute(routeId);
            if (route) {
              console.log(`[ProximityBoarding] Loaded route: ${route.routeName}`);
              setBusSelectedRoute(route);
              setRemainingRoute(route.waypoints || []);
            }
          }
        } catch (err) {
          console.log('[ProximityBoarding] Could not load route:', err.message);
        }
      })();

      // Reset all counts after boarding
      proximityCountRef.current = {};
    }
  }, [effectiveUserLocation, buses, ridingBus, fakeBusEnabled, fakeBusLocation]);

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
        setBuses(prevBuses => {
          const apiBuses = response.data;
          const mergedBuses = [...prevBuses];

          // 1. Update existing buses or Add new ones from API
          apiBuses.forEach(apiBus => {
            const existingIdx = mergedBuses.findIndex(b => b.id === apiBus.id || b.bus_mac === apiBus.bus_mac);

            // Logic to preserve non-API fields
            let finalName = apiBus.bus_name;

            if (existingIdx > -1) {
              const existing = mergedBuses[existingIdx];

              // Protect Bus Name: Keep existing name if API sends generic "Bus-XX"
              if (existing.bus_name && existing.bus_name !== 'Bus' && !existing.bus_name.startsWith('Bus-')) {
                if (!apiBus.bus_name || apiBus.bus_name.startsWith('Bus-')) {
                  finalName = existing.bus_name;
                }
              }

              // Update existing bus
              mergedBuses[existingIdx] = {
                ...existing, // Keep local state (like RSSI, isOnline)
                ...apiBus,   // Overwrite with server data (lat/lon, counts)
                bus_name: finalName,
                // Explicitly preserve these local-only fields that API might not have or might be null
                rssi: existing.rssi,
                isOnline: existing.isOnline,
                lastSignalUpdate: existing.lastSignalUpdate,
                // If API is offline (no lat/lon), keep local lat/lon
                current_lat: (apiBus.current_lat || apiBus.lat) || existing.current_lat,
                current_lon: (apiBus.current_lon || apiBus.lon) || existing.current_lon,
              };
            } else {
              // Add new bus from API
              mergedBuses.push({
                ...apiBus,
                bus_name: finalName
              });
            }
          });

          // 2. We DO NOT remove buses that are missing from API.
          // They stay in the list (possibly offline). 
          // This prevents flickering if independent MQTT updates keep them alive.

          return mergedBuses;
        });
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

  // Enable fake bus for testing proximity boarding
  const enableFakeBus = () => {
    // Place fake bus near user's location (or center of SUT if no location)
    const baseLoc = userLocation || { latitude: 14.8820, longitude: 102.0207 };
    const fakeBusLoc = {
      latitude: baseLoc.latitude + 0.0002, // Slightly offset (~20m)
      longitude: baseLoc.longitude + 0.0002,
    };
    setFakeBusLocation(fakeBusLoc);
    setFakeBusEnabled(true);
  };

  // Handle dragging the fake bus marker
  const handleFakeBusMarkerDrag = (e) => {
    setFakeBusLocation(e.nativeEvent.coordinate);
  };

  // Merge fake bus into buses array for proximity detection
  const effectiveBuses = useMemo(() => {
    if (!fakeBusEnabled || !fakeBusLocation) return buses;

    const fakeBus = {
      id: 'FAKE-BUS-TEST',
      bus_mac: 'FAKE-BUS-TEST',
      bus_name: '🧪 Fake Test Bus',
      current_lat: fakeBusLocation.latitude,
      current_lon: fakeBusLocation.longitude,
      seats_available: 30,
      pm2_5: 12,
      isFake: true, // Mark as fake for special handling
    };

    return [...buses, fakeBus];
  }, [buses, fakeBusEnabled, fakeBusLocation]);

  const getAirQualityStatus = (value) => {
    if (value == null) return { status: 'No Data', color: 'gray' };
    if (value <= 25) return { status: 'Good', color: 'rgba(0, 255, 0, 0.4)', solidColor: 'green' };
    if (value <= 50) return { status: 'Moderate', color: 'rgba(255, 255, 0, 0.4)', solidColor: '#CCCC00' };
    if (value <= 75) return { status: 'Unhealthy (Sensitive)', color: 'rgba(255, 165, 0, 0.4)', solidColor: 'orange' };
    return { status: 'Unhealthy', color: 'rgba(255, 0, 0, 0.4)', solidColor: 'red' };
  };

  const handleMapPress = (e) => {
    // 1. PM Zone Editing Mode (Debug Only)
    if (debugMode && isAddingZone) {
      const { latitude, longitude } = e.nativeEvent.coordinate;

      Alert.prompt(
        "New PM Zone",
        "Enter name for this zone:",
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Create",
            onPress: async (name) => {
              if (name) {
                try {
                  const url = await getApiUrl();
                  await axios.post(`${url}/api/pm-zones`, {
                    name,
                    lat: latitude,
                    lon: longitude,
                    radius: 50
                  });
                  fetchPmZones();
                  setIsAddingZone(false); // Exit mode after creation
                  Alert.alert("Success", "PM Zone created!");
                } catch (err) {
                  Alert.alert("Error", "Failed to create zone");
                }
              }
            }
          }
        ]
      );
      return; // Stop other map interactions
    }

    // 2. Path Drawing Mode
    if (pathMode) {
      setWaypoints([...waypoints, e.nativeEvent.coordinate]);
    }
    // 3. General Map interactions
    else if (!ridingBus) {
      // Only clear highlights when NOT riding a bus
      // When riding, keep the route tracking active
      // Check activeRoute directly for more reliable detection
      if (activeRoute || busSelectedRoute || waypoints.length > 0 || selectedRoute) {
        setBusSelectedRoute(null);
        setHighlightedRouteId(null);
        setRemainingRoute([]);
        setWaypoints([]); // Clear waypoints to prevent orange markers from showing

        // Also clear selectedRoute from navigation params
        // This ensures activeRoute becomes null so stops/lines fade to dimmed state
        if (selectedRoute) {
          navigation.setParams({ selectedRoute: null, focusBus: null });
        }
      }
    }

    // If ridingBus is set, do nothing - keep route tracking
  };

  // Handle bus marker press - load and display assigned route
  const handleBusPress = async (bus) => {
    const busMac = bus.bus_mac || bus.mac_address || bus.id;
    console.log('[BusPress] Tapped bus:', busMac);

    try {
      let routeId = await getRouteIdForBus(busMac);
      console.log('[BusPress] Assigned route ID:', routeId);

      // For fake bus, use the first available route if none assigned
      if (!routeId && bus.isFake && allRoutes.length > 0) {
        routeId = allRoutes[0].routeId;
        console.log('[BusPress] Fake bus - using first available route:', routeId);
      }

      if (routeId) {
        const route = await loadRoute(routeId);
        if (route) {
          console.log('[BusPress] Loaded route:', route.routeName);
          setBusSelectedRoute(route);
          setHighlightedRouteId(route.routeId); // Highlight this route's stops
          setRemainingRoute(route.waypoints || []);
          // NOTE: Don't set ridingBus here - that's only for actually riding
          // User is just viewing the route, not riding the bus
        } else {
          console.log('[BusPress] Route not found in storage');
          Alert.alert('Route Not Found', 'The assigned route could not be loaded.');
        }
      } else {
        console.log('[BusPress] No route assigned to this bus');
        // Clear previous route if tapping unassigned bus
        setBusSelectedRoute(null);
        setHighlightedRouteId(null); // Clear highlight
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
        onRegionChangeComplete={handleRegionChange}
        showsUserLocation={!(debugMode && debugLocationEnabled)}
        showsMyLocationButton={false}
        customMapStyle={mapStyle}
        userInterfaceStyle={isDark ? 'dark' : 'light'}
      >
        {busesWithFake.map((bus, i) => {
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

          // Highlight the bus that belongs to the selected/highlighted route
          const isHighlightedBus = highlightedRouteId && (
            targetBusId === busMac || isLinkedRouteBus
          );
          const busScale = isHighlightedBus ? 1.3 : 1.0;
          const busZIndex = isHighlightedBus ? 1000 : 100;

          return (
            <Marker.Animated
              key={`bus-${i}-${bus.id || bus.bus_mac}`}
              coordinate={{ latitude, longitude }}
              title={bus.bus_name || "Bus"}
              description={description}
              onPress={() => handleBusPress(bus)}
              zIndex={busZIndex}
            >
              <View style={isHighlightedBus ? {
                shadowColor: selectedRoute?.routeColor || '#2563eb',
                shadowOffset: { width: 0, height: 0 },
                shadowOpacity: 0.8,
                shadowRadius: 10,
                elevation: 10,
              } : null}>
                <Image
                  source={busIcon}
                  style={{ width: 40 * busScale, height: 40 * busScale }}
                  resizeMode="contain"
                />
              </View>
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

        {/* Render ALL route lines from saved routes (dimmed by default) */}
        {/* The highlighted/selected route will be rendered with thicker line above */}
        {allRoutes.map(route => {
          // Skip if this route is the active/highlighted route (rendered with more detail below)
          if (activeRoute && route.routeId === activeRoute.routeId) {
            return null;
          }
          if (!route.waypoints || route.waypoints.length < 2) return null;

          const routeColor = route.routeColor || '#2563eb';

          return (
            <Polyline
              key={`all-route-${route.routeId}`}
              coordinates={route.waypoints}
              strokeColor={routeColor + '40'} // 25% opacity for dimmed routes
              strokeWidth={3}
              zIndex={5}
            />
          );
        })}

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

        {/* Render VISIBLE bus stops from ALL routes (viewport culling) */}
        {/* Only renders markers in current map bounds */}
        {visibleStopMarkers.map((stop, idx) => {
          const isFromHighlightedRoute = stop.isHighlighted;
          // When activeRoute is set, its stops are rendered with more detail below
          // So we can skip rendering them here to avoid duplicates
          // But always render stops from other routes
          if (activeRoute && stop.routeId === activeRoute.routeId) {
            return null;
          }

          const markerOpacity = isFromHighlightedRoute ? 1.0 : 0.8; // Show more visible on startup
          const markerSize = isFromHighlightedRoute ? 24 : 20; // Slightly larger default
          const zIndex = isFromHighlightedRoute ? 90 : 10;
          const routeColor = stop.routeColor || '#2563eb';

          return (
            <Marker
              key={`all-stop-${stop.routeId}-${idx}`}
              coordinate={{ latitude: stop.latitude, longitude: stop.longitude }}
              anchor={{ x: 0.5, y: 0.5 }}
              opacity={markerOpacity}
              zIndex={zIndex}
              tracksViewChanges={!markersReady}
              title={`🚏 ${stop.stopName}`}
              description={stop.routeName}
            >
              {/* Restored: Stop marker with number */}
              <View style={{ alignItems: 'center', justifyContent: 'center' }}>
                <View style={{
                  width: markerSize,
                  height: markerSize,
                  borderRadius: markerSize / 2,
                  backgroundColor: routeColor,
                  borderWidth: 2,
                  borderColor: 'white',
                  alignItems: 'center',
                  justifyContent: 'center',
                  shadowColor: '#000',
                  shadowOffset: { width: 0, height: 1 },
                  shadowOpacity: 0.2,
                  shadowRadius: 1,
                  elevation: 2,
                }}>
                  <Text style={{
                    color: 'white',
                    fontWeight: 'bold',
                    fontSize: markerSize * 0.4
                  }}>
                    {stop.stopNumber}
                  </Text>
                </View>
              </View>
            </Marker>
          );
        })}

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
              {/* Restored: Stop marker with number */}
              <View style={{ alignItems: 'center', justifyContent: 'center' }}>
                <View style={{
                  width: markerSize,
                  height: markerSize,
                  borderRadius: markerSize / 2,
                  backgroundColor: stop.isPassed ? '#999' : routeColor,
                  borderWidth: stop.isUpcoming ? 3 : 2,
                  borderColor: 'white',
                  alignItems: 'center',
                  justifyContent: 'center',
                  shadowColor: '#000',
                  shadowOffset: { width: 0, height: 2 },
                  shadowOpacity: 0.3,
                  shadowRadius: 2,
                  elevation: 3,
                }}>
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

        {/* Draggable Markers - Only for path drawing mode, hide when any route is selected */}
        {!selectedRoute && !busSelectedRoute && waypoints.map((wp, index) => (
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

        {/* Fake Bus Marker - Draggable fake bus for testing proximity boarding */}
        {debugMode && fakeBusEnabled && fakeBusLocation && (
          <Marker
            coordinate={fakeBusLocation}
            title="🧪 Fake Test Bus"
            description="Drag to test proximity boarding"
            draggable
            onDragEnd={handleFakeBusMarkerDrag}
            anchor={{ x: 0.5, y: 0.5 }}
          >
            <View style={{
              backgroundColor: '#f97316',
              width: 44,
              height: 44,
              borderRadius: 22,
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
              <Ionicons name="bus" size={24} color="white" />
            </View>
          </Marker>
        )}
      </MapView>

      {showGrid && <GridOverlay />}

      {/* PM Zone Markers */}
      {pmZones.map((zone) => (
        <PMZoneMarker
          key={zone._id || zone.id}
          zone={zone}
          isEditing={debugMode}
          onPress={(z) => {
            if (debugMode) {
              Alert.alert(
                "Manage Zone",
                `Last Updated: ${z.last_updated ? new Date(z.last_updated).toLocaleTimeString() : 'Never'}`,
                [
                  { text: "Cancel", style: "cancel" },
                  {
                    text: "Delete",
                    style: "destructive",
                    onPress: async () => {
                      try {
                        const url = await getApiUrl();
                        await axios.delete(`${url}/api/pm-zones/${z._id || z.id}`);
                        fetchPmZones();
                      } catch (e) {
                        Alert.alert("Error", "Could not delete zone");
                      }
                    }
                  }
                ]
              )
            }
          }}
        />
      ))}

      {/* Debug Controls */}
      {debugMode && (
        <View style={styles.debugControls}>
          {!showControls ? (
            <TouchableOpacity onPress={() => setShowControls(true)} style={styles.debugToggle}>
              <Text style={styles.debugText}>🛠 Debug</Text>
            </TouchableOpacity>
          ) : (
            <View style={[styles.controlPanel, { maxHeight: 350 }]}>
              {/* Header with close button */}
              <View style={styles.panelHeader}>
                <Text style={styles.panelTitle}>🛠 Debug Tools</Text>
                <TouchableOpacity onPress={() => setShowGrid(!showGrid)} style={{ marginRight: 10 }}>
                  <Text style={{ fontSize: 20 }}>#️⃣</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => setShowControls(false)}>
                  <Ionicons name="close-circle" size={24} color="#666" />
                </TouchableOpacity>
              </View>

              {/* Tab Buttons */}
              <View style={{ flexDirection: 'row', marginBottom: 10, borderRadius: 8, overflow: 'hidden' }}>
                <TouchableOpacity
                  style={{
                    flex: 1,
                    padding: 8,
                    backgroundColor: debugTab === 'simulation' ? '#3b82f6' : '#e5e7eb',
                    alignItems: 'center',
                  }}
                  onPress={() => setDebugTab('simulation')}
                >
                  <Text style={{ color: debugTab === 'simulation' ? 'white' : '#666', fontWeight: 'bold', fontSize: 12 }}>
                    🎬 Simulation
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={{
                    flex: 1,
                    padding: 8,
                    backgroundColor: debugTab === 'testing' ? '#3b82f6' : '#e5e7eb',
                    alignItems: 'center',
                  }}
                  onPress={() => setDebugTab('testing')}
                >
                  <Text style={{ color: debugTab === 'testing' ? 'white' : '#666', fontWeight: 'bold', fontSize: 12 }}>
                    🧪 Testing
                  </Text>
                </TouchableOpacity>
              </View>

              {/* Simulation Tab */}
              {debugTab === 'simulation' && (
                <ScrollView style={{ maxHeight: 200 }}>
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
                </ScrollView>
              )}

              {/* Testing Tab */}
              {debugTab === 'testing' && (
                <ScrollView style={{ maxHeight: 200 }}>
                  {/* Fake User Location */}
                  <View style={{ marginBottom: 15 }}>
                    <Text style={{ fontSize: 12, fontWeight: 'bold', color: '#333', marginBottom: 5 }}>📍 Fake User Location</Text>
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
                        {debugLocationEnabled ? '📍 Fake Location ON' : '📍 Enable Fake Location'}
                      </Text>
                    </TouchableOpacity>
                    {debugLocationEnabled && (
                      <Text style={{ fontSize: 10, color: '#666', marginTop: 5 }}>
                        Drag the blue person marker on map
                      </Text>
                    )}
                  </View>

                  {/* PM Zone Editor (Appears in Debug Panel) */}
                  <View style={{ marginBottom: 15, borderTopWidth: 1, borderColor: '#eee', paddingTop: 10 }}>
                    <Text style={{ fontSize: 12, fontWeight: 'bold', color: '#333', marginBottom: 5 }}>🌩️ PM Zones</Text>
                    <TouchableOpacity
                      style={[styles.actionBtn, { backgroundColor: isAddingZone ? '#f97316' : '#22c55e' }]}
                      onPress={() => setIsAddingZone(!isAddingZone)}
                    >
                      <Text style={styles.actionBtnText}>
                        {isAddingZone ? 'Cancel Adding' : 'Add PM Zone'}
                      </Text>
                    </TouchableOpacity>
                    {isAddingZone && (
                      <Text style={{ fontSize: 10, color: '#666', marginTop: 5 }}>
                        Tap anywhere on map to create a zone
                      </Text>
                    )}
                  </View>

                  {/* Fake Bus */}
                  <View style={{ marginBottom: 15, borderTopWidth: 1, borderColor: '#eee', paddingTop: 10 }}>
                    <Text style={{ fontSize: 12, fontWeight: 'bold', color: '#333', marginBottom: 5 }}>🚌 Fake Bus</Text>
                    <TouchableOpacity
                      style={[styles.actionBtn, { backgroundColor: fakeBusEnabled ? '#f97316' : '#9ca3af' }]}
                      onPress={() => {
                        if (fakeBusEnabled) {
                          setFakeBusEnabled(false);
                          setFakeBusLocation(null);
                        } else {
                          enableFakeBus();
                        }
                      }}
                    >
                      <Text style={styles.actionBtnText}>
                        {fakeBusEnabled ? '🚌 Fake Bus ON' : '🚌 Enable Fake Bus'}
                      </Text>
                    </TouchableOpacity>
                    {fakeBusEnabled && (
                      <Text style={{ fontSize: 10, color: '#666', marginTop: 5 }}>
                        Drag the orange bus marker to test proximity boarding
                      </Text>
                    )}
                  </View>

                  {/* Force Ride Mode */}
                  <View style={{ borderTopWidth: 1, borderColor: '#eee', paddingTop: 10 }}>
                    <Text style={{ fontSize: 12, fontWeight: 'bold', color: '#333', marginBottom: 5 }}>🎫 Riding Card</Text>
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
                            setBusSignal(-55);
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
                </ScrollView>
              )}
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

      {/* WAITING AT STOP CARD - Same design as riding card */}
      {!ridingBus && nearbyStop && (() => {
        const nextBus = incomingBuses[0];
        const routeColor = nearbyStop.routeColor || '#e11d48';

        return (
          <TouchableOpacity
            style={styles.ridingCard}
            activeOpacity={0.9}
            onPress={() => {
              // Zoom to stop location when card is pressed
              if (nearbyStop && mapRef.current) {
                mapRef.current.animateToRegion({
                  latitude: nearbyStop.latitude,
                  longitude: nearbyStop.longitude,
                  latitudeDelta: 0.005,
                  longitudeDelta: 0.005,
                }, 500);
              }
            }}
          >
            {/* Header: Stop Info */}
            <View style={styles.ridingHeader}>
              <View>
                <Text style={styles.ridingTitle}>{nearbyStop.stopName}</Text>
                <Text style={styles.ridingSubtitle}>
                  {nearbyStop.routeName}
                </Text>
              </View>

              {/* Distance Badge */}
              <View style={styles.signalContainer}>
                <View style={{ alignItems: 'flex-end' }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                    <Ionicons name="location" size={20} color={routeColor} />
                    <Text style={{ fontSize: 14, color: routeColor, marginLeft: 4, fontWeight: 'bold' }}>
                      {Math.round(nearbyStop.distance)}m
                    </Text>
                  </View>
                  <Text style={{ fontSize: 10, color: '#9ca3af' }}>from you</Text>
                </View>
              </View>
            </View>

            {/* Info Grid: Next Bus, ETA, Stops Away */}
            <View style={styles.ridingInfoGrid}>
              {nextBus ? (
                <>
                  {/* Next Bus */}
                  <View style={[styles.infoItem, { flex: 2, borderRightWidth: 1, borderColor: '#eee' }]}>
                    <Text style={styles.infoLabel}>NEXT BUS</Text>
                    <Text style={styles.infoValue} numberOfLines={1}>
                      {nextBus.bus.bus_name || `Bus ${nextBus.bus.id?.slice(-4)}`}
                    </Text>
                  </View>

                  {/* ETA */}
                  <View style={[styles.infoItem, { flex: 1, alignItems: 'center', borderRightWidth: 1, borderColor: '#eee' }]}>
                    <Text style={styles.infoLabel}>ETA</Text>
                    <Text style={[styles.infoValue, { color: '#e11d48' }]}>
                      {nextBus.etaMinutes} min
                    </Text>
                  </View>

                  {/* Stops Away */}
                  <View style={[styles.infoItem, { flex: 1, alignItems: 'flex-end' }]}>
                    <Text style={styles.infoLabel}>STOPS</Text>
                    <Text style={styles.infoValue}>
                      {nextBus.stopsAway}
                    </Text>
                  </View>
                </>
              ) : (
                <View style={[styles.infoItem, { flex: 1, alignItems: 'center' }]}>
                  <Text style={styles.infoLabel}>NO INCOMING BUSES</Text>
                  <Text style={[styles.infoValue, { fontSize: 12, color: '#9ca3af' }]}>
                    Buses will appear here
                  </Text>
                </View>
              )}
            </View>

            {/* More Buses List (if any) */}
            {incomingBuses.length > 1 && (
              <View style={{ paddingTop: 8, borderTopWidth: 1, borderColor: '#eee' }}>
                <Text style={{ fontSize: 10, color: '#9ca3af', marginBottom: 4 }}>MORE BUSES</Text>
                {incomingBuses.slice(1, 3).map((item, idx) => (
                  <View
                    key={`more-bus-${idx}`}
                    style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 4 }}
                  >
                    <View style={{
                      width: 6, height: 6, borderRadius: 3,
                      backgroundColor: item.routeColor, marginRight: 8,
                    }} />
                    <Text style={{ flex: 1, fontSize: 12, color: '#666' }}>
                      {item.bus.bus_name || `Bus ${item.bus.id?.slice(-4)}`}
                    </Text>
                    <Text style={{ fontSize: 12, fontWeight: 'bold', color: '#e11d48' }}>
                      {item.etaMinutes} min
                    </Text>
                  </View>
                ))}
              </View>
            )}
          </TouchableOpacity>
        );
      })()}

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
          <TouchableOpacity
            style={[
              styles.ridingCard,
              (ridingBus.rssi === null || ridingBus.rssi === undefined || ridingBus.rssi < -85) && { opacity: 0.6 }
            ]}
            activeOpacity={0.9}
            onPress={() => {
              // Zoom to bus location when card is pressed
              if (ridingBus && mapRef.current) {
                const busLat = ridingBus.current_lat || ridingBus.lat;
                const busLon = ridingBus.current_lon || ridingBus.lon;
                if (busLat && busLon) {
                  mapRef.current.animateToRegion({
                    latitude: busLat,
                    longitude: busLon,
                    latitudeDelta: 0.005,
                    longitudeDelta: 0.005,
                  }, 500);
                }
              }
            }}
          >
            {/* Header: Bus Info & Signal */}
            <View style={styles.ridingHeader}>
              <View>
                <Text style={styles.ridingTitle}>{ridingBus.bus_name || ridingBus.id || "Bus"}</Text>
                <Text style={styles.ridingSubtitle}>
                  {activeRoute ? activeRoute.routeName : 'No Route Selected'}
                </Text>
              </View>

              {/* Signal Indicator */}
              <View style={styles.signalContainer}>
                {(() => {
                  const signal = ridingBus.rssi ?? busSignal; // Use bus-specific RSSI if available

                  let iconName = 'wifi-strength-outline';
                  let color = '#ef4444'; // Red default (weak/none)
                  let label = 'Offline';

                  // Logic: If signal is missing or very low, treat as offline/bad
                  if (signal === null || signal === undefined) {
                    iconName = 'wifi-off';
                    color = '#9ca3af'; // Gray
                    label = 'Offline';
                  } else if (signal >= -55) {
                    iconName = 'wifi-strength-4';
                    color = '#10b981'; // Green
                    label = 'Excellent';
                  } else if (signal >= -65) {
                    iconName = 'wifi-strength-3';
                    color = '#10b981';
                    label = 'Good';
                  } else if (signal >= -75) {
                    iconName = 'wifi-strength-2';
                    color = '#f59e0b'; // Yellow
                    label = 'Fair';
                  } else if (signal >= -85) {
                    iconName = 'wifi-strength-1';
                    color = '#f97316'; // Orange
                    label = 'Weak';
                  } else {
                    iconName = 'wifi-strength-alert-outline';
                    color = '#ef4444';
                    label = 'Poor';
                  }

                  return (
                    <View style={{ alignItems: 'flex-end' }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                        <MaterialCommunityIcons name={iconName} size={24} color={color} />
                        {signal !== null && signal !== undefined && (
                          <Text style={{ fontSize: 14, color: color, marginLeft: 4, fontWeight: 'bold' }}>
                            {signal} dBm
                          </Text>
                        )}
                      </View>
                      <Text style={{ fontSize: 10, color: '#9ca3af' }}>{label}</Text>
                    </View>
                  );
                })()}
              </View>
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
                (busSignal !== null && busSignal <= -80) && styles.disabledButton,
                { opacity: (busSignal !== null && busSignal <= -80) ? 0.5 : 1 }
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
          </TouchableOpacity>
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
