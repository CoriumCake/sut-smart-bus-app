/**
 * Route Helpers
 * 
 * Utilities for working with routes and finding next stops
 */

/**
 * Calculate distance between two coordinates in meters
 */
export const calculateDistance = (lat1, lon1, lat2, lon2) => {
    const R = 6371e3; // Earth radius in meters
    const φ1 = lat1 * Math.PI / 180;
    const φ2 = lat2 * Math.PI / 180;
    const Δφ = (lat2 - lat1) * Math.PI / 180;
    const Δλ = (lon2 - lon1) * Math.PI / 180;

    const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
        Math.cos(φ1) * Math.cos(φ2) *
        Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return R * c;
};

/**
 * Find the closest waypoint index on a route to a given position
 */
export const findClosestWaypointIndex = (lat, lon, waypoints) => {
    if (!waypoints || waypoints.length === 0) return -1;

    let closestIndex = 0;
    let minDistance = Infinity;

    waypoints.forEach((wp, index) => {
        const wpLat = wp.latitude || wp.lat;
        const wpLon = wp.longitude || wp.lon;
        if (wpLat && wpLon) {
            const distance = calculateDistance(lat, lon, wpLat, wpLon);
            if (distance < minDistance) {
                minDistance = distance;
                closestIndex = index;
            }
        }
    });

    return closestIndex;
};

/**
 * Find the next stop along a route from current position
 * Returns { stopName, stopIndex, distance, eta }
 */
export const findNextStop = (busLat, busLon, waypoints, averageSpeedMps = 8.33) => {
    if (!waypoints || waypoints.length === 0 || !busLat || !busLon) {
        return null;
    }

    // Find current position on route
    const currentIndex = findClosestWaypointIndex(busLat, busLon, waypoints);

    // Find next stop after current position
    for (let i = currentIndex; i < waypoints.length; i++) {
        const wp = waypoints[i];
        if (wp.isStop) {
            const wpLat = wp.latitude || wp.lat;
            const wpLon = wp.longitude || wp.lon;
            const distance = calculateDistance(busLat, busLon, wpLat, wpLon);
            const etaSeconds = distance / averageSpeedMps;
            const etaMinutes = Math.max(1, Math.round(etaSeconds / 60));

            return {
                stopName: wp.stopName || `Stop ${i + 1}`,
                stopIndex: i,
                distance: Math.round(distance),
                etaMinutes,
            };
        }
    }

    // If no stop found ahead, wrap around to first stop
    for (let i = 0; i < currentIndex; i++) {
        const wp = waypoints[i];
        if (wp.isStop) {
            return {
                stopName: wp.stopName || `Stop ${i + 1}`,
                stopIndex: i,
                distance: null, // Unknown, wrapping route
                etaMinutes: null,
            };
        }
    }

    return null;
};

/**
 * Get all stops from a route's waypoints
 */
export const getStopsFromRoute = (waypoints) => {
    if (!waypoints) return [];
    return waypoints
        .filter(wp => wp.isStop)
        .map((wp, index) => ({
            name: wp.stopName || `Stop ${index + 1}`,
            latitude: wp.latitude || wp.lat,
            longitude: wp.longitude || wp.lon,
        }));
};
