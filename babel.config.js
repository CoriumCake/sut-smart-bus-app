module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    plugins: [
      'react-native-reanimated/plugin',
      [
        'module-resolver',
        {
          alias: {
            stream: 'stream-browserify',
            buffer: 'buffer',
            events: 'events',
            process: 'process/browser',
            url: 'url',
          },
        },
      ],
    ],
  };
};
