import { useRouter } from "next/router";
import { useEffect, useState } from "react";
import { ToastContainer, toast } from "react-toastify";
import "react-toastify/dist/ReactToastify.css";

const ManageExpiredMedicines = () => {
  const router = useRouter();
  const [allExpiredMedicines, setAllExpiredMedicines] = useState([]);
  const [nsqMedicines, setNsqMedicines] = useState([]);
  const [selectedNsq, setSelectedNsq] = useState(new Set());
  const [disposalList, setDisposalList] = useState([]);
  const [loading, setLoading] = useState(false);
  const [selectedInAll, setSelectedInAll] = useState(new Set());
  const [selectedInDisposal, setSelectedInDisposal] = useState(new Set());
  const [pastRequests, setPastRequests] = useState([]);
  const [remarks, setRemarks] = useState("");
  const [evidencePhoto, setEvidencePhoto] = useState(null);
  const [sendingRequest, setSendingRequest] = useState(false);
  const [pendingRequest, setPendingRequest] = useState(null);
  const [savingDraft, setSavingDraft] = useState(false);

  useEffect(() => {
    const checkAuth = async () => {
      try {
        const token = localStorage.getItem("token");
        if (!token) router.push("/");
      } catch (error) {
        router.push("/");
      }
    };
    checkAuth();
  }, []);

  // Fetch expired medicines, pending disposal request, and past disposal requests
  useEffect(() => {
    const fetchData = async () => {
      try {
        const { pharmacy_id } = router.query;
        if (!pharmacy_id) return;

        setLoading(true);

        // Fetch expired and NSQ medicines
        const expiredRes = await fetch(`/api/fetchExpiredMedicines?pharmacy_id=${pharmacy_id}`);
        const expiredData = await expiredRes.json();
        if (expiredData.success) {
          setAllExpiredMedicines(expiredData.expiredMedicines || []);
          setNsqMedicines(expiredData.nsqMedicines || []);
        }

        // Fetch current pending disposal request
        const pendingRes = await fetch(`/api/getPendingDisposalRequest?pharmacy_id=${pharmacy_id}`);
        const pendingData = await pendingRes.json();
        if (pendingData.success && pendingData.pendingRequest) {
          setPendingRequest(pendingData.pendingRequest);
          setDisposalList(pendingData.pendingRequest.items || []);
          setRemarks(pendingData.pendingRequest.remarks || "");
        }

        // Fetch past disposal requests
        const disposalRes = await fetch(`/api/getDisposalRequests?pharmacy_id=${pharmacy_id}`);
        const disposalData = await disposalRes.json();
        if (disposalData.success) {
          setPastRequests(disposalData.requests);
        }
      } catch (error) {
        console.error("Error fetching data:", error);
        toast.error("Error loading data");
      } finally {
        setLoading(false);
      }
    };

    if (router.query.pharmacy_id) {
      fetchData();
    }
  }, [router.query]);

  const formatDate = (dateStr) => {
    try {
      const date = new Date(dateStr);
      return date.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric'
      });
    } catch (e) {
      return dateStr;
    }
  };

  const toggleSelectAll = (selectedInAll, allExpiredMedicines) => {
    if (selectedInAll.size === allExpiredMedicines.length) {
      setSelectedInAll(new Set());
    } else {
      setSelectedInAll(new Set(allExpiredMedicines.map(m => m.stock_id)));
    }
  };

  const toggleSelect = (stock_id, list) => {
    const newSet = new Set(list);
    if (newSet.has(stock_id)) {
      newSet.delete(stock_id);
    } else {
      newSet.add(stock_id);
    }
    return newSet;
  };

  const moveNSQToDisposal = async () => {
    if (selectedNsq.size === 0) {
      toast.warning("Select NSQ medicines to add to disposal list");
      return;
    }
    const toMove = nsqMedicines.filter(m => selectedNsq.has(m.stock_id));
    setDisposalList(prev => [...prev, ...toMove]);
    setNsqMedicines(prev => prev.filter(m => !selectedNsq.has(m.stock_id)));
    setSelectedNsq(new Set());

    if (pendingRequest) {
      try {
        await fetch('/api/updateDisposalRequest', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            request_id: pendingRequest.request_id,
            action: 'add',
            stock_ids: toMove.map(m => m.stock_id)
          })
        });
      } catch (error) {
        console.error("Error updating disposal request with NSQ items:", error);
      }
    }
    toast.success(`${toMove.length} NSQ medicine(s) added to disposal list`);
  };

  const moveToDisposal = async () => {
    if (selectedInAll.size === 0) {
      toast.warning("Select medicines to add to disposal list");
      return;
    }
    const toMove = allExpiredMedicines.filter(m => selectedInAll.has(m.stock_id));
    setDisposalList([...disposalList, ...toMove]);
    setAllExpiredMedicines(allExpiredMedicines.filter(m => !selectedInAll.has(m.stock_id)));
    setSelectedInAll(new Set());

    // If pending request exists, update it with new items
    if (pendingRequest) {
      try {
        await fetch('/api/updateDisposalRequest', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            request_id: pendingRequest.request_id,
            action: 'add',
            stock_ids: toMove.map(m => m.stock_id)
          })
        });
      } catch (error) {
        console.error("Error updating disposal request:", error);
      }
    }

    toast.success(`${toMove.length} medicine(s) added to disposal list`);
  };

  const moveBack = async () => {
    if (selectedInDisposal.size === 0) {
      toast.warning("Select medicines to remove from disposal list");
      return;
    }
    const toMove = disposalList.filter(m => selectedInDisposal.has(m.stock_id));
    setAllExpiredMedicines([...allExpiredMedicines, ...toMove]);
    setDisposalList(disposalList.filter(m => !selectedInDisposal.has(m.stock_id)));
    setSelectedInDisposal(new Set());

    // If pending request exists, remove items from it
    if (pendingRequest) {
      try {
        await fetch('/api/updateDisposalRequest', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            request_id: pendingRequest.request_id,
            action: 'remove',
            stock_ids: toMove.map(m => m.stock_id)
          })
        });
      } catch (error) {
        console.error("Error updating disposal request:", error);
      }
    }

    toast.success(`${toMove.length} medicine(s) removed from disposal list`);
  };

  const handlePhotoUpload = (e) => {
    const file = e.target.files[0];
    if (file) {
      setEvidencePhoto(file);
      toast.success(`Photo selected: ${file.name}`);
    }
  };

  const handleSaveDraft = async () => {
    if (disposalList.length === 0) {
      toast.error("Disposal list is empty");
      return;
    }

    if (!remarks.trim()) {
      toast.error("Please add remarks for the disposal request");
      return;
    }

    try {
      setSavingDraft(true);
      const { pharmacy_id } = router.query;

      // Create disposal request with status='pending'
      const response = await fetch('/api/createDisposalRequest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pharmacy_id: parseInt(pharmacy_id),
          stock_ids: disposalList.map(m => m.stock_id),
          remarks
        })
      });

      const data = await response.json();

      if (data.success) {
        setPendingRequest({
          request_id: data.request_id,
          disposal_token: data.disposal_token,
          remarks,
          status: 'pending',
          item_count: disposalList.length,
          items: disposalList
        });
        toast.success(`✅ Draft saved! Token: ${data.disposal_token}`);
      } else {
        toast.error(data.message || "Error saving disposal request");
      }
    } catch (error) {
      console.error("Error saving disposal request:", error);
      toast.error("Error saving request");
    } finally {
      setSavingDraft(false);
    }
  };

  const handleSendRequest = async () => {
    if (!pendingRequest) {
      toast.error("No pending disposal request found. Save draft first.");
      return;
    }

    try {
      setSendingRequest(true);
      const { pharmacy_id } = router.query;

      // Update pending request status to 'request_sent'
      const response = await fetch('/api/sendDisposalRequest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          request_id: pendingRequest.request_id
        })
      });

      const data = await response.json();

      if (data.success) {
        toast.success(`✅ Request sent to warehouse! Token: ${pendingRequest.disposal_token}`);
        // Clear and refresh
        setDisposalList([]);
        setRemarks("");
        setEvidencePhoto(null);
        setPendingRequest(null);
        
        // Refresh past requests
        const disposalRes = await fetch(`/api/getDisposalRequests?pharmacy_id=${pharmacy_id}`);
        const disposalData = await disposalRes.json();
        if (disposalData.success) {
          setPastRequests(disposalData.requests);
        }
      } else {
        toast.error(data.message || "Error sending disposal request");
      }
    } catch (error) {
      console.error("Error sending disposal request:", error);
      toast.error("Error sending request");
    } finally {
      setSendingRequest(false);
    }
  };

  return (
    <>
      <ToastContainer position="top-center" autoClose={1500} hideProgressBar />
      <div className="min-h-screen bg-gray-100 py-6 px-4">
        <div className="flex items-center justify-between mb-8">
          <h1 className="text-3xl font-bold text-gray-900">Manage Expired Medicines</h1>
          <div className="space-x-3">
            <button
              onClick={() => router.push(`/user?pharmacy_id=${router.query.pharmacy_id}`)}
              className="px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 transition-colors flex items-center"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
              Back
            </button>
          </div>
        </div>

        {loading ? (
          <div className="text-center py-12">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-red-600 mx-auto"></div>
            <p className="mt-4 text-gray-600">Loading...</p>
          </div>
        ) : (
          <>
            {/* Status Legend */}
            <div className="mb-6 bg-white rounded-lg shadow-sm p-4 border-l-4 border-purple-600">
              <p className="text-sm font-semibold text-gray-700 mb-3">📌 Request Status Legend:</p>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm mb-4">
                <div className="flex items-start gap-2">
                  <span className="bg-yellow-100 text-yellow-800 px-2 py-1 rounded text-xs font-bold">⏳ PENDING</span>
                  <div>
                    <p className="text-gray-600 font-semibold">Draft saved locally</p>
                    <p className="text-xs text-gray-500">Not yet sent to warehouse</p>
                  </div>
                </div>
                <div className="flex items-start gap-2">
                  <span className="bg-blue-100 text-blue-800 px-2 py-1 rounded text-xs font-bold">📤 SENT</span>
                  <div>
                    <p className="text-gray-600 font-semibold">Sent to warehouse</p>
                    <p className="text-xs text-gray-500">Awaiting collection</p>
                  </div>
                </div>
                <div className="flex items-start gap-2">
                  <span className="bg-green-100 text-green-800 px-2 py-1 rounded text-xs font-bold">✅ DISPOSED</span>
                  <div>
                    <p className="text-gray-600 font-semibold">Collection complete</p>
                    <p className="text-xs text-gray-500">Auto-deleted from inventory</p>
                  </div>
                </div>
              </div>
              <div className="bg-blue-50 border border-blue-200 rounded p-3 text-xs text-blue-800">
                <p className="font-semibold mb-1">💡 Important Note:</p>
                <p>When the drug warehouse marks a disposal request as COMPLETED, the medicines are <strong>automatically deleted from your pharmacy inventory</strong>. You don't need to manually remove them - just wait for the warehouse to complete the collection.</p>
              </div>
            </div>

            {/* NSQ Medicines Section */}
            {nsqMedicines.length > 0 && (
              <div className="mb-6 bg-white rounded-lg shadow-md overflow-hidden border-2 border-red-500">
                <div className="px-6 py-4 bg-red-600 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-xl">⚠️</span>
                    <h2 className="text-lg font-bold text-white">
                      NSQ Batches — Not of Standard Quality ({nsqMedicines.length})
                    </h2>
                  </div>
                  <div className="flex items-center gap-3">
                    <label className="flex items-center gap-2 text-white text-sm cursor-pointer">
                      <input
                        type="checkbox"
                        checked={selectedNsq.size === nsqMedicines.length && nsqMedicines.length > 0}
                        onChange={() => {
                          if (selectedNsq.size === nsqMedicines.length) setSelectedNsq(new Set());
                          else setSelectedNsq(new Set(nsqMedicines.map(m => m.stock_id)));
                        }}
                        className="w-4 h-4 cursor-pointer"
                      />
                      Select All
                    </label>
                    <button
                      onClick={moveNSQToDisposal}
                      disabled={selectedNsq.size === 0}
                      className="px-4 py-1.5 bg-white text-red-700 font-semibold text-sm rounded-lg hover:bg-red-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >
                      Add {selectedNsq.size > 0 ? `(${selectedNsq.size})` : ''} to Disposal
                    </button>
                  </div>
                </div>
                <div className="p-4 bg-red-50 text-sm text-red-800 border-b border-red-200">
                  These batches have been declared <strong>Not of Standard Quality (NSQ)</strong> by the CMO.
                  Select and add to disposal list below to initiate the disposal process.
                </div>
                <div className="overflow-y-auto max-h-72">
                  {nsqMedicines.map((medicine) => (
                    <div
                      key={medicine.stock_id}
                      className={`p-4 border-b flex items-start gap-3 cursor-pointer hover:bg-red-50 transition ${
                        selectedNsq.has(medicine.stock_id) ? 'bg-red-100' : 'bg-white'
                      }`}
                      onClick={() => {
                        const next = new Set(selectedNsq);
                        next.has(medicine.stock_id) ? next.delete(medicine.stock_id) : next.add(medicine.stock_id);
                        setSelectedNsq(next);
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={selectedNsq.has(medicine.stock_id)}
                        onChange={() => {}}
                        className="w-5 h-5 mt-1 cursor-pointer"
                      />
                      <div className="flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-semibold text-gray-900">{medicine.medicine_name}</span>
                          <span className="text-xs bg-red-200 text-red-800 px-2 py-0.5 rounded-full font-bold">NSQ</span>
                          {medicine.dosage && <span className="text-xs text-gray-500">{medicine.dosage} {medicine.unit_type}</span>}
                        </div>
                        <div className="text-sm text-gray-500 mt-0.5">Batch: <span className="font-mono">{medicine.batch_number}</span></div>
                        <div className="text-sm text-gray-500">Qty: {medicine.quantity} {medicine.unit_type}</div>
                        <div className="text-xs text-gray-400 mt-0.5">Expiry: {formatDate(medicine.expiry_date)}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Two-Panel Layout */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
              {/* All Expired Medicines */}
              <div className="bg-white rounded-lg shadow-md overflow-hidden">
                <div className="px-6 py-4 bg-red-50 border-b flex items-center justify-between">
                  <h2 className="text-lg font-semibold text-red-800">
                    📋 All Expired Medicines ({allExpiredMedicines.length})
                  </h2>
                  <input
                    type="checkbox"
                    checked={selectedInAll.size === allExpiredMedicines.length && allExpiredMedicines.length > 0}
                    onChange={() => toggleSelectAll(selectedInAll, allExpiredMedicines)}
                    className="w-5 h-5 cursor-pointer"
                    title="Select all"
                  />
                </div>

                {allExpiredMedicines.length === 0 ? (
                  <div className="text-center py-12 text-gray-500">
                    <p>No expired medicines available</p>
                  </div>
                ) : (
                  <div className="overflow-y-auto max-h-96">
                    {allExpiredMedicines.map((medicine) => (
                      <div
                        key={medicine.stock_id}
                        className={`p-4 border-b flex items-start gap-3 cursor-pointer hover:bg-red-50 transition ${
                          selectedInAll.has(medicine.stock_id) ? 'bg-red-100' : ''
                        }`}
                        onClick={() => setSelectedInAll(toggleSelect(medicine.stock_id, selectedInAll))}
                      >
                        <input
                          type="checkbox"
                          checked={selectedInAll.has(medicine.stock_id)}
                          onChange={() => {}}
                          className="w-5 h-5 mt-1 cursor-pointer"
                        />
                        <div className="flex-1">
                          <div className="font-semibold text-gray-900">{medicine.medicine_name}</div>
                          <div className="text-sm text-gray-600">{medicine.dosage}</div>
                          <div className="text-sm text-gray-500">
                            Batch: {medicine.batch_number}
                          </div>
                          <div className="text-sm text-gray-500">
                            Qty: {medicine.quantity} {medicine.unit_type}
                          </div>
                          <div className="text-xs text-red-600 font-semibold mt-1">
                            Expired: {formatDate(medicine.expiry_date)}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Disposal List */}
              <div className="bg-white rounded-lg shadow-md overflow-hidden">
                <div className="px-6 py-4 bg-green-50 border-b flex items-center justify-between">
                  <h2 className="text-lg font-semibold text-green-800">
                    ✅ Disposal List ({disposalList.length})
                  </h2>
                  <input
                    type="checkbox"
                    checked={selectedInDisposal.size === disposalList.length && disposalList.length > 0}
                    onChange={() => {
                      if (selectedInDisposal.size === disposalList.length) {
                        setSelectedInDisposal(new Set());
                      } else {
                        setSelectedInDisposal(new Set(disposalList.map(m => m.stock_id)));
                      }
                    }}
                    className="w-5 h-5 cursor-pointer"
                    title="Select all"
                  />
                </div>

                {disposalList.length === 0 ? (
                  <div className="text-center py-12 text-gray-500">
                    <p>No medicines selected for disposal</p>
                  </div>
                ) : (
                  <div className="overflow-y-auto max-h-96">
                    {disposalList.map((medicine) => (
                      <div
                        key={medicine.stock_id}
                        className={`p-4 border-b flex items-start gap-3 cursor-pointer hover:bg-green-50 transition ${
                          selectedInDisposal.has(medicine.stock_id) ? 'bg-green-100' : ''
                        }`}
                        onClick={() => setSelectedInDisposal(toggleSelect(medicine.stock_id, selectedInDisposal))}
                      >
                        <input
                          type="checkbox"
                          checked={selectedInDisposal.has(medicine.stock_id)}
                          onChange={() => {}}
                          className="w-5 h-5 mt-1 cursor-pointer"
                        />
                        <div className="flex-1">
                          <div className="font-semibold text-gray-900">{medicine.medicine_name}</div>
                          <div className="text-sm text-gray-600">{medicine.dosage}</div>
                          <div className="text-sm text-gray-500">
                            Batch: {medicine.batch_number}
                          </div>
                          <div className="text-sm text-gray-500">
                            Qty: {medicine.quantity} {medicine.unit_type}
                          </div>
                          <div className="text-xs text-red-600 font-semibold mt-1">
                            Expires: {formatDate(medicine.expiry_date)}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Control Buttons */}
            <div className="flex justify-center gap-4 mb-8">
              <button
                onClick={moveToDisposal}
                disabled={selectedInAll.size === 0}
                className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition"
              >
                ➜ Add to Disposal ({selectedInAll.size})
              </button>
              <button
                onClick={moveBack}
                disabled={selectedInDisposal.size === 0}
                className="px-6 py-2 bg-orange-600 text-white rounded-lg hover:bg-orange-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition"
              >
                ← Remove ({selectedInDisposal.size})
              </button>
            </div>

            {/* Previous/Pending Request Status */}
            {pendingRequest && (
              <div className="mb-8 bg-white rounded-lg shadow-md p-6 border-l-4 border-blue-600">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-xl font-bold text-gray-900">📋 Previous Request Status</h3>
                  <span className={`px-4 py-2 rounded-full text-sm font-semibold ${
                    pendingRequest.status === 'pending'
                      ? 'bg-yellow-100 text-yellow-800'
                      : pendingRequest.status === 'request_sent'
                      ? 'bg-blue-100 text-blue-800'
                      : 'bg-green-100 text-green-800'
                  }`}>
                    {pendingRequest.status === 'pending'
                      ? '⏳ PENDING (Saved - Not Yet Sent)'
                      : pendingRequest.status === 'request_sent'
                      ? '📤 REQUEST SENT (Warehouse Collecting)'
                      : '✅ COMPLETED (Disposed)'}
                  </span>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                  <div>
                    <p className="text-sm text-gray-600">Disposal Token</p>
                    <p className="text-lg font-mono font-bold text-blue-600">{pendingRequest.disposal_token}</p>
                  </div>
                  <div>
                    <p className="text-sm text-gray-600">Items in Request</p>
                    <p className="text-lg font-bold text-gray-900">{pendingRequest.item_count} medicine(s)</p>
                  </div>
                  <div className="md:col-span-2">
                    <p className="text-sm text-gray-600">Remarks</p>
                    <p className="text-gray-900">{pendingRequest.remarks || 'No remarks'}</p>
                  </div>
                </div>
                {pendingRequest.status === 'pending' && (
                  <div className="bg-yellow-50 border border-yellow-200 rounded p-3 text-sm text-yellow-800">
                    This request is saved but NOT yet sent to the warehouse. Click "Send to Warehouse" below to request collection.
                  </div>
                )}
                {pendingRequest.status === 'request_sent' && (
                  <div className="bg-blue-50 border border-blue-200 rounded p-3 text-sm text-blue-800">
                    This request has been sent to the warehouse. They will collect the medicines at scheduled time.
                  </div>
                )}
                {pendingRequest.status === 'completed' && (
                  <div className="bg-green-50 border border-green-200 rounded p-3 text-sm text-green-800">
                    ✓ This disposal batch has been completed and disposed.
                  </div>
                )}
              </div>
            )}

            {/* Disposal Request Section */}
            {disposalList.length > 0 && (
              <div className="bg-white rounded-lg shadow-md p-6 border-l-4 border-green-600">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-xl font-bold text-gray-900">
                    {pendingRequest ? '📝 Update Existing Draft' : '✏️ Create New Disposal Request'}
                  </h3>
                  {pendingRequest && (
                    <span className="px-3 py-1 rounded-full text-xs font-semibold bg-blue-100 text-blue-800">
                      Token: {pendingRequest.disposal_token}
                    </span>
                  )}
                </div>

                {/* Workflow Info */}
                <div className="bg-green-50 border border-green-200 rounded-lg p-3 mb-4 text-sm text-green-800">
                  <p className="font-semibold mb-1">📋 Workflow:</p>
                  <p>1. Save as draft → 2. Send to warehouse → 3. Warehouse collects & marks complete → 4. Medicines auto-deleted from your inventory</p>
                </div>

                <div className="space-y-4">
                  {/* Remarks */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Remarks / Reason for Disposal
                    </label>
                    <textarea
                      value={remarks}
                      onChange={(e) => setRemarks(e.target.value)}
                      placeholder="E.g., Stock expiry, disposal batch collection"
                      className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent"
                      rows="3"
                    />
                  </div>

                  {/* Photo Upload */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Evidence Photo (optional)
                    </label>
                    <input
                      type="file"
                      accept="image/*"
                      onChange={handlePhotoUpload}
                      className="block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:bg-green-50 file:text-green-700 hover:file:bg-green-100"
                    />
                    {evidencePhoto && <p className="mt-2 text-sm text-green-600">✓ {evidencePhoto.name}</p>}
                  </div>

                  {/* Summary */}
                  <div className="bg-green-50 p-4 rounded-lg border border-green-200">
                    <div className="grid grid-cols-3 gap-4 text-center">
                      <div>
                        <div className="text-2xl font-bold text-green-700">{disposalList.length}</div>
                        <div className="text-sm text-gray-600">Medicines</div>
                      </div>
                      <div>
                        <div className="text-2xl font-bold text-green-700">
                          {disposalList.reduce((sum, m) => sum + m.quantity, 0)}
                        </div>
                        <div className="text-sm text-gray-600">Total Units</div>
                      </div>
                    </div>
                  </div>

                  {/* Buttons */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {!pendingRequest ? (
                      <>
                        {/* Save Draft Button */}
                        <button
                          onClick={handleSaveDraft}
                          disabled={savingDraft || !remarks.trim()}
                          className="py-3 bg-blue-600 text-white font-semibold rounded-lg hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition flex items-center justify-center gap-2 md:col-span-2"
                        >
                          {savingDraft ? (
                            <>
                              <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                              Saving Draft...
                            </>
                          ) : (
                            <>
                              💾 Save as Draft (Pending)
                            </>
                          )}
                        </button>
                      </>
                    ) : (
                      <>
                        {/* Send Request Button */}
                        <button
                          onClick={handleSendRequest}
                          disabled={sendingRequest || pendingRequest.status !== 'pending'}
                          className="py-3 bg-green-600 text-white font-semibold rounded-lg hover:bg-green-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition flex items-center justify-center gap-2 md:col-span-2"
                        >
                          {sendingRequest ? (
                            <>
                              <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                              Sending to Warehouse...
                            </>
                          ) : pendingRequest.status === 'pending' ? (
                            <>
                              📤 Send to Warehouse (Request Collection)
                            </>
                          ) : (
                            <>
                              Already Sent / Completed
                            </>
                          )}
                        </button>
                      </>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* Past Disposal Requests */}
            {pastRequests.length > 0 && (
              <div className="mt-8 bg-white rounded-lg shadow-md overflow-hidden">
                <div className="px-6 py-4 bg-blue-50 border-b">
                  <h3 className="text-lg font-semibold text-blue-800">📋 All Disposal Requests History</h3>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full divide-y divide-gray-200">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Token</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Items</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Date</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Remarks</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200">
                      {pastRequests.map((req) => (
                        <tr key={req.request_id} className="hover:bg-gray-50">
                          <td className="px-6 py-4">
                            <span className="font-mono font-bold text-blue-600">{req.disposal_token}</span>
                          </td>
                          <td className="px-6 py-4 text-sm">{req.item_count} medicine(s)</td>
                          <td className="px-6 py-4">
                            <div>
                              <span className={`px-3 py-1 rounded-full text-xs font-semibold inline-block ${
                                req.status === 'pending'
                                  ? 'bg-yellow-100 text-yellow-800'
                                  : req.status === 'request_sent'
                                  ? 'bg-blue-100 text-blue-800'
                                  : 'bg-green-100 text-green-800'
                              }`}>
                                {req.status === 'pending' ? '⏳ Pending' : req.status === 'request_sent' ? '📤 Sent' : '✅ Disposed'}
                              </span>
                              <p className="text-xs text-gray-500 mt-1">
                                {req.status === 'pending'
                                  ? '(Draft saved, not sent)'
                                  : req.status === 'request_sent'
                                  ? '(Sent to warehouse)'
                                  : '(Collection completed)'}
                              </p>
                            </div>
                          </td>
                          <td className="px-6 py-4 text-sm">{formatDate(req.request_date)}</td>
                          <td className="px-6 py-4 text-sm text-gray-600">{req.remarks}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </>
  );
};

export default ManageExpiredMedicines;