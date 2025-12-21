import React, { createContext, useContext, useState, useEffect } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Alert } from 'react-native';
import * as Notifications from 'expo-notifications';

const NOTIFICATIONS_KEY = '@notifications_enabled';

// Configure notification handler - wrap in try/catch for Expo Go
try {
    Notifications.setNotificationHandler({
        handleNotification: async () => ({
            shouldShowAlert: true,
            shouldPlaySound: true,
            shouldSetBadge: false,
        }),
    });
} catch (e) {
    console.log('Notification handler setup skipped (Expo Go)');
}

const NotificationContext = createContext();

export const useNotifications = () => {
    const context = useContext(NotificationContext);
    if (!context) {
        throw new Error('useNotifications must be used within a NotificationProvider');
    }
    return context;
};

export const NotificationProvider = ({ children }) => {
    const [enabled, setEnabled] = useState(false);
    const [permissionGranted, setPermissionGranted] = useState(false);

    // Load saved preference
    useEffect(() => {
        const init = async () => {
            try {
                const saved = await AsyncStorage.getItem(NOTIFICATIONS_KEY);
                if (saved === 'true') {
                    setEnabled(true);
                }

                // Try to check permission status
                try {
                    const { status } = await Notifications.getPermissionsAsync();
                    setPermissionGranted(status === 'granted');
                } catch (e) {
                    console.log('Permission check skipped (Expo Go limitation)');
                }
            } catch (e) {
                console.error('Error initializing notifications:', e);
            }
        };
        init();
    }, []);

    const toggleNotifications = async () => {
        try {
            if (!enabled) {
                // Try to request permission
                try {
                    const { status } = await Notifications.requestPermissionsAsync();
                    if (status === 'granted') {
                        setPermissionGranted(true);
                    }
                } catch (e) {
                    console.log('Permission request skipped (Expo Go)');
                }
            }

            const newValue = !enabled;
            setEnabled(newValue);
            await AsyncStorage.setItem(NOTIFICATIONS_KEY, newValue.toString());
            return true;
        } catch (e) {
            console.error('Error toggling notifications:', e);
            return false;
        }
    };

    // Send a local notification
    const sendNotification = async (title, body, data = {}) => {
        if (!enabled) return;

        try {
            await Notifications.scheduleNotificationAsync({
                content: {
                    title,
                    body,
                    data,
                    sound: true,
                },
                trigger: null,
            });
        } catch (e) {
            // Just log in Expo Go - this is expected
            console.log(`[Notification] ${title}: ${body}`);
        }
    };

    // Notify when bus is arriving at stop
    const notifyBusArriving = async (busName, stopName, minutes) => {
        await sendNotification(
            '🚌 Bus Arriving Soon',
            `${busName} arriving at ${stopName} in ${minutes} minutes`,
            { type: 'bus_arriving', busName, stopName, minutes }
        );
    };

    // Notify when approaching destination (Grab-style)
    const notifyApproachingStop = async (stopName) => {
        await sendNotification(
            '📍 Approaching Your Stop',
            `You're approaching ${stopName}. Get ready!`,
            { type: 'approaching_stop', stopName }
        );
    };

    // Notify when arrived at destination
    const notifyArrived = async (stopName) => {
        await sendNotification(
            '🎯 You Have Arrived',
            `You've arrived at ${stopName}`,
            { type: 'arrived', stopName }
        );
    };

    return (
        <NotificationContext.Provider value={{
            enabled,
            permissionGranted,
            toggleNotifications,
            sendNotification,
            notifyBusArriving,
            notifyApproachingStop,
            notifyArrived,
        }}>
            {children}
        </NotificationContext.Provider>
    );
};
