import mysql from 'mysql2/promise';
import dbConfig from '../../middleware/dbConfig';

const GEOAPIFY_KEY = process.env.GEOAPIFY_KEY || '1e257e1327bd47c3b50b8550710fc775';

async function geocode(source) {
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
    if (json && json.features && json.features.length) {
      const p = json.features[0].properties;
      return { lat: p.lat, lon: p.lon };
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
    const originId = req.query.originPharmacyId;
    const destIdsRaw = req.query.destPharmacyIds || '';
    if (!originId) return res.status(400).json({ success: false, message: 'originPharmacyId required' });
    const destIds = destIdsRaw.split(',').map(s => s.trim()).filter(Boolean);

    const connection = await mysql.createConnection(dbConfig);
    const [originRows] = await connection.execute(`SELECT pharmacy_id, pharmacy_name, address, district, block FROM pharmacy WHERE pharmacy_id = ? LIMIT 1`, [originId]);
    if (!originRows || originRows.length === 0) {
      await connection.end();
      return res.status(404).json({ success: false, message: 'Origin pharmacy not found' });
    }
    const origin = originRows[0];
    const originCoord = await geocode({ name: origin.pharmacy_name, address: origin.address, block: origin.block, district: origin.district });

    // fetch dest pharmacy rows
    let dests = [];
    if (destIds.length) {
      const placeholders = destIds.map(() => '?').join(',');
      const [rows] = await connection.execute(`SELECT pharmacy_id, pharmacy_name as name, address, district, block FROM pharmacy WHERE pharmacy_id IN (${placeholders})`, destIds);
      dests = rows;
    }

    const distances = await Promise.all(dests.map(async (d) => {
      const destCoord = await geocode({ name: d.name, address: d.address, block: d.block, district: d.district });
      if (!originCoord || !destCoord) return { pharmacy_id: d.pharmacy_id, distance_km: null, time_min: null, category: 'unknown' };
      const route = await getRoute(originCoord, destCoord);
      if (!route) return { pharmacy_id: d.pharmacy_id, distance_km: null, time_min: null, category: 'unknown' };
      const distance_km = +(route.distance_m / 1000).toFixed(2);
      const time_min = +(route.time_s / 60).toFixed(1);
      let category = 'far';
      if (distance_km <= 5) category = 'near';
      else if (distance_km <= 20) category = 'mid';
      return { pharmacy_id: d.pharmacy_id, distance_km, time_min, category };
    }));

    await connection.end();
    return res.status(200).json({ success: true, origin: { pharmacy_id: origin.pharmacy_id }, distances });
  } catch (error) {
    console.error('computeDistancesFromPharmacy error', error);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
}
