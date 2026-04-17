// Initialize the emergency request scheduler
// Called once on server startup

const { startEmergencyRequestScheduler } = require('../utils/emergencyRequestScheduler');

let schedulerInitialized = false;

export default function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, message: 'Method not allowed' });
  }

  if (!schedulerInitialized) {
    startEmergencyRequestScheduler();
    schedulerInitialized = true;
    return res.status(200).json({ success: true, message: '✅ Emergency request scheduler initialized' });
  }

  return res.status(200).json({ success: true, message: '✅ Scheduler already running' });
}
