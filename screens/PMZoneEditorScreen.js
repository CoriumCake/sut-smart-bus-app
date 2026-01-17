import React, { useState, useEffect, useRef } from 'react';
import { View, StyleSheet, TouchableOpacity, Text, Alert, Platform, TextInput, ActivityIndicator, Modal, Dimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Location from 'expo-location';
import { useNavigation, useRoute } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import axios from 'axios';
import { getApiUrl } from '../config/api';

const PMZoneEditorScreen = () => {
    const navigation = useNavigation();
    const route = useRoute();
    const { zoneId } = route.params || {};

    const [MapView, setMapView] = useState(null);
    const [Marker, setMarker] = useState(null);
    const [Polygon, setPolygon] = useState(null);

    const [zoneName, setZoneName] = useState('');
    const [points, setPoints] = useState([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [userLocation, setUserLocation] = useState(null);
    const [showGrid, setShowGrid] = useState(false);

    // Edit Handling
    const [editingIndex, setEditingIndex] = useState(null);

    // Route Color State (Default Red for heatmap)
    const zoneColor = 'rgba(239, 68, 68, 0.4)'; // Red with opacity
    const strokeColor = '#ef4444';

    const mapRef = useRef(null);

    useEffect(() => {
        let isMounted = true;

        const init = async () => {
            if (Platform.OS !== 'web') {
                const maps = await import('react-native-maps');
                if (isMounted) {
                    setMapView(() => maps.default);
                    setMarker(() => maps.Marker);
                    setPolygon(() => maps.Polygon);
                }
            }

            // Load existing zone if editing (Future support)
            // For now, we assume new zone creation usually

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

        init();
        return () => { isMounted = false; };
    }, [zoneId]);

    const handleMapPress = (e) => {
        if (!editingIndex) {
            const { coordinate } = e.nativeEvent;
            setPoints([...points, coordinate]);
        }
    };

    const handleMarkerDrag = (index, coordinate) => {
        const newPoints = [...points];
        newPoints[index] = coordinate;
        setPoints(newPoints);
    };

    const handleFirstMarkerLongPress = () => {
        if (points.length < 3) {
            Alert.alert("Incomplete Polygon", "You need at least 3 points to define a zone.");
            return;
        }
        Alert.alert(
            "Complete Zone?",
            "Do you want to finish defining this zone?",
            [
                { text: "Cancel", style: "cancel" },
                { text: "Yes", onPress: handleSave }
            ]
        );
    };

    const handleDeletePoint = (index) => {
        const newPoints = [...points];
        newPoints.splice(index, 1);
        setPoints(newPoints);
    };

    const handleSave = async () => {
        if (!zoneName.trim()) {
            Alert.alert('Error', 'Please enter a zone name');
            return;
        }
        if (points.length < 3) {
            Alert.alert('Error', 'Please add at least 3 points to form a polygon');
            return;
        }

        setSaving(true);
        try {
            const apiUrl = await getApiUrl();

            // Convert points to array of [lat, lon]
            const pointsArray = points.map(p => [p.latitude, p.longitude]);

            const payload = {
                name: zoneName,
                points: pointsArray,
                // Server schema expects points
            };

            console.log("Saving PM Zone:", payload);
            await axios.post(`${apiUrl}/api/pm-zones`, payload);

            Alert.alert('Success', 'PM Zone created successfully!', [
                { text: 'OK', onPress: () => navigation.goBack() }
            ]);
        } catch (e) {
            console.error(e);
            Alert.alert('Error', 'Failed to save zone');
        } finally {
            setSaving(false);
        }
    };

    if (loading || !MapView) {
        return (
            <View style={styles.loadingContainer}>
                <ActivityIndicator size="large" color="#ef4444" />
                <Text>Loading Zone Editor...</Text>
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
                    placeholder="Zone Name (e.g. Main Gate)"
                    value={zoneName}
                    onChangeText={setZoneName}
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

            <View style={styles.instructionsContainer}>
                <Text style={styles.instructionText}>
                    tap map to add points • long-press 1st point to finish • drag points to adjust
                </Text>
            </View>

            <MapView
                ref={mapRef}
                style={styles.map}
                initialRegion={initialRegion}
                onPress={handleMapPress}
            >
                {points.length > 0 && (
                    <Polygon
                        coordinates={points}
                        fillColor={zoneColor}
                        strokeColor={strokeColor}
                        strokeWidth={2}
                    />
                )}

                {points.map((p, index) => (
                    <Marker
                        key={`pt-${index}`}
                        coordinate={p}
                        draggable
                        onDrag={(e) => handleMarkerDrag(index, e.nativeEvent.coordinate)}
                        onDragEnd={(e) => handleMarkerDrag(index, e.nativeEvent.coordinate)}
                        onPress={() => {
                            if (index !== 0) {
                                Alert.alert("Remove Point?", "Delete this point from the polygon?", [
                                    { text: "Cancel" },
                                    { text: "Delete", style: "destructive", onPress: () => handleDeletePoint(index) }
                                ]);
                            } else {
                                handleFirstMarkerLongPress();
                            }
                        }}
                        onLongPress={() => {
                            if (index === 0) handleFirstMarkerLongPress();
                        }}
                    >
                        <View style={[styles.markerContainer, index === 0 && styles.firstMarker]}>
                            <Text style={[styles.markerText, index === 0 && styles.firstMarkerText]}>
                                {index + 1}
                            </Text>
                        </View>
                    </Marker>
                ))}
            </MapView>

            <TouchableOpacity style={styles.backButton} onPress={() => navigation.goBack()}>
                <Ionicons name="arrow-back" size={24} color="white" />
            </TouchableOpacity>
        </SafeAreaView>
    );
};

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: '#fff' },
    loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
    header: {
        flexDirection: 'row',
        padding: 10,
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
        backgroundColor: '#ef4444',
        paddingHorizontal: 20,
        paddingVertical: 10,
        borderRadius: 5,
        minWidth: 80,
        alignItems: 'center',
    },
    disabledButton: { backgroundColor: '#fca5a5' },
    saveButtonText: { color: '#fff', fontWeight: 'bold' },
    map: { flex: 1 },
    markerContainer: {
        backgroundColor: 'rgba(255, 255, 255, 0.9)',
        borderRadius: 15,
        width: 30,
        height: 30,
        justifyContent: 'center',
        alignItems: 'center',
        borderWidth: 2,
        borderColor: '#ef4444',
    },
    firstMarker: {
        backgroundColor: '#ef4444',
        transform: [{ scale: 1.2 }],
        borderColor: '#fff',
    },
    markerText: { fontSize: 12, fontWeight: 'bold', color: '#ef4444' },
    firstMarkerText: { color: '#fff' },
    instructionsContainer: {
        padding: 8,
        backgroundColor: '#fef2f2',
        borderBottomWidth: 1,
        borderBottomColor: '#fee2e2',
    },
    instructionText: {
        fontSize: 12,
        color: '#b91c1c',
        textAlign: 'center',
    },
    backButton: {
        position: 'absolute',
        bottom: 40,
        left: 20,
        width: 50,
        height: 50,
        borderRadius: 25,
        backgroundColor: '#ef4444',
        justifyContent: 'center',
        alignItems: 'center',
        elevation: 5,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.25,
        shadowRadius: 3.84,
    }
});

export default PMZoneEditorScreen;
