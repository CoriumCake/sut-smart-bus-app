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
import { getAllRoutes, syncAllRoutesToServer, deleteRoute, deleteRouteFromServer } from '../utils/routeStorage';
import { getAllMappings, assignRouteToBus } from '../utils/busRouteMapping';

const BusRouteAdminScreen = () => {
    const navigation = useNavigation();
    const [activeTab, setActiveTab] = useState('assignments'); // 'assignments' | 'routes'
    const [buses, setBuses] = useState([]);
    const [routes, setRoutes] = useState([]);
    const [mappings, setMappings] = useState({});
    const [loading, setLoading] = useState(true);
    const [syncing, setSyncing] = useState(false);

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
                } else {
                    setBuses([]);
                }
            } catch (e) {
                console.log('Could not fetch buses from server', e);
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

    // Sync all local routes to server
    const handleSyncToServer = async () => {
        if (routes.length === 0) {
            Alert.alert('No Routes', 'There are no local routes to sync.');
            return;
        }

        setSyncing(true);
        try {
            const result = await syncAllRoutesToServer();
            if (result.synced > 0) {
                Alert.alert(
                    '✅ Sync Complete',
                    `${result.synced} routes synced to server.${result.failed > 0 ? `\n${result.failed} failed.` : ''}`
                );
            } else if (result.failed > 0) {
                Alert.alert('❌ Sync Failed', `Failed to sync ${result.failed} routes. Is the server running?`);
            } else {
                Alert.alert('Info', 'No routes to sync.');
            }
        } catch (error) {
            console.error('Sync error:', error);
            Alert.alert('Error', 'Failed to sync routes to server.');
        } finally {
            setSyncing(false);
        }
    };

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

    // Handle Delete Route
    const handleDeleteRoute = (route) => {
        Alert.alert(
            "Delete Route",
            `Are you sure you want to delete "${route.routeName}"? This will remove it from both local storage and the server.`,
            [
                { text: "Cancel", style: "cancel" },
                {
                    text: "Delete",
                    style: "destructive",
                    onPress: async () => {
                        setLoading(true);
                        try {
                            // 1. Delete Local
                            await deleteRoute(route.routeId);

                            // 2. Delete Server
                            await deleteRouteFromServer(route.routeId);

                            Alert.alert("Success", "Route deleted successfully");
                            loadData(); // Reload list
                        } catch (e) {
                            console.error("Delete error:", e);
                            Alert.alert("Error", "Failed to delete route");
                        } finally {
                            setLoading(false);
                        }
                    }
                }
            ]
        );
    };

    const getBusMac = (bus) => bus.bus_mac || bus.mac_address || bus.id;

    // --- Renders ---

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

    const renderRouteItem = ({ item: route }) => (
        <View style={styles.routeItem}>
            <View style={styles.routeInfo}>
                <Ionicons name="map" size={24} color="#10b981" />
                <View style={styles.routeDetails}>
                    <Text style={styles.routeName}>{route.routeName}</Text>
                    <Text style={styles.routeId}>{route.waypoints?.length || 0} stops • ID: {route.routeId.slice(0, 8)}...</Text>
                </View>
            </View>
            <TouchableOpacity
                style={styles.deleteBtn}
                onPress={() => handleDeleteRoute(route)}
            >
                <Ionicons name="trash-outline" size={20} color="#ef4444" />
            </TouchableOpacity>
        </View>
    );

    if (loading) {
        return (
            <SafeAreaView style={styles.loadingContainer}>
                <ActivityIndicator size="large" color="#2563eb" />
                <Text style={styles.loadingText}>Loading data...</Text>
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
                <Text style={styles.title}>Route Admin</Text>
                <View style={styles.headerButtons}>
                    <TouchableOpacity onPress={loadData} style={styles.refreshButton}>
                        <Ionicons name="refresh" size={24} color="#2563eb" />
                    </TouchableOpacity>
                </View>
            </View>

            {/* Tabs */}
            <View style={styles.tabContainer}>
                <TouchableOpacity
                    style={[styles.tab, activeTab === 'assignments' && styles.activeTab]}
                    onPress={() => setActiveTab('assignments')}
                >
                    <Text style={[styles.tabText, activeTab === 'assignments' && styles.activeTabText]}>Bus Assignments</Text>
                </TouchableOpacity>
                <TouchableOpacity
                    style={[styles.tab, activeTab === 'routes' && styles.activeTab]}
                    onPress={() => setActiveTab('routes')}
                >
                    <Text style={[styles.tabText, activeTab === 'routes' && styles.activeTabText]}>Manage Routes</Text>
                </TouchableOpacity>
            </View>

            {/* Content */}
            <View style={styles.content}>
                {activeTab === 'assignments' ? (
                    <>
                        <View style={styles.infoBanner}>
                            <Ionicons name="information-circle" size={20} color="#0066cc" />
                            <Text style={styles.infoText}>
                                Assign routes to buses below.
                            </Text>
                        </View>
                        {buses.length === 0 ? (
                            <View style={styles.emptyState}>
                                <Ionicons name="bus-outline" size={48} color="#ccc" />
                                <Text style={styles.emptyText}>No buses found</Text>
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
                    </>
                ) : (
                    <>
                        <View style={[styles.infoBanner, { backgroundColor: '#f0fdf4' }]}>
                            <Ionicons name="cloud-upload-outline" size={20} color="#15803d" />
                            <Text style={[styles.infoText, { color: '#15803d' }]}>
                                Manage your routes here.
                            </Text>
                            <TouchableOpacity
                                onPress={handleSyncToServer}
                                style={[styles.syncButton, syncing && styles.syncButtonDisabled]}
                                disabled={syncing}
                            >
                                {syncing ? (
                                    <ActivityIndicator size="small" color="#fff" />
                                ) : (
                                    <Text style={styles.syncButtonText}>Sync to Server</Text>
                                )}
                            </TouchableOpacity>
                        </View>
                        {routes.length === 0 ? (
                            <View style={styles.emptyState}>
                                <Ionicons name="map-outline" size={48} color="#ccc" />
                                <Text style={styles.emptyText}>No routes found</Text>
                            </View>
                        ) : (
                            <FlatList
                                data={routes}
                                keyExtractor={(item) => item.routeId}
                                renderItem={renderRouteItem}
                                contentContainerStyle={styles.listContent}
                                showsVerticalScrollIndicator={false}
                            />
                        )}
                    </>
                )}
            </View>
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
    loadingText: { marginTop: 10, color: '#666' },
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
    backButton: { padding: 4 },
    title: {
        fontSize: 18,
        fontWeight: 'bold',
        color: '#333',
    },
    headerButtons: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },
    refreshButton: { padding: 4 },
    tabContainer: {
        flexDirection: 'row',
        backgroundColor: '#fff',
        paddingHorizontal: 16,
        paddingBottom: 0,
        borderBottomWidth: 1,
        borderBottomColor: '#eee',
    },
    tab: {
        flex: 1,
        paddingVertical: 12,
        alignItems: 'center',
        borderBottomWidth: 3,
        borderBottomColor: 'transparent',
    },
    activeTab: {
        borderBottomColor: '#2563eb',
    },
    tabText: {
        fontSize: 14,
        fontWeight: '600',
        color: '#666',
    },
    activeTabText: {
        color: '#2563eb',
    },
    content: {
        flex: 1,
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
    syncButton: {
        backgroundColor: '#10b981',
        paddingHorizontal: 12,
        paddingVertical: 6,
        borderRadius: 16,
    },
    syncButtonDisabled: {
        backgroundColor: '#9ca3af',
    },
    syncButtonText: {
        color: '#fff',
        fontSize: 12,
        fontWeight: '600',
    },
    listContent: {
        paddingHorizontal: 16,
        paddingBottom: 20,
        paddingTop: 12,
    },
    // Bus Items
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
    busDetails: { marginLeft: 12 },
    busName: { fontSize: 16, fontWeight: '600', color: '#333' },
    busMac: { fontSize: 12, color: '#888', fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace', marginTop: 2 },
    pickerContainer: {
        backgroundColor: '#f9f9f9',
        borderRadius: 8,
        borderWidth: 1,
        borderColor: '#ddd',
        overflow: 'hidden',
    },
    picker: { height: 50 },
    // Route Items
    routeItem: {
        flexDirection: 'row',
        alignItems: 'center',
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
    routeInfo: {
        flexDirection: 'row',
        alignItems: 'center',
        flex: 1,
    },
    routeDetails: { marginLeft: 12 },
    routeName: { fontSize: 16, fontWeight: '600', color: '#333' },
    routeId: { fontSize: 12, color: '#888', marginTop: 2 },
    deleteBtn: {
        padding: 8,
        backgroundColor: '#fee2e2',
        borderRadius: 8,
    },
    // Empty State
    emptyState: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        paddingHorizontal: 40,
        marginTop: 40,
    },
    emptyText: {
        fontSize: 18,
        fontWeight: '600',
        color: '#666',
        marginTop: 12,
    },

});

export default BusRouteAdminScreen;
