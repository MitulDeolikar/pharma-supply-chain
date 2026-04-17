import { useRouter } from "next/router";
import { useEffect, useState } from "react";
import { ToastContainer, toast } from "react-toastify";
import "react-toastify/dist/ReactToastify.css";
import useSSE from "../hooks/useSSE";

const PharmacyDashboard = ({ logout }) => {
  const router = useRouter();
  const [stocks, setStocks] = useState([]);
  const [expiredMedicines, setExpiredMedicines] = useState([]);
  const [nearExpiryMedicines, setNearExpiryMedicines] = useState([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isEditMode, setIsEditMode] = useState(false);
  const [medicines, setMedicines] = useState([]);
  const [nsqNotifications, setNsqNotifications] = useState([]);
  const [nsqPanelOpen, setNsqPanelOpen] = useState(false);
  const [stockRefreshTrigger, setStockRefreshTrigger] = useState(0);
  const [newStock, setNewStock] = useState({
    medicine_id: '',
    batch_number: '',
    quantity: '',
    price_per_unit: '',
    expiry_date: ''
  });

  // Real-time updates via SSE — pharmacy receives stock and request events
  // No useCallback needed — useSSE stores onEvent in a ref, so it always
  // calls the latest version without re-opening the EventSource connection.
  const handleSSEEvent = (event) => {
    const t = event.type;
    if (t.startsWith('stock:') || t.startsWith('emergency:') || t.startsWith('demand:') || t === 'prescription:served') {
      setStockRefreshTrigger(prev => prev + 1);
      toast.info(`Update: ${t.replace(':', ' ').replace(/^\w/, c => c.toUpperCase())}`, { autoClose: 3000 });
    }
  };

  useSSE({ role: 'pharmacy', id: router.query.pharmacy_id, onEvent: handleSSEEvent });

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

  // Fetch pharmacy stock
  useEffect(() => {
    const fetchPharmacyStock = async () => {
      try {
        const { pharmacy_id } = router.query;
        console.log('Current pharmacy_id:', pharmacy_id);
        if (!pharmacy_id) {
          console.log('No pharmacy_id found in query parameters');
          return;
        }
        
        console.log('Fetching data for pharmacy_id:', pharmacy_id);
        const response = await fetch(`/api/fetchPharmacyStock?pharmacyId=${pharmacy_id}`);
        const data = await response.json();
        console.log('API Response:', data);
        
        if (data.success) {
          console.log('Fetched stocks:', data.stocks);
          setStocks(data.stocks);
          
          // Filter expired medicines
          const currentDate = new Date();
          const expired = data.stocks.filter(stock => 
            new Date(stock.expiry_date) <= currentDate
          );
          console.log('Expired medicines:', expired);
          setExpiredMedicines(expired);
          
          // Filter medicines expiring within a week
          const oneWeekFromNow = new Date();
          oneWeekFromNow.setDate(oneWeekFromNow.getDate() + 7);
          const nearExpiry = data.stocks.filter(stock => {
            const expiryDate = new Date(stock.expiry_date);
            return expiryDate > currentDate && expiryDate <= oneWeekFromNow;
          });
          console.log('Near expiry medicines:', nearExpiry);
          setNearExpiryMedicines(nearExpiry);
        } else {
          console.log('API returned success: false');
        }
      } catch (error) {
        console.error("Error fetching pharmacy stock:", error);
        toast.error("Failed to fetch stock data");
      }
    };
    fetchPharmacyStock();
  }, [router.query, stockRefreshTrigger]);

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
    setIsModalOpen(true);
  };

  // Fetch all medicines for dropdown
  useEffect(() => {
    const fetchMedicines = async () => {
      try {
        const response = await fetch('/api/fetchAllMedicines');
        const data = await response.json();
        if (data.success) {
          setMedicines(data.medicines);
        }
      } catch (error) {
        console.error('Error fetching medicines:', error);
      }
    };
    fetchMedicines();
  }, []);

  // Fetch NSQ notifications for this pharmacy
  useEffect(() => {
    const fetchNSQ = async () => {
      const { pharmacy_id } = router.query;
      if (!pharmacy_id) return;
      try {
        const res  = await fetch(`/api/fetchNSQNotifications?pharmacy_id=${pharmacy_id}`);
        const data = await res.json();
        if (data.success) setNsqNotifications(data.notifications || []);
      } catch (e) {
        console.error('Error fetching NSQ notifications:', e);
      }
    };
    fetchNSQ();
  }, [router.query]);

  const markNSQRead = async (notification_id) => {
    const { pharmacy_id } = router.query;
    try {
      await fetch('/api/markNSQRead', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notification_id, pharmacy_id: parseInt(pharmacy_id) }),
      });
      setNsqNotifications(prev =>
        prev.map(n => n.id === notification_id ? { ...n, is_read: 1 } : n)
      );
    } catch (e) {
      console.error('Error marking NSQ read:', e);
    }
  };

  const handleAddStock = () => {
    setIsModalOpen(true);
  };

  const handleModalClose = () => {
    setIsModalOpen(false);
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
    try {
      const { pharmacy_id } = router.query;
      const response = await fetch(isEditMode ? '/api/editStock' : '/api/addStock', {
        method: isEditMode ? 'PUT' : 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          ...newStock,
          pharmacy_id
        })
      });

      const data = await response.json();
      if (data.success) {
        toast.success(isEditMode ? 'Stock updated successfully' : 'Stock added successfully');
        handleModalClose();
        // Refresh the stock list
        const pharmacyId = router.query.pharmacy_id;
        const stockResponse = await fetch(`/api/fetchPharmacyStock?pharmacyId=${pharmacyId}`);
        const stockData = await stockResponse.json();
        if (stockData.success) {
          setStocks(stockData.stocks);
        }
      } else {
        toast.error(data.message || 'Failed to add stock');
      }
    } catch (error) {
      console.error('Error adding stock:', error);
      toast.error('Error adding stock');
    }
  };

  const handleRemoveStock = async (stock_id) => {
    try {
      const response = await fetch(`/api/removeStock?stock_id=${stock_id}`, {
        method: "DELETE"
      });
      const data = await response.json();
      if (data.success) {
        toast.success("Stock removed successfully");
        // Refresh the stock list
        const pharmacyId = router.query.pharmacy_id;
        const stockResponse = await fetch(`/api/fetchPharmacyStock?pharmacyId=${pharmacyId}`);
        const stockData = await stockResponse.json();
        if (stockData.success) {
          setStocks(stockData.stocks);
        }
      } else {
        toast.error(data.message || "Failed to remove stock");
      }
    } catch (error) {
      console.error('Error removing stock:', error);
      toast.error("Error removing stock");
    }
  };

  return (
    <>
      <ToastContainer position="top-center" autoClose={1500} hideProgressBar />
      <div className="flex min-h-screen bg-gray-100">
        <aside className="flex flex-col w-64 px-4 py-8 bg-white shadow-lg">
          <h2 className="text-2xl font-bold text-indigo-700">
            Pharmacy Dashboard
          </h2>
          <nav className="mt-6 space-y-3">
            <button
              onClick={handleAddStock}
              className="flex items-center w-full px-4 py-3 text-left text-white bg-indigo-600 rounded-lg shadow-md hover:bg-indigo-500 transition-colors duration-200"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z" clipRule="evenodd" />
              </svg>
              Add New Stock
            </button>
            <button
              onClick={() => router.push(`/medicineInventory?pharmacy_id=${router.query.pharmacy_id}`)}
              className="flex items-center w-full px-4 py-3 text-left text-white bg-blue-600 rounded-lg shadow-md hover:bg-blue-500 transition-colors duration-200"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2" viewBox="0 0 20 20" fill="currentColor">
                <path d="M3 4a1 1 0 011-1h12a1 1 0 011 1v2a1 1 0 01-1 1H4a1 1 0 01-1-1V4zM3 10a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1H4a1 1 0 01-1-1v-6zM14 9a1 1 0 00-1 1v6a1 1 0 001 1h2a1 1 0 001-1v-6a1 1 0 00-1-1h-2z" />
              </svg>
              Medicine Inventory
            </button>
            <button
              onClick={() => router.push(`/pharmacyOrders?pharmacy_id=${router.query.pharmacy_id}`)}
              className="flex items-center w-full px-4 py-3 text-left text-white bg-green-600 rounded-lg shadow-md hover:bg-green-500 transition-colors duration-200"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2" viewBox="0 0 20 20" fill="currentColor">
                <path d="M9 2a1 1 0 000 2h2a1 1 0 100-2H9z" />
                <path fillRule="evenodd" d="M4 5a2 2 0 012-2 3 3 0 003 3h2a3 3 0 003-3 2 2 0 012 2v11a2 2 0 01-2 2H6a2 2 0 01-2-2V5zm3 4a1 1 0 000 2h.01a1 1 0 100-2H7zm3 0a1 1 0 000 2h3a1 1 0 100-2h-3zm-3 4a1 1 0 100 2h.01a1 1 0 100-2H7zm3 0a1 1 0 100 2h3a1 1 0 100-2h-3z" clipRule="evenodd" />
              </svg>
              View Orders
            </button>
            <button
              onClick={() => router.push(`/pendingDeliveries?pharmacy_id=${router.query.pharmacy_id}`)}
              className="flex items-center w-full px-4 py-3 text-left text-white bg-yellow-600 rounded-lg shadow-md hover:bg-yellow-500 transition-colors duration-200"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2" viewBox="0 0 20 20" fill="currentColor">
                <path d="M8 16.5a1.5 1.5 0 11-3 0 1.5 1.5 0 013 0zM15 16.5a1.5 1.5 0 11-3 0 1.5 1.5 0 013 0z" />
                <path d="M3 4a1 1 0 00-1 1v10a1 1 0 001 1h1.05a2.5 2.5 0 014.9 0H11a1 1 0 001-1v-1h2.05a2.5 2.5 0 014.9 0H19a1 1 0 001-1v-3a1 1 0 00-.293-.707l-3-3A1 1 0 0016 6h-3V5a1 1 0 00-1-1H3zm11 3.586L15.414 9H13V7.586z" />
              </svg>
              Confirm Deliveries
            </button>
            <button
              onClick={() => router.push(`/emergencyRequests?pharmacy_id=${router.query.pharmacy_id}`)}
              className="flex items-center w-full px-4 py-3 text-left text-white bg-red-600 rounded-lg shadow-md hover:bg-red-500 transition-colors duration-200"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M14.707 12.293a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 111.414-1.414L9 14.586V3a1 1 0 012 0v11.586l2.293-2.293a1 1 0 011.414 0z" clipRule="evenodd" />
              </svg>
              Send Emergency Orders
            </button>
            <button
              onClick={() => router.push(`/incomingEmergencyRequests?pharmacy_id=${router.query.pharmacy_id}`)}
              className="flex items-center w-full px-4 py-3 text-left text-white bg-orange-600 rounded-lg shadow-md hover:bg-orange-500 transition-colors duration-200"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M3 3a1 1 0 000 2v8a2 2 0 002 2h2.586l-1.293 1.293a1 1 0 101.414 1.414L10 15.414l2.293 2.293a1 1 0 001.414-1.414L12.414 15H15a2 2 0 002-2V5a1 1 0 100-2H3zm11.707 4.707a1 1 0 00-1.414-1.414L10 9.586 8.707 8.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
              </svg>
              Incoming Emergency Requests
            </button>
            <button
              onClick={() => router.push(`/manageExpiredMedicines?pharmacy_id=${router.query.pharmacy_id}`)}
              className="flex items-center w-full px-4 py-3 text-left text-white bg-purple-600 rounded-lg shadow-md hover:bg-purple-500 transition-colors duration-200"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd" />
              </svg>
              Manage Expired Medicines
            </button>
            <button
              onClick={() => router.push(`/salesAnalytics?pharmacy_id=${router.query.pharmacy_id}`)}
              className="flex items-center w-full px-4 py-3 text-left text-white bg-teal-600 rounded-lg shadow-md hover:bg-teal-500 transition-colors duration-200"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2" viewBox="0 0 20 20" fill="currentColor">
                <path d="M2 11a1 1 0 011-1h2a1 1 0 011 1v5a1 1 0 01-1 1H3a1 1 0 01-1-1v-5zM8 7a1 1 0 011-1h2a1 1 0 011 1v9a1 1 0 01-1 1H9a1 1 0 01-1-1V7zM14 4a1 1 0 011-1h2a1 1 0 011 1v12a1 1 0 01-1 1h-2a1 1 0 01-1-1V4z" />
              </svg>
              Sales Analytics
            </button>
            <button
              onClick={() => router.push(`/demandForecast?pharmacy_id=${router.query.pharmacy_id}`)}
              className="flex items-center w-full px-4 py-3 text-left text-white bg-purple-600 rounded-lg shadow-md hover:bg-purple-500 transition-colors duration-200"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2" viewBox="0 0 20 20" fill="currentColor">
                <path d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              Time Series Demand Forecast
            </button>
            <button
              onClick={logout}
              className="flex items-center w-full px-4 py-3 text-left text-white bg-gray-600 rounded-lg shadow-md hover:bg-gray-500 transition-colors duration-200"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M3 3a1 1 0 011 1v12a1 1 0 11-2 0V4a1 1 0 011-1zm7.707 3.293a1 1 0 010 1.414L9.414 9H17a1 1 0 110 2H9.414l1.293 1.293a1 1 0 01-1.414 1.414l-3-3a1 1 0 010-1.414l3-3a1 1 0 011.414 0z" clipRule="evenodd" />
              </svg>
              Logout
            </button>
          </nav>
        </aside>

        <main className="flex-1 p-6 bg-gray-50 dark:bg-gray-800">

          {/* NSQ Warning Banner */}
          {nsqNotifications.filter(n => !n.is_read).length > 0 && (
            <div className="mb-5 bg-red-50 border-2 border-red-400 rounded-xl p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-3">
                  <span className="text-2xl mt-0.5">⚠️</span>
                  <div>
                    <p className="font-bold text-red-800 text-base">
                      NSQ Alert — {nsqNotifications.filter(n => !n.is_read).length} Batch(es) Declared Not of Standard Quality
                    </p>
                    <p className="text-red-600 text-sm mt-0.5">
                      The CMO has declared the following medicine batches as NSQ. Quarantine and dispose immediately. Do not dispense to patients.
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => setNsqPanelOpen(o => !o)}
                  className="shrink-0 px-3 py-1.5 bg-red-600 text-white text-sm font-semibold rounded-lg hover:bg-red-700 transition-colors"
                >
                  {nsqPanelOpen ? 'Hide Details' : 'View Details'}
                </button>
              </div>

              {nsqPanelOpen && (
                <div className="mt-4 space-y-3">
                  {nsqNotifications.filter(n => !n.is_read).map(notif => (
                    <div key={notif.id} className="bg-white border border-red-200 rounded-lg p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex-1">
                          <div className="flex flex-wrap items-center gap-2 mb-1">
                            <span className="font-bold text-red-700">{notif.medicine_name}</span>
                            <span className="text-xs font-mono bg-red-100 text-red-700 px-2 py-0.5 rounded">Batch: {notif.batch_number}</span>
                            {Number(notif.current_quantity) > 0 && (
                              <span className="text-xs bg-orange-100 text-orange-700 px-2 py-0.5 rounded font-semibold">
                                You hold {Number(notif.current_quantity)} units
                              </span>
                            )}
                          </div>
                          <p className="text-sm text-gray-700 mb-2">{notif.message}</p>
                          <p className="text-xs text-gray-400">
                            Declared by: {notif.declared_by || 'CMO'} &bull; {new Date(notif.declared_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
                          </p>
                        </div>
                        <button
                          onClick={() => markNSQRead(notif.id)}
                          className="shrink-0 px-3 py-1.5 text-xs bg-red-600 text-white font-semibold rounded-lg hover:bg-red-700 transition-colors"
                        >
                          Acknowledge &amp; Mark NSQ
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Available Medicines */}
          <section className="mb-8">
            <div className="bg-white rounded-lg shadow-md p-6">
              <h3 className="text-xl font-semibold text-indigo-700 mb-4">
                Available Medicines
              </h3>
              <div className="overflow-x-auto">
                <table className="min-w-full bg-white rounded-lg">
                <thead>
                  <tr className="bg-indigo-50">
                    <th className="px-4 py-3 text-left text-indigo-700">Medicine Name</th>
                    <th className="px-4 py-3 text-left text-indigo-700">Generic Name</th>
                    <th className="px-4 py-3 text-left text-indigo-700">Batch Number</th>
                    <th className="px-4 py-3 text-left text-indigo-700">Quantity</th>
                    <th className="px-4 py-3 text-left text-indigo-700">Unit Type</th>
                    <th className="px-4 py-3 text-left text-indigo-700">Price/Unit</th>
                    <th className="px-4 py-3 text-left text-indigo-700">Expiry Date</th>
                    <th className="px-4 py-3 text-left text-indigo-700">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {stocks
                    .filter(stock => {
                      const expiryDate = new Date(stock.expiry_date);
                      const oneWeekFromNow = new Date();
                      oneWeekFromNow.setDate(oneWeekFromNow.getDate() + 7);
                      // Exclude expired, near-expiry, and NSQ-flagged batches
                      return expiryDate > oneWeekFromNow && !stock.is_nsq;
                    })
                    .map((stock) => (
                    <tr key={stock.stock_id} className="border-b hover:bg-indigo-50 transition-colors duration-150">
                      <td className="px-4 py-3">
                        {stock.medicine_name}
                        <div className="text-xs text-gray-500">
                          {stock.dosage && `${stock.dosage}`}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-gray-600">{stock.generic_name || '-'}</td>
                      <td className="px-4 py-3">{stock.batch_number}</td>
                      <td className="px-4 py-3">{stock.quantity}</td>
                      <td className="px-4 py-3">{stock.unit_type}</td>
                      <td className="px-4 py-3">₹{stock.price_per_unit}</td>
                      <td className="px-4 py-3">
                        <span className="text-green-600 font-medium">
                          {new Date(stock.expiry_date).toLocaleDateString()}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <button
                          onClick={() => handleEditStock(stock)}
                          className="px-3 py-2 mr-2 text-white bg-indigo-600 rounded-lg hover:bg-indigo-500 transition-colors duration-200 flex items-center text-sm"
                        >
                          <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 mr-1" viewBox="0 0 20 20" fill="currentColor">
                            <path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z" />
                          </svg>
                          Edit
                        </button>
                        <button
                          onClick={() => handleRemoveStock(stock.stock_id)}
                          className="px-3 py-2 text-white bg-red-600 rounded-lg hover:bg-red-500 transition-colors duration-200 flex items-center text-sm"
                        >
                          <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 mr-1" viewBox="0 0 20 20" fill="currentColor">
                            <path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd" />
                          </svg>
                          Remove
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            </div>
          </section>

          {/* NSQ Flagged Stock Section */}
          {stocks.filter(s => s.is_nsq).length > 0 && (
            <section className="mb-8">
              <div className="bg-white rounded-lg shadow-md p-6 border-2 border-red-500">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-xl font-semibold text-red-700 flex items-center gap-2">
                    <span className="text-2xl">⚠️</span>
                    NSQ Batches — Not of Standard Quality ({stocks.filter(s => s.is_nsq).length})
                  </h3>
                  <button
                    onClick={() => router.push(`/manageExpiredMedicines?pharmacy_id=${router.query.pharmacy_id}`)}
                    className="px-4 py-2 bg-red-600 text-white text-sm font-semibold rounded-lg hover:bg-red-700 transition-colors"
                  >
                    Manage &amp; Dispose →
                  </button>
                </div>
                <p className="text-sm text-red-600 mb-4">
                  These batches have been declared Not of Standard Quality by the CMO. Do not dispense. Go to Manage Expired Medicines to initiate disposal.
                </p>
                <div className="overflow-x-auto">
                  <table className="min-w-full text-sm">
                    <thead>
                      <tr className="bg-red-50">
                        <th className="px-4 py-2 text-left text-red-700">Medicine</th>
                        <th className="px-4 py-2 text-left text-red-700">Batch No.</th>
                        <th className="px-4 py-2 text-left text-red-700">Quantity</th>
                        <th className="px-4 py-2 text-left text-red-700">Expiry</th>
                        <th className="px-4 py-2 text-left text-red-700">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {stocks.filter(s => s.is_nsq).map(stock => (
                        <tr key={stock.stock_id} className="border-t bg-red-50">
                          <td className="px-4 py-2 font-medium text-gray-800">{stock.medicine_name || stock.name}</td>
                          <td className="px-4 py-2 font-mono text-gray-700">{stock.batch_number}</td>
                          <td className="px-4 py-2 text-gray-700">{stock.quantity} {stock.unit}</td>
                          <td className="px-4 py-2 text-gray-600">{stock.expiry_date ? new Date(stock.expiry_date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'}</td>
                          <td className="px-4 py-2">
                            <span className="text-xs font-bold bg-red-200 text-red-800 px-2 py-0.5 rounded-full">NSQ — Do Not Dispense</span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </section>
          )}

          {/* Expired Medicines */}
          <section className="mb-8">
            <div className="bg-white rounded-lg shadow-md p-6">
              <h3 className="text-xl font-semibold text-red-600 mb-4 flex items-center">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
                Expired Medicines
              </h3>
              <div className="overflow-x-auto">
                <table className="min-w-full bg-white rounded-lg">
                  <thead>
                    <tr className="bg-red-50">
                      <th className="px-4 py-3 text-left text-red-700">Medicine Name</th>
                      <th className="px-4 py-3 text-left text-red-700">Generic Name</th>
                      <th className="px-4 py-3 text-left text-red-700">Batch Number</th>
                      <th className="px-4 py-3 text-left text-red-700">Quantity</th>
                      <th className="px-4 py-3 text-left text-red-700">Expiry Date</th>
                      <th className="px-4 py-3 text-left text-red-700">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {expiredMedicines.map((med) => (
                      <tr key={med.stock_id} className="border-b hover:bg-red-50">
                        <td className="px-4 py-3">{med.medicine_name}</td>
                        <td className="px-4 py-3 text-gray-600">{med.generic_name || '-'}</td>
                        <td className="px-4 py-3">{med.batch_number}</td>
                        <td className="px-4 py-3">{med.quantity} {med.unit_type}</td>
                        <td className="px-4 py-3 text-red-600">
                          {new Date(med.expiry_date).toLocaleDateString()}
                        </td>
                        <td className="px-4 py-3">
                          <button
                            onClick={() => handleEditStock(med)}
                            className="px-3 py-2 mr-2 text-white bg-indigo-600 rounded-lg hover:bg-indigo-500 transition-colors duration-200 flex items-center text-sm"
                          >
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 mr-1" viewBox="0 0 20 20" fill="currentColor">
                              <path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z" />
                            </svg>
                            Edit
                          </button>
                          <button
                            onClick={() => handleRemoveStock(med.stock_id)}
                            className="px-3 py-2 text-white bg-red-600 rounded-lg hover:bg-red-500 transition-colors duration-200 flex items-center text-sm"
                          >
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 mr-1" viewBox="0 0 20 20" fill="currentColor">
                              <path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd" />
                            </svg>
                            Remove
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </section>

          {/* Near Expiry Medicines */}
          <section className="mb-8">
            <div className="bg-white rounded-lg shadow-md p-6">
              <h3 className="text-xl font-semibold text-yellow-600 mb-4 flex items-center">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                Medicines Expiring Soon (Within 7 Days)
              </h3>
              <div className="overflow-x-auto">
                <table className="min-w-full bg-white rounded-lg">
                  <thead>
                    <tr className="bg-yellow-50">
                      <th className="px-4 py-3 text-left text-yellow-700">Medicine Name</th>
                      <th className="px-4 py-3 text-left text-yellow-700">Generic Name</th>
                      <th className="px-4 py-3 text-left text-yellow-700">Batch Number</th>
                      <th className="px-4 py-3 text-left text-yellow-700">Quantity</th>
                      <th className="px-4 py-3 text-left text-yellow-700">Expiry Date</th>
                      <th className="px-4 py-3 text-left text-yellow-700">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {nearExpiryMedicines.map((med) => (
                      <tr key={med.stock_id} className="border-b hover:bg-yellow-50">
                        <td className="px-4 py-3">{med.medicine_name}</td>
                        <td className="px-4 py-3 text-gray-600">{med.generic_name || '-'}</td>
                        <td className="px-4 py-3">{med.batch_number}</td>
                        <td className="px-4 py-3">{med.quantity} {med.unit_type}</td>
                        <td className="px-4 py-3 text-yellow-600">
                          {new Date(med.expiry_date).toLocaleDateString()}
                        </td>
                        <td className="px-4 py-3">
                          <button
                            onClick={() => handleEditStock(med)}
                            className="px-3 py-2 mr-2 text-white bg-indigo-600 rounded-lg hover:bg-indigo-500 transition-colors duration-200 flex items-center text-sm"
                          >
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 mr-1" viewBox="0 0 20 20" fill="currentColor">
                              <path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z" />
                            </svg>
                            Edit
                          </button>
                          <button
                            onClick={() => handleRemoveStock(med.stock_id)}
                            className="px-3 py-2 text-white bg-red-600 rounded-lg hover:bg-red-500 transition-colors duration-200 flex items-center text-sm"
                          >
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 mr-1" viewBox="0 0 20 20" fill="currentColor">
                              <path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd" />
                            </svg>
                            Remove
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </section>
        </main>
      </div>

      {/* Add Stock Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-lg shadow-xl p-6 w-full max-w-md">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-xl font-semibold text-indigo-700">{isEditMode ? 'Edit Stock' : 'Add New Stock'}</h3>
              <button
                onClick={handleModalClose}
                className="text-gray-500 hover:text-gray-700"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <form onSubmit={handleSubmitStock} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Medicine
                </label>
                <select
                  name="medicine_id"
                  value={newStock.medicine_id}
                  onChange={handleInputChange}
                  required
                  className="w-full p-2 border border-gray-300 rounded-md focus:ring-indigo-500 focus:border-indigo-500"
                >
                  <option value="">Select Medicine</option>
                  {medicines.map(medicine => (
                    <option key={medicine.medicine_id} value={medicine.medicine_id}>
                      {medicine.medicine_name} - {medicine.dosage} {medicine.unit}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Batch Number
                </label>
                <input
                  type="text"
                  name="batch_number"
                  value={newStock.batch_number}
                  onChange={handleInputChange}
                  required
                  className="w-full p-2 border border-gray-300 rounded-md focus:ring-indigo-500 focus:border-indigo-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Quantity
                </label>
                <input
                  type="number"
                  name="quantity"
                  value={newStock.quantity}
                  onChange={handleInputChange}
                  required
                  min="0"
                  step="0.01"
                  className="w-full p-2 border border-gray-300 rounded-md focus:ring-indigo-500 focus:border-indigo-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Price per Unit (₹)
                </label>
                <input
                  type="number"
                  name="price_per_unit"
                  value={newStock.price_per_unit}
                  onChange={handleInputChange}
                  required
                  min="0"
                  step="0.01"
                  className="w-full p-2 border border-gray-300 rounded-md focus:ring-indigo-500 focus:border-indigo-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Expiry Date
                </label>
                <input
                  type="date"
                  name="expiry_date"
                  value={newStock.expiry_date}
                  onChange={handleInputChange}
                  required
                  className="w-full p-2 border border-gray-300 rounded-md focus:ring-indigo-500 focus:border-indigo-500"
                />
              </div>

              <div className="flex justify-end space-x-3 mt-6">
                <button
                  type="button"
                  onClick={handleModalClose}
                  className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-md hover:bg-gray-200 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 rounded-md hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
                >
                  {isEditMode ? 'Save Changes' : 'Add Stock'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
};

export default PharmacyDashboard;
