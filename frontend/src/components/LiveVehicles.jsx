import React, { useState, useEffect } from 'react';
import VehicleMapModal from './VehicleMapModal';

export default function LiveVehicles() {
  const [vehicles, setVehicles] = useState([]);
  const [isInitialLoad, setIsInitialLoad] = useState(true);
  const [error, setError] = useState(null);
  const [selectedVehicle, setSelectedVehicle] = useState(null);

  // Get backend URL dynamically (try 4001, then 4002)
  const getBackendUrl = async () => {
    const ports = [4001, 4002];
    for (const port of ports) {
      try {
        const url = `http://localhost:${port}/api/vehicles`;
        const response = await fetch(url, { 
          method: 'HEAD',
          timeout: 1000
        });
        if (response.ok) return url;
      } catch (e) {
        // Try next port
      }
    }
    // Fallback to 4001
    return 'https://justinw.uk/tfl-api/api/vehicles';
  };

  useEffect(() => {
    const fetchVehicles = async () => {
      try {
        // Get the working backend URL
        const backendUrl = await getBackendUrl();
        const response = await fetch(backendUrl);
        if (!response.ok) throw new Error('Failed to fetch vehicles');
        const data = await response.json();
        setVehicles(data);
        setError(null); // Clear any previous errors on success
        
        // If a vehicle modal is open, refresh its object so modal receives updated coords
        setSelectedVehicle(prev => {
          if (!prev) return prev;
          const found = data.find(v => v.vehicleId === prev.vehicleId);
          return found || prev;
        });
      } catch (err) {
        console.error('Fetch error:', err);
        setError(err.message);
      } finally {
        // Only mark as no longer loading after first successful fetch
        if (isInitialLoad) {
          setIsInitialLoad(false);
        }
      }
    };

    fetchVehicles();
    // Auto-refresh every 10 seconds for real-time TfL data
    const interval = setInterval(fetchVehicles, 10000);
    return () => clearInterval(interval);
  }, [isInitialLoad]);

  if (isInitialLoad) return <div className="tab-content"><p>Loading live vehicles...</p></div>;
  if (error && vehicles.length === 0) return <div className="tab-content"><p>❌ Error: {error}</p></div>;

  return (
    <div className="tab-content">
      <h2>Live Vehicles <img style={{width: "17px"}} src="https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-green.png"></img></h2>
      <div className="sub-title">Powered by TFL Api</div>
      <div className="live-vehicles-grid">
        {vehicles.length > 0 ? (
          vehicles.map(vehicle => (
            <div 
              key={vehicle.vehicleId} 
              className="vehicle-card"
            >
              <div className="vehicle-header">
                <h3>{vehicle.vehicleId}</h3>
                <span className="line-badge">{vehicle.lineName}</span>
              </div>
              <div className="vehicle-details">
                <p><strong>Station:</strong> {vehicle.stationName}</p>
                <p><strong>Destination:</strong> {vehicle.destinationName || 'N/A'}</p>
                <p><strong>Current Location:</strong> {vehicle.currentLocation}</p>
                <p><strong>Direction:</strong> {vehicle.direction}</p>
                <p><strong>Time to Station:</strong> {vehicle.timeToStation}s</p>
                <p><strong>Expected Arrival:</strong> {vehicle.expectedArrival ? new Date(vehicle.expectedArrival).toLocaleTimeString() : 'N/A'}</p>
                <p><strong>Mode:</strong> {vehicle.modeName || 'N/A'}</p>
                <p><strong>Bearing:</strong> {vehicle.bearing}°</p>
              </div>
              <div className="vehicle-footer">
                <small>Updated: {new Date(vehicle.timestamp || vehicle.lastUpdated).toLocaleTimeString()}</small>
                <button 
                  className="btn-show-map"
                  onClick={() => setSelectedVehicle(vehicle)}
                  title="View on map"
                >
                  Show on Map
                </button>
              </div>
            </div>
          ))
        ) : (
          <p>No live vehicles available</p>
        )}
      </div>

      {/* Vehicle Map Modal */}
      {selectedVehicle && (
        <VehicleMapModal 
          vehicle={selectedVehicle}
          onClose={() => setSelectedVehicle(null)}
        />
      )}

      <style>{`
        .vehicle-footer {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding-top: 12px;
          margin-top: 12px;
          border-top: 1px solid #e0e0e0;
          gap: 8px;
        }

        .btn-show-map {
          background: rgb(74,111,165);
          background-image: none !important;
          color: white;
          border: none;
          padding: 8px 12px;
          border-radius: 6px;
          cursor: pointer;
          font-weight: 600;
          font-size: 12px;
          transition: all 0.2s ease;
          white-space: nowrap;
          flex-shrink: 0;
        }

        .btn-show-map:hover {
          transform: translateY(-2px);
          box-shadow: 0 4px 12px rgba(102, 126, 234, 0.4);
        }

        .btn-show-map:active {
          transform: translateY(0);
        }
      `}</style>
    </div>
  );
}