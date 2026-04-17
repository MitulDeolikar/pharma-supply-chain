import mysql from "mysql2/promise";
import dbConfig from "../../middleware/dbConfig";

const GEOAPIFY_KEY = process.env.GEOAPIFY_KEY || "1e257e1327bd47c3b50b8550710fc775";

// Geocode address to coordinates
async function geocodeAddress(location, locationType = "location") {
  try {
    let text = "";
    if (typeof location === "string") {
      text = location;
    } else if (location && typeof location === "object") {
      // Build query: prefer address alone, add district if available but meaningful
      const parts = [];
      if (location.address) parts.push(location.address);
      if (location.district && location.district !== "Block") parts.push(location.district);
      text = parts.join(", ");
    }

    if (!text) {
      console.error(`❌ Geocode error for ${locationType}: No text to geocode`);
      return null;
    }

    console.log(`🔍 Geocoding ${locationType}: "${text}"`);
    
    const url = `https://api.geoapify.com/v1/geocode/search?text=${encodeURIComponent(text)}&country=IN&limit=1&apiKey=${GEOAPIFY_KEY}`;
    const resp = await fetch(url);
    const json = await resp.json();

    if (json && json.features && json.features.length) {
      const p = json.features[0].properties;
      console.log(`✅ Successfully geocoded ${locationType}: ${p.lat}, ${p.lon}`);
      return { lat: p.lat, lon: p.lon };
    } else {
      console.error(`❌ Geocode error for ${locationType}: No features found. API Response:`, json);
      
      // Fallback: try just the address field
      if (location && typeof location === "object" && location.address) {
        console.log(`⚠️ Retrying with just address: "${location.address}"`);
        const fallbackUrl = `https://api.geoapify.com/v1/geocode/search?text=${encodeURIComponent(location.address)}&country=IN&limit=1&apiKey=${GEOAPIFY_KEY}`;
        const fallbackResp = await fetch(fallbackUrl);
        const fallbackJson = await fallbackResp.json();
        
        if (fallbackJson && fallbackJson.features && fallbackJson.features.length) {
          const p = fallbackJson.features[0].properties;
          console.log(`✅ Fallback geocode successful for ${locationType}: ${p.lat}, ${p.lon}`);
          return { lat: p.lat, lon: p.lon };
        }
      }
    }
  } catch (e) {
    console.error(`❌ Geocode error for ${locationType}:`, e.message);
  }
  return null;
}

// Call OSRM for optimized route
async function getOptimizedRoute(coordinates) {
  try {
    // Format: lon,lat;lon,lat;... (OSRM expects longitude first!)
    const coordinateString = coordinates.map(c => `${c.lon},${c.lat}`).join(";");
    
    const url = `https://router.project-osrm.org/route/v1/driving/${coordinateString}?overview=full&geometries=geojson&continue_straight=false`;
    
    const resp = await fetch(url);
    const json = await resp.json();

    if (json && json.routes && json.routes.length > 0) {
      const route = json.routes[0];
      return {
        distance: route.distance, // meters
        duration: route.duration, // seconds
        geometry: route.geometry, // GeoJSON geometry
        waypoint_order: json.waypoint_order || [0, ...Array.from({ length: coordinates.length - 2 }, (_, i) => i + 1), coordinates.length - 1],
        waypoints: json.waypoints || []
      };
    }
  } catch (e) {
    console.error("OSRM routing error:", e.message);
  }
  return null;
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ success: false, message: "Method not allowed" });
  }

  try {
    const { warehouse_id, pharmacy_ids } = req.query;

    if (!warehouse_id || !pharmacy_ids) {
      return res.status(400).json({
        success: false,
        message: "warehouse_id and pharmacy_ids (comma-separated) required"
      });
    }

    const pharmacyIdList = pharmacy_ids.split(",").map(id => parseInt(id.trim())).filter(id => !isNaN(id));

    if (pharmacyIdList.length === 0) {
      return res.status(400).json({
        success: false,
        message: "Invalid pharmacy_ids format"
      });
    }

    const connection = await mysql.createConnection(dbConfig);

    // Fetch warehouse details
    const [warehouseRows] = await connection.execute(
      "SELECT warehouse_id, name, address, district, block FROM warehouse WHERE warehouse_id = ?",
      [warehouse_id]
    );

    if (!warehouseRows || warehouseRows.length === 0) {
      await connection.end();
      return res.status(404).json({ success: false, message: "Warehouse not found" });
    }

    const warehouse = warehouseRows[0];
    
    // Validate warehouse has at least an address
    if (!warehouse.address && !warehouse.name) {
      await connection.end();
      return res.status(400).json({ 
        success: false, 
        message: "Warehouse missing address or name - cannot geocode" 
      });
    }

    // Fetch pharmacy details
    const placeholders = pharmacyIdList.map(() => "?").join(",");
    const [pharmacyRows] = await connection.execute(
      `SELECT pharmacy_id, pharmacy_name, address, district, block FROM pharmacy WHERE pharmacy_id IN (${placeholders})`,
      pharmacyIdList
    );

    await connection.end();

    if (!pharmacyRows || pharmacyRows.length === 0) {
      return res.status(404).json({ success: false, message: "No pharmacies found" });
    }

    // Geocode warehouse
    const warehouseCoord = await geocodeAddress({
      name: warehouse.name,
      address: warehouse.address,
      block: warehouse.block,
      district: warehouse.district
    }, "warehouse");

    if (!warehouseCoord) {
      return res.status(400).json({ success: false, message: "Could not geocode warehouse address. Please verify warehouse details in database." });
    }

    // Geocode all pharmacies
    const pharmacyCoordinates = [];
    const pharmacyMap = {}; // To maintain order

    for (const pharmacy of pharmacyRows) {
      const coord = await geocodeAddress({
        name: pharmacy.pharmacy_name,
        address: pharmacy.address,
        block: pharmacy.block,
        district: pharmacy.district
      }, `pharmacy ${pharmacy.pharmacy_id} (${pharmacy.pharmacy_name})`);

      if (coord) {
        pharmacyCoordinates.push(coord);
        pharmacyMap[pharmacyCoordinates.length - 1] = {
          pharmacy_id: pharmacy.pharmacy_id,
          pharmacy_name: pharmacy.pharmacy_name,
          address: pharmacy.address,
          district: pharmacy.district,
          lat: coord.lat,
          lon: coord.lon
        };
      } else {
        console.warn(`⚠️ Skipping pharmacy ${pharmacy.pharmacy_id} - could not geocode address`);
      }
    }

    if (pharmacyCoordinates.length === 0) {
      return res.status(400).json({ success: false, message: "Could not geocode any pharmacies" });
    }

    // Build coordinates array: [warehouse, pharmacy1, pharmacy2, ...]
    const allCoordinates = [warehouseCoord, ...pharmacyCoordinates];

    // Get optimized route from OSRM
    const routeData = await getOptimizedRoute(allCoordinates);

    if (!routeData) {
      return res.status(400).json({ success: false, message: "Could not calculate route" });
    }

    // Build pharmacies in optimized order
    const pharmacyOrder = [];
    for (let i = 1; i < routeData.waypoint_order.length; i++) {
      const waypointIndex = routeData.waypoint_order[i];
      if (pharmacyMap[waypointIndex - 1]) {
        pharmacyOrder.push({
          ...pharmacyMap[waypointIndex - 1],
          visit_order: i
        });
      }
    }

    return res.status(200).json({
      success: true,
      warehouse: {
        warehouse_id: warehouse.warehouse_id,
        name: warehouse.name,
        address: warehouse.address,
        lat: warehouseCoord.lat,
        lon: warehouseCoord.lon
      },
      pharmacies: pharmacyOrder,
      route: {
        distance_km: (routeData.distance / 1000).toFixed(2),
        duration_minutes: (routeData.duration / 60).toFixed(1),
        geometry: routeData.geometry,
        waypoint_order: routeData.waypoint_order
      }
    });
  } catch (error) {
    console.error("Error in optimizeDeliveryRoute:", error);
    return res.status(500).json({
      success: false,
      message: "Internal Server Error",
      error: error.message
    });
  }
}
