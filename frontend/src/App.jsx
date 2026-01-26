import React, { useState, useEffect } from 'react';
import { ApolloClient, InMemoryCache, ApolloProvider, useQuery, gql, HttpLink } from '@apollo/client';
import Map from './components/Map';
import TrafficList from './components/TrafficList';
import JourneyPlanner from './components/JourneyPlanner';
import VehicleMapModal from './components/VehicleMapModal';
import AnimatedVehicleMap from './components/AnimatedVehicleMap';
import JourneyMapModal from './components/JourneyMapModal';
import './styles/App.css';
import './styles/Animations.css';
import TopNav from './components/TopNav';
import MapComponent from './components/MapComponent';
// Removed: TubeLines, BikePoints, Accidents, AirQuality, Network
import LiveVehicles from './components/LiveVehicles';

const client = new ApolloClient({
  link: new HttpLink({
    uri: 'https://justinw.uk/tfl-api/graphql',
  }),
  cache: new InMemoryCache(),
});

// Updated GET_TFL_DATA query with animation fields
const GET_TFL_DATA = gql`
  query GetTfLData {
    lineStatus {
      id
      name
      modeName
      lineStatuses {
        statusSeverity
        statusSeverityDescription
        reason
      }
    }
    # Removed bikePoints, accidentStats, roadStatus, airQuality, networkStatus for simplified UI
    vehicleTracking(routeIds: ["1", "12", "38", "55", "73", "94", "137", "148"]) {
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
      # NEW FIELDS FOR ANIMATION
      heading
      speed
      lastUpdated
    }
  }
`;

function Dashboard() {
  const { loading, error, data, refetch } = useQuery(GET_TFL_DATA);
  const [selectedLocation, setSelectedLocation] = useState(null);
  const [selectedTab, setSelectedTab] = useState('journey');
  const [selectedJourney, setSelectedJourney] = useState(null);
  const [selectedVehicle, setSelectedVehicle] = useState(null);
  const [allVehicles, setAllVehicles] = useState([]); // NEW: Store all vehicles
  const [showVehicleModal, setShowVehicleModal] = useState(false);
  const [showAnimatedVehicleModal, setShowAnimatedVehicleModal] = useState(false); // NEW: Animated modal state
  const [showJourneyModal, setShowJourneyModal] = useState(false);

  // NEW: Auto-refresh vehicle data when on vehicles tab
  useEffect(() => {
    if (selectedTab === 'live') {
      const interval = setInterval(() => {
        refetch();
        console.log('🔄 Auto-refreshing vehicle data...');
      }, 30000); // Refresh every 30 seconds

      return () => clearInterval(interval);
    }
  }, [selectedTab, refetch]);

  // NEW: Store vehicle data when loaded
  useEffect(() => {
    if (data?.vehicleTracking) {
      // Check if vehicles have valid positions
      const vehiclesWithPositions = data.vehicleTracking.map((vehicle, index) => {
        // If vehicle doesn't have lat/lon, assign a position based on route
        if (!vehicle.lat || !vehicle.lon || Math.abs(vehicle.lat) < 0.1) {
          console.log(`⚠️ Vehicle ${vehicle.vehicleId} (${vehicle.lineName}) missing position, assigning based on route`);
          
          // Assign positions based on route number and index
          const baseLat = 51.5074 + (index * 0.005); // Spread them out
          const baseLon = -0.1278 + (index * 0.005);
          
          return {
            ...vehicle,
            lat: baseLat,
            lon: baseLon,
            hasAssignedPosition: true // Flag to identify assigned positions
          };
        }
        return vehicle;
      });
      
      setAllVehicles(vehiclesWithPositions);
      console.log(`🚌 Loaded ${vehiclesWithPositions.length} vehicles`);
      
      // Log position info for debugging
      const vehiclesWithRealPositions = vehiclesWithPositions.filter(v => !v.hasAssignedPosition);
      const vehiclesWithAssignedPositions = vehiclesWithPositions.filter(v => v.hasAssignedPosition);
      console.log(`📍 Positions: ${vehiclesWithRealPositions.length} real, ${vehiclesWithAssignedPositions.length} assigned`);
    }
  }, [data]);

  const handleMapClick = (latlng) => {
    setSelectedLocation(latlng);
  };

  // UPDATED: Handle vehicle location click - show animated modal
  const handleVehicleLocationClick = (vehicle) => {
    console.log('📍 View on Map clicked for vehicle:', {
      id: vehicle.id,
      line: vehicle.lineName,
      position: vehicle.lat && vehicle.lon ? `${vehicle.lat.toFixed(4)}, ${vehicle.lon.toFixed(4)}` : 'No position',
      hasAssignedPosition: vehicle.hasAssignedPosition || false
    });
    setSelectedVehicle(vehicle);
    setShowAnimatedVehicleModal(true); // Show animated modal
    setShowVehicleModal(false); // Hide static modal
  };

  const closeVehicleModal = () => {
    setShowVehicleModal(false);
    setSelectedVehicle(null);
  };

  // NEW: Close animated vehicle modal
  const closeAnimatedVehicleModal = () => {
    setShowAnimatedVehicleModal(false);
    setSelectedVehicle(null);
  };

  // Add journey modal handlers
  const handleJourneySelect = (journey) => {
    setSelectedJourney(journey);
    setShowJourneyModal(true);
  };

  const closeJourneyModal = () => {
    setShowJourneyModal(false);
    setSelectedJourney(null);
  };

  const TAB_COMPONENTS = {
    journey: JourneyPlanner,
    // Removed: tube, bike, accidents, roads, air, network
    live: LiveVehicles,
  };

  const CurrentComponent = TAB_COMPONENTS[selectedTab];

  return (
    <div className="app-container">
      {/* Pass currentTab and onTabChange so TopNav controls the dashboard */}
      <TopNav currentTab={selectedTab} onTabChange={setSelectedTab} />

      <div className={`main-content ${selectedTab === 'journey' || selectedTab === 'live' ? 'no-map' : ''}`}>
        {/* Conditionally render map based on selected tab */}
        {!('journey' === selectedTab || 'live' === selectedTab) && (
          <div className="map-container">
            <Map 
              bikePoints={data?.bikePoints || []}
              accidentStats={data?.accidentStats || []}
              onMapClick={handleMapClick}
              journeyRoute={selectedJourney}
              vehicleArrivals={data?.vehicleTracking || []}
            />
          </div>
        )}

        <div className={`data-grid ${selectedTab === 'journey' || selectedTab === 'live' ? 'full-height' : ''}`}>
          {/* Render selected tab content */}
          {CurrentComponent ? (
            <CurrentComponent data={data} onRouteSelect={handleJourneySelect} />
          ) : (
            <div className="tab-content"><p>Select a data category to view information</p></div>
          )}
        </div>
      </div>

      {/* Animated Vehicle Map Modal - USE THE ORIGINAL ONE */}
{showAnimatedVehicleModal && allVehicles.length > 0 && (
  <AnimatedVehicleMap
    vehicles={allVehicles}
    selectedVehicle={selectedVehicle}
    onClose={closeAnimatedVehicleModal}
    showOnlySelected={true}
  />
)}

{/* Original Vehicle Map Modal (fallback) */}
{showVehicleModal && selectedVehicle && (
  <VehicleMapModal
    vehicle={selectedVehicle}
    onClose={closeVehicleModal}
  />
)}

      {/* Journey Route Modal */}
      {showJourneyModal && selectedJourney && (
        <JourneyMapModal
          journey={selectedJourney}
          onClose={closeJourneyModal}
        />
      )}

      {/* Auto-refresh notification */}
      {selectedTab === 'live' && (
        <div style={{
          position: 'fixed',
          bottom: '20px',
          right: '20px',
          background: '#4a6fa5',
          color: 'white',
          padding: '10px 15px',
          borderRadius: '8px',
          fontSize: '0.8rem',
          boxShadow: '0 2px 10px rgba(0,0,0,0.2)',
          zIndex: 1000,
          display: 'flex',
          alignItems: 'center',
          gap: '8px'
        }}>
          <div className="vehicle-pulse" style={{
            width: '8px',
            height: '8px',
            background: '#28a745',
            borderRadius: '50%'
          }}></div>
          <span>Live vehicle tracking active</span>
          <small style={{ opacity: 0.8 }}>(updates every 30s)</small>
        </div>
      )}
    </div>
  );
}

function App(){
  return (
    <>
      <ApolloProvider client={client}>
        <Dashboard />
      </ApolloProvider>
    </>
  );
}

export default App;