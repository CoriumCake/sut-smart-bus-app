const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

config.resolver.extraNodeModules = {
    ...config.resolver.extraNodeModules,
    stream: require.resolve('stream-browserify'),
    url: require.resolve('url'),
    buffer: require.resolve('buffer'),
    events: require.resolve('events'),
    process: require.resolve('process'),
};

module.exports = config;
