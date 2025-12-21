import React, { useState, useEffect, useCallback } from 'react';
import {
    View, Text, FlatList, StyleSheet, TouchableOpacity, Alert,
    ActivityIndicator, Platform
} from 'react-native';
import { Picker } from '@react-native-picker/picker';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import axios from 'axios';

import { getApiUrl, checkApiKey, getApiHeaders } from '../config/api';
import { getAllRoutes } from '../utils/routeStorage';
import { getAllMappings, assignRouteToBus } from '../utils/busRouteMapping';

const BusRouteAdminScreen = () => {
    const navigation = useNavigation();
    const [buses, setBuses] = useState([]);
    const [routes, setRoutes] = useState([]);
    const [mappings, setMappings] = useState({});
    const [loading, setLoading] = useState(true);

    // Fetch buses from API and routes from local storage
    const loadData = useCallback(async () => {
        setLoading(true);
        try {
            // Fetch buses from server
            const apiKey = await checkApiKey();
            const apiUrl = await getApiUrl();

            try {
                const busResponse = await axios.get(`${apiUrl}/api/buses`, {
                    headers: getApiHeaders(),
                    timeout: 5000
                });
                if (busResponse.data && Array.isArray(busResponse.data)) {
                    setBuses(busResponse.data);
                }
            } catch (e) {
                console.log('Could not fetch buses from server, using empty list');
                setBuses([]);
            }

            // Fetch local routes
            const localRoutes = await getAllRoutes();
            setRoutes(localRoutes);

            // Fetch current mappings
            const currentMappings = await getAllMappings();
            setMappings(currentMappings);
        } catch (error) {
            console.error('Error loading data:', error);
            Alert.alert('Error', 'Failed to load data');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        loadData();
    }, [loadData]);

    // Handle route selection for a bus
    const handleRouteChange = async (busMac, routeId) => {
        const success = await assignRouteToBus(busMac, routeId || null);
        if (success) {
            setMappings(prev => {
                const updated = { ...prev };
                if (routeId) {
                    updated[busMac] = routeId;
                } else {
                    delete updated[busMac];
                }
                return updated;
            });
        } else {
            Alert.alert('Error', 'Failed to save assignment');
        }
    };

    const getBusMac = (bus) => bus.bus_mac || bus.mac_address || bus.id;

    const renderBusItem = ({ item: bus }) => {
        const busMac = getBusMac(bus);
        const assignedRouteId = mappings[busMac] || '';

        return (
            <View style={styles.busItem}>
                <View style={styles.busInfo}>
                    <Ionicons name="bus" size={24} color="#2563eb" />
                    <View style={styles.busDetails}>
                        <Text style={styles.busName}>{bus.bus_name || busMac}</Text>
                        <Text style={styles.busMac}>{busMac}</Text>
                    </View>
                </View>

                <View style={styles.pickerContainer}>
                    <Picker
                        selectedValue={assignedRouteId}
                        onValueChange={(value) => handleRouteChange(busMac, value)}
                        style={styles.picker}
                        dropdownIconColor="#666"
                    >
                        <Picker.Item label="-- Not Assigned --" value="" />
                        {routes.map(route => (
                            <Picker.Item
                                key={route.routeId}
                                label={route.routeName || route.routeId}
                                value={route.routeId}
                            />
                        ))}
                    </Picker>
                </View>
            </View>
        );
    };

    if (loading) {
        return (
            <SafeAreaView style={styles.loadingContainer}>
                <ActivityIndicator size="large" color="#2563eb" />
                <Text style={styles.loadingText}>Loading buses and routes...</Text>
            </SafeAreaView>
        );
    }

    return (
        <SafeAreaView style={styles.container}>
            {/* Header */}
            <View style={styles.header}>
                <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
                    <Ionicons name="arrow-back" size={24} color="#333" />
                </TouchableOpacity>
                <Text style={styles.title}>Bus Route Assignment</Text>
                <TouchableOpacity onPress={loadData} style={styles.refreshButton}>
                    <Ionicons name="refresh" size={24} color="#2563eb" />
                </TouchableOpacity>
            </View>

            {/* Info Banner */}
            <View style={styles.infoBanner}>
                <Ionicons name="information-circle" size={20} color="#0066cc" />
                <Text style={styles.infoText}>
                    Assign routes to buses. Changes save automatically.
                </Text>
            </View>

            {/* Stats */}
            <View style={styles.statsRow}>
                <View style={styles.statBox}>
                    <Text style={styles.statNumber}>{buses.length}</Text>
                    <Text style={styles.statLabel}>Buses</Text>
                </View>
                <View style={styles.statBox}>
                    <Text style={styles.statNumber}>{routes.length}</Text>
                    <Text style={styles.statLabel}>Routes</Text>
                </View>
                <View style={styles.statBox}>
                    <Text style={styles.statNumber}>{Object.keys(mappings).length}</Text>
                    <Text style={styles.statLabel}>Assigned</Text>
                </View>
            </View>

            {/* Bus List */}
            {buses.length === 0 ? (
                <View style={styles.emptyState}>
                    <Ionicons name="bus-outline" size={48} color="#ccc" />
                    <Text style={styles.emptyText}>No buses found</Text>
                    <Text style={styles.emptySubtext}>
                        Make sure the server is running and buses are registered
                    </Text>
                </View>
            ) : (
                <FlatList
                    data={buses}
                    keyExtractor={(item, index) => getBusMac(item) || `bus-${index}`}
                    renderItem={renderBusItem}
                    contentContainerStyle={styles.listContent}
                    showsVerticalScrollIndicator={false}
                />
            )}
        </SafeAreaView>
    );
};

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#f5f5f5',
    },
    loadingContainer: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        backgroundColor: '#f5f5f5',
    },
    loadingText: {
        marginTop: 10,
        color: '#666',
    },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: 16,
        paddingVertical: 12,
        backgroundColor: '#fff',
        borderBottomWidth: 1,
        borderBottomColor: '#eee',
    },
    backButton: {
        padding: 4,
    },
    title: {
        fontSize: 18,
        fontWeight: 'bold',
        color: '#333',
    },
    refreshButton: {
        padding: 4,
    },
    infoBanner: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#e8f4f8',
        padding: 12,
        marginHorizontal: 16,
        marginTop: 12,
        borderRadius: 8,
    },
    infoText: {
        marginLeft: 8,
        color: '#0066cc',
        fontSize: 13,
        flex: 1,
    },
    statsRow: {
        flexDirection: 'row',
        justifyContent: 'space-around',
        paddingVertical: 16,
        marginHorizontal: 16,
    },
    statBox: {
        alignItems: 'center',
    },
    statNumber: {
        fontSize: 24,
        fontWeight: 'bold',
        color: '#2563eb',
    },
    statLabel: {
        fontSize: 12,
        color: '#666',
        marginTop: 2,
    },
    listContent: {
        paddingHorizontal: 16,
        paddingBottom: 20,
    },
    busItem: {
        backgroundColor: '#fff',
        borderRadius: 12,
        padding: 16,
        marginBottom: 12,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.1,
        shadowRadius: 2,
        elevation: 2,
    },
    busInfo: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 12,
    },
    busDetails: {
        marginLeft: 12,
    },
    busName: {
        fontSize: 16,
        fontWeight: '600',
        color: '#333',
    },
    busMac: {
        fontSize: 12,
        color: '#888',
        fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
        marginTop: 2,
    },
    pickerContainer: {
        backgroundColor: '#f9f9f9',
        borderRadius: 8,
        borderWidth: 1,
        borderColor: '#ddd',
        overflow: 'hidden',
    },
    picker: {
        height: 50,
    },
    emptyState: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        paddingHorizontal: 40,
    },
    emptyText: {
        fontSize: 18,
        fontWeight: '600',
        color: '#666',
        marginTop: 12,
    },
    emptySubtext: {
        fontSize: 14,
        color: '#999',
        textAlign: 'center',
        marginTop: 8,
    },
});

export default BusRouteAdminScreen;
