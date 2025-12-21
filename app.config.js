import 'dotenv/config';

export default {
    expo: {
        name: "SUT Smart Bus",
        slug: "sut_smart_bus",
        version: "1.0.0",
        splash: {
            image: "./assets/splash.png",
            resizeMode: "contain",
            backgroundColor: "#F57C00"
        },
        assetBundlePatterns: [
            "**/*"
        ],
        android: {
            package: "com.catcode.sut_smart_bus",
            usesCleartextTraffic: true,
            config: {
                googleMaps: {
                    apiKey: process.env.GOOGLE_MAPS_API_KEY
                }
            }
        },
        ios: {
            bundleIdentifier: "com.catcode.sut_smart_bus"
        },
        extra: {
            googleMapsApiKey: process.env.GOOGLE_MAPS_API_KEY,
            eas: {
                projectId: "5c7c41b7-4094-4bd2-a59d-f93de05c731a"
            }
        }
    }
};
