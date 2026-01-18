import React, { useRef, useEffect, useState, useImperativeHandle, forwardRef } from 'react';
import { StyleSheet, Image, Animated, Easing, View, TouchableOpacity, Text, Platform } from 'react-native';
import axios from 'axios';
import { getApiUrl, getApiHeaders } from '../config/api';
import { getAirQualityStatus } from '../utils/airQuality';
import { whiteMapStyle, darkMapStyle } from '../utils/mapStyles';
import { useTheme } from '../contexts/ThemeContext';

// Dynamic import for maps - will be null if import fails
let MapViewComponent = null;
let MarkerComponent = null;
let CircleComponent = null;
let PolylineComponent = null;
let PolygonComponent = null;

// Try to load maps (will fail gracefully if not available)
if (Platform.OS !== 'web') {
    try {
        const Maps = require('react-native-maps');
        MapViewComponent = Maps.default;
        MarkerComponent = Maps.Marker;
        CircleComponent = Maps.Circle;
        PolylineComponent = Maps.Polyline;
        PolygonComponent = Maps.Polygon;
    } catch (e) {
        console.log('react-native-maps not available:', e.message);
    }
}

const busIcon = require('../assets/W-bus-icon.png');

// Animated Marker Component
const AnimatedMapMarker = ({ bus, airQualityColor, destination }) => {
    // Prediction/Animation logic removed to simplify and fix displacement issues
    // Just using snapped coordinates for best grid alignment

    if (!MarkerComponent) return null;

    const snap = (coord) => Math.floor(coord / 0.001) * 0.001 + 0.0005;
    const snappedLat = snap(bus.current_lat);
    const snappedLon = snap(bus.current_lon);

    return (
        <MarkerComponent
            coordinate={{ latitude: snappedLat, longitude: snappedLon }}
            anchor={{ x: 0.5, y: 0.5 }}
            tracksViewChanges={false}
            zIndex={100}
        >
            <View>
                <Image
                    source={busIcon}
                    style={{
                        width: 32,
                        height: 32,
                        tintColor: bus.bus_mac === "FAKE-PM-BUS" ? '#ef4444' : undefined
                    }}
                    resizeMode="contain"
                />
            </View>
        </MarkerComponent>
    );
};

const AirQualityMap = forwardRef(({
    buses,
    userLocation,
    destinationMarkers,
    onLongPress,
    timeRange,
    onTimeRangeChange,
    fakeBusPos,
    onDragFakeBus
}, ref) => {
    const mapRef = useRef(null);
    const lastFetchRef = useRef(0);
    const { isDark } = useTheme();
    const mapStyle = isDark ? darkMapStyle : whiteMapStyle;

    const [heatmapData, setHeatmapData] = useState([]);
    const [liveGrid, setLiveGrid] = useState({});
    const [mapRegion, setMapRegion] = useState({
        latitude: 14.8820,
        longitude: 102.0207,
        latitudeDelta: 0.02,
        longitudeDelta: 0.02,
    });

    const [isExpanded, setIsExpanded] = useState(false);
    const expansionAnim = useRef(new Animated.Value(0)).current;

    useImperativeHandle(ref, () => ({
        refreshHeatmap: (force = false) => {
            const now = Date.now();
            if (force || now - lastFetchRef.current > 200) {
                lastFetchRef.current = now;
                fetchHeatmap();
            }
        },
        animateToRegion: (region) => {
            mapRef.current?.animateToRegion(region);
        },
        fitToCoordinates: (coords, options) => {
            mapRef.current?.fitToCoordinates(coords, options);
        }
    }));

    const toggleExpand = () => {
        const toValue = isExpanded ? 0 : 1;
        setIsExpanded(!isExpanded);
        Animated.spring(expansionAnim, {
            toValue,
            friction: 8,
            tension: 40,
            useNativeDriver: false,
        }).start();
    };

    const handleSelectRange = (range) => {
        onTimeRangeChange(range);
        toggleExpand();
    };

    const fetchHeatmap = async (range = timeRange) => {
        try {
            const url = await getApiUrl();
            const response = await axios.get(`${url}/api/heatmap?limit=10000&range=${range}&mode=grid&grid_size=0.001`, {
                headers: getApiHeaders()
            });
            setHeatmapData(response.data);
        } catch (e) {
            console.log('Error fetching PM grid:', e);
        }
    };

    useEffect(() => {
        fetchHeatmap();
        const interval = setInterval(() => fetchHeatmap(timeRange), 60000);
        return () => clearInterval(interval);
    }, [timeRange]);

    useEffect(() => {
        if (buses && buses.length > 0) {
            setLiveGrid(prev => {
                const next = { ...prev };
                const grid_size = 0.001;
                buses.forEach(bus => {
                    if (bus.current_lat && bus.current_lon && bus.pm2_5 !== undefined) {
                        const snap = (val) => Math.floor(val / grid_size) * grid_size + (grid_size / 2);
                        const lat = snap(bus.current_lat);
                        const lon = snap(bus.current_lon);
                        const key = `${lat.toFixed(6)},${lon.toFixed(6)}`;
                        if (!next[key]) {
                            next[key] = { latitude: lat, longitude: lon, avg_pm2_5: bus.pm2_5, count: 1 };
                        } else {
                            const newCount = next[key].count + 1;
                            next[key].avg_pm2_5 = (next[key].avg_pm2_5 * next[key].count + bus.pm2_5) / newCount;
                            next[key].count = newCount;
                        }
                    }
                });
                return next;
            });
        }
    }, [buses]);

    const displayData = React.useMemo(() => {
        const gridMap = new Map();
        heatmapData.forEach(cell => {
            const key = `${cell.latitude.toFixed(6)},${cell.longitude.toFixed(6)}`;
            gridMap.set(key, cell);
        });
        Object.entries(liveGrid).forEach(([key, cell]) => {
            const existing = gridMap.get(key);
            if (existing) {
                const totalCount = existing.count + cell.count;
                const avgPM = (existing.avg_pm2_5 * existing.count + cell.avg_pm2_5 * cell.count) / totalCount;
                gridMap.set(key, { ...existing, avg_pm2_5: avgPM, count: totalCount });
            } else {
                gridMap.set(key, cell);
            }
        });

        const clusters = [];
        const visited = new Set();
        const cells = Array.from(gridMap.values());
        const grid_size = 0.001;

        for (const cell of cells) {
            const key = `${cell.latitude.toFixed(6)},${cell.longitude.toFixed(6)}`;
            if (!visited.has(key)) {
                const cluster = [];
                const queue = [cell];
                visited.add(key);
                while (queue.length > 0) {
                    const current = queue.shift();
                    cluster.push(current);
                    [{ l: 1, o: 0 }, { l: -1, o: 0 }, { l: 0, o: 1 }, { l: 0, o: -1 }].forEach(off => {
                        const nLat = current.latitude + (off.l * grid_size);
                        const nLon = current.longitude + (off.o * grid_size);
                        const nKey = `${nLat.toFixed(6)},${nLon.toFixed(6)}`;
                        const neighbor = gridMap.get(nKey);
                        if (neighbor && !visited.has(nKey) && Math.abs((Number(neighbor.avg_pm2_5) || 0) - (Number(current.avg_pm2_5) || 0)) <= 10) {
                            visited.add(nKey);
                            queue.push(neighbor);
                        }
                    });
                }
                clusters.push(cluster);
            }
        }

        const finalCells = [];
        clusters.forEach(cluster => {
            const clusterAvg = cluster.reduce((sum, c) => sum + (Number(c.avg_pm2_5) || 0), 0) / (cluster.length || 1);
            cluster.forEach(cell => {
                finalCells.push({ ...cell, display_pm2_5: clusterAvg || 0 });
            });
        });
        return finalCells;
    }, [heatmapData, liveGrid]);

    const getPMColor = (pm25) => {
        const opacity = 'B3';
        if (pm25 <= 25) return `#22c55e${opacity}`;
        if (pm25 <= 50) return `#eab308${opacity}`;
        return `#ef4444${opacity}`;
    };

    const SUT_COORDINATES = {
        latitude: 14.8820,
        longitude: 102.0207,
        latitudeDelta: 0.02,
        longitudeDelta: 0.02,
    };

    if (!MapViewComponent) {
        return (
            <View style={styles.fallbackContainer}>
                <Text style={{ fontSize: 48, marginBottom: 10 }}>🗺️</Text>
                <Text style={{ fontSize: 18, fontWeight: 'bold', color: '#666' }}>Map Unavailable</Text>
                <Text style={{ fontSize: 12, color: '#999', textAlign: 'center', marginTop: 8 }}>
                    Air quality features are currently optimized for mobile.
                </Text>
            </View>
        );
    }

    return (
        <View style={styles.container}>
            <MapViewComponent
                ref={mapRef}
                style={styles.map}
                initialRegion={SUT_COORDINATES}
                onLongPress={onLongPress}
                onRegionChangeComplete={setMapRegion}
                customMapStyle={mapStyle}
                userInterfaceStyle={isDark ? 'dark' : 'light'}
            >
                {buses.map((bus) => (
                    bus.current_lat && bus.current_lon && (
                        <AnimatedMapMarker
                            key={bus.mac_address}
                            bus={bus}
                            airQualityColor={getAirQualityStatus(bus.pm2_5).color}
                            destination={destinationMarkers[bus.mac_address]}
                        />
                    )
                ))}

                {PolylineComponent && MarkerComponent && Object.entries(destinationMarkers).map(([busId, dest]) => {
                    const bus = buses.find(b => b.mac_address === busId);
                    if (!bus || !bus.current_lat) return null;
                    return (
                        <React.Fragment key={`path-${busId}`}>
                            <PolylineComponent
                                coordinates={[{ latitude: bus.current_lat, longitude: bus.current_lon }, dest]}
                                strokeColor="#F57C00"
                                strokeWidth={4}
                                lineDashPattern={[10, 5]}
                            />
                            <MarkerComponent
                                coordinate={dest}
                                title="Destination"
                                pinColor="blue"
                            />
                        </React.Fragment>
                    );
                })}

                {userLocation && MarkerComponent && (
                    <MarkerComponent coordinate={userLocation} title="Your Location" pinColor="blue" zIndex={999} />
                )}

                {fakeBusPos && MarkerComponent && (
                    <MarkerComponent coordinate={fakeBusPos} draggable onDrag={onDragFakeBus} onDragEnd={onDragFakeBus} anchor={{ x: 0.5, y: 0.5 }} zIndex={1001}>
                        <Image source={busIcon} style={styles.fakeBusIcon} resizeMode="contain" />
                    </MarkerComponent>
                )}

                {PolygonComponent && MarkerComponent && displayData.map((cell) => {
                    const showLabels = mapRegion.latitudeDelta < 0.02;
                    const half = 0.0005;
                    const squareCoords = [
                        { latitude: cell.latitude + half, longitude: cell.longitude - half },
                        { latitude: cell.latitude + half, longitude: cell.longitude + half },
                        { latitude: cell.latitude - half, longitude: cell.longitude + half },
                        { latitude: cell.latitude - half, longitude: cell.longitude - half },
                    ];

                    return (
                        <React.Fragment key={`grid-${cell.latitude}-${cell.longitude}`}>
                            <PolygonComponent
                                coordinates={squareCoords}
                                fillColor={getPMColor(cell.display_pm2_5)}
                                strokeColor="transparent"
                                zIndex={1}
                            />
                            {showLabels && (
                                <MarkerComponent coordinate={{ latitude: cell.latitude, longitude: cell.longitude }} anchor={{ x: 0.5, y: 0.5 }} flat={true}>
                                    <View style={styles.pmLabelContainer}>
                                        <Text style={styles.pmLabelText}>{Math.round(cell.display_pm2_5)}</Text>
                                    </View>
                                </MarkerComponent>
                            )}
                        </React.Fragment>
                    );
                })}
            </MapViewComponent>

            <View style={styles.fabContainer}>
                <Animated.View style={[styles.fabOptionsContainer, {
                    opacity: expansionAnim,
                    transform: [{ translateX: expansionAnim.interpolate({ inputRange: [0, 1], outputRange: [250, 0] }) }]
                }]}>
                    <View style={styles.fabOptionsList}>
                        {['now', '1h', '1d', '1w', '3m', 'all'].map((range) => (
                            <TouchableOpacity key={range} style={[styles.fabOptionBtn, timeRange === range && styles.fabOptionBtnActive]} onPress={() => handleSelectRange(range)}>
                                <Text style={[styles.fabOptionText, timeRange === range && styles.fabOptionTextActive]}>{range.toUpperCase()}</Text>
                            </TouchableOpacity>
                        ))}
                    </View>
                </Animated.View>

                <TouchableOpacity style={styles.mainFab} onPress={toggleExpand} activeOpacity={0.8}>
                    <View style={styles.mainFabContent}>
                        <Text style={styles.mainFabText}>{timeRange.toUpperCase()}</Text>
                    </View>
                </TouchableOpacity>
            </View>
        </View>
    );
});

const styles = StyleSheet.create({
    container: { flex: 1, position: 'relative' },
    map: { flex: 1 },
    fallbackContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#e8f4f8' },
    pmLabelContainer: { backgroundColor: 'rgba(255, 255, 255, 0.4)', borderRadius: 4, paddingHorizontal: 2, alignItems: 'center', justifyContent: 'center' },
    pmLabelText: { fontSize: 11, fontWeight: '900', color: '#000', textShadowColor: '#fff', textShadowOffset: { width: 1, height: 1 }, textShadowRadius: 1, textAlign: 'center' },
    fabContainer: { position: 'absolute', bottom: 25, right: 20, flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end' },
    mainFab: { width: 50, height: 50, borderRadius: 25, backgroundColor: '#FFF', justifyContent: 'center', alignItems: 'center', elevation: 8, shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 4.65, zIndex: 10, borderWidth: 1, borderColor: 'rgba(0,0,0,0.05)' },
    mainFabContent: { alignItems: 'center' },
    mainFabText: { color: '#2196F3', fontSize: 14, fontWeight: 'bold' },
    fabOptionsContainer: { backgroundColor: 'rgba(255, 255, 255, 0.95)', borderRadius: 30, marginRight: -30, paddingRight: 40, paddingLeft: 15, paddingVertical: 8, elevation: 6, shadowColor: '#000', shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.27, shadowRadius: 4.65 },
    fabOptionsList: { flexDirection: 'row', alignItems: 'center' },
    fabOptionBtn: { paddingVertical: 8, paddingHorizontal: 10, borderRadius: 20, marginHorizontal: 2 },
    fabOptionBtnActive: { backgroundColor: '#E3F2FD' },
    fabOptionText: { fontSize: 11, fontWeight: 'bold', color: '#666' },
    fabOptionTextActive: { color: '#2196F3' },
    fakeBusIcon: { width: 50, height: 50, tintColor: '#ef4444', borderWidth: 2, borderColor: 'white', borderRadius: 25 }
});

export default AirQualityMap;
