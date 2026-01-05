import AsyncStorage from '@react-native-async-storage/async-storage';
import { API_BASE, getApiHeaders } from '../config/api';

const MAPPING_KEY = '@bus_route_mapping';

/**
 * Bus Route Mapping Utility
 * Maps bus MAC addresses to route IDs
 * Format: { "BUS_MAC": "routeId", ... }
 */

/**
 * Get all bus-route mappings
 * @returns {Promise<Object>} - Map of bus MAC to route ID
 */
export const getAllMappings = async () => {
    try {
        const json = await AsyncStorage.getItem(MAPPING_KEY);
        return json ? JSON.parse(json) : {};
    } catch (error) {
        console.error('Error getting bus mappings:', error);
        return {};
    }
};

/**
 * Assign a route to a bus
 * @param {string} busMac - Bus MAC address
 * @param {string} routeId - Route ID to assign (or null to unassign)
 */
export const assignRouteToBus = async (busMac, routeId) => {
    try {
        const mappings = await getAllMappings();
        if (routeId) {
            mappings[busMac] = routeId;
        } else {
            delete mappings[busMac];
        }
        await AsyncStorage.setItem(MAPPING_KEY, JSON.stringify(mappings));
        return true;
    } catch (error) {
        console.error('Error assigning route to bus:', error);
        return false;
    }
};

/**
 * Get the route ID assigned to a specific bus
 * @param {string} busMac - Bus MAC address
 * @returns {Promise<string|null>} - Route ID or null
 */
export const getRouteIdForBus = async (busMac) => {
    try {
        const mappings = await getAllMappings();
        return mappings[busMac] || null;
    } catch (error) {
        console.error('Error getting route for bus:', error);
        return null;
    }
};

/**
 * Bulk assign the same route to multiple buses
 * @param {string[]} busMacs - Array of bus MAC addresses
 * @param {string} routeId - Route ID to assign
 */
export const assignRouteToMultipleBuses = async (busMacs, routeId) => {
    try {
        const mappings = await getAllMappings();
        busMacs.forEach(mac => {
            if (routeId) {
                mappings[mac] = routeId;
            } else {
                delete mappings[mac];
            }
        });
        await AsyncStorage.setItem(MAPPING_KEY, JSON.stringify(mappings));
        return true;
    } catch (error) {
        console.error('Error bulk assigning routes:', error);
        return false;
    }
};

const VERSION_KEY = '@bus_route_mapping_version';

/**
 * Fetch the latest bus-route mapping from server and sync to local storage
 * @param {string} serverUrl - Server base URL (uses API_BASE from config by default)
 * @returns {Promise<boolean>} - True if updated, false if already up-to-date or error
 */
export const fetchAndSyncMappings = async (serverUrl = API_BASE) => {
    try {
        // Get current local version
        const localVersionStr = await AsyncStorage.getItem(VERSION_KEY);
        const localVersion = localVersionStr ? parseInt(localVersionStr, 10) : 0;

        // Fetch from server with version check
        const response = await fetch(`${serverUrl}/api/bus-route-mapping?version=${localVersion}`, {
            headers: getApiHeaders(),
        });
        if (!response.ok) {
            console.log('[BusRouteMapping] Server unavailable');
            return false;
        }

        const data = await response.json();

        // Check if already up-to-date
        if (data.upToDate) {
            console.log('[BusRouteMapping] Already up-to-date (v' + localVersion + ')');
            return false;
        }

        // Parse and save new mappings
        const newMappings = {};
        if (data.mappings && Array.isArray(data.mappings)) {
            data.mappings.forEach(m => {
                if (m.bus_mac && m.route_id) {
                    newMappings[m.bus_mac] = m.route_id;
                }
            });
        }

        await AsyncStorage.setItem(MAPPING_KEY, JSON.stringify(newMappings));
        await AsyncStorage.setItem(VERSION_KEY, String(data.version));

        console.log(`[BusRouteMapping] Updated to v${data.version} with ${Object.keys(newMappings).length} mappings`);
        return true;
    } catch (error) {
        console.log('[BusRouteMapping] Sync error:', error.message);
        return false;
    }
};

/**
 * Get stored mapping version
 */
export const getMappingVersion = async () => {
    try {
        const version = await AsyncStorage.getItem(VERSION_KEY);
        return version ? parseInt(version, 10) : 0;
    } catch {
        return 0;
    }
};
