import { useRouter } from "next/router";
import { useEffect, useState } from "react";
import { ToastContainer, toast } from "react-toastify";
import "react-toastify/dist/ReactToastify.css";
import useSSE from '../hooks/useSSE';

const IncomingEmergencyRequests = () => {
  const router = useRouter();
  const [incomingRequests, setIncomingRequests] = useState([]);
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const [selectedRequest, setSelectedRequest] = useState(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [confirmingReceipt, setConfirmingReceipt] = useState(null);
  const [stockDetails, setStockDetails] = useState(null);
  const [isStockModalOpen, setIsStockModalOpen] = useState(false);
  const [allocationResult, setAllocationResult] = useState(null);
  const [processingAllocation, setProcessingAllocation] = useState(false);
  const [activeTab, setActiveTab] = useState('incoming'); // 'incoming' or 'completed'
  
  // New states for medicine selection
  const [medicineSelections, setMedicineSelections] = useState({}); // { requestItemIndex: { medicine_id: quantity } }

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

  // Fetch incoming emergency requests
  useEffect(() => {
    const fetchIncomingRequests = async () => {
      try {
        const { pharmacy_id } = router.query;
        if (!pharmacy_id) return;

        const response = await fetch(`/api/fetchIncomingEmergencyRequests?pharmacy_id=${pharmacy_id}`);
        const data = await response.json();

        if (data.success) {
          setIncomingRequests(data.requests);
        } else {
          toast.error("Failed to fetch incoming emergency requests");
        }
      } catch (error) {
        console.error("Error fetching incoming requests:", error);
        toast.error("Error fetching incoming requests");
      }
    };

    if (router.query.pharmacy_id) {
      fetchIncomingRequests();
    }
  }, [router.query, refreshTrigger]);

  // Real-time updates — refresh when this pharmacy is assigned a new emergency request
  // to fulfill (emergency:allocated) or when a requesting pharmacy confirms receipt (emergency:received).
  const handleSSEEvent = (event) => {
    const t = event.type;
    if (t === 'emergency:allocated' || t === 'emergency:received') {
      setRefreshTrigger(prev => prev + 1);
      toast.info('Incoming requests updated', { autoClose: 2000 });
    }
  };
  useSSE({ role: 'pharmacy', id: router.query.pharmacy_id, onEvent: handleSSEEvent });

  const handleViewRequest = (request) => {
    setSelectedRequest(request);
    setIsModalOpen(true);
  };

  const handleConfirmReceipt = async (requestId) => {
    try {
      setConfirmingReceipt(requestId);

      // First fetch stock details to show allocation modal
      const stockResponse = await fetch(`/api/fetchEmergencyOrderStocks?pharmacy_id=${router.query.pharmacy_id}&request_id=${requestId}`);
      const stockData = await stockResponse.json();

      if (stockData.success) {
        setStockDetails(stockData.data);
        setIsStockModalOpen(true);
        setSelectedRequest(incomingRequests.find(req => req.request_id === requestId));
        
        // Initialize medicine selections with exact medicines for branded requests
        const initialSelections = {};
        stockData.data.medicines.forEach((medicine, index) => {
          if (medicine.request_item_type === 'branded' && medicine.exact_medicine.has_sufficient) {
            // Auto-select exact medicine if it has sufficient stock
            initialSelections[index] = {
              [medicine.requested_medicine_id]: medicine.quantity_requested
            };
          } else {
            initialSelections[index] = {};
          }
        });
        setMedicineSelections(initialSelections);
      } else {
        toast.error(stockData.message || "Failed to fetch stock details");
      }
    } catch (error) {
      console.error("Error fetching stock details:", error);
      toast.error("Error fetching stock details");
    } finally {
      setConfirmingReceipt(null);
    }
  };

  // Helper function to update medicine selection
  const updateMedicineSelection = (requestItemIndex, medicineId, quantity) => {
    setMedicineSelections(prev => ({
      ...prev,
      [requestItemIndex]: {
        ...prev[requestItemIndex],
        [medicineId]: Number(quantity) || 0
      }
    }));
  };

  // Helper function to calculate total selected for a request item
  const getTotalSelected = (requestItemIndex) => {
    const selections = medicineSelections[requestItemIndex] || {};
    return Object.values(selections).reduce((sum, qty) => sum + Number(qty || 0), 0);
  };

  // Validate all selections before allocation
  const validateSelections = () => {
    if (!stockDetails) return { valid: false, errors: ['No stock details'] };
    
    const errors = [];
    
    stockDetails.medicines.forEach((medicine, index) => {
      const totalSelected = getTotalSelected(index);
      const requested = Number(medicine.quantity_requested);
      
      if (totalSelected === 0) {
        errors.push(`${medicine.generic_name || medicine.requested_medicine_name}: No medicines selected`);
      } else if (totalSelected < requested) {
        errors.push(`${medicine.generic_name || medicine.requested_medicine_name}: Selected ${totalSelected}, need ${requested}`);
      } else if (totalSelected > requested) {
        errors.push(`${medicine.generic_name || medicine.requested_medicine_name}: Selected ${totalSelected}, only need ${requested}`);
      }

      // Check if selected medicines have sufficient stock
      const selections = medicineSelections[index] || {};
      Object.entries(selections).forEach(([medId, qty]) => {
        if (qty > 0) {
          let availableStock = 0;
          
          if (medicine.request_item_type === 'branded') {
            if (Number(medId) === medicine.requested_medicine_id) {
              availableStock = medicine.exact_medicine.total_available;
            } else {
              const alt = medicine.alternatives.find(a => a.medicine_id === Number(medId));
              availableStock = alt ? alt.total_available : 0;
            }
          } else if (medicine.request_item_type === 'generic') {
            const option = medicine.available_options.find(o => o.medicine_id === Number(medId));
            availableStock = option ? option.total_available : 0;
          }

          if (qty > availableStock) {
            errors.push(`Medicine ID ${medId}: Selected ${qty}, only ${availableStock} available`);
          }
        }
      });
    });

    return { valid: errors.length === 0, errors };
  };

  const handleAllocateStocks = async () => {
    try {
      if (!stockDetails) {
        toast.error("No stock details loaded");
        return;
      }

      // Validate selections
      const validation = validateSelections();
      if (!validation.valid) {
        toast.error(validation.errors.join('\n'), {
          autoClose: 5000,
          style: { whiteSpace: 'pre-line' }
        });
        return;
      }

      setProcessingAllocation(true);

      // Build allocations payload
      const allocations = stockDetails.medicines.map((medicine, index) => ({
        request_item_index: index,
        medicine_allocations: Object.entries(medicineSelections[index] || {})
          .filter(([medId, qty]) => Number(qty) > 0)
          .map(([medId, qty]) => ({
            medicine_id: Number(medId),
            quantity: Number(qty)
          }))
      }));

      const response = await fetch('/api/allocateEmergencyOrderStocks', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          pharmacy_id: router.query.pharmacy_id,
          request_id: stockDetails.request_id,
          allocations: allocations,
        }),
      });

      const data = await response.json();
      setProcessingAllocation(false);

      if (data.success) {
        setAllocationResult(data.allocations || {});
        toast.success('Emergency order processed and stocks allocated successfully!');

        // Refresh the requests after successful allocation
        const refreshResponse = await fetch(`/api/fetchIncomingEmergencyRequests?pharmacy_id=${router.query.pharmacy_id}`);
        const refreshData = await refreshResponse.json();
        if (refreshData.success) {
          setIncomingRequests(refreshData.requests);
        }

        // Close stock modal after short delay
        setTimeout(() => {
          setIsStockModalOpen(false);
          setStockDetails(null);
          setAllocationResult(null);
          setMedicineSelections({});
        }, 3000);
      } else {
        toast.error(data.message || 'Failed to allocate stocks');
      }
    } catch (error) {
      console.error('Error processing allocation:', error);
      setProcessingAllocation(false); 
      toast.error('Error processing allocation');
    }
  };

  // Format date as DD/MM/YYYY to show day first (e.g. 29/10/2025)
  const formatDateDMY = (dateStr) => {
    try {
      const d = new Date(dateStr);
      if (isNaN(d)) return "";
      const day = String(d.getDate()).padStart(2, "0");
      const month = String(d.getMonth() + 1).padStart(2, "0");
      const year = d.getFullYear();
      return `${day}/${month}/${year}`;
    } catch (e) {
      return "";
    }
  };

  const getStatusColor = (status) => {
    switch (status) {
      case 'order_sent':
        return 'text-blue-600 bg-blue-100';
      case 'order_successful':
        return 'text-green-600 bg-green-100';
      case 'rejected':
        return 'text-red-600 bg-red-100';
      default:
        return 'text-yellow-600 bg-yellow-100';
    }
  };

  return (
    <>
      <ToastContainer position="top-center" autoClose={1500} hideProgressBar />
      <div className="min-h-screen bg-gray-100 py-6 px-4">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Emergency Orders</h1>
            <p className="text-gray-600 mt-1">Manage incoming emergency medicine requests and completed orders</p>
          </div>
          <button
            onClick={() => router.push(`/user?pharmacy_id=${router.query.pharmacy_id}`)}
            className="px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 transition-colors duration-200 flex items-center"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            Back to Dashboard
          </button>
        </div>

        {/* Tab Navigation */}
        <div className="mb-6">
          <div className="border-b border-gray-200">
            <nav className="-mb-px flex space-x-8" aria-label="Tabs">
              <button
                onClick={() => setActiveTab('incoming')}
                className={`whitespace-nowrap py-2 px-1 border-b-2 font-medium text-sm ${
                  activeTab === 'incoming'
                    ? 'border-orange-500 text-orange-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
              >
                <div className="flex items-center">
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                  </svg>
                  Incoming Requests
                  {incomingRequests.filter(req => req.status === 'order_sent').length > 0 && (
                    <span className="ml-2 inline-flex items-center justify-center px-2 py-1 text-xs font-bold leading-none text-white bg-orange-500 rounded-full">
                      {incomingRequests.filter(req => req.status === 'order_sent').length}
                    </span>
                  )}
                </div>
              </button>
              <button
                onClick={() => setActiveTab('completed')}
                className={`whitespace-nowrap py-2 px-1 border-b-2 font-medium text-sm ${
                  activeTab === 'completed'
                    ? 'border-green-500 text-green-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
              >
                <div className="flex items-center">
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                  </svg>
                  Completed Orders
                  {incomingRequests.filter(req => req.status === 'order_successful').length > 0 && (
                    <span className="ml-2 inline-flex items-center justify-center px-2 py-1 text-xs font-bold leading-none text-white bg-green-500 rounded-full">
                      {incomingRequests.filter(req => req.status === 'order_successful').length}
                    </span>
                  )}
                </div>
              </button>
            </nav>
          </div>
        </div>

        {/* Tab Content */}
        {activeTab === 'incoming' && (
          <>
            {incomingRequests.filter(req => req.status === 'order_sent').length === 0 ? (
              <div className="text-center py-12">
                <svg className="mx-auto h-12 w-12 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2M4 13h2m-2 0V9a2 2 0 012-2h2m0 0V6a1 1 0 011-1h6a1 1 0 011 1v1m0 0v1a2 2 0 01-2 2H9a2 2 0 01-2-2V8m0 0V7a1 1 0 011-1h2a1 1 0 011 1v1" />
                </svg>
                <h3 className="mt-2 text-sm font-medium text-gray-900">No Incoming Requests</h3>
                <p className="mt-1 text-sm text-gray-500">No emergency medicine orders are pending confirmation.</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {incomingRequests.filter(req => req.status === 'order_sent').map((request) => (
                  <div
                    key={request.request_id}
                    className="bg-white rounded-lg shadow-md p-6 border-l-4 border-orange-500"
                  >
                    <div className="flex justify-between items-start mb-4">
                      <div>
                        <h3 className="text-lg font-semibold text-gray-900">
                          From: {request.requesting_pharmacy_name}
                        </h3>
                        <p className="text-sm text-gray-600">
                          Order ID: #{request.request_id}
                        </p>
                      </div>
                      <div className="text-right">
                        <span className={`px-3 py-1 rounded-full text-sm font-medium ${getStatusColor(request.status)}`}>
                          Order Sent - Confirm Receipt
                        </span>
                      </div>
                    </div>

                    <div className="space-y-3">
                      <div>
                        <p className="text-sm text-gray-600">
                          <span className="font-medium">Contact:</span> {request.requesting_pharmacy_contact}
                        </p>
                        <p className="text-sm text-gray-600">
                          <span className="font-medium">Address:</span> {request.requesting_pharmacy_address}
                        </p>
                      </div>

                      <div>
                        <p className="text-sm text-gray-600">
                          Ordered on: {new Date(request.request_date).toLocaleDateString('en-US', { 
                            year: 'numeric',
                            month: 'short',
                            day: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit'
                          })}
                        </p>
                      </div>

                      <div>
                        <h4 className="text-sm font-medium text-gray-700">Requested Medicines</h4>
                        <ul className="mt-1 space-y-1">
                          {request.medicines.slice(0, 2).map((medicine, index) => {
                            const genericName = medicine.generic_name || null;
                            const displayName = medicine.name || genericName || 'Unknown';
                            const label = medicine.generic_id && !medicine.name ? `${displayName} (Generic)` : displayName;
                            const dosagePart = medicine.dosage ? ` (${medicine.dosage} ${medicine.unit || ''})` : '';
                            return (
                              <li key={index} className="text-sm text-gray-600">
                                {label}{dosagePart} - {medicine.quantity_requested} units
                              </li>
                            );
                          })}
                          {request.medicines.length > 2 && (
                            <li className="text-sm text-blue-600">
                              +{request.medicines.length - 2} more medicines
                            </li>
                          )}
                        </ul>
                      </div>

                      {request.remarks && (
                        <div>
                          <h4 className="text-sm font-medium text-gray-700">Remarks</h4>
                          <p className="text-sm text-gray-600 truncate">{request.remarks}</p>
                        </div>
                      )}

                      <div className="flex justify-end space-x-2 mt-4">
                        <button
                          onClick={() => handleViewRequest(request)}
                          className="px-3 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 transition-colors"
                        >
                          View Details
                        </button>
                        <button
                          onClick={() => handleConfirmReceipt(request.request_id)}
                          disabled={confirmingReceipt === request.request_id}
                          className={`px-3 py-2 text-sm font-medium text-white rounded-md transition-colors ${
                            confirmingReceipt === request.request_id
                              ? 'bg-gray-400 cursor-not-allowed'
                              : 'bg-green-600 hover:bg-green-700'
                          }`}
                        >
                          {confirmingReceipt === request.request_id ? 'Confirming...' : 'Confirm Receipt'}
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        {activeTab === 'completed' && (
          <>
            {incomingRequests.filter(req => req.status === 'order_successful').length === 0 ? (
              <div className="text-center py-12">
                <svg className="mx-auto h-12 w-12 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                </svg>
                <h3 className="mt-2 text-sm font-medium text-gray-900">No Completed Orders</h3>
                <p className="mt-1 text-sm text-gray-500">No emergency medicine orders have been completed yet.</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {incomingRequests.filter(req => req.status === 'order_successful').map((request) => (
                  <div
                    key={request.request_id}
                    className="bg-white rounded-lg shadow-md p-6 border-l-4 border-green-500"
                  >
                    <div className="flex justify-between items-start mb-4">
                      <div>
                        <h3 className="text-lg font-semibold text-gray-900">
                          From: {request.requesting_pharmacy_name}
                        </h3>
                        <p className="text-sm text-gray-600">
                          Order ID: #{request.request_id}
                        </p>
                      </div>
                      <div className="text-right">
                        <span className={`px-3 py-1 rounded-full text-sm font-medium ${getStatusColor(request.status)}`}>
                          ✓ Completed
                        </span>
                      </div>
                    </div>

                    <div className="space-y-3">
                      <div>
                        <p className="text-sm text-gray-600">
                          <span className="font-medium">Contact:</span> {request.requesting_pharmacy_contact}
                        </p>
                        <p className="text-sm text-gray-600">
                          <span className="font-medium">Address:</span> {request.requesting_pharmacy_address}
                        </p>
                      </div>

                      <div>
                        <p className="text-sm text-gray-600">
                          Completed on: {new Date(request.request_date).toLocaleDateString('en-US', { 
                            year: 'numeric',
                            month: 'short',
                            day: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit'
                          })}
                        </p>
                      </div>

                      <div>
                        <h4 className="text-sm font-medium text-gray-700">Medicines Sent</h4>
                        <ul className="mt-1 space-y-1">
                          {request.medicines.slice(0, 2).map((medicine, index) => {
                            const genericName = medicine.generic_name || null;
                            const displayName = medicine.name || genericName || 'Unknown';
                            const label = medicine.generic_id && !medicine.name ? `${displayName} (Generic)` : displayName;
                            const dosagePart = medicine.dosage ? ` (${medicine.dosage} ${medicine.unit || ''})` : '';
                            return (
                              <li key={index} className="text-sm text-gray-600">
                                ✓ {label}{dosagePart} - {medicine.quantity_requested} units
                              </li>
                            );
                          })}
                          {request.medicines.length > 2 && (
                            <li className="text-sm text-green-600">
                              +{request.medicines.length - 2} more medicines
                            </li>
                          )}
                        </ul>
                      </div>

                      {request.remarks && (
                        <div>
                          <h4 className="text-sm font-medium text-gray-700">Remarks</h4>
                          <p className="text-sm text-gray-600 truncate">{request.remarks}</p>
                        </div>
                      )}

                      <div className="flex justify-end space-x-2 mt-4">
                        <button
                          onClick={() => handleViewRequest(request)}
                          className="px-3 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 transition-colors"
                        >
                          View Details
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        {/* Request Details Modal */}
        {isModalOpen && selectedRequest && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-lg shadow-xl p-6 w-full max-w-2xl max-h-screen overflow-y-auto">
              <div className="flex justify-between items-center mb-4">
                <h3 className="text-xl font-semibold text-gray-900">
                  Emergency Order Details
                </h3>
                <button
                  onClick={() => setIsModalOpen(false)}
                  className="text-gray-500 hover:text-gray-700"
                >
                  <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              <div className="space-y-6">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <h4 className="text-sm font-medium text-gray-700">Requesting Pharmacy</h4>
                    <p className="text-gray-900">{selectedRequest.requesting_pharmacy_name}</p>
                    <p className="text-sm text-gray-600">{selectedRequest.requesting_pharmacy_address}</p>
                    <p className="text-sm text-gray-600">Contact: <span className="font-bold">{selectedRequest.requesting_pharmacy_contact}</span></p>
                  </div>
                  <div>
                    <h4 className="text-sm font-medium text-gray-700">Order Date</h4>
                    <p className="text-gray-900">
                      {new Date(selectedRequest.request_date).toLocaleDateString('en-US', { 
                        year: 'numeric',
                        month: 'long',
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit'
                      })}
                    </p>
                  </div>
                </div>

                <div>
                  <h4 className="text-sm font-medium text-gray-700 mb-2">Status</h4>
                  <span className={`px-3 py-1 rounded-full text-sm font-medium ${getStatusColor(selectedRequest.status)}`}>
                    {selectedRequest.status === 'order_sent' ? 'Order Sent - Awaiting Confirmation' : 
                     selectedRequest.status === 'order_successful' ? 'Order Received & Confirmed' : 
                     selectedRequest.status.charAt(0).toUpperCase() + selectedRequest.status.slice(1)}
                  </span>
                </div>

                <div>
                  <h4 className="text-sm font-medium text-gray-700 mb-2">Requested Medicines</h4>
                  <div className="border rounded-lg overflow-hidden">
                    <table className="min-w-full divide-y divide-gray-200">
                      <thead className="bg-gray-50">
                        <tr>
                          <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Medicine</th>
                          <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Dosage</th>
                          <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Quantity</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-200">
                        {selectedRequest.medicines.map((medicine, index) => {
                          const genericName = medicine.generic_name || null;
                          const displayName = medicine.name || genericName || 'Unknown';
                          const label = medicine.generic_id && !medicine.name ? `${displayName} (Generic)` : displayName;
                          const dosageText = medicine.dosage ? `${medicine.dosage} ${medicine.unit || ''}` : '-';
                          return (
                            <tr key={index}>
                              <td className="px-4 py-2 text-sm text-gray-900">{label}</td>
                              <td className="px-4 py-2 text-sm text-gray-900">{dosageText}</td>
                              <td className="px-4 py-2 text-sm text-gray-900">{medicine.quantity_requested} units</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>

                {selectedRequest.remarks && (
                  <div>
                    <h4 className="text-sm font-medium text-gray-700 mb-2">Remarks</h4>
                    <p className="text-gray-900 bg-gray-50 p-3 rounded-md">{selectedRequest.remarks}</p>
                  </div>
                )}

                {/* Action Section */}
                {selectedRequest.status === 'order_sent' && (
                  <div className="border-t pt-6">
                    <div className="bg-blue-50 p-4 rounded-lg">
                      <h4 className="text-sm font-medium text-blue-800 mb-2">Order Action Required</h4>
                      <p className="text-sm text-blue-700 mb-3">
                        Please confirm receipt of this emergency medicine order once you have received the medicines.
                      </p>
                      <button
                        onClick={() => {
                          handleConfirmReceipt(selectedRequest.request_id);
                          setIsModalOpen(false);
                        }}
                        disabled={confirmingReceipt === selectedRequest.request_id}
                        className={`px-4 py-2 text-sm font-medium text-white rounded-md transition-colors ${
                          confirmingReceipt === selectedRequest.request_id
                            ? 'bg-gray-400 cursor-not-allowed'
                            : 'bg-green-600 hover:bg-green-700'
                        }`}
                      >
                        {confirmingReceipt === selectedRequest.request_id ? 'Confirming...' : 'Confirm Receipt'}
                      </button>
                    </div>
                  </div>
                )}

                {selectedRequest.status === 'order_successful' && (
                  <div className="border-t pt-6">
                    <div className="bg-green-50 p-4 rounded-lg">
                      <h4 className="text-sm font-medium text-green-800 mb-2">Order Completed</h4>
                      <p className="text-sm text-green-700">
                        This order has been confirmed as received. Thank you for your cooperation in this emergency medicine transfer.
                      </p>
                    </div>
                  </div>
                )}
              </div>

              <div className="flex justify-end mt-6">
                <button
                  onClick={() => setIsModalOpen(false)}
                  className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-md hover:bg-gray-200"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Enhanced Stock Allocation Modal with Generic Medicine Support */}
        {isStockModalOpen && stockDetails && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
            <div className="bg-white rounded-lg shadow-xl p-6 w-full max-w-6xl max-h-[90vh] overflow-y-auto">
              <div className="flex justify-between items-center mb-6 sticky top-0 bg-white z-10 pb-4 border-b">
                <div>
                  <h3 className="text-2xl font-bold text-gray-900">
                    Emergency Order Stock Allocation
                  </h3>
                  <p className="text-sm text-gray-600 mt-1">Request ID: #{stockDetails.request_id}</p>
                </div>
                <button
                  onClick={() => {
                    setIsStockModalOpen(false);
                    setStockDetails(null);
                    setAllocationResult(null);
                    setMedicineSelections({});
                  }}
                  className="text-gray-500 hover:text-gray-700"
                >
                  <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              <div className="space-y-8">
                {stockDetails.medicines.map((medicine, requestItemIndex) => {
                  const totalSelected = getTotalSelected(requestItemIndex);
                  const requested = Number(medicine.quantity_requested);
                  const isComplete = totalSelected === requested;
                  const isOverAllocated = totalSelected > requested;
                  const isUnderAllocated = totalSelected < requested && totalSelected > 0;

                  return (
                    <div key={requestItemIndex} className="bg-gradient-to-br from-white to-gray-50 rounded-xl border-2 border-gray-200 p-6 shadow-md">
                      {/* Request Item Header */}
                      <div className="border-b-2 border-gray-300 pb-4 mb-6">
                        <div className="flex justify-between items-start">
                          <div className="flex-1">
                            {medicine.request_item_type === 'branded' ? (
                              <>
                                <h3 className="text-xl font-bold text-gray-900 flex items-center gap-2">
                                  <span className="px-2 py-1 bg-purple-100 text-purple-800 text-xs rounded">BRANDED</span>
                                  {medicine.requested_medicine_name}
                                </h3>
                                <div className="text-gray-600 mt-2 space-y-1">
                                  <p className="text-sm">Dosage: <span className="font-medium">{medicine.dosage}</span></p>
                                  <p className="text-sm">Manufacturer: <span className="font-medium">{medicine.manufacturer}</span></p>
                                  {medicine.generic_name && (
                                    <p className="text-sm">Generic Category: <span className="font-medium text-blue-600">{medicine.generic_name}</span></p>
                                  )}
                                </div>
                              </>
                            ) : (
                              <>
                                <h3 className="text-xl font-bold text-blue-900 flex items-center gap-2">
                                  <span className="px-2 py-1 bg-blue-100 text-blue-800 text-xs rounded">GENERIC REQUEST</span>
                                  {medicine.generic_name}
                                </h3>
                                <div className="text-gray-600 mt-2">
                                  <p className="text-sm">Category: <span className="font-medium">{medicine.generic_category}</span></p>
                                  <p className="text-sm text-blue-700 italic">Any medicine from this category is acceptable</p>
                                </div>
                              </>
                            )}
                          </div>
                          
                          <div className="text-right space-y-2">
                            <div className="bg-indigo-50 rounded-lg p-3 border border-indigo-200">
                              <p className="text-xs text-indigo-600 font-medium">REQUESTED</p>
                              <p className="text-2xl font-bold text-indigo-900">{requested}</p>
                            </div>
                            <div className={`rounded-lg p-3 border ${
                              isComplete ? 'bg-green-50 border-green-200' : 
                              isOverAllocated ? 'bg-red-50 border-red-200' :
                              isUnderAllocated ? 'bg-yellow-50 border-yellow-200' :
                              'bg-gray-50 border-gray-200'
                            }`}>
                              <p className={`text-xs font-medium ${
                                isComplete ? 'text-green-600' : 
                                isOverAllocated ? 'text-red-600' :
                                isUnderAllocated ? 'text-yellow-600' :
                                'text-gray-600'
                              }`}>SELECTED</p>
                              <p className={`text-2xl font-bold ${
                                isComplete ? 'text-green-900' : 
                                isOverAllocated ? 'text-red-900' :
                                isUnderAllocated ? 'text-yellow-900' :
                                'text-gray-900'
                              }`}>
                                {totalSelected}
                                {isComplete && <span className="text-green-600 ml-2">✓</span>}
                                {isOverAllocated && <span className="text-red-600 ml-2">!</span>}
                              </p>
                            </div>
                          </div>
                        </div>

                        {/* Status Message */}
                        {totalSelected > 0 && (
                          <div className={`mt-4 p-3 rounded-lg ${
                            isComplete ? 'bg-green-100 border border-green-300' :
                            isOverAllocated ? 'bg-red-100 border border-red-300' :
                            'bg-yellow-100 border border-yellow-300'
                          }`}>
                            <p className={`text-sm font-medium ${
                              isComplete ? 'text-green-800' :
                              isOverAllocated ? 'text-red-800' :
                              'text-yellow-800'
                            }`}>
                              {isComplete ? '✓ Perfect! Allocation matches requirement' :
                               isOverAllocated ? `⚠️ Over-allocated by ${totalSelected - requested}` :
                               `⚠️ Still need ${requested - totalSelected} more`}
                            </p>
                          </div>
                        )}
                      </div>

                      {/* Medicine Selection Section */}
                      <div className="space-y-4">
                        {/* BRANDED REQUEST - Show exact medicine first */}
                        {medicine.request_item_type === 'branded' && (
                          <>
                            {/* Exact Medicine */}
                            {medicine.exact_medicine.total_available > 0 && (
                              <div className="bg-white rounded-lg border-2 border-green-300 p-5">
                                <div className="flex items-center justify-between mb-3">
                                  <div className="flex items-center gap-2">
                                    <span className="px-3 py-1 bg-green-600 text-white text-xs font-bold rounded-full">EXACT MATCH</span>
                                    <h4 className="text-lg font-bold text-gray-900">{medicine.exact_medicine.medicine_name}</h4>
                                  </div>
                                  <div className={`px-3 py-1 rounded text-sm font-semibold ${
                                    medicine.exact_medicine.has_sufficient 
                                      ? 'bg-green-100 text-green-800' 
                                      : 'bg-orange-100 text-orange-800'
                                  }`}>
                                    Available: {medicine.exact_medicine.total_available}
                                  </div>
                                </div>

                                <div className="flex items-center gap-4">
                                  <label className="text-sm font-medium text-gray-700">Quantity to use:</label>
                                  <input
                                    type="number"
                                    min="0"
                                    max={medicine.exact_medicine.total_available}
                                    value={medicineSelections[requestItemIndex]?.[medicine.exact_medicine.medicine_id] || 0}
                                    onChange={(e) => updateMedicineSelection(requestItemIndex, medicine.exact_medicine.medicine_id, e.target.value)}
                                    className="w-32 px-3 py-2 border-2 border-gray-300 rounded-lg focus:border-green-500 focus:ring-2 focus:ring-green-200 text-lg font-semibold"
                                  />
                                  <span className="text-gray-600">/ {medicine.exact_medicine.total_available}</span>
                                </div>

                                {/* Stock Batches */}
                                {medicine.exact_medicine.stocks.length > 0 && (
                                  <div className="mt-4 space-y-2">
                                    <p className="text-xs font-semibold text-gray-600 uppercase">Available Batches (FEFO Order):</p>
                                    {medicine.exact_medicine.stocks.map((stock, idx) => (
                                      <div key={stock.stock_id} className="flex justify-between items-center text-sm bg-gray-50 p-2 rounded">
                                        <span className="font-medium">Batch: {stock.batch_number}</span>
                                        <span>Qty: <strong>{stock.quantity}</strong></span>
                                        <span className="text-xs text-gray-600">Exp: {formatDateDMY(stock.expiry_date)}</span>
                                        <span className="text-xs">₹{stock.price_per_unit}</span>
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </div>
                            )}

                            {/* Alternatives */}
                            {medicine.needs_alternatives && medicine.alternatives.length > 0 && (
                              <div className="mt-4">
                                <div className="flex items-center gap-2 mb-3">
                                  <svg className="w-5 h-5 text-yellow-600" fill="currentColor" viewBox="0 0 20 20">
                                    <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                                  </svg>
                                  <h5 className="text-md font-bold text-yellow-800">Alternative Medicines (Same Generic Category)</h5>
                                </div>

                                <div className="space-y-3">
                                  {medicine.alternatives.map((alt, altIdx) => (
                                    <div key={alt.medicine_id} className="bg-yellow-50 border-2 border-yellow-300 rounded-lg p-4">
                                      <div className="flex items-center justify-between mb-3">
                                        <div>
                                          <h5 className="font-bold text-gray-900">{alt.medicine_name}</h5>
                                          <p className="text-sm text-gray-600">
                                            {alt.dosage} • {alt.manufacturer}
                                          </p>
                                        </div>
                                        <div className="px-3 py-1 bg-yellow-200 text-yellow-900 rounded text-sm font-semibold">
                                          Available: {alt.total_available}
                                        </div>
                                      </div>

                                      <div className="flex items-center gap-4">
                                        <label className="text-sm font-medium text-gray-700">Quantity to use:</label>
                                        <input
                                          type="number"
                                          min="0"
                                          max={alt.total_available}
                                          value={medicineSelections[requestItemIndex]?.[alt.medicine_id] || 0}
                                          onChange={(e) => updateMedicineSelection(requestItemIndex, alt.medicine_id, e.target.value)}
                                          className="w-32 px-3 py-2 border-2 border-gray-300 rounded-lg focus:border-yellow-500 focus:ring-2 focus:ring-yellow-200 text-lg font-semibold"
                                        />
                                        <span className="text-gray-600">/ {alt.total_available}</span>
                                      </div>

                                      {/* Alternative Stock Batches */}
                                      {alt.stocks.length > 0 && (
                                        <div className="mt-3 space-y-1">
                                          <p className="text-xs font-semibold text-gray-600 uppercase">Batches:</p>
                                          {alt.stocks.map(stock => (
                                            <div key={stock.stock_id} className="flex justify-between items-center text-xs bg-white p-2 rounded">
                                              <span>Batch: {stock.batch_number}</span>
                                              <span>Qty: <strong>{stock.quantity}</strong></span>
                                              <span className="text-gray-600">Exp: {formatDateDMY(stock.expiry_date)}</span>
                                            </div>
                                          ))}
                                        </div>
                                      )}
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}

                            {medicine.exact_medicine.total_available === 0 && medicine.alternatives.length === 0 && (
                              <div className="text-center py-8 bg-red-50 rounded-lg border-2 border-red-200">
                                <svg className="w-12 h-12 text-red-400 mx-auto mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                                </svg>
                                <p className="text-red-700 font-semibold">No stock available for this medicine or alternatives</p>
                              </div>
                            )}
                          </>
                        )}

                        {/* GENERIC REQUEST - Show all options */}
                        {medicine.request_item_type === 'generic' && (
                          <>
                            {medicine.available_options.length > 0 ? (
                              <div className="space-y-3">
                                <div className="flex items-center gap-2 mb-3">
                                  <svg className="w-5 h-5 text-blue-600" fill="currentColor" viewBox="0 0 20 20">
                                    <path d="M7 3a1 1 0 000 2h6a1 1 0 100-2H7zM4 7a1 1 0 011-1h10a1 1 0 110 2H5a1 1 0 01-1-1zM2 11a2 2 0 012-2h12a2 2 0 012 2v4a2 2 0 01-2 2H4a2 2 0 01-2-2v-4z" />
                                  </svg>
                                  <h5 className="text-md font-bold text-blue-800">Select Medicines from Generic Category</h5>
                                  <span className="text-sm text-gray-600">(Total Available: {medicine.total_available})</span>
                                </div>

                                {medicine.available_options.map((option, optIdx) => (
                                  <div key={option.medicine_id} className="bg-blue-50 border-2 border-blue-300 rounded-lg p-4">
                                    <div className="flex items-center justify-between mb-3">
                                      <div>
                                        <h5 className="font-bold text-gray-900">{option.medicine_name}</h5>
                                        <p className="text-sm text-gray-600">
                                          {option.dosage} • {option.unit} • {option.manufacturer}
                                        </p>
                                      </div>
                                      <div className="px-3 py-1 bg-blue-200 text-blue-900 rounded text-sm font-semibold">
                                        Available: {option.total_available}
                                      </div>
                                    </div>

                                    <div className="flex items-center gap-4">
                                      <label className="text-sm font-medium text-gray-700">Quantity to use:</label>
                                      <input
                                        type="number"
                                        min="0"
                                        max={option.total_available}
                                        value={medicineSelections[requestItemIndex]?.[option.medicine_id] || 0}
                                        onChange={(e) => updateMedicineSelection(requestItemIndex, option.medicine_id, e.target.value)}
                                        className="w-32 px-3 py-2 border-2 border-gray-300 rounded-lg focus:border-blue-500 focus:ring-2 focus:ring-blue-200 text-lg font-semibold"
                                      />
                                      <span className="text-gray-600">/ {option.total_available}</span>
                                    </div>

                                    {/* Generic Option Stock Batches */}
                                    {option.stocks.length > 0 && (
                                      <div className="mt-3 space-y-1">
                                        <p className="text-xs font-semibold text-gray-600 uppercase">Batches (FEFO Order):</p>
                                        {option.stocks.map(stock => (
                                          <div key={stock.stock_id} className="flex justify-between items-center text-xs bg-white p-2 rounded">
                                            <span>Batch: {stock.batch_number}</span>
                                            <span>Qty: <strong>{stock.quantity}</strong></span>
                                            <span className="text-gray-600">Exp: {formatDateDMY(stock.expiry_date)}</span>
                                            <span>₹{stock.price_per_unit}</span>
                                          </div>
                                        ))}
                                      </div>
                                    )}
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <div className="text-center py-8 bg-red-50 rounded-lg border-2 border-red-200">
                                <svg className="w-12 h-12 text-red-400 mx-auto mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                                </svg>
                                <p className="text-red-700 font-semibold">No medicines available in this generic category</p>
                              </div>
                            )}
                          </>
                        )}
                      </div>

                      {/* Allocation Result */}
                      {allocationResult && (
                        <div className="mt-6 bg-green-50 p-4 rounded-lg border-2 border-green-300">
                          <h5 className="font-semibold text-green-800 mb-3 flex items-center gap-2">
                            <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                            </svg>
                            ✓ Allocation Completed Successfully!
                          </h5>
                          <div className="text-sm text-green-700 space-y-1">
                            {Object.entries(allocationResult).map(([medId, result]) => (
                              result.allocations.map((alloc, idx) => (
                                <div key={`${medId}-${idx}`}>
                                  • Medicine #{medId}, Batch {alloc.batch_number}: Used {alloc.allocated}, Remaining: {alloc.new_quantity}
                                </div>
                              ))
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Action Buttons */}
              <div className="mt-8 flex justify-between items-center gap-4 sticky bottom-0 bg-white pt-4 border-t-2">
                <div className="text-sm text-gray-600">
                  {stockDetails.medicines.every((_, idx) => getTotalSelected(idx) === Number(stockDetails.medicines[idx].quantity_requested)) ? (
                    <span className="text-green-600 font-semibold flex items-center gap-2">
                      <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                      </svg>
                      All requirements met - Ready to allocate!
                    </span>
                  ) : (
                    <span className="text-orange-600 font-semibold">⚠️ Please complete all medicine selections</span>
                  )}
                </div>
                
                <div className="flex gap-3">
                  <button
                    onClick={() => {
                      setIsStockModalOpen(false);
                      setStockDetails(null);
                      setAllocationResult(null);
                      setMedicineSelections({});
                    }}
                    className="px-6 py-3 text-sm font-semibold text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition"
                  >
                    Cancel
                  </button>
                  {!allocationResult && (
                    <button
                      onClick={handleAllocateStocks}
                      disabled={processingAllocation}
                      className={`px-8 py-3 text-sm font-bold text-white rounded-lg transition-all shadow-lg ${
                        processingAllocation
                          ? 'bg-gray-400 cursor-not-allowed' 
                          : 'bg-gradient-to-r from-green-600 to-green-700 hover:from-green-700 hover:to-green-800 transform hover:scale-105'
                      }`}
                    >
                      {processingAllocation ? (
                        <span className="flex items-center gap-2">
                          <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                          </svg>
                          Processing...
                        </span>
                      ) : (
                        '🚀 Allocate Stocks & Confirm Order'
                      )}
                    </button>
                  )}
                  {allocationResult && (
                    <div className="text-green-600 font-bold flex items-center gap-2 px-6 py-3 bg-green-100 rounded-lg">
                      <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                      </svg>
                      Order Successfully Processed!
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  );
};

export default IncomingEmergencyRequests;