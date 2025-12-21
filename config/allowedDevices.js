/**
 * Allowed Developer Devices
 * 
 * Only devices listed here can enable Debug Mode.
 * 
 * To add a new device:
 * 1. Install the app on the device
 * 2. Go to Settings → Copy the Device ID
 * 3. Add the ID to this list
 */

export const ALLOWED_DEV_DEVICES = [
    // Android devices (Android ID)
    'c42d9922ffdae4a9',

    // iOS devices (IDFV)
    'CDE636D0-FFA5-4069-BC73-1F1DF3DB2304',

    // Add more dev team device IDs below:
    // 'another-device-id',
];

/**
 * Check if a device ID is in the allowlist
 * @param {string} deviceId - The device ID to check
 * @returns {boolean} - True if device is allowed
 */
export const isDeviceAllowed = (deviceId) => {
    if (!deviceId) return false;
    // Case-insensitive comparison for flexibility
    return ALLOWED_DEV_DEVICES.some(
        allowed => allowed.toLowerCase() === deviceId.toLowerCase()
    );
};
