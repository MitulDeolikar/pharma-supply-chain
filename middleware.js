import { NextResponse } from 'next/server';
import { jwtVerify } from 'jose';

// ─── Configuration ───────────────────────────────────────────────────────────

const JWT_SECRET = new TextEncoder().encode(process.env.JWT_SECRET || 'hello');
const INTERNAL_API_KEY = process.env.INTERNAL_API_KEY || 'pharma_internal_2025';

// Rate limiting: 100 requests per 60-second window per IP
const RATE_LIMIT_MAX = 100;
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const rateLimitMap = new Map();

// ─── Public Routes (no authentication required) ──────────────────────────────

const PUBLIC_ROUTES = new Set([
  '/api/user_login',
  '/api/admin_login',
  '/api/doctor_login',
  '/api/warehouse_login',
  '/api/patient_login',
  '/api/user_registration',
  '/api/admin_registration',
  '/api/doctor_registration',
  '/api/warehouse_registration',
  '/api/patient_registration',
  '/api/set_opd_passwords',
  '/api/razorpay',
  '/api/autoCreateDemandOrders',   // has own cron_key authentication
  '/api/scheduler/init',            // internal scheduler init
  '/api/savePushToken',             // called by Capacitor FCM registration event
]);

// ─── Role-Based Access Control ───────────────────────────────────────────────
// Routes mapped to allowed roles. Routes NOT listed here allow any authenticated user.

const ROLE_ACCESS = {
  // ── CMO-only ──
  '/api/sendOrderToPharmacy':              ['cmo'],
  '/api/sendDemandOrderToPharmacy':        ['cmo'],
  '/api/rejectEmergencyRequest':           ['cmo'],
  '/api/respondToDemandRequest':           ['cmo'],
  '/api/rejectDemandRequest':              ['cmo'],
  '/api/toggleCMOAutoApproval':            ['cmo'],
  '/api/getCMOPreference':                 ['cmo'],
  '/api/declareNSQ':                       ['cmo'],
  '/api/fetchAuditLog':                    ['cmo'],
  '/api/createDisposalBatch':              ['cmo'],
  '/api/cmoAnalytics':                     ['cmo'],
  '/api/fetchDiscrepancyReports':          ['cmo'],
  '/api/resolveDiscrepancyReport':         ['cmo'],
  '/api/fetchDemandAnalytics':             ['cmo'],
  '/api/mergeRequestsToBatch':             ['cmo'],
  '/api/fetchAllBatches':                  ['cmo'],
  '/api/eligiblePharmacies':               ['cmo'],

  // ── Doctor-only ──
  '/api/createPrescription':               ['doctor'],
  '/api/updatePrescription':               ['doctor'],
  '/api/fetchPrescriptions':               ['doctor'],
  '/api/issueNAC':                         ['doctor'],
  '/api/getDoctorInfo':                    ['doctor'],

  // ── Warehouse-only ──
  '/api/fetchWarehouseStock':              ['warehouse'],
  '/api/markBatchCompleted':               ['warehouse'],
  '/api/warehouseGetDisposalRequests':     ['warehouse'],
  '/api/fetchNSQNotificationsWarehouse':   ['warehouse'],
  '/api/markNSQReadWarehouse':             ['warehouse'],
  '/api/allocateAndDispatchWarehouseOrders': ['warehouse'],
  '/api/fetchWarehouseOrderStocks':        ['warehouse'],

  // ── Patient-only ──
  '/api/fetchPatientPrescriptions':        ['patient'],

  // ── Pharmacy-only ──
  '/api/createEmergencyRequest':           ['pharmacy'],
  '/api/createDemandRequest':              ['pharmacy'],
  '/api/fetchEmergencyRequests':           ['pharmacy'],
  '/api/fetchDemandRequests':              ['pharmacy'],
  '/api/fetchPharmacyStock':               ['pharmacy'],
  '/api/confirmOrderReceipt':              ['pharmacy'],
  '/api/confirmDemandOrderReceipt':        ['pharmacy'],
  '/api/createDisposalRequest':            ['pharmacy'],
  '/api/getDisposalRequests':              ['pharmacy'],
  '/api/fetchExpiredMedicines':            ['pharmacy'],
  '/api/placeInBin':                       ['pharmacy'],
  '/api/restoreFromBin':                   ['pharmacy'],
  '/api/fetchSalesAnalytics':              ['pharmacy'],
  '/api/getAutoOrderSetting':              ['pharmacy'],
  '/api/updateAutoOrderSetting':           ['pharmacy'],
  '/api/respondToEmergencyRequest':        ['pharmacy'],
  '/api/fetchIncomingEmergencyRequests':    ['pharmacy'],
  '/api/fetchPendingReceipts':             ['pharmacy'],
  '/api/reportMissingItems':               ['pharmacy'],
  '/api/fetchNSQNotifications':            ['pharmacy'],
  '/api/markNSQRead':                      ['pharmacy'],
  '/api/pharmacyPrescriptions':            ['pharmacy'],
  '/api/fetchProcessedOrders':             ['pharmacy'],
  '/api/demandForecast':                   ['pharmacy'],
  '/api/servePrescription':                ['pharmacy'],
  '/api/allocatePrescriptionStocks':       ['pharmacy'],
  '/api/allocateEmergencyOrderStocks':     ['pharmacy'],
  '/api/sendDisposalRequest':              ['pharmacy'],
  '/api/updateDisposalRequest':            ['pharmacy'],

  // ── Multi-role ──
  '/api/fetchAllEmergencyRequests':        ['cmo', 'warehouse'],
  '/api/fetchAllDemandRequests':           ['cmo', 'warehouse'],
  '/api/optimizeDeliveryRoute':            ['cmo', 'warehouse'],
  '/api/optimizeDisposalRoute':            ['cmo', 'warehouse'],
  '/api/getDisposalBatches':               ['cmo', 'warehouse'],
  '/api/getDisposalBatchRoute':            ['cmo', 'warehouse'],
  '/api/getPharmacyDistances':             ['cmo', 'pharmacy'],
  '/api/computeDistancesFromPharmacy':     ['cmo', 'pharmacy'],
  '/api/pharmacyDistances':                ['cmo', 'pharmacy'],
  '/api/getBlockchainHistory':             ['cmo', 'pharmacy'],
  '/api/searchInventory':                  ['pharmacy', 'doctor'],
  '/api/fetchPrescriptionData':            ['doctor', 'pharmacy'],
  '/api/fetchPharmaciesWithAddress':        ['cmo', 'pharmacy'],
  '/api/getPendingDisposalRequest':        ['pharmacy', 'cmo'],
  '/api/fetchEmergencyOrderStocks':        ['pharmacy', 'cmo', 'warehouse'],
  '/api/addStock':                         ['pharmacy', 'warehouse'],
  '/api/editStock':                        ['pharmacy', 'warehouse'],
  '/api/removeStock':                      ['pharmacy', 'warehouse'],
};

// ─── Rate Limiting ───────────────────────────────────────────────────────────

function checkRateLimit(ip) {
  const now = Date.now();

  // Periodic cleanup to prevent memory leak
  if (rateLimitMap.size > 10000) {
    for (const [key, val] of rateLimitMap) {
      if (now > val.resetAt) rateLimitMap.delete(key);
    }
  }

  const entry = rateLimitMap.get(ip);
  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return { allowed: true, remaining: RATE_LIMIT_MAX - 1 };
  }

  entry.count++;
  if (entry.count > RATE_LIMIT_MAX) {
    return { allowed: false, remaining: 0 };
  }
  return { allowed: true, remaining: RATE_LIMIT_MAX - entry.count };
}

// ─── Middleware ───────────────────────────────────────────────────────────────

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-internal-key',
};

export async function middleware(request) {
  const { pathname } = request.nextUrl;

  // Only process API routes
  if (!pathname.startsWith('/api/')) {
    return NextResponse.next();
  }

  // ── CORS preflight ──
  if (request.method === 'OPTIONS') {
    return new NextResponse(null, { status: 200, headers: CORS_HEADERS });
  }

  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
           || request.headers.get('x-real-ip')
           || 'unknown';
  const method = request.method;
  const timestamp = new Date().toISOString();

  // ── 1. Public routes — no auth needed ──
  if (PUBLIC_ROUTES.has(pathname)) {
    console.log(`[API Gateway] ${timestamp} | ${method} ${pathname} | public | ip=${ip}`);
    const res = NextResponse.next();
    Object.entries(CORS_HEADERS).forEach(([k, v]) => res.headers.set(k, v));
    return res;
  }

  // ── 2. Rate limiting ──
  const rateCheck = checkRateLimit(ip);
  if (!rateCheck.allowed) {
    console.log(`[API Gateway] ${timestamp} | ${method} ${pathname} | RATE_LIMITED | ip=${ip}`);
    return NextResponse.json(
      { success: false, message: 'Too many requests. Please try again later.' },
      { status: 429, headers: { 'X-RateLimit-Remaining': '0', 'Retry-After': '60' } }
    );
  }

  // ── 3. Internal API key bypass (for server-to-server calls) ──
  const internalKey = request.headers.get('x-internal-key');
  if (internalKey === INTERNAL_API_KEY) {
    console.log(`[API Gateway] ${timestamp} | ${method} ${pathname} | internal | ip=${ip}`);
    return NextResponse.next();
  }

  // ── 4. JWT Authentication ──
  let authHeader = request.headers.get('authorization') || '';
  // Support both "Bearer <token>" and raw "<token>" formats
  let token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : authHeader;

  if (!token) {
    console.log(`[API Gateway] ${timestamp} | ${method} ${pathname} | UNAUTHORIZED (no token) | ip=${ip}`);
    return NextResponse.json(
      { success: false, message: 'Authentication required. Please log in.' },
      { status: 401 }
    );
  }

  let payload;
  try {
    const { payload: decoded } = await jwtVerify(token, JWT_SECRET);
    payload = decoded;
  } catch (err) {
    const reason = err.code === 'ERR_JWT_EXPIRED' ? 'token expired' : 'invalid token';
    console.log(`[API Gateway] ${timestamp} | ${method} ${pathname} | UNAUTHORIZED (${reason}) | ip=${ip}`);
    return NextResponse.json(
      { success: false, message: reason === 'token expired'
          ? 'Session expired. Please log in again.'
          : 'Invalid authentication token.' },
      { status: 401 }
    );
  }

  // ── 5. Extract user info from JWT ──
  const role = payload.role || 'unknown';
  const userId = payload.pharmacy_id || payload.cmo_id || payload.doctor_id
              || payload.warehouse_id || payload.opd_id || 'unknown';

  // ── 6. Role-Based Access Control ──
  const allowedRoles = ROLE_ACCESS[pathname];
  if (allowedRoles && !allowedRoles.includes(role)) {
    console.log(`[API Gateway] ${timestamp} | ${method} ${pathname} | FORBIDDEN (role=${role}, need=${allowedRoles.join('|')}) | user=${userId} | ip=${ip}`);
    return NextResponse.json(
      { success: false, message: `Access denied. This endpoint requires ${allowedRoles.join(' or ')} role.` },
      { status: 403 }
    );
  }

  // ── 7. Request Logging ──
  console.log(`[API Gateway] ${timestamp} | ${method} ${pathname} | role=${role} | user=${userId} | ip=${ip} | remaining=${rateCheck.remaining}`);

  // ── 8. Forward user info to API handler via request headers ──
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-user-role', String(role));
  requestHeaders.set('x-user-id', String(userId));

  const res = NextResponse.next({ request: { headers: requestHeaders } });
  Object.entries(CORS_HEADERS).forEach(([k, v]) => res.headers.set(k, v));
  return res;
}

// ─── Matcher: only run middleware on API routes ──────────────────────────────

export const config = {
  matcher: '/api/:path*',
};
