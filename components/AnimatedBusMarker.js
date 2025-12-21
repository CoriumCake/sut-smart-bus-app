import React, { useEffect, useRef } from 'react';
import { Image } from 'react-native';
import { AnimatedRegion, Marker } from 'react-native-maps';

const DEFAULT_DELTA = 0.001;

const AnimatedBusMarker = ({ coordinate, busId }) => {
  const animatedCoordinate = useRef(
    new AnimatedRegion({
      latitude: coordinate.latitude,
      longitude: coordinate.longitude,
      latitudeDelta: DEFAULT_DELTA,
      longitudeDelta: DEFAULT_DELTA,
    }),
  ).current;

  useEffect(() => {
    animatedCoordinate.timing({
      latitude: coordinate.latitude,
      longitude: coordinate.longitude,
      duration: 1000,
      useNativeDriver: false,
    }).start();
  }, [animatedCoordinate, coordinate.latitude, coordinate.longitude]);

  return (
    <Marker.Animated
      identifier={`bus-${busId}`}
      coordinate={animatedCoordinate}
      anchor={{ x: 0.5, y: 0.5 }}
    >
      <Image
        source={require('../assets/bus_icon.png')}
        style={{ width: 30, height: 30, resizeMode: 'contain' }}
      />
    </Marker.Animated>
  );
};

export default AnimatedBusMarker;
