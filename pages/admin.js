import { useRouter } from "next/router";
import { useEffect, useState } from "react";
import Modal from "react-modal";
import { ToastContainer, toast } from "react-toastify";
import "react-toastify/dist/ReactToastify.css";
import useSSE from "../hooks/useSSE";

const Admin = ({ logout }) => {
  const router = useRouter();
  const [emergencyRequests, setEmergencyRequests] = useState([]);
  const [demandRequests, setDemandRequests] = useState([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [demandSearchQuery, setDemandSearchQuery] = useState("");
  const [filteredRequests, setFilteredRequests] = useState([]);
  const [filteredDemandRequests, setFilteredDemandRequests] = useState([]);
  const [selectedRequest, setSelectedRequest] = useState(null);
  const [selectedDemandRequest, setSelectedDemandRequest] = useState(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isDemandModalOpen, setIsDemandModalOpen] = useState(false);
  const [isApprovalModalOpen, setIsApprovalModalOpen] = useState(false);
  const [approvalAction, setApprovalAction] = useState(''); // 'approve' or 'reject'
  const [approvalRequestId, setApprovalRequestId] = useState(null);
  const [approvalComments, setApprovalComments] = useState('');
  const [processingRequest, setProcessingRequest] = useState(null); // Track which request is being processed
  const [generics, setGenerics] = useState([]);
  const [activeTab, setActiveTab] = useState('emergency'); // Track active tab
  const [cmoId, setCmoId] = useState(null);
  const [autoApprovalEnabled, setAutoApprovalEnabled] = useState(false);
  const [togglingAutoApproval, setTogglingAutoApproval] = useState(false);

  // Real-time updates via SSE — CMO receives all events
  // No useCallback needed — useSSE stores onEvent in a ref, so it always
  // calls the latest version without re-opening the EventSource connection.
  const handleSSEEvent = (event) => {
    const t = event.type;
    if (t.startsWith('emergency:') || t.startsWith('demand:') || t.startsWith('warehouse:')) {
      fetchEmergencyRequests();
      fetchDemandRequests();
      toast.info(`Update: ${t.replace(':', ' ').replace(/^\w/, c => c.toUpperCase())}`, { autoClose: 3000 });
    }
  };

  useSSE({ role: 'cmo', id: cmoId, onEvent: handleSSEEvent });

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
    // fetch generics for display fallbacks
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

  useEffect(() => {
    // Get CMO ID from router query
    if (router.query.cmo_id) {
      const cmoIdValue = Number(router.query.cmo_id);
      setCmoId(cmoIdValue);
      fetchCMOPreference(cmoIdValue);
    }
  }, [router.query.cmo_id]);

  const fetchDemandRequests = async () => {
    try {
      const response = await fetch("/api/fetchAllDemandRequests");
      const data = await response.json();

      if (data.success && Array.isArray(data.requests)) {
        const formattedRequests = data.requests.map((request) => ({
          ...request,
          requestId: request.request_id,
          pharmacyId: request.pharmacy_id,
          pharmacyName: request.pharmacy_name,
          dateRequested: request.request_date,
          status: request.status,
          remarks: request.remarks,
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
      const response = await fetch("/api/fetchAllEmergencyRequests");
      const data = await response.json();

      if (data.success && Array.isArray(data.requests)) {
        const formattedRequests = data.requests.map((request) => ({
          ...request,
          requestId: request.request_id,
          pharmacyId: request.pharmacy_id, // include pharmacy id
          pharmacyName: request.pharmacy_name,
          acceptingPharmacyId: request.accepting_pharmacy_id,
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

  const fetchCMOPreference = async (cmoId) => {
    try {
      const response = await fetch(`/api/getCMOPreference?cmo_id=${cmoId}`);
      const data = await response.json();
      
      if (data.success) {
        setAutoApprovalEnabled(data.auto_approval_enabled || false);
      } else {
        console.error('Failed to fetch CMO preference:', data.message);
        // Default to false if fetch fails
        setAutoApprovalEnabled(false);
      }
    } catch (error) {
      console.error('Error fetching CMO preference:', error);
      // Default to false if fetch fails
      setAutoApprovalEnabled(false);
    }
  };

  const toggleAutoApproval = async () => {
    if (!cmoId) {
      toast.error('❌ CMO ID not found. Please try logging in again.', { autoClose: 5000 });
      console.log('Debug: cmoId =', cmoId, 'localStorage cmo_id =', localStorage.getItem('cmo_id'));
      return;
    }

    setTogglingAutoApproval(true);
    try {
      const response = await fetch('/api/toggleCMOAutoApproval', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          cmo_id: cmoId,
          auto_approval_enabled: !autoApprovalEnabled
        })
      });

      const data = await response.json();

      if (data.success) {
        setAutoApprovalEnabled(!autoApprovalEnabled);
        toast.success(
          `✅ Auto-approval ${!autoApprovalEnabled ? 'enabled' : 'disabled'}`,
          { autoClose: 3000 }
        );
      } else {
        toast.error(data.message || 'Failed to update preference', { autoClose: 4000 });
      }
    } catch (error) {
      console.error('Error toggling auto-approval:', error);
      toast.error('Error updating preference', { autoClose: 4000 });
    } finally {
      setTogglingAutoApproval(false);
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

  const openApprovalModal = (requestId, action) => {
    setApprovalRequestId(requestId);
    setApprovalAction(action);
    setApprovalComments('');
    setIsApprovalModalOpen(true);
  };

  const closeApprovalModal = () => {
    setApprovalRequestId(null);
    setApprovalAction('');
    setApprovalComments('');
    setIsApprovalModalOpen(false);
  };

  const handleRejectDemandRequest = async (requestId, action, remarks = "") => {
    try {
      setProcessingRequest(requestId);

      const response = await fetch('/api/rejectDemandRequest', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          requestId: requestId,
          action: action,
          remarks: remarks
        }),
      });

      const data = await response.json();

      if (data.success) {
        toast.success(data.message);
        // Refresh the demand requests list
        fetchDemandRequests();
        // Close modal if open
        if (isDemandModalOpen) {
          closeDemandModal();
        }
      } else {
        toast.error(data.message || `Failed to ${action} demand request`);
      }
    } catch (error) {
      console.error(`Error ${action}ing demand request:`, error);
      toast.error(`Error ${action}ing demand request`);
    } finally {
      setProcessingRequest(null);
    }
  };

  const handleRejectRequest = async (requestId, action, remarks = "") => {
    try {
      setProcessingRequest(requestId);

      const response = await fetch('/api/rejectEmergencyRequest', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          requestId: requestId,
          action: action,
          remarks: remarks
        }),
      });

      const data = await response.json();

      if (data.success) {
        toast.success(data.message);
        // Refresh the emergency requests list
        fetchEmergencyRequests();
        // Close modal if open
        if (isModalOpen) {
          closeModal();
        }
      } else {
        toast.error(data.message || `Failed to ${action} request`);
      }
    } catch (error) {
      console.error(`Error ${action}ing request:`, error);
      toast.error(`Error ${action}ing emergency request`);
    } finally {
      setProcessingRequest(null);
    }
  };

  const navigateToPharmacySearch = () => {
    router.push("/pharmacySearch");
  };

  const navigateToDemandPharmacySearch = () => {
    router.push("/demandPharmacySearch");
  };

  // Status styling configuration
  const statusClasses = {
    "pending_approval_from_cmo": "bg-yellow-100 text-yellow-800",
    "order_sent": "bg-blue-100 text-blue-800",
    "order_successful": "bg-green-100 text-green-800",
    "rejected": "bg-red-100 text-red-800",
    // Demand request statuses
    "pending": "bg-yellow-100 text-yellow-800",
    "approved": "bg-green-100 text-green-800"
  };

  const statusLabels = {
    "pending_approval_from_cmo": "Pending CMO Approval",
    "order_sent": "Order Sent",
    "order_successful": "Order Successful",
    "rejected": "Rejected",
    // Demand request labels
    "pending": "Pending",
    "approved": "Approved"
  };

  const getGenericName = (genericId) => {
    if (!genericId) return null;
    const g = generics.find(x => String(x.generic_id) === String(genericId) || String(x.id) === String(genericId));
    return g ? (g.generic_name || g.name) : null;
  };

  // Handle functions for table actions
  const handleViewRequest = (request) => {
    openModal(request);
  };

  const handleApproveDemandRequest = async (requestId) => {
    openApprovalModal(requestId, 'approve');
  };

  const handleRejectDemandRequestAction = async (requestId) => {
    openApprovalModal(requestId, 'reject');
  };

  const submitApprovalAction = async () => {
    if (!approvalComments.trim()) {
      toast.error('Please provide comments before proceeding');
      return;
    }

    setProcessingRequest(approvalRequestId);
    try {
      const response = await fetch("/api/respondToDemandRequest", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          requestId: approvalRequestId,
          action: approvalAction,
          comments: approvalComments
        }),
      });

      const data = await response.json();
      if (data.success) {
        toast.success(`Demand request ${approvalAction}d successfully!`);
        fetchDemandRequests();
        closeApprovalModal();
        if (isDemandModalOpen) {
          closeDemandModal();
        }
      } else {
        toast.error(data.message || `Failed to ${approvalAction} demand request`);
      }
    } catch (error) {
      console.error(`Error ${approvalAction}ing demand request:`, error);
      toast.error(`Error ${approvalAction}ing demand request`);
    } finally {
      setProcessingRequest(null);
    }
  };

  const handleApproveRequest = async (requestId) => {
    setProcessingRequest(requestId);
    try {
      const response = await fetch("/api/respondToEmergencyRequest", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          requestId,
          action: "approve"
        }),
      });

      const data = await response.json();
      if (data.success) {
        toast.success("Request approved successfully!");
        fetchEmergencyRequests();
      } else {
        toast.error(data.message || "Failed to approve request");
      }
    } catch (error) {
      console.error("Error approving request:", error);
      toast.error("Error approving request");
    } finally {
      setProcessingRequest(null);
    }
  };

  return (
    <div className="flex bg-gray-100 min-h-screen">
      <ToastContainer position="top-center" autoClose={1500} hideProgressBar />

      {/* Sidebar */}
      <aside className="flex flex-col w-64 px-4 py-8 bg-white shadow-lg">
        <div className="mb-4">
          <h2 className="text-2xl font-bold text-indigo-700">CMO Dashboard</h2>
        </div>

        {/* Notifications will appear below the sidebar buttons */}

        <nav className="space-y-3">
          <button
            onClick={() => router.push('/demandAnalytics')}
            className="flex items-center w-full px-4 py-3 text-left text-white bg-purple-600 rounded-lg shadow-md hover:bg-purple-500 transition-colors duration-200"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2" viewBox="0 0 20 20" fill="currentColor">
              <path d="M2 11a1 1 0 011-1h2a1 1 0 011 1v5a1 1 0 01-1 1H3a1 1 0 01-1-1v-5zM8 7a1 1 0 011-1h2a1 1 0 011 1v9a1 1 0 01-1 1H9a1 1 0 01-1-1V7zM14 4a1 1 0 011-1h2a1 1 0 011 1v12a1 1 0 01-1 1h-2a1 1 0 01-1-1V4z" />
            </svg>
            <span className="font-medium">Demand Analytics</span>
          </button>

          <button
            onClick={() => router.push('/pharmacyDirectory')}
            className="flex items-center w-full px-4 py-3 text-left text-white bg-green-600 rounded-lg shadow-md hover:bg-green-500 transition-colors duration-200"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2" viewBox="0 0 20 20" fill="currentColor">
              <path d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
            </svg>
            <span className="font-medium">Pharmacy Directory</span>
          </button>

          <button
            onClick={() => router.push(`/batchMonitor?cmo_id=${router.query.cmo_id}`)}
            className="flex items-center w-full px-4 py-3 text-left text-white bg-red-700 rounded-lg shadow-md hover:bg-red-600 transition-colors duration-200"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
            </svg>
            <span className="font-medium">Batch Quality Monitor</span>
          </button>

          <button
            onClick={() => router.push(`/cmoAnalytics?cmo_id=${router.query.cmo_id}`)}
            className="flex items-center w-full px-4 py-3 text-left text-white bg-indigo-600 rounded-lg shadow-md hover:bg-indigo-500 transition-colors duration-200"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2" viewBox="0 0 20 20" fill="currentColor">
              <path d="M2 11a1 1 0 011-1h2a1 1 0 011 1v5a1 1 0 01-1 1H3a1 1 0 01-1-1v-5zM8 7a1 1 0 011-1h2a1 1 0 011 1v9a1 1 0 01-1 1H9a1 1 0 01-1-1V7zM14 4a1 1 0 011-1h2a1 1 0 011 1v12a1 1 0 01-1 1h-2a1 1 0 01-1-1V4z" />
            </svg>
            <span className="font-medium">Analytics Dashboard</span>
          </button>

          <button
            onClick={() => router.push(`/auditLog?cmo_id=${router.query.cmo_id}`)}
            className="flex items-center w-full px-4 py-3 text-left text-white bg-yellow-600 rounded-lg shadow-md hover:bg-yellow-500 transition-colors duration-200"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M3 4a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm0 4a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm0 4a1 1 0 011-1h7a1 1 0 110 2H4a1 1 0 01-1-1zm0 4a1 1 0 011-1h4a1 1 0 110 2H4a1 1 0 01-1-1z" clipRule="evenodd" />
            </svg>
            <span className="font-medium">Audit Log</span>
          </button>

          <button
            onClick={logout}
            className="flex items-center w-full px-4 py-3 text-left text-white bg-gray-600 rounded-lg shadow-md hover:bg-gray-500 transition-colors duration-200"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M3 3a1 1 0 011 1v12a1 1 0 11-2 0V4a1 1 0 011-1zm7.707 3.293a1 1 0 010 1.414L9.414 9H17a1 1 0 110 2H9.414l1.293 1.293a1 1 0 01-1.414 1.414l-3-3a1 1 0 010-1.414l3-3a1 1 0 011.414 0z" clipRule="evenodd" />
            </svg>
            <span className="font-medium">Logout</span>
          </button>
        </nav>
        {/* Notifications: requests awaiting CMO approval (red, larger, below buttons) */}
        <div className="mt-6 p-3 rounded border border-red-200 bg-red-50">
          <h3 className="text-lg font-semibold text-red-800">Address these requests ASAP</h3>
          <p className="text-sm text-red-700 mt-1">Requests awaiting your approval</p>
          <ul className="mt-3 space-y-2 max-h-48 overflow-auto">
            {emergencyRequests.filter(r => r.status === 'pending_approval_from_cmo').slice(0,10).map((r) => (
              <li key={`e-${r.requestId}`} className="flex items-center justify-between">
                <div className="text-sm text-red-900">
                  <div className="font-medium">Emergency #{r.requestId}</div>
                  <div className="text-xs">{r.pharmacyName || `Pharmacy #${r.pharmacyId}`}</div>
                </div>
                <button onClick={() => openModal(r)} className="ml-2 text-sm text-white bg-red-700 px-3 py-1 rounded">Open</button>
              </li>
            ))}
            {demandRequests.filter(r => r.status === 'pending').slice(0,10).map((r) => (
              <li key={`d-${r.requestId}`} className="flex items-center justify-between">
                <div className="text-sm text-red-900">
                  <div className="font-medium">Demand #{r.requestId}</div>
                  <div className="text-xs">{r.pharmacyName || `Pharmacy #${r.pharmacyId}`}</div>
                </div>
                <button onClick={() => openDemandModal(r)} className="ml-2 text-sm text-white bg-red-700 px-3 py-1 rounded">Open</button>
              </li>
            ))}
            {emergencyRequests.filter(r=>r.status==='pending_approval_from_cmo').length===0 && demandRequests.filter(r=>r.status==='pending').length===0 && (
              <li className="text-sm text-red-900">No pending requests</li>
            )}
          </ul>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 p-6 bg-gray-50">
        <div className="flex justify-between items-center mb-8">
          <h1 className="text-3xl font-bold text-gray-900">
            CMO Dashboard
          </h1>
          
          {/* Auto-Approval Toggle */}
          <div className="flex items-center space-x-3">
            <div className="text-sm font-medium text-gray-700">
              Auto-Approval {autoApprovalEnabled ? '✅ ON' : '⭕ OFF'}
            </div>
            <button
              onClick={toggleAutoApproval}
              disabled={togglingAutoApproval}
              className={`relative inline-flex h-8 w-16 items-center rounded-full transition-colors ${
                autoApprovalEnabled
                  ? 'bg-green-600 hover:bg-green-700'
                  : 'bg-gray-300 hover:bg-gray-400'
              } ${togglingAutoApproval ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
            >
              <span
                className={`inline-block h-6 w-6 transform rounded-full bg-white shadow-lg transition-transform ${
                  autoApprovalEnabled ? 'translate-x-9' : 'translate-x-1'
                }`}
              />
            </button>
          </div>
        </div>

        {/* Tab Navigation */}
        <div className="mb-6">
          <div className="flex space-x-1 bg-gray-100 p-1 rounded-lg">
            <button
              onClick={() => setActiveTab('emergency')}
              className={`flex-1 py-2 px-4 text-sm font-medium rounded-md transition-colors duration-200 ${
                activeTab === 'emergency'
                  ? 'bg-white text-indigo-700 shadow-sm'
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              Emergency Requests
            </button>
            <button
              onClick={() => setActiveTab('demand')}
              className={`flex-1 py-2 px-4 text-sm font-medium rounded-md transition-colors duration-200 ${
                activeTab === 'demand'
                  ? 'bg-white text-indigo-700 shadow-sm'
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              Demand Requests
            </button>
          </div>
        </div>

        {/* Emergency Requests Tab */}
        {activeTab === 'emergency' && (
          <>
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-xl font-semibold text-gray-800">Emergency Requests</h2>
              <div className="relative">
                <input
                  type="text"
                  value={searchQuery}
                  onChange={handleSearch}
                  placeholder="Search by Request ID or Pharmacy"
                  className="w-80 px-10 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 focus:outline-none"
                />
                <svg
                  className="w-5 h-5 absolute left-3 top-2.5 text-gray-400"
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

            <div className="bg-white shadow-md rounded-lg overflow-hidden">
              <div className="overflow-x-auto">
                <table className="min-w-full bg-white rounded-lg">
                  <thead>
                    <tr className="bg-indigo-50">
                      <th className="px-4 py-3 text-left text-indigo-700 font-medium">
                        Request ID
                      </th>
                      <th className="px-4 py-3 text-left text-indigo-700 font-medium">
                        Pharmacy Name
                      </th>
                      <th className="px-4 py-3 text-left text-indigo-700 font-medium">
                        Date Requested
                      </th>
                      <th className="px-4 py-3 text-left text-indigo-700 font-medium">
                        Status
                      </th>
                      <th className="px-4 py-3 text-left text-indigo-700 font-medium">
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredRequests.map((request) => (
                      <tr
                        key={request.requestId}
                        className="border-b hover:bg-indigo-50 transition-colors duration-150"
                      >
                        <td className="px-4 py-3 text-gray-700 font-medium">
                          {request.requestId}
                        </td>
                        <td className="px-4 py-3 text-gray-700">
                          {request.pharmacyName}
                        </td>
                        <td className="px-4 py-3 text-gray-700">
                          {new Date(request.dateRequested).toLocaleDateString()}
                        </td>
                        <td className="px-4 py-3">
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
                        <td className="px-4 py-3">
                          <div className="flex space-x-2">
                            <button
                              onClick={() => handleViewRequest(request)}
                              className="px-3 py-1 text-sm font-medium text-indigo-600 bg-indigo-100 rounded-lg hover:bg-indigo-200 transition-colors"
                            >
                              View
                            </button>
                            {(request.status === "pending_approval_from_cmo" || request.status === "rejected") && (
                              <button
                                onClick={() => handleRejectRequest(
                                  request.requestId, 
                                  request.status === "rejected" ? "revoke" : "reject"
                                )}
                                disabled={processingRequest === request.requestId}
                                className={`px-3 py-1 text-sm font-medium text-white rounded-lg transition-colors ${
                                  processingRequest === request.requestId
                                    ? 'bg-gray-400 cursor-not-allowed'
                                    : request.status === "rejected"
                                    ? 'bg-green-600 hover:bg-green-700'
                                    : 'bg-red-600 hover:bg-red-700'
                                }`}
                              >
                                {processingRequest === request.requestId ? (
                                  "Processing..."
                                ) : request.status === "rejected" ? (
                                  "Revoke"
                                ) : (
                                  "Reject"
                                )}
                              </button>
                            )}
                          </div>
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
              <h2 className="text-xl font-semibold text-gray-800">Demand Requests</h2>
              <div className="relative">
                <input
                  type="text"
                  value={demandSearchQuery}
                  onChange={handleDemandSearch}
                  placeholder="Search by Request ID or Pharmacy"
                  className="w-80 px-10 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 focus:outline-none"
                />
                <svg
                  className="w-5 h-5 absolute left-3 top-2.5 text-gray-400"
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

            <div className="bg-white shadow-md rounded-lg overflow-hidden">
              <div className="overflow-x-auto">
                <table className="min-w-full bg-white rounded-lg">
                  <thead>
                    <tr className="bg-green-50">
                      <th className="px-4 py-3 text-left text-green-700 font-medium">
                        Request ID
                      </th>
                      <th className="px-4 py-3 text-left text-green-700 font-medium">
                        Pharmacy Name
                      </th>
                      <th className="px-4 py-3 text-left text-green-700 font-medium">
                        Date Requested
                      </th>
                      <th className="px-4 py-3 text-left text-green-700 font-medium">
                        Status
                      </th>
                      <th className="px-4 py-3 text-left text-green-700 font-medium">
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredDemandRequests.map((request) => (
                      <tr
                        key={request.requestId}
                        className="border-b hover:bg-green-50 transition-colors duration-150"
                      >
                        <td className="px-4 py-3 text-gray-700 font-medium">
                          {request.requestId}
                        </td>
                        <td className="px-4 py-3 text-gray-700">
                          {request.pharmacyName}
                        </td>
                        <td className="px-4 py-3 text-gray-700">
                          {new Date(request.dateRequested).toLocaleDateString()}
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={`px-3 py-1 text-xs font-medium rounded-full ${statusClasses[request.status]}`}
                          >
                            {statusLabels[request.status]}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex space-x-2">
                            <button
                              onClick={() => openDemandModal(request)}
                              className="px-3 py-1 text-sm font-medium text-green-600 bg-green-100 rounded-lg hover:bg-green-200 transition-colors"
                            >
                              View
                            </button>
                            {request.status === "pending" && (
                              <>
                                <button
                                  onClick={() => handleApproveDemandRequest(request.requestId)}
                                  disabled={processingRequest === request.requestId}
                                  className={`px-3 py-1 text-sm font-medium text-white rounded-lg transition-colors ${
                                    processingRequest === request.requestId
                                      ? 'bg-gray-400 cursor-not-allowed'
                                      : 'bg-green-600 hover:bg-green-700'
                                  }`}
                                >
                                  {processingRequest === request.requestId ? "Processing..." : "Approve"}
                                </button>
                                <button
                                  onClick={() => handleRejectDemandRequestAction(request.requestId)}
                                  disabled={processingRequest === request.requestId}
                                  className={`px-3 py-1 text-sm font-medium text-white rounded-lg transition-colors ${
                                    processingRequest === request.requestId
                                      ? 'bg-gray-400 cursor-not-allowed'
                                      : 'bg-red-600 hover:bg-red-700'
                                  }`}
                                >
                                  {processingRequest === request.requestId ? "Processing..." : "Reject"}
                                </button>
                              </>
                            )}
                            {request.status === "rejected" && (
                              <button
                                onClick={() => handleRejectDemandRequest(request.requestId, "revoke")}
                                disabled={processingRequest === request.requestId}
                                className={`px-3 py-1 text-sm font-medium text-white rounded-lg transition-colors ${
                                  processingRequest === request.requestId
                                    ? 'bg-gray-400 cursor-not-allowed'
                                    : 'bg-green-600 hover:bg-green-700'
                                }`}
                              >
                                {processingRequest === request.requestId ? "Processing..." : "Revoke"}
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}

        {/* Modal */}
        <Modal
          isOpen={isModalOpen}
          onRequestClose={closeModal}
          className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 bg-white p-6 rounded-2xl shadow-xl w-[600px]"
          overlayClassName="fixed inset-0 bg-black bg-opacity-50"
        >
          {selectedRequest && (
            <div>
              <h2 className="text-xl font-semibold text-indigo-700 mb-4">
                Emergency Request Details
              </h2>
              <div className="mb-4 text-gray-700">
                <p><span className="font-semibold">Request ID:</span> {selectedRequest.requestId}</p>
                <p><span className="font-semibold">Pharmacy:</span> {selectedRequest.pharmacyName}</p>
                <p><span className="font-semibold">Date Requested:</span> {new Date(selectedRequest.dateRequested).toLocaleString()}</p>
                <p className="mb-3">
                  <span className="font-semibold">Status:</span>{" "}
                  <span
                    className={`px-2 py-1 text-xs font-semibold rounded-full ${
                      selectedRequest.status === "pending_approval_from_cmo"
                        ? "bg-yellow-100 text-yellow-800"
                        : selectedRequest.status === "order_sent"
                        ? "bg-blue-100 text-blue-800"
                        : selectedRequest.status === "order_successful"
                        ? "bg-green-100 text-green-800"
                        : selectedRequest.status === "rejected"
                        ? "bg-red-100 text-red-800"
                        : "bg-gray-100 text-gray-800"
                    }`}
                  >
                    {selectedRequest.status.replace(/_/g, ' ').toUpperCase()}
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
                {selectedRequest.status === "rejected" ? (
                  <button
                    disabled
                    className="px-4 py-2 bg-gray-400 text-gray-600 rounded-lg cursor-not-allowed"
                  >
                    Request Rejected
                  </button>
                ) : (selectedRequest.status === "order_sent" || selectedRequest.status === "order_successful") ? (
                  <button
                    disabled
                    className="px-4 py-2 bg-gray-400 text-gray-600 rounded-lg cursor-not-allowed"
                  >
                    Order Already Processed
                  </button>
                ) : (
                  <button
                    onClick={() => router.push(`/pharmacySearch?requestId=${selectedRequest.requestId}&pharmacyId=${selectedRequest.pharmacyId}`)}
                    className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700"
                  >
                    Search Pharmacy
                  </button>
                )}
                
                {/* Reject/Revoke Button in Modal */}
                {(selectedRequest.status === "pending_approval_from_cmo" || selectedRequest.status === "rejected") && (
                  <button
                    onClick={() => handleRejectRequest(
                      selectedRequest.requestId, 
                      selectedRequest.status === "rejected" ? "revoke" : "reject"
                    )}
                    disabled={processingRequest === selectedRequest.requestId}
                    className={`px-4 py-2 text-white rounded-lg transition-colors ${
                      processingRequest === selectedRequest.requestId
                        ? 'bg-gray-400 cursor-not-allowed'
                        : selectedRequest.status === "rejected"
                        ? 'bg-green-600 hover:bg-green-700'
                        : 'bg-red-600 hover:bg-red-700'
                    }`}
                  >
                    {processingRequest === selectedRequest.requestId ? (
                      "Processing..."
                    ) : selectedRequest.status === "rejected" ? (
                      "Revoke Rejection"
                    ) : (
                      "Reject Request"
                    )}
                  </button>
                )}
                
                <button
                  onClick={closeModal}
                  className="px-4 py-2 bg-indigo-100 text-indigo-700 rounded-lg hover:bg-indigo-200 transition-colors"
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
                <p className="mb-3">
                  <span className="font-semibold">Status:</span>{" "}
                  <span
                    className={`px-2 py-1 text-xs font-semibold rounded-full ${statusClasses[selectedDemandRequest.status]}`}
                  >
                    {statusLabels[selectedDemandRequest.status]}
                  </span>
                </p>
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
                {selectedDemandRequest.status === "pending" ? (
                  <>
                    <button
                      onClick={() => handleApproveDemandRequest(selectedDemandRequest.requestId)}
                      disabled={processingRequest === selectedDemandRequest.requestId}
                      className={`px-4 py-2 text-white rounded-lg transition-colors ${
                        processingRequest === selectedDemandRequest.requestId
                          ? 'bg-gray-400 cursor-not-allowed'
                          : 'bg-green-600 hover:bg-green-700'
                      }`}
                    >
                      {processingRequest === selectedDemandRequest.requestId ? "Processing..." : "Approve Request"}
                    </button>
                    <button
                      onClick={() => handleRejectDemandRequestAction(selectedDemandRequest.requestId)}
                      disabled={processingRequest === selectedDemandRequest.requestId}
                      className={`px-4 py-2 text-white rounded-lg transition-colors ${
                        processingRequest === selectedDemandRequest.requestId
                          ? 'bg-gray-400 cursor-not-allowed'
                          : 'bg-red-600 hover:bg-red-700'
                      }`}
                    >
                      {processingRequest === selectedDemandRequest.requestId ? "Processing..." : "Reject Request"}
                    </button>
                  </>
                ) : selectedDemandRequest.status === "approved" ? (
                  <button
                    disabled
                    className="px-4 py-2 bg-gray-400 text-gray-600 rounded-lg cursor-not-allowed"
                  >
                    Request Approved
                  </button>
                ) : selectedDemandRequest.status === "rejected" ? (
                  <button
                    onClick={() => handleRejectDemandRequest(selectedDemandRequest.requestId, "revoke")}
                    disabled={processingRequest === selectedDemandRequest.requestId}
                    className={`px-4 py-2 text-white rounded-lg transition-colors ${
                      processingRequest === selectedDemandRequest.requestId
                        ? 'bg-gray-400 cursor-not-allowed'
                        : 'bg-green-600 hover:bg-green-700'
                    }`}
                  >
                    {processingRequest === selectedDemandRequest.requestId ? "Processing..." : "Revoke Rejection"}
                  </button>
                ) : null}
                
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

        {/* Approval Modal for Demand Requests */}
        <Modal
          isOpen={isApprovalModalOpen}
          onRequestClose={closeApprovalModal}
          className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 bg-white p-6 rounded-2xl shadow-xl w-[500px]"
          overlayClassName="fixed inset-0 bg-black bg-opacity-50"
        >
          <div>
            <h2 className={`text-xl font-semibold mb-4 ${
              approvalAction === 'approve' ? 'text-green-700' : 'text-red-700'
            }`}>
              {approvalAction === 'approve' ? 'Approve' : 'Reject'} Demand Request
            </h2>
            
            <div className="mb-4">
              <p className="text-gray-700 mb-2">
                <span className="font-semibold">Request ID:</span> {approvalRequestId}
              </p>
              <p className="text-gray-600 text-sm mb-4">
                Please provide your comments for this {approvalAction === 'approve' ? 'approval' : 'rejection'}:
              </p>
            </div>

            <div className="mb-6">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Comments from CMO <span className="text-red-500">*</span>
              </label>
              <textarea
                value={approvalComments}
                onChange={(e) => setApprovalComments(e.target.value)}
                placeholder={`Enter your comments for ${approvalAction === 'approve' ? 'approving' : 'rejecting'} this request...`}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 focus:outline-none resize-none"
                rows="4"
                required
              />
              <p className="text-xs text-gray-500 mt-1">
                This comment will be visible to the pharmacy that made the request.
              </p>
            </div>

            <div className="flex justify-end space-x-3">
              <button
                onClick={closeApprovalModal}
                disabled={processingRequest === approvalRequestId}
                className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={submitApprovalAction}
                disabled={processingRequest === approvalRequestId || !approvalComments.trim()}
                className={`px-4 py-2 text-white rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                  approvalAction === 'approve'
                    ? 'bg-green-600 hover:bg-green-700'
                    : 'bg-red-600 hover:bg-red-700'
                }`}
              >
                {processingRequest === approvalRequestId 
                  ? 'Processing...' 
                  : `${approvalAction === 'approve' ? 'Approve' : 'Reject'} Request`
                }
              </button>
            </div>
          </div>
        </Modal>
      </main>
    </div>
  );
};

export default Admin;
