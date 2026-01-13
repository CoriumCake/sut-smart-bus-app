import React, { useState, useEffect, useRef } from 'react';
import {
    View,
    Text,
    StyleSheet,
    ScrollView,
    TouchableOpacity,
    ActivityIndicator,
    Dimensions,
    RefreshControl,
    Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import axios from 'axios';
import { getApiUrl, getApiHeaders } from '../config/api';
import { useTheme } from '../contexts/ThemeContext';
import { getAirQualityStatus } from '../utils/airQuality';
import { MQTT_CONFIG, getConnectionMode } from '../config/api';
import { useServerConfig } from '../hooks/useServerConfig';
import * as mqtt from 'mqtt';

const { width: screenWidth } = Dimensions.get('window');

// Dynamic import for react-native-maps
let MapView, Circle, Heatmap;

const AirQualityDashboardScreen = ({ route }) => {
    const navigation = useNavigation();
    const { theme, isDark } = useTheme();
    const { serverIp } = useServerConfig();
    const mapRef = useRef(null);

    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [error, setError] = useState(null);

    // Data states
    const [zones, setZones] = useState([]);
    const [trends, setTrends] = useState([]);
    const [stats, setStats] = useState(null);
    const [timeRange, setTimeRange] = useState(0); // 0 = Now, others = Hours

    // Get passed bus data
    const initialBuses = route.params?.buses || [];
    const [selectedBus, setSelectedBus] = useState(null); // null = All Buses
    const [liveBusData, setLiveBusData] = useState(null); // Data for the "Now" view

    // MQTT Connection for Real-time Updates
    useEffect(() => {
        let client;

        const connectMqtt = async () => {
            // Only connect if we are in "Now" mode (timeRange === 0)
            if (timeRange !== 0 || Platform.OS === 'web') return;

            try {
                const isTunnelMode = getConnectionMode() === 'tunnel';
                let mqttUrl;

                if (isTunnelMode && MQTT_CONFIG.wsUrl) {
                    mqttUrl = MQTT_CONFIG.wsUrl;
                } else if (serverIp) {
                    mqttUrl = `ws://${serverIp}:${MQTT_CONFIG.wsPort || 9001}`;
                } else {
                    return;
                }

                client = mqtt.connect(mqttUrl);

                client.on('connect', () => {
                    client.subscribe('sut/app/bus/location');
                    client.subscribe('sut/bus/gps/fast');
                });

                client.on('message', (topic, message) => {
                    try {
                        const data = JSON.parse(message.toString());
                        // Check if this message is for our current selected/live bus
                        if (timeRange === 0) {
                            const targetMac = selectedBus ? (selectedBus.bus_mac || selectedBus.mac_address) : data.bus_mac;

                            if (data.bus_mac === targetMac) {
                                setLiveBusData(prev => ({
                                    ...prev,
                                    // Defensive updates
                                    pm2_5: (data.pm2_5 !== undefined && data.pm2_5 !== null) ? data.pm2_5 : (prev?.pm2_5),
                                    pm10: (data.pm10 !== undefined && data.pm10 !== null) ? data.pm10 : (prev?.pm10),
                                    temp: (data.temp !== undefined && data.temp !== null) ? data.temp : (prev?.temp),
                                    hum: (data.hum !== undefined && data.hum !== null) ? data.hum : (prev?.hum),
                                    // Always update location/name
                                    bus_mac: data.bus_mac,
                                    bus_name: data.bus_name || prev?.bus_name || 'Bus',
                                }));
                            }
                        }
                    } catch (e) {
                        console.error('[Dashboard] MQTT Parse Error', e);
                    }
                });

            } catch (e) {
                console.error('[Dashboard] MQTT Error', e);
            }
        };

        connectMqtt();

        return () => {
            if (client) client.end();
        };
    }, [timeRange, serverIp, selectedBus]);

    // Load map components
    useEffect(() => {
        if (Platform.OS !== 'web') {
            import('react-native-maps').then((maps) => {
                MapView = maps.default;
                Circle = maps.Circle;
            }).catch(console.error);
        }
    }, []);

    // Fetch analytics data
    const fetchData = async () => {
        try {
            setError(null);
            const apiUrl = await getApiUrl();
            const headers = getApiHeaders();

            const queryParams = `?hours=${timeRange === 0 ? 24 : timeRange}${selectedBus ? `&bus_mac=${selectedBus.bus_mac || selectedBus.mac_address}` : ''}`;

            const requests = [
                axios.get(`${apiUrl}/api/analytics/zones${queryParams}`, { headers, timeout: 10000 }),
                axios.get(`${apiUrl}/api/analytics/stats${queryParams}`, { headers, timeout: 10000 }),
            ];

            // Only fetch trends if not in "Now" mode
            requests.push(axios.get(`${apiUrl}/api/analytics/trends${queryParams}&interval=60`, { headers, timeout: 10000 }));

            const [zonesRes, statsRes, trendsRes] = await Promise.all(requests);

            setZones(zonesRes.data.zones || []);
            setStats(statsRes.data.stats || null);
            if (trendsRes) setTrends(trendsRes.data.series || []);
        } catch (err) {
            console.error('Error fetching analytics:', err.message);
            setError('Could not load analytics data. Make sure the server is running.');
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    };

    useEffect(() => {
        fetchData();
        // Reset live data when changing bus
        if (selectedBus) {
            setLiveBusData({ ...selectedBus, pm2_5: selectedBus.pm2_5 ?? 0, temp: selectedBus.temp ?? 0, hum: selectedBus.hum ?? 0 });
        } else {
            setLiveBusData(null);
        }
    }, [timeRange, selectedBus]);

    const onRefresh = () => {
        setRefreshing(true);
        fetchData();
    };

    // Get color for PM2.5 value
    const getPM25Color = (pm25, opacity = 1) => {
        if (pm25 <= 12) return `rgba(76, 175, 80, ${opacity})`; // Good - Green
        if (pm25 <= 35.4) return `rgba(255, 235, 59, ${opacity})`; // Moderate - Yellow
        if (pm25 <= 55.4) return `rgba(255, 152, 0, ${opacity})`; // Unhealthy for Sensitive - Orange
        if (pm25 <= 150.4) return `rgba(244, 67, 54, ${opacity})`; // Unhealthy - Red
        if (pm25 <= 250.4) return `rgba(156, 39, 176, ${opacity})`; // Very Unhealthy - Purple
        return `rgba(139, 69, 19, ${opacity})`; // Hazardous - Brown
    };

    // Render stats cards
    const renderStatsCards = () => {
        if (!stats) return null;

        const { status: avgStatus, solidColor: avgColor } = getAirQualityStatus(stats.avg_pm25);

        return (
            <View style={styles.statsContainer}>
                <Text style={[styles.sectionTitle, { color: theme.text }]}>
                    📊 Air Quality Summary ({timeRange}h)
                </Text>

                <View style={styles.statsGrid}>
                    <View style={[styles.statCard, { backgroundColor: theme.card }]}>
                        <Text style={[styles.statLabel, { color: theme.textSecondary }]}>Avg PM2.5</Text>
                        <Text style={[styles.statValue, { color: avgColor }]}>{stats.avg_pm25 || '--'}</Text>
                        <Text style={[styles.statUnit, { color: theme.textMuted }]}>µg/m³</Text>
                        <View style={[styles.statusBadge, { backgroundColor: avgColor }]}>
                            <Text style={styles.statusText}>{avgStatus}</Text>
                        </View>
                    </View>

                    <View style={[styles.statCard, { backgroundColor: theme.card }]}>
                        <Text style={[styles.statLabel, { color: theme.textSecondary }]}>Avg PM10</Text>
                        <Text style={[styles.statValue, { color: theme.primary }]}>{stats.avg_pm10 || '--'}</Text>
                        <Text style={[styles.statUnit, { color: theme.textMuted }]}>µg/m³</Text>
                    </View>

                    <View style={[styles.statCard, { backgroundColor: theme.card }]}>
                        <Text style={[styles.statLabel, { color: theme.textSecondary }]}>Readings</Text>
                        <Text style={[styles.statValue, { color: theme.text }]}>{stats.total_readings || 0}</Text>
                        <Text style={[styles.statUnit, { color: theme.textMuted }]}>data points</Text>
                    </View>

                    <View style={[styles.statCard, { backgroundColor: theme.card }]}>
                        <Text style={[styles.statLabel, { color: theme.textSecondary }]}>Avg Temp</Text>
                        <Text style={[styles.statValue, { color: theme.text }]}>{stats.avg_temp || '--'}°C</Text>
                        <Text style={[styles.statUnit, { color: theme.textMuted }]}>Humidity: {stats.avg_hum || '--'}%</Text>
                    </View>
                </View>
            </View>
        );
    };

    // Render zone heatmap
    const renderHeatmap = () => {
        if (zones.length === 0) {
            return (
                <View style={[styles.emptyCard, { backgroundColor: theme.card }]}>
                    <Ionicons name="map-outline" size={48} color={theme.textMuted} />
                    <Text style={[styles.emptyText, { color: theme.textSecondary }]}>
                        No zone data available
                    </Text>
                    <Text style={[styles.emptySubtext, { color: theme.textMuted }]}>
                        Collect more air quality data to see the heatmap
                    </Text>
                </View>
            );
        }

        if (Platform.OS === 'web' || !MapView) {
            return (
                <View style={[styles.mapPlaceholder, { backgroundColor: theme.card }]}>
                    <Text style={[styles.emptyText, { color: theme.textSecondary }]}>
                        Map not available on web
                    </Text>
                </View>
            );
        }

        // Calculate map region from zones
        const lats = zones.map(z => z.lat);
        const lons = zones.map(z => z.lon);
        const centerLat = (Math.min(...lats) + Math.max(...lats)) / 2;
        const centerLon = (Math.min(...lons) + Math.max(...lons)) / 2;
        const latDelta = Math.max(0.01, Math.max(...lats) - Math.min(...lats) + 0.005);
        const lonDelta = Math.max(0.01, Math.max(...lons) - Math.min(...lons) + 0.005);

        return (
            <View style={styles.mapContainer}>
                <Text style={[styles.sectionTitle, { color: theme.text }]}>
                    🗺️ Air Quality Zones
                </Text>
                <MapView
                    ref={mapRef}
                    style={styles.map}
                    initialRegion={{
                        latitude: centerLat || 14.882,
                        longitude: centerLon || 102.021,
                        latitudeDelta: latDelta,
                        longitudeDelta: lonDelta,
                    }}
                >
                    {zones.map((zone, index) => (
                        <Circle
                            key={`zone-${index}`}
                            center={{ latitude: zone.lat, longitude: zone.lon }}
                            radius={60}
                            fillColor={getPM25Color(zone.avg_pm25, 0.5)}
                            strokeColor={getPM25Color(zone.avg_pm25, 0.8)}
                            strokeWidth={2}
                        />
                    ))}
                </MapView>
            </View>
        );
    };

    // Render zone ranking
    const renderZoneRanking = () => {
        if (zones.length === 0) return null;

        // Sort by air quality (best first)
        const sortedZones = [...zones].sort((a, b) => a.avg_pm25 - b.avg_pm25);
        const topZones = sortedZones.slice(0, 5);
        const worstZones = sortedZones.slice(-5).reverse();

        return (
            <View style={styles.rankingContainer}>
                <Text style={[styles.sectionTitle, { color: theme.text }]}>
                    🏆 Zone Rankings
                </Text>

                <View style={styles.rankingRow}>
                    <View style={[styles.rankingCard, { backgroundColor: theme.card }]}>
                        <Text style={[styles.rankingTitle, { color: '#4caf50' }]}>
                            ✅ Best Air Quality
                        </Text>
                        {topZones.map((zone, i) => (
                            <View key={`best-${i}`} style={styles.rankingItem}>
                                <Text style={[styles.rankNumber, { color: theme.textSecondary }]}>#{i + 1}</Text>
                                <View style={styles.rankingInfo}>
                                    <Text style={[styles.rankPM, { color: theme.text }]}>
                                        PM2.5: {zone.avg_pm25}
                                    </Text>
                                    <Text style={[styles.rankReadings, { color: theme.textMuted }]}>
                                        {zone.count} readings
                                    </Text>
                                </View>
                            </View>
                        ))}
                    </View>

                    <View style={[styles.rankingCard, { backgroundColor: theme.card }]}>
                        <Text style={[styles.rankingTitle, { color: '#f44336' }]}>
                            ⚠️ Needs Attention
                        </Text>
                        {worstZones.map((zone, i) => (
                            <View key={`worst-${i}`} style={styles.rankingItem}>
                                <Text style={[styles.rankNumber, { color: theme.textSecondary }]}>#{i + 1}</Text>
                                <View style={styles.rankingInfo}>
                                    <Text style={[styles.rankPM, { color: theme.text }]}>
                                        PM2.5: {zone.avg_pm25}
                                    </Text>
                                    <Text style={[styles.rankReadings, { color: theme.textMuted }]}>
                                        {zone.count} readings
                                    </Text>
                                </View>
                            </View>
                        ))}
                    </View>
                </View>
            </View>
        );
    };

    // Render simple trend visualization (text-based, no chart library dependency)
    const renderTrends = () => {
        if (trends.length === 0) {
            return (
                <View style={[styles.emptyCard, { backgroundColor: theme.card }]}>
                    <Ionicons name="analytics-outline" size={48} color={theme.textMuted} />
                    <Text style={[styles.emptyText, { color: theme.textSecondary }]}>
                        No trend data available
                    </Text>
                </View>
            );
        }

        // Get min/max for scaling
        const pm25Values = trends.map(t => t.avg_pm25 || 0);
        const maxPM = Math.max(...pm25Values, 1);
        const minPM = Math.min(...pm25Values);

        return (
            <View style={styles.trendsContainer}>
                <Text style={[styles.sectionTitle, { color: theme.text }]}>
                    📈 PM2.5 Trend ({timeRange}h)
                </Text>

                <View style={[styles.trendChart, { backgroundColor: theme.card }]}>
                    <View style={styles.barContainer}>
                        {trends.slice(-24).map((point, index) => {
                            const height = ((point.avg_pm25 || 0) / maxPM) * 80;
                            const color = getPM25Color(point.avg_pm25 || 0, 0.8);

                            return (
                                <View key={index} style={styles.barWrapper}>
                                    <View
                                        style={[
                                            styles.bar,
                                            { height: Math.max(4, height), backgroundColor: color }
                                        ]}
                                    />
                                </View>
                            );
                        })}
                    </View>
                    <View style={styles.trendLabels}>
                        <Text style={[styles.trendLabel, { color: theme.textMuted }]}>
                            Min: {minPM.toFixed(1)}
                        </Text>
                        <Text style={[styles.trendLabel, { color: theme.textMuted }]}>
                            Max: {maxPM.toFixed(1)}
                        </Text>
                    </View>
                </View>
            </View>
        );
    };

    // Time range selector
    const renderTimeSelector = () => (
        <View style={styles.timeSelector}>
            {[0, 6, 12, 24].map((value) => (
                <TouchableOpacity
                    key={value}
                    style={[
                        styles.timeButton,
                        { backgroundColor: timeRange === value ? theme.primary : theme.card }
                    ]}
                    onPress={() => setTimeRange(value)}
                >
                    <Text
                        style={[
                            styles.timeButtonText,
                            { color: timeRange === value ? '#fff' : theme.text }
                        ]}
                    >
                        {value === 0 ? 'Now' : `${value}h`}
                    </Text>
                </TouchableOpacity>
            ))}
        </View>
    );

    // Render Current Status ("Now" view)
    const renderCurrentStatus = () => {
        // Use live data if available, otherwise fallback to selected bus or first available bus
        const displayData = liveBusData || selectedBus || (initialBuses.length > 0 ? initialBuses[0] : null);

        if (!displayData) {
            return (
                <View style={[styles.emptyCard, { backgroundColor: theme.card }]}>
                    <Text style={[styles.emptyText, { color: theme.textSecondary }]}>No live bus data</Text>
                </View>
            );
        }

        const { status, color } = getAirQualityStatus(displayData.pm2_5 !== undefined ? displayData.pm2_5 : 0);

        return (
            <View style={styles.currentStatusContainer}>
                <Text style={[styles.sectionTitle, { color: theme.text }]}>📍 Live Status: {displayData.bus_name || 'Bus'}</Text>

                <View style={[styles.mainStatusCard, { backgroundColor: color }]}>
                    <Text style={styles.mainStatusLabel}>PM 2.5</Text>
                    <Text style={styles.mainStatusValue}>{displayData.pm2_5 !== undefined && displayData.pm2_5 !== null ? displayData.pm2_5 : '--'}</Text>
                    <Text style={styles.mainStatusUnit}>µg/m³</Text>
                    <Text style={styles.mainStatusText}>{status}</Text>
                </View>

                <View style={styles.gridContainer}>
                    <View style={[styles.gridItem, { backgroundColor: theme.card }]}>
                        <Ionicons name="thermometer-outline" size={24} color={theme.primary} />
                        <Text style={[styles.gridValue, { color: theme.text }]}>{displayData.temp !== null && displayData.temp !== undefined ? displayData.temp : '--'}°C</Text>
                        <Text style={[styles.gridLabel, { color: theme.textSecondary }]}>Temperature</Text>
                    </View>
                    <View style={[styles.gridItem, { backgroundColor: theme.card }]}>
                        <Ionicons name="water-outline" size={24} color={theme.primary} />
                        <Text style={[styles.gridValue, { color: theme.text }]}>{displayData.hum !== null && displayData.hum !== undefined ? displayData.hum : '--'}%</Text>
                        <Text style={[styles.gridLabel, { color: theme.textSecondary }]}>Humidity</Text>
                    </View>
                    <View style={[styles.gridItem, { backgroundColor: theme.card }]}>
                        <Ionicons name="cloud-outline" size={24} color={theme.textSecondary} />
                        <Text style={[styles.gridValue, { color: theme.text }]}>{displayData.pm10 !== null && displayData.pm10 !== undefined ? displayData.pm10 : '--'}</Text>
                        <Text style={[styles.gridLabel, { color: theme.textSecondary }]}>PM 10</Text>
                    </View>
                </View>

                <Text style={[styles.lastUpdate, { color: theme.textMuted }]}>
                    Data passed from live feed
                </Text>
            </View>
        );
    };

    // Render Bus Selector
    const renderBusSelector = () => (
        <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.busSelector}
            contentContainerStyle={styles.busSelectorContent}
        >
            <TouchableOpacity
                style={[
                    styles.busChip,
                    { backgroundColor: !selectedBus ? theme.primary : theme.card, borderColor: theme.border }
                ]}
                onPress={() => setSelectedBus(null)}
            >
                <Text style={[styles.busChipText, { color: !selectedBus ? '#fff' : theme.text }]}>All Buses</Text>
            </TouchableOpacity>

            {initialBuses.map((bus, index) => (
                <TouchableOpacity
                    key={index}
                    style={[
                        styles.busChip,
                        {
                            backgroundColor: (selectedBus && (selectedBus.mac_address === bus.mac_address)) ? theme.primary : theme.card,
                            borderColor: theme.border
                        }
                    ]}
                    onPress={() => setSelectedBus(bus)}
                >
                    <Text style={[
                        styles.busChipText,
                        { color: (selectedBus && (selectedBus.mac_address === bus.mac_address)) ? '#fff' : theme.text }
                    ]}>
                        {bus.bus_name || bus.mac_address.slice(-4)}
                    </Text>
                </TouchableOpacity>
            ))}
        </ScrollView>
    );

    if (loading) {
        return (
            <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]}>
                <View style={styles.loadingContainer}>
                    <ActivityIndicator size="large" color={theme.primary} />
                    <Text style={[styles.loadingText, { color: theme.textSecondary }]}>
                        Loading analytics...
                    </Text>
                </View>
            </SafeAreaView>
        );
    }

    return (
        <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]}>
            {/* Header */}
            <View style={styles.header}>
                <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
                    <Ionicons name="arrow-back" size={24} color={theme.text} />
                </TouchableOpacity>
                <Text style={[styles.title, { color: theme.text }]}>Air Quality Dashboard</Text>
                <TouchableOpacity onPress={onRefresh} style={styles.refreshButton}>
                    <Ionicons name="refresh" size={22} color={theme.primary} />
                </TouchableOpacity>
            </View>

            <ScrollView
                style={styles.scrollView}
                contentContainerStyle={styles.scrollContent}
                refreshControl={
                    <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
                }
            >
                {error && (
                    <View style={[styles.errorCard, { backgroundColor: '#ffebee' }]}>
                        <Ionicons name="warning" size={20} color="#f44336" />
                        <Text style={styles.errorText}>{error}</Text>
                    </View>
                )}

                {renderTimeSelector()}

                {renderBusSelector()}

                {timeRange === 0 ? (
                    renderCurrentStatus()
                ) : (
                    <>
                        {renderStatsCards()}
                        {renderHeatmap()}
                        {renderZoneRanking()}
                        {renderTrends()}
                    </>
                )}
            </ScrollView>
        </SafeAreaView>
    );
};

const styles = StyleSheet.create({
    container: { flex: 1 },
    loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
    loadingText: { marginTop: 12, fontSize: 16 },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 16,
        paddingVertical: 12,
        borderBottomWidth: 1,
        borderBottomColor: 'rgba(0,0,0,0.1)',
    },
    backButton: { padding: 8 },
    title: { flex: 1, fontSize: 20, fontWeight: 'bold', marginLeft: 8 },
    refreshButton: { padding: 8 },
    scrollView: { flex: 1 },
    scrollContent: { padding: 16, paddingBottom: 32 },
    errorCard: {
        flexDirection: 'row',
        alignItems: 'center',
        padding: 12,
        borderRadius: 8,
        marginBottom: 16,
        gap: 8,
    },
    errorText: { color: '#f44336', flex: 1 },
    timeSelector: {
        flexDirection: 'row',
        justifyContent: 'center',
        gap: 8,
        marginBottom: 20,
    },
    timeButton: {
        paddingHorizontal: 20,
        paddingVertical: 10,
        borderRadius: 20,
    },
    timeButtonText: { fontWeight: '600' },
    sectionTitle: { fontSize: 18, fontWeight: 'bold', marginBottom: 12 },
    statsContainer: { marginBottom: 24 },
    statsGrid: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 12,
    },
    statCard: {
        flex: 1,
        minWidth: (screenWidth - 56) / 2,
        padding: 16,
        borderRadius: 12,
        alignItems: 'center',
    },
    statLabel: { fontSize: 12, marginBottom: 4 },
    statValue: { fontSize: 28, fontWeight: 'bold' },
    statUnit: { fontSize: 11, marginTop: 2 },
    statusBadge: {
        marginTop: 8,
        paddingHorizontal: 10,
        paddingVertical: 4,
        borderRadius: 12,
    },
    statusText: { color: '#fff', fontSize: 11, fontWeight: '600' },
    mapContainer: { marginBottom: 24 },
    map: { height: 250, borderRadius: 12, overflow: 'hidden' },
    mapPlaceholder: { height: 200, borderRadius: 12, justifyContent: 'center', alignItems: 'center' },
    emptyCard: {
        padding: 32,
        borderRadius: 12,
        alignItems: 'center',
        marginBottom: 24,
    },
    emptyText: { fontSize: 16, marginTop: 12 },
    emptySubtext: { fontSize: 13, marginTop: 4, textAlign: 'center' },
    rankingContainer: { marginBottom: 24 },
    rankingRow: { flexDirection: 'row', gap: 12 },
    rankingCard: { flex: 1, padding: 12, borderRadius: 12 },
    rankingTitle: { fontWeight: 'bold', marginBottom: 8 },
    rankingItem: { flexDirection: 'row', alignItems: 'center', marginBottom: 6 },
    rankNumber: { width: 28, fontWeight: 'bold' },
    rankingInfo: { flex: 1 },
    rankPM: { fontSize: 13, fontWeight: '600' },
    rankReadings: { fontSize: 11 },
    trendsContainer: { marginBottom: 24 },
    trendChart: { padding: 16, borderRadius: 12 },
    barContainer: {
        flexDirection: 'row',
        alignItems: 'flex-end',
        height: 100,
        gap: 2,
    },
    barWrapper: { flex: 1, alignItems: 'center', justifyContent: 'flex-end' },
    bar: { width: '80%', borderRadius: 2 },
    trendLabels: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        marginTop: 8,
    },
    trendLabel: { fontSize: 11 },
    currentStatusContainer: { marginBottom: 24 },
    mainStatusCard: {
        padding: 24,
        borderRadius: 20,
        alignItems: 'center',
        marginBottom: 16,
    },
    mainStatusLabel: { color: 'rgba(255,255,255,0.8)', fontSize: 16, marginBottom: 4 },
    mainStatusValue: { color: '#fff', fontSize: 64, fontWeight: 'bold' },
    mainStatusUnit: { color: 'rgba(255,255,255,0.8)', fontSize: 14, marginBottom: 8 },
    mainStatusText: { color: '#fff', fontSize: 24, fontWeight: 'bold' },
    gridContainer: { flexDirection: 'row', gap: 12, marginBottom: 16 },
    gridItem: { flex: 1, padding: 16, borderRadius: 12, alignItems: 'center' },
    gridValue: { fontSize: 18, fontWeight: 'bold', marginVertical: 4 },
    gridLabel: { fontSize: 12 },
    lastUpdate: { textAlign: 'center', fontSize: 12, fontStyle: 'italic' },
    busSelector: { maxHeight: 50, marginBottom: 16 },
    busSelectorContent: { paddingHorizontal: 4, gap: 8 },
    busChip: {
        paddingHorizontal: 16,
        paddingVertical: 8,
        borderRadius: 20,
        borderWidth: 1,
        marginRight: 8,
    },
    busChipText: { fontWeight: '600', fontSize: 13 },
});

export default AirQualityDashboardScreen;
