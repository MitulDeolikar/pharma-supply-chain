import { useRouter } from "next/router";
import { useEffect, useState } from "react";
import Modal from "react-modal";
import { ToastContainer, toast } from "react-toastify";
import "react-toastify/dist/ReactToastify.css";
import useSSE from '../hooks/useSSE';

const WarehouseDispatch = ({ logout }) => {
  const router = useRouter();
  const [emergencyRequests, setEmergencyRequests] = useState([]);
  const [demandRequests, setDemandRequests] = useState([]);
  const [selectedRequests, setSelectedRequests] = useState([]); // Array of {request_id, request_type}
  const [allocatedRequests, setAllocatedRequests] = useState([]); // Array of completed allocations
  const [searchQuery, setSearchQuery] = useState("");
  const [activeTab, setActiveTab] = useState('pending'); // 'pending' or 'allocated'
  const [isAllocating, setIsAllocating] = useState(false);
  const [currentAllocationRequest, setCurrentAllocationRequest] = useState(null);
  const [stockDetails, setStockDetails] = useState(null);
  const [medicineSelections, setMedicineSelections] = useState({});
  const [isDispatchingAll, setIsDispatchingAll] = useState(false);
  const [generics, setGenerics] = useState([]);

  useEffect(() => {
    const checkToken = async () => {
      try {
        const token = localStorage.getItem("token");
        if (!token) router.push("/");
      } catch (error) {
        router.push("/");
      }
    };
    checkToken();
    fetchRequests();
    fetchGenerics();
  }, [router.query]);

  // Real-time updates — refresh pending dispatch list when new requests are assigned
  // to this warehouse or existing requests change status.
  const handleSSEEvent = (event) => {
    const t = event.type;
    if (
      t === 'emergency:approved' ||
      t === 'emergency:received' ||
      t === 'demand:received' ||
      t === 'warehouse:dispatched'
    ) {
      fetchRequests();
      toast.info('Dispatch list updated', { autoClose: 2000 });
    }
  };
  useSSE({ role: 'warehouse', id: router.query.warehouse_id, onEvent: handleSSEEvent });

  const fetchGenerics = async () => {
    try {
      const resp = await fetch('/api/getAllGenerics');
      const j = await resp.json();
      if (j.success) setGenerics(j.generics || []);
    } catch (e) {
      console.warn('Failed to load generics', e);
    }
  };

  const fetchRequests = async () => {
    try {
      const { warehouse_id } = router.query;
      if (!warehouse_id) return;

      // Fetch emergency requests
      const emergencyRes = await fetch("/api/fetchAllEmergencyRequests");
      const emergencyData = await emergencyRes.json();
      
      if (emergencyData.success) {
        const filtered = emergencyData.requests
          .filter(r => r.accepting_warehouse_id == warehouse_id && r.status === 'order_sent')
          .map(r => ({
            ...r,
            request_type: 'emergency',
            displayId: `E-${r.request_id}`,
            dateRequested: r.request_date
          }));
        setEmergencyRequests(filtered);
      }

      // Fetch demand requests
      const demandRes = await fetch("/api/fetchAllDemandRequests");
      const demandData = await demandRes.json();
      
      if (demandData.success) {
        const filtered = demandData.requests
          .filter(r => r.accepting_warehouse_id == warehouse_id && r.status === 'approved')
          .map(r => ({
            ...r,
            request_type: 'demand',
            displayId: `D-${r.request_id}`,
            dateRequested: r.request_date
          }));
        setDemandRequests(filtered);
      }
    } catch (error) {
      console.error("Error fetching requests:", error);
      toast.error("Failed to fetch requests");
    }
  };

  const allPendingRequests = [...emergencyRequests, ...demandRequests];
  const filteredRequests = allPendingRequests.filter(r => 
    searchQuery === '' || 
    r.displayId.toLowerCase().includes(searchQuery.toLowerCase()) ||
    r.pharmacy_name?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const handleSelectRequest = (request) => {
    const key = `${request.request_type}-${request.request_id}`;
    const isSelected = selectedRequests.some(r => 
      r.request_id === request.request_id && r.request_type === request.request_type
    );

    if (isSelected) {
      setSelectedRequests(selectedRequests.filter(r => 
        !(r.request_id === request.request_id && r.request_type === request.request_type)
      ));
    } else {
      setSelectedRequests([...selectedRequests, {
        request_id: request.request_id,
        request_type: request.request_type,
        displayId: request.displayId,
        pharmacy_name: request.pharmacy_name
      }]);
    }
  };

  const handleAllocateRequest = async (request) => {
    const { warehouse_id } = router.query;
    if (!warehouse_id) return;

    setIsAllocating(true);
    setCurrentAllocationRequest(request);

    try {
      const response = await fetch(
        `/api/fetchWarehouseOrderStocks?warehouse_id=${warehouse_id}&request_id=${request.request_id}&request_type=${request.request_type}`
      );
      const data = await response.json();

      if (data.success) {
        setStockDetails(data.stock_details);
        
        // Initialize selections with exact medicine if sufficient
        const initialSelections = {};
        data.stock_details.forEach((item, index) => {
          initialSelections[index] = {};
          
          if (item.request_item_type === 'branded' && item.exact_medicine) {
            const exactMed = item.exact_medicine;
            if (exactMed.has_sufficient) {
              initialSelections[index][exactMed.medicine_id] = item.quantity_requested;
            }
          }
        });
        
        setMedicineSelections(initialSelections);
      } else {
        toast.error(data.message || "Failed to fetch stock details");
        setIsAllocating(false);
        setCurrentAllocationRequest(null);
      }
    } catch (error) {
      console.error("Error fetching stock details:", error);
      toast.error("Failed to fetch stock details");
      setIsAllocating(false);
      setCurrentAllocationRequest(null);
    }
  };

  const updateMedicineSelection = (requestItemIndex, medicineId, quantity) => {
    setMedicineSelections(prev => ({
      ...prev,
      [requestItemIndex]: {
        ...prev[requestItemIndex],
        [medicineId]: quantity
      }
    }));
  };

  const getTotalSelected = (requestItemIndex) => {
    const selections = medicineSelections[requestItemIndex] || {};
    return Object.values(selections).reduce((sum, qty) => sum + Number(qty || 0), 0);
  };

  const validateSelections = () => {
    if (!stockDetails) return { isValid: false, message: "No stock details available" };

    for (let i = 0; i < stockDetails.length; i++) {
      const item = stockDetails[i];
      const totalSelected = getTotalSelected(i);
      const required = item.quantity_requested;

      if (totalSelected !== required) {
        return { 
          isValid: false, 
          message: `Item ${i + 1}: Selected ${totalSelected} but need ${required}` 
        };
      }

      // Validate each medicine has enough stock
      const selections = medicineSelections[i] || {};
      for (const [medicineId, qty] of Object.entries(selections)) {
        if (qty <= 0) continue;

        let availableStock = 0;
        if (item.request_item_type === 'branded') {
          if (item.exact_medicine && item.exact_medicine.medicine_id == medicineId) {
            availableStock = item.exact_medicine.total_available;
          } else {
            const alt = item.alternatives?.find(a => a.medicine_id == medicineId);
            availableStock = alt?.total_available || 0;
          }
        } else if (item.request_item_type === 'generic') {
          const option = item.available_options?.find(o => o.medicine_id == medicineId);
          availableStock = option?.total_available || 0;
        }

        if (qty > availableStock) {
          return { 
            isValid: false, 
            message: `Insufficient stock for selected medicine (need ${qty}, have ${availableStock})` 
          };
        }
      }
    }

    return { isValid: true };
  };

  const handleConfirmAllocation = () => {
    const validation = validateSelections();
    if (!validation.isValid) {
      toast.error(validation.message);
      return;
    }

    // Build allocation structure
    const allocations = stockDetails.map((item, index) => {
      const selections = medicineSelections[index] || {};
      const medicine_allocations = Object.entries(selections)
        .filter(([_, qty]) => qty > 0)
        .map(([medicine_id, quantity]) => ({
          medicine_id: parseInt(medicine_id),
          quantity: Number(quantity)
        }));

      return {
        request_item_index: index,
        medicine_allocations
      };
    });

    // Add to allocated list
    const newAllocation = {
      request_id: currentAllocationRequest.request_id,
      request_type: currentAllocationRequest.request_type,
      pharmacy_id: currentAllocationRequest.pharmacy_id,
      displayId: currentAllocationRequest.displayId,
      pharmacy_name: currentAllocationRequest.pharmacy_name,
      allocations
    };

    setAllocatedRequests([...allocatedRequests, newAllocation]);
    
    // Remove from selected
    setSelectedRequests(selectedRequests.filter(r => 
      !(r.request_id === currentAllocationRequest.request_id && 
        r.request_type === currentAllocationRequest.request_type)
    ));

    toast.success(`Allocation confirmed for ${currentAllocationRequest.displayId}`);
    handleCloseAllocation();
  };

  const handleCloseAllocation = () => {
    setIsAllocating(false);
    setCurrentAllocationRequest(null);
    setStockDetails(null);
    setMedicineSelections({});
  };

  const handleRemoveAllocation = (allocation) => {
    setAllocatedRequests(allocatedRequests.filter(a => 
      !(a.request_id === allocation.request_id && a.request_type === allocation.request_type)
    ));
    toast.info(`Removed allocation for ${allocation.displayId}`);
  };

  const handleDispatchAll = async () => {
    if (allocatedRequests.length === 0) {
      toast.error("No allocated requests to dispatch");
      return;
    }

    const { warehouse_id } = router.query;
    if (!warehouse_id) return;

    if (!confirm(`Are you sure you want to dispatch ${allocatedRequests.length} request(s)?`)) {
      return;
    }

    setIsDispatchingAll(true);

    try {
      const response = await fetch('/api/allocateAndDispatchWarehouseOrders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          warehouse_id: parseInt(warehouse_id),
          dispatches: allocatedRequests
        })
      });

      const data = await response.json();

      if (data.success) {
        toast.success(data.message || "All requests dispatched successfully!");
        
        // Extract unique pharmacy IDs from allocated requests
        const pharmacyIds = [...new Set(allocatedRequests.map(req => req.pharmacy_id))].join(',');
        
        // Navigate to optimized route page
        router.push(
          `/optimizedRoute?warehouse_id=${warehouse_id}&pharmacy_ids=${pharmacyIds}`
        );
        
        setAllocatedRequests([]);
      } else {
        toast.error(data.message || "Failed to dispatch requests");
        if (data.errors && data.errors.length > 0) {
          console.error("Dispatch errors:", data.errors);
        }
      }
    } catch (error) {
      console.error("Error dispatching requests:", error);
      toast.error("Failed to dispatch requests");
    } finally {
      setIsDispatchingAll(false);
    }
  };

  const formatDateDMY = (dateStr) => {
    if (!dateStr) return 'N/A';
    try {
      const d = new Date(dateStr);
      const day = String(d.getDate()).padStart(2, '0');
      const month = String(d.getMonth() + 1).padStart(2, '0');
      const year = d.getFullYear();
      return `${day}/${month}/${year}`;
    } catch {
      return dateStr;
    }
  };

  const getGenericName = (genericId) => {
    const g = generics.find(gen => gen.generic_id === genericId);
    return g ? g.name : 'Unknown Generic';
  };

  return (
    <div className="flex bg-gray-100 min-h-screen">
      <ToastContainer position="top-center" autoClose={2000} hideProgressBar />

      {/* Sidebar */}
      <aside className="flex flex-col w-64 px-4 py-8 bg-gradient-to-b from-indigo-700 to-indigo-900 shadow-2xl">
        <div className="mb-8">
          <div className="flex items-center justify-center w-16 h-16 mx-auto mb-4 bg-white rounded-full">
            <svg className="w-10 h-10 text-indigo-700" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" />
            </svg>
          </div>
          <h2 className="text-2xl font-bold text-white text-center">Dispatch</h2>
          <p className="text-indigo-200 text-center text-sm mt-1">Order Management</p>
        </div>

        <div className="space-y-3 mb-6">
          <div className="bg-white bg-opacity-10 rounded-lg p-3 backdrop-blur-sm">
            <p className="text-indigo-200 text-xs font-medium mb-1">Pending Requests</p>
            <p className="text-white text-2xl font-bold">{allPendingRequests.length}</p>
          </div>
          <div className="bg-white bg-opacity-10 rounded-lg p-3 backdrop-blur-sm">
            <p className="text-indigo-200 text-xs font-medium mb-1">Selected</p>
            <p className="text-yellow-300 text-2xl font-bold">{selectedRequests.length}</p>
          </div>
          <div className="bg-white bg-opacity-10 rounded-lg p-3 backdrop-blur-sm">
            <p className="text-indigo-200 text-xs font-medium mb-1">Allocated</p>
            <p className="text-green-300 text-2xl font-bold">{allocatedRequests.length}</p>
          </div>
        </div>

        <nav className="space-y-3 mt-auto">
          <button
            onClick={() => router.push(`/warehouse?warehouse_id=${router.query.warehouse_id}`)}
            className="flex items-center w-full px-4 py-3 text-left text-white bg-white bg-opacity-10 rounded-lg hover:bg-opacity-20 transition-all duration-200 backdrop-blur-sm"
          >
            <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
            </svg>
            <span className="font-medium">Back to Dashboard</span>
          </button>
          <button
            onClick={logout}
            className="flex items-center w-full px-4 py-3 text-left text-white bg-white bg-opacity-10 rounded-lg hover:bg-opacity-20 transition-all duration-200 backdrop-blur-sm"
          >
            <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
            </svg>
            <span className="font-medium">Logout</span>
          </button>
        </nav>
      </aside>

      {/* Main Content */}
      <main className="flex-1 p-6 bg-gray-50">
        <div className="flex justify-between items-center mb-6">
          <h1 className="text-3xl font-bold text-gray-900">Order Dispatch Management</h1>
          {allocatedRequests.length > 0 && (
            <button
              onClick={handleDispatchAll}
              disabled={isDispatchingAll}
              className="px-6 py-3 bg-gradient-to-r from-green-600 to-green-700 text-white font-bold rounded-xl hover:from-green-700 hover:to-green-800 transition-all shadow-lg flex items-center disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              {isDispatchingAll ? 'Dispatching...' : `Dispatch All (${allocatedRequests.length})`}
            </button>
          )}
        </div>

        {/* Tab Navigation */}
        <div className="mb-6">
          <div className="flex space-x-2 bg-white p-2 rounded-xl shadow-md">
            <button
              onClick={() => setActiveTab('pending')}
              className={`flex-1 py-3 px-4 text-sm font-semibold rounded-lg transition-all duration-200 flex items-center justify-center ${
                activeTab === 'pending'
                  ? 'bg-gradient-to-r from-indigo-600 to-indigo-700 text-white shadow-lg transform scale-105'
                  : 'text-gray-600 hover:bg-gray-100'
              }`}
            >
              <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
              </svg>
              Pending ({allPendingRequests.length})
            </button>
            <button
              onClick={() => setActiveTab('allocated')}
              className={`flex-1 py-3 px-4 text-sm font-semibold rounded-lg transition-all duration-200 flex items-center justify-center ${
                activeTab === 'allocated'
                  ? 'bg-gradient-to-r from-green-600 to-green-700 text-white shadow-lg transform scale-105'
                  : 'text-gray-600 hover:bg-gray-100'
              }`}
            >
              <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              Allocated ({allocatedRequests.length})
            </button>
          </div>
        </div>

        {/* Pending Requests Tab */}
        {activeTab === 'pending' && (
          <>
            <div className="flex justify-between items-center mb-6">
              <div className="relative flex-1 max-w-md">
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search by Request ID or Pharmacy..."
                  className="w-full px-10 py-2.5 text-sm border-2 border-gray-200 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 focus:outline-none transition-all"
                />
                <svg
                  className="w-5 h-5 absolute left-3 top-3 text-gray-400"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-5.197-5.197M16 10.5A5.5 5.5 0 105.5 16 5.5 5.5 0 0016 10.5z" />
                </svg>
              </div>
              {selectedRequests.length > 0 && (
                <div className="text-sm text-gray-600 font-medium">
                  {selectedRequests.length} request(s) selected - Allocate each individually
                </div>
              )}
            </div>

            <div className="bg-white shadow-xl rounded-2xl overflow-hidden border border-gray-100">
              <div className="overflow-x-auto">
                <table className="min-w-full bg-white">
                  <thead>
                    <tr className="bg-gradient-to-r from-indigo-600 to-indigo-700 text-white">
                      <th className="px-6 py-4 text-left text-sm font-bold">
                        <input
                          type="checkbox"
                          checked={filteredRequests.length > 0 && selectedRequests.length === filteredRequests.length}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setSelectedRequests(filteredRequests.map(r => ({
                                request_id: r.request_id,
                                request_type: r.request_type,
                                displayId: r.displayId,
                                pharmacy_name: r.pharmacy_name
                              })));
                            } else {
                              setSelectedRequests([]);
                            }
                          }}
                          className="w-4 h-4 rounded"
                        />
                      </th>
                      <th className="px-6 py-4 text-left text-sm font-bold">Request ID</th>
                      <th className="px-6 py-4 text-left text-sm font-bold">Type</th>
                      <th className="px-6 py-4 text-left text-sm font-bold">Pharmacy</th>
                      <th className="px-6 py-4 text-left text-sm font-bold">Date</th>
                      <th className="px-6 py-4 text-left text-sm font-bold">Items</th>
                      <th className="px-6 py-4 text-left text-sm font-bold">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredRequests.map((request, index) => {
                      const isSelected = selectedRequests.some(r => 
                        r.request_id === request.request_id && r.request_type === request.request_type
                      );
                      
                      return (
                        <tr
                          key={`${request.request_type}-${request.request_id}`}
                          className={`border-b transition-colors duration-150 ${
                            index % 2 === 0 ? 'bg-gray-50' : 'bg-white'
                          } hover:bg-indigo-50 ${isSelected ? 'bg-indigo-100' : ''}`}
                        >
                          <td className="px-6 py-4">
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={() => handleSelectRequest(request)}
                              className="w-4 h-4 rounded"
                            />
                          </td>
                          <td className="px-6 py-4">
                            <span className="font-bold text-gray-900">{request.displayId}</span>
                          </td>
                          <td className="px-6 py-4">
                            <span className={`px-3 py-1 rounded-full text-xs font-semibold ${
                              request.request_type === 'emergency' 
                                ? 'bg-red-100 text-red-800' 
                                : 'bg-blue-100 text-blue-800'
                            }`}>
                              {request.request_type === 'emergency' ? 'Emergency' : 'Demand'}
                            </span>
                          </td>
                          <td className="px-6 py-4 text-gray-800 font-semibold">
                            {request.pharmacy_name}
                          </td>
                          <td className="px-6 py-4 text-gray-700">
                            {formatDateDMY(request.dateRequested)}
                          </td>
                          <td className="px-6 py-4 text-gray-700">
                            {request.medicines?.length || 0} item(s)
                          </td>
                          <td className="px-6 py-4">
                            <button
                              onClick={() => handleAllocateRequest(request)}
                              disabled={!isSelected}
                              className={`px-4 py-2 text-sm font-semibold rounded-lg transition-all shadow-md ${
                                isSelected
                                  ? 'bg-gradient-to-r from-indigo-600 to-indigo-700 text-white hover:from-indigo-700 hover:to-indigo-800'
                                  : 'bg-gray-300 text-gray-500 cursor-not-allowed'
                              }`}
                            >
                              Allocate Stock
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                {filteredRequests.length === 0 && (
                  <div className="text-center py-12">
                    <svg className="w-16 h-16 text-gray-300 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                    </svg>
                    <p className="text-gray-500 text-lg">No pending requests found</p>
                  </div>
                )}
              </div>
            </div>
          </>
        )}

        {/* Allocated Requests Tab */}
        {activeTab === 'allocated' && (
          <div className="bg-white shadow-xl rounded-2xl overflow-hidden border border-gray-100">
            <div className="p-6">
              {allocatedRequests.length === 0 ? (
                <div className="text-center py-12">
                  <svg className="w-16 h-16 text-gray-300 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <p className="text-gray-500 text-lg">No allocated requests yet</p>
                  <p className="text-gray-400 text-sm mt-2">Select and allocate requests from the Pending tab</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {allocatedRequests.map((allocation, idx) => (
                    <div key={idx} className="border-2 border-green-200 rounded-xl p-4 bg-green-50">
                      <div className="flex justify-between items-start mb-3">
                        <div>
                          <h3 className="text-lg font-bold text-gray-900">{allocation.displayId}</h3>
                          <p className="text-sm text-gray-600">{allocation.pharmacy_name}</p>
                          <span className={`inline-block mt-2 px-3 py-1 rounded-full text-xs font-semibold ${
                            allocation.request_type === 'emergency' 
                              ? 'bg-red-100 text-red-800' 
                              : 'bg-blue-100 text-blue-800'
                          }`}>
                            {allocation.request_type === 'emergency' ? 'Emergency' : 'Demand'}
                          </span>
                        </div>
                        <button
                          onClick={() => handleRemoveAllocation(allocation)}
                          className="px-3 py-1.5 bg-red-600 text-white text-sm font-semibold rounded-lg hover:bg-red-700 transition-colors"
                        >
                          Remove
                        </button>
                      </div>
                      <div className="mt-3 bg-white rounded-lg p-3">
                        <p className="text-sm font-semibold text-gray-700 mb-2">
                          Allocated {allocation.allocations.length} item(s)
                        </p>
                        <div className="text-xs text-gray-600">
                          {allocation.allocations.map((alloc, i) => (
                            <div key={i} className="mb-1">
                              Item {i + 1}: {alloc.medicine_allocations.length} medicine(s) allocated
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Allocation Modal */}
        <Modal
          isOpen={isAllocating}
          onRequestClose={handleCloseAllocation}
          className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 bg-white rounded-2xl shadow-2xl w-[90vw] max-w-5xl max-h-[90vh] overflow-hidden flex flex-col"
          overlayClassName="fixed inset-0 bg-black bg-opacity-50 z-50"
        >
          {currentAllocationRequest && stockDetails && (
            <>
              {/* Modal Header */}
              <div className="sticky top-0 bg-gradient-to-r from-indigo-600 to-indigo-700 text-white p-6 shadow-lg z-10">
                <div className="flex justify-between items-start">
                  <div>
                    <h2 className="text-2xl font-bold mb-1">Allocate Stock</h2>
                    <p className="text-indigo-100">
                      {currentAllocationRequest.displayId} - {currentAllocationRequest.pharmacy_name}
                    </p>
                    <span className={`inline-block mt-2 px-3 py-1 rounded-full text-xs font-semibold ${
                      currentAllocationRequest.request_type === 'emergency' 
                        ? 'bg-red-500 text-white' 
                        : 'bg-blue-500 text-white'
                    }`}>
                      {currentAllocationRequest.request_type === 'emergency' ? 'Emergency Request' : 'Demand Request'}
                    </span>
                  </div>
                  <button
                    onClick={handleCloseAllocation}
                    className="text-white hover:text-gray-200 transition-colors"
                  >
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              </div>

              {/* Modal Body */}
              <div className="flex-1 overflow-y-auto p-6">
                <div className="space-y-6">
                  {stockDetails.map((item, itemIndex) => {
                    const totalSelected = getTotalSelected(itemIndex);
                    const required = item.quantity_requested;
                    const isComplete = totalSelected === required;
                    const isOver = totalSelected > required;
                    const statusColor = isComplete ? 'text-green-600' : isOver ? 'text-red-600' : 'text-yellow-600';

                    return (
                      <div key={itemIndex} className="border-2 border-gray-200 rounded-xl p-5 bg-gray-50">
                        {/* Request Item Header */}
                        <div className="flex justify-between items-start mb-4">
                          <div>
                            <div className="flex items-center gap-2 mb-2">
                              <h3 className="text-lg font-bold text-gray-900">
                                Request Item #{itemIndex + 1}
                              </h3>
                              <span className={`px-3 py-1 rounded-full text-xs font-bold ${
                                item.request_item_type === 'branded' 
                                  ? 'bg-purple-100 text-purple-800' 
                                  : 'bg-cyan-100 text-cyan-800'
                              }`}>
                                {item.request_item_type === 'branded' ? 'BRANDED REQUEST' : 'GENERIC REQUEST'}
                              </span>
                            </div>
                            {item.request_item_type === 'branded' ? (
                              <p className="text-gray-700">
                                <span className="font-semibold">{item.medicine_name}</span>
                                {item.dosage && ` - ${item.dosage} ${item.unit_type}`}
                              </p>
                            ) : (
                              <p className="text-gray-700">
                                <span className="font-semibold">{item.generic_name}</span>
                                {item.generic_category && ` (${item.generic_category})`}
                              </p>
                            )}
                          </div>
                          <div className="text-right">
                            <p className="text-sm text-gray-600">Required</p>
                            <p className="text-2xl font-bold text-gray-900">{required}</p>
                            <p className={`text-sm font-semibold mt-1 ${statusColor}`}>
                              Selected: {totalSelected}
                            </p>
                          </div>
                        </div>

                        {/* BRANDED REQUEST: Exact Medicine */}
                        {item.request_item_type === 'branded' && item.exact_medicine && (
                          <div className="mb-4 bg-white border-2 border-green-200 rounded-lg p-4">
                            <div className="flex justify-between items-center mb-3">
                              <div className="flex items-center gap-2">
                                <span className="px-3 py-1 bg-green-500 text-white text-xs font-bold rounded-full">
                                  EXACT MATCH
                                </span>
                                <h4 className="font-bold text-gray-900">{item.exact_medicine.medicine_name}</h4>
                              </div>
                              <div className="text-right">
                                <p className="text-xs text-gray-600">Available</p>
                                <p className="text-lg font-bold text-green-600">
                                  {item.exact_medicine.total_available}
                                </p>
                              </div>
                            </div>

                            {/* Quantity Input */}
                            <div className="mb-3">
                              <label className="block text-sm font-semibold text-gray-700 mb-2">
                                Quantity to Allocate
                              </label>
                              <input
                                type="number"
                                min="0"
                                max={Math.min(item.exact_medicine.total_available, required)}
                                value={medicineSelections[itemIndex]?.[item.exact_medicine.medicine_id] || ''}
                                onChange={(e) => updateMedicineSelection(
                                  itemIndex, 
                                  item.exact_medicine.medicine_id, 
                                  Number(e.target.value || 0)
                                )}
                                placeholder="Enter quantity"
                                className="w-full px-4 py-2 border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500"
                              />
                            </div>

                            {/* Batch Details */}
                            {item.exact_medicine.stocks && item.exact_medicine.stocks.length > 0 && (
                              <div className="mt-3">
                                <p className="text-xs font-semibold text-gray-600 mb-2">Available Batches (FEFO Order):</p>
                                <div className="space-y-1">
                                  {item.exact_medicine.stocks.map((stock, si) => (
                                    <div key={si} className="flex justify-between text-xs bg-gray-50 p-2 rounded">
                                      <span className="text-gray-700">
                                        Batch: <span className="font-semibold">{stock.batch_number}</span>
                                      </span>
                                      <span className="text-gray-600">
                                        Qty: <span className="font-bold">{stock.quantity}</span> | 
                                        Exp: {formatDateDMY(stock.expiry_date)}
                                      </span>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}
                          </div>
                        )}

                        {/* BRANDED REQUEST: Alternative Medicines */}
                        {item.request_item_type === 'branded' && item.alternatives && item.alternatives.length > 0 && (
                          <div className="bg-white border-2 border-yellow-200 rounded-lg p-4">
                            <div className="flex items-center gap-2 mb-3">
                              <span className="px-3 py-1 bg-yellow-500 text-white text-xs font-bold rounded-full">
                                ALTERNATIVES
                              </span>
                              <p className="text-sm text-gray-600">
                                Same generic category: <span className="font-semibold">{item.generic_name}</span>
                              </p>
                            </div>

                            <div className="space-y-3">
                              {item.alternatives.map((alt, altIdx) => (
                                <div key={altIdx} className="border border-yellow-200 rounded-lg p-3 bg-yellow-50">
                                  <div className="flex justify-between items-center mb-2">
                                    <div>
                                      <p className="font-bold text-gray-900">{alt.medicine_name}</p>
                                      <p className="text-xs text-gray-600">{alt.dosage} {alt.unit_type}</p>
                                    </div>
                                    <div className="text-right">
                                      <p className="text-xs text-gray-600">Available</p>
                                      <p className="text-lg font-bold text-yellow-600">{alt.total_available}</p>
                                    </div>
                                  </div>

                                  <div className="mb-2">
                                    <input
                                      type="number"
                                      min="0"
                                      max={Math.min(alt.total_available, required)}
                                      value={medicineSelections[itemIndex]?.[alt.medicine_id] || ''}
                                      onChange={(e) => updateMedicineSelection(
                                        itemIndex, 
                                        alt.medicine_id, 
                                        Number(e.target.value || 0)
                                      )}
                                      className="w-full px-3 py-2 border-2 border-yellow-300 rounded-lg focus:ring-2 focus:ring-yellow-500"
                                      placeholder="Enter quantity"
                                    />
                                  </div>

                                  {alt.stocks && alt.stocks.length > 0 && (
                                    <div className="mt-2">
                                      <p className="text-xs font-semibold text-gray-600 mb-1">Batches:</p>
                                      <div className="space-y-1">
                                        {alt.stocks.map((stock, si) => (
                                          <div key={si} className="flex justify-between text-xs bg-white p-2 rounded">
                                            <span>Batch: {stock.batch_number}</span>
                                            <span>Qty: {stock.quantity} | Exp: {formatDateDMY(stock.expiry_date)}</span>
                                          </div>
                                        ))}
                                      </div>
                                    </div>
                                  )}
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* GENERIC REQUEST: Available Options */}
                        {item.request_item_type === 'generic' && item.available_options && item.available_options.length > 0 && (
                          <div className="bg-white border-2 border-cyan-200 rounded-lg p-4">
                            <div className="flex items-center gap-2 mb-3">
                              <span className="px-3 py-1 bg-cyan-500 text-white text-xs font-bold rounded-full">
                                AVAILABLE OPTIONS
                              </span>
                              <p className="text-sm text-gray-600">
                                Select from medicines in category: <span className="font-semibold">{item.generic_name}</span>
                              </p>
                            </div>

                            <div className="space-y-3">
                              {item.available_options.map((option, optIdx) => (
                                <div key={optIdx} className="border border-cyan-200 rounded-lg p-3 bg-cyan-50">
                                  <div className="flex justify-between items-center mb-2">
                                    <div>
                                      <p className="font-bold text-gray-900">{option.medicine_name}</p>
                                      <p className="text-xs text-gray-600">{option.dosage} {option.unit_type}</p>
                                    </div>
                                    <div className="text-right">
                                      <p className="text-xs text-gray-600">Available</p>
                                      <p className="text-lg font-bold text-cyan-600">{option.total_available}</p>
                                    </div>
                                  </div>

                                  <div className="mb-2">
                                    <input
                                      type="number"
                                      min="0"
                                      max={Math.min(option.total_available, required)}
                                      value={medicineSelections[itemIndex]?.[option.medicine_id] || ''}
                                      onChange={(e) => updateMedicineSelection(
                                        itemIndex, 
                                        option.medicine_id, 
                                        Number(e.target.value || 0)
                                      )}
                                      className="w-full px-3 py-2 border-2 border-cyan-300 rounded-lg focus:ring-2 focus:ring-cyan-500"
                                      placeholder="Enter quantity"
                                    />
                                  </div>

                                  {option.stocks && option.stocks.length > 0 && (
                                    <div className="mt-2">
                                      <p className="text-xs font-semibold text-gray-600 mb-1">Batches:</p>
                                      <div className="space-y-1">
                                        {option.stocks.map((stock, si) => (
                                          <div key={si} className="flex justify-between text-xs bg-white p-2 rounded">
                                            <span>Batch: {stock.batch_number}</span>
                                            <span>Qty: {stock.quantity} | Exp: {formatDateDMY(stock.expiry_date)}</span>
                                          </div>
                                        ))}
                                      </div>
                                    </div>
                                  )}
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Status Indicator */}
                        <div className={`mt-4 p-3 rounded-lg ${
                          isComplete ? 'bg-green-100 border border-green-300' : 
                          isOver ? 'bg-red-100 border border-red-300' : 
                          'bg-yellow-100 border border-yellow-300'
                        }`}>
                          <p className={`text-sm font-semibold ${statusColor}`}>
                            {isComplete ? '✓ Allocation complete' : 
                             isOver ? `⚠ Over-allocated by ${totalSelected - required}` : 
                             `⚠ Need ${required - totalSelected} more`}
                          </p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Modal Footer */}
              <div className="sticky bottom-0 bg-gray-100 p-6 border-t-2 border-gray-200 flex justify-end space-x-3">
                <button
                  onClick={handleCloseAllocation}
                  className="px-6 py-3 bg-gray-300 text-gray-700 font-semibold rounded-xl hover:bg-gray-400 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleConfirmAllocation}
                  className="px-6 py-3 bg-gradient-to-r from-green-600 to-green-700 text-white font-semibold rounded-xl hover:from-green-700 hover:to-green-800 transition-all shadow-md"
                >
                  Confirm Allocation
                </button>
              </div>
            </>
          )}
        </Modal>
      </main>
    </div>
  );
};

export default WarehouseDispatch;
