import { useRouter } from "next/router";
import { useEffect, useState } from "react";
import { ToastContainer, toast } from "react-toastify";
import "react-toastify/dist/ReactToastify.css";
import useSSE from '../hooks/useSSE';

const DemandPharmacySearch = () => {
  const router = useRouter();
  const [pharmacies, setPharmacies] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const [requestingPharmacy, setRequestingPharmacy] = useState(null);
  const [reqLoading, setReqLoading] = useState(false);
  const [sendingOrder, setSendingOrder] = useState(null); // Track which pharmacy order is being sent to

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
        let url = `/api/eligiblePharmacies?requestId=${requestId}&requestType=demand`;
        if (pharmacyId) url += `&excludePharmacyId=${pharmacyId}`;

        const response = await fetch(url);
        const data = await response.json();

        if (data.success) {
          // first set pharmacies (with stocks/requestItems)
          setPharmacies(data.pharmacies);

          // then request distances and merge into each pharmacy object
          try {
            const distUrl = `/api/getPharmacyDistances?requestId=${requestId}&requestType=demand` + (pharmacyId ? `&excludePharmacyId=${pharmacyId}` : '');
            const distResp = await fetch(distUrl);
            const distJson = await distResp.json();
            if (distJson.success && Array.isArray(distJson.distances)) {
              const distMap = new Map(distJson.distances.map(d => [d.pharmacy_id, d]));
              setPharmacies(prev => prev.map(p => ({ ...p, ...(distMap.get(p.pharmacy_id) || {}) })));
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
  useSSE({ role: 'cmo', id: 'demand-search', onEvent: handleSSEEvent });

  const handleSendOrder = async (pharmacyId, pharmacyName) => {
    try {
      const { requestId } = router.query;
      if (!requestId) {
        toast.error("Request ID not found");
        return;
      }

      setSendingOrder(pharmacyId);

      const response = await fetch('/api/sendDemandOrderToPharmacy', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          requestId: requestId,
          acceptingPharmacyId: pharmacyId // Use single pharmacy ID like emergency requests
        }),
      });

      const data = await response.json();

      if (data.success) {
        toast.success(`Demand order successfully sent to ${pharmacyName}!`);
        // Redirect back to admin dashboard after a delay
        setTimeout(() => {
          router.push('/admin');
        }, 2000);
      } else {
        toast.error(data.message || "Failed to send demand order");
      }
    } catch (error) {
      console.error("Error sending demand order:", error);
      toast.error("Error sending demand order to pharmacy");
    } finally {
      setSendingOrder(null);
    }
  };

  return (
    <>
      <ToastContainer position="top-center" autoClose={1500} hideProgressBar />
      <div className="min-h-screen bg-gray-100 py-6 px-4">
        <div className="flex justify-between items-center mb-8">
          <h1 className="text-3xl font-bold text-gray-900">Available Pharmacies for Demand Request</h1>
          <button
            onClick={() => router.push('/admin')}
            className="px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 transition-colors"
          >
            Back to Dashboard
          </button>
        </div>
        
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
            <p className="text-gray-800">Loading available pharmacies...</p>
          </div>
        ) : pharmacies.length === 0 ? (
          <div className="flex justify-center items-center h-64">
            <p className="text-gray-800">No pharmacies found with sufficient stock for this demand request.</p>
          </div>
        ) : (
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
                    <p className="text-sm text-gray-900">Please contact the pharmacy for more details and sending demand order to that Pharmacy.</p>
                    <p className="text-sm text-gray-800">Contact: <span className="font-bold">{pharmacy.contact_number}</span></p>
                  </div>

                  <div className="mb-4">
                    <h4 className="text-md font-medium text-gray-900 mb-2">Available Stock</h4>
                    <ul className="space-y-2">
                      {pharmacy.requestItems.map((item) => {
                        const stock = pharmacy.stocks.filter(s => s.medicine_id === item.medicine_id);
                        const totalQuantity = stock.reduce((sum, s) => sum + parseFloat(s.quantity), 0);
                        const medicine = stock[0];

                        return (
                          <li key={item.medicine_id} className="text-sm text-gray-800">
                            {medicine.medicine_name} ({medicine.dosage}): {totalQuantity} {medicine.unit_type}
                            <br />
                            <span className="text-green-800">Required: {item.quantity_requested}</span>
                          </li>
                        );
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
                      onClick={() => handleSendOrder(pharmacy.pharmacy_id, pharmacy.name)}
                      disabled={sendingOrder === pharmacy.pharmacy_id}
                      className={`px-4 py-2 text-white rounded transition-colors ${
                        sendingOrder === pharmacy.pharmacy_id
                          ? 'bg-gray-400 cursor-not-allowed'
                          : 'bg-green-600 hover:bg-green-700'
                      }`}
                    >
                      {sendingOrder === pharmacy.pharmacy_id ? (
                        <span className="flex items-center">
                          <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                          </svg>
                          Sending...
                        </span>
                      ) : (
                        'Send Demand Order to this Pharmacy'
                      )}
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
};

export default DemandPharmacySearch;