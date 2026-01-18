
import React, { createContext, useState, useEffect, useContext, useRef, useCallback } from 'react';
import axios from 'axios';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as mqtt from 'mqtt';
import { API_BASE, getApiUrl, checkApiKey, getApiHeaders, MQTT_CONFIG } from '../config/api';
import { getAllMappings, getRouteIdForBus } from '../utils/busRouteMapping';
import { loadRoute, downloadRoutesFromServer } from '../utils/routeStorage';
import { findNextStop } from '../utils/routeHelpers';

const DataContext = createContext();

export const useData = () => {
    return useContext(DataContext);
};

export const DataProvider = ({ children }) => {
    const [buses, setBuses] = useState([]);
    const [routes, setRoutes] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [lastUpdated, setLastUpdated] = useState(Date.now());

    // MQTT Client Ref
    const mqttClientRef = useRef(null);

    // Initial Data Load
    useEffect(() => {
        let isMounted = true;

        const loadInitialData = async () => {
            try {
                setLoading(true);
                await downloadRoutesFromServer(); // Sync routes to local storage

                // 1. Fetch Routes (with stops)
                const apiUrl = await getApiUrl();
                const routesRes = await axios.get(`${apiUrl}/api/routes`, { timeout: 5000 });
                const routesData = routesRes.data || [];

                // Fetch stops for each route
                const fullRoutes = await Promise.all(routesData.map(async (r) => {
                    try {
                        const stopsRes = await axios.get(`${apiUrl}/api/routes/${r.id}/stops`);
                        return { ...r, waypoints: stopsRes.data || [] };
                    } catch (e) {
                        return { ...r, waypoints: [] };
                    }
                }));

                if (isMounted) setRoutes(fullRoutes);

                // 2. Fetch Buses
                await fetchBuses();

                // 3. Connect MQTT
                connectMqtt();

            } catch (err) {
                console.error("[DataContext] Initial load error:", err);
                if (isMounted) setError(err.message);
            } finally {
                if (isMounted) setLoading(false);
            }
        };

        loadInitialData();

        // Polling fallback every 10 seconds
        const interval = setInterval(() => {
            fetchBuses();
        }, 10000);

        return () => {
            isMounted = false;
            clearInterval(interval);
            if (mqttClientRef.current) {
                mqttClientRef.current.end();
            }
        };
    }, []);

    const fetchBuses = async () => {
        try {
            const apiUrl = await getApiUrl();
            const response = await axios.get(`${apiUrl}/api/buses`, { timeout: 5000 });

            if (response.data && Array.isArray(response.data)) {
                setBuses(prevBuses => {
                    // Flatten API data and parse timestamps
                    const apiBuses = response.data.map(b => {
                        let timeVal = 0;
                        if (b.last_updated) {
                            let dateStr = b.last_updated;
                            if (typeof dateStr === 'string' && !dateStr.endsWith('Z') && !dateStr.includes('+')) {
                                dateStr += 'Z';
                            }
                            timeVal = new Date(dateStr).getTime();
                            if (isNaN(timeVal)) timeVal = 0;
                        }
                        return { ...b, last_updated: timeVal };
                    });

                    const mergedBuses = [...prevBuses];

                    apiBuses.forEach(apiBus => {
                        const apiId = apiBus.bus_mac || apiBus.mac_address || apiBus.id;
                        const existingIdx = mergedBuses.findIndex(b => {
                            const localId = b.bus_mac || b.mac_address || b.id;
                            return localId === apiId;
                        });

                        let finalName = apiBus.bus_name;

                        if (existingIdx > -1) {
                            const existing = mergedBuses[existingIdx];

                            // Name protection
                            if (existing.bus_name && existing.bus_name !== 'Bus' && !existing.bus_name.startsWith('Bus-')) {
                                if (!apiBus.bus_name || apiBus.bus_name.startsWith('Bus-')) {
                                    finalName = existing.bus_name;
                                }
                            }

                            // Smart Merge
                            const localIsFresher = (existing.last_updated || 0) > (apiBus.last_updated || 0);

                            if (localIsFresher) {
                                mergedBuses[existingIdx] = {
                                    ...apiBus,
                                    ...existing,
                                    bus_name: finalName
                                };
                            } else {
                                // API is fresher - merge but preserve existing values if API has null/0
                                const getValidValue = (apiVal, existingVal) => {
                                    // Keep existing if API value is null, undefined, or 0 (no GPS fix)
                                    if (apiVal === null || apiVal === undefined || apiVal === 0) {
                                        return existingVal;
                                    }
                                    return apiVal;
                                };

                                mergedBuses[existingIdx] = {
                                    ...existing,
                                    ...apiBus,
                                    bus_name: finalName,
                                    rssi: existing.rssi,
                                    isOnline: existing.isOnline,
                                    lastSignalUpdate: existing.lastSignalUpdate,
                                    // Preserve location if API returns null/0
                                    current_lat: getValidValue(apiBus.current_lat, existing.current_lat),
                                    current_lon: getValidValue(apiBus.current_lon, existing.current_lon),
                                    // Preserve sensor data if API returns null/0
                                    pm2_5: getValidValue(apiBus.pm2_5, existing.pm2_5),
                                    pm10: getValidValue(apiBus.pm10, existing.pm10),
                                    temp: getValidValue(apiBus.temp, existing.temp),
                                    hum: getValidValue(apiBus.hum, existing.hum),
                                    seats_available: getValidValue(apiBus.seats_available, existing.seats_available),
                                };
                            }
                        } else {
                            mergedBuses.push({ ...apiBus, bus_name: finalName });
                        }
                    });
                    return mergedBuses;
                });
                setLastUpdated(Date.now());
            }
        } catch (error) {
            console.log("[DataContext] Error fetching buses:", error.message);
        }
    };

    const connectMqtt = async () => {
        try {
            const overrideIp = await AsyncStorage.getItem('serverIp');
            const host = overrideIp || MQTT_CONFIG.host;
            const mqttUrl = `ws://${host}:${MQTT_CONFIG.wsPort}`;

            // Prevent multiple connections
            if (mqttClientRef.current?.connected) return;

            console.log('[DataContext] Connecting to MQTT...', mqttUrl);
            const client = mqtt.connect(mqttUrl);
            mqttClientRef.current = client;

            client.on('connect', () => {
                console.log('[DataContext] Connected to MQTT Broker');
                client.subscribe('sut/app/bus/location');
                client.subscribe('sut/bus/gps/fast');
                client.subscribe('sut/bus/gps');
                client.subscribe('sut/person-detection');
                client.subscribe('sut/bus/+/status');
            });

            client.on('message', (topic, message) => {
                try {
                    const data = JSON.parse(message.toString());
                    handleMqttMessage(topic, data);
                } catch (e) {
                    console.log("[DataContext] MQTT Parse Error", e);
                }
            });

            client.on('error', (err) => console.error('[DataContext] MQTT Error:', err));

        } catch (e) {
            console.error("[DataContext] MQTT Setup Error:", e);
        }
    };

    const handleMqttMessage = (topic, data) => {
        // console.log(`[DataContext] MQTT Update: ${topic}`);

        if (topic === 'sut/app/bus/location' || topic === 'sut/bus/gps') {
            setBuses(prevBuses => {
                const apiId = data.bus_mac; // Assuming data always has bus_mac
                const existingIdx = prevBuses.findIndex(b => (b.bus_mac || b.mac_address || b.id) === apiId);

                if (existingIdx > -1) {
                    const updated = [...prevBuses];
                    const oldBus = updated[existingIdx];
                    updated[existingIdx] = {
                        ...oldBus,
                        bus_name: data.bus_name || oldBus.bus_name,
                        current_lat: (data.lat !== null && data.lat !== undefined) ? data.lat : oldBus.current_lat,
                        current_lon: (data.lon !== null && data.lon !== undefined) ? data.lon : oldBus.current_lon,
                        seats_available: data.seats_available ?? oldBus.seats_available,
                        pm2_5: data.pm2_5 ?? oldBus.pm2_5,
                        pm10: data.pm10 ?? oldBus.pm10,
                        temp: data.temp ?? oldBus.temp,
                        hum: data.hum ?? oldBus.hum,
                        last_updated: Date.now() // Instant Wake up
                    };
                    return updated;
                } else {
                    return [...prevBuses, {
                        id: data.bus_mac,
                        bus_mac: data.bus_mac,
                        mac_address: data.bus_mac,
                        bus_name: data.bus_name || `Bus-${data.bus_mac?.slice(-4)}`,
                        current_lat: data.lat,
                        current_lon: data.lon,
                        last_updated: Date.now()
                    }];
                }
            });
        }
        else if (topic === 'sut/bus/gps/fast') {
            setBuses(prevBuses => {
                const idx = prevBuses.findIndex(b => (b.bus_mac || b.mac_address || b.id) === data.bus_mac);
                if (idx > -1 && data.lat != null && data.lon != null) {
                    const updated = [...prevBuses];
                    updated[idx] = {
                        ...updated[idx],
                        current_lat: data.lat,
                        current_lon: data.lon,
                        last_updated: Date.now()
                    };
                    return updated;
                }
                return prevBuses;
            });
        }
        else if (topic.includes('/status')) {
            const parts = topic.split('/');
            const busId = parts[2];

            if (busId && data.rssi !== undefined) {
                setBuses(prevBuses => {
                    const idx = prevBuses.findIndex(b => (b.bus_mac || b.mac_address || b.id) === busId);
                    if (idx > -1) {
                        const updated = [...prevBuses];
                        updated[idx] = {
                            ...updated[idx],
                            rssi: data.rssi,
                            isOnline: true,
                            lastSignalUpdate: Date.now(),
                            last_updated: Date.now()
                        };
                        return updated;
                    }
                    return prevBuses;
                });
            }
        }
    };

    return (
        <DataContext.Provider value={{ buses, routes, loading, error, refreshBuses: fetchBuses }}>
            {children}
        </DataContext.Provider>
    );
};
