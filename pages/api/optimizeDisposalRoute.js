import mysql from 'mysql2/promise';
import dbConfig from '../../middleware/dbConfig';

const GEOAPIFY_KEY = process.env.GEOAPIFY_KEY || "1e257e1327bd47c3b50b8550710fc775";

// Geocode address to coordinates
async function geocodeAddress(location, locationType = "location") {
  try {
    let text = "";
    if (typeof location === "string") {
      text = location;
    } else if (location && typeof location === "object") {
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
      console.error(`❌ Geocode error for ${locationType}: No features found`);
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
    const coordinateString = coordinates.map(c => `${c.lon},${c.lat}`).join(";");
    const url = `https://router.project-osrm.org/route/v1/driving/${coordinateString}?overview=full&geometries=geojson&continue_straight=false`;
    
    const resp = await fetch(url);
    const json = await resp.json();

    if (json && json.routes && json.routes.length > 0) {
      const route = json.routes[0];
      return {
        distance: route.distance,
        duration: route.duration,
        geometry: route.geometry,
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
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const connection = await mysql.createConnection(dbConfig);

  try {
    const { selected_requests, warehouse_id } = req.body;

    if (!selected_requests || selected_requests.length === 0) {
      return res.status(400).json({ error: "No requests selected" });
    }

    // Get warehouse details
    const [warehouseResult] = await connection.execute(
      `SELECT warehouse_id, name, address, district, block FROM warehouse WHERE warehouse_id = ?`,
      [warehouse_id]
    );

    if (!warehouseResult || warehouseResult.length === 0) {
      await connection.end();
      return res.status(404).json({ error: "Warehouse not found" });
    }

    const warehouse = warehouseResult[0];

    // Get pharmacy details for selected requests
    const placeholders = selected_requests.map(() => "?").join(",");
    const [pharmacyRows] = await connection.execute(`
      SELECT DISTINCT
        pdr.request_id,
        pdr.disposal_token,
        p.pharmacy_id,
        p.pharmacy_name,
        p.address,
        p.district,
        p.block
      FROM pharmacy_disposal_request pdr
      JOIN pharmacy p ON pdr.pharmacy_id = p.pharmacy_id
      WHERE pdr.request_id IN (${placeholders})
    `, selected_requests);

    await connection.end();

    if (!pharmacyRows || pharmacyRows.length === 0) {
      return res.status(404).json({ error: "No pharmacies found" });
    }

    // Geocode warehouse
    const warehouseCoord = await geocodeAddress({
      name: warehouse.name,
      address: warehouse.address,
      block: warehouse.block,
      district: warehouse.district
    }, "warehouse");

    if (!warehouseCoord) {
      return res.status(400).json({ error: "Could not geocode warehouse address" });
    }

    // Geocode all pharmacies
    const pharmacyCoordinates = [];
    const pharmacyMap = {};

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
          request_id: pharmacy.request_id,
          pharmacy_id: pharmacy.pharmacy_id,
          pharmacy_name: pharmacy.pharmacy_name,
          address: pharmacy.address,
          district: pharmacy.district,
          disposal_token: pharmacy.disposal_token,
          lat: coord.lat,
          lon: coord.lon
        };
      } else {
        console.warn(`⚠️ Skipping pharmacy ${pharmacy.pharmacy_id} - could not geocode`);
      }
    }

    if (pharmacyCoordinates.length === 0) {
      return res.status(400).json({ error: "Could not geocode any pharmacies" });
    }

    // Build coordinates array: [warehouse, pharmacy1, pharmacy2, ...]
    const allCoordinates = [warehouseCoord, ...pharmacyCoordinates];

    // Get optimized route from OSRM
    const routeData = await getOptimizedRoute(allCoordinates);

    if (!routeData) {
      return res.status(400).json({ error: "Could not calculate route" });
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

    res.status(200).json({
      success: true,
      optimized_route: {
        warehouse: {
          warehouse_id: warehouse.warehouse_id,
          name: warehouse.name,
          address: warehouse.address,
          district: warehouse.district,
          lat: warehouseCoord.lat,
          lon: warehouseCoord.lon
        },
        route: pharmacyOrder,
        total_distance: (routeData.distance / 1000).toFixed(2),
        duration_minutes: (routeData.duration / 60).toFixed(1),
        geometry: routeData.geometry
      },
      pharmacy_count: pharmacyOrder.length,
    });
  } catch (error) {
    console.error("Error optimizing disposal route:", error);
    res.status(500).json({ error: "Failed to optimize route" });
  } finally {
    await connection.end();
  }
}
