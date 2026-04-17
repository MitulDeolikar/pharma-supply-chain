import { useRouter } from 'next/router';
import { useEffect, useState } from 'react';
import { ToastContainer, toast } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';
import useSSE from '../hooks/useSSE';

export default function PendingDeliveries() {
  const router = useRouter();
  const [demandOrders, setDemandOrders] = useState([]);
  const [emergencyOrders, setEmergencyOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [confirmingId, setConfirmingId] = useState(null); // request_id being confirmed
  const [confirmModal, setConfirmModal] = useState(null); // { request_id, request_type, items, source }
  const [discrepancyMode, setDiscrepancyMode] = useState(false); // show per-item qty inputs
  const [receivedQtys, setReceivedQtys] = useState({}); // { idx: received_qty }

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (!token) router.push('/');
  }, []);

  useEffect(() => {
    if (!router.query.pharmacy_id) return;
    fetchPendingReceipts();
  }, [router.query.pharmacy_id]);

  // Real-time updates — refresh when a delivery is dispatched to this pharmacy
  // or when this pharmacy confirms a receipt (list changes in both cases).
  const handleSSEEvent = (event) => {
    const t = event.type;
    if (t === 'emergency:allocated' || t === 'emergency:received' || t === 'demand:received') {
      fetchPendingReceipts();
      toast.info('Delivery list updated', { autoClose: 2000 });
    }
  };
  useSSE({ role: 'pharmacy', id: router.query.pharmacy_id, onEvent: handleSSEEvent });

  const fetchPendingReceipts = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/fetchPendingReceipts?pharmacy_id=${router.query.pharmacy_id}`);
      const data = await res.json();
      if (data.success) {
        setDemandOrders(data.demand || []);
        setEmergencyOrders(data.emergency || []);
      } else {
        toast.error('Failed to load pending deliveries');
      }
    } catch (err) {
      console.error(err);
      toast.error('Error loading pending deliveries');
    } finally {
      setLoading(false);
    }
  };

  const openConfirmModal = (order) => {
    setConfirmModal(order);
    setDiscrepancyMode(false);
    // Pre-fill receivedQtys with dispatched quantities (all-received default)
    const init = {};
    const items = order.dispatched_items && order.dispatched_items.length > 0 ? order.dispatched_items : (order.items || []);
    items.forEach((item, idx) => { init[idx] = item.quantity ?? item.quantity_requested ?? 0; });
    setReceivedQtys(init);
  };

  const closeConfirmModal = () => {
    setConfirmModal(null);
    setDiscrepancyMode(false);
    setReceivedQtys({});
  };

  const handleConfirmReceipt = async (reportDiscrepancy = false) => {
    if (!confirmModal) return;
    const { request_id, request_type } = confirmModal;
    const pharmacy_id = parseInt(router.query.pharmacy_id);
    setConfirmingId(request_id);

    try {
      // Step 1: Confirm receipt (always — stock gets added regardless)
      let endpoint, body;
      if (request_type === 'demand') {
        endpoint = '/api/confirmDemandOrderReceipt';
        body = { request_id, pharmacy_id };
      } else {
        endpoint = '/api/confirmOrderReceipt';
        body = { requestId: request_id, pharmacyId: pharmacy_id };
      }

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();

      if (!data.success) {
        toast.error(data.message || 'Failed to confirm receipt');
        return;
      }

      // Step 2: If discrepancy mode, report missing/short items to CMO
      if (reportDiscrepancy) {
        const sourceItems = confirmModal.dispatched_items && confirmModal.dispatched_items.length > 0
          ? confirmModal.dispatched_items
          : (confirmModal.items || []);

        const missingItems = sourceItems
          .map((item, idx) => {
            const dispatched = Number(item.quantity ?? item.quantity_requested ?? 0);
            const received   = Number(receivedQtys[idx] ?? dispatched);
            return {
              medicine_id:   item.medicine_id,
              medicine_name: item.medicine_name || `Medicine #${item.medicine_id}`,
              batch_number:  item.batch_number || null,
              dispatched_qty: dispatched,
              received_qty:   received,
            };
          })
          .filter(i => i.received_qty < i.dispatched_qty);

        if (missingItems.length > 0) {
          try {
            await fetch('/api/reportMissingItems', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                request_id, request_type, pharmacy_id,
                pharmacy_name: `Pharmacy #${pharmacy_id}`,
                missing_items: missingItems,
              }),
            });
            toast.warning(`⚠️ Receipt confirmed with ${missingItems.length} discrepancy item(s) reported to CMO.`);
          } catch (_) {
            toast.success('Receipt confirmed. (Discrepancy report failed to send.)');
          }
        } else {
          toast.success('Receipt confirmed! All items verified as received.');
        }
      } else {
        toast.success('Receipt confirmed! Stock has been updated.');
      }

      closeConfirmModal();
      fetchPendingReceipts();
    } catch (err) {
      console.error(err);
      toast.error('Error confirming receipt');
    } finally {
      setConfirmingId(null);
    }
  };

  const formatDate = (dateStr) => {
    if (!dateStr) return '—';
    return new Date(dateStr).toLocaleDateString('en-IN', {
      day: '2-digit', month: 'short', year: 'numeric',
    });
  };

  const totalPending = demandOrders.length + emergencyOrders.length;

  return (
    <div className="min-h-screen bg-gray-50">
      <ToastContainer position="top-right" autoClose={3000} />

      {/* Header */}
      <header className="bg-indigo-700 text-white px-6 py-4 shadow flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button
            onClick={() => router.back()}
            className="text-indigo-200 hover:text-white transition-colors"
            title="Go back"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <div>
            <h1 className="text-xl font-bold">Pending Deliveries</h1>
            <p className="text-indigo-200 text-sm">Confirm receipt of dispatched orders to update your stock</p>
          </div>
        </div>
        {totalPending > 0 && (
          <span className="bg-yellow-400 text-yellow-900 text-sm font-bold px-3 py-1 rounded-full">
            {totalPending} pending
          </span>
        )}
      </header>

      <main className="max-w-5xl mx-auto px-4 py-8">
        {loading ? (
          <div className="flex justify-center items-center h-48">
            <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-indigo-600" />
          </div>
        ) : totalPending === 0 ? (
          <div className="bg-white rounded-xl shadow p-12 text-center">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-16 w-16 mx-auto text-green-400 mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <h2 className="text-xl font-semibold text-gray-700">All caught up!</h2>
            <p className="text-gray-500 mt-1">No pending deliveries to confirm.</p>
          </div>
        ) : (
          <div className="space-y-8">
            {/* Demand Orders Section */}
            {demandOrders.length > 0 && (
              <section>
                <h2 className="text-lg font-semibold text-gray-700 mb-3 flex items-center gap-2">
                  <span className="inline-block w-3 h-3 rounded-full bg-blue-500" />
                  Demand Orders from Warehouse
                  <span className="text-sm font-normal text-gray-500">({demandOrders.length})</span>
                </h2>
                <div className="space-y-4">
                  {demandOrders.map((order) => (
                    <OrderCard
                      key={order.request_id}
                      order={order}
                      onConfirm={() => openConfirmModal(order)}
                      formatDate={formatDate}
                      accentColor="blue"
                    />
                  ))}
                </div>
              </section>
            )}

            {/* Emergency Orders Section */}
            {emergencyOrders.length > 0 && (
              <section>
                <h2 className="text-lg font-semibold text-gray-700 mb-3 flex items-center gap-2">
                  <span className="inline-block w-3 h-3 rounded-full bg-red-500" />
                  Emergency Orders from Pharmacy
                  <span className="text-sm font-normal text-gray-500">({emergencyOrders.length})</span>
                </h2>
                <div className="space-y-4">
                  {emergencyOrders.map((order) => (
                    <OrderCard
                      key={order.request_id}
                      order={order}
                      onConfirm={() => openConfirmModal(order)}
                      formatDate={formatDate}
                      accentColor="red"
                    />
                  ))}
                </div>
              </section>
            )}
          </div>
        )}
      </main>

      {/* Confirm Receipt Modal */}
      {confirmModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 px-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-lg w-full p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="bg-yellow-100 rounded-full p-2">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-yellow-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                </svg>
              </div>
              <div>
                <h3 className="text-lg font-bold text-gray-800">Confirm Order Receipt</h3>
                <p className="text-sm text-gray-500">
                  {confirmModal.request_type === 'demand' ? 'Demand' : 'Emergency'} Request #{confirmModal.request_id}
                </p>
              </div>
            </div>

            <p className="text-gray-700 mb-4 text-sm">
              Please physically verify that all the following medicines have been received in full before confirming:
            </p>

            {/* Show actual dispatched items if tracked, otherwise fall back to original request items */}
            {(confirmModal.dispatched_items && confirmModal.dispatched_items.length > 0) ? (
              <div className="mb-5">
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-xs font-semibold text-green-700 bg-green-100 px-2 py-0.5 rounded-full">Actual medicines dispatched</span>
                  {confirmModal.items && confirmModal.items.some(orig =>
                    !confirmModal.dispatched_items.some(d => d.medicine_id === orig.medicine_id)
                  ) && (
                    <span className="text-xs text-orange-600 bg-orange-50 px-2 py-0.5 rounded-full">⚠ Includes alternatives</span>
                  )}
                </div>
                <div className="border rounded-lg overflow-hidden">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-3 py-2 text-left text-gray-600">Medicine</th>
                        <th className="px-3 py-2 text-left text-gray-600">Batch No.</th>
                        <th className="px-3 py-2 text-left text-gray-600">Expiry</th>
                        <th className="px-3 py-2 text-right text-gray-600">Qty</th>
                      </tr>
                    </thead>
                    <tbody>
                      {confirmModal.dispatched_items.map((item, idx) => {
                        // Check if this is an alternative (medicine differs from any original item)
                        const isAlternative = confirmModal.items &&
                          !confirmModal.items.some(orig => orig.medicine_id === item.medicine_id);
                        return (
                          <tr key={idx} className={`border-t ${isAlternative ? 'bg-orange-50' : ''}`}>
                            <td className="px-3 py-2 text-gray-800">
                              <span className="font-medium">{item.medicine_name || `Medicine #${item.medicine_id}`}</span>
                              {item.dosage && <span className="text-xs text-gray-400 ml-1">{item.dosage} {item.unit}</span>}
                              {isAlternative && <span className="text-xs text-orange-600 ml-1">(alternative)</span>}
                            </td>
                            <td className="px-3 py-2 text-gray-500 font-mono text-xs">{item.batch_number}</td>
                            <td className="px-3 py-2 text-gray-500 text-xs">
                              {item.expiry_date ? new Date(item.expiry_date).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' }) : '—'}
                            </td>
                            <td className="px-3 py-2 text-right font-semibold text-gray-800">{item.quantity}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {/* Also show what was originally requested for reference */}
                <details className="mt-2">
                  <summary className="text-xs text-gray-400 cursor-pointer hover:text-gray-600">View original request</summary>
                  <div className="mt-1 border rounded-lg overflow-hidden">
                    <table className="w-full text-xs">
                      <thead className="bg-gray-50">
                        <tr>
                          <th className="px-3 py-1.5 text-left text-gray-500">Originally Requested</th>
                          <th className="px-3 py-1.5 text-right text-gray-500">Qty</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(confirmModal.items || []).map((item, idx) => (
                          <tr key={idx} className="border-t">
                            <td className="px-3 py-1.5 text-gray-600">{item.medicine_name || `Medicine #${item.medicine_id}`}</td>
                            <td className="px-3 py-1.5 text-right text-gray-600">{item.quantity_requested}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </details>
              </div>
            ) : (
              // Fallback: no dispatch tracking records (older requests), show original items
              <div className="border rounded-lg overflow-hidden mb-5">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-4 py-2 text-left text-gray-600">Medicine</th>
                      <th className="px-4 py-2 text-right text-gray-600">Qty</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(confirmModal.items || []).map((item, idx) => (
                      <tr key={idx} className="border-t">
                        <td className="px-4 py-2 text-gray-800">{item.medicine_name || `Medicine #${item.medicine_id}`}</td>
                        <td className="px-4 py-2 text-right font-medium text-gray-800">{item.quantity_requested}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* Discrepancy mode: per-item received qty inputs */}
            {discrepancyMode && (() => {
              const sourceItems = confirmModal.dispatched_items && confirmModal.dispatched_items.length > 0
                ? confirmModal.dispatched_items : (confirmModal.items || []);
              return (
                <div className="mb-4 bg-red-50 border border-red-200 rounded-lg p-3">
                  <p className="text-xs font-semibold text-red-700 mb-2">Enter actual quantities received for each item:</p>
                  <div className="space-y-2">
                    {sourceItems.map((item, idx) => {
                      const dispatched = Number(item.quantity ?? item.quantity_requested ?? 0);
                      const received   = Number(receivedQtys[idx] ?? dispatched);
                      const short      = dispatched - received;
                      return (
                        <div key={idx} className="flex items-center gap-2 text-sm">
                          <div className="flex-1 min-w-0">
                            <span className="font-medium text-gray-800 truncate block">
                              {item.medicine_name || `Medicine #${item.medicine_id}`}
                            </span>
                            {item.batch_number && <span className="text-xs text-gray-400">Batch: {item.batch_number}</span>}
                          </div>
                          <span className="text-xs text-gray-500 whitespace-nowrap">of {dispatched}</span>
                          <input
                            type="number"
                            min="0"
                            max={dispatched}
                            value={receivedQtys[idx] ?? dispatched}
                            onChange={e => setReceivedQtys(prev => ({ ...prev, [idx]: Math.min(dispatched, Math.max(0, Number(e.target.value))) }))}
                            className={`w-20 text-center border rounded px-2 py-1 text-sm outline-none focus:ring-2 ${short > 0 ? 'border-red-400 bg-red-50 text-red-700 focus:ring-red-300' : 'border-gray-300 focus:ring-indigo-300'}`}
                          />
                          {short > 0 && <span className="text-xs font-semibold text-red-600 whitespace-nowrap">−{short} missing</span>}
                          {short === 0 && <span className="text-xs text-green-600">✓</span>}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })()}

            {!discrepancyMode && (
              <p className="text-xs text-gray-500 mb-4 bg-yellow-50 border border-yellow-200 rounded p-3">
                By clicking <strong>All Received</strong>, you confirm physical receipt of all items above.
                If anything is missing or short-shipped, click <strong>Report Missing Items</strong> instead.
              </p>
            )}

            <div className="flex gap-2 flex-wrap">
              <button
                onClick={closeConfirmModal}
                disabled={confirmingId === confirmModal.request_id}
                className="flex-1 px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 transition-colors disabled:opacity-50 text-sm"
              >
                Cancel
              </button>

              {!discrepancyMode ? (
                <>
                  <button
                    onClick={() => setDiscrepancyMode(true)}
                    disabled={confirmingId === confirmModal.request_id}
                    className="flex-1 px-4 py-2 bg-orange-100 text-orange-700 border border-orange-300 rounded-lg hover:bg-orange-200 transition-colors font-semibold text-sm disabled:opacity-50"
                  >
                    ⚠ Report Missing Items
                  </button>
                  <button
                    onClick={() => handleConfirmReceipt(false)}
                    disabled={confirmingId === confirmModal.request_id}
                    className="flex-1 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors font-semibold disabled:opacity-50 flex items-center justify-center gap-2 text-sm"
                  >
                    {confirmingId === confirmModal.request_id ? (
                      <><div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" />Confirming...</>
                    ) : 'All Received'}
                  </button>
                </>
              ) : (
                <>
                  <button
                    onClick={() => setDiscrepancyMode(false)}
                    disabled={confirmingId === confirmModal.request_id}
                    className="flex-1 px-3 py-2 text-sm border border-gray-300 rounded-lg text-gray-600 hover:bg-gray-50 disabled:opacity-50"
                  >
                    Back
                  </button>
                  <button
                    onClick={() => handleConfirmReceipt(true)}
                    disabled={confirmingId === confirmModal.request_id}
                    className="flex-1 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors font-semibold disabled:opacity-50 flex items-center justify-center gap-2 text-sm"
                  >
                    {confirmingId === confirmModal.request_id ? (
                      <><div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" />Submitting...</>
                    ) : 'Confirm + Report to CMO'}
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function OrderCard({ order, onConfirm, formatDate, accentColor }) {
  const borderColor = accentColor === 'blue' ? 'border-blue-400' : 'border-red-400';
  const badgeColor = accentColor === 'blue' ? 'bg-blue-100 text-blue-700' : 'bg-red-100 text-red-700';

  let source, sourceType;
  if (order.request_type === 'demand') {
    source = order.warehouse_name || (order.accepting_warehouse_id ? `Warehouse #${order.accepting_warehouse_id}` : 'Unknown Warehouse');
    sourceType = 'Warehouse';
  } else {
    // Emergency — can be fulfilled by a pharmacy OR a warehouse
    if (order.accepting_pharmacy_name || order.accepting_pharmacy_id) {
      source = order.accepting_pharmacy_name || `Pharmacy #${order.accepting_pharmacy_id}`;
      sourceType = 'Pharmacy';
    } else if (order.accepting_warehouse_name || order.accepting_warehouse_id) {
      source = order.accepting_warehouse_name || `Warehouse #${order.accepting_warehouse_id}`;
      sourceType = 'Warehouse';
    } else {
      source = 'Unknown';
      sourceType = '';
    }
  }

  return (
    <div className={`bg-white rounded-xl shadow border-l-4 ${borderColor} p-5`}>
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-1">
            <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${badgeColor}`}>
              {order.request_type === 'demand' ? 'DEMAND' : 'EMERGENCY'}
            </span>
            <span className="text-sm font-bold text-gray-700">Request #{order.request_id}</span>
          </div>
          <p className="text-xs text-gray-500 mb-3">
            Dispatched from{sourceType ? ` (${sourceType})` : ''}: <span className="font-medium text-gray-700">{source}</span>
            &nbsp;&bull;&nbsp;Requested on {formatDate(order.request_date)}
          </p>

          {/* Medicine list */}
          <div className="space-y-1">
            {(order.items || []).map((item, idx) => (
              <div key={idx} className="flex justify-between text-sm text-gray-700 bg-gray-50 rounded px-3 py-1.5">
                <span>{item.medicine_name || `Medicine #${item.medicine_id}`}</span>
                <span className="font-semibold">{item.quantity_requested} {item.unit || ''}</span>
              </div>
            ))}
          </div>
        </div>

        <button
          onClick={onConfirm}
          className="shrink-0 px-4 py-2 bg-green-600 text-white text-sm font-semibold rounded-lg hover:bg-green-700 transition-colors shadow"
        >
          Confirm Receipt
        </button>
      </div>
    </div>
  );
}
