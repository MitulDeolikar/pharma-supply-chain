import { useRouter } from 'next/router';
import { useEffect, useState, useMemo } from 'react';
import { ToastContainer, toast } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';
import useSSE from '../hooks/useSSE';

const fmtQty  = (n) => Number(n || 0).toLocaleString('en-IN');
const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
const isExpired   = (d) => d && new Date(d) < new Date();
const isNearExpiry = (d) => {
  if (!d) return false;
  const diff = (new Date(d) - new Date()) / (1000 * 60 * 60 * 24);
  return diff >= 0 && diff <= 90;
};

export default function BatchMonitor() {
  const router = useRouter();
  const [batches, setBatches]         = useState([]);
  const [loading, setLoading]         = useState(true);
  const [search, setSearch]           = useState('');
  const [filterNSQ, setFilterNSQ]     = useState(false);
  const [filterExpiry, setFilterExpiry] = useState('all'); // 'all' | 'expired' | 'near'
  const [declaring, setDeclaring]     = useState(null);   // batch_number+medicine_id being declared
  const [nsqModal, setNsqModal]       = useState(null);   // batch object to confirm declaration
  const [customMessage, setCustomMessage] = useState('');
  const [expandedBatch, setExpandedBatch] = useState(null); // key for expanded pharmacy list

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (!token) router.push('/');
  }, []);

  useEffect(() => {
    fetchBatches();
  }, []);

  // Real-time updates — refresh batch list whenever stock is added, edited, or removed
  // at any pharmacy (CMO sees all batches network-wide).
  const handleSSEEvent = (event) => {
    if (event.type.startsWith('stock:')) {
      fetchBatches();
    }
  };
  useSSE({ role: 'cmo', id: router.query.cmo_id, onEvent: handleSSEEvent });

  const fetchBatches = async () => {
    setLoading(true);
    try {
      const res  = await fetch('/api/fetchAllBatches');
      const data = await res.json();
      if (data.success) setBatches(data.batches);
      else toast.error('Failed to load batches');
    } catch (e) {
      toast.error('Error loading batches');
    } finally {
      setLoading(false);
    }
  };

  const filtered = useMemo(() => {
    return batches.filter(b => {
      const q = search.toLowerCase();
      const matchSearch = !q ||
        b.medicine_name?.toLowerCase().includes(q) ||
        b.batch_number?.toLowerCase().includes(q) ||
        b.generic_name?.toLowerCase().includes(q) ||
        b.category?.toLowerCase().includes(q);
      const matchNSQ = !filterNSQ || b.nsq_declared;
      const matchExpiry =
        filterExpiry === 'all'     ? true :
        filterExpiry === 'expired' ? isExpired(b.earliest_expiry) :
        filterExpiry === 'near'    ? isNearExpiry(b.earliest_expiry) : true;
      return matchSearch && matchNSQ && matchExpiry;
    });
  }, [batches, search, filterNSQ, filterExpiry]);

  const openNSQModal = (batch) => {
    setNsqModal(batch);
    setCustomMessage('');
  };

  const confirmDeclareNSQ = async () => {
    if (!nsqModal) return;
    const key = `${nsqModal.batch_number}_${nsqModal.medicine_id}`;
    setDeclaring(key);
    try {
      const cmo_id = router.query.cmo_id;
      const res  = await fetch('/api/declareNSQ', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          batch_number: nsqModal.batch_number,
          medicine_id:  nsqModal.medicine_id,
          cmo_id,
          message: customMessage || undefined,
        }),
      });
      const data = await res.json();
      if (data.success) {
        toast.success(`NSQ alert sent to ${data.notified_pharmacies} pharmacy(s) and ${data.notified_warehouses} warehouse(s)`);
        setNsqModal(null);
        fetchBatches();
      } else {
        toast.error(data.message || 'Failed to declare NSQ');
      }
    } catch (e) {
      toast.error('Error declaring NSQ');
    } finally {
      setDeclaring(null);
    }
  };

  const batchKey = (b) => `${b.batch_number}_${b.medicine_id}`;

  const expiryBadge = (expiry) => {
    if (isExpired(expiry))    return <span className="text-xs bg-red-100 text-red-700 px-2 py-0.5 rounded-full font-semibold">Expired</span>;
    if (isNearExpiry(expiry)) return <span className="text-xs bg-orange-100 text-orange-700 px-2 py-0.5 rounded-full font-semibold">Near Expiry</span>;
    return null;
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <ToastContainer position="top-right" autoClose={3000} />

      {/* Header */}
      <header className="bg-red-800 text-white px-6 py-4 shadow-lg">
        <div className="flex items-center gap-3 max-w-7xl mx-auto">
          <button onClick={() => router.back()} className="text-red-300 hover:text-white">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <div>
            <h1 className="text-2xl font-bold">Batch Quality Monitor</h1>
            <p className="text-red-200 text-sm">View all medicine batches across pharmacies & warehouses · Declare NSQ to alert all holders</p>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-6">
        {/* Filters */}
        <div className="bg-white rounded-xl border p-4 mb-5 flex flex-wrap gap-3 items-center">
          <input
            type="text"
            placeholder="Search medicine, batch number, generic..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm flex-1 min-w-[200px] focus:outline-none focus:ring-2 focus:ring-red-300"
          />
          <select
            value={filterExpiry}
            onChange={e => setFilterExpiry(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-300"
          >
            <option value="all">All Expiry</option>
            <option value="expired">Expired Only</option>
            <option value="near">Near Expiry (≤90 days)</option>
          </select>
          <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
            <input type="checkbox" checked={filterNSQ} onChange={e => setFilterNSQ(e.target.checked)}
              className="accent-red-600" />
            Show NSQ Declared Only
          </label>
          <span className="text-sm text-gray-400">{filtered.length} batch{filtered.length !== 1 ? 'es' : ''}</span>
        </div>

        {loading ? (
          <div className="flex justify-center items-center h-48">
            <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-red-600" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="bg-white rounded-xl border p-12 text-center text-gray-400">No batches found</div>
        ) : (
          <div className="space-y-3">
            {filtered.map(batch => {
              const key      = batchKey(batch);
              const expanded = expandedBatch === key;
              const expired  = isExpired(batch.earliest_expiry);
              const near     = isNearExpiry(batch.earliest_expiry);
              const nsq      = !!batch.nsq_declared;

              return (
                <div key={key}
                  className={`bg-white rounded-xl border shadow-sm overflow-hidden
                    ${nsq    ? 'border-red-400'    : ''}
                    ${!nsq && expired ? 'border-red-300'  : ''}
                    ${!nsq && !expired && near ? 'border-orange-300' : ''}
                  `}
                >
                  {/* Main row */}
                  <div className="flex items-center gap-4 p-4">
                    {/* NSQ / status indicator */}
                    <div className="shrink-0">
                      {nsq ? (
                        <div className="w-10 h-10 rounded-full bg-red-100 flex items-center justify-center" title="NSQ Declared">
                          <span className="text-lg">⚠️</span>
                        </div>
                      ) : (
                        <div className="w-10 h-10 rounded-full bg-gray-100 flex items-center justify-center">
                          <span className="text-lg">💊</span>
                        </div>
                      )}
                    </div>

                    {/* Medicine + batch info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2 mb-0.5">
                        <span className="font-bold text-gray-800">{batch.medicine_name || `Medicine #${batch.medicine_id}`}</span>
                        {batch.dosage && <span className="text-xs text-gray-500">{batch.dosage} {batch.unit}</span>}
                        {batch.generic_name && (
                          <span className="text-xs bg-indigo-50 text-indigo-600 px-2 py-0.5 rounded-full">{batch.generic_name}</span>
                        )}
                        {batch.category && (
                          <span className="text-xs text-gray-400">{batch.category}</span>
                        )}
                        {nsq && <span className="text-xs bg-red-100 text-red-700 font-bold px-2 py-0.5 rounded-full">NSQ DECLARED</span>}
                        {!nsq && expiryBadge(batch.earliest_expiry)}
                      </div>
                      <div className="flex flex-wrap gap-4 text-xs text-gray-500">
                        <span>Batch: <span className="font-mono font-semibold text-gray-700">{batch.batch_number}</span></span>
                        <span>Expiry: <span className={`font-semibold ${expired ? 'text-red-600' : near ? 'text-orange-600' : 'text-gray-700'}`}>{fmtDate(batch.earliest_expiry)}</span></span>
                        <span>Total Qty: <span className="font-semibold text-gray-700">{fmtQty(batch.total_qty)}</span></span>
                        <span>Held by: <span className="font-semibold text-gray-700">{batch.pharmacy_count} pharmacy(s){batch.warehouse_count > 0 ? `, ${batch.warehouse_count} warehouse(s)` : ''}</span></span>
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="shrink-0 flex items-center gap-2">
                      <button
                        onClick={() => setExpandedBatch(expanded ? null : key)}
                        className="px-3 py-1.5 text-xs border border-gray-300 rounded-lg text-gray-600 hover:bg-gray-50 transition-colors"
                      >
                        {expanded ? 'Hide' : `View Holders (${Number(batch.pharmacy_count) + Number(batch.warehouse_count)})`}
                      </button>
                      {!nsq ? (
                        <button
                          onClick={() => openNSQModal(batch)}
                          disabled={declaring === key}
                          className="px-4 py-1.5 text-xs bg-red-600 text-white font-semibold rounded-lg hover:bg-red-700 transition-colors disabled:opacity-50 flex items-center gap-1"
                        >
                          <span>⚠</span> Declare NSQ
                        </button>
                      ) : (
                        <span className="px-3 py-1.5 text-xs bg-red-50 text-red-600 font-semibold rounded-lg border border-red-200">
                          NSQ Sent
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Expanded holders list */}
                  {expanded && (
                    <div className="border-t bg-gray-50 px-4 py-3 space-y-3">
                      {(batch.pharmacies || []).length > 0 && (
                        <div>
                          <p className="text-xs font-semibold text-gray-500 mb-2">Pharmacies holding this batch:</p>
                          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
                            {batch.pharmacies.map(ph => (
                              <div key={ph.pharmacy_id} className="bg-white rounded-lg border px-3 py-2 text-sm flex justify-between items-start">
                                <div>
                                  <p className="font-medium text-gray-800">{ph.pharmacy_name}</p>
                                  <p className="text-xs text-gray-400">{ph.district}, {ph.block}</p>
                                  <span className="text-xs bg-blue-50 text-blue-600 px-1.5 py-0.5 rounded">Pharmacy</span>
                                </div>
                                <div className="text-right">
                                  <p className="font-bold text-gray-700">{fmtQty(ph.quantity)} units</p>
                                  <p className="text-xs text-gray-400">Exp: {fmtDate(ph.expiry_date)}</p>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                      {(batch.warehouses || []).length > 0 && (
                        <div>
                          <p className="text-xs font-semibold text-gray-500 mb-2">Warehouses holding this batch:</p>
                          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
                            {batch.warehouses.map(wh => (
                              <div key={wh.warehouse_id} className="bg-white rounded-lg border border-purple-200 px-3 py-2 text-sm flex justify-between items-start">
                                <div>
                                  <p className="font-medium text-gray-800">{wh.warehouse_name}</p>
                                  <p className="text-xs text-gray-400">{wh.district}, {wh.block}</p>
                                  <span className="text-xs bg-purple-50 text-purple-600 px-1.5 py-0.5 rounded">Warehouse</span>
                                </div>
                                <div className="text-right">
                                  <p className="font-bold text-gray-700">{fmtQty(wh.quantity)} units</p>
                                  <p className="text-xs text-gray-400">Exp: {fmtDate(wh.expiry_date)}</p>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </main>

      {/* NSQ Declaration Confirm Modal */}
      {nsqModal && (
        <div className="fixed inset-0 bg-black bg-opacity-60 flex items-center justify-center z-50 px-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-lg w-full p-6">
            <div className="flex items-start gap-3 mb-4">
              <div className="bg-red-100 rounded-full p-2 shrink-0">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
              </div>
              <div>
                <h3 className="text-lg font-bold text-gray-800">Declare Batch as NSQ</h3>
                <p className="text-sm text-gray-500">Not of Standard Quality — this will alert all holding pharmacies & warehouses</p>
              </div>
            </div>

            <div className="bg-red-50 border border-red-200 rounded-lg p-3 mb-4 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-600">Medicine:</span>
                <span className="font-bold text-gray-800">{nsqModal.medicine_name}</span>
              </div>
              <div className="flex justify-between mt-1">
                <span className="text-gray-600">Batch No.:</span>
                <span className="font-mono font-bold text-gray-800">{nsqModal.batch_number}</span>
              </div>
              <div className="flex justify-between mt-1">
                <span className="text-gray-600">Pharmacies to notify:</span>
                <span className="font-bold text-red-700">{nsqModal.pharmacy_count}</span>
              </div>
              {nsqModal.warehouse_count > 0 && (
                <div className="flex justify-between mt-1">
                  <span className="text-gray-600">Warehouses to notify:</span>
                  <span className="font-bold text-purple-700">{nsqModal.warehouse_count}</span>
                </div>
              )}
            </div>

            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Custom Message <span className="text-gray-400 font-normal">(optional — leave blank for default)</span>
              </label>
              <textarea
                rows={3}
                value={customMessage}
                onChange={e => setCustomMessage(e.target.value)}
                placeholder={`URGENT: Batch ${nsqModal.batch_number} of ${nsqModal.medicine_name} has been declared NSQ. Please quarantine and dispose immediately.`}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-300 resize-none"
              />
            </div>

            <p className="text-xs text-gray-500 mb-5 bg-yellow-50 border border-yellow-200 rounded p-3">
              A warning notification will appear on the dashboard of all <strong>{nsqModal.pharmacy_count}</strong> pharmacy(s)
              {nsqModal.warehouse_count > 0 && <> and <strong>{nsqModal.warehouse_count}</strong> warehouse(s)</>} holding this batch.
              They will be instructed to quarantine and dispose of the batch immediately.
            </p>

            <div className="flex gap-3">
              <button
                onClick={() => setNsqModal(null)}
                disabled={declaring === batchKey(nsqModal)}
                className="flex-1 px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={confirmDeclareNSQ}
                disabled={declaring === batchKey(nsqModal)}
                className="flex-1 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 font-semibold transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {declaring === batchKey(nsqModal) ? (
                  <><div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" /> Sending...</>
                ) : (
                  '⚠ Declare NSQ & Notify'
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
