import { useRouter } from "next/router";
import { useEffect, useState } from "react";
import { ToastContainer, toast } from "react-toastify";
import "react-toastify/dist/ReactToastify.css";

const DemandForecast = ({ logout }) => {
  const router = useRouter();
  const { pharmacy_id } = router.query;
  const [forecastData, setForecastData] = useState([]);
  const [summary, setSummary] = useState({});
  const [loading, setLoading] = useState(false);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [orderItems, setOrderItems] = useState([]);
  const [isOrderModalOpen, setIsOrderModalOpen] = useState(false);
  const [orderRemarks, setOrderRemarks] = useState('');
  const [submittingOrder, setSubmittingOrder] = useState(false);
  const [demandRequests, setDemandRequests] = useState([]);
  const [loadingRequests, setLoadingRequests] = useState(false);
  const [selectedDemandRequest, setSelectedDemandRequest] = useState(null);
  const [isDemandRequestModalOpen, setIsDemandRequestModalOpen] = useState(false);
  const [autoOrderEnabled, setAutoOrderEnabled] = useState(false);
  const [loadingAutoOrderSetting, setLoadingAutoOrderSetting] = useState(false);

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
  }, []);

  const fetchDemandRequests = async () => {
    if (!pharmacy_id) return;
    
    try {
      setLoadingRequests(true);
      const response = await fetch(`/api/fetchDemandRequests?pharmacy_id=${pharmacy_id}`);
      const data = await response.json();

      if (data.success) {
        setDemandRequests(data.requests);
      } else {
        toast.error(data.message || "Failed to fetch demand requests");
      }
    } catch (error) {
      console.error("Error fetching demand requests:", error);
      toast.error("Error fetching demand requests");
    } finally {
      setLoadingRequests(false);
    }
  };

  const fetchDemandForecast = async () => {
    if (!pharmacy_id) return;
    
    try {
      setLoading(true);
      const response = await fetch(`/api/demandForecast?pharmacy_id=${pharmacy_id}`);
      const data = await response.json();

      if (data.success) {
        setForecastData(data.forecast);
        setSummary(data.summary);
        setLastUpdated(new Date());
        
        // Initialize order items for medicines that need restocking
        const itemsNeedingRestock = data.forecast
          .filter(item => item.stock_to_order > 0)
          .map(item => ({
            medicine_id: item.medicine_id,
            medicine_name: item.medicine_name || `Medicine ${item.medicine_id}`,
            dosage: item.dosage,
            unit: item.unit,
            predicted_demand: item.predicted_demand,
            current_stock: item.current_stock,
            recommended_quantity: item.stock_to_order,
            quantity: item.stock_to_order,
            selected: true
          }));
        
        setOrderItems(itemsNeedingRestock);
        toast.success("Demand forecast updated successfully!");
      } else {
        toast.error(data.error || "Failed to fetch demand forecast");
      }
    } catch (error) {
      console.error("Error fetching demand forecast:", error);
      toast.error("Error fetching demand forecast");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (pharmacy_id) {
      fetchDemandForecast();
      fetchDemandRequests();
      fetchAutoOrderSetting();
    }
  }, [pharmacy_id]);

  const handleOrderMedicine = (medicine) => {
    // Add single medicine to in-page order cart (or increment quantity)
    setOrderItems(prev => {
      const exists = prev.find(i => i.medicine_id === medicine.medicine_id);
      if (exists) {
        return prev.map(i => i.medicine_id === medicine.medicine_id ? { ...i, quantity: Math.max(1, (parseFloat(i.quantity) || 0) + Math.ceil(medicine.stock_to_order)) } : i);
      }

      const newItem = {
        medicine_id: medicine.medicine_id,
        medicine_name: medicine.medicine_name || `Medicine ${medicine.medicine_id}`,
        dosage: medicine.dosage,
        unit: medicine.unit,
        predicted_demand: medicine.predicted_demand || medicine.forecast_next_30_days || 0,
        current_stock: medicine.current_stock || 0,
        recommended_quantity: medicine.stock_to_order || Math.ceil(medicine.forecast_next_30_days || 0),
        quantity: Math.max(1, Math.ceil(medicine.stock_to_order || 1)),
        selected: true
      };

      return [newItem, ...prev];
    });
  };

  const handleRemoveOrderItem = (medicineId) => {
    setOrderItems(prev => prev.filter(i => i.medicine_id !== medicineId));
  };

  const handleBulkOrder = () => {
    setIsOrderModalOpen(true);
  };

  const handleQuantityChange = (medicineId, newQuantity) => {
    setOrderItems(prev => 
      prev.map(item => 
        item.medicine_id === medicineId 
          ? { ...item, quantity: Math.max(0, parseFloat(newQuantity) || 0) }
          : item
      )
    );
  };

  const handleItemSelection = (medicineId, selected) => {
    setOrderItems(prev => 
      prev.map(item => 
        item.medicine_id === medicineId 
          ? { ...item, selected }
          : item
      )
    );
  };

  const submitDemandRequest = async () => {
    const selectedItems = orderItems.filter(item => item.selected && item.quantity > 0);
    
    if (selectedItems.length === 0) {
      toast.error("Please select at least one item to order");
      return;
    }

    try {
      setSubmittingOrder(true);
      
      const response = await fetch('/api/createDemandRequest', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          pharmacy_id,
          remarks: orderRemarks || 'Time Series-based demand forecast order',
          items: selectedItems.map(item => ({
            medicine_id: item.medicine_id,
            quantity: item.quantity
          }))
        })
      });

      const data = await response.json();
      
      if (data.success) {
        toast.success(`Order request created successfully! Request ID: ${data.request_id}`);
        setIsOrderModalOpen(false);
        setOrderRemarks('');
        // Reset quantities to recommended amounts
        setOrderItems(prev => 
          prev.map(item => ({ ...item, quantity: item.recommended_quantity, selected: true }))
        );
        // Refresh demand requests list
        fetchDemandRequests();
      } else {
        toast.error(data.message || 'Failed to create order request');
      }
    } catch (error) {
      console.error('Error submitting order:', error);
      toast.error('Error submitting order request');
    } finally {
      setSubmittingOrder(false);
    }
  };

  const formatNumber = (num) => {
    return new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 }).format(num);
  };

  const handleViewDemandRequest = (request) => {
    setSelectedDemandRequest(request);
    setIsDemandRequestModalOpen(true);
  };

  const fetchAutoOrderSetting = async () => {
    if (!pharmacy_id) return;
    
    try {
      const response = await fetch(`/api/getAutoOrderSetting?pharmacy_id=${pharmacy_id}`);
      const data = await response.json();
      
      if (data.success) {
        setAutoOrderEnabled(data.auto_order_enabled || false);
      }
    } catch (error) {
      console.error("Error fetching auto order setting:", error);
    }
  };

  const toggleAutoOrder = async () => {
    try {
      setLoadingAutoOrderSetting(true);
      
      const response = await fetch('/api/updateAutoOrderSetting', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          pharmacy_id,
          auto_order_enabled: !autoOrderEnabled
        })
      });

      const data = await response.json();
      
      if (data.success) {
        setAutoOrderEnabled(!autoOrderEnabled);
        toast.success(
          !autoOrderEnabled 
            ? 'Auto-ordering enabled! Demand requests will be created automatically on the 1st of each month.'
            : 'Auto-ordering disabled. You can now create orders manually.'
        );
      } else {
        toast.error(data.message || 'Failed to update auto-order setting');
      }
    } catch (error) {
      console.error('Error updating auto order setting:', error);
      toast.error('Error updating auto-order setting');
    } finally {
      setLoadingAutoOrderSetting(false);
    }
  };

  const getStatusBadge = (status) => {
    const statusConfig = {
      'pending': { 
        bg: 'bg-yellow-100', 
        text: 'text-yellow-800', 
        label: 'Pending Approval' 
      },
      'approved': { 
        bg: 'bg-green-100', 
        text: 'text-green-800', 
        label: 'Approved' 
      },
      'rejected': { 
        bg: 'bg-red-100', 
        text: 'text-red-800', 
        label: 'Rejected' 
      },
      'order_sent': { 
        bg: 'bg-blue-100', 
        text: 'text-blue-800', 
        label: 'Order Sent' 
      },
      'order_successful': { 
        bg: 'bg-green-100', 
        text: 'text-green-800', 
        label: 'Order Successful' 
      },
      'order_recieved': { 
        bg: 'bg-purple-100', 
        text: 'text-purple-800', 
        label: 'Order Received' 
      }
    };

    const config = statusConfig[status] || { 
      bg: 'bg-gray-100', 
      text: 'text-gray-800', 
      label: status 
    };

    return (
      <span className={`px-2 py-1 inline-flex text-xs leading-5 font-semibold rounded-full ${config.bg} ${config.text}`}>
        {config.label}
      </span>
    );
  };

  if (!pharmacy_id) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-gray-800 mb-4">Loading...</h1>
          <p className="text-gray-600">Please wait while we load your pharmacy information.</p>
        </div>
      </div>
    );
  }

  return (
    <>
      <ToastContainer position="top-center" autoClose={3000} hideProgressBar />
      <div className="flex min-h-screen bg-gray-100">
        {/* Sidebar */}
        <aside className="flex flex-col w-64 px-4 py-8 bg-white shadow-lg">
          <h2 className="text-2xl font-bold text-purple-700 mb-6">
            Demand Forecast
          </h2>
          <nav className="space-y-3">
            <button
              onClick={() => router.push(`/user?pharmacy_id=${pharmacy_id}`)}
              className="flex items-center w-full px-4 py-3 text-left text-white bg-gray-600 rounded-lg shadow-md hover:bg-gray-500 transition-colors duration-200"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M9.707 16.707a1 1 0 01-1.414 0l-6-6a1 1 0 010-1.414l6-6a1 1 0 011.414 1.414L5.414 9H17a1 1 0 110 2H5.414l4.293 4.293a1 1 0 010 1.414z" clipRule="evenodd" />
              </svg>
              Back to Dashboard
            </button>
            <button
              onClick={() => {
                fetchDemandForecast();
                fetchDemandRequests();
              }}
              disabled={loading || loadingRequests}
              className={`flex items-center w-full px-4 py-3 text-left text-white rounded-lg shadow-md transition-colors duration-200 ${
                loading || loadingRequests
                  ? 'bg-gray-400 cursor-not-allowed' 
                  : 'bg-purple-600 hover:bg-purple-500'
              }`}
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M4 2a1 1 0 011 1v2.101a7.002 7.002 0 0111.601 2.566 1 1 0 11-1.885.666A5.002 5.002 0 005.999 7H9a1 1 0 010 2H4a1 1 0 01-1-1V3a1 1 0 011-1zm.008 9.057a1 1 0 011.276.61A5.002 5.002 0 0014.001 13H11a1 1 0 110-2h5a1 1 0 011 1v5a1 1 0 11-2 0v-2.101a7.002 7.002 0 01-11.601-2.566 1 1 0 01.61-1.276z" clipRule="evenodd" />
              </svg>
              {loading || loadingRequests ? 'Updating...' : 'Refresh Forecast'}
            </button>
          </nav>
        </aside>

        {/* Main Content */}
        <main className="flex-1 p-6 bg-gray-50">
          {/* Header */}
          <div className="mb-8">
            <h1 className="text-3xl font-bold text-gray-900 mb-2">
              Time Series-Powered Demand Forecast
            </h1>
            <p className="text-gray-600">
              Predictive analytics for medicine inventory management
            </p>
            {lastUpdated && (
              <p className="text-sm text-gray-500 mt-2">
                Last updated: {lastUpdated.toLocaleString()}
              </p>
            )}
          </div>

          {/* Auto-Order Settings */}
          <div className="mb-8 bg-white rounded-lg shadow-md p-6 border-l-4 border-purple-500">
            <div className="flex items-center justify-between">
              <div className="flex-1">
                <h3 className="text-lg font-semibold text-gray-800 mb-2">
                  Automatic Order Management
                </h3>
                <div className="space-y-2">
                  <p className="text-gray-600">
                    {autoOrderEnabled 
                      ? '🟢 Auto-ordering is enabled. Demand requests will be automatically created on the 1st of each month based on Time Series forecasts.'
                      : '🔴 Auto-ordering is disabled. You need to manually create demand requests when needed.'
                    }
                  </p>
                  <div className="text-sm text-gray-500">
                    <p>• <strong>Auto Mode:</strong> Orders created automatically every 1st of the month with Time Series-recommended quantities</p>
                    <p>• <strong>Manual Mode:</strong> You control when and what to order using the forecast data</p>
                  </div>
                </div>
              </div>
              <div className="ml-6 flex flex-col items-center space-y-3">
                <div className="flex items-center space-x-3">
                  <span className="text-sm font-medium text-gray-700">Manual</span>
                  <button
                    onClick={toggleAutoOrder}
                    disabled={loadingAutoOrderSetting}
                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-purple-500 focus:ring-offset-2 ${
                      autoOrderEnabled ? 'bg-purple-600' : 'bg-gray-200'
                    } ${loadingAutoOrderSetting ? 'opacity-50 cursor-not-allowed' : ''}`}
                  >
                    <span
                      className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                        autoOrderEnabled ? 'translate-x-6' : 'translate-x-1'
                      }`}
                    />
                  </button>
                  <span className="text-sm font-medium text-gray-700">Auto</span>
                </div>
                <div className="text-xs text-center">
                  <div className={`font-medium ${autoOrderEnabled ? 'text-purple-600' : 'text-gray-500'}`}>
                    {autoOrderEnabled ? 'AUTO MODE' : 'MANUAL MODE'}
                  </div>
                  <div className="text-gray-400 mt-1">
                    {autoOrderEnabled ? 'Next auto-order: 1st of next month' : 'Create orders manually'}
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Summary Cards */}
          {summary && Object.keys(summary).length > 0 && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
              <div className="bg-white p-6 rounded-lg shadow-md border-l-4 border-blue-500">
                <h3 className="text-lg font-semibold text-blue-600 mb-2">Total Medicines</h3>
                <p className="text-3xl font-bold text-gray-800">{summary.total_medicines}</p>
                <p className="text-sm text-gray-600">Analyzed for forecast</p>
              </div>
              <div className="bg-white p-6 rounded-lg shadow-md border-l-4 border-orange-500">
                <h3 className="text-lg font-semibold text-orange-600 mb-2">Need Restocking</h3>
                <p className="text-3xl font-bold text-gray-800">{summary.medicines_needing_restock}</p>
                <p className="text-sm text-gray-600">Medicines below forecast</p>
              </div>
              <div className="bg-white p-6 rounded-lg shadow-md border-l-4 border-red-500">
                <h3 className="text-lg font-semibold text-red-600 mb-2">Total Units Needed</h3>
                <p className="text-3xl font-bold text-gray-800">{formatNumber(summary.total_units_to_order)}</p>
                <p className="text-sm text-gray-600">Units to order</p>
              </div>
            </div>
          )}

          {/* Loading State */}
          {loading && (
            <div className="bg-white rounded-lg shadow-md p-8 text-center">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-purple-600 mx-auto mb-4"></div>
              <h3 className="text-lg font-semibold text-gray-700 mb-2">Running Time Series Forecast Analysis</h3>
              <p className="text-gray-600">This may take a few moments...</p>
            </div>
          )}

          {/* Forecast Results */}
          {!loading && forecastData.length > 0 && (
            <div className="bg-white rounded-lg shadow-md overflow-hidden">
              <div className="p-6 border-b border-gray-200 flex justify-between items-center">
                <div>
                  <h3 className="text-xl font-semibold text-gray-800">30-Day Demand Forecast</h3>
                  <p className="text-gray-600 mt-1">Time Series predictions based on historical sales data</p>
                </div>
                {!autoOrderEnabled && orderItems.filter(item => item.selected && item.quantity > 0).length > 0 && (
                  <button
                    onClick={handleBulkOrder}
                    className="bg-green-600 hover:bg-green-700 text-white px-6 py-3 rounded-lg font-medium transition-colors duration-200 flex items-center"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2" viewBox="0 0 20 20" fill="currentColor">
                      <path d="M3 4a1 1 0 011-1h12a1 1 0 011 1v2a1 1 0 01-1 1H4a1 1 0 01-1-1V4zM3 10a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1H4a1 1 0 01-1-1v-6zM14 9a1 1 0 00-1 1v6a1 1 0 001 1h2a1 1 0 001-1v-6a1 1 0 00-1-1h-2z" />
                    </svg>
                    Create Bulk Order ({orderItems.filter(item => item.selected && item.quantity > 0).length} items)
                  </button>
                )}
                {autoOrderEnabled && (
                  <div className="bg-blue-50 border border-blue-200 rounded-lg px-4 py-3">
                    <div className="flex items-center">
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-blue-600 mr-2" viewBox="0 0 20 20" fill="currentColor">
                        <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
                      </svg>
                      <span className="text-sm font-medium text-blue-800">
                        Auto-ordering is enabled. Orders will be created automatically on the 1st of each month.
                      </span>
                    </div>
                  </div>
                )}
              </div>
              <div className="overflow-x-auto">
                <table className="min-w-full">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Medicine
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Predicted Demand
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Current Stock
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Need to Order
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Status
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Action
                      </th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {forecastData.map((medicine, index) => (
                      <tr key={index} className="hover:bg-gray-50">
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div>
                            <div className="text-sm font-medium text-gray-900">
                              {medicine.medicine_name || `Medicine ${medicine.medicine_id}`}
                            </div>
                            {medicine.dosage && (
                              <div className="text-sm text-gray-500">
                                {medicine.dosage} {medicine.unit}
                              </div>
                            )}
                          </div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="text-sm font-medium text-gray-900">
                            {formatNumber(medicine.predicted_demand)} units
                          </div>
                          <div className="text-xs text-gray-500">Next 30 days</div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="text-sm text-gray-900">
                            {formatNumber(medicine.current_stock)} units
                          </div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className={`text-sm font-medium ${
                            medicine.stock_to_order > 0 ? 'text-red-600' : 'text-green-600'
                          }`}>
                            {formatNumber(medicine.stock_to_order)} units
                          </div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${
                            medicine.stock_to_order > 0 
                              ? 'bg-red-100 text-red-800' 
                              : 'bg-green-100 text-green-800'
                          }`}>
                            {medicine.stock_to_order > 0 ? 'Restock Needed' : 'Sufficient Stock'}
                          </span>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                          {medicine.stock_to_order > 0 && !autoOrderEnabled && (
                            <button
                              onClick={() => handleOrderMedicine(medicine)}
                              className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm transition-colors duration-200 flex items-center"
                            >
                              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 mr-1" viewBox="0 0 20 20" fill="currentColor">
                                <path fillRule="evenodd" d="M10 5a1 1 0 011 1v3h3a1 1 0 110 2h-3v3a1 1 0 11-2 0v-3H6a1 1 0 110-2h3V6a1 1 0 011-1z" clipRule="evenodd" />
                              </svg>
                              Order Now
                            </button>
                          )}
                          {medicine.stock_to_order > 0 && autoOrderEnabled && (
                            <div className="text-sm text-gray-500 italic">
                              Auto-order enabled
                            </div>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Demand Requests History */}
          <div className="mt-8 bg-white rounded-lg shadow-md overflow-hidden">
            <div className="p-6 border-b border-gray-200 flex justify-between items-center">
              <div>
                <h3 className="text-xl font-semibold text-gray-800">Demand Request History</h3>
                <p className="text-gray-600 mt-1">All demand requests created by your pharmacy</p>
              </div>
              <button
                onClick={fetchDemandRequests}
                disabled={loadingRequests}
                className={`flex items-center px-4 py-2 text-sm font-medium rounded-lg transition-colors duration-200 ${
                  loadingRequests 
                    ? 'bg-gray-400 text-white cursor-not-allowed' 
                    : 'bg-indigo-600 text-white hover:bg-indigo-700'
                }`}
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 mr-2" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M4 2a1 1 0 011 1v2.101a7.002 7.002 0 0111.601 2.566 1 1 0 11-1.885.666A5.002 5.002 0 005.999 7H9a1 1 0 010 2H4a1 1 0 01-1-1V3a1 1 0 011-1zm.008 9.057a1 1 0 011.276.61A5.002 5.002 0 0014.001 13H11a1 1 0 110-2h5a1 1 0 011 1v5a1 1 0 11-2 0v-2.101a7.002 7.002 0 01-11.601-2.566 1 1 0 01.61-1.276z" clipRule="evenodd" />
                </svg>
                {loadingRequests ? 'Loading...' : 'Refresh'}
              </button>
            </div>

            {loadingRequests ? (
              <div className="p-8 text-center">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600 mx-auto mb-4"></div>
                <p className="text-gray-600">Loading demand requests...</p>
              </div>
            ) : demandRequests.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="min-w-full">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Request ID
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Created Date
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Status
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Items Count
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Total Quantity
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Remarks
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        CMO Comments
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {demandRequests.map((request, index) => (
                      <tr key={request.request_id} className="hover:bg-gray-50">
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="text-sm font-medium text-gray-900">
                            #{request.request_id}
                          </div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="text-sm text-gray-900">
                            {new Date(request.request_date).toLocaleDateString('en-IN', {
                              year: 'numeric',
                              month: 'short',
                              day: 'numeric',
                              hour: '2-digit',
                              minute: '2-digit'
                            })}
                          </div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          {getStatusBadge(request.status)}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="text-sm text-gray-900">
                            {request.items_count} items
                          </div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="text-sm font-medium text-gray-900">
                            {formatNumber(request.total_quantity)} units
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          <div className="text-sm text-gray-900 max-w-xs truncate">
                            {request.remarks || 'No remarks'}
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          <div className="text-sm text-gray-900 max-w-xs truncate">
                            {request.comments_from_approver ? (
                              <span className={`${
                                request.status === 'approved' ? 'text-green-700' :
                                request.status === 'rejected' ? 'text-red-700' :
                                'text-gray-700'
                              }`}>
                                {request.comments_from_approver}
                              </span>
                            ) : (
                              <span className="text-gray-400 italic">No comments</span>
                            )}
                          </div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                          <button
                            onClick={() => handleViewDemandRequest(request)}
                            className="text-indigo-600 hover:text-indigo-900"
                          >
                            View Details
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="p-8 text-center">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-12 w-12 text-gray-400 mx-auto mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                <h3 className="text-lg font-medium text-gray-700 mb-2">No Demand Requests Yet</h3>
                <p className="text-gray-600">
                  Create your first demand request using the Time Series forecast above.
                </p>
              </div>
            )}
          </div>

          {/* Empty State */}
          {!loading && forecastData.length === 0 && (
            <div className="bg-white rounded-lg shadow-md p-8 text-center">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-16 w-16 text-gray-400 mx-auto mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
              </svg>
              <h3 className="text-lg font-semibold text-gray-700 mb-2">No Forecast Data Available</h3>
              <p className="text-gray-600 mb-4">
                Insufficient sales history or stock data for Time Series analysis.
              </p>
              <button
                onClick={fetchDemandForecast}
                className="bg-purple-600 hover:bg-purple-700 text-white px-6 py-2 rounded-lg transition-colors duration-200"
              >
                Try Again
              </button>
            </div>
          )}
        </main>
      </div>

      {/* Inline Order Cart (cards) - Only show in manual mode */}
      {!autoOrderEnabled && orderItems && orderItems.length > 0 && (
        <div className="fixed right-6 bottom-6 w-full max-w-lg z-40">
          <div className="bg-white rounded-lg shadow-xl p-4 border border-gray-200">
            <div className="flex justify-between items-center mb-3">
              <h4 className="text-lg font-semibold">Order Cart</h4>
              <button onClick={() => setOrderItems([])} className="text-sm text-red-600 hover:underline">Clear</button>
            </div>

            <div className="space-y-3 max-h-72 overflow-y-auto">
              {orderItems.map(item => (
                <div key={item.medicine_id} className="flex items-center justify-between bg-gray-50 p-3 rounded-md border">
                  <div>
                    <div className="text-sm font-medium">{item.medicine_name}</div>
                    <div className="text-xs text-gray-500">Stock: {formatNumber(item.current_stock)} • Recommended: {formatNumber(item.recommended_quantity)}</div>
                  </div>
                  <div className="flex items-center space-x-2">
                    <input
                      type="number"
                      min="0"
                      step="1"
                      value={item.quantity}
                      onChange={(e) => handleQuantityChange(item.medicine_id, e.target.value)}
                      className="w-20 p-1 border border-gray-300 rounded-md text-sm"
                    />
                    <button onClick={() => handleRemoveOrderItem(item.medicine_id)} className="text-sm text-red-600">Remove</button>
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-4 flex items-center justify-between">
              <div className="text-sm text-gray-600">
                Selected: {orderItems.filter(i=>i.quantity>0).length} | Total Qty: {orderItems.reduce((s,i)=>s + (parseFloat(i.quantity)||0), 0)}
              </div>
              <div className="flex items-center space-x-2">
                <input
                  type="text"
                  placeholder="Remarks (optional)"
                  value={orderRemarks}
                  onChange={(e)=>setOrderRemarks(e.target.value)}
                  className="p-2 border border-gray-200 rounded-md text-sm"
                />
                <button
                  onClick={submitDemandRequest}
                  disabled={submittingOrder || orderItems.filter(item => item.selected && item.quantity > 0).length === 0}
                  className={`px-4 py-2 text-sm font-medium text-white rounded-md ${submittingOrder || orderItems.filter(item => item.selected && item.quantity > 0).length === 0 ? 'bg-gray-400 cursor-not-allowed' : 'bg-green-600 hover:bg-green-700'}`}
                >
                  {submittingOrder ? 'Creating...' : 'Create Demand Request'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Demand Request Details Modal */}
      {isDemandRequestModalOpen && selectedDemandRequest && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg shadow-xl p-6 w-full max-w-4xl max-h-[80vh] overflow-hidden">
            <div className="flex justify-between items-center mb-6">
              <div>
                <h3 className="text-2xl font-semibold text-gray-800">
                  Demand Request Details
                </h3>
                <p className="text-gray-600 mt-1">
                  Request ID: #{selectedDemandRequest.request_id}
                </p>
              </div>
              <button
                onClick={() => {
                  setIsDemandRequestModalOpen(false);
                  setSelectedDemandRequest(null);
                }}
                className="text-gray-500 hover:text-gray-700 text-2xl"
              >
                ×
              </button>
            </div>

            {/* Request Summary */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
              <div className="bg-gray-50 p-4 rounded-lg">
                <h4 className="text-sm font-medium text-gray-700 mb-1">Created Date</h4>
                <p className="text-lg font-semibold text-gray-900">
                  {new Date(selectedDemandRequest.request_date).toLocaleDateString('en-IN', {
                    year: 'numeric',
                    month: 'short',
                    day: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit'
                  })}
                </p>
              </div>
              <div className="bg-gray-50 p-4 rounded-lg">
                <h4 className="text-sm font-medium text-gray-700 mb-1">Status</h4>
                <div className="mt-1">
                  {getStatusBadge(selectedDemandRequest.status)}
                </div>
              </div>
              <div className="bg-gray-50 p-4 rounded-lg">
                <h4 className="text-sm font-medium text-gray-700 mb-1">Total Quantity</h4>
                <p className="text-lg font-semibold text-gray-900">
                  {formatNumber(selectedDemandRequest.total_quantity)} units
                </p>
              </div>
            </div>

            {/* Remarks */}
            {selectedDemandRequest.remarks && selectedDemandRequest.remarks !== 'Time Series-based demand forecast order' && (
              <div className="mb-6 p-4 bg-blue-50 rounded-lg border border-blue-200">
                <h4 className="text-sm font-medium text-blue-800 mb-2">Remarks:</h4>
                <p className="text-sm text-blue-700">{selectedDemandRequest.remarks}</p>
              </div>
            )}

            {/* Comments from Approver */}
            {selectedDemandRequest.comments_from_approver && (
              <div className={`mb-6 p-4 rounded-lg border ${
                selectedDemandRequest.status === 'approved' 
                  ? 'bg-green-50 border-green-200' 
                  : selectedDemandRequest.status === 'rejected'
                  ? 'bg-red-50 border-red-200'
                  : 'bg-gray-50 border-gray-200'
              }`}>
                <h4 className={`text-sm font-medium mb-2 ${
                  selectedDemandRequest.status === 'approved' 
                    ? 'text-green-800' 
                    : selectedDemandRequest.status === 'rejected'
                    ? 'text-red-800'
                    : 'text-gray-800'
                }`}>
                  Comments from CMO:
                </h4>
                <p className={`text-sm ${
                  selectedDemandRequest.status === 'approved' 
                    ? 'text-green-700' 
                    : selectedDemandRequest.status === 'rejected'
                    ? 'text-red-700'
                    : 'text-gray-700'
                }`}>
                  {selectedDemandRequest.comments_from_approver}
                </p>
              </div>
            )}

            {/* Request Items */}
            <div className="mb-4">
              <h4 className="text-lg font-semibold text-gray-800 mb-3">
                Requested Items ({selectedDemandRequest.items_count} items)
              </h4>
              <div className="overflow-y-auto max-h-96 border border-gray-200 rounded-lg">
                <table className="min-w-full">
                  <thead className="bg-gray-50 sticky top-0">
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                        Medicine
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                        Dosage
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                        Quantity Requested
                      </th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {selectedDemandRequest.items.map((item, itemIndex) => (
                      <tr key={itemIndex} className="hover:bg-gray-50">
                        <td className="px-4 py-3">
                          <div className="text-sm font-medium text-gray-900">
                            {item.medicine_name || `Medicine ${item.medicine_id}`}
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <div className="text-sm text-gray-900">
                            {item.dosage ? `${item.dosage} ${item.unit || ''}` : 'N/A'}
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <div className="text-sm font-semibold text-indigo-600">
                            {formatNumber(item.quantity_requested)} units
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Modal Actions */}
            <div className="flex justify-end">
              <button
                onClick={() => {
                  setIsDemandRequestModalOpen(false);
                  setSelectedDemandRequest(null);
                }}
                className="px-6 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-md hover:bg-gray-200 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gray-500"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Bulk Order Modal - Only show in manual mode */}
      {!autoOrderEnabled && isOrderModalOpen && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg shadow-xl p-6 w-full max-w-4xl max-h-[80vh] overflow-hidden">
            <div className="flex justify-between items-center mb-6">
              <h3 className="text-2xl font-semibold text-gray-800">Create Bulk Order Request</h3>
              <button
                onClick={() => setIsOrderModalOpen(false)}
                className="text-gray-500 hover:text-gray-700 text-2xl"
              >
                ×
              </button>
            </div>

            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Order Remarks (Optional)
              </label>
              <textarea
                value={orderRemarks}
                onChange={(e) => setOrderRemarks(e.target.value)}
                placeholder="Add any special instructions or notes for this order..."
                className="w-full p-3 border border-gray-300 rounded-md focus:ring-purple-500 focus:border-purple-500"
                rows="3"
              />
            </div>

            <div className="overflow-y-auto max-h-96 border border-gray-200 rounded-lg">
              <table className="min-w-full">
                <thead className="bg-gray-50 sticky top-0">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                      Select
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                      Medicine
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                      Current Stock
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                      Predicted Demand
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                      Recommended
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                      Order Quantity
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {orderItems.map((item, index) => (
                    <tr key={item.medicine_id} className="hover:bg-gray-50">
                      <td className="px-4 py-3">
                        <input
                          type="checkbox"
                          checked={item.selected}
                          onChange={(e) => handleItemSelection(item.medicine_id, e.target.checked)}
                          className="h-4 w-4 text-purple-600 focus:ring-purple-500 border-gray-300 rounded"
                        />
                      </td>
                      <td className="px-4 py-3">
                        <div>
                          <div className="text-sm font-medium text-gray-900">
                            {item.medicine_name}
                          </div>
                          {item.dosage && (
                            <div className="text-sm text-gray-500">
                              {item.dosage} {item.unit}
                            </div>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-900">
                        {formatNumber(item.current_stock)}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-900">
                        {formatNumber(item.predicted_demand)}
                      </td>
                      <td className="px-4 py-3 text-sm text-blue-600 font-medium">
                        {formatNumber(item.recommended_quantity)}
                      </td>
                      <td className="px-4 py-3">
                        <input
                          type="number"
                          min="0"
                          step="1"
                          value={item.quantity}
                          onChange={(e) => handleQuantityChange(item.medicine_id, e.target.value)}
                          className="w-24 p-2 border border-gray-300 rounded-md focus:ring-purple-500 focus:border-purple-500 text-sm"
                          disabled={!item.selected}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="mt-6 flex justify-between items-center">
              <div className="text-sm text-gray-600">
                Selected: {orderItems.filter(item => item.selected && item.quantity > 0).length} items | 
                Total Quantity: {orderItems.filter(item => item.selected).reduce((sum, item) => sum + item.quantity, 0)} units
              </div>
              <div className="flex space-x-3">
                <button
                  onClick={() => setIsOrderModalOpen(false)}
                  className="px-6 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-md hover:bg-gray-200 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gray-500"
                >
                  Cancel
                </button>
                <button
                  onClick={submitDemandRequest}
                  disabled={submittingOrder || orderItems.filter(item => item.selected && item.quantity > 0).length === 0}
                  className={`px-6 py-2 text-sm font-medium text-white rounded-md focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500 ${
                    submittingOrder || orderItems.filter(item => item.selected && item.quantity > 0).length === 0
                      ? 'bg-gray-400 cursor-not-allowed'
                      : 'bg-green-600 hover:bg-green-700'
                  }`}
                >
                  {submittingOrder ? 'Creating Order...' : 'Create Order Request'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default DemandForecast;