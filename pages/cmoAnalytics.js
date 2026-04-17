import { useRouter } from 'next/router';
import { useEffect, useState, useCallback } from 'react';
import { ToastContainer, toast } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';
import useSSE from '../hooks/useSSE';

// ─── helpers ────────────────────────────────────────────────────────────────
const fmtNum = (n) => Number(n || 0).toLocaleString('en-IN');
const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';
const fmtMonth = (m) => {
  const [y, mo] = m.split('-');
  return new Date(y, mo - 1).toLocaleString('en-IN', { month: 'short', year: '2-digit' });
};

const STATUS_LABEL = {
  pending_approval_from_cmo: 'Pending CMO',
  order_sent: 'Sent',
  order_successful: 'Dispatched',
  order_recieved: 'Received',
  rejected: 'Rejected',
  pending: 'Pending',
  approved: 'Approved',
};
const STATUS_COLOR = {
  pending_approval_from_cmo: 'bg-yellow-100 text-yellow-800',
  order_sent: 'bg-blue-100 text-blue-800',
  order_successful: 'bg-purple-100 text-purple-800',
  order_recieved: 'bg-green-100 text-green-800',
  rejected: 'bg-red-100 text-red-800',
  pending: 'bg-yellow-100 text-yellow-800',
  approved: 'bg-blue-100 text-blue-800',
};

// CSS bar chart — no external library needed
function BarChart({ data, valueKey, labelKey, color = 'bg-indigo-500', maxVal }) {
  const max = maxVal || Math.max(...data.map(d => Number(d[valueKey] || 0)), 1);
  return (
    <div className="space-y-2">
      {data.map((item, i) => {
        const val = Number(item[valueKey] || 0);
        const pct = Math.round((val / max) * 100);
        return (
          <div key={i}>
            <div className="flex justify-between text-xs text-gray-600 mb-0.5">
              <span className="truncate max-w-[60%]">{item[labelKey]}</span>
              <span className="font-semibold">{fmtNum(val)}</span>
            </div>
            <div className="w-full bg-gray-100 rounded-full h-2">
              <div className={`${color} h-2 rounded-full transition-all duration-500`} style={{ width: `${pct}%` }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function StatCard({ label, value, sub, color = 'indigo', icon }) {
  const colors = {
    indigo: 'bg-indigo-50 border-indigo-200 text-indigo-700',
    green:  'bg-green-50  border-green-200  text-green-700',
    red:    'bg-red-50    border-red-200    text-red-700',
    yellow: 'bg-yellow-50 border-yellow-200 text-yellow-700',
    blue:   'bg-blue-50   border-blue-200   text-blue-700',
    purple: 'bg-purple-50 border-purple-200 text-purple-700',
  };
  return (
    <div className={`rounded-xl border p-4 ${colors[color]}`}>
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide opacity-70">{label}</p>
          <p className="text-3xl font-bold mt-1">{fmtNum(value)}</p>
          {sub && <p className="text-xs mt-1 opacity-60">{sub}</p>}
        </div>
        {icon && <span className="text-2xl opacity-60">{icon}</span>}
      </div>
    </div>
  );
}

function SectionHeader({ title, sub }) {
  return (
    <div className="mb-4">
      <h2 className="text-lg font-bold text-gray-800">{title}</h2>
      {sub && <p className="text-sm text-gray-500">{sub}</p>}
    </div>
  );
}

function Badge({ status }) {
  return (
    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${STATUS_COLOR[status] || 'bg-gray-100 text-gray-600'}`}>
      {STATUS_LABEL[status] || status}
    </span>
  );
}

// ─── main page ───────────────────────────────────────────────────────────────
export default function CmoAnalytics() {
  const router = useRouter();
  const [period, setPeriod] = useState(30);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [activeSection, setActiveSection] = useState('overview');

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (!token) router.push('/');
  }, []);

  const fetchData = useCallback(async (p) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/cmoAnalytics?period=${p}`);
      const json = await res.json();
      if (json.success) {
        setData(json);
      } else {
        toast.error('Failed to load analytics');
      }
    } catch (e) {
      console.error(e);
      toast.error('Error loading analytics');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(period); }, [period]);

  // Real-time updates — CMO analytics refreshes when any stock/request event occurs
  const handleSSEEvent = (event) => {
    const t = event.type;
    if (t.startsWith('stock:') || t.startsWith('emergency:') || t.startsWith('demand:') || t.startsWith('warehouse:') || t.startsWith('prescription:')) {
      fetchData(period);
    }
  };
  useSSE({ role: 'cmo', id: 'analytics', onEvent: handleSSEEvent });

  const sections = [
    { id: 'overview',    label: 'Overview' },
    { id: 'pharmacies',  label: 'Pharmacy Activity' },
    { id: 'exchanges',   label: 'Inter-Pharmacy Exchanges' },
    { id: 'warehouse',   label: 'Warehouse Performance' },
    { id: 'medicines',   label: 'Top Medicines' },
    { id: 'trends',      label: 'Trends & Status' },
    { id: 'feed',        label: 'Activity Feed' },
  ];

  return (
    <div className="min-h-screen bg-gray-50">
      <ToastContainer position="top-right" autoClose={3000} />

      {/* Header */}
      <header className="bg-indigo-800 text-white px-6 py-4 shadow-lg">
        <div className="flex items-center justify-between max-w-7xl mx-auto">
          <div className="flex items-center gap-3">
            <button onClick={() => router.back()} className="text-indigo-300 hover:text-white">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </button>
            <div>
              <h1 className="text-2xl font-bold">District Analytics Dashboard</h1>
              <p className="text-indigo-300 text-sm">Complete audit log & transaction history across all pharmacies</p>
            </div>
          </div>
          {/* Period selector */}
          <div className="flex items-center gap-2">
            <span className="text-indigo-300 text-sm">Period:</span>
            {[7, 30, 90].map(p => (
              <button
                key={p}
                onClick={() => setPeriod(p)}
                className={`px-3 py-1 text-sm rounded-lg font-medium transition-colors ${
                  period === p ? 'bg-white text-indigo-800' : 'bg-indigo-700 text-white hover:bg-indigo-600'
                }`}
              >
                {p}d
              </button>
            ))}
          </div>
        </div>
      </header>

      {/* Section Nav */}
      <nav className="bg-white border-b shadow-sm sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 flex gap-1 overflow-x-auto">
          {sections.map(s => (
            <button
              key={s.id}
              onClick={() => setActiveSection(s.id)}
              className={`px-4 py-3 text-sm font-medium whitespace-nowrap border-b-2 transition-colors ${
                activeSection === s.id
                  ? 'border-indigo-600 text-indigo-700'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>
      </nav>

      <main className="max-w-7xl mx-auto px-4 py-6">
        {loading ? (
          <div className="flex flex-col items-center justify-center h-64 gap-3">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600" />
            <p className="text-gray-500">Loading analytics for last {period} days...</p>
          </div>
        ) : !data ? null : (
          <>
            {/* ── OVERVIEW ─────────────────────────────────────────────────── */}
            {activeSection === 'overview' && (
              <div className="space-y-6">
                <SectionHeader title={`Overview — Last ${period} Days`} sub="Across all pharmacies and warehouses in the district" />

                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
                  <StatCard label="Emergency Requests" value={data.overview.total_emergency} sub={`${fmtNum(data.overview.emergency_fulfilled)} fulfilled`} color="red" icon="🚨" />
                  <StatCard label="Demand Requests" value={data.overview.total_demand} sub={`${fmtNum(data.overview.demand_fulfilled)} fulfilled`} color="blue" icon="📋" />
                  <StatCard label="Emergency Qty" value={data.overview.total_emergency_qty} sub="units requested" color="purple" icon="💊" />
                  <StatCard label="Demand Qty" value={data.overview.total_demand_qty} sub="units requested" color="indigo" icon="📦" />
                  <StatCard label="Disposal Requests" value={data.overview.total_disposal} sub="expired medicine batches" color="yellow" icon="🗑️" />
                  <StatCard label="Active Pharmacies" value={data.overview.active_pharmacies} sub="made at least 1 request" color="green" icon="🏥" />
                </div>

                {/* Fulfillment rate cards */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="bg-white rounded-xl border p-5">
                    <h3 className="font-semibold text-gray-700 mb-3">Emergency Request Fulfillment Rate</h3>
                    {(() => {
                      const total = Number(data.overview.total_emergency);
                      const fulfilled = Number(data.overview.emergency_fulfilled);
                      const rejected = Number(data.overview.emergency_rejected);
                      const pending = total - fulfilled - rejected;
                      const pct = total > 0 ? Math.round((fulfilled / total) * 100) : 0;
                      return (
                        <>
                          <div className="flex items-end gap-2 mb-3">
                            <span className="text-4xl font-bold text-green-600">{pct}%</span>
                            <span className="text-gray-500 text-sm mb-1">fulfillment rate</span>
                          </div>
                          <div className="space-y-1.5 text-sm">
                            <div className="flex justify-between"><span className="text-green-600">✓ Fulfilled</span><span className="font-medium">{fmtNum(fulfilled)}</span></div>
                            <div className="flex justify-between"><span className="text-red-500">✗ Rejected</span><span className="font-medium">{fmtNum(rejected)}</span></div>
                            <div className="flex justify-between"><span className="text-yellow-600">⏳ Pending/In-progress</span><span className="font-medium">{fmtNum(pending)}</span></div>
                          </div>
                        </>
                      );
                    })()}
                  </div>

                  <div className="bg-white rounded-xl border p-5">
                    <h3 className="font-semibold text-gray-700 mb-3">Demand Request Fulfillment Rate</h3>
                    {(() => {
                      const total = Number(data.overview.total_demand);
                      const fulfilled = Number(data.overview.demand_fulfilled);
                      const pct = total > 0 ? Math.round((fulfilled / total) * 100) : 0;
                      const pending = total - fulfilled;
                      return (
                        <>
                          <div className="flex items-end gap-2 mb-3">
                            <span className="text-4xl font-bold text-blue-600">{pct}%</span>
                            <span className="text-gray-500 text-sm mb-1">fulfillment rate</span>
                          </div>
                          <div className="space-y-1.5 text-sm">
                            <div className="flex justify-between"><span className="text-green-600">✓ Fulfilled</span><span className="font-medium">{fmtNum(fulfilled)}</span></div>
                            <div className="flex justify-between"><span className="text-yellow-600">⏳ Pending/In-progress</span><span className="font-medium">{fmtNum(pending)}</span></div>
                          </div>
                        </>
                      );
                    })()}
                  </div>
                </div>

                {/* Top pharmacy requesters quick view */}
                {data.pharmacyActivity.length > 0 && (
                  <div className="bg-white rounded-xl border p-5">
                    <h3 className="font-semibold text-gray-700 mb-4">Most Active Pharmacies (Emergency Requests Sent)</h3>
                    <BarChart
                      data={data.pharmacyActivity.slice(0, 8)}
                      valueKey="emergency_sent_count"
                      labelKey="pharmacy_name"
                      color="bg-red-400"
                    />
                  </div>
                )}
              </div>
            )}

            {/* ── PHARMACY ACTIVITY ─────────────────────────────────────────── */}
            {activeSection === 'pharmacies' && (
              <div className="space-y-6">
                <SectionHeader title="Pharmacy Activity" sub={`Breakdown of every pharmacy's requests, fulfillments, and disposals in the last ${period} days`} />

                <div className="bg-white rounded-xl border overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-indigo-50">
                        <tr>
                          <th className="px-4 py-3 text-left text-indigo-700 font-semibold">Pharmacy</th>
                          <th className="px-4 py-3 text-left text-indigo-700 font-semibold">District / Block</th>
                          <th className="px-4 py-3 text-center text-red-600 font-semibold" colSpan={2}>Emergency Sent</th>
                          <th className="px-4 py-3 text-center text-green-600 font-semibold" colSpan={2}>Emergency Fulfilled</th>
                          <th className="px-4 py-3 text-center text-blue-600 font-semibold" colSpan={2}>Demand Requests</th>
                          <th className="px-4 py-3 text-center text-yellow-600 font-semibold">Disposals</th>
                          <th className="px-4 py-3 text-center text-gray-600 font-semibold">Net Flow</th>
                        </tr>
                        <tr className="bg-gray-50 text-xs text-gray-500">
                          <th className="px-4 py-1" />
                          <th className="px-4 py-1" />
                          <th className="px-4 py-1 text-center">Requests</th>
                          <th className="px-4 py-1 text-center">Units</th>
                          <th className="px-4 py-1 text-center">Requests</th>
                          <th className="px-4 py-1 text-center">Units</th>
                          <th className="px-4 py-1 text-center">Created</th>
                          <th className="px-4 py-1 text-center">Received</th>
                          <th className="px-4 py-1 text-center">Requests</th>
                          <th className="px-4 py-1 text-center">Received − Sent Out</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.pharmacyActivity.map((p, i) => {
                          const net = Number(p.emergency_fulfilled_qty) - Number(p.emergency_sent_qty);
                          return (
                            <tr key={p.pharmacy_id} className={`border-t ${i % 2 === 0 ? 'bg-white' : 'bg-gray-50'} hover:bg-indigo-50 transition-colors`}>
                              <td className="px-4 py-3 font-medium text-gray-800">{p.pharmacy_name}</td>
                              <td className="px-4 py-3 text-gray-500 text-xs">{p.district}<br />{p.block}</td>
                              <td className="px-4 py-3 text-center">
                                <span className={`font-bold ${Number(p.emergency_sent_count) > 0 ? 'text-red-600' : 'text-gray-400'}`}>{fmtNum(p.emergency_sent_count)}</span>
                              </td>
                              <td className="px-4 py-3 text-center text-gray-600">{fmtNum(p.emergency_sent_qty)}</td>
                              <td className="px-4 py-3 text-center">
                                <span className={`font-bold ${Number(p.emergency_fulfilled_count) > 0 ? 'text-green-600' : 'text-gray-400'}`}>{fmtNum(p.emergency_fulfilled_count)}</span>
                              </td>
                              <td className="px-4 py-3 text-center text-gray-600">{fmtNum(p.emergency_fulfilled_qty)}</td>
                              <td className="px-4 py-3 text-center font-medium text-blue-700">{fmtNum(p.demand_request_count)}</td>
                              <td className="px-4 py-3 text-center text-gray-600">{fmtNum(p.demand_received_count)}</td>
                              <td className="px-4 py-3 text-center">
                                {Number(p.disposal_count) > 0 ? (
                                  <span className="bg-yellow-100 text-yellow-700 font-semibold px-2 py-0.5 rounded-full">{fmtNum(p.disposal_count)}</span>
                                ) : <span className="text-gray-400">0</span>}
                              </td>
                              <td className="px-4 py-3 text-center">
                                <span className={`font-bold ${net > 0 ? 'text-green-600' : net < 0 ? 'text-red-500' : 'text-gray-400'}`}>
                                  {net > 0 ? `+${fmtNum(net)}` : fmtNum(net)}
                                </span>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  {data.pharmacyActivity.length === 0 && (
                    <p className="text-center text-gray-400 py-8">No pharmacy activity in this period</p>
                  )}
                </div>

                {/* Two bar charts side by side */}
                {data.pharmacyActivity.filter(p => Number(p.emergency_sent_count) > 0).length > 0 && (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="bg-white rounded-xl border p-5">
                      <h3 className="font-semibold text-gray-700 mb-4">Emergency Units Requested</h3>
                      <BarChart
                        data={data.pharmacyActivity.filter(p => Number(p.emergency_sent_qty) > 0).slice(0, 8)}
                        valueKey="emergency_sent_qty"
                        labelKey="pharmacy_name"
                        color="bg-red-400"
                      />
                    </div>
                    <div className="bg-white rounded-xl border p-5">
                      <h3 className="font-semibold text-gray-700 mb-4">Emergency Units Supplied to Others</h3>
                      <BarChart
                        data={data.pharmacyActivity.filter(p => Number(p.emergency_fulfilled_qty) > 0).slice(0, 8)}
                        valueKey="emergency_fulfilled_qty"
                        labelKey="pharmacy_name"
                        color="bg-green-400"
                      />
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* ── INTER-PHARMACY EXCHANGES ──────────────────────────────────── */}
            {activeSection === 'exchanges' && (
              <div className="space-y-6">
                <SectionHeader
                  title="Inter-Pharmacy Medicine Exchanges"
                  sub={`All completed emergency request fulfillments between pharmacies in the last ${period} days`}
                />

                {data.exchanges.length === 0 ? (
                  <div className="bg-white rounded-xl border p-12 text-center">
                    <p className="text-gray-400">No inter-pharmacy exchanges in this period</p>
                  </div>
                ) : (
                  <>
                    <div className="bg-white rounded-xl border overflow-hidden">
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead className="bg-indigo-50">
                            <tr>
                              <th className="px-4 py-3 text-left text-indigo-700 font-semibold">Requesting Pharmacy</th>
                              <th className="px-4 py-3 text-center text-gray-400">→</th>
                              <th className="px-4 py-3 text-left text-indigo-700 font-semibold">Supplying Pharmacy</th>
                              <th className="px-4 py-3 text-center text-indigo-700 font-semibold">Requests</th>
                              <th className="px-4 py-3 text-center text-indigo-700 font-semibold">Total Units</th>
                              <th className="px-4 py-3 text-left text-indigo-700 font-semibold">Medicines Exchanged</th>
                            </tr>
                          </thead>
                          <tbody>
                            {data.exchanges.map((ex, i) => (
                              <tr key={i} className={`border-t ${i % 2 === 0 ? 'bg-white' : 'bg-gray-50'} hover:bg-indigo-50`}>
                                <td className="px-4 py-3">
                                  <span className="font-medium text-red-700">{ex.requester_name}</span>
                                  <span className="text-xs text-gray-400 block">ID #{ex.requester_id}</span>
                                </td>
                                <td className="px-4 py-3 text-center text-2xl text-indigo-300">→</td>
                                <td className="px-4 py-3">
                                  <span className="font-medium text-green-700">{ex.supplier_name}</span>
                                  <span className="text-xs text-gray-400 block">ID #{ex.supplier_id}</span>
                                </td>
                                <td className="px-4 py-3 text-center">
                                  <span className="bg-indigo-100 text-indigo-700 font-bold px-3 py-1 rounded-full">{ex.request_count}</span>
                                </td>
                                <td className="px-4 py-3 text-center font-bold text-gray-800">{fmtNum(ex.total_qty)}</td>
                                <td className="px-4 py-3 text-gray-600 text-xs max-w-xs truncate" title={ex.medicines_list}>
                                  {ex.medicines_list || '—'}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>

                    {/* Exchange volume bar chart */}
                    <div className="bg-white rounded-xl border p-5">
                      <h3 className="font-semibold text-gray-700 mb-4">Exchange Volume by Pair</h3>
                      <BarChart
                        data={data.exchanges.map(e => ({ label: `${e.requester_name} → ${e.supplier_name}`, total_qty: e.total_qty }))}
                        valueKey="total_qty"
                        labelKey="label"
                        color="bg-indigo-400"
                      />
                    </div>
                  </>
                )}
              </div>
            )}

            {/* ── WAREHOUSE PERFORMANCE ─────────────────────────────────────── */}
            {activeSection === 'warehouse' && (
              <div className="space-y-6">
                <SectionHeader title="Drug Warehouse Performance" sub={`Medicine dispatch activity from warehouses in the last ${period} days`} />

                {data.warehouseStats.length === 0 ? (
                  <div className="bg-white rounded-xl border p-12 text-center text-gray-400">No warehouse activity in this period</div>
                ) : (
                  <>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                      {data.warehouseStats.map((w) => (
                        <div key={w.warehouse_id} className="bg-white rounded-xl border p-5">
                          <div className="flex items-center gap-2 mb-4">
                            <span className="text-2xl">🏭</span>
                            <div>
                              <h3 className="font-bold text-gray-800">{w.warehouse_name}</h3>
                              <p className="text-xs text-gray-500">{w.district}</p>
                            </div>
                          </div>
                          <div className="space-y-3">
                            <div className="flex justify-between items-center bg-blue-50 rounded-lg px-3 py-2">
                              <span className="text-sm text-blue-700 font-medium">Demand Orders Dispatched</span>
                              <span className="font-bold text-blue-800 text-lg">{fmtNum(w.demand_dispatched)}</span>
                            </div>
                            <div className="flex justify-between items-center bg-blue-50 rounded-lg px-3 py-2">
                              <span className="text-sm text-blue-700 font-medium">Demand Medicine Units</span>
                              <span className="font-bold text-blue-800">{fmtNum(w.demand_medicines_supplied)}</span>
                            </div>
                            <div className="flex justify-between items-center bg-red-50 rounded-lg px-3 py-2">
                              <span className="text-sm text-red-700 font-medium">Emergency Orders Dispatched</span>
                              <span className="font-bold text-red-800 text-lg">{fmtNum(w.emergency_dispatched)}</span>
                            </div>
                            <div className="flex justify-between items-center bg-red-50 rounded-lg px-3 py-2">
                              <span className="text-sm text-red-700 font-medium">Emergency Medicine Units</span>
                              <span className="font-bold text-red-800">{fmtNum(w.emergency_medicines_supplied)}</span>
                            </div>
                            <div className="flex justify-between items-center bg-yellow-50 rounded-lg px-3 py-2">
                              <span className="text-sm text-yellow-700 font-medium">Disposal Batches Completed</span>
                              <span className="font-bold text-yellow-800">{fmtNum(w.disposal_batches_handled)}</span>
                            </div>
                            <div className="flex justify-between items-center bg-gray-100 rounded-lg px-3 py-2 mt-2">
                              <span className="text-sm text-gray-700 font-bold">Total Units Supplied</span>
                              <span className="font-bold text-gray-900 text-lg">
                                {fmtNum(Number(w.demand_medicines_supplied) + Number(w.emergency_medicines_supplied))}
                              </span>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>

                    {/* Warehouse comparison */}
                    {data.warehouseStats.length > 1 && (
                      <div className="bg-white rounded-xl border p-5">
                        <h3 className="font-semibold text-gray-700 mb-4">Warehouse Supply Comparison (Total Units)</h3>
                        <BarChart
                          data={data.warehouseStats.map(w => ({
                            warehouse_name: w.warehouse_name,
                            total: Number(w.demand_medicines_supplied) + Number(w.emergency_medicines_supplied)
                          }))}
                          valueKey="total"
                          labelKey="warehouse_name"
                          color="bg-blue-500"
                        />
                      </div>
                    )}
                  </>
                )}
              </div>
            )}

            {/* ── TOP MEDICINES ─────────────────────────────────────────────── */}
            {activeSection === 'medicines' && (
              <div className="space-y-6">
                <SectionHeader title="Top Requested Medicines" sub={`Most demanded medicines across emergency and demand requests in the last ${period} days`} />

                {data.topMedicines.length === 0 ? (
                  <div className="bg-white rounded-xl border p-12 text-center text-gray-400">No medicine requests in this period</div>
                ) : (
                  <>
                    <div className="bg-white rounded-xl border overflow-hidden">
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead className="bg-indigo-50">
                            <tr>
                              <th className="px-4 py-3 text-left text-indigo-700 font-semibold">#</th>
                              <th className="px-4 py-3 text-left text-indigo-700 font-semibold">Medicine</th>
                              <th className="px-4 py-3 text-left text-indigo-700 font-semibold">Generic / Category</th>
                              <th className="px-4 py-3 text-center text-indigo-700 font-semibold">Total Requests</th>
                              <th className="px-4 py-3 text-center text-red-600 font-semibold">Emergency Units</th>
                              <th className="px-4 py-3 text-center text-blue-600 font-semibold">Demand Units</th>
                              <th className="px-4 py-3 text-center text-gray-700 font-semibold">Total Units</th>
                              <th className="px-4 py-3 text-left text-indigo-700 font-semibold">Demand Breakdown</th>
                            </tr>
                          </thead>
                          <tbody>
                            {data.topMedicines.map((m, i) => {
                              const maxQty = Number(data.topMedicines[0]?.total_qty_requested || 1);
                              const pct = Math.round((Number(m.total_qty_requested) / maxQty) * 100);
                              const emergencyPct = Number(m.total_qty_requested) > 0
                                ? Math.round((Number(m.emergency_qty) / Number(m.total_qty_requested)) * 100) : 0;
                              return (
                                <tr key={m.medicine_id} className={`border-t ${i % 2 === 0 ? 'bg-white' : 'bg-gray-50'} hover:bg-indigo-50`}>
                                  <td className="px-4 py-3 text-gray-400 font-bold">{i + 1}</td>
                                  <td className="px-4 py-3">
                                    <span className="font-semibold text-gray-800">{m.medicine_name}</span>
                                    {m.dosage && <span className="text-xs text-gray-500 block">{m.dosage} {m.unit}</span>}
                                  </td>
                                  <td className="px-4 py-3 text-xs text-gray-500">
                                    {m.generic_name || '—'}<br />
                                    <span className="text-gray-400">{m.category || ''}</span>
                                  </td>
                                  <td className="px-4 py-3 text-center font-bold text-gray-700">{fmtNum(m.total_requests)}</td>
                                  <td className="px-4 py-3 text-center text-red-600 font-semibold">{fmtNum(m.emergency_qty)}</td>
                                  <td className="px-4 py-3 text-center text-blue-600 font-semibold">{fmtNum(m.demand_qty)}</td>
                                  <td className="px-4 py-3 text-center font-bold text-gray-900">{fmtNum(m.total_qty_requested)}</td>
                                  <td className="px-4 py-3 min-w-[120px]">
                                    <div className="w-full bg-gray-100 rounded-full h-2 mb-1">
                                      <div className="h-2 rounded-full bg-red-400" style={{ width: `${emergencyPct}%` }} title={`${emergencyPct}% emergency`} />
                                    </div>
                                    <div className="w-full bg-gray-100 rounded-full h-2">
                                      <div className="h-2 rounded-full bg-blue-400" style={{ width: `${100 - emergencyPct}%` }} title={`${100 - emergencyPct}% demand`} />
                                    </div>
                                    <div className="text-xs text-gray-400 mt-0.5 flex justify-between">
                                      <span className="text-red-400">E:{emergencyPct}%</span>
                                      <span className="text-blue-400">D:{100 - emergencyPct}%</span>
                                    </div>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </div>

                    <div className="bg-white rounded-xl border p-5">
                      <h3 className="font-semibold text-gray-700 mb-4">Total Units Requested by Medicine</h3>
                      <BarChart
                        data={data.topMedicines.slice(0, 10)}
                        valueKey="total_qty_requested"
                        labelKey="medicine_name"
                        color="bg-purple-400"
                      />
                    </div>
                  </>
                )}
              </div>
            )}

            {/* ── TRENDS & STATUS ───────────────────────────────────────────── */}
            {activeSection === 'trends' && (
              <div className="space-y-6">
                <SectionHeader title="Trends & Status Breakdown" sub="Monthly request volume and current status distribution" />

                {/* Status breakdown */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="bg-white rounded-xl border p-5">
                    <h3 className="font-semibold text-gray-700 mb-4">Emergency Request Status (Last {period}d)</h3>
                    <div className="space-y-2">
                      {Object.entries(data.statusBreakdown.emergency).map(([status, count]) => (
                        <div key={status} className="flex items-center justify-between">
                          <Badge status={status} />
                          <div className="flex items-center gap-3 flex-1 ml-3">
                            <div className="flex-1 bg-gray-100 rounded-full h-2">
                              <div
                                className="bg-indigo-400 h-2 rounded-full"
                                style={{ width: `${Math.round((count / Number(data.overview.total_emergency)) * 100)}%` }}
                              />
                            </div>
                            <span className="font-bold text-gray-700 w-8 text-right">{count}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="bg-white rounded-xl border p-5">
                    <h3 className="font-semibold text-gray-700 mb-4">Demand Request Status (Last {period}d)</h3>
                    <div className="space-y-2">
                      {Object.entries(data.statusBreakdown.demand).map(([status, count]) => (
                        <div key={status} className="flex items-center justify-between">
                          <Badge status={status} />
                          <div className="flex items-center gap-3 flex-1 ml-3">
                            <div className="flex-1 bg-gray-100 rounded-full h-2">
                              <div
                                className="bg-blue-400 h-2 rounded-full"
                                style={{ width: `${Math.round((count / Number(data.overview.total_demand)) * 100)}%` }}
                              />
                            </div>
                            <span className="font-bold text-gray-700 w-8 text-right">{count}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Monthly trend */}
                {data.monthlyTrend.length > 0 && (
                  <div className="bg-white rounded-xl border p-5">
                    <h3 className="font-semibold text-gray-700 mb-6">Monthly Request Volume (Last 6 Months)</h3>
                    <div className="flex items-end gap-6 overflow-x-auto pb-2">
                      {data.monthlyTrend.map((m) => {
                        const maxVal = Math.max(...data.monthlyTrend.map(x => Math.max(x.emergency, x.demand)), 1);
                        const eH = Math.round((m.emergency / maxVal) * 120);
                        const dH = Math.round((m.demand / maxVal) * 120);
                        return (
                          <div key={m.month} className="flex flex-col items-center gap-1 min-w-[60px]">
                            <div className="flex items-end gap-1 h-32">
                              <div className="flex flex-col items-center">
                                <span className="text-xs text-red-500 font-bold mb-1">{m.emergency}</span>
                                <div className="w-6 bg-red-400 rounded-t" style={{ height: `${eH}px` }} title={`Emergency: ${m.emergency}`} />
                              </div>
                              <div className="flex flex-col items-center">
                                <span className="text-xs text-blue-500 font-bold mb-1">{m.demand}</span>
                                <div className="w-6 bg-blue-400 rounded-t" style={{ height: `${dH}px` }} title={`Demand: ${m.demand}`} />
                              </div>
                            </div>
                            <span className="text-xs text-gray-500 font-medium">{fmtMonth(m.month)}</span>
                          </div>
                        );
                      })}
                    </div>
                    <div className="flex gap-4 mt-3 text-xs text-gray-500">
                      <span className="flex items-center gap-1"><span className="w-3 h-3 bg-red-400 rounded inline-block" /> Emergency</span>
                      <span className="flex items-center gap-1"><span className="w-3 h-3 bg-blue-400 rounded inline-block" /> Demand</span>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* ── ACTIVITY FEED ─────────────────────────────────────────────── */}
            {activeSection === 'feed' && (
              <div className="space-y-4">
                <SectionHeader title="Recent Activity Feed" sub={`Latest 20 request events across all pharmacies in the last ${period} days`} />
                <div className="bg-white rounded-xl border divide-y">
                  {data.recentActivity.length === 0 ? (
                    <p className="text-center text-gray-400 py-8">No recent activity</p>
                  ) : data.recentActivity.map((item, i) => (
                    <div key={i} className="flex items-center gap-4 px-5 py-3 hover:bg-gray-50">
                      <span className="text-xl">{item.type === 'emergency' ? '🚨' : '📋'}</span>
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-gray-800 text-sm">{item.pharmacy_name}</span>
                          <span className="text-gray-400 text-xs">·</span>
                          <span className="text-xs text-gray-500 capitalize">{item.type} request #{item.request_id}</span>
                          {item.type === 'demand' && item.warehouse_name && (
                            <span className="text-xs text-gray-400">→ {item.warehouse_name}</span>
                          )}
                        </div>
                        <p className="text-xs text-gray-400 mt-0.5">{fmtDate(item.event_date)}</p>
                      </div>
                      <Badge status={item.status} />
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}
