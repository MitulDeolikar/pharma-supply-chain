import { useRouter } from "next/router";
import { useEffect, useState } from "react";
import Modal from "react-modal";
import { ToastContainer, toast } from "react-toastify";
import "react-toastify/dist/ReactToastify.css";
import useSSE from '../hooks/useSSE';

const WarehouseDisposalRequests = () => {
  const router = useRouter();
  const [disposalRequests, setDisposalRequests] = useState([]);
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const [filteredRequests, setFilteredRequests] = useState([]);
  const [loading, setLoading] = useState(false);
  const [selectedRequest, setSelectedRequest] = useState(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedRequests, setSelectedRequests] = useState([]); // Array of request_ids to batch
  const [optimizedRoute, setOptimizedRoute] = useState(null); // Optimized route data
  const [isRouteModalOpen, setIsRouteModalOpen] = useState(false); // Route optimization modal
  const [isCreatingBatch, setIsCreatingBatch] = useState(false); // Loading state for batch creation
  const [disposalBatches, setDisposalBatches] = useState([]); // List of created batches
  const [activeTab, setActiveTab] = useState('pending'); // 'pending' or 'batches'
  const [batchDisposalSelection, setBatchDisposalSelection] = useState({}); // Track which requests in batch are selected for disposal
  const [isDisposing, setIsDisposing] = useState(false); // Loading state for disposal
  const [isMergingToBatch, setIsMergingToBatch] = useState(false); // Loading state for merging to batch
  const [showMergeToBatchModal, setShowMergeToBatchModal] = useState(false); // Show merge to batch modal

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

  // Fetch disposal requests with request_sent status
  useEffect(() => {
    const fetchDisposalRequests = async () => {
      try {
        const { warehouse_id } = router.query;
        if (!warehouse_id) return;

        setLoading(true);

        const response = await fetch(
          `/api/warehouseGetDisposalRequests?warehouse_id=${warehouse_id}&status=request_sent`
        );
        const data = await response.json();

        if (data.success) {
          setDisposalRequests(data.requests);
          setFilteredRequests(data.requests);
        } else {
          toast.error("Failed to fetch disposal requests");
        }
      } catch (error) {
        console.error("Error fetching disposal requests:", error);
        toast.error("Error loading disposal requests");
      } finally {
        setLoading(false);
      }
    };

    if (router.query.warehouse_id) {
      fetchDisposalRequests();
    }
  }, [router.query, refreshTrigger]);

  // Fetch disposal batches
  useEffect(() => {
    const fetchBatches = async () => {
      try {
        const { warehouse_id } = router.query;
        if (!warehouse_id) return;
        
        const response = await fetch(`/api/getDisposalBatches?warehouse_id=${warehouse_id}`);
        const data = await response.json();
        
        if (data.success) {
          setDisposalBatches(data.batches);
        }
      } catch (error) {
        console.error("Error fetching batches:", error);
      }
    };

    if (router.query.warehouse_id) {
      fetchBatches();
    }
  }, [router.query, refreshTrigger]);

  // Real-time updates — refresh when warehouse dispatches a batch or new disposal
  // stock is removed at a pharmacy (new disposal requests may arrive).
  const handleSSEEvent = (event) => {
    const t = event.type;
    if (t === 'warehouse:dispatched' || t === 'stock:removed') {
      setRefreshTrigger(prev => prev + 1);
      toast.info('Disposal list updated', { autoClose: 2000 });
    }
  };
  useSSE({ role: 'warehouse', id: router.query.warehouse_id, onEvent: handleSSEEvent });

  const formatDate = (dateStr) => {
    try {
      const date = new Date(dateStr);
      return date.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
    } catch (e) {
      return dateStr;
    }
  };

  const handleSearch = (e) => {
    const query = e.target.value.toLowerCase();
    setSearchQuery(query);

    const filtered = disposalRequests.filter(
      (request) =>
        (request.disposal_token && request.disposal_token.toLowerCase().includes(query)) ||
        (request.pharmacy_name && request.pharmacy_name.toLowerCase().includes(query)) ||
        (request.remarks && request.remarks.toLowerCase().includes(query))
    );
    setFilteredRequests(filtered);
  };

  // Select/deselect disposal request for batching
  const handleSelectRequest = (request_id) => {
    setSelectedRequests((prev) =>
      prev.includes(request_id)
        ? prev.filter((id) => id !== request_id)
        : [...prev, request_id]
    );
  };

  // Select all filtered requests
  const handleSelectAll = () => {
    if (selectedRequests.length === filteredRequests.length) {
      setSelectedRequests([]);
    } else {
      setSelectedRequests(filteredRequests.map((r) => r.request_id));
    }
  };

  // Optimize route for selected requests
  const handleOptimizeRoute = async () => {
    if (selectedRequests.length === 0) {
      toast.error("Please select at least one disposal request");
      return;
    }

    try {
      setIsCreatingBatch(true);

      // Get selected request details for pharmacy info
      const selectedRequestData = disposalRequests.filter((r) =>
        selectedRequests.includes(r.request_id)
      );

      const response = await fetch("/api/optimizeDisposalRoute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          selected_requests: selectedRequests,
          warehouse_id: router.query.warehouse_id,
          requests_data: selectedRequestData,
        }),
      });

      const data = await response.json();

      if (data.success) {
        setOptimizedRoute(data.optimized_route);
        setIsRouteModalOpen(true);
      } else {
        toast.error(data.error || "Failed to optimize route");
      }
    } catch (error) {
      console.error("Error optimizing route:", error);
      toast.error("Error optimizing route");
    } finally {
      setIsCreatingBatch(false);
    }
  };

  // Create disposal batch
  const handleCreateBatch = async () => {
    if (!optimizedRoute || selectedRequests.length === 0) {
      toast.error("Invalid batch data");
      return;
    }

    try {
      setIsCreatingBatch(true);

      const response = await fetch("/api/createDisposalBatch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          selected_requests: selectedRequests,
          warehouse_id: router.query.warehouse_id,
          // No need to send optimized_route - it's calculated on-the-fly when needed
        }),
      });

      const data = await response.json();

      if (data.success) {
        toast.success(`Batch created successfully! Batch ID: ${data.batch_id}`);
        setIsRouteModalOpen(false);
        setSelectedRequests([]);
        setOptimizedRoute(null);

        // Refresh lists
        const disposalResponse = await fetch(
          `/api/warehouseGetDisposalRequests?warehouse_id=${router.query.warehouse_id}&status=request_sent`
        );
        const disposalData = await disposalResponse.json();
        if (disposalData.success) {
          setDisposalRequests(disposalData.requests);
          setFilteredRequests(disposalData.requests);
        }

        // Refresh batches
        const batchResponse = await fetch(`/api/getDisposalBatches?warehouse_id=${router.query.warehouse_id}`);
        const batchData = await batchResponse.json();
        if (batchData.success) {
          setDisposalBatches(batchData.batches);
        }
      } else {
        toast.error(data.error || "Failed to create batch");
      }
    } catch (error) {
      console.error("Error creating batch:", error);
      toast.error("Error creating batch");
    } finally {
      setIsCreatingBatch(false);
    }
  };

  const openModal = (request) => {
    setSelectedRequest(request);
    setIsModalOpen(true);
  };

  const closeModal = () => {
    setSelectedRequest(null);
    setIsModalOpen(false);
  };

  const totalQuantity = (request) => {
    return request.items.reduce((sum, item) => sum + item.quantity, 0);
  };

  const handleConfirmPickup = async (request) => {
    const remarks = prompt("Enter pickup confirmation remarks:");
    if (!remarks) return;

    try {
      // TODO: Create API to confirm pickup and update disposal request status
      toast.success(`Pickup confirmed for token: ${request.disposal_token}`);
      closeModal();
      // Refresh list
      const response = await fetch(
        `/api/warehouseGetDisposalRequests?warehouse_id=${router.query.warehouse_id}&status=request_sent`
      );
      const data = await response.json();
      if (data.success) {
        setDisposalRequests(data.requests);
        setFilteredRequests(data.requests);
      }
    } catch (error) {
      console.error("Error confirming pickup:", error);
      toast.error("Error confirming pickup");
    }
  };

  // Toggle request selection for disposal in batch
  const handleToggleBatchRequestSelection = (batch_id, request_id) => {
    setBatchDisposalSelection((prev) => {
      const batchSelection = prev[batch_id] || [];
      return {
        ...prev,
        [batch_id]: batchSelection.includes(request_id)
          ? batchSelection.filter((id) => id !== request_id)
          : [...batchSelection, request_id],
      };
    });
  };

  // Dispose selected requests in batch
  const handleDisposeSelectedRequests = async (batch_id) => {
    const selectedForDisposal = batchDisposalSelection[batch_id] || [];

    if (selectedForDisposal.length === 0) {
      toast.error("Please select requests to dispose");
      return;
    }

    try {
      setIsDisposing(true);

      const response = await fetch("/api/disposeRequests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          batch_id: batch_id,
          selected_requests: selectedForDisposal,
        }),
      });

      const data = await response.json();

      if (data.success) {
        toast.success(`${selectedForDisposal.length} request(s) marked as disposed!`);
        setBatchDisposalSelection((prev) => ({
          ...prev,
          [batch_id]: [],
        }));

        // Refresh batches
        const batchResponse = await fetch(`/api/getDisposalBatches?warehouse_id=${router.query.warehouse_id}`);
        const batchData = await batchResponse.json();
        if (batchData.success) {
          setDisposalBatches(batchData.batches);
        }
      } else {
        toast.error(data.error || "Failed to dispose requests");
      }
    } catch (error) {
      console.error("Error disposing requests:", error);
      toast.error("Error disposing requests");
    } finally {
      setIsDisposing(false);
    }
  };

  // Mark batch as completed
  const handleMarkBatchCompleted = async (batch_id) => {
    try {
      const response = await fetch("/api/markBatchCompleted", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ batch_id }),
      });

      const data = await response.json();

      if (data.success) {
        toast.success(`Batch #${batch_id} marked as completed!`);

        // Refresh batches
        const batchResponse = await fetch(`/api/getDisposalBatches?warehouse_id=${router.query.warehouse_id}`);
        const batchData = await batchResponse.json();
        if (batchData.success) {
          setDisposalBatches(batchData.batches);
        }
      } else {
        toast.error(data.error || "Failed to mark batch as completed");
      }
    } catch (error) {
      console.error("Error marking batch as completed:", error);
      toast.error("Error marking batch as completed");
    }
  };

  // Merge selected requests into an existing batch
  const handleMergeRequestsToBatch = async (batch_id) => {
    if (selectedRequests.length === 0) {
      toast.error("Please select requests to add");
      return;
    }

    try {
      setIsMergingToBatch(true);

      const response = await fetch("/api/mergeRequestsToBatch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          batch_id: batch_id,
          request_ids: selectedRequests,
        }),
      });

      const data = await response.json();

      if (data.success) {
        toast.success(`${selectedRequests.length} request(s) added to Batch #${batch_id}!`);
        setShowMergeToBatchModal(false);
        setSelectedRequests([]);

        // Refresh lists
        const disposalResponse = await fetch(
          `/api/warehouseGetDisposalRequests?warehouse_id=${router.query.warehouse_id}&status=request_sent`
        );
        const disposalData = await disposalResponse.json();
        if (disposalData.success) {
          setDisposalRequests(disposalData.requests);
          setFilteredRequests(disposalData.requests);
        }

        // Refresh batches
        const batchResponse = await fetch(`/api/getDisposalBatches?warehouse_id=${router.query.warehouse_id}`);
        const batchData = await batchResponse.json();
        if (batchData.success) {
          setDisposalBatches(batchData.batches);
        }
      } else {
        toast.error(data.error || "Failed to add requests to batch");
      }
    } catch (error) {
      console.error("Error merging requests to batch:", error);
      toast.error("Error adding requests to batch");
    } finally {
      setIsMergingToBatch(false);
    }
  };

  return (
    <>
      <ToastContainer position="top-center" autoClose={1500} hideProgressBar />
      <div className="min-h-screen bg-gray-100 py-6 px-4">
        <div className="flex items-center justify-between mb-8">
          <h1 className="text-3xl font-bold text-gray-900">
            📤 Disposal Management
          </h1>
          <button
            onClick={() => router.push(`/warehouse?warehouse_id=${router.query.warehouse_id}`)}
            className="px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 transition-colors flex items-center"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            Back to Dashboard
          </button>
        </div>

        {/* Tab Navigation */}
        <div className="flex gap-2 mb-6 bg-white rounded-lg shadow p-2">
          <button
            onClick={() => setActiveTab('pending')}
            className={`px-6 py-3 rounded-lg font-semibold transition-all ${
              activeTab === 'pending'
                ? 'bg-blue-600 text-white'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            📋 Pending Requests ({disposalRequests.filter(r => !r.batch_id).length})
          </button>
          <button
            onClick={() => setActiveTab('batches')}
            className={`px-6 py-3 rounded-lg font-semibold transition-all ${
              activeTab === 'batches'
                ? 'bg-blue-600 text-white'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            📦 Disposed Batches ({disposalBatches.length})
          </button>
        </div>

        {loading ? (
          <div className="text-center py-12">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
            <p className="mt-4 text-gray-600">Loading...</p>
          </div>
        ) : (
          <>
            {/* PENDING REQUESTS TAB */}
            {activeTab === 'pending' && (
              <>
                {/* Summary Stats */}
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
                  <div className="bg-white rounded-lg shadow p-4 border-l-4 border-blue-600">
                    <p className="text-gray-600 text-sm font-medium">Pending Requests</p>
                    <p className="text-3xl font-bold text-blue-600">{disposalRequests.filter(r => !r.batch_id).length}</p>
                  </div>
                  <div className="bg-white rounded-lg shadow p-4 border-l-4 border-green-600">
                    <p className="text-gray-600 text-sm font-medium">Total Items</p>
                    <p className="text-3xl font-bold text-green-600">
                      {disposalRequests.filter(r => !r.batch_id).reduce((sum, r) => sum + r.item_count, 0)}
                    </p>
                  </div>
                  <div className="bg-white rounded-lg shadow p-4 border-l-4 border-orange-600">
                    <p className="text-gray-600 text-sm font-medium">Total Units</p>
                    <p className="text-3xl font-bold text-orange-600">
                      {disposalRequests.filter(r => !r.batch_id).reduce((sum, r) => sum + totalQuantity(r), 0)}
                    </p>
                  </div>
                  <div className="bg-white rounded-lg shadow p-4 border-l-4 border-purple-600">
                    <p className="text-gray-600 text-sm font-medium">Selected</p>
                    <p className="text-3xl font-bold text-purple-600">{selectedRequests.length}</p>
                  </div>
                </div>

                {/* Search and Action Bar */}
                <div className="mb-6 flex gap-3">
                  <div className="relative flex-1">
                    <input
                      type="text"
                      value={searchQuery}
                      onChange={handleSearch}
                      placeholder="Search by token, pharmacy name, or remarks..."
                      className="w-full px-10 py-3 border-2 border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 focus:outline-none transition-all"
                    />
                    <svg
                      className="w-5 h-5 absolute left-3 top-3.5 text-gray-400"
                      xmlns="http://www.w3.org/2000/svg"
                      fill="none"
                      viewBox="0 0 24 24"
                      strokeWidth="2"
                      stroke="currentColor"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M21 21l-5.197-5.197M16 10.5A5.5 5.5 0 105.5 16 5.5 5.5 0 0016 10.5z"
                      />
                    </svg>
                  </div>
                  <button
                    onClick={() => setShowMergeToBatchModal(true)}
                    disabled={selectedRequests.length === 0 || disposalBatches.filter(b => b.status === 'in_progress').length === 0}
                    className="px-6 py-3 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors font-semibold disabled:bg-gray-400 disabled:cursor-not-allowed flex items-center"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                    </svg>
                    Add to Batch ({selectedRequests.length})
                  </button>
                  <button
                    onClick={handleOptimizeRoute}
                    disabled={selectedRequests.length === 0 || isCreatingBatch}
                    className="px-6 py-3 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors font-semibold disabled:bg-gray-400 disabled:cursor-not-allowed flex items-center"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                    </svg>
                    Dispose ({selectedRequests.length})
                  </button>
                </div>

                {/* Disposal Requests Table */}
                <div className="bg-white rounded-lg shadow-md overflow-hidden">
                  <div className="px-6 py-4 bg-blue-50 border-b flex items-center justify-between">
                    <h2 className="text-lg font-semibold text-blue-800">
                      Disposal Requests Waiting for Pickup
                    </h2>
                    <input
                      type="checkbox"
                      checked={selectedRequests.length === filteredRequests.filter(r => !r.batch_id).length && filteredRequests.filter(r => !r.batch_id).length > 0}
                      onChange={() => handleSelectAll()}
                      className="w-5 h-5 cursor-pointer"
                      title="Select all requests on this page"
                    />
                  </div>

                  {filteredRequests.filter(r => !r.batch_id).length === 0 ? (
                    <div className="text-center py-12 text-gray-500">
                      {disposalRequests.filter(r => !r.batch_id).length === 0 ? (
                        <>
                          <svg className="w-16 h-16 text-gray-300 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
                          </svg>
                          <p className="text-lg font-semibold">No pending disposal requests</p>
                        </>
                      ) : (
                        <p>No results match your search</p>
                      )}
                    </div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full">
                        <thead className="bg-gray-50">
                          <tr>
                            <th className="px-6 py-3 text-left">
                              <input type="checkbox" className="w-5 h-5 cursor-pointer" onChange={() => handleSelectAll()} />
                            </th>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Token</th>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Pharmacy</th>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Items</th>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Request Date</th>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Remarks</th>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Actions</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-200">
                          {filteredRequests.filter(r => !r.batch_id).map((request, index) => (
                            <tr
                              key={request.request_id}
                              className={`cursor-pointer transition ${
                                selectedRequests.includes(request.request_id)
                                  ? 'bg-blue-100 hover:bg-blue-150'
                                  : index % 2 === 0 ? 'bg-white hover:bg-gray-50' : 'bg-gray-50 hover:bg-gray-100'
                              }`}
                              onClick={() => handleSelectRequest(request.request_id)}
                            >
                              <td className="px-6 py-4" onClick={(e) => e.stopPropagation()}>
                                <input
                                  type="checkbox"
                                  checked={selectedRequests.includes(request.request_id)}
                                  onChange={() => handleSelectRequest(request.request_id)}
                                  className="w-5 h-5 cursor-pointer"
                                />
                              </td>
                              <td className="px-6 py-4">
                                <span className="font-mono font-bold text-blue-600 bg-blue-50 px-3 py-1 rounded-full text-sm">
                                  {request.disposal_token}
                                </span>
                              </td>
                              <td className="px-6 py-4">
                                <div>
                                  <p className="font-semibold text-gray-900">{request.pharmacy_name}</p>
                                  <p className="text-xs text-gray-500">ID: {request.pharmacy_id}</p>
                                </div>
                              </td>
                              <td className="px-6 py-4">
                                <div>
                                  <p className="font-bold text-gray-900">{request.item_count} item(s)</p>
                                  <p className="text-sm text-gray-600">{totalQuantity(request)} units</p>
                                </div>
                              </td>
                              <td className="px-6 py-4 text-sm text-gray-600">
                                {formatDate(request.request_date)}
                              </td>
                              <td className="px-6 py-4">
                                <p className="text-sm text-gray-700 max-w-xs truncate">
                                  {request.remarks || "—"}
                                </p>
                              </td>
                              <td className="px-6 py-4" onClick={(e) => e.stopPropagation()}>
                                <button
                                  onClick={() => openModal(request)}
                                  className="px-3 py-1.5 bg-blue-600 text-white text-xs font-semibold rounded-lg hover:bg-blue-700 transition-colors"
                                >
                                  View Detail
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </>
            )}

            {/* DISPOSED BATCHES TAB */}
            {activeTab === 'batches' && (
              <>
                {/* Batch Summary */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
                  <div className="bg-white rounded-lg shadow p-4 border-l-4 border-orange-600">
                    <p className="text-gray-600 text-sm font-medium">In Progress Batches</p>
                    <p className="text-3xl font-bold text-orange-600">{disposalBatches.filter(b => b.status === 'in_progress').length}</p>
                  </div>
                  <div className="bg-white rounded-lg shadow p-4 border-l-4 border-green-600">
                    <p className="text-gray-600 text-sm font-medium">Completed Batches</p>
                    <p className="text-3xl font-bold text-green-600">{disposalBatches.filter(b => b.status === 'completed').length}</p>
                  </div>
                  <div className="bg-white rounded-lg shadow p-4 border-l-4 border-purple-600">
                    <p className="text-gray-600 text-sm font-medium">Total Batches</p>
                    <p className="text-3xl font-bold text-purple-600">{disposalBatches.length}</p>
                  </div>
                </div>

                {/* In Progress Batches - Disposal Section */}
                {disposalBatches.filter(b => b.status === 'in_progress').length > 0 && (
                  <div className="mb-6">
                    <h3 className="text-xl font-bold text-gray-900 mb-4">🟠 In Progress - Ready to Dispose</h3>
                    <div className="space-y-4">
                      {disposalBatches.filter(b => b.status === 'in_progress').map((batch) => (
                        <div key={batch.batch_id} className="bg-orange-50 border-2 border-orange-200 rounded-lg p-6">
                          <div className="flex items-center justify-between mb-4">
                            <div>
                              <h4 className="text-lg font-bold text-gray-900">Batch #{batch.batch_id}</h4>
                              <p className="text-sm text-gray-600">Created on {formatDate(batch.created_date)}</p>
                            </div>
                            <span className="px-4 py-2 rounded-full text-sm font-bold bg-orange-100 text-orange-800">
                              IN PROGRESS
                            </span>
                          </div>

                          {/* Simple Pharmacy List for Pickup */}
                          <div className="mb-4 p-4 bg-white rounded-lg border border-orange-200">
                            <h5 className="font-semibold text-gray-900 mb-3 flex items-center">
                              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2 text-orange-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                              </svg>
                              Collect from Pharmacies ({batch.requests.length})
                            </h5>
                            <div className="space-y-2">
                              {batch.requests.map((req) => (
                                <div key={req.request_id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg border border-gray-200">
                                  <div className="flex-1">
                                    <div className="flex items-center gap-2 mb-1">
                                      <span className="font-mono font-bold text-orange-600 bg-orange-100 px-2 py-1 rounded text-xs">{req.disposal_token}</span>
                                      <p className="font-semibold text-gray-900">{req.pharmacy_name}</p>
                                    </div>
                                    <p className="text-xs text-gray-600">{req.address}</p>
                                  </div>
                                  <div className="text-right ml-4 min-w-fit">
                                    <p className="font-bold text-orange-600">{req.item_count || 0} items</p>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>

                          {/* View Route Map and Mark Completed Buttons */}
                          <div className="mt-4 flex gap-3">
                            <button
                              onClick={() => router.push(`/optimizedDisposalRoute?batch_id=${batch.batch_id}`)}
                              className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm font-semibold flex items-center justify-center"
                            >
                              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 20l-5.447-2.724A1 1 0 003 16.382V5.618a1 1 0 011.447-.894L9 7.5m0 0l6.553-3.89A1 1 0 0117 5.618v10.764a1 1 0 01-1.447.894L9 12.5m0 0V20" />
                              </svg>
                              View Route Map
                            </button>
                            <button
                              onClick={() => handleMarkBatchCompleted(batch.batch_id)}
                              className="flex-1 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors text-sm font-semibold flex items-center justify-center"
                            >
                              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                              </svg>
                              Mark as Completed
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Completed Batches */}
                {disposalBatches.filter(b => b.status === 'completed').length > 0 && (
                  <div>
                    <h3 className="text-xl font-bold text-gray-900 mb-4">✅ Completed Batches</h3>
                    <div className="space-y-4">
                      {disposalBatches.filter(b => b.status === 'completed').map((batch) => (
                        <div key={batch.batch_id} className="bg-green-50 border-2 border-green-200 rounded-lg p-6">
                          <div className="flex items-center justify-between mb-4">
                            <div>
                              <h4 className="text-lg font-bold text-gray-900">Batch #{batch.batch_id}</h4>
                              <p className="text-sm text-gray-600">Disposed on {formatDate(batch.created_date)}</p>
                            </div>
                            <span className="px-4 py-2 rounded-full text-sm font-bold bg-green-100 text-green-800">
                              COMPLETED
                            </span>
                          </div>

                          {/* Batch Details with Item Info */}
                          <div className="p-4 bg-white rounded-lg border border-green-200">
                            <h5 className="font-semibold text-gray-900 mb-3 flex items-center">
                              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                              </svg>
                              Collected from Pharmacies ({batch.requests.length})
                            </h5>
                            <div className="space-y-2">
                              {batch.requests.map((req, idx) => (
                                <div key={idx} className="flex items-center justify-between text-sm p-3 bg-gray-50 rounded border border-gray-200">
                                  <div className="flex-1">
                                    <div className="flex items-center gap-2 mb-1">
                                      <span className="font-mono font-bold text-green-600 bg-green-100 px-2 py-1 rounded text-xs">{req.disposal_token}</span>
                                      <p className="font-semibold text-gray-900">{req.pharmacy_name}</p>
                                    </div>
                                    <p className="text-xs text-gray-600">{req.address}</p>
                                  </div>
                                  <div className="text-right min-w-fit ml-4">
                                    <p className="font-bold text-green-600">{req.item_count || 0} items</p>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>

                          {/* Route Information */}
                          <div className="mt-4">
                            <button
                              onClick={() => router.push(`/optimizedDisposalRoute?batch_id=${batch.batch_id}`)}
                              className="w-full px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm font-semibold flex items-center justify-center"
                            >
                              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 20l-5.447-2.724A1 1 0 003 16.382V5.618a1 1 0 011.447-.894L9 7.5m0 0l6.553-3.89A1 1 0 0117 5.618v10.764a1 1 0 01-1.447.894L9 12.5m0 0V20" />
                              </svg>
                              View Route Map
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* No Batches */}
                {disposalBatches.length === 0 && (
                  <div className="bg-white rounded-lg shadow text-center py-12 text-gray-500">
                    <svg className="w-16 h-16 text-gray-300 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
                    </svg>
                    <p className="text-lg font-semibold">No disposal batches yet</p>
                  </div>
                )}
              </>
            )}
          </>
        )}

        {/* Route Optimization Modal */}
        <Modal
          isOpen={isRouteModalOpen}
          onRequestClose={() => setIsRouteModalOpen(false)}
          className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 bg-white p-8 rounded-2xl shadow-2xl w-[700px] max-h-[90vh] overflow-y-auto z-50"
          overlayClassName="fixed inset-0 bg-black bg-opacity-50 z-40"
        >
          <div>
            <h2 className="text-2xl font-bold text-blue-700 mb-4">📍 Optimized Disposal Route</h2>

            {optimizedRoute && (
              <>
                {/* Route Summary */}
                <div className="mb-6 p-4 bg-blue-50 rounded-lg border-2 border-blue-200">
                  <p className="text-lg font-bold text-blue-900">
                    Total Distance: {optimizedRoute.total_distance} km
                  </p>
                  <p className="text-sm text-gray-600 mt-1">Duration: {optimizedRoute.duration_minutes} minutes</p>
                  <p className="text-sm text-gray-600">Requests: {optimizedRoute.route?.length || 0}</p>
                </div>

                {/* Route Stops */}
                <div className="mb-6">
                  <h3 className="font-semibold text-gray-900 mb-3">Pickup Route:</h3>
                  <div className="space-y-2 max-h-96 overflow-y-auto">
                    {optimizedRoute.route?.map((stop, idx) => (
                      <div key={idx} className="p-3 bg-gray-50 rounded-lg border border-gray-200 flex items-start">
                        <div className="min-w-fit mr-3 mt-1">
                          <div className="w-8 h-8 rounded-full bg-blue-600 text-white flex items-center justify-center text-sm font-bold">
                            {idx + 1}
                          </div>
                        </div>
                        <div className="flex-1">
                          <p className="font-semibold text-gray-900">{stop.pharmacy_name}</p>
                          <p className="text-xs text-gray-600">{stop.address}</p>
                          <p className="text-xs text-gray-500 mt-1">{stop.district || 'N/A'}</p>
                          <p className="text-sm text-blue-600 mt-1 font-semibold">
                            Token: {stop.disposal_token}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Action Buttons */}
                <div className="flex justify-end space-x-3 pt-4 border-t">
                  <button
                    onClick={() => setIsRouteModalOpen(false)}
                    className="px-6 py-2.5 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition-colors font-semibold"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleCreateBatch}
                    disabled={isCreatingBatch}
                    className="px-6 py-2.5 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors font-semibold disabled:bg-gray-400 disabled:cursor-not-allowed flex items-center"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                    </svg>
                    {isCreatingBatch ? "Creating..." : "Create Batch"}
                  </button>
                </div>
              </>
            )}
          </div>
        </Modal>

        {/* Request Details Modal */}
        <Modal
          isOpen={isModalOpen}
          onRequestClose={closeModal}
          className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 bg-white p-6 rounded-2xl shadow-2xl w-[800px] max-h-[90vh] overflow-y-auto z-50"
          overlayClassName="fixed inset-0 bg-black bg-opacity-50 z-40"
        >
          {selectedRequest && (
            <div>
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-2xl font-bold text-blue-700">
                  Disposal Request Details
                </h2>
                <span className="px-4 py-2 rounded-full text-sm font-bold bg-blue-100 text-blue-800">
                  {selectedRequest.disposal_token}
                </span>
              </div>

              {/* Request Info */}
              <div className="grid grid-cols-2 gap-4 mb-6 bg-gray-50 p-4 rounded-lg">
                <div>
                  <p className="text-sm font-medium text-gray-600">Pharmacy</p>
                  <p className="text-lg font-semibold text-gray-900">{selectedRequest.pharmacy_name}</p>
                </div>
                <div>
                  <p className="text-sm font-medium text-gray-600">Request Date</p>
                  <p className="text-lg font-semibold text-gray-900">
                    {formatDate(selectedRequest.request_date)}
                  </p>
                </div>
                <div className="col-span-2">
                  <p className="text-sm font-medium text-gray-600">Remarks</p>
                  <p className="text-gray-900">{selectedRequest.remarks || "No remarks provided"}</p>
                </div>
              </div>

              {/* Summary */}
              <div className="grid grid-cols-2 gap-4 mb-6">
                <div className="bg-green-50 p-4 rounded-lg border border-green-200">
                  <p className="text-sm text-gray-600">Total Items</p>
                  <p className="text-2xl font-bold text-green-700">{selectedRequest.item_count}</p>
                </div>
                <div className="bg-orange-50 p-4 rounded-lg border border-orange-200">
                  <p className="text-sm text-gray-600">Total Units</p>
                  <p className="text-2xl font-bold text-orange-700">{totalQuantity(selectedRequest)}</p>
                </div>
              </div>

              {/* Items Table */}
              <h3 className="text-lg font-semibold text-gray-900 mb-4">Medicines to Dispose</h3>
              <div className="border rounded-lg overflow-hidden mb-6">
                <table className="w-full text-sm">
                  <thead className="bg-gray-100">
                    <tr>
                      <th className="px-4 py-3 text-left font-semibold text-gray-700">Medicine</th>
                      <th className="px-4 py-3 text-left font-semibold text-gray-700">Batch</th>
                      <th className="px-4 py-3 text-left font-semibold text-gray-700">Qty</th>
                      <th className="px-4 py-3 text-left font-semibold text-gray-700">Expiry</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200">
                    {selectedRequest.items.map((item, i) => (
                      <tr key={i} className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                        <td className="px-4 py-3">
                          <div>
                            <p className="font-semibold text-gray-900">{item.medicine_name}</p>
                            <p className="text-xs text-gray-500">{item.dosage}</p>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-gray-700 font-mono text-xs">{item.batch_number}</td>
                        <td className="px-4 py-3 font-semibold text-gray-900">
                          {item.quantity} {item.unit_type}
                        </td>
                        <td className="px-4 py-3 text-red-600 font-semibold">
                          {new Date(item.expiry_date).toLocaleDateString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Action Buttons */}
              <div className="flex justify-end space-x-3">
                <button
                  onClick={closeModal}
                  className="px-4 py-2.5 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition-colors font-semibold"
                >
                  Close
                </button>
                <button
                  onClick={() => handleConfirmPickup(selectedRequest)}
                  className="px-4 py-2.5 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors font-semibold flex items-center"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m7 0a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  Confirm Pickup
                </button>
              </div>
            </div>
          )}
        </Modal>

        {/* Merge to Batch Modal */}
        <Modal
          isOpen={showMergeToBatchModal}
          onRequestClose={() => setShowMergeToBatchModal(false)}
          className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 bg-white p-8 rounded-2xl shadow-2xl w-[600px] z-50"
          overlayClassName="fixed inset-0 bg-black bg-opacity-50 z-40"
        >
          <div>
            <h2 className="text-2xl font-bold text-purple-700 mb-4">📦 Add to Existing Batch</h2>
            <p className="text-gray-600 mb-6">Select which in-progress batch to add {selectedRequests.length} request(s) to:</p>

            <div className="space-y-3 mb-6 max-h-96 overflow-y-auto">
              {disposalBatches.filter(b => b.status === 'in_progress').length === 0 ? (
                <div className="text-center py-8 text-gray-500">
                  <p>No in-progress batches available</p>
                  <p className="text-sm">Create a batch first before adding requests</p>
                </div>
              ) : (
                disposalBatches.filter(b => b.status === 'in_progress').map((batch) => (
                  <button
                    key={batch.batch_id}
                    onClick={() => handleMergeRequestsToBatch(batch.batch_id)}
                    disabled={isMergingToBatch}
                    className="w-full p-4 border-2 border-purple-200 rounded-lg hover:bg-purple-50 transition-colors text-left disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex-1">
                        <h4 className="font-bold text-gray-900">Batch #{batch.batch_id}</h4>
                        <p className="text-sm text-gray-600">
                          {batch.requests.length} request(s) • Created {formatDate(batch.created_date)}
                        </p>
                        <p className="text-xs text-gray-500 mt-1">
                          Pharmacies: {batch.requests.map(r => r.pharmacy_name).join(", ")}
                        </p>
                      </div>
                      <div className="ml-4">
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-purple-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                        </svg>
                      </div>
                    </div>
                  </button>
                ))
              )}
            </div>

            {/* Action Buttons */}
            <div className="flex justify-end gap-3 pt-4 border-t">
              <button
                onClick={() => setShowMergeToBatchModal(false)}
                disabled={isMergingToBatch}
                className="px-6 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition-colors font-semibold disabled:opacity-50"
              >
                Cancel
              </button>
            </div>
          </div>
        </Modal>
      </div>
    </>
  );
};

export default WarehouseDisposalRequests;
