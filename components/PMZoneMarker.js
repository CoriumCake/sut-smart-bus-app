import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Marker, Circle } from 'react-native-maps';
import { MaterialCommunityIcons } from '@expo/vector-icons';

const PMZoneMarker = ({ zone, onPress, isEditing = false }) => {
    // Determine color based on PM2.5 levels
    const getZoneColor = (pm25) => {
        if (pm25 <= 50) return { fill: 'rgba(16, 185, 129, 0.2)', border: '#10b981', text: '#047857' }; // Green
        if (pm25 <= 100) return { fill: 'rgba(245, 158, 11, 0.2)', border: '#f59e0b', text: '#b45309' }; // Yellow
        return { fill: 'rgba(239, 68, 68, 0.2)', border: '#ef4444', text: '#b91c1c' }; // Red
    };

    const colors = getZoneColor(zone.avg_pm25 || 0);

    return (
        <>
            <Circle
                center={{ latitude: zone.lat, longitude: zone.lon }}
                radius={zone.radius || 50}
                fillColor={colors.fill}
                strokeColor={colors.border}
                strokeWidth={2}
            />
            <Marker
                coordinate={{ latitude: zone.lat, longitude: zone.lon }}
                anchor={{ x: 0.5, y: 0.5 }}
                onPress={() => onPress && onPress(zone)}
            >
                <View style={styles.container}>
                    <View style={[styles.bubble, { borderColor: colors.border }]}>
                        <MaterialCommunityIcons name="weather-fog" size={14} color={colors.text} />
                        <Text style={[styles.text, { color: colors.text }]}>
                            {Math.round(zone.avg_pm25)}
                        </Text>
                    </View>
                    {isEditing && <Text style={styles.label}>{zone.name}</Text>}
                </View>
            </Marker>
        </>
    );
};

const styles = StyleSheet.create({
    container: {
        alignItems: 'center',
        justifyContent: 'center',
    },
    bubble: {
        backgroundColor: 'white',
        padding: 4,
        borderRadius: 12,
        borderWidth: 2,
        flexDirection: 'row',
        alignItems: 'center',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.2,
        shadowRadius: 2,
        elevation: 3,
    },
    text: {
        fontWeight: 'bold',
        fontSize: 12,
        marginLeft: 2,
    },
    label: {
        backgroundColor: 'rgba(255,255,255,0.8)',
        fontSize: 10,
        marginTop: 2,
        paddingHorizontal: 4,
        borderRadius: 4,
    }
});

export default PMZoneMarker;
