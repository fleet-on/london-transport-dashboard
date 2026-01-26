import React, { useState, useEffect, useRef } from 'react';
import { MapContainer, TileLayer, Marker, Popup, Polyline, useMap } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';

// Fix for default markers
import L from 'leaflet';
import icon from 'leaflet/dist/images/marker-icon.png';
import iconShadow from 'leaflet/dist/images/marker-shadow.png';

let DefaultIcon = L.icon({
  iconUrl: icon,
  shadowUrl: iconShadow,
  iconSize: [25, 41],
  iconAnchor: [12, 41],
});

L.Marker.prototype.options.icon = DefaultIcon;

export default function VehicleMapModal({ vehicle, onClose, onCenterCoordinates }) {
  const [animatedPosition, setAnimatedPosition] = useState([vehicle.lat, vehicle.lon]);
  const [routePath, setRoutePath] = useState([[vehicle.lat, vehicle.lon]]);
  const [destinationCoords, setDestinationCoords] = useState(null);
  const currentStopName = vehicle?.stationName || vehicle?.currentStop || '';
  const destinationName = vehicle?.destinationName || '';

  // Track previous position for interpolation
  const prevPosRef = useRef({
    lat: vehicle.lat,
    lon: vehicle.lon,
    timeToStation: vehicle.timeToStation || 0,
    timestamp: Date.now()
  });

  // Helper component: auto-fit map to show vehicle, next stop and destination
  const MapAutoFit = ({ points }) => {
    const map = useMap();
    useEffect(() => {
      if (!map) return;
      const latlngs = points
        .filter(p => p && p.lat !== undefined && p.lon !== undefined)
        .map(p => [p.lat, p.lon]);
      if (latlngs.length === 0) return;
      if (latlngs.length === 1) {
        map.setView(latlngs[0], 15);
      } else {
        map.fitBounds(latlngs, { padding: [80, 80] });
      }
    }, [map, points]);
    return null;
  };

  // Fetch destination coordinates when component mounts or destination changes
  useEffect(() => {
    // If backend already provided destination coords, use them immediately
    if (vehicle?.destinationCoords && vehicle.destinationCoords.lat !== undefined && vehicle.destinationCoords.lon !== undefined) {
      setDestinationCoords({ lat: +vehicle.destinationCoords.lat, lon: +vehicle.destinationCoords.lon });
      return;
    }

    const fetchDestinationCoords = async () => {
      if (!destinationName) return;
      try {
        const res = await fetch(`https://justinw.uk/tfl-api/api/journey/coords?stopName=${encodeURIComponent(destinationName)}`);
        if (!res.ok) {
          console.warn('destination coords fetch failed', await res.text());
          return;
        }
        const { lat, lon } = await res.json();
        if (lat !== undefined && lon !== undefined) {
          setDestinationCoords({ lat: +lat, lon: +lon });
        } else {
          console.warn('destination coordinates not found in response');
        }
      } catch (err) {
        console.error('Error fetching destination coords:', err);
      }
    };

    fetchDestinationCoords();
  }, [destinationName]);

  // Animate marker based on timeToStation changes (bus moving closer to next stop)
  useEffect(() => {
    const prevData = prevPosRef.current;
    const currentTimeToStation = vehicle.timeToStation || 0;
    const currentLat = vehicle.lat || 51.5074;
    const currentLon = vehicle.lon || -0.1278;
    
    console.log(`🚌 Modal update:`, {
      vehicleId: vehicle.vehicleId,
      prevTime: prevData.timeToStation,
      currTime: currentTimeToStation,
      hasNextStop: !!vehicle.nextStopCoords,
      currentPos: { lat: currentLat, lon: currentLon },
      nextStop: vehicle.nextStopCoords
    });

    // Only animate if timeToStation decreased (bus is moving closer)
    if (prevData.timeToStation > currentTimeToStation && vehicle.nextStopCoords && prevData.lat && prevData.lon) {
      const { lat: nextLat, lon: nextLon } = vehicle.nextStopCoords;
      let rafId = null;
      const from = [prevData.lat, prevData.lon];
      const to = [nextLat, nextLon];

      // Calculate how far the bus should move based on time elapsed
      const timeDiff = prevData.timeToStation - currentTimeToStation;
      const maxTime = prevData.timeToStation || 60;
      const timeProgress = Math.min(1, timeDiff / maxTime);

      const duration = 2000; // ms for smooth animation
      let start = null;

      const step = (timestamp) => {
        if (!start) start = timestamp;
        const t = Math.min(1, (timestamp - start) / duration);
        // Ease-out-quad: smooth deceleration
        const eased = 1 - (1 - t) * (1 - t);
        const lat = from[0] + (to[0] - from[0]) * eased * timeProgress;
        const lon = from[1] + (to[1] - from[1]) * eased * timeProgress;
        setAnimatedPosition([lat, lon]);
        if (t < 1) rafId = requestAnimationFrame(step);
      };

      rafId = requestAnimationFrame(step);
      
      // Add current position to route path
      setRoutePath(prev => {
        const lastPoint = prev[prev.length - 1];
        if (!lastPoint || Math.abs(lastPoint[0] - from[0]) > 0.0001 || Math.abs(lastPoint[1] - from[1]) > 0.0001) {
          return [...prev, [from[0], from[1]]];
        }
        return prev;
      });

      return () => { if (rafId) cancelAnimationFrame(rafId); };
    } else if (currentLat !== prevData.lat || currentLon !== prevData.lon) {
      // Direct position update if available (no animation, just jump to new position)
      console.log(`📍 Direct position update:`, { lat: currentLat, lon: currentLon });
      setAnimatedPosition([currentLat, currentLon]);
    }

    // Update reference after effect
    prevPosRef.current = {
      lat: currentLat,
      lon: currentLon,
      timeToStation: currentTimeToStation,
      timestamp: Date.now()
    };

  }, [vehicle.lat, vehicle.lon, vehicle.timeToStation, vehicle.nextStopCoords, vehicle.vehicleId]);

  const handleViewOnMap = async () => {
    if (!currentStopName) return;
    try {
      const res = await fetch(`https://justinw.uk/tfl-api/api/journey/coords?stopName=${encodeURIComponent(currentStopName)}`);
      if (!res.ok) {
        console.warn('coords fetch failed', await res.text());
        return;
      }
      const { lat, lon } = await res.json();
      if (lat !== undefined && lon !== undefined) {
        if (typeof onCenterCoordinates === 'function') onCenterCoordinates({ lat: +lat, lng: +lon });
      } else {
        console.warn('coordinates not found in response');
      }
    } catch (err) {
      console.error(err);
    }
  };

  const vehiclePosition = [vehicle.lat || 51.5074, vehicle.lon || -0.1278];

  // Create vehicle icon with bearing direction
  const createVehicleIcon = () => {
    const bearing = vehicle.bearing || vehicle.heading || 0;
    const color = '#4a6fa5';
    return L.divIcon({
      html: `
        <div style="display:flex;align-items:center;justify-content:center;transform:rotate(${bearing}deg);">
          <div style="
            background:${color};
            width:40px;height:40px;border-radius:50%;
            border:3px solid white;display:flex;align-items:center;justify-content:center;font-size:20px;
            box-shadow: 0 2px 8px rgba(0,0,0,0.3);">
            🚌
          </div>
        </div>
      `,
      className: '',
      iconSize: [44, 44],
      iconAnchor: [22, 22]
    });
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-title">
            <h3>🚌 {vehicle.vehicleId}</h3>
            <span className="modal-line-badge">{vehicle.lineName}</span>
          </div>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>
        
        <div className="modal-body">
          <div className="modal-map-container">
            <MapContainer
              center={vehiclePosition}
              zoom={15}
              style={{ height: '365px', width: '100%' }}
            >
              <TileLayer
                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                attribution='&copy; OpenStreetMap contributors'
              />
                <MapAutoFit points={[ vehicle.nextStopCoords, destinationCoords ]} />
              
              {/* Route path traveled */}
              {routePath.length > 1 && (
                <Polyline
                  positions={routePath}
                  color="#667eea"
                  weight={3}
                  opacity={0.6}
                  dashArray="5, 5"
                />
              )}
              
              {/* Direct route from Next Stop to Final Destination */}
              {vehicle.nextStopCoords && destinationCoords && (
                <Polyline
                  positions={[
                    [vehicle.nextStopCoords.lat, vehicle.nextStopCoords.lon],
                    [destinationCoords.lat, destinationCoords.lon]
                  ]}
                  color="#FF6B35"
                  weight={2}
                  opacity={0.8}
                  dashArray="10, 5"
                />
              )}
              
              {/* Destination marker if available */}
              {destinationCoords && (
                <Marker 
                  position={[destinationCoords.lat, destinationCoords.lon]}
                  icon={L.icon({
                    iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-red.png',
                    shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/0.7.7/images/marker-shadow.png',
                    iconSize: [25, 41],
                    iconAnchor: [12, 41],
                    popupAnchor: [1, -34],
                    shadowSize: [41, 41]
                  })}
                >
                  <Popup>
                    <div>
                      <strong>Final Destination</strong><br />
                      {vehicle.destinationName}
                    </div>
                  </Popup>
                </Marker>
              )}
              
              {/* Next stop marker if available */}
              {vehicle.nextStopCoords && (
                <Marker 
                  position={[vehicle.nextStopCoords.lat, vehicle.nextStopCoords.lon]}
                  icon={L.icon({
                    iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-green.png',
                    shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/0.7.7/images/marker-shadow.png',
                    iconSize: [25, 41],
                    iconAnchor: [12, 41],
                    popupAnchor: [1, -34],
                    shadowSize: [41, 41]
                  })}
                >
                  <Popup>
                    <div>
                      <strong>Next Stop</strong><br />
                      {vehicle.stationName}
                    </div>
                  </Popup>
                </Marker>
              )}
            </MapContainer>
          </div>

          <div className="vehicle-card">
            <div className="vehicle-header">
              <h3>{vehicle.vehicleId}</h3>
              <span className="line-badge">{vehicle.lineName}</span>
            </div>
            <div className="vehicle-details">
              <p><strong>Station:</strong> {vehicle.stationName || 'N/A'}</p>
              <p><strong>Destination:</strong> {vehicle.destinationName || 'N/A'}</p>
              <p><strong>Current Location:</strong> {vehicle.currentLocation || vehicle.stationName || 'N/A'}</p>
              <p><strong>Direction:</strong> {vehicle.direction || 'N/A'}</p>
              <p><strong>Time to Station:</strong> {vehicle.timeToStation != null ? `${vehicle.timeToStation}s` : 'N/A'}</p>
              <p><strong>Expected Arrival:</strong> {vehicle.expectedArrival || 'N/A'}</p>
              <p><strong>Mode:</strong> {vehicle.modeName || 'bus'}</p>
              <p><strong>Bearing:</strong> {Math.round(vehicle.bearing || vehicle.heading || 0)}°</p>
            </div>
            <div className="vehicle-footer">
              <small>Updated: {new Date(vehicle.lastUpdated).toLocaleTimeString()}</small>
            </div>
          </div>
        </div>
        
        <div className="modal-footer">
          <button className="btn-secondary" onClick={onClose}>
            Close Map
          </button>
        </div>
      </div>

      <style>{`
        @keyframes fadeIn {
          from {
            opacity: 0;
          }
          to {
            opacity: 1;
          }
        }

        @keyframes slideUp {
          from {
            transform: translateY(50px);
            opacity: 0;
          }
          to {
            transform: translateY(0);
            opacity: 1;
          }
        }

        @keyframes pulse {
          0%, 100% {
            transform: scale(1);
            opacity: 0.3;
          }
          50% {
            transform: scale(1.2);
            opacity: 0.1;
          }
        }

        .modal-overlay {
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background-color: rgba(0, 0, 0, 0.7);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 1000;
          animation: fadeIn 0.3s ease;
          padding: 20px;
        }

        .modal-content {
          background: white;
          border-radius: 12px;
          box-shadow: 0 10px 40px rgba(0, 0, 0, 0.3);
          max-width: 1000px;
          width: 100%;
          max-height: 90vh;
          overflow-y: auto;
          animation: slideUp 0.3s ease;
          display: flex;
          flex-direction: column;
        }

        .modal-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 20px;
          border-bottom: 2px solid #f0f0f0;
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          color: white;
          border-radius: 12px 12px 0 0;
        }

        .modal-title {
          display: flex;
          align-items: center;
          gap: 12px;
        }

        .modal-title h3 {
          margin: 0;
          font-size: 20px;
        }

        .modal-line-badge {
          background: rgba(255, 255, 255, 0.25);
          color: white;
          padding: 6px 12px;
          border-radius: 20px;
          font-weight: 600;
          font-size: 12px;
        }

        .modal-close {
          background: rgba(255, 255, 255, 0.25);
          border: none;
          color: white;
          font-size: 28px;
          cursor: pointer;
          padding: 4px 10px;
          border-radius: 6px;
          transition: all 0.2s ease;
          line-height: 1;
        }

        .modal-close:hover {
          background: rgba(255, 255, 255, 0.4);
          transform: scale(1.1);
        }

        .modal-body {
          padding: 20px;
          display: grid;
          grid-template-columns: 1fr 320px;
          gap: 20px;
          flex: 1;
          overflow-y: auto;
        }

        .modal-map-container {
          border-radius: 8px;
          overflow: hidden;
          box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
          height: 365px;
        }

        /* vehicle-info-panel removed — replaced with .vehicle-card markup */

        /* Removed unused modal-specific info styles; vehicle card styles live in global CSS */

        .modal-footer {
          padding: 16px 20px;
          border-top: 1px solid #f0f0f0;
          background: #f9f9f9;
          display: flex;
          justify-content: flex-end;
          gap: 10px;
          border-radius: 0 0 12px 12px;
        }

        .btn-secondary {
          background: #6c757d;
          color: white;
          border: none;
          padding: 10px 20px;
          border-radius: 6px;
          cursor: pointer;
          font-weight: 600;
          transition: all 0.2s ease;
        }

        .btn-secondary:hover {
          background: #5a6268;
          transform: translateY(-2px);
          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
        }

        @media (max-width: 768px) {
          .modal-body {
            grid-template-columns: 1fr;
            gap: 16px;
          }

          .modal-map-container {
            height: 350px;
          }

          /* vehicle-info-panel removed */

          .modal-header {
            flex-wrap: wrap;
            gap: 10px;
          }

          .modal-title {
            flex: 1;
            min-width: 200px;
          }
        }
      `}</style>
    </div>
  );
};