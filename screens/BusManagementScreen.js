import React, { useState, useEffect, useCallback } from 'react';
import {
    View, Text, FlatList, StyleSheet, TouchableOpacity, Alert,
    ActivityIndicator, TextInput, Modal, Platform
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import axios from 'axios';

import { getApiUrl, checkApiKey, getApiHeaders } from '../config/api';
import { useTheme } from '../contexts/ThemeContext';
import { useLanguage } from '../contexts/LanguageContext';

const BusManagementScreen = () => {
    const navigation = useNavigation();
    const { theme } = useTheme();
    const { t } = useLanguage();

    const [buses, setBuses] = useState([]);
    const [loading, setLoading] = useState(true);
    const [modalVisible, setModalVisible] = useState(false);
    const [editingBus, setEditingBus] = useState(null);

    // Form fields
    const [busName, setBusName] = useState('');
    const [macAddress, setMacAddress] = useState('');

    const loadBuses = useCallback(async () => {
        setLoading(true);
        try {
            const apiKey = await checkApiKey();
            const apiUrl = await getApiUrl();

            const response = await axios.get(`${apiUrl}/api/buses`, {
                headers: getApiHeaders(),
                timeout: 5000
            });

            if (response.data && Array.isArray(response.data)) {
                setBuses(response.data);
            }
        } catch (error) {
            console.log('Error fetching buses:', error.message);
            Alert.alert('Error', 'Could not load buses. Is the server running?');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        loadBuses();
    }, [loadBuses]);

    const openAddModal = () => {
        setEditingBus(null);
        setBusName('');
        setMacAddress('');
        setModalVisible(true);
    };

    const openEditModal = (bus) => {
        setEditingBus(bus);
        setBusName(bus.bus_name || '');
        setMacAddress(bus.mac_address || '');
        setModalVisible(true);
    };

    const handleSave = async () => {
        if (!macAddress.trim()) {
            Alert.alert('Error', 'MAC Address is required');
            return;
        }

        try {
            const apiKey = await checkApiKey();
            const apiUrl = await getApiUrl();
            const headers = getApiHeaders();

            if (editingBus) {
                // Update existing bus
                await axios.put(`${apiUrl}/api/buses/${editingBus.mac_address}`, {
                    bus_name: busName,
                    mac_address: macAddress,
                }, { headers });
                Alert.alert('Success', 'Bus updated');
            } else {
                // Create new bus
                await axios.post(`${apiUrl}/api/buses`, {
                    bus_name: busName,
                    mac_address: macAddress,
                    seats_available: 0,
                    pm2_5: 0,
                    pm10: 0,
                    temp: 0,
                    hum: 0,
                }, { headers });
                Alert.alert('Success', 'Bus created');
            }

            setModalVisible(false);
            loadBuses();
        } catch (error) {
            console.error('Save error:', error);
            Alert.alert('Error', error.response?.data?.detail || 'Could not save bus');
        }
    };

    const handleDelete = (bus) => {
        Alert.alert(
            'Delete Bus',
            `Are you sure you want to delete "${bus.bus_name || bus.mac_address}"?`,
            [
                { text: 'Cancel', style: 'cancel' },
                {
                    text: 'Delete',
                    style: 'destructive',
                    onPress: async () => {
                        try {
                            const apiKey = await checkApiKey();
                            const apiUrl = await getApiUrl();
                            await axios.delete(`${apiUrl}/api/buses/${bus.mac_address}`, {
                                headers: getApiHeaders()
                            });
                            Alert.alert('Success', 'Bus deleted');
                            loadBuses();
                        } catch (error) {
                            Alert.alert('Error', 'Could not delete bus');
                        }
                    }
                }
            ]
        );
    };

    const renderBusItem = ({ item: bus }) => (
        <View style={[styles.busItem, { backgroundColor: theme.card }]}>
            <View style={styles.busInfo}>
                <Ionicons name="bus" size={24} color={theme.primary} />
                <View style={styles.busDetails}>
                    <Text style={[styles.busName, { color: theme.text }]}>
                        {bus.bus_name || 'Unnamed Bus'}
                    </Text>
                    <Text style={[styles.busMac, { color: theme.textMuted }]}>
                        {bus.mac_address}
                    </Text>
                    {bus.current_lat && bus.current_lon && (
                        <Text style={[styles.busLocation, { color: theme.textSecondary }]}>
                            📍 {bus.current_lat.toFixed(4)}, {bus.current_lon.toFixed(4)}
                        </Text>
                    )}
                </View>
            </View>

            <View style={styles.actions}>
                <TouchableOpacity
                    style={[styles.actionBtn, { backgroundColor: theme.primaryLight }]}
                    onPress={() => openEditModal(bus)}
                >
                    <Ionicons name="pencil" size={18} color={theme.primary} />
                </TouchableOpacity>
                <TouchableOpacity
                    style={[styles.actionBtn, { backgroundColor: '#fee2e2' }]}
                    onPress={() => handleDelete(bus)}
                >
                    <Ionicons name="trash" size={18} color="#ef4444" />
                </TouchableOpacity>
            </View>
        </View>
    );

    if (loading) {
        return (
            <SafeAreaView style={[styles.loadingContainer, { backgroundColor: theme.background }]}>
                <ActivityIndicator size="large" color={theme.primary} />
                <Text style={[styles.loadingText, { color: theme.textSecondary }]}>Loading buses...</Text>
            </SafeAreaView>
        );
    }

    return (
        <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]}>
            {/* Header */}
            <View style={[styles.header, { borderBottomColor: theme.border }]}>
                <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
                    <Ionicons name="arrow-back" size={24} color={theme.text} />
                </TouchableOpacity>
                <Text style={[styles.title, { color: theme.text }]}>Bus Management</Text>
                <TouchableOpacity onPress={openAddModal} style={styles.addButton}>
                    <Ionicons name="add-circle" size={28} color={theme.primary} />
                </TouchableOpacity>
            </View>

            {/* Stats */}
            <View style={[styles.statsContainer, { backgroundColor: theme.surface }]}>
                <Text style={[styles.statsText, { color: theme.textSecondary }]}>
                    Total: {buses.length} buses registered
                </Text>
            </View>

            {/* Bus List */}
            {buses.length === 0 ? (
                <View style={styles.emptyState}>
                    <Ionicons name="bus-outline" size={48} color={theme.textMuted} />
                    <Text style={[styles.emptyText, { color: theme.textSecondary }]}>No buses registered</Text>
                    <TouchableOpacity style={[styles.addBtnLarge, { backgroundColor: theme.primary }]} onPress={openAddModal}>
                        <Ionicons name="add" size={20} color="#fff" />
                        <Text style={styles.addBtnText}>Add First Bus</Text>
                    </TouchableOpacity>
                </View>
            ) : (
                <FlatList
                    data={buses}
                    keyExtractor={(item) => item.mac_address || item._id}
                    renderItem={renderBusItem}
                    contentContainerStyle={styles.listContent}
                    showsVerticalScrollIndicator={false}
                />
            )}

            {/* Add/Edit Modal */}
            <Modal
                visible={modalVisible}
                transparent
                animationType="slide"
                onRequestClose={() => setModalVisible(false)}
            >
                <View style={styles.modalOverlay}>
                    <View style={[styles.modalContent, { backgroundColor: theme.card }]}>
                        <Text style={[styles.modalTitle, { color: theme.text }]}>
                            {editingBus ? 'Edit Bus' : 'Add New Bus'}
                        </Text>

                        <Text style={[styles.label, { color: theme.textSecondary }]}>Bus Name</Text>
                        <TextInput
                            style={[styles.input, { backgroundColor: theme.surface, color: theme.text, borderColor: theme.border }]}
                            placeholder="e.g. Bus AM-01"
                            placeholderTextColor={theme.textMuted}
                            value={busName}
                            onChangeText={setBusName}
                        />

                        <Text style={[styles.label, { color: theme.textSecondary }]}>MAC Address *</Text>
                        <TextInput
                            style={[styles.input, { backgroundColor: theme.surface, color: theme.text, borderColor: theme.border }]}
                            placeholder="e.g. AA:BB:CC:DD:EE:FF"
                            placeholderTextColor={theme.textMuted}
                            value={macAddress}
                            onChangeText={setMacAddress}
                            editable={!editingBus} // Can't change MAC when editing
                        />
                        {editingBus && (
                            <Text style={[styles.hint, { color: theme.textMuted }]}>
                                MAC address cannot be changed
                            </Text>
                        )}

                        <View style={styles.modalButtons}>
                            <TouchableOpacity
                                style={[styles.modalBtn, { backgroundColor: theme.surface }]}
                                onPress={() => setModalVisible(false)}
                            >
                                <Text style={[styles.modalBtnText, { color: theme.text }]}>Cancel</Text>
                            </TouchableOpacity>
                            <TouchableOpacity
                                style={[styles.modalBtn, { backgroundColor: theme.primary }]}
                                onPress={handleSave}
                            >
                                <Text style={[styles.modalBtnText, { color: '#fff' }]}>Save</Text>
                            </TouchableOpacity>
                        </View>
                    </View>
                </View>
            </Modal>
        </SafeAreaView>
    );
};

const styles = StyleSheet.create({
    container: { flex: 1 },
    loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
    loadingText: { marginTop: 10 },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: 16,
        paddingVertical: 12,
        borderBottomWidth: 1,
    },
    backButton: { padding: 4 },
    addButton: { padding: 4 },
    title: { fontSize: 18, fontWeight: 'bold' },
    statsContainer: { padding: 12, marginHorizontal: 16, marginTop: 12, borderRadius: 8 },
    statsText: { textAlign: 'center' },
    listContent: { padding: 16 },
    busItem: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: 16,
        borderRadius: 12,
        marginBottom: 12,
        elevation: 2,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.1,
        shadowRadius: 2,
    },
    busInfo: { flexDirection: 'row', alignItems: 'center', flex: 1 },
    busDetails: { marginLeft: 12, flex: 1 },
    busName: { fontSize: 16, fontWeight: '600' },
    busMac: { fontSize: 12, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace', marginTop: 2 },
    busLocation: { fontSize: 11, marginTop: 4 },
    actions: { flexDirection: 'row', gap: 8 },
    actionBtn: { padding: 8, borderRadius: 8 },
    emptyState: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 40 },
    emptyText: { fontSize: 16, marginTop: 12 },
    addBtnLarge: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 12, borderRadius: 10, marginTop: 16 },
    addBtnText: { color: '#fff', fontWeight: '600', marginLeft: 6 },
    modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center' },
    modalContent: { width: '85%', borderRadius: 16, padding: 24 },
    modalTitle: { fontSize: 20, fontWeight: 'bold', marginBottom: 20, textAlign: 'center' },
    label: { fontSize: 14, marginBottom: 6, marginTop: 12 },
    input: { borderWidth: 1, borderRadius: 10, padding: 12, fontSize: 16 },
    hint: { fontSize: 11, marginTop: 4 },
    modalButtons: { flexDirection: 'row', gap: 12, marginTop: 24 },
    modalBtn: { flex: 1, padding: 14, borderRadius: 10, alignItems: 'center' },
    modalBtnText: { fontWeight: '600' },
});

export default BusManagementScreen;
