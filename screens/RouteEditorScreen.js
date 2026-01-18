import React, { useState, useEffect, useRef } from 'react';
import { View, StyleSheet, TouchableOpacity, Text, Alert, Platform, TextInput, ActivityIndicator, Modal, Switch, KeyboardAvoidingView, Dimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Location from 'expo-location';
import { useNavigation, useRoute } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { saveRoute, loadRoute, generateRouteId, syncRouteToServer } from '../utils/routeStorage';
import axios from 'axios';
import AsyncStorage from '@react-native-async-storage/async-storage';

const RouteEditorScreen = () => {
    const navigation = useNavigation();
    const route = useRoute();
    const { routeId } = route.params || {};

    const [MapView, setMapView] = useState(null);
    const [Marker, setMarker] = useState(null);
    const [Polyline, setPolyline] = useState(null);

    const [routeName, setRouteName] = useState('');
    const [waypoints, setWaypoints] = useState([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [userLocation, setUserLocation] = useState(null);
    const [showGrid, setShowGrid] = useState(false); // Grid overlay state
    const [showRoutes, setShowRoutes] = useState(false); // Toggle to show other existing routes

    // Waypoint editing state
    const [modalVisible, setModalVisible] = useState(false);
    const [editingIndex, setEditingIndex] = useState(null);
    const [tempStopName, setTempStopName] = useState('');
    const [tempIsStop, setTempIsStop] = useState(false);

    // Existing Routes for Reference
    const [existingRoutes, setExistingRoutes] = useState([]);

    // Bus Linking State
    const [buses, setBuses] = useState([]);
    const [selectedBus, setSelectedBus] = useState(null);
    const [busModalVisible, setBusModalVisible] = useState(false);

    // Route Color State (Default Blue)
    const [routeColor, setRouteColor] = useState('#2563eb');
    const availableColors = ['#2563eb', '#ef4444', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899', '#06b6d4'];

    const mapRef = useRef(null);

    useEffect(() => {
        let isMounted = true;

        const init = async () => {
            if (Platform.OS !== 'web') {
                const maps = await import('react-native-maps');
                if (isMounted) {
                    setMapView(() => maps.default);
                    setMarker(() => maps.Marker);
                    setPolyline(() => maps.Polyline);
                }
            }

            // Load existing route if editing
            if (routeId) {
                const existingRoute = await loadRoute(routeId);
                if (existingRoute && isMounted) {
                    setRouteName(existingRoute.routeName);
                    setWaypoints(existingRoute.waypoints);
                    if (existingRoute.routeColor) setRouteColor(existingRoute.routeColor);

                    // Fetch buses to find the linked one
                    try {
                        const ip = await AsyncStorage.getItem('serverIp');
                        const port = await AsyncStorage.getItem('apiPort');
                        const host = ip || '183.89.203.247';
                        const apiPort = port || '8000';
                        const response = await axios.get(`http://${host}:${apiPort}/api/buses`);
                        const busList = response.data;

                        if (isMounted) {
                            setBuses(busList);
                            if (existingRoute.busId) {
                                const linkedBus = busList.find(b => (b.mac_address || b.bus_mac) === existingRoute.busId);
                                if (linkedBus) {
                                    setSelectedBus(linkedBus);
                                }
                            }
                        }
                    } catch (err) {
                        console.log("Error fetching buses in init:", err);
                    }
                }
            } else {
                // New route - just fetch buses
                fetchBuses();
            }

            // Fetch existing routes for reference layer
            fetchExistingRoutes();

            // Get user location for initial map region
            try {
                const { status } = await Location.requestForegroundPermissionsAsync();
                if (status === 'granted') {
                    const location = await Location.getCurrentPositionAsync({});
                    if (isMounted) {
                        setUserLocation(location.coords);
                    }
                }
            } catch (e) {
                console.warn('Error getting location', e);
            }

            if (isMounted) setLoading(false);
        };

        const fetchBuses = async () => {
            try {
                const ip = await AsyncStorage.getItem('serverIp');
                const port = await AsyncStorage.getItem('apiPort');
                const host = ip || '183.89.203.247'; // Default fallback
                const apiPort = port || '8000';
                const apiUrl = `http://${host}:${apiPort}`;

                const response = await axios.get(`${apiUrl}/api/buses`);
                if (isMounted) {
                    setBuses(response.data);
                }
            } catch (error) {
                console.log("Error fetching buses:", error);
            }
        };

        const fetchExistingRoutes = async () => {
            try {
                const ip = await AsyncStorage.getItem('serverIp');
                const port = await AsyncStorage.getItem('apiPort');
                const host = ip || '183.89.203.247'; // Default fallback
                const apiPort = port || '8000';
                const apiUrl = `http://${host}:${apiPort}`;

                const response = await axios.get(`${apiUrl}/api/routes`);
                if (response.data && Array.isArray(response.data)) {
                    // Fetch stops for each route
                    const fullRoutes = await Promise.all(response.data.map(async (r) => {
                        try {
                            const stopsRes = await axios.get(`${apiUrl}/api/routes/${r.id}/stops`);
                            return { ...r, waypoints: stopsRes.data || [] };
                        } catch (e) {
                            return { ...r, waypoints: [] };
                        }
                    }));
                    if (isMounted) {
                        setExistingRoutes(fullRoutes);
                    }
                }
            } catch (error) {
                console.log("Error fetching reference routes:", error);
            }
        }

        init();
        fetchBuses();

        return () => { isMounted = false; };
    }, [routeId]);

    const handleMapPress = (e) => {
        const { coordinate } = e.nativeEvent;
        setWaypoints([...waypoints, coordinate]);
    };

    const handleMarkerPress = (index) => {
        setEditingIndex(index);
        const wp = waypoints[index];
        setTempIsStop(wp.isStop || false);
        setTempStopName(wp.stopName || '');
        setModalVisible(true);
    };

    const saveWaypointDetails = () => {
        if (editingIndex !== null) {
            const newWaypoints = [...waypoints];
            newWaypoints[editingIndex] = {
                ...newWaypoints[editingIndex],
                isStop: tempIsStop,
                stopName: tempStopName,
            };
            setWaypoints(newWaypoints);
            setModalVisible(false);
            setEditingIndex(null);
        }
    };

    const handleMarkerLongPress = (index) => {
        const newWaypoints = [...waypoints];
        newWaypoints.splice(index, 1);
        setWaypoints(newWaypoints);
    };

    const handleSave = async () => {
        if (!routeName.trim()) {
            Alert.alert('Error', 'Please enter a route name');
            return;
        }

        // Allow saving empty routes or single points as per user request
        // if (waypoints.length < 2) {
        //     Alert.alert('Error', 'Please add at least 2 waypoints');
        //     return;
        // }

        setSaving(true);
        try {
            const id = routeId || generateRouteId();
            // Handle mac_address vs bus_mac mismatch (API vs MQTT)
            const busIdToSave = selectedBus?.mac_address || selectedBus?.bus_mac;
            const success = await saveRoute(id, routeName, waypoints, busIdToSave, routeColor);

            if (success) {
                // Build the full route object for server sync
                const routeForServer = {
                    routeId: id,
                    routeName: routeName,
                    waypoints: waypoints,
                    busId: busIdToSave,
                    routeColor: routeColor,
                };

                // Sync to server (non-blocking, but we show status)
                const serverSynced = await syncRouteToServer(routeForServer);

                const syncMessage = serverSynced
                    ? 'Route saved and synced to server! ✅'
                    : 'Route saved locally. Server sync failed (offline mode).';

                Alert.alert('Success', syncMessage, [
                    { text: 'OK', onPress: () => navigation.goBack() }
                ]);
            } else {
                Alert.alert('Error', 'Failed to save route');
            }
        } catch (e) {
            console.error(e);
            Alert.alert('Error', 'An unexpected error occurred');
        } finally {
            setSaving(false);
        }
    };

    if (loading || !MapView) {
        return (
            <View style={styles.loadingContainer}>
                <ActivityIndicator size="large" color="#2563eb" />
                <Text>Loading Editor...</Text>
            </View>
        );
    }

    const initialRegion = userLocation ? {
        latitude: userLocation.latitude,
        longitude: userLocation.longitude,
        latitudeDelta: 0.01,
        longitudeDelta: 0.01,
    } : {
        latitude: 14.8820,
        longitude: 102.0207,
        latitudeDelta: 0.01,
        longitudeDelta: 0.01,
    };

    return (
        <SafeAreaView style={styles.container} edges={['top', 'left', 'right', 'bottom']}>
            <View style={styles.header}>
                <TextInput
                    style={styles.input}
                    placeholder="Route Name"
                    value={routeName}
                    onChangeText={setRouteName}
                />
                <TouchableOpacity
                    style={[styles.saveButton, saving && styles.disabledButton]}
                    onPress={handleSave}
                    disabled={saving}
                >
                    {saving ? (
                        <ActivityIndicator size="small" color="#fff" />
                    ) : (
                        <Text style={styles.saveButtonText}>Save</Text>
                    )}
                </TouchableOpacity>
            </View>

            {/* Bus Selector */}
            <TouchableOpacity
                style={styles.busSelector}
                onPress={() => setBusModalVisible(true)}
            >
                <Ionicons name="bus-outline" size={20} color="#333" />
                <Text style={styles.busSelectorText}>
                    {selectedBus ? `Linked: ${selectedBus.bus_name || selectedBus.bus_mac}` : "Link to Bus (Optional)"}
                </Text>
                <Ionicons name="chevron-down" size={16} color="#666" />
            </TouchableOpacity>

            {/* Color Picker Row */}
            <View style={styles.colorPickerContainer}>
                <Text style={styles.labelSmall}>Route Color:</Text>
                <View style={styles.colorList}>
                    {availableColors.map(color => (
                        <TouchableOpacity
                            key={color}
                            style={[
                                styles.colorOption,
                                { backgroundColor: color },
                                routeColor === color && styles.selectedColorOption
                            ]}
                            onPress={() => setRouteColor(color)}
                        />
                    ))}
                </View>
            </View>

            <MapView
                ref={mapRef}
                style={styles.map}
                initialRegion={initialRegion}
                onPress={() => {
                    setModalVisible(false);
                    setEditingIndex(null);
                }}
                onLongPress={handleMapPress}
            >
                {/* Reference Routes Layer */}
                {showRoutes && existingRoutes.map((route, i) => (
                    <React.Fragment key={`ref-route-${i}`}>
                        {/* Dimmed Polyline */}
                        <Polyline
                            coordinates={route.waypoints}
                            strokeColor={route.routeColor || '#999'}
                            strokeWidth={3}
                            lineDashPattern={[5, 10]} // Dashed line for reference
                            style={{ opacity: 0.4 }} // Fade out
                        />
                        {/* Bus Stops on Reference Route */}
                        {route.waypoints.filter(w => w.isStop).map((stop, j) => (
                            <Marker
                                key={`ref-stop-${i}-${j}`}
                                coordinate={stop}
                                anchor={{ x: 0.5, y: 0.5 }}
                                pointerEvents="none" // Non-interactive
                            >
                                <View style={{
                                    width: 10, height: 10, borderRadius: 5,
                                    backgroundColor: route.routeColor || '#999',
                                    opacity: 0.6,
                                    borderWidth: 1, borderColor: 'white'
                                }} />
                            </Marker>
                        ))}
                    </React.Fragment>
                ))}

                {waypoints.length > 0 && (
                    <Polyline
                        coordinates={waypoints}
                        strokeColor={routeColor}
                        strokeWidth={3}
                    />
                )}

                {waypoints.map((wp, index) => (
                    <Marker
                        key={`wp-${index}`}
                        coordinate={wp}
                        // title={`Waypoint ${index + 1}`} // Removed to prevent default callout and force Modal
                        onPress={(e) => {
                            e.stopPropagation(); // Stop event execution here
                            handleMarkerPress(index);
                        }}
                        onCalloutPress={() => handleMarkerLongPress(index)} // Alternative for iOS
                        onLongPress={() => handleMarkerLongPress(index)}
                        draggable
                        anchor={{ x: 0.5, y: 0.5 }}
                        onDrag={(e) => {
                            const newWaypoints = [...waypoints];
                            newWaypoints[index] = e.nativeEvent.coordinate;
                            setWaypoints(newWaypoints);
                        }}
                        onDragEnd={(e) => {
                            const newWaypoints = [...waypoints];
                            newWaypoints[index] = e.nativeEvent.coordinate;
                            setWaypoints(newWaypoints);
                        }}
                    >
                        <View style={[styles.markerContainer, wp.isStop && styles.stopMarkerContainer]}>
                            {wp.isStop ? (
                                <Ionicons name="bus" size={16} color="white" />
                            ) : (
                                <Text style={styles.markerText}>{index + 1}</Text>
                            )}
                        </View>
                    </Marker>
                ))}
            </MapView>

            {/* Grid Toggle Button */}
            <TouchableOpacity
                style={styles.gridButton}
                onPress={() => setShowGrid(!showGrid)}
            >
                <Text style={{ fontSize: 20 }}>#️⃣</Text>
            </TouchableOpacity>

            {/* Show Routes Toggle Button */}
            <TouchableOpacity
                style={[styles.gridButton, { bottom: 160 }]} // Stack above Grid button
                onPress={() => setShowRoutes(!showRoutes)}
            >
                <Ionicons name={showRoutes ? "eye" : "eye-off"} size={22} color="#333" />
            </TouchableOpacity>

            {showGrid && <GridOverlay />}

            <Modal
                animationType="slide"
                transparent={true}
                visible={modalVisible}
                onRequestClose={() => setModalVisible(false)}
            >
                <KeyboardAvoidingView
                    behavior={Platform.OS === "ios" ? "padding" : "height"}
                    style={styles.centeredView}
                >
                    <View style={styles.modalView}>
                        <Text style={styles.modalTitle}>Edit Waypoint {editingIndex + 1}</Text>

                        <View style={styles.inputGroup}>
                            <Text style={styles.label}>🛑 Is this a Bus Stop?</Text>
                            <Switch
                                trackColor={{ false: "#767577", true: "#81b0ff" }}
                                thumbColor={tempIsStop ? "#2563eb" : "#f4f3f4"}
                                onValueChange={setTempIsStop}
                                value={tempIsStop}
                            />
                        </View>

                        {tempIsStop && (
                            <View style={styles.inputGroup}>
                                <Text style={styles.label}>Bus Stop Name:</Text>
                                <TextInput
                                    style={styles.modalInput}
                                    onChangeText={setTempStopName}
                                    value={tempStopName}
                                    placeholder="e.g. Main Gate, Library"
                                    autoFocus={true}
                                />
                            </View>
                        )}

                        <View style={styles.modalButtons}>
                            <TouchableOpacity
                                style={[styles.button, styles.buttonDelete]}
                                onPress={() => {
                                    if (editingIndex !== null) {
                                        const newWaypoints = [...waypoints];
                                        newWaypoints.splice(editingIndex, 1);
                                        setWaypoints(newWaypoints);
                                        setModalVisible(false);
                                        setEditingIndex(null);
                                    }
                                }}
                            >
                                <Text style={styles.textStyle}>Delete</Text>
                            </TouchableOpacity>
                            <TouchableOpacity
                                style={[styles.button, styles.buttonClose]}
                                onPress={() => setModalVisible(false)}
                            >
                                <Text style={styles.textStyle}>Cancel</Text>
                            </TouchableOpacity>
                            <TouchableOpacity
                                style={[styles.button, styles.buttonSave]}
                                onPress={saveWaypointDetails}
                            >
                                <Text style={styles.textStyle}>Save</Text>
                            </TouchableOpacity>
                        </View>
                    </View>
                </KeyboardAvoidingView>
            </Modal>

            {/* Bus Selection Modal */}
            <Modal
                animationType="slide"
                transparent={true}
                visible={busModalVisible}
                onRequestClose={() => setBusModalVisible(false)}
            >
                <View style={styles.centeredView}>
                    <View style={styles.modalView}>
                        <Text style={styles.modalTitle}>Select a Bus</Text>

                        {buses.length === 0 ? (
                            <Text style={{ marginBottom: 20 }}>No buses found online.</Text>
                        ) : (
                            buses.map(bus => {
                                const busId = bus.mac_address || bus.bus_mac;
                                const isSelected = (selectedBus?.mac_address || selectedBus?.bus_mac) === busId;
                                return (
                                    <TouchableOpacity
                                        key={busId}
                                        style={[
                                            styles.busOption,
                                            isSelected && styles.selectedBusOption
                                        ]}
                                        onPress={() => {
                                            setSelectedBus(bus);
                                            setBusModalVisible(false);
                                        }}
                                    >
                                        <Ionicons name="bus" size={24} color="#2563eb" />
                                        <Text style={styles.busOptionText}>{bus.bus_name || `Bus ${busId}`}</Text>
                                        {isSelected && <Ionicons name="checkmark" size={24} color="#2563eb" />}
                                    </TouchableOpacity>
                                );
                            })
                        )}

                        <TouchableOpacity
                            style={[styles.button, styles.buttonClose, { marginTop: 10, width: '100%' }]}
                            onPress={() => {
                                setSelectedBus(null);
                                setBusModalVisible(false);
                            }}
                        >
                            <Text style={styles.textStyle}>Clear Selection / Cancel</Text>
                        </TouchableOpacity>
                    </View>
                </View>
            </Modal>

            <View style={styles.footer}>
                <Text style={styles.stats}>
                    {waypoints.length} Waypoints
                </Text>
            </View>

            <TouchableOpacity style={styles.backButton} onPress={() => navigation.goBack()}>
                <Ionicons name="arrow-back" size={24} color="white" />
            </TouchableOpacity>
        </SafeAreaView >
    );
};

// Grid Overlay Component
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

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#fff',
    },
    loadingContainer: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
    },
    header: {
        flexDirection: 'row',
        padding: 10,
        backgroundColor: '#fff',
        backgroundColor: '#fff',
        borderBottomWidth: 1,
        borderBottomColor: '#eee',
        alignItems: 'center',
        zIndex: 10,
    },
    input: {
        flex: 1,
        borderWidth: 1,
        borderColor: '#ddd',
        borderRadius: 5,
        padding: 10,
        marginRight: 10,
        fontSize: 16,
    },
    saveButton: {
        backgroundColor: '#2563eb',
        paddingHorizontal: 20,
        paddingVertical: 10,
        borderRadius: 5,
        minWidth: 80,
        alignItems: 'center',
    },
    disabledButton: {
        backgroundColor: '#93c5fd',
    },
    saveButtonText: {
        color: '#fff',
        fontWeight: 'bold',
    },
    map: {
        flex: 1,
    },
    footer: {
        padding: 10,
        backgroundColor: '#fff',
        borderTopWidth: 1,
        borderTopColor: '#eee',
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
    },
    instructions: {
        fontSize: 12,
        color: '#666',
        flex: 1,
    },
    stats: {
        fontSize: 12,
        fontWeight: 'bold',
        color: '#333',
    },
    markerContainer: {
        backgroundColor: 'white',
        borderRadius: 15,
        width: 30,
        height: 30,
        justifyContent: 'center',
        alignItems: 'center',
        borderWidth: 2,
        borderColor: '#2563eb',
    },
    markerDot: {
        width: 4,
        height: 4,
        borderRadius: 2,
        backgroundColor: '#2563eb',
        marginTop: 2,
    },
    markerText: {
        fontSize: 12,
        fontWeight: 'bold',
        color: '#2563eb',
        marginBottom: 0,
    },
    stopMarkerContainer: {
        borderColor: '#10b981', // Green
        backgroundColor: '#10b981', // Filled Green
    },
    stopMarkerDot: {
        backgroundColor: '#059669',
    },
    stopMarkerText: {
        color: '#059669',
    },
    centeredView: {
        flex: 1,
        justifyContent: "center",
        alignItems: "center",
        marginTop: 22,
        backgroundColor: 'rgba(0,0,0,0.5)',
    },
    modalView: {
        margin: 20,
        backgroundColor: "white",
        borderRadius: 20,
        padding: 35,
        alignItems: "center",
        shadowColor: "#000",
        shadowOffset: {
            width: 0,
            height: 2
        },
        shadowOpacity: 0.25,
        shadowRadius: 4,
        elevation: 5,
        width: '80%',
    },
    modalTitle: {
        fontSize: 18,
        fontWeight: 'bold',
        marginBottom: 15,
    },
    inputGroup: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 15,
        width: '100%',
        justifyContent: 'space-between',
    },
    label: {
        fontSize: 16,
        marginRight: 10,
    },
    modalInput: {
        borderWidth: 1,
        borderColor: '#ddd',
        borderRadius: 5,
        padding: 8,
        flex: 1,
    },
    modalButtons: {
        flexDirection: 'row',
        gap: 10,
        marginTop: 10,
    },
    button: {
        borderRadius: 10,
        padding: 10,
        elevation: 2,
        minWidth: 80,
    },
    buttonClose: {
        backgroundColor: "#9ca3af",
    },
    buttonSave: {
        backgroundColor: "#2563eb",
    },
    buttonDelete: {
        backgroundColor: "#ef4444",
    },
    textStyle: {
        color: "white",
        fontWeight: "bold",
        textAlign: "center"
    },
    backButton: {
        position: 'absolute',
        top: Platform.OS === 'ios' ? 50 : 20,
        left: 20,
        width: 40,
        height: 40,
        borderRadius: 20,
        backgroundColor: 'rgba(0,0,0,0.5)',
        justifyContent: 'center',
        alignItems: 'center',
        zIndex: 20,
        // Only show if we need a custom back button over the map, 
        // but header input might block standard navigation header if we hide it.
        // We'll rely on standard nav or this if header is hidden.
        display: 'none', // Hide for now as we have header
    },
    gridButton: {
        position: 'absolute',
        bottom: 100, // Above footer
        left: 20,
        backgroundColor: 'rgba(255, 255, 255, 0.9)',
        padding: 10,
        borderRadius: 25, // Round button
        elevation: 5,
        shadowColor: "#000",
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.25,
        shadowRadius: 3.84,
        zIndex: 20, // Above map
        width: 50,
        height: 50,
        justifyContent: 'center',
        alignItems: 'center',
    },
    busSelector: {
        flexDirection: 'row',
        alignItems: 'center',
        padding: 10,
        backgroundColor: '#f8f9fa',
        borderBottomWidth: 1,
        borderBottomColor: '#eee',
    },
    busSelectorText: {
        flex: 1,
        marginLeft: 10,
        fontSize: 14,
        color: '#333',
    },
    busOption: {
        flexDirection: 'row',
        alignItems: 'center',
        padding: 15,
        borderWidth: 1,
        borderColor: '#eee',
        borderRadius: 10,
        marginBottom: 10,
        width: '100%',
        backgroundColor: '#fff',
    },
    selectedBusOption: {
        borderColor: '#2563eb',
        backgroundColor: '#eff6ff',
    },
    busOptionText: {
        flex: 1,
        marginLeft: 10,
        fontSize: 16,
        fontWeight: '500',
    },
    colorPickerContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        padding: 10,
        backgroundColor: '#fff',
        borderBottomWidth: 1,
        borderBottomColor: '#eee',
    },
    labelSmall: {
        fontSize: 14,
        color: '#666',
        marginRight: 10,
    },
    colorList: {
        flexDirection: 'row',
        gap: 10,
    },
    colorOption: {
        width: 24,
        height: 24,
        borderRadius: 12,
        borderWidth: 2,
        borderColor: 'transparent',
    },
    selectedColorOption: {
        borderColor: '#000',
        transform: [{ scale: 1.1 }],
    }
});

export default RouteEditorScreen;
