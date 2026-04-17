import mysql from 'mysql2/promise';
import dbConfig from '../../middleware/dbConfig';

const GEOAPIFY_KEY = process.env.GEOAPIFY_KEY || '1e257e1327bd47c3b50b8550710fc775';

async function geocodeAddress(source) {
  // source can be a string or an object { name, address, block, district }
  try {
    let text = '';
    if (typeof source === 'string') text = source;
    else if (source && typeof source === 'object') {
      const parts = [source.name, source.address, source.block, source.district].filter(Boolean);
      text = parts.join(', ');
    }

    if (!text) return null;

    const url = `https://api.geoapify.com/v1/geocode/search?text=${encodeURIComponent(text)}&limit=1&apiKey=${GEOAPIFY_KEY}`;
    const resp = await fetch(url);
    const json = await resp.json();
    if (json && Array.isArray(json.features) && json.features.length > 0) {
      const props = json.features[0].properties;
      return { lat: props.lat, lon: props.lon, formatted: props.formatted, rank: props.rank || null };
    }
  } catch (err) {
    console.error('Geocode error for', source, err.message || err);
  }
  return null;
}

async function getRoute(origin, destination) {
  try {
    const url = `https://api.geoapify.com/v1/routing?waypoints=${origin.lat},${origin.lon}|${destination.lat},${destination.lon}&mode=drive&apiKey=${GEOAPIFY_KEY}`;
    const resp = await fetch(url);
    const json = await resp.json();
    if (json && Array.isArray(json.features) && json.features.length > 0) {
      const props = json.features[0].properties;
      return { distance_m: props.distance, time_s: props.time };
    }
  } catch (err) {
    console.error('Routing error', err.message || err);
  }
  return null;
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, message: 'Method not allowed' });
  }

  try {
    const { requestId, excludePharmacyId } = req.query;
    if (!requestId) {
      return res.status(400).json({ success: false, message: 'Request ID is required' });
    }

    const connection = await mysql.createConnection(dbConfig);

    // Get requesting pharmacy details (origin)
    const [reqRows] = await connection.execute(
      `SELECT per.pharmacy_id AS pharmacy_id, p.address, p.pharmacy_name
       FROM pharmacy_emergency_requests per
       JOIN pharmacies p ON per.pharmacy_id = p.pharmacy_id
       WHERE per.request_id = ?`,
      [requestId]
    );

    if (!reqRows || reqRows.length === 0) {
      await connection.end();
      return res.status(404).json({ success: false, message: 'Request or originating pharmacy not found' });
    }

    const originPharmacy = reqRows[0];

    // Build eligible pharmacies query (same logic as eligiblePharmacies but without stocks)
    let pharmaciesSql = `
      WITH pharmacy_stock_summary AS (
        SELECT s.pharmacy_id, s.medicine_id, SUM(s.quantity) as total_quantity
        FROM stock s
        WHERE s.expiry_date > CURDATE()
        GROUP BY s.pharmacy_id, s.medicine_id
      )
      SELECT DISTINCT p.pharmacy_id, p.username as name, p.address, p.contact_number
      FROM pharmacies p
      WHERE NOT EXISTS (
        SELECT 1 FROM pharmacy_emergency_request_items ri
        WHERE ri.request_id = ?
        AND NOT EXISTS (
          SELECT 1 FROM pharmacy_stock_summary pss
          WHERE pss.pharmacy_id = p.pharmacy_id
          AND pss.medicine_id = ri.medicine_id
          AND pss.total_quantity >= ri.quantity_requested
        )
      )`;

    const params = [requestId];
    if (excludePharmacyId) {
      pharmaciesSql += ` AND p.pharmacy_id <> ?`;
      params.push(excludePharmacyId);
    }

    const [pharmacies] = await connection.execute(pharmaciesSql, params);

  // Geocode origin once (include block/district/name to improve accuracy)
  const originSource = { name: originPharmacy.pharmacy_name, address: originPharmacy.address, block: originPharmacy.block, district: originPharmacy.district };
  const originCoord = await geocodeAddress(originSource);
  if (originCoord) console.log('pharmacyDistances - Origin geocoded:', originSource, originCoord);

    // For each eligible pharmacy, geocode destination and compute route
    const enriched = await Promise.all(pharmacies.map(async (ph) => {
      const destSource = { name: ph.name, address: ph.address, block: ph.block, district: ph.district };
      const destCoord = await geocodeAddress(destSource);
      if (destCoord) console.log('pharmacyDistances - Destination geocoded:', ph.pharmacy_id, destSource, destCoord);
      let distance_m = null;
      let time_s = null;
      let distance_km = null;
      let time_min = null;
      let category = 'unknown';

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

      return {
        ...ph,
        distance_m,
        distance_km,
        time_s,
        time_min,
        category,
        dest_coord: destCoord,
      };
    }));

    await connection.end();

  // include origin_coord so frontend can display lat/lon
  return res.status(200).json({ success: true, origin: originPharmacy, origin_coord: originCoord, pharmacies: enriched });

  } catch (error) {
    console.error('pharmacyDistances error:', error);
    return res.status(500).json({ success: false, message: 'Error computing distances' });
  }
}
