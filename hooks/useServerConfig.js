import { useState, useEffect } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ENV } from '../config/env';

// Default IP from centralized config
const DEFAULT_SERVER_IP = ENV.EXPO_PUBLIC_SERVER_IP;

export const useServerConfig = () => {
    const [serverIp, setServerIp] = useState(DEFAULT_SERVER_IP);

    useEffect(() => {
        const loadServerIp = async () => {
            try {
                // Check AsyncStorage first (user override), fallback to config
                const ip = await AsyncStorage.getItem('serverIp') || DEFAULT_SERVER_IP;
                setServerIp(ip);
            } catch (error) {
                console.error('Failed to load server IP:', error);
            }
        };
        loadServerIp();
    }, []);

    const saveServerIp = async (ip) => {
        try {
            setServerIp(ip);
            await AsyncStorage.setItem('serverIp', ip);
        } catch (error) {
            console.error('Failed to save server IP:', error);
        }
    };

    return { serverIp, setServerIp: saveServerIp };
};
