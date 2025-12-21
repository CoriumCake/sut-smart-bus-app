import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, Platform } from 'react-native';

/**
 * SafeMapView - Wrapper that prevents crashes if Google Maps isn't available
 * Falls back to a placeholder if maps fail to load
 */
const SafeMapView = ({ children, style, fallbackText = "Map unavailable" }) => {
    const [MapView, setMapView] = useState(null);
    const [loadError, setLoadError] = useState(false);

    useEffect(() => {
        if (Platform.OS === 'web') {
            setLoadError(true);
            return;
        }

        const loadMaps = async () => {
            try {
                const maps = await import('react-native-maps');
                setMapView(() => maps.default);
            } catch (error) {
                console.log('Failed to load react-native-maps:', error.message);
                setLoadError(true);
            }
        };

        loadMaps();
    }, []);

    if (loadError || !MapView) {
        return (
            <View style={[styles.fallbackContainer, style]}>
                <Text style={styles.fallbackIcon}>🗺️</Text>
                <Text style={styles.fallbackText}>{fallbackText}</Text>
                {loadError && (
                    <Text style={styles.fallbackSubtext}>
                        Maps require Google Play Services and a valid API key
                    </Text>
                )}
            </View>
        );
    }

    // Clone children and inject MapView if needed
    return children;
};

const styles = StyleSheet.create({
    fallbackContainer: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        backgroundColor: '#e8f4f8',
        borderRadius: 10,
        padding: 20,
    },
    fallbackIcon: {
        fontSize: 48,
        marginBottom: 10,
    },
    fallbackText: {
        fontSize: 18,
        fontWeight: 'bold',
        color: '#666',
        textAlign: 'center',
    },
    fallbackSubtext: {
        fontSize: 12,
        color: '#999',
        textAlign: 'center',
        marginTop: 8,
    },
});

export default SafeMapView;
