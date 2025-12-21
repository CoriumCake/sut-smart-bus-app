import AsyncStorage from '@react-native-async-storage/async-storage';

const ROUTES_STORAGE_KEY = '@sut_bus_routes';

/**
 * Route Storage Utility
 * Manages saving, loading, and manipulating bus routes in AsyncStorage
 */

// Generate unique route ID
export const generateRouteId = () => {
    return `route_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
};

/**
 * Save a route to storage
 * @param {string} routeId - Unique route identifier
 * @param {string} routeName - Human-readable route name
 * @param {Array} waypoints - Array of {latitude, longitude} objects
 * @returns {Promise<boolean>} Success status
 */
export const saveRoute = async (routeId, routeName, waypoints, busId = null, routeColor = '#2563eb') => {
    try {
        const route = {
            routeId,
            routeName,
            waypoints,
            busId,
            routeColor,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
        };

        // Get existing routes
        const existingRoutes = await getAllRoutes();

        // Check if route exists (update) or is new
        const routeIndex = existingRoutes.findIndex(r => r.routeId === routeId);

        if (routeIndex >= 0) {
            // Update existing route
            existingRoutes[routeIndex] = {
                ...existingRoutes[routeIndex],
                routeName,
                waypoints,
                busId: busId !== null ? busId : existingRoutes[routeIndex].busId,
                routeColor: routeColor || existingRoutes[routeIndex].routeColor || '#2563eb',
                updatedAt: new Date().toISOString(),
            };
        } else {
            // Add new route
            existingRoutes.push(route);
        }

        // Save back to storage
        await AsyncStorage.setItem(ROUTES_STORAGE_KEY, JSON.stringify(existingRoutes));
        return true;
    } catch (error) {
        console.error('Error saving route:', error);
        return false;
    }
};

/**
 * Load a specific route by ID
 * @param {string} routeId - Route identifier
 * @returns {Promise<Object|null>} Route object or null if not found
 */
export const loadRoute = async (routeId) => {
    try {
        const routes = await getAllRoutes();
        return routes.find(r => r.routeId === routeId) || null;
    } catch (error) {
        console.error('Error loading route:', error);
        return null;
    }
};

/**
 * Get all saved routes
 * @returns {Promise<Array>} Array of route objects
 */
export const getAllRoutes = async () => {
    try {
        const routesJson = await AsyncStorage.getItem(ROUTES_STORAGE_KEY);
        if (!routesJson) return [];
        return JSON.parse(routesJson);
    } catch (error) {
        console.error('Error getting all routes:', error);
        return [];
    }
};

/**
 * Delete a route from storage
 * @param {string} routeId - Route identifier
 * @returns {Promise<boolean>} Success status
 */
export const deleteRoute = async (routeId) => {
    try {
        const routes = await getAllRoutes();
        const filteredRoutes = routes.filter(r => r.routeId !== routeId);
        await AsyncStorage.setItem(ROUTES_STORAGE_KEY, JSON.stringify(filteredRoutes));
        return true;
    } catch (error) {
        console.error('Error deleting route:', error);
        return false;
    }
};

/**
 * Export a route as JSON string
 * @param {string} routeId - Route identifier
 * @returns {Promise<string|null>} JSON string or null
 */
export const exportRouteToJSON = async (routeId) => {
    try {
        const route = await loadRoute(routeId);
        if (!route) return null;
        return JSON.stringify(route, null, 2);
    } catch (error) {
        console.error('Error exporting route:', error);
        return null;
    }
};

/**
 * Import a route from JSON string
 * @param {string} jsonString - JSON string containing route data
 * @returns {Promise<Object|null>} Imported route object or null if invalid
 */
export const importRouteFromJSON = async (jsonString) => {
    try {
        const route = JSON.parse(jsonString);

        // Validate route structure
        if (!route.routeName || !Array.isArray(route.waypoints)) {
            throw new Error('Invalid route format');
        }

        // Validate waypoints
        const validWaypoints = route.waypoints.every(
            wp => typeof wp.latitude === 'number' && typeof wp.longitude === 'number'
        );

        if (!validWaypoints) {
            throw new Error('Invalid waypoint format');
        }

        // Generate new ID to avoid conflicts
        const newRouteId = generateRouteId();

        // Save the imported route
        await saveRoute(newRouteId, route.routeName, route.waypoints);

        return { routeId: newRouteId, routeName: route.routeName };
    } catch (error) {
        console.error('Error importing route:', error);
        return null;
    }
};

/**
 * Export all routes as JSON string
 * @returns {Promise<string|null>} JSON string containing all routes
 */
export const exportAllRoutesToJSON = async () => {
    try {
        const routes = await getAllRoutes();
        return JSON.stringify(routes, null, 2);
    } catch (error) {
        console.error('Error exporting all routes:', error);
        return null;
    }
};
