import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { useEffect, useRef } from "react";

const DeliveryRouteMap = ({ routeData }) => {
  const mapRef = useRef(null);
  const mapInstance = useRef(null);
  const layersRef = useRef([]);

  useEffect(() => {
    if (!routeData || !mapRef.current) return;

    // Initialize Leaflet map only once
    if (!mapInstance.current) {
      mapInstance.current = L.map(mapRef.current, {
        center: [13.0, 77.5],
        zoom: 10,
        zoomControl: true,
        attributionControl: true
      });

      // Add OpenStreetMap tiles with better configuration
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
        maxZoom: 19,
        minZoom: 2,
        crossOrigin: true,
        errorTileUrl: "data:image/gif;base64,R0lGODlhAQABAAAAACw="
      }).addTo(mapInstance.current);

      // Trigger resize to ensure map displays properly
      setTimeout(() => {
        mapInstance.current.invalidateSize();
      }, 100);
    }

    const map = mapInstance.current;

    // Clear previously added layers
    layersRef.current.forEach(layer => {
      if (map.hasLayer(layer)) {
        map.removeLayer(layer);
      }
    });
    layersRef.current = [];

    // Create bounds object to fit all points
    const bounds = L.latLngBounds();

    // Add warehouse marker
    const warehouseIcon = L.divIcon({
      html: `
        <div style="
          width: 40px;
          height: 40px;
          border-radius: 50%;
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          display: flex;
          align-items: center;
          justify-content: center;
          color: white;
          font-weight: bold;
          font-size: 20px;
          box-shadow: 0 4px 6px rgba(0,0,0,0.3);
          border: 3px solid white;
          z-index: 400;
        ">🏭</div>
      `,
      iconSize: [40, 40],
      iconAnchor: [20, 20],
      popupAnchor: [0, -20],
      className: "warehouse-icon"
    });

    const warehouseMarker = L.marker([routeData.warehouse.lat, routeData.warehouse.lon], { icon: warehouseIcon })
      .bindPopup(`
        <div style="font-family: Arial; padding: 10px;">
          <h3 style="margin: 0 0 10px 0; color: #667eea; font-weight: bold;">START: Warehouse</h3>
          <p style="margin: 5px 0; font-weight: bold;">${routeData.warehouse.name}</p>
          <p style="margin: 5px 0; font-size: 12px; color: #666;">${routeData.warehouse.address}</p>
        </div>
      `)
      .addTo(map);
    
    layersRef.current.push(warehouseMarker);
    bounds.extend([routeData.warehouse.lat, routeData.warehouse.lon]);

    // Add pharmacy markers with order numbers
    routeData.pharmacies.forEach((pharmacy) => {
      const pharmacyIcon = L.divIcon({
        html: `
          <div style="
            width: 40px;
            height: 40px;
            border-radius: 50%;
            background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%);
            display: flex;
            align-items: center;
            justify-content: center;
            color: white;
            font-weight: bold;
            font-size: 18px;
            box-shadow: 0 4px 6px rgba(0,0,0,0.3);
            border: 3px solid white;
            z-index: 400;
          ">${pharmacy.visit_order}</div>
        `,
        iconSize: [40, 40],
        iconAnchor: [20, 20],
        popupAnchor: [0, -20],
        className: "pharmacy-icon"
      });

      const pharmacyMarker = L.marker([pharmacy.lat, pharmacy.lon], { icon: pharmacyIcon })
        .bindPopup(`
          <div style="font-family: Arial; padding: 10px; width: 250px;">
            <h3 style="margin: 0 0 10px 0; color: #f5576c; font-weight: bold;">Stop ${pharmacy.visit_order}</h3>
            <p style="margin: 5px 0; font-weight: bold;">${pharmacy.pharmacy_name}</p>
            <p style="margin: 5px 0; font-size: 12px; color: #666;">${pharmacy.address}</p>
            <p style="margin: 5px 0; font-size: 12px; color: #666;">${pharmacy.district}</p>
          </div>
        `)
        .addTo(map);
      
      layersRef.current.push(pharmacyMarker);
      bounds.extend([pharmacy.lat, pharmacy.lon]);
    });

    // Add route polyline from geometry
    if (routeData.route.geometry && routeData.route.geometry.coordinates) {
      const coordinates = routeData.route.geometry.coordinates.map(([lon, lat]) => [lat, lon]);

      const polyline = L.polyline(coordinates, {
        color: "#667eea",
        weight: 4,
        opacity: 0.85,
        dashArray: "10, 5",
        lineCap: "round",
        lineJoin: "round",
        zIndex: 300
      }).addTo(map);
      
      layersRef.current.push(polyline);

      // Extend bounds to include all polyline points
      coordinates.forEach(coord => bounds.extend(coord));
    }

    // Fit map to bounds with padding
    if (bounds.isValid()) {
      setTimeout(() => {
        try {
          map.fitBounds(bounds, {
            padding: [100, 100],
            maxZoom: 15,
            animate: true,
            duration: 1
          });
        } catch (e) {
          console.error("Error fitting bounds:", e);
          map.setView([routeData.warehouse.lat, routeData.warehouse.lon], 12);
        }
      }, 200);
    }

  }, [routeData]);

  return (
    <div
      ref={mapRef}
      style={{
        width: "100%",
        height: "100%",
        position: "relative",
        backgroundColor: "#f0f0f0"
      }}
      className="map-container"
    />
  );
};

export default DeliveryRouteMap;
