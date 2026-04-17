import { useRouter } from "next/router";
import { useEffect, useState } from "react";
import { ToastContainer, toast } from "react-toastify";
import "react-toastify/dist/ReactToastify.css";
import useSSE from '../hooks/useSSE';

const PharmacySearch = () => {
  const router = useRouter();
  const [prescriptions, setPrescriptions] = useState([]);
  const [selectedPrescription, setSelectedPrescription] = useState(null);
  const [isModalOpen, setIsModalOpen] = useState(false);

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

  const [pharmacies, setPharmacies] = useState([]);
  const [warehouses, setWarehouses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const [requestingPharmacy, setRequestingPharmacy] = useState(null);
  const [reqLoading, setReqLoading] = useState(false);
  const [sendingOrder, setSendingOrder] = useState(null); // Track which pharmacy/warehouse order is being sent to: "pharmacy_ID" or "warehouse_ID"
  const [generics, setGenerics] = useState([]);
  const [genericsMap, setGenericsMap] = useState({});
  const [isAlternative, setIsAlternative] = useState(false);
  const [medicines, setMedicines] = useState({});

  useEffect(() => {
    // Fetch all generics for name lookup
    const fetchGenerics = async () => {
      try {
        const response = await fetch('/api/getAllGenerics');
        const data = await response.json();
        if (data.success) {
          setGenerics(data.generics);
          // Create a map for quick lookup
          const map = {};
          data.generics.forEach(g => {
            map[g.generic_id] = g.generic_name;
          });
          setGenericsMap(map);
        }
      } catch (error) {
        console.error('Error fetching generics:', error);
      }
    };
    
    // Fetch all medicines for name lookup
    const fetchMedicines = async () => {
      try {
        const response = await fetch('/api/fetchAllMedicines');
        const data = await response.json();
        if (data.success) {
          const medMap = {};
          data.medicines.forEach(m => {
            medMap[m.medicine_id] = m.name;
          });
          setMedicines(medMap);
        }
      } catch (error) {
        console.error('Error fetching medicines:', error);
      }
    };
    
    fetchGenerics();
    fetchMedicines();
  }, []);

  useEffect(() => {
    const fetchRequestingPharmacy = async () => {
      try {
        const { pharmacyId } = router.query;
        if (!pharmacyId) return;
        setReqLoading(true);
        const resp = await fetch(`/api/getPharmacyInfo?pharmacyId=${pharmacyId}`);
        const json = await resp.json();
        if (json.success && json.pharmacy) {
          setRequestingPharmacy(json.pharmacy);
        }
      } catch (err) {
        console.error('Error fetching requesting pharmacy info:', err);
      } finally {
        setReqLoading(false);
      }
    };

    if (router.query.pharmacyId) fetchRequestingPharmacy();

    const fetchEligiblePharmacies = async () => {
      try {
        const { requestId, pharmacyId } = router.query;
        if (!requestId) return;

        setLoading(true);
        // include excludePharmacyId if provided so API can exclude the originating pharmacy
        let url = `/api/eligiblePharmacies?requestId=${requestId}`;
        if (pharmacyId) url += `&excludePharmacyId=${pharmacyId}`;

        const response = await fetch(url);
        const data = await response.json();

        if (data.success) {
          // first set pharmacies and warehouses (with stocks/requestItems)
          setPharmacies(data.pharmacies);
          setWarehouses(data.warehouses || []);
          setIsAlternative(data.is_alternative || false);

          // then request distances and merge into each pharmacy/warehouse object
          try {
            const distUrl = `/api/getPharmacyDistances?requestId=${requestId}` + (pharmacyId ? `&excludePharmacyId=${pharmacyId}` : '');
            const distResp = await fetch(distUrl);
            const distJson = await distResp.json();
            if (distJson.success) {
              // Merge pharmacy distances
              if (Array.isArray(distJson.distances)) {
                const distMap = new Map(distJson.distances.map(d => [d.pharmacy_id, d]));
                setPharmacies(prev => prev.map(p => ({ ...p, ...(distMap.get(p.pharmacy_id) || {}) })));
              }
              // Merge warehouse distances
              if (Array.isArray(distJson.warehouseDistances)) {
                const whDistMap = new Map(distJson.warehouseDistances.map(d => [d.warehouse_id, d]));
                setWarehouses(prev => prev.map(w => ({ ...w, ...(whDistMap.get(w.warehouse_id) || {}) })));
              }
              // if API returned origin_coord, attach it to requesting pharmacy so UI can show lat/lon
              if (distJson.origin_coord) {
                setRequestingPharmacy(prev => ({ ...prev, coord: distJson.origin_coord }));
              }
            }
          } catch (e) {
            console.error('Error fetching distances:', e);
          }
        } else {
          toast.error(data.message || "Failed to fetch pharmacies");
        }
      } catch (error) {
        console.error("Error fetching pharmacies:", error);
        toast.error("Error fetching pharmacies");
      } finally {
        setLoading(false);
      }
    };

    if (router.query.requestId) {
      fetchEligiblePharmacies();
    }
  }, [router.query, refreshTrigger]);

  // Real-time updates — re-fetch eligible pharmacies when stock or request state changes.
  // Covers: direct stock edits, warehouse dispatches, emergency/demand order allocations
  // and confirmations — all of which move stock between pharmacies/warehouses.
  const handleSSEEvent = (event) => {
    const t = event.type;
    if (
      t.startsWith('stock:') ||
      t.startsWith('emergency:') ||
      t.startsWith('demand:') ||
      t === 'warehouse:dispatched'
    ) {
      setRefreshTrigger(prev => prev + 1);
    }
  };
  useSSE({ role: 'cmo', id: 'search', onEvent: handleSSEEvent });

  const handleSendOrder = async (entityId, entityName, isWarehouse = false) => {
    try {
      const { requestId } = router.query;
      if (!requestId) {
        toast.error("Request ID not found");
        return;
      }

      const orderKey = `${isWarehouse ? 'warehouse' : 'pharmacy'}_${entityId}`;
      setSendingOrder(orderKey);

      const response = await fetch('/api/sendOrderToPharmacy', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          requestId: requestId,
          acceptingPharmacyId: isWarehouse ? null : entityId,
          acceptingWarehouseId: isWarehouse ? entityId : null
        }),
      });

      const data = await response.json();

      if (data.success) {
        toast.success(`Order successfully sent to ${entityName}!`);
        // Find the entity object to get medicines data
        const entity = isWarehouse 
          ? warehouses.find(w => w.warehouse_id === entityId)
          : pharmacies.find(p => p.pharmacy_id === entityId);
        
        // Redirect to order confirmation page with details
        const confirmationData = {
          requestId: requestId,
          acceptingPharmacyName: isWarehouse ? null : entityName,
          acceptingPharmacyId: isWarehouse ? null : entityId,
          acceptingWarehouseName: isWarehouse ? entityName : null,
          acceptingWarehouseId: isWarehouse ? entityId : null,
          requestingPharmacyName: requestingPharmacy?.name || 'Unknown',
          requestingPharmacyId: router.query.pharmacyId,
          medicines: entity?.requestItems || []
        };
        
        const encodedData = encodeURIComponent(JSON.stringify(confirmationData));
        router.push(`/orderConfirmation?data=${encodedData}`);
      } else {
        toast.error(data.message || "Failed to send order");
      }
    } catch (error) {
      console.error("Error sending order:", error);
      toast.error("Error sending order");
    } finally {
      setSendingOrder(null);
    }
  };

  const handleAcceptOrder = (prescription) => {
    try {
      const encodedPrescription = encodeURIComponent(JSON.stringify(prescription));
      // Include requestId in the URL if it exists
      const requestIdParam = router.query.requestId ? `&requestId=${router.query.requestId}` : '';
      router.push(`/selectMedicineStocks?pharmacy_id=${router.query.pharmacy_id}&prescription=${encodedPrescription}${requestIdParam}`);
    } catch (error) {
      console.error("Error navigating to stock selection:", error);
      toast.error("Error processing order");
    }
  };

  const openModal = (prescription) => {
    setSelectedPrescription(prescription);
    setIsModalOpen(true);
  };

  return (
    <>
      <ToastContainer position="top-center" autoClose={1500} hideProgressBar />
      <div className="min-h-screen bg-gray-100 py-6 px-4">
        
        {isAlternative && (
          <div className="mb-6 p-4 bg-yellow-50 border-l-4 border-yellow-400 rounded-r-lg">
            <div className="flex items-center">
              <svg className="w-6 h-6 text-yellow-600 mr-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
              <div>
                <h3 className="text-lg font-semibold text-yellow-800">Alternative Medicines Available</h3>
                <p className="text-sm text-yellow-700">The exact requested medicine is not available, but pharmacies with alternative medicines from the same category are shown below.</p>
              </div>
            </div>
          </div>
        )}
        
        <h1 className="text-3xl font-bold text-gray-900 mb-8">Available Pharmacies & Drug Warehouses for Emergency Requests</h1>
        {reqLoading ? (
          <div className="mb-4">
            <p className="text-sm text-gray-800">Loading requesting pharmacy address...</p>
          </div>
        ) : requestingPharmacy ? (
          <div className="mb-4 p-4 bg-white rounded shadow">
            <h2 className="text-sm font-medium text-gray-900">Requesting pharmacy address</h2>
            <p className="text-sm text-gray-800">{requestingPharmacy.address}</p>
            <p className="text-sm text-gray-800">District: {requestingPharmacy.district} | Block: {requestingPharmacy.block}</p>
            {requestingPharmacy.coord && (
              <p className="text-sm text-gray-800">Lat: {requestingPharmacy.coord.lat} | Lon: {requestingPharmacy.coord.lon}</p>
            )}
          </div>
        ) : null}
        
        {loading ? (
          <div className="flex justify-center items-center h-64">
            <p className="text-gray-800">Loading available pharmacies and warehouses...</p>
          </div>
        ) : (pharmacies.length === 0 && warehouses.length === 0) ? (
          <div className="flex justify-center items-center h-64">
            <p className="text-gray-800">No pharmacies or warehouses found with sufficient stock for this request.</p>
          </div>
        ) : (
          <>
            {/* Pharmacies Section */}
            {pharmacies.length > 0 && (
              <div className="mb-8">
                <h2 className="text-2xl font-semibold text-gray-900 mb-4">Pharmacies ({pharmacies.length})</h2>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {pharmacies.map((pharmacy) => (
              <div
                key={pharmacy.pharmacy_id}
                className="bg-white rounded-lg shadow-md hover:shadow-lg transition-shadow duration-200"
              >
                <div className="p-6">
                  <div className="mb-4">
                    <h3 className="text-lg font-semibold text-gray-900">
                      {pharmacy.name}
                    </h3>
                    <p className="text-sm text-gray-800">{pharmacy.address}</p>
                    <p className="text-sm text-gray-800">District: {pharmacy.district}</p>
                    <p className="text-sm text-gray-800">Block: {pharmacy.block}</p>
                    <p className="text-sm text-gray-900">Please contact the pharmacy for more details and sending order to that Pharmacy.</p>
                    <p className="text-sm text-gray-800">Contact: <span className="font-bold">{pharmacy.contact_number}</span></p>
                  </div>

                  <div className="mb-4">
                    <h4 className="text-md font-medium text-gray-900 mb-2">Available Stock</h4>
                    <ul className="space-y-3">
                      {pharmacy.requestItems.map((item) => {
                        // Handle alternative medicine request
                        if (item.is_alternative && item.alternative_generic_id) {
                          const alternativeStocks = pharmacy.stocks.filter(s => s.generic_id === item.alternative_generic_id);
                          const totalQuantity = alternativeStocks.reduce((sum, s) => sum + parseFloat(s.quantity), 0);
                          const genericName = genericsMap[item.alternative_generic_id] || 'Generic Medicine';
                          const originalMedicineName = medicines[item.original_medicine_id] || 'Requested Medicine';
                          
                          return (
                            <li key={`alt-${item.original_medicine_id}`} className="text-gray-800">
                              <div className="mb-2 p-2 bg-yellow-50 border border-yellow-200 rounded">
                                <span className="text-sm text-yellow-800 font-medium">
                                  ⚠️ Alternative for: <span className="font-bold">{originalMedicineName}</span>
                                </span>
                              </div>
                              <span className="text-base font-bold text-indigo-700">{genericName} Category</span>
                              <br />
                              <span className="text-blue-700 font-medium text-sm">Available alternative medicines:</span>
                              <ul className="ml-4 mt-1 space-y-1">
                                {alternativeStocks.map((stock, idx) => (
                                  <li key={idx} className="text-sm text-gray-700">
                                    • <span className="font-semibold">{stock.medicine_name}</span> <span className="text-xs">({stock.dosage})</span>: <span className="font-medium">{stock.quantity} {stock.unit_type}</span>
                                  </li>
                                ))}
                              </ul>
                              <span className="text-green-700 font-semibold">Total Available: {totalQuantity}</span>
                              <br />
                              <span className="text-green-700 font-medium">Required: {item.quantity_requested}</span>
                            </li>
                          );
                        }
                        // Handle specific medicine request
                        else if (item.medicine_id) {
                          const stock = pharmacy.stocks.filter(s => s.medicine_id === item.medicine_id);
                          const totalQuantity = stock.reduce((sum, s) => sum + parseFloat(s.quantity), 0);
                          const medicine = stock[0];

                          return (
                            <li key={item.medicine_id} className="text-gray-800">
                              <span className="text-base font-semibold">{medicine.medicine_name}</span> <span className="text-sm">({medicine.dosage})</span>: <span className="font-medium">{totalQuantity} {medicine.unit_type}</span>
                              <br />
                              <span className="text-green-700 font-medium">Required: {item.quantity_requested}</span>
                            </li>
                          );
                        } 
                        // Handle generic medicine request
                        else if (item.generic_id) {
                          const genericStocks = pharmacy.stocks.filter(s => s.generic_id === item.generic_id);
                          const totalQuantity = genericStocks.reduce((sum, s) => sum + parseFloat(s.quantity), 0);
                          const genericName = genericsMap[item.generic_id] || 'Generic Medicine';
                          
                          return (
                            <li key={`generic-${item.generic_id}`} className="text-gray-800">
                              <div className="mb-2 p-2 bg-blue-50 border border-blue-200 rounded">
                                <span className="text-sm text-blue-800 font-medium">
                                  ℹ️ Requested: <span className="font-bold">Generic Category - {genericName}</span>
                                </span>
                              </div>
                              <span className="text-base font-bold text-indigo-700">{genericName}</span>
                              <br />
                              <span className="text-blue-700 font-medium text-sm">Medicines under this category available in stock:</span>
                              <ul className="ml-4 mt-1 space-y-1">
                                {genericStocks.map((stock, idx) => (
                                  <li key={idx} className="text-sm text-gray-700">
                                    • <span className="font-semibold">{stock.medicine_name}</span> <span className="text-xs">({stock.dosage})</span>: <span className="font-medium">{stock.quantity} {stock.unit_type}</span>
                                  </li>
                                ))}
                              </ul>
                              <span className="text-green-700 font-semibold">Total Available: {totalQuantity}</span>
                              <br />
                              <span className="text-green-700 font-medium">Required: {item.quantity_requested}</span>
                            </li>
                          );
                        }
                      })}
                    </ul>
                  </div>

                  {/* Distance info */}
                  {pharmacy.distance_km !== undefined && (
                    <div className="mb-4">
                      <p className="text-sm text-gray-900">Distance: {pharmacy.distance_km !== null ? `${pharmacy.distance_km} km` : 'N/A'}</p>
                      <p className="text-sm text-gray-900">ETA: {pharmacy.time_min !== null ? `${pharmacy.time_min} min` : 'N/A'}</p>
                      <p className="text-sm text-gray-900">Category: {pharmacy.category}</p>
                      {pharmacy.dest_coord && (
                        <p className="text-sm text-gray-800">Lat: {pharmacy.dest_coord.lat} | Lon: {pharmacy.dest_coord.lon}</p>
                      )}
                    </div>
                  )}

                  <div className="flex justify-end">
                    <button
                      onClick={() => handleSendOrder(pharmacy.pharmacy_id, pharmacy.name, false)}
                      disabled={sendingOrder === `pharmacy_${pharmacy.pharmacy_id}`}
                      className={`px-4 py-2 text-white rounded transition-colors ${
                        sendingOrder === `pharmacy_${pharmacy.pharmacy_id}`
                          ? 'bg-gray-400 cursor-not-allowed'
                          : 'bg-green-600 hover:bg-green-700'
                      }`}
                    >
                      {sendingOrder === `pharmacy_${pharmacy.pharmacy_id}` ? (
                        <span className="flex items-center">
                          <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                          </svg>
                          Sending...
                        </span>
                      ) : (
                        'Send Order to this Pharmacy'
                      )}
                    </button>
                  </div>
                </div>
              </div>
            ))}
                </div>
              </div>
            )}

            {/* Warehouses Section */}
            {warehouses.length > 0 && (
              <div className="mb-8">
                <h2 className="text-2xl font-semibold text-gray-900 mb-4">District Drug Warehouses ({warehouses.length})</h2>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {warehouses.map((warehouse) => (
              <div
                key={warehouse.warehouse_id}
                className="bg-blue-50 rounded-lg shadow-md hover:shadow-lg transition-shadow duration-200 border-2 border-blue-200"
              >
                <div className="p-6">
                  <div className="mb-4">
                    <div className="flex items-center mb-2">
                      <svg className="w-5 h-5 text-blue-600 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 14v3m4-3v3m4-3v3M3 21h18M3 10h18M3 7l9-4 9 4M4 10h16v11H4V10z" />
                      </svg>
                      <h3 className="text-lg font-semibold text-blue-900">
                        {warehouse.name} (Warehouse)
                      </h3>
                    </div>
                    <p className="text-sm text-gray-800">{warehouse.address}</p>
                    <p className="text-sm text-gray-800">District: {warehouse.district}</p>
                    <p className="text-sm text-gray-800">Block: {warehouse.block}</p>
                    <p className="text-sm text-blue-900 font-medium mt-2">Warehouse Stock Available</p>
                    <p className="text-sm text-gray-800">Contact: <span className="font-bold">{warehouse.contact_number}</span></p>
                  </div>

                  <div className="mb-4">
                    <h4 className="text-md font-medium text-gray-900 mb-2">Available Stock</h4>
                    <ul className="space-y-3">
                      {warehouse.requestItems.map((item) => {
                        // Handle alternative medicine request
                        if (item.is_alternative && item.alternative_generic_id) {
                          const alternativeStocks = warehouse.stocks.filter(s => s.generic_id === item.alternative_generic_id);
                          const totalQuantity = alternativeStocks.reduce((sum, s) => sum + parseFloat(s.quantity), 0);
                          const genericName = genericsMap[item.alternative_generic_id] || 'Generic Medicine';
                          const originalMedicineName = medicines[item.original_medicine_id] || 'Requested Medicine';
                          
                          return (
                            <li key={`alt-${item.original_medicine_id}`} className="text-gray-800">
                              <div className="mb-2 p-2 bg-yellow-50 border border-yellow-200 rounded">
                                <span className="text-sm text-yellow-800 font-medium">
                                  ⚠️ Alternative for: <span className="font-bold">{originalMedicineName}</span>
                                </span>
                              </div>
                              <span className="text-base font-bold text-indigo-700">{genericName} Category</span>
                              <br />
                              <span className="text-blue-700 font-medium text-sm">Available alternative medicines:</span>
                              <ul className="ml-4 mt-1 space-y-1">
                                {alternativeStocks.map((stock, idx) => (
                                  <li key={idx} className="text-sm text-gray-700">
                                    • <span className="font-semibold">{stock.medicine_name}</span> <span className="text-xs">({stock.dosage})</span>: <span className="font-medium">{stock.quantity} {stock.unit_type}</span>
                                  </li>
                                ))}
                              </ul>
                              <span className="text-green-700 font-semibold">Total Available: {totalQuantity}</span>
                              <br />
                              <span className="text-green-700 font-medium">Required: {item.quantity_requested}</span>
                            </li>
                          );
                        }
                        // Handle specific medicine request
                        else if (item.medicine_id) {
                          const stock = warehouse.stocks.filter(s => s.medicine_id === item.medicine_id);
                          const totalQuantity = stock.reduce((sum, s) => sum + parseFloat(s.quantity), 0);
                          const medicine = stock[0];

                          return (
                            <li key={item.medicine_id} className="text-gray-800">
                              <span className="text-base font-semibold">{medicine.medicine_name}</span> <span className="text-sm">({medicine.dosage})</span>: <span className="font-medium">{totalQuantity} {medicine.unit_type}</span>
                              <br />
                              <span className="text-green-700 font-medium">Required: {item.quantity_requested}</span>
                            </li>
                          );
                        } 
                        // Handle generic medicine request
                        else if (item.generic_id) {
                          const genericStocks = warehouse.stocks.filter(s => s.generic_id === item.generic_id);
                          const totalQuantity = genericStocks.reduce((sum, s) => sum + parseFloat(s.quantity), 0);
                          const genericName = genericsMap[item.generic_id] || 'Generic Medicine';
                          
                          return (
                            <li key={`generic-${item.generic_id}`} className="text-gray-800">
                              <div className="mb-2 p-2 bg-blue-50 border border-blue-200 rounded">
                                <span className="text-sm text-blue-800 font-medium">
                                  ℹ️ Requested: <span className="font-bold">Generic Category - {genericName}</span>
                                </span>
                              </div>
                              <span className="text-base font-bold text-indigo-700">{genericName}</span>
                              <br />
                              <span className="text-blue-700 font-medium text-sm">Medicines under this category available in stock:</span>
                              <ul className="ml-4 mt-1 space-y-1">
                                {genericStocks.map((stock, idx) => (
                                  <li key={idx} className="text-sm text-gray-700">
                                    • <span className="font-semibold">{stock.medicine_name}</span> <span className="text-xs">({stock.dosage})</span>: <span className="font-medium">{stock.quantity} {stock.unit_type}</span>
                                  </li>
                                ))}
                              </ul>
                              <span className="text-green-700 font-semibold">Total Available: {totalQuantity}</span>
                              <br />
                              <span className="text-green-700 font-medium">Required: {item.quantity_requested}</span>
                            </li>
                          );
                        }
                      })}
                    </ul>
                  </div>

                  {/* Distance info */}
                  {warehouse.distance_km !== undefined && (
                    <div className="mb-4">
                      <p className="text-sm text-gray-900">Distance: {warehouse.distance_km !== null ? `${warehouse.distance_km} km` : 'N/A'}</p>
                      <p className="text-sm text-gray-900">ETA: {warehouse.time_min !== null ? `${warehouse.time_min} min` : 'N/A'}</p>
                      <p className="text-sm text-gray-900">Category: {warehouse.category}</p>
                      {warehouse.dest_coord && (
                        <p className="text-sm text-gray-800">Lat: {warehouse.dest_coord.lat} | Lon: {warehouse.dest_coord.lon}</p>
                      )}
                    </div>
                  )}

                  <div className="flex justify-end">
                    <button
                      onClick={() => handleSendOrder(warehouse.warehouse_id, warehouse.name, true)}
                      disabled={sendingOrder === `warehouse_${warehouse.warehouse_id}`}
                      className={`px-4 py-2 text-white rounded transition-colors ${
                        sendingOrder === `warehouse_${warehouse.warehouse_id}`
                          ? 'bg-gray-400 cursor-not-allowed'
                          : 'bg-blue-600 hover:bg-blue-700'
                      }`}
                    >
                      {sendingOrder === `warehouse_${warehouse.warehouse_id}` ? (
                        <span className="flex items-center">
                          <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                          </svg>
                          Sending...
                        </span>
                      ) : (
                        'Send Order to this Warehouse'
                      )}
                    </button>
                  </div>
                </div>
              </div>
            ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </>
  );
};

export default PharmacySearch;