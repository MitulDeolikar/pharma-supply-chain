import { useRouter } from "next/router";
import { useEffect, useState } from "react";
import Modal from "react-modal";
import { ToastContainer, toast } from "react-toastify";
import "react-toastify/dist/ReactToastify.css";
import useSSE from "../hooks/useSSE";

const Warehouse = ({ logout }) => {
  const router = useRouter();
  const [emergencyRequests, setEmergencyRequests] = useState([]);
  const [demandRequests, setDemandRequests] = useState([]);
  const [stocks, setStocks] = useState([]);
  const [expiredMedicines, setExpiredMedicines] = useState([]);
  const [nearExpiryMedicines, setNearExpiryMedicines] = useState([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [demandSearchQuery, setDemandSearchQuery] = useState("");
  const [stockSearchQuery, setStockSearchQuery] = useState("");
  const [filteredRequests, setFilteredRequests] = useState([]);
  const [filteredDemandRequests, setFilteredDemandRequests] = useState([]);
  const [filteredStocks, setFilteredStocks] = useState([]);
  const [selectedRequest, setSelectedRequest] = useState(null);
  const [selectedDemandRequest, setSelectedDemandRequest] = useState(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isDemandModalOpen, setIsDemandModalOpen] = useState(false);
  const [isStockModalOpen, setIsStockModalOpen] = useState(false);
  const [isEditMode, setIsEditMode] = useState(false);
  const [medicines, setMedicines] = useState([]);
  const [generics, setGenerics] = useState([]);
  const [activeTab, setActiveTab] = useState('inventory');
  const [disposalQueueCount, setDisposalQueueCount] = useState(0);
  const [nsqNotifications, setNsqNotifications] = useState([]);
  const [nsqPanelOpen, setNsqPanelOpen] = useState(false);
  const [newStock, setNewStock] = useState({
    medicine_id: '',
    batch_number: '',
    quantity: '',
    price_per_unit: '',
    expiry_date: ''
  });

  // Real-time updates via SSE — warehouse receives stock and dispatch events
  // No useCallback needed — useSSE stores onEvent in a ref, so it always
  // calls the latest version without re-opening the EventSource connection.
  const handleSSEEvent = (event) => {
    const t = event.type;
    if (t.startsWith('stock:') || t === 'warehouse:dispatched') {
      fetchWarehouseStock();
    }
    if (t.startsWith('emergency:') || t.startsWith('demand:')) {
      fetchEmergencyRequests();
      fetchDemandRequests();
    }
    toast.info(`Update: ${t.replace(':', ' ').replace(/^\w/, c => c.toUpperCase())}`, { autoClose: 3000 });
  };

  useSSE({ role: 'warehouse', id: router.query.warehouse_id, onEvent: handleSSEEvent });

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
    fetchEmergencyRequests();
    fetchDemandRequests();
    fetchWarehouseStock();
    fetchMedicines();
    fetchDisposalQueueCount();
    fetchNSQNotifications();
    (async () => {
      try {
        const resp = await fetch('/api/getAllGenerics');
        const j = await resp.json();
        if (j.success) setGenerics(j.generics || []);
      } catch (e) {
        console.warn('Failed to load generics', e);
      }
    })();
  }, [router.query]);

  const fetchWarehouseStock = async () => {
    try {
      const { warehouse_id } = router.query;
      if (!warehouse_id) return;
      
      const response = await fetch(`/api/fetchWarehouseStock?warehouseId=${warehouse_id}`);
      const data = await response.json();
      
      if (data.success) {
        setStocks(data.stocks);
        setFilteredStocks(data.stocks);
        
        const currentDate = new Date();
        const ninetyDaysFromNow = new Date();
        ninetyDaysFromNow.setDate(currentDate.getDate() + 90);
        
        const expired = data.stocks.filter(stock => 
          new Date(stock.expiry_date) <= currentDate
        );
        const nearExpiry = data.stocks.filter(stock => {
          const expiryDate = new Date(stock.expiry_date);
          return expiryDate > currentDate && expiryDate <= ninetyDaysFromNow;
        });
        
        setExpiredMedicines(expired);
        setNearExpiryMedicines(nearExpiry);
      }
    } catch (error) {
      console.error("Error fetching warehouse stock:", error);
      toast.error("Failed to fetch stock data");
    }
  };

  const fetchMedicines = async () => {
    try {
      const response = await fetch("/api/fetchAllMedicines");
      const data = await response.json();
      if (data.success) {
        setMedicines(data.medicines);
      }
    } catch (error) {
      console.error("Error fetching medicines:", error);
    }
  };

  const fetchDisposalQueueCount = async () => {
    try {
      const { warehouse_id } = router.query;
      if (!warehouse_id) return;

      const response = await fetch(`/api/warehouseGetDisposalRequests?warehouse_id=${warehouse_id}&status=request_sent`);
      const data = await response.json();
      if (data.success) {
        setDisposalQueueCount(data.total);
      }
    } catch (error) {
      console.error("Error fetching disposal queue count:", error);
    }
  };

  const fetchDemandRequests = async () => {
    try {
      const { warehouse_id } = router.query;
      const response = await fetch("/api/fetchAllDemandRequests");
      const data = await response.json();

      if (data.success && Array.isArray(data.requests)) {
        const formattedRequests = data.requests
          .filter(request => request.accepting_warehouse_id == warehouse_id)
          .map((request) => ({
            ...request,
            requestId: request.request_id,
            pharmacyId: request.pharmacy_id,
            pharmacyName: request.pharmacy_name,
            dateRequested: request.request_date,
            status: request.status,
            remarks: request.remarks,
            commentsFromApprover: request.comments_from_approver,
            medicines: request.medicines || [],
          }));
        setDemandRequests(formattedRequests);
        setFilteredDemandRequests(formattedRequests);
      } else {
        toast.error("Invalid data format received for demand requests");
      }
    } catch (error) {
      console.error("Error fetching demand requests:", error);
      toast.error("Failed to fetch demand requests");
    }
  };

  const fetchEmergencyRequests = async () => {
    try {
      const { warehouse_id } = router.query;
      const response = await fetch("/api/fetchAllEmergencyRequests");
      const data = await response.json();

      if (data.success && Array.isArray(data.requests)) {
        const formattedRequests = data.requests
          .filter(request => request.accepting_warehouse_id == warehouse_id)
          .map((request) => ({
            ...request,
            requestId: request.request_id,
            pharmacyId: request.pharmacy_id,
            pharmacyName: request.pharmacy_name,
            acceptingPharmacyId: request.accepting_pharmacy_id,
            acceptingWarehouseId: request.accepting_warehouse_id,
            accepting_pharmacy_name: request.accepting_pharmacy_name,
            dateRequested: request.request_date,
            status: request.status,
            remarks: request.remarks,
            medicines: request.medicines || [],
          }));

        setEmergencyRequests(formattedRequests);
        setFilteredRequests(formattedRequests);
      } else {
        toast.error("Invalid data format received");
      }
    } catch (error) {
      console.error("Error fetching emergency requests:", error);
      toast.error("Failed to fetch emergency requests");
    }
  };

  const handleSearch = (e) => {
    const query = e.target.value.toLowerCase();
    const filtered = emergencyRequests.filter(
      (request) =>
        (request.requestId && request.requestId.toString().includes(query)) ||
        (request.pharmacyName &&
          request.pharmacyName.toLowerCase().includes(query)) ||
        (request.status && request.status.toLowerCase().includes(query))
    );
    setSearchQuery(query);
    setFilteredRequests(filtered);
  };

  const handleDemandSearch = (e) => {
    const query = e.target.value.toLowerCase();
    const filtered = demandRequests.filter(
      (request) =>
        (request.requestId && request.requestId.toString().includes(query)) ||
        (request.pharmacyName &&
          request.pharmacyName.toLowerCase().includes(query)) ||
        (request.status && request.status.toLowerCase().includes(query))
    );
    setDemandSearchQuery(query);
    setFilteredDemandRequests(filtered);
  };

  const handleStockSearch = (e) => {
    const query = e.target.value.toLowerCase();
    const filtered = stocks.filter(
      (stock) =>
        (stock.medicine_name && stock.medicine_name.toLowerCase().includes(query)) ||
        (stock.batch_number && stock.batch_number.toLowerCase().includes(query)) ||
        (stock.generic_name && stock.generic_name.toLowerCase().includes(query))
    );
    setStockSearchQuery(query);
    setFilteredStocks(filtered);
  };

  const openModal = (request) => {
    setSelectedRequest(request);
    setIsModalOpen(true);
  };

  const closeModal = () => {
    setSelectedRequest(null);
    setIsModalOpen(false);
  };

  const openDemandModal = (request) => {
    setSelectedDemandRequest(request);
    setIsDemandModalOpen(true);
  };

  const closeDemandModal = () => {
    setSelectedDemandRequest(null);
    setIsDemandModalOpen(false);
  };

  const statusClasses = {
    "pending_approval_from_cmo": "bg-yellow-100 text-yellow-800",
    "order_sent": "bg-blue-100 text-blue-800",
    "order_successful": "bg-green-100 text-green-800",
    "rejected": "bg-red-100 text-red-800",
    "pending": "bg-yellow-100 text-yellow-800",
    "approved": "bg-green-100 text-green-800"
  };

  const statusLabels = {
    "pending_approval_from_cmo": "Pending CMO Approval",
    "order_sent": "Order Sent",
    "order_successful": "Order Successful",
    "rejected": "Rejected",
    "pending": "Pending",
    "approved": "Approved"
  };

  const getGenericName = (genericId) => {
    const g = generics.find(gen => gen.generic_id === genericId);
    return g ? g.name : 'Unknown Generic';
  };

  const handleViewRequest = (request) => {
    openModal(request);
  };

  const handleAddStock = () => {
    setIsEditMode(false);
    setNewStock({
      medicine_id: '',
      batch_number: '',
      quantity: '',
      price_per_unit: '',
      expiry_date: ''
    });
    setIsStockModalOpen(true);
  };

  const handleEditStock = (stock) => {
    setIsEditMode(true);
    setNewStock({
      stock_id: stock.stock_id,
      medicine_id: stock.medicine_id,
      batch_number: stock.batch_number,
      quantity: stock.quantity,
      price_per_unit: stock.price_per_unit,
      expiry_date: new Date(stock.expiry_date).toISOString().split('T')[0]
    });
    setIsStockModalOpen(true);
  };

  const handleStockModalClose = () => {
    setIsStockModalOpen(false);
    setIsEditMode(false);
    setNewStock({
      medicine_id: '',
      batch_number: '',
      quantity: '',
      price_per_unit: '',
      expiry_date: ''
    });
  };

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setNewStock(prev => ({
      ...prev,
      [name]: value
    }));
  };

  const handleSubmitStock = async (e) => {
    e.preventDefault();
    const { warehouse_id } = router.query;
    
    try {
      const url = isEditMode ? '/api/editStock' : '/api/addStock';
      const method = isEditMode ? 'PUT' : 'POST';
      
      const payload = isEditMode 
        ? newStock
        : { ...newStock, warehouse_id };
      
      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      
      const data = await response.json();
      
      if (data.success) {
        toast.success(isEditMode ? 'Stock updated successfully!' : 'Stock added successfully!');
        handleStockModalClose();
        fetchWarehouseStock();
      } else {
        toast.error(data.message || 'Failed to save stock');
      }
    } catch (error) {
      console.error('Error saving stock:', error);
      toast.error('Error saving stock');
    }
  };

  const handleRemoveStock = async (stock_id) => {
    if (!confirm('Are you sure you want to remove this stock item?')) return;
    
    try {
      const response = await fetch('/api/removeStock', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stock_id })
      });
      
      const data = await response.json();
      
      if (data.success) {
        toast.success('Stock removed successfully!');
        fetchWarehouseStock();
      } else {
        toast.error(data.message || 'Failed to remove stock');
      }
    } catch (error) {
      console.error('Error removing stock:', error);
      toast.error('Error removing stock');
    }
  };

  const fetchNSQNotifications = async () => {
    try {
      const { warehouse_id } = router.query;
      if (!warehouse_id) return;
      const resp = await fetch(`/api/fetchNSQNotificationsWarehouse?warehouse_id=${warehouse_id}`);
      const data = await resp.json();
      if (data.success) setNsqNotifications(data.notifications || []);
    } catch (e) {
      console.warn('Failed to load NSQ notifications', e);
    }
  };

  const markNSQRead = async (notification_id) => {
    try {
      const { warehouse_id } = router.query;
      const resp = await fetch('/api/markNSQReadWarehouse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notification_id, warehouse_id }),
      });
      const data = await resp.json();
      if (data.success) {
        toast.success(`Batch ${data.batch_number} marked as NSQ in your stock.`);
        fetchNSQNotifications();
        fetchWarehouseStock();
      } else {
        toast.error(data.message || 'Failed to mark NSQ');
      }
    } catch (e) {
      toast.error('Error marking NSQ');
    }
  };

  return (
    <div className="flex bg-gray-100 min-h-screen">
      <ToastContainer position="top-center" autoClose={1500} hideProgressBar />

      {/* Sidebar */}
      <aside className="flex flex-col w-64 px-4 py-8 bg-gradient-to-b from-purple-700 to-purple-900 shadow-2xl">
        <div className="mb-8">
          <div className="flex items-center justify-center w-16 h-16 mx-auto mb-4 bg-white rounded-full">
            <svg className="w-10 h-10 text-purple-700" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
            </svg>
          </div>
          <h2 className="text-2xl font-bold text-white text-center">Warehouse</h2>
          <p className="text-purple-200 text-center text-sm mt-1">Central Inventory</p>
        </div>

        {/* Statistics Cards */}
        <div className="space-y-3 mb-6">
          <div className="bg-white bg-opacity-10 rounded-lg p-3 backdrop-blur-sm">
            <p className="text-purple-200 text-xs font-medium mb-1">Total Stock Items</p>
            <p className="text-white text-2xl font-bold">{stocks.length}</p>
          </div>
          <div className="bg-white bg-opacity-10 rounded-lg p-3 backdrop-blur-sm">
            <p className="text-purple-200 text-xs font-medium mb-1">Expired Items</p>
            <p className="text-red-300 text-2xl font-bold">{expiredMedicines.length}</p>
          </div>
          <div className="bg-white bg-opacity-10 rounded-lg p-3 backdrop-blur-sm">
            <p className="text-purple-200 text-xs font-medium mb-1">Emergency Requests</p>
            <p className="text-yellow-300 text-2xl font-bold">{emergencyRequests.length}</p>
          </div>
          <div className="bg-white bg-opacity-10 rounded-lg p-3 backdrop-blur-sm">
            <p className="text-purple-200 text-xs font-medium mb-1">Demand Requests</p>
            <p className="text-green-300 text-2xl font-bold">{demandRequests.length}</p>
          </div>
          <div className="bg-white bg-opacity-10 rounded-lg p-3 backdrop-blur-sm border border-blue-400">
            <p className="text-blue-200 text-xs font-medium mb-1">📤 Disposal Queue</p>
            <p className="text-blue-300 text-2xl font-bold">{disposalQueueCount}</p>
          </div>
        </div>

        <nav className="space-y-3 mt-auto">
          <button
            onClick={logout}
            className="flex items-center w-full px-4 py-3 text-left text-white bg-white bg-opacity-10 rounded-lg hover:bg-opacity-20 transition-all duration-200 backdrop-blur-sm"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M3 3a1 1 0 011 1v12a1 1 0 11-2 0V4a1 1 0 011-1zm7.707 3.293a1 1 0 010 1.414L9.414 9H17a1 1 0 110 2H9.414l1.293 1.293a1 1 0 01-1.414 1.414l-3-3a1 1 0 010-1.414l3-3a1 1 0 011.414 0z" clipRule="evenodd" />
            </svg>
            <span className="font-medium">Logout</span>
          </button>
        </nav>
      </aside>

      {/* Main Content */}
      <main className="flex-1 p-6 bg-gray-50">

        {/* NSQ Warning Banner */}
        {nsqNotifications.filter(n => !n.is_read).length > 0 && (
          <div className="mb-6 bg-red-50 border-2 border-red-400 rounded-xl p-4">
            <div
              className="flex items-center justify-between cursor-pointer"
              onClick={() => setNsqPanelOpen(o => !o)}
            >
              <div className="flex items-center space-x-3">
                <span className="text-2xl">⚠️</span>
                <div>
                  <p className="font-bold text-red-800 text-lg">
                    NSQ Alert — {nsqNotifications.filter(n => !n.is_read).length} Unacknowledged Batch(es)
                  </p>
                  <p className="text-red-600 text-sm">
                    The CMO has declared one or more batches in your inventory as Not of Standard Quality. Immediate action required.
                  </p>
                </div>
              </div>
              <span className="text-red-600 font-bold text-sm">{nsqPanelOpen ? '▲ Hide' : '▼ View'}</span>
            </div>

            {nsqPanelOpen && (
              <div className="mt-4 space-y-3">
                {nsqNotifications.filter(n => !n.is_read).map(notif => (
                  <div key={notif.id} className="bg-white border border-red-200 rounded-lg p-4">
                    <div className="flex items-start justify-between">
                      <div>
                        <p className="font-semibold text-gray-900">
                          {notif.medicine_name} — Batch: <span className="font-mono text-red-700">{notif.batch_number}</span>
                        </p>
                        <p className="text-sm text-gray-600 mt-1">{notif.message}</p>
                        <p className="text-xs text-gray-400 mt-1">
                          Declared by {notif.declared_by || 'CMO'} on {new Date(notif.declared_at).toLocaleString()}
                          {notif.current_quantity > 0 && (
                            <> &nbsp;·&nbsp; <span className="text-red-600 font-semibold">You hold {notif.current_quantity} units</span></>
                          )}
                        </p>
                      </div>
                      <button
                        onClick={() => markNSQRead(notif.id)}
                        className="ml-4 px-4 py-2 bg-red-600 text-white text-sm font-semibold rounded-lg hover:bg-red-700 transition-colors whitespace-nowrap"
                      >
                        Acknowledge & Mark NSQ
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        <div className="flex justify-between items-center mb-8">
          <h1 className="text-3xl font-bold text-gray-900">
            Drug Warehouse Dashboard
          </h1>
          <div className="flex space-x-3">
            <button
              onClick={() => router.push(`/warehouseDisposalRequests?warehouse_id=${router.query.warehouse_id}`)}
              className="px-6 py-3 bg-gradient-to-r from-blue-600 to-blue-700 text-white font-semibold rounded-xl hover:from-blue-700 hover:to-blue-800 transition-all shadow-lg flex items-center"
            >
              <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
              </svg>
              Disposal Queue
            </button>
            <button
              onClick={() => router.push(`/warehouseDispatch?warehouse_id=${router.query.warehouse_id}`)}
              className="px-6 py-3 bg-gradient-to-r from-indigo-600 to-indigo-700 text-white font-semibold rounded-xl hover:from-indigo-700 hover:to-indigo-800 transition-all shadow-lg flex items-center"
            >
              <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" />
              </svg>
              Order Dispatch
            </button>
          </div>
        </div>

        {/* Tab Navigation */}
        <div className="mb-6">
          <div className="flex space-x-2 bg-white p-2 rounded-xl shadow-md">
            <button
              onClick={() => setActiveTab('inventory')}
              className={`flex-1 py-3 px-4 text-sm font-semibold rounded-lg transition-all duration-200 flex items-center justify-center ${
                activeTab === 'inventory'
                  ? 'bg-gradient-to-r from-purple-600 to-purple-700 text-white shadow-lg transform scale-105'
                  : 'text-gray-600 hover:bg-gray-100'
              }`}
            >
              <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
              </svg>
              Inventory
            </button>
            <button
              onClick={() => setActiveTab('emergency')}
              className={`flex-1 py-3 px-4 text-sm font-semibold rounded-lg transition-all duration-200 flex items-center justify-center ${
                activeTab === 'emergency'
                  ? 'bg-gradient-to-r from-red-600 to-red-700 text-white shadow-lg transform scale-105'
                  : 'text-gray-600 hover:bg-gray-100'
              }`}
            >
              <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
              Emergency
            </button>
            <button
              onClick={() => setActiveTab('demand')}
              className={`flex-1 py-3 px-4 text-sm font-semibold rounded-lg transition-all duration-200 flex items-center justify-center ${
                activeTab === 'demand'
                  ? 'bg-gradient-to-r from-green-600 to-green-700 text-white shadow-lg transform scale-105'
                  : 'text-gray-600 hover:bg-gray-100'
              }`}
            >
              <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
              </svg>
              Demand
            </button>
          </div>
        </div>

        {/* Inventory Tab */}
        {activeTab === 'inventory' && (
          <>
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-2xl font-bold text-gray-800 flex items-center">
                <svg className="w-7 h-7 mr-2 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
                </svg>
                Warehouse Inventory
              </h2>
              <div className="flex items-center space-x-4">
                <button
                  onClick={handleAddStock}
                  className="px-6 py-2.5 bg-gradient-to-r from-purple-600 to-purple-700 text-white font-semibold rounded-xl hover:from-purple-700 hover:to-purple-800 transition-all shadow-md flex items-center"
                >
                  <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                  </svg>
                  Add Stock
                </button>
                <div className="relative">
                  <input
                    type="text"
                    value={stockSearchQuery}
                    onChange={handleStockSearch}
                    placeholder="Search medicines, batch number..."
                    className="w-80 px-10 py-2.5 text-sm border-2 border-gray-200 rounded-xl focus:ring-2 focus:ring-purple-500 focus:border-purple-500 focus:outline-none transition-all"
                  />
                  <svg
                    className="w-5 h-5 absolute left-3 top-3 text-gray-400"
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
              </div>
            </div>

            {expiredMedicines.length > 0 && (
              <div className="mb-6 bg-red-50 border-l-4 border-red-500 p-4 rounded-lg">
                <div className="flex items-center">
                  <svg className="w-6 h-6 text-red-500 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                  </svg>
                  <p className="text-red-800 font-semibold">
                    Alert: {expiredMedicines.length} item(s) have expired!
                  </p>
                </div>
              </div>
            )}

            {nearExpiryMedicines.length > 0 && (
              <div className="mb-6 bg-orange-50 border-l-4 border-orange-500 p-4 rounded-lg">
                <div className="flex items-center">
                  <svg className="w-6 h-6 text-orange-500 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <p className="text-orange-800 font-semibold">
                    Warning: {nearExpiryMedicines.length} item(s) expiring within 90 days!
                  </p>
                </div>
              </div>
            )}

            <div className="bg-white shadow-xl rounded-2xl overflow-hidden border border-gray-100">
              <div className="overflow-x-auto">
                <table className="min-w-full bg-white">
                  <thead>
                    <tr className="bg-gradient-to-r from-purple-600 to-purple-700 text-white">
                      <th className="px-6 py-4 text-left text-sm font-bold">Medicine Name</th>
                      <th className="px-6 py-4 text-left text-sm font-bold">Generic</th>
                      <th className="px-6 py-4 text-left text-sm font-bold">Batch Number</th>
                      <th className="px-6 py-4 text-left text-sm font-bold">Quantity</th>
                      <th className="px-6 py-4 text-left text-sm font-bold">Price/Unit</th>
                      <th className="px-6 py-4 text-left text-sm font-bold">Expiry Date</th>
                      <th className="px-6 py-4 text-left text-sm font-bold">Status</th>
                      <th className="px-6 py-4 text-left text-sm font-bold">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredStocks.map((stock, index) => {
                      const expiryDate = new Date(stock.expiry_date);
                      const currentDate = new Date();
                      const isExpired = expiryDate <= currentDate;
                      const daysUntilExpiry = Math.floor((expiryDate - currentDate) / (1000 * 60 * 60 * 24));
                      const isNearExpiry = daysUntilExpiry > 0 && daysUntilExpiry <= 30;

                      return (
                        <tr
                          key={stock.stock_id}
                          className={`border-b transition-colors duration-150 ${
                            index % 2 === 0 ? 'bg-gray-50' : 'bg-white'
                          } hover:bg-purple-50`}
                        >
                          <td className="px-6 py-4">
                            <div>
                              <p className="text-gray-900 font-semibold">{stock.medicine_name}</p>
                              <p className="text-gray-500 text-xs">{stock.dosage} {stock.unit_type}</p>
                            </div>
                          </td>
                          <td className="px-6 py-4 text-gray-700">{stock.generic_name || 'N/A'}</td>
                          <td className="px-6 py-4">
                            <span className="px-3 py-1 bg-purple-100 text-purple-700 rounded-full text-xs font-medium">
                              {stock.batch_number}
                            </span>
                          </td>
                          <td className="px-6 py-4">
                            <span className={`font-bold ${stock.quantity < 50 ? 'text-red-600' : 'text-gray-900'}`}>
                              {stock.quantity}
                            </span>
                          </td>
                          <td className="px-6 py-4 text-gray-700 font-medium">₹{parseFloat(stock.price_per_unit).toFixed(2)}</td>
                          <td className="px-6 py-4">
                            <span className={`text-sm ${isExpired ? 'text-red-600 font-bold' : isNearExpiry ? 'text-orange-600 font-semibold' : 'text-gray-700'}`}>
                              {new Date(stock.expiry_date).toLocaleDateString()}
                            </span>
                          </td>
                          <td className="px-6 py-4">
                            {isExpired ? (
                              <span className="px-3 py-1 bg-red-100 text-red-800 rounded-full text-xs font-semibold">
                                Expired
                              </span>
                            ) : isNearExpiry ? (
                              <span className="px-3 py-1 bg-orange-100 text-orange-800 rounded-full text-xs font-semibold">
                                Near Expiry
                              </span>
                            ) : (
                              <span className="px-3 py-1 bg-green-100 text-green-800 rounded-full text-xs font-semibold">
                                Active
                              </span>
                            )}
                          </td>
                          <td className="px-6 py-4">
                            <div className="flex space-x-2">
                              <button
                                onClick={() => handleEditStock(stock)}
                                className="px-3 py-1.5 bg-blue-600 text-white text-xs font-semibold rounded-lg hover:bg-blue-700 transition-colors"
                              >
                                Edit
                              </button>
                              <button
                                onClick={() => handleRemoveStock(stock.stock_id)}
                                className="px-3 py-1.5 bg-red-600 text-white text-xs font-semibold rounded-lg hover:bg-red-700 transition-colors"
                              >
                                Delete
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                {filteredStocks.length === 0 && (
                  <div className="text-center py-12">
                    <svg className="w-16 h-16 text-gray-300 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
                    </svg>
                    <p className="text-gray-500 text-lg">No stock items found</p>
                  </div>
                )}
              </div>
            </div>
          </>
        )}

        {/* Emergency Requests Tab */}
        {activeTab === 'emergency' && (
          <>
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-2xl font-bold text-gray-800 flex items-center">
                <svg className="w-7 h-7 mr-2 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
                Emergency Requests
              </h2>
              <div className="relative">
                <input
                  type="text"
                  value={searchQuery}
                  onChange={handleSearch}
                  placeholder="Search by Request ID or Pharmacy"
                  className="w-80 px-10 py-2.5 text-sm border-2 border-gray-200 rounded-xl focus:ring-2 focus:ring-red-500 focus:border-red-500 focus:outline-none transition-all"
                />
                <svg
                  className="w-5 h-5 absolute left-3 top-3 text-gray-400"
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
            </div>

            <div className="bg-white shadow-xl rounded-2xl overflow-hidden border border-gray-100">
              <div className="overflow-x-auto">
                <table className="min-w-full bg-white">
                  <thead>
                    <tr className="bg-gradient-to-r from-red-600 to-red-700 text-white">
                      <th className="px-6 py-4 text-left text-sm font-bold">
                        Request ID
                      </th>
                      <th className="px-6 py-4 text-left text-sm font-bold">
                        Pharmacy Name
                      </th>
                      <th className="px-6 py-4 text-left text-sm font-bold">
                        Date Requested
                      </th>
                      <th className="px-6 py-4 text-left text-sm font-bold">
                        Status
                      </th>
                      <th className="px-6 py-4 text-left text-sm font-bold">
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredRequests.map((request, index) => (
                      <tr
                        key={request.requestId}
                        className={`border-b transition-colors duration-150 ${
                          index % 2 === 0 ? 'bg-gray-50' : 'bg-white'
                        } hover:bg-red-50`}
                      >
                        <td className="px-6 py-4 text-gray-700 font-bold">
                          {request.requestId}
                        </td>
                        <td className="px-6 py-4 text-gray-800 font-semibold">
                          {request.pharmacyName}
                        </td>
                        <td className="px-6 py-4 text-gray-700">
                          {new Date(request.dateRequested).toLocaleDateString()}
                        </td>
                        <td className="px-6 py-4">
                          <span
                            className={`px-3 py-1 text-xs font-medium rounded-full ${statusClasses[request.status]}`}
                          >
                            {statusLabels[request.status]}
                          </span>
                          {(request.status === "order_sent" || request.status === "order_successful") && request.accepting_pharmacy_name && (
                            <div className="mt-1">
                              <span className="text-sm text-gray-600">
                                Sent to: <span className="font-bold">{request.accepting_pharmacy_name}</span>
                              </span>
                            </div>
                          )}
                        </td>
                        <td className="px-6 py-4">
                          <button
                            onClick={() => handleViewRequest(request)}
                            className="px-4 py-2 text-sm font-semibold text-white bg-gradient-to-r from-red-600 to-red-700 rounded-lg hover:from-red-700 hover:to-red-800 transition-all shadow-md"
                          >
                            View Details
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}

        {/* Demand Requests Tab */}
        {activeTab === 'demand' && (
          <>
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-2xl font-bold text-gray-800 flex items-center">
                <svg className="w-7 h-7 mr-2 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                </svg>
                Demand Requests
              </h2>
              <div className="relative">
                <input
                  type="text"
                  value={demandSearchQuery}
                  onChange={handleDemandSearch}
                  placeholder="Search by Request ID or Pharmacy"
                  className="w-80 px-10 py-2.5 text-sm border-2 border-gray-200 rounded-xl focus:ring-2 focus:ring-green-500 focus:border-green-500 focus:outline-none transition-all"
                />
                <svg
                  className="w-5 h-5 absolute left-3 top-3 text-gray-400"
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
            </div>

            <div className="bg-white shadow-xl rounded-2xl overflow-hidden border border-gray-100">
              <div className="overflow-x-auto">
                <table className="min-w-full bg-white">
                  <thead>
                    <tr className="bg-gradient-to-r from-green-600 to-green-700 text-white">
                      <th className="px-6 py-4 text-left text-sm font-bold">
                        Request ID
                      </th>
                      <th className="px-6 py-4 text-left text-sm font-bold">
                        Pharmacy Name
                      </th>
                      <th className="px-6 py-4 text-left text-sm font-bold">
                        Date Requested
                      </th>
                      <th className="px-6 py-4 text-left text-sm font-bold">
                        Comments from Approver
                      </th>
                      <th className="px-6 py-4 text-left text-sm font-bold">
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredDemandRequests.map((request, index) => (
                      <tr
                        key={request.requestId}
                        className={`border-b transition-colors duration-150 ${
                          index % 2 === 0 ? 'bg-gray-50' : 'bg-white'
                        } hover:bg-green-50`}
                      >
                        <td className="px-6 py-4 text-gray-700 font-bold">
                          {request.requestId}
                        </td>
                        <td className="px-6 py-4 text-gray-800 font-semibold">
                          {request.pharmacyName}
                        </td>
                        <td className="px-6 py-4 text-gray-700">
                          {new Date(request.dateRequested).toLocaleDateString()}
                        </td>
                        <td className="px-6 py-4">
                          <span className="text-gray-700">
                            {request.commentsFromApprover || 'No comments'}
                          </span>
                        </td>
                        <td className="px-6 py-4">
                          <button
                            onClick={() => openDemandModal(request)}
                            className="px-4 py-2 text-sm font-semibold text-white bg-gradient-to-r from-green-600 to-green-700 rounded-lg hover:from-green-700 hover:to-green-800 transition-all shadow-md"
                          >
                            View Details
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}

        {/* Emergency Request Modal */}
        <Modal
          isOpen={isModalOpen}
          onRequestClose={closeModal}
          className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 bg-white p-6 rounded-2xl shadow-xl w-[600px]"
          overlayClassName="fixed inset-0 bg-black bg-opacity-50"
        >
          {selectedRequest && (
            <div>
              <h2 className="text-xl font-semibold text-purple-700 mb-4">
                Emergency Request Details
              </h2>
              <div className="mb-4 text-gray-700">
                <p><span className="font-semibold">Request ID:</span> {selectedRequest.requestId}</p>
                <p><span className="font-semibold">Pharmacy:</span> {selectedRequest.pharmacyName}</p>
                <p><span className="font-semibold">Date Requested:</span> {new Date(selectedRequest.dateRequested).toLocaleString()}</p>
                <p className="mb-3">
                  <span className="font-semibold">Status:</span>{" "}
                  <span
                    className={`px-2 py-1 text-xs font-semibold rounded-full ${statusClasses[selectedRequest.status]}`}
                  >
                    {statusLabels[selectedRequest.status]}
                  </span>
                  {(selectedRequest.status === "order_sent" || selectedRequest.status === "order_successful") && selectedRequest.accepting_pharmacy_name && (
                    <div className="mt-1">
                      <span className="text-sm text-gray-600">
                        Sent to: <span className="font-bold">{selectedRequest.accepting_pharmacy_name}</span>
                      </span>
                    </div>
                  )}
                </p>
              </div>

              <h3 className="font-semibold text-gray-800 mb-2">
                Requested Medicines:
              </h3>
              <div className="max-h-40 overflow-y-auto border border-gray-100 rounded-lg mb-4">
                <table className="min-w-full text-sm">
                  <thead className="bg-gray-100">
                    <tr>
                      <th className="px-3 py-2 text-left font-medium text-gray-600">Medicine</th>
                      <th className="px-3 py-2 text-left font-medium text-gray-600">Quantity</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {selectedRequest.medicines.map((medicine, i) => {
                      const genericName = medicine.generic_name || (medicine.generic_id ? getGenericName(medicine.generic_id) : null);
                      const displayName = medicine.name || genericName || 'Unknown';
                      const label = medicine.generic_id && !medicine.name ? `${displayName} (Generic)` : displayName;
                      return (
                        <tr key={i}>
                          <td className="px-3 py-2 text-gray-700">{label}</td>
                          <td className="px-3 py-2 text-gray-700">{medicine.quantity_requested}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div className="flex justify-end space-x-3">
                <button
                  onClick={closeModal}
                  className="px-4 py-2 bg-purple-100 text-purple-700 rounded-lg hover:bg-purple-200 transition-colors"
                >
                  Close
                </button>
              </div>
            </div>
          )}
        </Modal>

        {/* Demand Request Modal */}
        <Modal
          isOpen={isDemandModalOpen}
          onRequestClose={closeDemandModal}
          className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 bg-white p-6 rounded-2xl shadow-xl w-[600px]"
          overlayClassName="fixed inset-0 bg-black bg-opacity-50"
        >
          {selectedDemandRequest && (
            <div>
              <h2 className="text-xl font-semibold text-green-700 mb-4">
                Demand Request Details
              </h2>
              <div className="mb-4 text-gray-700">
                <p><span className="font-semibold">Request ID:</span> {selectedDemandRequest.requestId}</p>
                <p><span className="font-semibold">Pharmacy:</span> {selectedDemandRequest.pharmacyName}</p>
                <p><span className="font-semibold">Date Requested:</span> {new Date(selectedDemandRequest.dateRequested).toLocaleString()}</p>
                {selectedDemandRequest.commentsFromApprover && (
                  <p className="mb-3">
                    <span className="font-semibold">Comments from Approver:</span> {selectedDemandRequest.commentsFromApprover}
                  </p>
                )}
                <p><span className="font-semibold">Total Items:</span> {selectedDemandRequest.items_count}</p>
                <p><span className="font-semibold">Total Quantity:</span> {selectedDemandRequest.total_quantity}</p>
                {selectedDemandRequest.remarks && (
                  <p><span className="font-semibold">Remarks:</span> {selectedDemandRequest.remarks}</p>
                )}
              </div>

              <h3 className="font-semibold text-gray-800 mb-2">
                Requested Medicines:
              </h3>
              <div className="max-h-40 overflow-y-auto border border-gray-100 rounded-lg mb-4">
                <table className="min-w-full text-sm">
                  <thead className="bg-gray-100">
                    <tr>
                      <th className="px-3 py-2 text-left font-medium text-gray-600">Medicine</th>
                      <th className="px-3 py-2 text-left font-medium text-gray-600">Dosage</th>
                      <th className="px-3 py-2 text-left font-medium text-gray-600">Quantity</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {selectedDemandRequest.medicines.map((medicine, i) => {
                      const genericName = medicine.generic_name || (medicine.generic_id ? getGenericName(medicine.generic_id) : null);
                      const displayName = medicine.name || genericName || 'Unknown';
                      const label = medicine.generic_id && !medicine.name ? `${displayName} (Generic)` : displayName;
                      return (
                        <tr key={i}>
                          <td className="px-3 py-2 text-gray-700">{label}</td>
                          <td className="px-3 py-2 text-gray-700">
                            {medicine.dosage ? `${medicine.dosage} ${medicine.unit || ''}` : 'N/A'}
                          </td>
                          <td className="px-3 py-2 text-gray-700">{medicine.quantity_requested}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div className="flex justify-end space-x-3">
                <button
                  onClick={closeDemandModal}
                  className="px-4 py-2 bg-green-100 text-green-700 rounded-lg hover:bg-green-200 transition-colors"
                >
                  Close
                </button>
              </div>
            </div>
          )}
        </Modal>

        {/* Stock Management Modal */}
        <Modal
          isOpen={isStockModalOpen}
          onRequestClose={handleStockModalClose}
          className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 bg-white p-6 rounded-2xl shadow-xl w-[600px] max-h-[90vh] overflow-y-auto"
          overlayClassName="fixed inset-0 bg-black bg-opacity-50"
        >
          <h2 className="text-2xl font-bold text-purple-700 mb-6">
            {isEditMode ? 'Edit Stock' : 'Add New Stock'}
          </h2>
          <form onSubmit={handleSubmitStock}>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">
                  Medicine *
                </label>
                <select
                  name="medicine_id"
                  value={newStock.medicine_id}
                  onChange={handleInputChange}
                  required
                  disabled={isEditMode}
                  className="w-full px-4 py-2.5 border-2 border-gray-200 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-500 focus:outline-none transition-all disabled:bg-gray-100 disabled:cursor-not-allowed"
                >
                  <option value="">Select Medicine</option>
                  {medicines.map(med => (
                    <option key={med.medicine_id} value={med.medicine_id}>
                      {med.medicine_name} - {med.dosage} {med.unit}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">
                  Batch Number *
                </label>
                <input
                  type="text"
                  name="batch_number"
                  value={newStock.batch_number}
                  onChange={handleInputChange}
                  required
                  className="w-full px-4 py-2.5 border-2 border-gray-200 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-500 focus:outline-none transition-all"
                  placeholder="Enter batch number"
                />
              </div>

              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">
                  Quantity *
                </label>
                <input
                  type="number"
                  name="quantity"
                  value={newStock.quantity}
                  onChange={handleInputChange}
                  required
                  min="1"
                  className="w-full px-4 py-2.5 border-2 border-gray-200 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-500 focus:outline-none transition-all"
                  placeholder="Enter quantity"
                />
              </div>

              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">
                  Price Per Unit (₹) *
                </label>
                <input
                  type="number"
                  name="price_per_unit"
                  value={newStock.price_per_unit}
                  onChange={handleInputChange}
                  required
                  step="0.01"
                  min="0"
                  className="w-full px-4 py-2.5 border-2 border-gray-200 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-500 focus:outline-none transition-all"
                  placeholder="Enter price per unit"
                />
              </div>

              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">
                  Expiry Date *
                </label>
                <input
                  type="date"
                  name="expiry_date"
                  value={newStock.expiry_date}
                  onChange={handleInputChange}
                  required
                  className="w-full px-4 py-2.5 border-2 border-gray-200 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-500 focus:outline-none transition-all"
                />
              </div>
            </div>

            <div className="flex justify-end space-x-3 mt-6">
              <button
                type="button"
                onClick={handleStockModalClose}
                className="px-6 py-2.5 bg-gray-200 text-gray-700 font-semibold rounded-lg hover:bg-gray-300 transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-6 py-2.5 bg-gradient-to-r from-purple-600 to-purple-700 text-white font-semibold rounded-lg hover:from-purple-700 hover:to-purple-800 transition-all shadow-md"
              >
                {isEditMode ? 'Update Stock' : 'Add Stock'}
              </button>
            </div>
          </form>
        </Modal>
      </main>
    </div>
  );
};

export default Warehouse;
