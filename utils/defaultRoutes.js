/**
 * Default Routes Loader
 * 
 * Loads bundled route JSON files into AsyncStorage on first app launch.
 * This ensures the red_routes.json (and any other default routes) are
 * available in the Routes tab and Bus Route Admin.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { saveRoute } from './routeStorage';

// Import bundled route files directly
import redRoutes from '../routes/red_routes.json';

// Add more default routes here:
// import greenRoutes from '../routes/green_routes.json';

const DEFAULT_ROUTES_KEY = '@default_routes_loaded';

/**
 * List of default routes to load
 */
const defaultRoutes = [
    redRoutes,
    // greenRoutes,
];

/**
 * Load default routes into AsyncStorage if not already loaded
 * Call this once on app startup
 */
export const loadDefaultRoutes = async () => {
    try {
        // Check if we've already loaded defaults
        const loaded = await AsyncStorage.getItem(DEFAULT_ROUTES_KEY);
        if (loaded === 'true') {
            console.log('[DefaultRoutes] Already loaded, skipping');
            return;
        }

        console.log('[DefaultRoutes] Loading default routes...');

        for (const route of defaultRoutes) {
            if (route && route.routeId && route.routeName && route.waypoints) {
                await saveRoute(
                    route.routeId,
                    route.routeName,
                    route.waypoints,
                    route.busId || null,
                    route.routeColor || '#2563eb'
                );
                console.log(`[DefaultRoutes] Loaded: ${route.routeName}`);
            }
        }

        // Mark as loaded
        await AsyncStorage.setItem(DEFAULT_ROUTES_KEY, 'true');
        console.log('[DefaultRoutes] All default routes loaded');
    } catch (error) {
        console.error('[DefaultRoutes] Error loading defaults:', error);
    }
};

/**
 * Force reload default routes (useful for updates)
 */
export const reloadDefaultRoutes = async () => {
    await AsyncStorage.removeItem(DEFAULT_ROUTES_KEY);
    await loadDefaultRoutes();
};
