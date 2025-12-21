export const getAirQualityStatus = (value) => {
    if (value == null) return { status: 'No Data', color: 'gray', solidColor: 'gray' };
    if (value <= 25) return { status: 'Good', color: 'rgba(0, 255, 0, 0.4)', solidColor: 'green' };
    if (value <= 50) return { status: 'Moderate', color: 'rgba(255, 255, 0, 0.4)', solidColor: '#CCCC00' };
    if (value <= 75) return { status: 'Unhealthy (Sensitive)', color: 'rgba(255, 165, 0, 0.4)', solidColor: 'orange' };
    return { status: 'Unhealthy', color: 'rgba(255, 0, 0, 0.4)', solidColor: 'red' };
};
