import { useRouter } from 'next/router';
import { useEffect, useState, useCallback } from 'react';

const ACTION_META_LOGIN = { label: 'Login', color: 'bg-slate-100 text-slate-700', icon: '🔑' };

const ACTION_META = {
  EMERGENCY_REQUEST_CREATED:         { label: 'Emergency Request Created',     color: 'bg-orange-100 text-orange-800',  icon: '🚨' },
  EMERGENCY_REQUEST_APPROVED:        { label: 'Emergency Request Approved',     color: 'bg-green-100 text-green-800',    icon: '✅' },
  EMERGENCY_REQUEST_REJECTED:        { label: 'Emergency Request Rejected',     color: 'bg-red-100 text-red-800',        icon: '❌' },
  EMERGENCY_REQUEST_REJECTION_REVOKED: { label: 'Rejection Revoked',            color: 'bg-yellow-100 text-yellow-800',  icon: '↩️' },
  EMERGENCY_ORDER_RECEIPT_CONFIRMED: { label: 'Emergency Order Received',       color: 'bg-teal-100 text-teal-800',      icon: '📦' },
  STOCK_ALLOCATED_EMERGENCY:         { label: 'Emergency Stock Dispatched',     color: 'bg-orange-100 text-orange-800',  icon: '🏥' },
  DEMAND_REQUEST_CREATED:            { label: 'Demand Request Created',         color: 'bg-blue-100 text-blue-800',      icon: '📋' },
  DEMAND_REQUEST_AUTO_CREATED:       { label: 'Demand Request Auto-Created',    color: 'bg-blue-100 text-blue-800',      icon: '🤖' },
  DEMAND_REQUEST_APPROVED:           { label: 'Demand Request Approved',        color: 'bg-green-100 text-green-800',    icon: '✅' },
  DEMAND_REQUEST_REJECTED:           { label: 'Demand Request Rejected',        color: 'bg-red-100 text-red-800',        icon: '❌' },
  DEMAND_REQUEST_REJECTION_REVOKED:  { label: 'Demand Rejection Revoked',       color: 'bg-yellow-100 text-yellow-800',  icon: '↩️' },
  DEMAND_ORDER_RECEIPT_CONFIRMED:    { label: 'Demand Order Received',          color: 'bg-teal-100 text-teal-800',      icon: '📦' },
  WAREHOUSE_ORDER_DISPATCHED:        { label: 'Warehouse Order Dispatched',     color: 'bg-purple-100 text-purple-800',  icon: '🚚' },
  PRESCRIPTION_CREATED:              { label: 'Prescription Created',           color: 'bg-indigo-100 text-indigo-800',  icon: '💊' },
  PRESCRIPTION_SERVED:               { label: 'Prescription Served',            color: 'bg-green-100 text-green-800',    icon: '💊' },
  NAC_ISSUED:                        { label: 'NAC Issued',                     color: 'bg-red-100 text-red-800',        icon: '🚫' },
  STOCK_ADDED:                       { label: 'Stock Added',                    color: 'bg-green-100 text-green-800',    icon: '➕' },
  STOCK_UPDATED:                     { label: 'Stock Updated',                  color: 'bg-blue-100 text-blue-800',      icon: '✏️' },
  STOCK_REMOVED:                     { label: 'Stock Removed',                  color: 'bg-gray-100 text-gray-800',      icon: '🗑️' },
  DISPOSAL_REQUEST_CREATED:          { label: 'Disposal Request Created',       color: 'bg-yellow-100 text-yellow-800',  icon: '⚗️' },
  DISPOSAL_REQUEST_SENT:             { label: 'Disposal Request Sent',          color: 'bg-yellow-100 text-yellow-800',  icon: '📤' },
  DISPOSAL_BATCH_CREATED:            { label: 'Disposal Batch Created',         color: 'bg-orange-100 text-orange-800',  icon: '🗂️' },
  DISPOSAL_BATCH_COMPLETED:          { label: 'Disposal Batch Completed',       color: 'bg-red-100 text-red-800',        icon: '🗑️' },
  NSQ_DECLARED:                      { label: 'NSQ Declared',                   color: 'bg-red-100 text-red-800',        icon: '⚠️' },
  NSQ_ACKNOWLEDGED:                  { label: 'NSQ Acknowledged',               color: 'bg-yellow-100 text-yellow-800',  icon: '👁️' },
  MISSING_ITEMS_REPORTED:            { label: 'Missing Items Reported',         color: 'bg-red-200 text-red-900',        icon: '🚨' },
  DISCREPANCY_RESOLVED:              { label: 'Discrepancy Resolved',           color: 'bg-green-100 text-green-800',    icon: '✅' },
};

const ACTOR_COLORS = {
  pharmacy:  'bg-blue-600',
  cmo:       'bg-indigo-600',
  doctor:    'bg-green-600',
  warehouse: 'bg-purple-600',
  patient:   'bg-cyan-600',
};

const ACTOR_LABELS = {
  pharmacy:  'Pharmacy',
  cmo:       'CMO',
  doctor:    'Doctor',
  warehouse: 'Warehouse',
  patient:   'Patient',
};

const PIPELINE_STATUS_LABELS = {
  pending_approval_from_cmo: { label: 'Awaiting CMO Approval', color: 'bg-orange-100 text-orange-800', dot: 'bg-orange-400' },
  order_sent:                { label: 'Order Sent – Awaiting Dispatch', color: 'bg-blue-100 text-blue-800',   dot: 'bg-blue-400'   },
  order_successful:          { label: 'Dispatched – Awaiting Receipt',  color: 'bg-teal-100 text-teal-800',   dot: 'bg-teal-400'   },
  pending:                   { label: 'Awaiting CMO Approval',          color: 'bg-orange-100 text-orange-800', dot: 'bg-orange-400' },
  approved:                  { label: 'Approved – Awaiting Dispatch',   color: 'bg-green-100 text-green-800', dot: 'bg-green-400'  },
};

function formatRelativeTime(dateStr) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins  = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days  = Math.floor(diff / 86400000);
  if (mins < 1)   return 'just now';
  if (mins < 60)  return `${mins}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7)   return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString();
}

function ActorBadge({ type }) {
  const cls   = ACTOR_COLORS[type] || 'bg-gray-600';
  const label = ACTOR_LABELS[type] || type?.toUpperCase();
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold text-white ${cls} mr-2`}>
      {label}
    </span>
  );
}

export default function AuditLog() {
  const router = useRouter();
  const [logs, setLogs] = useState([]);
  const [activeRequests, setActiveRequests] = useState([]);
  const [activePrescriptions, setActivePrescriptions] = useState([]);
  const [discrepancyReports, setDiscrepancyReports] = useState([]);
  const [resolvingId, setResolvingId] = useState(null);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [filterActorType, setFilterActorType] = useState('');
  const [filterAction, setFilterAction] = useState('');
  const [filterDays, setFilterDays] = useState(30);
  const [filterOptions, setFilterOptions] = useState({
    actor_types: ['pharmacy', 'cmo', 'doctor', 'warehouse', 'patient'],
    actions: [
      'EMERGENCY_REQUEST_CREATED', 'EMERGENCY_REQUEST_APPROVED', 'EMERGENCY_REQUEST_REJECTED',
      'EMERGENCY_REQUEST_REJECTION_REVOKED', 'EMERGENCY_ORDER_RECEIPT_CONFIRMED', 'STOCK_ALLOCATED_EMERGENCY',
      'DEMAND_REQUEST_CREATED', 'DEMAND_REQUEST_AUTO_CREATED', 'DEMAND_REQUEST_APPROVED',
      'DEMAND_REQUEST_REJECTED', 'DEMAND_REQUEST_REJECTION_REVOKED', 'DEMAND_ORDER_RECEIPT_CONFIRMED',
      'WAREHOUSE_ORDER_DISPATCHED',
      'PRESCRIPTION_CREATED', 'PRESCRIPTION_SERVED', 'NAC_ISSUED',
      'STOCK_ADDED', 'STOCK_UPDATED', 'STOCK_REMOVED',
      'DISPOSAL_REQUEST_CREATED', 'DISPOSAL_REQUEST_SENT', 'DISPOSAL_BATCH_CREATED', 'DISPOSAL_BATCH_COMPLETED',
      'NSQ_DECLARED', 'NSQ_ACKNOWLEDGED',
      'MISSING_ITEMS_REPORTED', 'DISCREPANCY_RESOLVED',
      'USER_LOGIN',
    ],
  });
  const [tab, setTab] = useState('timeline');
  const limit = 30;

  const fetchLogs = useCallback(async (p = 1) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: p,
        limit,
        days: filterDays,
        ...(filterActorType && { actor_type: filterActorType }),
        ...(filterAction && { action: filterAction }),
      });
      const res = await fetch(`/api/fetchAuditLog?${params}`);
      const data = await res.json();
      if (data.active_requests !== undefined) setActiveRequests(data.active_requests);
      if (data.active_prescriptions !== undefined) setActivePrescriptions(data.active_prescriptions);

      // Fetch unresolved discrepancy reports (independent of filters)
      fetch('/api/fetchDiscrepancyReports?resolved=0')
        .then(r => r.json())
        .then(d => { if (d.success) setDiscrepancyReports(d.reports || []); })
        .catch(() => {});
      if (data.success) {
        setLogs(data.logs || []);
        setTotal(data.total || 0);
        if (data.filter_options) {
          setFilterOptions(prev => ({
            actor_types: [...new Set([...prev.actor_types, ...(data.filter_options.actor_types || [])])].sort(),
            actions: [...new Set([...prev.actions, ...(data.filter_options.actions || [])])],
          }));
        }
      }
    } catch (e) {
      console.error('Failed to fetch audit log:', e);
    } finally {
      setLoading(false);
    }
  }, [filterActorType, filterAction, filterDays]);

  useEffect(() => {
    fetchLogs(1);
    setPage(1);
  }, [filterActorType, filterAction, filterDays]);

  useEffect(() => {
    fetchLogs(page);
  }, [page]);

  const totalPages = Math.ceil(total / limit);

  const handleResolveDiscrepancy = async (reportId) => {
    const cmoId = new URLSearchParams(typeof window !== 'undefined' ? window.location.search : '').get('cmo_id');
    setResolvingId(reportId);
    try {
      const res = await fetch('/api/resolveDiscrepancyReport', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ report_id: reportId, cmo_id: cmoId }),
      });
      const data = await res.json();
      if (data.success) {
        setDiscrepancyReports(prev => prev.filter(r => r.id !== reportId));
      }
    } catch (_) {}
    setResolvingId(null);
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white shadow-sm border-b px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button onClick={() => router.back()} className="text-gray-500 hover:text-gray-700 transition-colors">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M9.707 16.707a1 1 0 01-1.414 0l-6-6a1 1 0 010-1.414l6-6a1 1 0 011.414 1.414L5.414 9H17a1 1 0 110 2H5.414l4.293 4.293a1 1 0 010 1.414z" clipRule="evenodd" />
            </svg>
          </button>
          <div>
            <h1 className="text-xl font-bold text-gray-900">System Audit Log</h1>
            <p className="text-sm text-gray-500">Complete activity trail across all users and operations</p>
          </div>
        </div>
        <button onClick={() => fetchLogs(page)} className="px-3 py-1.5 text-sm bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors">Refresh</button>
      </div>

      {/* Tab switcher */}
      <div className="px-6 pt-4">
        <div className="flex gap-2 border-b border-gray-200">
          <TabButton active={tab === 'timeline'} onClick={() => setTab('timeline')} label="Activity Timeline" />
          <TabButton active={tab === 'pipeline'} onClick={() => setTab('pipeline')} label="Requests Pipeline" badge={activeRequests.length || null} />
          <TabButton active={tab === 'prescriptions'} onClick={() => setTab('prescriptions')} label="Prescriptions Pipeline" badge={activePrescriptions.length || null} />
          <TabButton active={tab === 'alerts'} onClick={() => setTab('alerts')} label="Discrepancy Alerts" badge={discrepancyReports.length || null} badgeColor="bg-red-600" />
        </div>
      </div>

      {/* ═══════════════════════ TAB: Activity Timeline ═══════════════════════ */}
      {tab === 'timeline' && (
        <div className="px-6 py-4">
          {/* Filters */}
          <div className="bg-white rounded-xl border border-gray-200 p-4 mb-4 flex flex-wrap gap-3 items-end">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Actor Type</label>
              <select value={filterActorType} onChange={e => setFilterActorType(e.target.value)}
                className="text-sm border border-gray-300 rounded-lg px-3 py-1.5 focus:ring-2 focus:ring-indigo-400 outline-none">
                <option value="">All Actors</option>
                {filterOptions.actor_types.map(t => (
                  <option key={t} value={t}>{ACTOR_LABELS[t] || t}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Action</label>
              <select value={filterAction} onChange={e => setFilterAction(e.target.value)}
                className="text-sm border border-gray-300 rounded-lg px-3 py-1.5 focus:ring-2 focus:ring-indigo-400 outline-none">
                <option value="">All Actions</option>
                {filterOptions.actions.map(a => (
                  <option key={a} value={a}>{a === 'USER_LOGIN' ? 'Login' : (ACTION_META[a]?.label || a)}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Time Range</label>
              <select value={filterDays} onChange={e => setFilterDays(Number(e.target.value))}
                className="text-sm border border-gray-300 rounded-lg px-3 py-1.5 focus:ring-2 focus:ring-indigo-400 outline-none">
                <option value={1}>Last 24 hours</option>
                <option value={7}>Last 7 days</option>
                <option value={30}>Last 30 days</option>
                <option value={90}>Last 90 days</option>
                <option value={365}>Last year</option>
              </select>
            </div>
            <div className="ml-auto text-sm text-gray-500 self-center">
              {total} event{total !== 1 ? 's' : ''} found
            </div>
          </div>

          {/* Timeline */}
          {loading ? (
            <div className="flex justify-center items-center py-16">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div>
            </div>
          ) : logs.length === 0 ? (
            <EmptyState icon="clipboard" title="No activity found" subtitle="Try expanding the time range or clearing filters" />
          ) : (
            <div className="relative">
              <div className="absolute left-6 top-0 bottom-0 w-0.5 bg-gray-200"></div>
              <div className="space-y-1">
                {logs.map((log) => {
                  const meta = log.action === 'USER_LOGIN' ? ACTION_META_LOGIN : (ACTION_META[log.action] || { label: log.action, color: 'bg-gray-100 text-gray-800', icon: '•' });
                  return (
                    <div key={`${log.log_id}-${log.action}`} className="relative flex gap-4 pl-16 py-3 group">
                      <div className={`absolute left-4 top-4 w-4 h-4 rounded-full border-2 border-white shadow ${ACTOR_COLORS[log.actor_type] || 'bg-gray-400'}`}></div>
                      <div className="flex-1 bg-white rounded-xl border border-gray-200 px-4 py-3 hover:shadow-sm transition-shadow">
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center flex-wrap gap-1.5 mb-1">
                              <ActorBadge type={log.actor_type} />
                              <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${meta.color}`}>
                                {meta.icon} {meta.label}
                              </span>
                            </div>
                            <p className="text-sm text-gray-800 font-medium truncate">{log.actor_name}</p>
                            <p className="text-sm text-gray-600 mt-0.5 leading-snug">{log.description}</p>
                            <AllocationDetails metadata={typeof log.metadata === 'string' ? tryParseJSON(log.metadata) : log.metadata} />
                          </div>
                          <div className="text-right flex-shrink-0">
                            <span className="text-xs text-gray-400 whitespace-nowrap">{formatRelativeTime(log.created_at)}</span>
                            {log.entity_type && log.entity_type !== 'session' && (
                              <div className="text-xs text-gray-400 mt-0.5">{log.entity_type} #{log.entity_id}</div>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex justify-center items-center gap-3 mt-6">
              <button disabled={page <= 1} onClick={() => setPage(p => p - 1)}
                className="px-3 py-1.5 text-sm rounded-lg border border-gray-300 disabled:opacity-40 hover:bg-gray-50 transition-colors">Previous</button>
              <span className="text-sm text-gray-600">Page {page} of {totalPages}</span>
              <button disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}
                className="px-3 py-1.5 text-sm rounded-lg border border-gray-300 disabled:opacity-40 hover:bg-gray-50 transition-colors">Next</button>
            </div>
          )}
        </div>
      )}

      {/* ═══════════════════════ TAB: Requests Pipeline ═══════════════════════ */}
      {tab === 'pipeline' && (
        <div className="px-6 py-4">
          <div className="bg-white rounded-xl border border-gray-200 p-4 mb-4">
            <h2 className="font-semibold text-gray-900 mb-1">Active Requests Pipeline</h2>
            <p className="text-sm text-gray-500">All in-progress emergency and demand requests and their current stage</p>
          </div>

          {activeRequests.length === 0 ? (
            <EmptyState icon="check" title="No active requests" subtitle="All requests have been completed or rejected" />
          ) : (
            <div className="space-y-3">
              {activeRequests.map(req => {
                const statusMeta = PIPELINE_STATUS_LABELS[req.status] || { label: req.status, color: 'bg-gray-100 text-gray-800', dot: 'bg-gray-400' };
                const isEmergency = req.request_type === 'emergency';
                return (
                  <div key={`${req.request_type}-${req.request_id}`} className="bg-white rounded-xl border border-gray-200 p-4 hover:shadow-sm transition-shadow">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-2">
                        <span className={`px-2 py-0.5 rounded text-xs font-bold ${isEmergency ? 'bg-red-100 text-red-700' : 'bg-blue-100 text-blue-700'}`}>
                          {isEmergency ? '🚨 EMERGENCY' : '📋 DEMAND'} #{req.request_id}
                        </span>
                        <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-xs font-medium ${statusMeta.color}`}>
                          <span className={`w-1.5 h-1.5 rounded-full ${statusMeta.dot} animate-pulse`}></span>
                          {statusMeta.label}
                        </span>
                      </div>
                      <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm">
                        <div><span className="text-gray-500">Requested by: </span><span className="font-medium text-gray-800">{req.requester_name || `Pharmacy #${req.pharmacy_id}`}</span></div>
                        {req.assigned_to && <div><span className="text-gray-500">Assigned to: </span><span className="font-medium text-gray-800">{req.assigned_to}</span></div>}
                        <div><span className="text-gray-500">Created: </span><span className="text-gray-700">{formatRelativeTime(req.request_date)}</span></div>
                        {req.remarks && <div className="col-span-2"><span className="text-gray-500">Remarks: </span><span className="text-gray-700 italic">{req.remarks}</span></div>}
                      </div>
                      <div className="mt-3"><PipelineStages type={req.request_type} status={req.status} /></div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ═══════════════════════ TAB: Prescriptions Pipeline ═══════════════════════ */}
      {tab === 'prescriptions' && (
        <div className="px-6 py-4">
          <div className="bg-white rounded-xl border border-gray-200 p-4 mb-4">
            <h2 className="font-semibold text-gray-900 mb-1">Active Prescriptions Pipeline</h2>
            <p className="text-sm text-gray-500">Prescriptions awaiting pharmacy fulfillment (not yet served, no NAC issued)</p>
          </div>

          {activePrescriptions.length === 0 ? (
            <EmptyState icon="check" title="No pending prescriptions" subtitle="All prescriptions have been served or NAC'd" />
          ) : (
            <div className="space-y-3">
              {activePrescriptions.map(rx => (
                <div key={rx.prescription_id} className="bg-white rounded-xl border border-gray-200 p-4 hover:shadow-sm transition-shadow">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="px-2 py-0.5 rounded text-xs font-bold bg-indigo-100 text-indigo-700">💊 Rx #{rx.prescription_id}</span>
                    <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-xs font-medium bg-orange-100 text-orange-800">
                      <span className="w-1.5 h-1.5 rounded-full bg-orange-400 animate-pulse"></span>
                      Awaiting Pharmacy
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm">
                    <div><span className="text-gray-500">Patient: </span><span className="font-medium text-gray-800">{rx.patient_name || rx.opd_number}</span></div>
                    <div><span className="text-gray-500">OPD #: </span><span className="font-medium text-gray-800">{rx.opd_number}</span></div>
                    <div><span className="text-gray-500">Doctor: </span><span className="font-medium text-gray-800">{rx.doctor_name || `Doctor #${rx.doctor_id}`}</span></div>
                    <div><span className="text-gray-500">Medicines: </span><span className="font-medium text-gray-800">{rx.medicine_count} item(s)</span></div>
                    {rx.diagnosis && <div className="col-span-2"><span className="text-gray-500">Diagnosis: </span><span className="text-gray-700 italic">{rx.diagnosis}</span></div>}
                    <div><span className="text-gray-500">Created: </span><span className="text-gray-700">{formatRelativeTime(rx.created_at)}</span></div>
                  </div>
                  <div className="mt-3"><PrescriptionStages /></div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ═══════════════════════ TAB: Discrepancy Alerts ═══════════════════════ */}
      {tab === 'alerts' && (
        <div className="px-6 py-4">
          <div className="bg-white rounded-xl border border-red-200 p-4 mb-4">
            <h2 className="font-semibold text-red-800 mb-1">Discrepancy Alerts</h2>
            <p className="text-sm text-gray-500">Pharmacies have reported receiving fewer items than what was dispatched. These need CMO attention.</p>
          </div>

          {discrepancyReports.length === 0 ? (
            <EmptyState icon="check" title="No open discrepancy reports" subtitle="All order receipts have been confirmed without issues" />
          ) : (
            <div className="space-y-3">
              {discrepancyReports.map(report => {
                const items = typeof report.missing_items === 'string'
                  ? tryParseJSON(report.missing_items) : report.missing_items;
                const totalShort = (items || []).reduce((s, i) => s + (Number(i.dispatched_qty) - Number(i.received_qty)), 0);
                return (
                  <div key={report.id} className="bg-white rounded-xl border-l-4 border-red-500 border border-red-200 p-4 shadow-sm">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-2">
                          <span className="px-2 py-0.5 rounded text-xs font-bold bg-red-100 text-red-700">
                            🚨 {report.request_type === 'demand' ? 'DEMAND' : 'EMERGENCY'} ORDER #{report.request_id}
                          </span>
                          <span className="text-xs font-semibold text-red-600 bg-red-50 px-2 py-0.5 rounded-full border border-red-200">
                            {totalShort} unit(s) short
                          </span>
                        </div>

                        <p className="text-sm font-medium text-gray-800 mb-1">
                          {report.pharmacy_name || `Pharmacy #${report.pharmacy_id}`} — reported {formatRelativeTime(report.reported_at)}
                        </p>

                        <div className="mt-2 bg-red-50 rounded-lg p-2 border border-red-100">
                          <p className="text-xs font-semibold text-red-700 mb-1.5">Missing / Short Items:</p>
                          <div className="space-y-1">
                            {(items || []).map((item, idx) => {
                              const short = Number(item.dispatched_qty) - Number(item.received_qty);
                              return (
                                <div key={idx} className="flex items-center justify-between text-xs">
                                  <span className="text-gray-700 font-medium">
                                    {item.medicine_name}
                                    {item.batch_number && <span className="text-gray-400 ml-1">(Batch: {item.batch_number})</span>}
                                  </span>
                                  <span className="text-red-700 font-semibold whitespace-nowrap ml-3">
                                    Dispatched {item.dispatched_qty} → Received {item.received_qty}
                                    {short > 0 && <span className="ml-1 text-red-800">(−{short} missing)</span>}
                                  </span>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      </div>

                      <button
                        onClick={() => handleResolveDiscrepancy(report.id)}
                        disabled={resolvingId === report.id}
                        className="shrink-0 px-3 py-1.5 text-sm bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors disabled:opacity-50 font-medium"
                      >
                        {resolvingId === report.id ? 'Resolving...' : 'Mark Resolved'}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ───── Shared components ───── */

function TabButton({ active, onClick, label, badge, badgeColor = 'bg-red-500' }) {
  return (
    <button onClick={onClick}
      className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors flex items-center gap-1 ${active ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
      {label}
      {badge > 0 && <span className={`ml-1 px-1.5 py-0.5 text-xs ${badgeColor} text-white rounded-full`}>{badge}</span>}
    </button>
  );
}

function EmptyState({ icon, title, subtitle }) {
  const paths = {
    clipboard: 'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2',
    check: 'M5 13l4 4L19 7',
  };
  return (
    <div className="text-center py-16 text-gray-400">
      <svg xmlns="http://www.w3.org/2000/svg" className="h-12 w-12 mx-auto mb-3 opacity-40" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d={paths[icon] || paths.clipboard} />
      </svg>
      <p className="text-lg font-medium">{title}</p>
      <p className="text-sm mt-1">{subtitle}</p>
    </div>
  );
}

function PipelineStages({ type, status }) {
  const emergencyStages = [
    { key: 'pending_approval_from_cmo', label: 'Submitted' },
    { key: 'order_sent',                label: 'CMO Approved' },
    { key: 'order_successful',          label: 'Dispatched' },
    { key: 'order_recieved',            label: 'Received' },
  ];
  const demandStages = [
    { key: 'pending',          label: 'Submitted' },
    { key: 'approved',         label: 'Approved' },
    { key: 'order_successful', label: 'Dispatched' },
    { key: 'order_recieved',   label: 'Received' },
  ];
  const stages = type === 'emergency' ? emergencyStages : demandStages;
  const currentIdx = stages.findIndex(s => s.key === status);
  return <StageBar stages={stages} currentIdx={currentIdx} />;
}

function PrescriptionStages() {
  const stages = [
    { key: 'created',  label: 'Created' },
    { key: 'pending',  label: 'Awaiting Pharmacy' },
    { key: 'served',   label: 'Served' },
  ];
  // Active prescriptions are always at stage index 1 (created done, awaiting pharmacy is current)
  return <StageBar stages={stages} currentIdx={1} />;
}

function tryParseJSON(val) {
  if (!val) return null;
  if (typeof val === 'object') return val;
  try { return JSON.parse(val); } catch (_) { return null; }
}

function AllocationDetails({ metadata }) {
  if (!metadata) return null;

  // Prescription served / emergency allocated — has metadata.allocations array
  const allocations = metadata.allocations;
  // Warehouse dispatched — has metadata.dispatched_requests array with batches
  const dispatched = metadata.dispatched_requests;

  if (allocations && allocations.length > 0) {
    return (
      <div className="mt-2 bg-gray-50 rounded-lg p-2 border border-gray-100">
        <p className="text-xs font-semibold text-gray-500 mb-1">Stock Allocated:</p>
        <div className="space-y-1.5">
          {allocations.map((alloc, i) => (
            <div key={i}>
              <p className="text-xs font-medium text-gray-700">{alloc.medicine_name || `Medicine #${alloc.medicine_id}`} — {alloc.quantity_allocated || alloc.batches?.reduce((s, b) => s + b.quantity, 0)} units</p>
              {alloc.batches && alloc.batches.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-0.5">
                  {alloc.batches.map((b, j) => (
                    <span key={j} className="inline-flex items-center px-1.5 py-0.5 rounded text-xs bg-blue-50 text-blue-700 border border-blue-100">
                      Batch {b.batch_number}: {b.quantity} units {b.expiry_date ? `(exp: ${new Date(b.expiry_date).toLocaleDateString()})` : ''}
                    </span>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (dispatched && dispatched.length > 0) {
    const hasBatches = dispatched.some(d => d.batches && d.batches.length > 0);
    if (!hasBatches) return null;
    return (
      <div className="mt-2 bg-gray-50 rounded-lg p-2 border border-gray-100">
        <p className="text-xs font-semibold text-gray-500 mb-1">Dispatched Stock:</p>
        <div className="space-y-1.5">
          {dispatched.map((d, i) => (
            <div key={i}>
              <p className="text-xs font-medium text-gray-700">{d.request_type === 'emergency' ? '🚨' : '📋'} Request #{d.request_id}</p>
              {d.batches && d.batches.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-0.5">
                  {d.batches.map((b, j) => (
                    <span key={j} className="inline-flex items-center px-1.5 py-0.5 rounded text-xs bg-purple-50 text-purple-700 border border-purple-100">
                      Med #{b.medicine_id} — Batch {b.batch_number}: {b.quantity} units {b.expiry_date ? `(exp: ${new Date(b.expiry_date).toLocaleDateString()})` : ''}
                    </span>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    );
  }

  return null;
}

function StageBar({ stages, currentIdx }) {
  return (
    <div className="flex items-center gap-0">
      {stages.map((stage, idx) => {
        const done    = idx < currentIdx;
        const current = idx === currentIdx;
        const pending = idx > currentIdx;
        return (
          <div key={stage.key} className="flex items-center flex-1">
            <div className="flex flex-col items-center flex-1">
              <div className={`w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold
                ${done    ? 'bg-green-500 text-white' : ''}
                ${current ? 'bg-indigo-600 text-white ring-2 ring-indigo-200' : ''}
                ${pending ? 'bg-gray-200 text-gray-400' : ''}
              `}>
                {done ? '✓' : idx + 1}
              </div>
              <span className={`mt-1 text-xs leading-tight text-center max-w-[72px]
                ${done    ? 'text-green-600' : ''}
                ${current ? 'text-indigo-700 font-semibold' : ''}
                ${pending ? 'text-gray-400' : ''}
              `}>{stage.label}</span>
            </div>
            {idx < stages.length - 1 && (
              <div className={`flex-1 h-0.5 mb-4 ${idx < currentIdx ? 'bg-green-400' : 'bg-gray-200'}`}></div>
            )}
          </div>
        );
      })}
    </div>
  );
}
