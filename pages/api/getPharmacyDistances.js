import mysql from 'mysql2/promise';
import dbConfig from '../../middleware/dbConfig';

const GEOAPIFY_KEY = process.env.GEOAPIFY_KEY || '1e257e1327bd47c3b50b8550710fc775';

async function geocode(source) {
  // source can be a string (address) or an object { name, address, block, district }
  try {
    let text = '';
    if (typeof source === 'string') text = source;
    else if (source && typeof source === 'object') {
      const parts = [source.name, source.address, source.block, source.district, "Karnataka, India"].filter(Boolean);
      text = parts.join(', ');
    }

    if (!text) return null;

    const url = `https://api.geoapify.com/v1/geocode/search?text=${encodeURIComponent(text)}&limit=1&apiKey=${GEOAPIFY_KEY}`;
    const resp = await fetch(url);
    const json = await resp.json();
    if (json && json.features && json.features.length) {
      const p = json.features[0].properties;
      return { lat: p.lat, lon: p.lon, formatted: p.formatted, rank: p.rank || null };
    }
  } catch (e) {
    console.error('geocode error', e.message || e);
  }
  return null;
}

async function getRoute(origin, dest) {
  try {
    const url = `https://api.geoapify.com/v1/routing?waypoints=${origin.lat},${origin.lon}|${dest.lat},${dest.lon}&mode=drive&apiKey=${GEOAPIFY_KEY}`;
    const resp = await fetch(url);
    const json = await resp.json();
    if (json && json.features && json.features.length) {
      const props = json.features[0].properties;
      return { distance_m: props.distance, time_s: props.time };
    }
  } catch (e) {
    console.error('routing error', e.message || e);
  }
  return null;
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ success: false, message: 'Method not allowed' });

  try {
    const { requestId, excludePharmacyId, requestType = 'emergency' } = req.query;
    if (!requestId) return res.status(400).json({ success: false, message: 'requestId required' });

    const connection = await mysql.createConnection(dbConfig);

    // Choose the correct table based on request type
    let requestTable, requestItemsTable;
    if (requestType === 'demand') {
      requestTable = 'pharmacy_demand_request';
      requestItemsTable = 'pharmacy_demand_request_items';
    } else {
      requestTable = 'pharmacy_emergency_requests';
      requestItemsTable = 'pharmacy_emergency_request_items';
    }

    // get origin pharmacy for the request
    const [reqRows] = await connection.execute(
      `SELECT r.${requestType === 'demand' ? 'request_id' : 'request_id'}, r.pharmacy_id, p.username as name, p.pharmacy_name, p.address, p.district, p.block
       FROM ${requestTable} r
       JOIN pharmacy p ON r.pharmacy_id = p.pharmacy_id
       WHERE r.${requestType === 'demand' ? 'request_id' : 'request_id'} = ?`,
      [requestId]
    );

    if (!reqRows || reqRows.length === 0) {
      await connection.end();
      return res.status(404).json({ success: false, message: 'Request not found' });
    }

    const origin = reqRows[0];

    // fetch eligible pharmacies (same logic as eligiblePharmacies)
    let sql = `
      WITH pharmacy_stock_summary AS (
        SELECT s.pharmacy_id, s.medicine_id, SUM(s.quantity) as total_quantity
        FROM stock s
        WHERE s.expiry_date > CURDATE()
        GROUP BY s.pharmacy_id, s.medicine_id
      )
      SELECT DISTINCT p.pharmacy_id, p.username as name, p.address, p.district, p.block, p.contact_number
      FROM pharmacy p
      WHERE NOT EXISTS (
        SELECT 1
        FROM ${requestItemsTable} ri
        WHERE ri.${requestType === 'demand' ? 'request_id' : 'request_id'} = ?
        AND NOT EXISTS (
          SELECT 1
          FROM pharmacy_stock_summary pss
          WHERE pss.pharmacy_id = p.pharmacy_id
          AND pss.medicine_id = ri.medicine_id
          AND pss.total_quantity >= ri.quantity_requested
        )
      )`;

    const params = [requestId];
    if (excludePharmacyId) {
      sql += ` AND p.pharmacy_id <> ?`;
      params.push(excludePharmacyId);
    }

    const [pharmacies] = await connection.execute(sql, params);

    // Also get eligible warehouses
    let warehouseSql = `
      WITH warehouse_stock_summary AS (
        SELECT s.warehouse_id, s.medicine_id, SUM(s.quantity) as total_quantity
        FROM stock s
        WHERE s.pharmacy_id IS NULL
        AND s.warehouse_id IS NOT NULL
        AND s.expiry_date > CURDATE()
        GROUP BY s.warehouse_id, s.medicine_id
      )
      SELECT DISTINCT w.warehouse_id, w.name, w.address, w.district, w.block, w.contact_number
      FROM warehouse w
      WHERE NOT EXISTS (
        SELECT 1
        FROM ${requestItemsTable} ri
        WHERE ri.${requestType === 'demand' ? 'request_id' : 'request_id'} = ?
        AND NOT EXISTS (
          SELECT 1
          FROM warehouse_stock_summary wss
          WHERE wss.warehouse_id = w.warehouse_id
          AND wss.medicine_id = ri.medicine_id
          AND wss.total_quantity >= ri.quantity_requested
        )
      )`;

    const [warehouses] = await connection.execute(warehouseSql, [requestId]);

  // Geocode origin once (include block/district/name to improve accuracy)
  const originSource = { name: origin.pharmacy_name || origin.name, address: origin.address, block: origin.block, district: origin.district };
  const originCoord = origin.address ? await geocode(originSource) : null;
  if (originCoord) console.log(`Origin geocoded for ${requestType} request:`, originSource, originCoord);

    // For each pharmacy, compute distance/time
    const distances = await Promise.all(pharmacies.map(async (ph) => {
      const destSource = { name: ph.name, address: ph.address, block: ph.block, district: ph.district };
      const destCoord = ph.address ? await geocode(destSource) : null;
      if (destCoord) console.log(`Destination geocoded for ${requestType} request:`, ph.pharmacy_id, destSource, destCoord);
      let distance_m = null, time_s = null, distance_km = null, time_min = null, category = 'unknown';
      if (originCoord && destCoord) {
        const route = await getRoute(originCoord, destCoord);
        if (route) {
          distance_m = route.distance_m;
          time_s = route.time_s;
          distance_km = +(distance_m / 1000).toFixed(2);
          time_min = +(time_s / 60).toFixed(1);
          if (distance_km <= 5) category = 'near';
          else if (distance_km <= 20) category = 'mid';
          else category = 'far';
        }
      }

      return { pharmacy_id: ph.pharmacy_id, distance_m, distance_km, time_s, time_min, category, dest_coord: destCoord };
    }));

    // For each warehouse, compute distance/time
    const warehouseDistances = await Promise.all(warehouses.map(async (wh) => {
      const destSource = { name: wh.name, address: wh.address, block: wh.block, district: wh.district };
      const destCoord = wh.address ? await geocode(destSource) : null;
      if (destCoord) console.log(`Warehouse geocoded for ${requestType} request:`, wh.warehouse_id, destSource, destCoord);
      let distance_m = null, time_s = null, distance_km = null, time_min = null, category = 'unknown';
      if (originCoord && destCoord) {
        const route = await getRoute(originCoord, destCoord);
        if (route) {
          distance_m = route.distance_m;
          time_s = route.time_s;
          distance_km = +(distance_m / 1000).toFixed(2);
          time_min = +(time_s / 60).toFixed(1);
          if (distance_km <= 5) category = 'near';
          else if (distance_km <= 20) category = 'mid';
          else category = 'far';
        }
      }

      return { warehouse_id: wh.warehouse_id, distance_m, distance_km, time_s, time_min, category, dest_coord: destCoord };
    }));

  await connection.end();
  // include origin_coord in the response so frontend can display lat/lon
  return res.status(200).json({ success: true, origin, origin_coord: originCoord, distances, warehouseDistances });

  } catch (error) {
    console.error(`getPharmacyDistances error for ${req.query.requestType || 'emergency'} request:`, error);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
}
