import React, { useRef, useEffect, useState } from 'react';
import { StyleSheet, Image, Animated, Easing, View, TouchableOpacity, Text, Platform } from 'react-native';
import { getAirQualityStatus } from '../utils/airQuality';
import { whiteMapStyle, darkMapStyle } from '../utils/mapStyles';
import { useTheme } from '../contexts/ThemeContext';

// Dynamic import for maps - will be null if import fails
let MapViewComponent = null;
let MarkerComponent = null;
let CircleComponent = null;
let PolylineComponent = null;

// Try to load maps (will fail gracefully if not available)
if (Platform.OS !== 'web') {
    try {
        const Maps = require('react-native-maps');
        MapViewComponent = Maps.default;
        MarkerComponent = Maps.Marker;
        CircleComponent = Maps.Circle;
        PolylineComponent = Maps.Polyline;
    } catch (e) {
        console.log('react-native-maps not available:', e.message);
    }
}

const busIcon = require('../assets/W-bus-icon.png');

// Animated Marker Component with Predictive Interpolation (GrabFood-style)
const AnimatedMapMarker = ({ bus, airQualityColor, destination }) => {
    const animatedCoordinate = useRef({
        latitude: new Animated.Value(bus.current_lat),
        longitude: new Animated.Value(bus.current_lon),
    }).current;

    const animatedRadius = useRef(new Animated.Value(300)).current;

    // Track GPS data and velocity for prediction
    const previousGPS = useRef({ lat: bus.current_lat, lon: bus.current_lon, timestamp: Date.now() });
    const velocity = useRef({ lat: 0, lon: 0 }); // Units per millisecond
    const interpolationInterval = useRef(null);
    const lastUpdateTime = useRef(Date.now());

    useEffect(() => {
        if (!bus.current_lat || !bus.current_lon) return;

        const now = Date.now();
        const currentGPS = { lat: bus.current_lat, lon: bus.current_lon };
        const prevGPS = previousGPS.current;

        // Check if GPS coordinates have changed (new data from server)
        const latChanged = prevGPS.lat !== currentGPS.lat;
        const lonChanged = prevGPS.lon !== currentGPS.lon;

        if (latChanged || lonChanged) {
            // Calculate velocity (change in position / time elapsed)
            const timeDelta = now - prevGPS.timestamp;
            if (timeDelta > 0) {
                velocity.current = {
                    lat: (currentGPS.lat - prevGPS.lat) / timeDelta,
                    lon: (currentGPS.lon - prevGPS.lon) / timeDelta,
                };
            }

            // Smoothly animate to the new actual GPS position
            Animated.parallel([
                Animated.timing(animatedCoordinate.latitude, {
                    toValue: currentGPS.lat,
                    duration: 800, // Slightly longer for smooth correction
                    easing: Easing.out(Easing.ease),
                    useNativeDriver: false,
                }),
                Animated.timing(animatedCoordinate.longitude, {
                    toValue: currentGPS.lon,
                    duration: 800,
                    easing: Easing.out(Easing.ease),
                    useNativeDriver: false,
                }),
            ]).start();

            previousGPS.current = { ...currentGPS, timestamp: now };
            lastUpdateTime.current = now;
        }

        // Start continuous interpolation for smooth movement between GPS updates
        if (interpolationInterval.current) {
            clearInterval(interpolationInterval.current);
        }

        interpolationInterval.current = setInterval(() => {
            const elapsed = Date.now() - lastUpdateTime.current;
            const speed = Math.sqrt(velocity.current.lat ** 2 + velocity.current.lon ** 2);

            // Only predict if bus is moving (speed > threshold)
            if (speed > 0.0000001 && elapsed < 10000) { // Stop predicting after 10s without updates
                // Predict next position based on velocity and destination
                let predictedLat = animatedCoordinate.latitude.__getValue() + velocity.current.lat * 50;
                let predictedLon = animatedCoordinate.longitude.__getValue() + velocity.current.lon * 50;

                // If destination exists, bias prediction toward destination
                if (destination) {
                    const toDestLat = destination.latitude - animatedCoordinate.latitude.__getValue();
                    const toDestLon = destination.longitude - animatedCoordinate.longitude.__getValue();
                    const distToDest = Math.sqrt(toDestLat ** 2 + toDestLon ** 2);

                    // Blend velocity-based prediction with destination direction (70/30 mix)
                    if (distToDest > 0.0001) { // Only if not already at destination
                        const destDir = { lat: toDestLat / distToDest, lon: toDestLon / distToDest };
                        const blendFactor = 0.3; // 30% toward destination
                        predictedLat += destDir.lat * speed * 50 * blendFactor;
                        predictedLon += destDir.lon * speed * 50 * blendFactor;
                    }
                }

                // Smoothly animate to predicted position
                Animated.parallel([
                    Animated.timing(animatedCoordinate.latitude, {
                        toValue: predictedLat,
                        duration: 100, // Short duration for continuous updates
                        easing: Easing.linear,
                        useNativeDriver: false,
                    }),
                    Animated.timing(animatedCoordinate.longitude, {
                        toValue: predictedLon,
                        duration: 100,
                        easing: Easing.linear,
                        useNativeDriver: false,
                    }),
                ]).start();
            }
        }, 100); // Update prediction every 100ms for smooth 10fps interpolation

        // Pulse animation for the circle radius (subtle breathing effect)
        Animated.loop(
            Animated.sequence([
                Animated.timing(animatedRadius, {
                    toValue: 320,
                    duration: 2000,
                    easing: Easing.inOut(Easing.ease),
                    useNativeDriver: false,
                }),
                Animated.timing(animatedRadius, {
                    toValue: 300,
                    duration: 2000,
                    easing: Easing.inOut(Easing.ease),
                    useNativeDriver: false,
                }),
            ])
        ).start();

        // Cleanup interval on unmount or when dependencies change
        return () => {
            if (interpolationInterval.current) {
                clearInterval(interpolationInterval.current);
            }
        };
    }, [bus.current_lat, bus.current_lon, destination]);

    // Don't render if map components not loaded
    if (!CircleComponent || !MarkerComponent) {
        return null;
    }

    const Circle = CircleComponent;
    const Marker = MarkerComponent;

    return (
        <React.Fragment>
            <Circle
                center={{
                    latitude: animatedCoordinate.latitude.__getValue(),
                    longitude: animatedCoordinate.longitude.__getValue(),
                }}
                radius={animatedRadius.__getValue()}
                fillColor={airQualityColor}
                strokeColor="transparent"
            />
            <Marker.Animated
                coordinate={animatedCoordinate}
                title={bus.bus_name || "Bus"}
                description={`PM2.5: ${bus.pm2_5}`}
            >
                <Animated.View>
                    <Image
                        source={busIcon}
                        style={{ width: 40, height: 40 }}
                        resizeMode="contain"
                    />
                </Animated.View>
            </Marker.Animated>
        </React.Fragment>
    );
};

const AirQualityMap = ({
    mapRef,
    buses,
    userLocation,
    destinationMarkers,
    onLongPress,
    onZoomToLocation
}) => {
    const { isDark } = useTheme();
    const mapStyle = isDark ? darkMapStyle : whiteMapStyle;

    const SUT_COORDINATES = {
        latitude: 14.8820,
        longitude: 102.0207,
        latitudeDelta: 0.02,
        longitudeDelta: 0.02,
    };

    // Fallback if maps not available
    if (!MapViewComponent) {
        return (
            <View style={styles.fallbackContainer}>
                <Text style={{ fontSize: 48, marginBottom: 10 }}>🗺️</Text>
                <Text style={{ fontSize: 18, fontWeight: 'bold', color: '#666' }}>
                    Map Unavailable
                </Text>
                <Text style={{ fontSize: 12, color: '#999', textAlign: 'center', marginTop: 8 }}>
                    Air quality data is still being collected
                </Text>
            </View>
        );
    }

    const MapView = MapViewComponent;
    const Marker = MarkerComponent;
    const Polyline = PolylineComponent;

    return (
        <View style={styles.container}>
            <MapView
                ref={mapRef}
                style={styles.map}
                initialRegion={SUT_COORDINATES}
                onLongPress={onLongPress}
                customMapStyle={mapStyle}
                userInterfaceStyle={isDark ? 'dark' : 'light'}
            >
                {buses.map((bus) => {
                    if (!bus.current_lat || !bus.current_lon) return null;
                    const { color } = getAirQualityStatus(bus.pm2_5);
                    const destination = destinationMarkers[bus.mac_address];

                    return (
                        <AnimatedMapMarker
                            key={bus.mac_address}
                            bus={bus}
                            airQualityColor={color}
                            destination={destination}
                        />
                    );
                })}

                {/* Render destination markers and paths */}
                {Object.entries(destinationMarkers).map(([busId, destination]) => {
                    const bus = buses.find(b => b.mac_address === busId);
                    if (!bus || !bus.current_lat || !bus.current_lon) return null;

                    return (
                        <React.Fragment key={`path-${busId}`}>
                            <Polyline
                                coordinates={[
                                    { latitude: bus.current_lat, longitude: bus.current_lon },
                                    destination,
                                ]}
                                strokeColor="#F57C00"
                                strokeWidth={4}
                                lineDashPattern={[10, 5]}
                            />
                            <Marker
                                coordinate={destination}
                                title="Destination"
                                description={`For ${bus.bus_name || 'Bus'}`}
                                pinColor="blue"
                            />
                        </React.Fragment>
                    );
                })}

                {userLocation && (
                    <Marker
                        coordinate={userLocation}
                        title="Your Location"
                        pinColor="blue"
                        zIndex={999}
                    />
                )}
            </MapView>

            <TouchableOpacity style={styles.locationButton} onPress={onZoomToLocation}>
                <Text style={styles.buttonText}>📍</Text>
            </TouchableOpacity>
        </View>
    );
};

const styles = StyleSheet.create({
    container: {
        flex: 1,
        position: 'relative',
    },
    map: {
        flex: 1,
    },
    locationButton: {
        position: 'absolute',
        bottom: 40,
        right: 20,
        backgroundColor: '#2563eb',
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
        zIndex: 999,
    },
    buttonText: {
        color: '#fff',
        fontSize: 24,
    },
    fallbackContainer: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        backgroundColor: '#e8f4f8',
    },
});

export default AirQualityMap;
