import React, { useState, useEffect, useRef } from 'react';
import { MapContainer, TileLayer, Marker, Popup, Polyline } from 'react-leaflet';
import { useQuery, gql } from '@apollo/client';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

// Custom animated bus icon
const createAnimatedBusIcon = (heading, lineName, isSelected = false, hasRealPosition = true, positionSource = 'unknown') => {
  const rotation = heading || 0;
  const backgroundColor = isSelected ? '#FF0000' : getVehicleColor(lineName);
  const borderColor = isSelected ? '#FFFFFF' : '#FFFFFF';
  
  // Determine position indicator color
  let positionIndicatorColor = '#28a745'; // Green for real GPS
  let positionIndicatorTooltip = 'Real GPS Position';
  
  if (positionSource === 'text_location') {
    positionIndicatorColor = '#28a745'; // Green
    positionIndicatorTooltip = 'Real GPS (from location text)';
  } else if (positionSource === 'route_based') {
    positionIndicatorColor = '#ffc107'; // Yellow
    positionIndicatorTooltip = 'Route-based position';
  } else if (positionSource === 'simulated') {
    positionIndicatorColor = '#ffc107'; // Yellow
    positionIndicatorTooltip = 'Simulated position';
  } else if (!hasRealPosition) {
    positionIndicatorColor = '#ffc107'; // Yellow
    positionIndicatorTooltip = 'Assigned position';
  }
  
  return L.divIcon({
    html: `
      <div style="
        position: relative;
        transform: rotate(${rotation}deg);
        transition: transform 1s ease-out;
      ">
        <div style="
          background: ${backgroundColor};
          width: ${isSelected ? '36px' : '32px'};
          height: ${isSelected ? '22px' : '18px'};
          border-radius: 4px;
          border: 3px solid ${borderColor};
          box-shadow: 0 2px 8px rgba(0,0,0,0.3);
          display: flex;
          align-items: center;
          justify-content: center;
          font-weight: bold;
          color: white;
          font-size: ${isSelected ? '13px' : '12px'};
          position: relative;
          cursor: pointer;
        ">
          ${lineName}
          <div style="
            position: absolute;
            top: -8px;
            left: 50%;
            transform: translateX(-50%);
            width: 8px;
            height: 8px;
            background: ${backgroundColor};
            border-radius: 50%;
            border: 2px solid white;
          "></div>
          ${isSelected ? '<div style="position: absolute; top: -4px; right: -4px; width: 12px; height: 12px; background: red; border-radius: 50%; border: 2px solid white;"></div>' : ''}
          <div 
            style="
              position: absolute; 
              top: -4px; 
              left: -4px; 
              width: 8px; 
              height: 8px; 
              background: ${positionIndicatorColor}; 
              border-radius: 50%; 
              border: 1px solid white;
              cursor: help;
            " 
            title="${positionIndicatorTooltip}"
          ></div>
        </div>
      </div>
    `,
    iconSize: isSelected ? [36, 36] : [32, 32],
    iconAnchor: isSelected ? [18, 18] : [16, 16],
    className: 'animated-vehicle-icon'
  });
};

// GraphQL query for vehicle tracking
const GET_VEHICLE_TRACKING = gql`
  query GetVehicleTracking($routeIds: [String!]) {
    vehicleTracking(routeIds: $routeIds) {
      id
      operationType
      vehicleId
      naptanId
      stationName
      lineId
      lineName
      platformName
      direction
      bearing
      destinationNaptanId
      destinationName
      timestamp
      timeToStation
      currentLocation
      towards
      expectedArrival
      timeToLive
      modeName
      timing {
        countdownServerAdjustment
        source
        insert
        read
        sent
        received
      }
      lat
      lon
      vehicleType
      isRealTime
      routeArea
      heading
      speed
      lastUpdated
      hasRealPosition
      positionSource
    }
  }
`;

// Helper function to get vehicle color based on line
const getVehicleColor = (lineName) => {
  const colors = {
    '1': '#FF3030',    // Red
    '12': '#FFA500',   // Orange
    '18': '#32CD32',   // Green
    '24': '#1E90FF',   // Blue
    '38': '#8A2BE2',   // Purple
    '55': '#FF69B4',   // Pink
    '73': '#00CED1',   // Turquoise
    '94': '#FFD700',   // Gold
    '137': '#FF6B35',  // Orange-red
    '148': '#9370DB',  // Medium purple
    '188': '#3CB371',  // Medium sea green
    '211': '#FF6347',  // Tomato
    '341': '#4682B4'   // Steel blue
  };
  return colors[lineName] || '#FF6B35'; // Default orange
};

const AnimatedVehicleMap = ({ vehicles: initialVehicles, selectedVehicle, onClose, showOnlySelected = false }) => {
  // Use GraphQL query to get live vehicle data
  const { loading, error, data, refetch } = useQuery(GET_VEHICLE_TRACKING, {
    variables: { routeIds: ["1", "12", "38", "55", "73", "94", "137", "148"] },
    pollInterval: 5000, // Refetch every 5 seconds to match simulation
    fetchPolicy: 'network-only', // Always fetch fresh data, don't use cache
    notifyOnNetworkStatusChange: true, // Notify when refetching
  });

  const [displayVehicles, setDisplayVehicles] = useState([]);
  const [initialBoundsSet, setInitialBoundsSet] = useState(false);
  const [realVehicleCount, setRealVehicleCount] = useState(0);
  const [mapReady, setMapReady] = useState(false);
  const [updatingSelectedVehicle, setUpdatingSelectedVehicle] = useState(false);
  const [selectedVehiclePositionSource, setSelectedVehiclePositionSource] = useState('unknown');
  const [isInitialLoad, setIsInitialLoad] = useState(true);
  const vehiclePositionCache = useRef(new Map()); // Cache vehicle positions by vehicleId
  const mapRef = useRef(null);

  // Track initial load vs refetch
  useEffect(() => {
    if (data?.vehicleTracking && isInitialLoad) {
      setIsInitialLoad(false);
    }
  }, [data?.vehicleTracking, isInitialLoad]);

  // Initialize vehicles with proper coordinates from GraphQL data
  useEffect(() => {
    const vehicles = data?.vehicleTracking || initialVehicles || [];

    if (!vehicles || vehicles.length === 0) {
      if (isInitialLoad) {
        console.log('❌ No vehicles available in AnimatedVehicleMap');
      }
      return;
    }

    console.log(`🚌 Received ${vehicles.length} vehicles from GraphQL query (${isInitialLoad ? 'initial load' : 'refetch'})`);

    // Log first few vehicles to debug coordinate issues
    console.log('🔍 Sample vehicle coordinates:', vehicles.slice(0, 5).map(v => ({
      id: v.vehicleId,
      lat: v.lat,
      lon: v.lon,
      lineName: v.lineName,
      positionSource: v.positionSource
    })));

    // Check if all vehicles have the same coordinates (clustering issue)
    const uniqueCoordinates = new Set(vehicles.map(v => `${v.lat?.toFixed(4)},${v.lon?.toFixed(4)}`).filter(c => c !== 'undefined,undefined'));
    const hasClusteringIssue = uniqueCoordinates.size === 1 && vehicles.length > 1;
    
    if (hasClusteringIssue) {
      console.warn(`⚠️ All ${vehicles.length} vehicles have identical coordinates! Will spread them out during processing...`);
    } else {
      console.log(`✅ Found ${uniqueCoordinates.size} unique coordinate sets out of ${vehicles.length} vehicles`);
    }

    // Process vehicles to ensure they have valid coordinates
    const processedVehicles = vehicles.map((vehicle, index) => {
      const vehicleId = vehicle.vehicleId || `vehicle-${index}`;
      const isSelected = selectedVehicle && selectedVehicle.vehicleId === vehicleId;
      
      // Check if we have a cached position for this vehicle (for stability)
      const cachedPos = vehiclePositionCache.current.get(vehicleId);
      
      // Check if vehicle has valid coordinates (not undefined, not null, not 0,0)
      const hasValidCoords = vehicle.lat !== undefined && 
                            vehicle.lat !== null && 
                            vehicle.lon !== undefined && 
                            vehicle.lon !== null &&
                            vehicle.lat !== 0 && 
                            vehicle.lon !== 0 &&
                            Math.abs(vehicle.lat) > 0.1 && // Must be a real coordinate
                            Math.abs(vehicle.lon) > 0.1;
      
      // Calculate coordinates
      let lat, lon;
      
      if (hasValidCoords) {
        // Use provided coordinates but add unique offset to prevent clustering
        // EXCEPT for selected vehicle - use real coordinates directly
        const baseLat = vehicle.lat;
        const baseLon = vehicle.lon;
        
        // Selected vehicle uses real coordinates without spreading
        if (isSelected && cachedPos) {
          lat = cachedPos.lat;
          lon = cachedPos.lon;
        } else if (isSelected) {
          // First time seeing selected vehicle - use real coordinates
          lat = baseLat;
          lon = baseLon;
          vehiclePositionCache.current.set(vehicleId, {
            lat, lon, baseLat, baseLon
          });
        } else {
          // Create unique offset based on vehicle ID and index
          let hash = 0;
          for (let i = 0; i < vehicleId.length; i++) {
            hash = vehicleId.charCodeAt(i) + ((hash << 5) - hash);
          }
          hash = Math.abs(hash);
          
          // Check if this vehicle shares coordinates with others (clustering)
          const sameCoordCount = vehicles.filter(v => 
            Math.abs(v.lat - baseLat) < 0.0001 && Math.abs(v.lon - baseLon) < 0.0001
          ).length;
          
          // Use MUCH larger spread if many vehicles share the same coordinates
          // This ensures vehicles are visible even when they have identical coordinates
          let spreadMultiplier;
          if (sameCoordCount > 50) {
            spreadMultiplier = 10; // ~5km spread for 50+ vehicles
          } else if (sameCoordCount > 20) {
            spreadMultiplier = 7; // ~3.5km spread for 20+ vehicles
          } else if (sameCoordCount > 10) {
            spreadMultiplier = 5; // ~2.5km spread for 10+ vehicles
          } else if (sameCoordCount > 5) {
            spreadMultiplier = 3; // ~1.5km spread for 5+ vehicles
          } else {
            spreadMultiplier = 1; // Normal spread for few vehicles
          }
          
          // Spread vehicles in a circle around the base position
          // Use vehicle ID hash for consistent positioning across refreshes
          // If we have a cached position and coordinates haven't changed much, use cached
          if (cachedPos && 
              Math.abs(cachedPos.baseLat - baseLat) < 0.001 && 
              Math.abs(cachedPos.baseLon - baseLon) < 0.001) {
            // Use cached position to maintain stability
            lat = cachedPos.lat;
            lon = cachedPos.lon;
          } else {
            // Calculate new position
            const angle = (hash % 360) * (Math.PI / 180) + (index * 0.05);
            const baseRadius = 0.005; // ~500m base spread (increased from 300m)
            const radius = baseRadius * spreadMultiplier + ((hash % 100) / 100) * 0.003;
            lat = baseLat + (Math.sin(angle) * radius);
            lon = baseLon + (Math.cos(angle) * radius);
            
            // Cache the position for stability
            vehiclePositionCache.current.set(vehicleId, {
              lat, lon, baseLat, baseLon
            });
          }
        }
      } else {
        // Generate unique coordinates based on vehicle ID and index
        console.warn(`⚠️ Vehicle ${vehicleId} (${vehicle.lineName}) missing/invalid coordinates, generating position`);
        
        // Check cache first
        if (cachedPos) {
          lat = cachedPos.lat;
          lon = cachedPos.lon;
        } else {
          // Use vehicle ID hash for consistent positioning
          let hash = 0;
          for (let i = 0; i < vehicleId.length; i++) {
            hash = vehicleId.charCodeAt(i) + ((hash << 5) - hash);
          }
          hash = Math.abs(hash);
          
          // Generate unique position based on hash and index
          const baseLat = 51.5074; // Central London
          const baseLon = -0.1278;
          const latSpread = 0.15; // ~15km spread
          const lonSpread = 0.2;   // ~20km spread
          
          lat = baseLat + ((hash % 1000) / 1000 - 0.5) * latSpread + (Math.sin(index * 0.618) * 0.02);
          lon = baseLon + (((hash * 7) % 1000) / 1000 - 0.5) * lonSpread + (Math.cos(index * 0.618) * 0.02);
          
          // Cache the generated position
          vehiclePositionCache.current.set(vehicleId, {
            lat, lon, baseLat, baseLon
          });
        }
      }
      
      // Calculate heading
      const heading = vehicle.heading || (vehicle.bearing ? parseInt(vehicle.bearing) : 
                     (vehicle.direction === 'inbound' ? 180 : 0));
      
      // Determine position source
      const positionSource = vehicle.positionSource || 
                            (vehicle.hasRealPosition === true ? 'text_location' : 'simulated');
      
      return {
        ...vehicle,
        id: vehicle.id || vehicle.vehicleId || `vehicle-${index}`,
        currentLat: lat,
        currentLon: lon,
        lat: lat,
        lon: lon,
        heading: Math.floor(heading),
        hasRealPosition: vehicle.hasRealPosition === true,
        vehicleIndex: index,
        positionSource: positionSource
      };
    });

    // Count real vehicles
    const realCount = processedVehicles.filter(v => v.hasRealPosition === true).length;
    setRealVehicleCount(realCount);
    
    // Log final processed coordinates to verify uniqueness
    const finalUniqueCoords = new Set(processedVehicles.map(v => `${v.currentLat.toFixed(6)},${v.currentLon.toFixed(6)}`));
    console.log(`📍 Final processed coordinates: ${finalUniqueCoords.size} unique positions out of ${processedVehicles.length} vehicles`);
    
    if (finalUniqueCoords.size < processedVehicles.length) {
      console.warn(`⚠️ Some vehicles still have duplicate coordinates!`);
      // Log duplicates
      const coordGroups = {};
      processedVehicles.forEach(v => {
        const key = `${v.currentLat.toFixed(6)},${v.currentLon.toFixed(6)}`;
        if (!coordGroups[key]) coordGroups[key] = [];
        coordGroups[key].push(v.vehicleId);
      });
      Object.entries(coordGroups).forEach(([coord, ids]) => {
        if (ids.length > 1) {
          console.warn(`  Duplicate at ${coord}: ${ids.length} vehicles (${ids.slice(0, 3).join(', ')}...)`);
        }
      });
    }
    
    // Filter to show only selected vehicle if showOnlySelected is true
    let vehiclesToDisplay = processedVehicles;
    if (showOnlySelected && selectedVehicle) {
      vehiclesToDisplay = processedVehicles.filter(v => 
        v.vehicleId === selectedVehicle.vehicleId
      );
      console.log(`🎯 Showing only selected vehicle: ${selectedVehicle.vehicleId} (${vehiclesToDisplay.length} vehicle)`);
    }
    
    setDisplayVehicles(vehiclesToDisplay);
    
    console.log(`📍 Vehicle breakdown: ${realCount} real, ${processedVehicles.length - realCount} simulated`);
    console.log('📍 Position sources:', {
      text_location: processedVehicles.filter(v => v.positionSource === 'text_location').length,
      route_based: processedVehicles.filter(v => v.positionSource === 'route_based').length,
      simulated: processedVehicles.filter(v => v.positionSource === 'simulated').length
    });

  }, [data?.vehicleTracking, initialVehicles, showOnlySelected, selectedVehicle]);

  // Update selected vehicle position periodically - MUST be before any early returns
  useEffect(() => {
    if (!selectedVehicle || !selectedVehicle.vehicleId) return;

    console.log(`🔄 Setting up selected vehicle updates for: ${selectedVehicle.vehicleId}`);

    // Initial position source
    const selectedVeh = displayVehicles.find(v => v.vehicleId === selectedVehicle.vehicleId);
    if (selectedVeh) {
      setSelectedVehiclePositionSource(selectedVeh.positionSource || 'unknown');
    }
    
    const updateSelectedVehiclePosition = async () => {
      if (updatingSelectedVehicle) return;
      
      setUpdatingSelectedVehicle(true);
      try {
        const response = await fetch('https://justinw.uk/tfl-api/graphql', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            query: `
              query GetSelectedVehiclePosition($vehicleId: String!) {
                selectedVehiclePosition(vehicleId: $vehicleId) {
                  vehicleId
                  lat
                  lon
                  heading
                  currentLocation
                  timeToStation
                  lastUpdated
                  hasRealPosition
                  positionSource
                }
              }
            `,
            variables: {
              vehicleId: selectedVehicle.vehicleId
            }
          })
        });
        
        const { data } = await response.json();
        if (data?.selectedVehiclePosition) {
          const updatedPosition = data.selectedVehiclePosition;
          
          // Update cache with new position (use real coordinates, no spreading for selected vehicle)
          vehiclePositionCache.current.set(selectedVehicle.vehicleId, {
            lat: updatedPosition.lat,
            lon: updatedPosition.lon,
            baseLat: updatedPosition.lat,
            baseLon: updatedPosition.lon
          });
          
          // Update the selected vehicle in the vehicles array
          // Use real coordinates directly (no spreading offset for selected vehicle)
          setDisplayVehicles(prevVehicles => 
            prevVehicles.map(vehicle => 
              vehicle.vehicleId === selectedVehicle.vehicleId 
                ? { 
                    ...vehicle, 
                    ...updatedPosition, 
                    currentLat: updatedPosition.lat, 
                    currentLon: updatedPosition.lon,
                    lat: updatedPosition.lat,
                    lon: updatedPosition.lon,
                    heading: updatedPosition.heading,
                    lastUpdated: updatedPosition.lastUpdated,
                    hasRealPosition: updatedPosition.hasRealPosition,
                    positionSource: updatedPosition.positionSource
                  }
                : vehicle
            )
          );
          
          setSelectedVehiclePositionSource(updatedPosition.positionSource);
          
          // Smoothly pan map to selected vehicle's new position if it's visible
          if (mapRef.current) {
            const newPos = [updatedPosition.lat, updatedPosition.lon];
            const currentCenter = mapRef.current.getCenter();
            const distance = Math.sqrt(
              Math.pow(newPos[0] - currentCenter.lat, 2) + 
              Math.pow(newPos[1] - currentCenter.lng, 2)
            );
            // Only pan if the new position is significantly different (more than ~1km)
            if (distance > 0.01) {
              mapRef.current.setView(newPos, mapRef.current.getZoom(), { animate: true, duration: 1.0 });
            }
          }
          
          console.log(`🔄 Updated position for ${selectedVehicle.vehicleId}:`, {
            lat: updatedPosition.lat.toFixed(6),
            lon: updatedPosition.lon.toFixed(6),
            source: updatedPosition.positionSource,
            heading: updatedPosition.heading,
            timeToStation: updatedPosition.timeToStation
          });
        }
      } catch (error) {
        console.log('⚠️ Could not update selected vehicle position:', error.message);
      } finally {
        setUpdatingSelectedVehicle(false);
      }
    };
    
    // Initial update
    updateSelectedVehiclePosition();
    
    // Set up interval for updates (every 15 seconds)
    const intervalId = setInterval(updateSelectedVehiclePosition, 15000);
    
    return () => {
      clearInterval(intervalId);
      console.log(`🛑 Stopped updates for selected vehicle: ${selectedVehicle.vehicleId}`);
    };
  }, [selectedVehicle, displayVehicles]);

  // Set initial map bounds when map is ready
  useEffect(() => {
    if (mapRef.current && displayVehicles.length > 0 && !initialBoundsSet && mapReady) {
      if (showOnlySelected && selectedVehicle) {
        // Zoom to selected vehicle only
        const selectedVeh = displayVehicles.find(v => v.vehicleId === selectedVehicle.vehicleId);
        if (selectedVeh) {
          mapRef.current.setView([selectedVeh.currentLat, selectedVeh.currentLon], 16, { animate: true });
          setInitialBoundsSet(true);
          console.log('🗺️ Map zoomed to selected vehicle only');
        }
      } else {
        // Zoom to fit all vehicles
        const positions = displayVehicles.map(v => [v.currentLat, v.currentLon]);
        if (positions.length > 0) {
          const bounds = L.latLngBounds(positions);
          mapRef.current.fitBounds(bounds, { 
            padding: [50, 50],
            maxZoom: 13,
            animate: true
          });
          setInitialBoundsSet(true);
          console.log('🗺️ Map bounds set to fit all vehicles');
        }
      }
    }
  }, [displayVehicles, initialBoundsSet, mapReady, showOnlySelected, selectedVehicle]);

  // Handle zoom to all vehicles
  const handleZoomToAll = () => {
    if (mapRef.current && displayVehicles.length > 0) {
      const positions = displayVehicles.map(v => [v.currentLat, v.currentLon]);
      if (positions.length > 0) {
        const bounds = L.latLngBounds(positions);
        mapRef.current.fitBounds(bounds, { 
          padding: [50, 50],
          maxZoom: 13,
          animate: true
        });
      }
    }
  };

  // Handle zoom to selected vehicle
  const handleZoomToSelected = () => {
    if (mapRef.current && selectedVehicle) {
      // Find the current position of the selected vehicle
      const selectedVeh = displayVehicles.find(v => v.vehicleId === selectedVehicle.vehicleId);
      if (selectedVeh && selectedVeh.lat && selectedVeh.lon) {
        const position = [selectedVeh.lat, selectedVeh.lon];
        mapRef.current.setView(position, 16, { animate: true });
        console.log(`📍 Zooming to selected vehicle: ${selectedVeh.vehicleId} at ${position[0].toFixed(6)}, ${position[1].toFixed(6)}`);
      }
    }
  };

  // Handle reset view to London center
  const handleResetView = () => {
    if (mapRef.current) {
      mapRef.current.setView([51.5074, -0.1278], 12, { animate: true });
    }
  };

  // Group vehicles by area for display
  const vehiclesByArea = {};
  displayVehicles.forEach(vehicle => {
    const area = vehicle.routeArea || 'Unknown Area';
    if (!vehiclesByArea[area]) {
      vehiclesByArea[area] = [];
    }
    vehiclesByArea[area].push(vehicle);
  });

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>🚍 Live Vehicle Tracker</h3>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>
        
        <div className="modal-body">
          {/* Only show loading screen on initial load, not during refetches */}
          {loading && isInitialLoad && (
            <div style={{ textAlign: 'center', padding: '50px' }}>
              <div className="spinner"></div>
              <p>Loading live vehicle positions...</p>
            </div>
          )}
          
          {error && isInitialLoad && (
            <div style={{ textAlign: 'center', padding: '50px' }}>
              <p style={{ color: 'red' }}>Error loading vehicles: {error.message}</p>
              <button 
                onClick={() => refetch()} 
                style={{ marginTop: '10px', padding: '8px 16px', background: '#4a6fa5', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}
              >
                Retry
              </button>
            </div>
          )}
          
          {/* Show content if not initial loading, or if we have vehicles to display */}
          {(!isInitialLoad || displayVehicles.length > 0) && !error && (
            <>
          <div className="vehicle-info">
            {showOnlySelected ? (
              <>
                <p><strong>🎯 Showing selected vehicle only</strong></p>
                <p>📍 <strong>{selectedVehicle?.lineName}</strong> to <strong>{selectedVehicle?.destinationName}</strong></p>
                <p>🔄 Selected vehicle position updates every 15 seconds</p>
              </>
            ) : (
              <>
                <p><strong>📡 Tracking {displayVehicles.length} vehicles across London</strong></p>
                <p>📍 <strong>{realVehicleCount}</strong> vehicles with real positions, <strong>{displayVehicles.length - realVehicleCount}</strong> with assigned positions</p>
                <p>🔄 Vehicle positions update every 5 seconds • Selected vehicle updates every 15 seconds</p>
              </>
            )}
            <p>
              <span style={{ color: '#28a745', fontWeight: 'bold' }}>● Real GPS position</span>{' '}
              <span style={{ color: '#ffc107', fontWeight: 'bold' }}>● Assigned/Route-based position</span>{' '}
              <span style={{ color: '#FF0000', fontWeight: 'bold' }}>● Selected vehicle</span>
            </p>
            {selectedVehicle && (
              <p style={{ background: '#fff3cd', padding: '8px', borderRadius: '4px', marginTop: '5px' }}>
                <strong>📍 Selected Vehicle:</strong> {selectedVehicle.lineName} to {selectedVehicle.destinationName} 
                {selectedVehicle.hasRealPosition ? ' (Real GPS position)' : ' (Assigned position)'}
                {updatingSelectedVehicle && <span style={{ marginLeft: '10px', color: '#007bff' }}>🔄 Updating...</span>}
                <br />
                <small>Position source: <strong>{selectedVehiclePositionSource}</strong> • Updates every 15s</small>
              </p>
            )}
            <div style={{ marginTop: '10px', display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
              {!showOnlySelected && (
                <button 
                  className="btn-secondary" 
                  onClick={handleZoomToAll}
                  style={{ fontSize: '0.9em', padding: '8px 12px' }}
                >
                  Zoom to All Vehicles
                </button>
              )}
              {selectedVehicle && (
                <button 
                  className="btn-secondary" 
                  onClick={handleZoomToSelected}
                  style={{ fontSize: '0.9em', padding: '8px 12px' }}
                  disabled={!selectedVehicle}
                >
                  Zoom to Selected
                </button>
              )}
              <button 
                className="btn-secondary" 
                onClick={handleResetView}
                style={{ fontSize: '0.9em', padding: '8px 12px' }}
              >
                Reset View
              </button>
              <button 
                className="btn-secondary" 
                onClick={() => {
                  console.log('🗺️ Debug Info:');
                  console.log(`- Total vehicles: ${displayVehicles.length}`);
                  console.log(`- Real positions: ${realVehicleCount}`);
                  console.log(`- Selected vehicle: ${selectedVehicle?.vehicleId || 'None'}`);
                  console.log(`- Selected position source: ${selectedVehiclePositionSource}`);
                  if (mapRef.current) {
                    const center = mapRef.current.getCenter();
                    const zoom = mapRef.current.getZoom();
                    console.log(`- Map center: ${center.lat.toFixed(4)}, ${center.lng.toFixed(4)}`);
                    console.log(`- Map zoom: ${zoom}`);
                  }
                }}
                style={{ fontSize: '0.9em', padding: '8px 12px' }}
              >
                Debug Info
              </button>
            </div>
          </div>
          
          <div className="modal-map-container" style={{ height: '500px', width: '100%' }}>
            <MapContainer
              center={[51.5074, -0.1278]}
              zoom={12}
              style={{ height: '100%', width: '100%' }}
              whenCreated={(mapInstance) => {
                mapRef.current = mapInstance;
                setMapReady(true);
                console.log('🗺️ Map instance created');
              }}
            >
              <TileLayer
                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                attribution='&copy; OpenStreetMap contributors'
              />
              
              {/* Vehicle markers */}
              {displayVehicles.map(vehicle => {
                const isSelected = selectedVehicle && selectedVehicle.vehicleId === vehicle.vehicleId;
                
                return (
                  <Marker
                    key={vehicle.id}
                    position={[vehicle.currentLat, vehicle.currentLon]}
                    icon={createAnimatedBusIcon(
                      vehicle.heading, 
                      vehicle.lineName, 
                      isSelected, 
                      vehicle.hasRealPosition,
                      vehicle.positionSource
                    )}
                  >
                    <Popup>
                      <div className="vehicle-popup">
                        <strong>🚌 {vehicle.lineName} to {vehicle.destinationName}</strong>
                        <br />
                        {isSelected && (
                          <React.Fragment>
                            <strong style={{ color: '#FF0000' }}>📍 SELECTED VEHICLE</strong>
                            <br />
                            <small style={{ color: '#666' }}>(Updates every 15s)</small>
                            <br />
                          </React.Fragment>
                        )}
                        <strong>Vehicle ID:</strong> {vehicle.vehicleId}
                        <br />
                        <strong>Status:</strong> {vehicle.timeToStation < 60 ? 'Approaching' : 'In transit'}
                        <br />
                        <strong>Position Type:</strong> {vehicle.hasRealPosition ? 'Real GPS' : 'Assigned (simulated)'}
                        <br />
                        <strong>Position Source:</strong> {vehicle.positionSource || 'unknown'}
                        <br />
                        <strong>Next Stop:</strong> {vehicle.stationName || 'Moving'}
                        <br />
                        <strong>Time to Station:</strong> {Math.floor(vehicle.timeToStation / 60)} min
                        <br />
                        <strong>Current Area:</strong> {vehicle.routeArea || 'London'}
                        <br />
                        <strong>Current Position:</strong> {vehicle.currentLat.toFixed(6)}, {vehicle.currentLon.toFixed(6)}
                        <br />
                        <strong>Heading:</strong> {vehicle.heading}°
                        <br />
                        <small>Last updated: {new Date(vehicle.lastUpdated || Date.now()).toLocaleTimeString()}</small>
                      </div>
                    </Popup>
                  </Marker>
                );
              })}
              
              {/* Show selected vehicle's original position marker */}
              {selectedVehicle && selectedVehicle.lat && selectedVehicle.lon && (
                <Marker
                  position={[selectedVehicle.lat, selectedVehicle.lon]}
                  icon={L.divIcon({
                    html: `<div style="background: rgba(255,0,0,0.7); color: white; padding: 4px 8px; border-radius: 4px; font-size: 11px; border: 2px solid white;">📍 Original</div>`,
                    iconSize: [80, 25],
                    iconAnchor: [40, 12]
                  })}
                >
                  <Popup>
                    <strong>Original Selected Position</strong>
                    <br />
                    {selectedVehicle.lineName} to {selectedVehicle.destinationName}
                    <br />
                    Position: {selectedVehicle.lat.toFixed(4)}, {selectedVehicle.lon.toFixed(4)}
                    <br />
                    <small>When first selected</small>
                  </Popup>
                </Marker>
              )}
            </MapContainer>
          </div>
          
          {!showOnlySelected && (
          <div className="vehicle-list" style={{ marginTop: '15px' }}>
            <h4>Active Vehicles ({displayVehicles.length}) by Area</h4>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '10px' }}>
              {Object.entries(vehiclesByArea).slice(0, 6).map(([area, areaVehicles]) => (
                <div 
                  key={area}
                  className="card" 
                  style={{ 
                    padding: '10px', 
                    fontSize: '0.9em',
                    border: '1px solid #ddd',
                    background: 'white'
                  }}
                >
                  <h5 style={{ margin: '0 0 8px 0', color: '#4a6fa5' }}>
                    {area} <span style={{ fontSize: '0.8em', color: '#666' }}>({areaVehicles.length})</span>
                  </h5>
                  {areaVehicles.slice(0, 4).map(vehicle => {
                    const isSelected = selectedVehicle && selectedVehicle.vehicleId === vehicle.vehicleId;
                    const vehicleColor = getVehicleColor(vehicle.lineName);
                    const isRealPosition = vehicle.hasRealPosition === true;
                    
                    return (
                      <div 
                        key={vehicle.id}
                        style={{ 
                          padding: '5px', 
                          marginBottom: '5px',
                          border: isSelected ? '2px solid #FF0000' : '1px solid #eee',
                          background: isSelected ? '#fff8f8' : '#f9f9f9',
                          borderRadius: '3px',
                          cursor: 'pointer'
                        }}
                        onClick={() => {
                          if (mapRef.current) {
                            mapRef.current.setView([vehicle.currentLat, vehicle.currentLon], 16, { animate: true });
                          }
                        }}
                        title={`Click to zoom to ${vehicle.lineName}`}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <div style={{
                            width: '10px',
                            height: '10px',
                            background: vehicleColor,
                            borderRadius: '50%',
                            position: 'relative'
                          }}>
                            <div style={{
                              position: 'absolute',
                              top: '-2px',
                              left: '-2px',
                              width: '5px',
                              height: '5px',
                              background: isRealPosition ? '#28a745' : '#ffc107',
                              borderRadius: '50%',
                              border: '1px solid white'
                            }}></div>
                          </div>
                          <strong>{vehicle.lineName} {isSelected && '📍'}</strong>
                          <span style={{ fontSize: '0.8em', color: '#666', marginLeft: 'auto' }}>
                            {Math.floor(vehicle.timeToStation / 60)} min
                          </span>
                        </div>
                        <div style={{ fontSize: '0.8em', color: '#555' }}>
                          To: {vehicle.destinationName}
                          <br />
                          <small style={{ color: isRealPosition ? '#28a745' : '#ffc107' }}>
                            {isRealPosition ? 'Real GPS' : 'Assigned'} • {vehicle.positionSource || 'unknown'}
                          </small>
                        </div>
                      </div>
                    );
                  })}
                  {areaVehicles.length > 4 && (
                    <div style={{ fontSize: '0.8em', color: '#666', textAlign: 'center', marginTop: '5px' }}>
                      ... and {areaVehicles.length - 4} more
                    </div>
                  )}
                </div>
              ))}
            </div>
            {Object.keys(vehiclesByArea).length > 6 && (
              <p style={{ textAlign: 'center', marginTop: '10px', fontSize: '0.9em', color: '#666' }}>
                ... and {Object.keys(vehiclesByArea).length - 6} more areas
              </p>
            )}
          </div>
          )}
          
          <div className="info-card" style={{ marginTop: '15px' }}>
            <h4>ℹ️ How This Works</h4>
            <p><strong>Real Data:</strong> Uses actual TfL vehicle information from the API</p>
            <p><strong>Position Sources:</strong></p>
            <ul style={{ marginLeft: '20px', fontSize: '0.9em' }}>
              <li><span style={{ color: '#28a745' }}>Green dot</span> = Real GPS (from TfL location text)</li>
              <li><span style={{ color: '#ffc107' }}>Yellow dot</span> = Route-based or simulated position</li>
            </ul>
            <p><strong>Selected Vehicle:</strong> Highlighted in <span style={{ color: '#FF0000' }}>red</span>, updates every 15 seconds</p>
            <p><strong>Controls:</strong> Use buttons above to zoom, or click on area cards to zoom to specific vehicles</p>
            <p><strong>Note:</strong> TfL API doesn't provide actual GPS coordinates, so positions are estimated based on location descriptions</p>
          </div>
          </>
          )}
        </div>
        
        <div className="modal-footer">
          <button className="btn-primary" onClick={onClose}>
            Close Live Tracker
          </button>
          {!showOnlySelected && (
            <button 
              className="btn-secondary" 
              onClick={handleZoomToAll}
              style={{ marginLeft: '10px' }}
            >
              Zoom to All
            </button>
          )}
          {selectedVehicle && (
            <button 
              className="btn-secondary" 
              onClick={handleZoomToSelected}
              style={{ marginLeft: '10px' }}
              disabled={!selectedVehicle}
            >
              Zoom to Selected
            </button>
          )}
          <button 
            className="btn-secondary" 
            onClick={handleResetView}
            style={{ marginLeft: '10px' }}
          >
            Reset View
          </button>
        </div>
      </div>
    </div>
  );
};

// CSS Animation
const styles = `
@keyframes pulse {
  0% { opacity: 1; }
  50% { opacity: 0.7; }
  100% { opacity: 1; }
}

@keyframes updating {
  0% { opacity: 0.7; }
  50% { opacity: 1; }
  100% { opacity: 0.7; }
}

.animated-vehicle-icon {
  transition: transform 0.5s ease-out;
}

.animated-vehicle-icon.updating {
  animation: updating 1.5s infinite;
}

.vehicle-popup {
  min-width: 250px;
  font-size: 0.9em;
}

.modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0,0,0,0.7);
  display: flex;
  justify-content: center;
  align-items: center;
  z-index: 1000;
}

.modal-content {
  background: white;
  border-radius: 10px;
  width: 90%;
  max-width: 1400px;
  max-height: 90vh;
  overflow-y: auto;
  position: relative;
}

.modal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 15px 20px;
  border-bottom: 1px solid #eee;
  background: #f8f9fa;
  border-radius: 10px 10px 0 0;
}

.modal-close {
  background: none;
  border: none;
  font-size: 24px;
  cursor: pointer;
  color: #666;
  padding: 0;
  width: 30px;
  height: 30px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.modal-close:hover {
  background: #eee;
  border-radius: 50%;
}

.modal-body {
  padding: 20px;
}

.modal-footer {
  padding: 15px 20px;
  border-top: 1px solid #eee;
  text-align: right;
  background: #f8f9fa;
  border-radius: 0 0 10px 10px;
}

.btn-primary {
  background: #4a6fa5;
  color: white;
  border: none;
  padding: 10px 20px;
  border-radius: 5px;
  cursor: pointer;
  font-size: 0.9em;
}

.btn-primary:hover {
  background: #3a5a8a;
}

.btn-primary:disabled {
  background: #cccccc;
  cursor: not-allowed;
}

.btn-secondary {
  background: #6c757d;
  color: white;
  border: none;
  padding: 10px 20px;
  border-radius: 5px;
  cursor: pointer;
  font-size: 0.9em;
}

.btn-secondary:hover {
  background: #5a6268;
}

.btn-secondary:disabled {
  background: #cccccc;
  cursor: not-allowed;
}

.vehicle-info {
  background: #f8f9fa;
  padding: 15px;
  border-radius: 8px;
  margin-bottom: 15px;
  border-left: 4px solid #4a6fa5;
}

.info-card {
  background: #f8f9fa;
  padding: 15px;
  border-radius: 8px;
  margin-top: 15px;
  border: 1px solid #dee2e6;
}

.card {
  background: white;
  border-radius: 6px;
  box-shadow: 0 1px 3px rgba(0,0,0,0.1);
  transition: box-shadow 0.2s;
}

.card:hover {
  box-shadow: 0 2px 5px rgba(0,0,0,0.15);
}

.modal-map-container {
  border-radius: 8px;
  overflow: hidden;
  border: 2px solid #dee2e6;
}
`;

// Add styles to document
if (typeof document !== 'undefined') {
  const styleSheet = document.createElement("style");
  styleSheet.type = "text/css";
  styleSheet.innerText = styles;
  document.head.appendChild(styleSheet);
}

export default AnimatedVehicleMap;