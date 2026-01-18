import React, { useState, useEffect, useCallback, useRef } from 'react';
import { View, Text, FlatList, StyleSheet, TouchableOpacity, Alert, Platform, RefreshControl } from 'react-native';
import axios from 'axios';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { API_BASE, getApiUrl, checkApiKey, getApiHeaders } from '../config/api';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useDebug } from '../contexts/DebugContext';
import { useTheme } from '../contexts/ThemeContext';
import { useLanguage } from '../contexts/LanguageContext';
import { useData } from '../contexts/DataContext'; // <-- ADDED

import { getAllRoutes, loadRoute, downloadRoutesFromServer } from '../utils/routeStorage';
import { getAllMappings, getRouteIdForBus } from '../utils/busRouteMapping';
import { findNextStop } from '../utils/routeHelpers';

const RoutesScreen = () => {
  const { buses, refreshBuses } = useData(); // Consume Global Data
  const [busRoutes, setBusRoutes] = useState({}); // { busMac: { route, nextStop } }
  const [refreshing, setRefreshing] = useState(false);
  const [localRoutes, setLocalRoutes] = useState([]); // For debug mode route management
  const navigation = useNavigation();
  const { debugMode } = useDebug();
  const { theme } = useTheme();
  const { t } = useLanguage();
  const [passengerCount, setPassengerCount] = useState(0);

  // Force re-render periodically for offline status
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const interval = setInterval(() => setTick(t => t + 1), 10000); // 10s check
    return () => clearInterval(interval);
  }, []);

  // Fetch passenger count from API
  useEffect(() => {
    const fetchCount = async () => {
      try {
        const response = await fetch(`${API_BASE}/count`, { headers: getApiHeaders() });
        if (response.ok) {
          const data = await response.json();
          if (data.passengers !== undefined) {
            setPassengerCount(data.passengers);
          }
        }
      } catch (err) {
        // Silent fail
      }
    };
    fetchCount();
    const interval = setInterval(fetchCount, 5000);
    return () => clearInterval(interval);
  }, []);

  // Load mappings and calculate next stops whenever BUSES change
  useEffect(() => {
    const calculateBusRoutes = async () => {
      try {
        const mappings = await getAllMappings();
        const routeDataMap = {};

        for (const bus of buses) {
          const busMac = bus.bus_mac || bus.mac_address || bus.id;
          const routeId = mappings[busMac];

          if (routeId) {
            const route = await loadRoute(routeId);
            if (route) {
              const busLat = bus.current_lat || bus.lat;
              const busLon = bus.current_lon || bus.lon;
              const nextStop = findNextStop(busLat, busLon, route.waypoints);

              routeDataMap[busMac] = {
                route,
                nextStop,
              };
            }
          }
        }
        setBusRoutes(routeDataMap);
      } catch (error) {
        console.error('[RoutesScreen] Error calculating routes:', error);
      }
    };

    calculateBusRoutes();
  }, [buses]); // Re-run when context data updates

  // Load local saved routes (for debug list)
  useFocusEffect(
    useCallback(() => {
      const loadSavedRoutes = async () => {
        const saved = await getAllRoutes();
        setLocalRoutes(saved);
      };
      loadSavedRoutes();
    }, [])
  );

  const onRefresh = async () => {
    setRefreshing(true);
    await refreshBuses(); // Refresh Context
    await downloadRoutesFromServer(); // Sync routes
    setRefreshing(false);
  };

  // Navigate to map with bus and route selected
  const handleBusPress = (bus) => {
    const busMac = bus.bus_mac || bus.mac_address || bus.id;
    const routeData = busRoutes[busMac];

    navigation.navigate('Map', {
      selectedRoute: routeData?.route || null,
      focusBus: bus,
    });
  };

  const renderBusCard = ({ item: bus }) => {
    const busMac = bus.bus_mac || bus.mac_address || bus.id;
    const routeData = busRoutes[busMac];
    const hasRoute = !!routeData?.route;
    const nextStop = routeData?.nextStop;

    // Offline check > 60s
    // Use (bus.last_updated || 0) to handle null/undefined/0.
    const isOffline = (Date.now() - (bus.last_updated || 0)) > 60000;
    const opacity = isOffline ? 0.5 : 1.0;

    return (
      <TouchableOpacity
        style={[styles.busCard, { backgroundColor: theme.card, opacity }]}
        onPress={() => handleBusPress(bus)}
        activeOpacity={0.7}
      >
        <View style={styles.busHeader}>
          <View style={styles.busIconContainer}>
            <Ionicons name="bus" size={28} color={theme.primary} />
          </View>
          <View style={styles.busInfo}>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <Text style={[styles.busName, { color: theme.text, marginRight: 8 }]}>
                {bus.bus_name || bus.bus_mac || bus.id} {isOffline && "(Offline)"}
              </Text>
              {/* WiFi Signal Icon */}
              {(() => {
                const signal = bus.rssi;
                if (signal === undefined || signal === null) return null;

                let iconName = 'wifi-strength-outline';
                let color = '#ef4444';

                if (signal >= -55) { iconName = 'wifi-strength-4'; color = '#10b981'; }
                else if (signal >= -65) { iconName = 'wifi-strength-3'; color = '#10b981'; }
                else if (signal >= -75) { iconName = 'wifi-strength-2'; color = '#f59e0b'; }
                else if (signal >= -85) { iconName = 'wifi-strength-1'; color = '#f97316'; }
                else { iconName = 'wifi-strength-alert-outline'; color = '#ef4444'; }

                return (
                  <MaterialCommunityIcons name={iconName} size={20} color={color} />
                );
              })()}
            </View>
            {hasRoute ? (
              <Text style={[styles.routeName, { color: theme.primary }]}>
                🛣️ {routeData.route.routeName}
              </Text>
            ) : (
              <Text style={[styles.noRoute, { color: theme.textMuted }]}>
                No route assigned
              </Text>
            )}
          </View>
          <Ionicons name="chevron-forward" size={24} color={theme.textMuted} />
        </View>

        {nextStop && (
          <View style={[styles.nextStopContainer, { backgroundColor: theme.primaryLight }]}>
            <View style={styles.nextStopRow}>
              <Ionicons name="location" size={18} color={theme.primary} />
              <Text style={[styles.nextStopLabel, { color: theme.textSecondary }]}>
                Next Stop:
              </Text>
              <Text style={[styles.nextStopName, { color: theme.text }]}>
                {nextStop.stopName}
              </Text>
            </View>
            {nextStop.etaMinutes && (
              <View style={[styles.etaBadge, { backgroundColor: theme.primary }]}>
                <Text style={styles.etaText}>~{nextStop.etaMinutes} min</Text>
              </View>
            )}
          </View>
        )}

        {/* Bus stats */}
        <View style={styles.statsRow}>
          {bus.pm2_5 !== undefined && (
            <View style={styles.statItem}>
              <Ionicons name="leaf" size={14} color="#22c55e" />
              <Text style={[styles.statText, { color: theme.textSecondary }]}>
                PM2.5: {bus.pm2_5?.toFixed(1) || '--'}
              </Text>
            </View>
          )}
          {/* Always show passengers from API */}
          <View style={styles.statItem}>
            <Ionicons name="people" size={14} color="#8b5cf6" />
            <Text style={[styles.statText, { color: theme.textSecondary }]}>
              Passengers: {passengerCount}/33
            </Text>
          </View>
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={[styles.title, { color: theme.text }]}>{t('routes')}</Text>
        {debugMode && (
          <View style={styles.headerButtons}>
            <TouchableOpacity
              style={styles.headerBtn}
              onPress={() => navigation.navigate('RouteEditor')}
            >
              <Ionicons name="add-circle" size={28} color={theme.primary} />
            </TouchableOpacity>
          </View>
        )}
      </View>

      {/* Bus count */}
      <View style={[styles.countBanner, { backgroundColor: theme.surface }]}>
        <Ionicons name="bus" size={20} color={theme.primary} />
        <Text style={[styles.countText, { color: theme.textSecondary }]}>
          {buses.length} active {buses.length === 1 ? 'bus' : 'buses'}
        </Text>
      </View>

      {/* Bus list */}
      {buses.length === 0 ? (
        <View style={styles.emptyState}>
          <Ionicons name="bus-outline" size={64} color={theme.textMuted} />
          <Text style={[styles.emptyTitle, { color: theme.textSecondary }]}>
            No active buses
          </Text>
          <Text style={[styles.emptySubtitle, { color: theme.textMuted }]}>
            Buses will appear here when they're online
          </Text>
          <TouchableOpacity
            style={[styles.refreshBtn, { borderColor: theme.primary }]}
            onPress={onRefresh}
          >
            <Ionicons name="refresh" size={20} color={theme.primary} />
            <Text style={[styles.refreshText, { color: theme.primary }]}>Refresh</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={buses}
          renderItem={renderBusCard}
          keyExtractor={(item) => item.bus_mac || item.mac_address || item.id}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              colors={[theme.primary]}
              tintColor={theme.primary}
            />
          }
        />
      )}

      {/* Debug mode: Route management section */}
      {debugMode && localRoutes.length > 0 && (
        <View style={[styles.debugSection, { backgroundColor: theme.surface }]}>
          <Text style={[styles.debugTitle, { color: theme.textSecondary }]}>
            📁 Saved Routes ({localRoutes.length})
          </Text>
          <FlatList
            data={localRoutes}
            horizontal
            showsHorizontalScrollIndicator={false}
            keyExtractor={(item) => item.routeId}
            renderItem={({ item }) => (
              <TouchableOpacity
                style={[styles.routeChip, { backgroundColor: theme.card, borderColor: theme.border }]}
                onPress={() => navigation.navigate('RouteEditor', { routeId: item.routeId })}
              >
                <Text style={[styles.routeChipText, { color: theme.text }]}>
                  {item.routeName}
                </Text>
              </TouchableOpacity>
            )}
          />
        </View>
      )}
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 15,
  },
  title: { fontSize: 28, fontWeight: 'bold' },
  headerButtons: { flexDirection: 'row', alignItems: 'center', gap: 15 },
  headerBtn: { padding: 4 },
  countBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 20,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 10,
    marginBottom: 12,
    gap: 8,
  },
  countText: { fontSize: 14 },
  listContent: { paddingHorizontal: 20, paddingBottom: 20 },
  busCard: {
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
  },
  busHeader: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  busIconContainer: {
    width: 48,
    height: 48,
    borderRadius: 12,
    backgroundColor: 'rgba(37, 99, 235, 0.1)',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  busInfo: { flex: 1 },
  busName: { fontSize: 18, fontWeight: '600' },
  routeName: { fontSize: 14, marginTop: 2 },
  noRoute: { fontSize: 13, fontStyle: 'italic', marginTop: 2 },
  nextStopContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
  },
  nextStopRow: { flexDirection: 'row', alignItems: 'center', flex: 1, gap: 6 },
  nextStopLabel: { fontSize: 13 },
  nextStopName: { fontSize: 14, fontWeight: '600', flex: 1 },
  etaBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  etaText: { color: '#fff', fontSize: 12, fontWeight: '600' },
  statsRow: {
    flexDirection: 'row',
    marginTop: 12,
    gap: 16,
  },
  statItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  statText: { fontSize: 13 },
  emptyState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 40,
  },
  emptyTitle: { fontSize: 20, fontWeight: '600', marginTop: 16 },
  emptySubtitle: { fontSize: 14, textAlign: 'center', marginTop: 8 },
  refreshBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 24,
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
  },
  refreshText: { fontSize: 14, fontWeight: '600' },
  debugSection: {
    padding: 16,
    marginTop: 'auto',
  },
  debugTitle: { fontSize: 13, fontWeight: '600', marginBottom: 10 },
  routeChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    marginRight: 8,
    borderWidth: 1,
  },
  routeChipText: { fontSize: 13 },
});

export default RoutesScreen;