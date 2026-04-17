import dynamic from "next/dynamic";
import { useRouter } from "next/router";
import { useEffect, useState } from "react";

// Dynamically import Leaflet to avoid SSR issues
const MapComponent = dynamic(() => import("./components/DeliveryRouteMap"), {
  ssr: false,
  loading: () => <div className="w-full h-full flex items-center justify-center bg-gray-100">Loading map...</div>
});

const OptimizedDisposalRoute = ({ logout }) => {
  const router = useRouter();
  const [routeData, setRouteData] = useState(null);
  const [batchData, setBatchData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    const checkToken = async () => {
      const token = localStorage.getItem("token");
      if (!token) {
        router.push("/login");
      }
    };
    checkToken();
  }, [router]);

  useEffect(() => {
    const fetchRouteData = async () => {
      try {
        const { batch_id } = router.query;

        if (!batch_id) {
          setError("Missing batch_id");
          setLoading(false);
          return;
        }

        // Calculate route on-the-fly from batch details
        const response = await fetch(`/api/getDisposalBatchRoute?batch_id=${batch_id}`);
        const data = await response.json();

        if (!data.success || !data.route) {
          setError(data.message || data.error || "Failed to calculate route");
          setLoading(false);
          return;
        }

        const routeInfo = data.route;

        setRouteData({
          warehouse: routeInfo.warehouse,
          pharmacies: routeInfo.pharmacies,
          route: {
            distance_km: routeInfo.total_distance,
            duration_minutes: routeInfo.duration_minutes,
            geometry: routeInfo.geometry
          },
          pharmacy_count: routeInfo.pharmacy_count
        });

        setLoading(false);
      } catch (err) {
        console.error("Error fetching route:", err);
        setError("Error loading route data");
        setLoading(false);
      }
    };

    if (router.isReady) {
      fetchRouteData();
    }
  }, [router.isReady, router.query]);

  const handlePrint = () => {
    window.print();
  };

  const handleBack = () => {
    router.back();
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gradient-to-br from-indigo-100 to-indigo-50">
        <div className="text-center">
          <svg className="w-16 h-16 text-indigo-600 animate-spin mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
          </svg>
          <h2 className="text-2xl font-bold text-gray-800 mb-2">Loading Disposal Route...</h2>
          <p className="text-gray-600">Please wait while we load the route details</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gradient-to-br from-red-100 to-red-50">
        <div className="text-center bg-white rounded-2xl shadow-xl p-8 max-w-md">
          <svg className="w-16 h-16 text-red-600 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4v2m0 4v2m0-12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <h2 className="text-2xl font-bold text-gray-800 mb-2">Error</h2>
          <p className="text-gray-600 mb-6">{error}</p>
          <button
            onClick={handleBack}
            className="px-6 py-3 bg-indigo-600 text-white font-semibold rounded-lg hover:bg-indigo-700 transition-colors"
          >
            Go Back
          </button>
        </div>
      </div>
    );
  }

  if (!routeData) {
    return null;
  }

  return (
    <div className="flex h-screen bg-gray-100">
      {/* Sidebar */}
      <div className="w-96 bg-white shadow-xl overflow-y-auto border-r-2 border-gray-200">
        {/* Header */}
        <div className="sticky top-0 bg-gradient-to-r from-red-600 to-red-700 text-white p-6 shadow-lg z-10">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h1 className="text-2xl font-bold">Disposal Route</h1>
              <p className="text-red-100 text-sm mt-1">Batch #{batchData?.batch_id}</p>
            </div>
            <button
              onClick={handleBack}
              className="p-2 hover:bg-white hover:bg-opacity-20 rounded-lg transition-colors"
              title="Go back"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
              </svg>
            </button>
          </div>
          <div className="bg-red-500 bg-opacity-30 rounded-lg p-3">
            <p className="text-sm font-semibold">{batchData?.requests?.length || 0} pharmacies in this batch</p>
          </div>
        </div>

        {/* Batch Info */}
        <div className="p-6 border-b-2 border-gray-100">
          <div className="grid grid-cols-2 gap-3 mb-3">
            <div>
              <p className="text-xs text-gray-600 font-semibold">Status</p>
              <p className="text-lg font-bold text-gray-900 capitalize">{batchData?.status}</p>
            </div>
            <div>
              <p className="text-xs text-gray-600 font-semibold">Created</p>
              <p className="text-sm text-gray-700">
                {batchData?.created_date ? new Date(batchData.created_date).toLocaleDateString() : "N/A"}
              </p>
            </div>
          </div>
        </div>

        {/* Route Summary */}
        <div className="px-6 py-4 bg-gradient-to-r from-orange-50 to-red-50 border-b-2 border-gray-100">
          <div className="grid grid-cols-2 gap-4">
            <div className="bg-white rounded-lg p-3 shadow-sm">
              <p className="text-xs font-medium text-gray-600 mb-1">📏 Total Distance</p>
              <p className="text-2xl font-bold text-orange-600">{routeData.route.distance_km}</p>
              <p className="text-xs text-gray-500">kilometers</p>
            </div>
            <div className="bg-white rounded-lg p-3 shadow-sm">
              <p className="text-xs font-medium text-gray-600 mb-1">⏱️ Total Time</p>
              <p className="text-2xl font-bold text-red-600">{routeData.route.duration_minutes}</p>
              <p className="text-xs text-gray-500">minutes</p>
            </div>
          </div>
        </div>

        {/* Pharmacies in Order */}
        <div className="p-6">
          <h2 className="text-lg font-bold text-gray-900 mb-4">Pickup Sequence</h2>
          <div className="space-y-3">
            {routeData.pharmacies && routeData.pharmacies.length > 0 ? (
              routeData.pharmacies.map((pharmacy, index) => (
                <div key={pharmacy.pharmacy_id || index} className="border-l-4 border-red-500 pl-4 py-3 bg-red-50 rounded-r-lg">
                  <div className="flex items-start space-x-3">
                    <div className="flex-shrink-0">
                      <div className="w-8 h-8 bg-red-600 text-white rounded-full flex items-center justify-center font-bold text-sm">
                        {pharmacy.visit_order || index + 1}
                      </div>
                    </div>
                    <div className="flex-1">
                      <h3 className="font-bold text-gray-900">{pharmacy.pharmacy_name}</h3>
                      <p className="text-xs text-gray-700 mt-1 leading-relaxed">{pharmacy.address}</p>
                      {pharmacy.district && (
                        <p className="text-xs text-gray-600 mt-1">{pharmacy.district}</p>
                      )}
                      {pharmacy.disposal_token && (
                        <p className="text-xs font-mono text-gray-600 mt-2 bg-gray-100 px-2 py-1 rounded">
                          Token: {pharmacy.disposal_token}
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              ))
            ) : (
              <p className="text-gray-500 text-sm">No pharmacies in route</p>
            )}
          </div>
        </div>

        {/* Action Buttons */}
        <div className="sticky bottom-0 bg-white border-t-2 border-gray-200 p-4 space-y-2">
          <button
            onClick={handlePrint}
            className="w-full px-4 py-3 bg-blue-600 text-white font-semibold rounded-lg hover:bg-blue-700 transition-colors flex items-center justify-center space-x-2"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4H7a2 2 0 01-2-2v-4a2 2 0 012-2h10a2 2 0 012 2v4a2 2 0 01-2 2zm-6-4h.01M7 20h10" />
            </svg>
            <span>Print Route</span>
          </button>
        </div>
      </div>

      {/* Map Area */}
      <div className="flex-1 relative">
        {routeData.route.geometry ? (
          <MapComponent routeData={routeData} />
        ) : (
          <div className="w-full h-full flex items-center justify-center bg-gray-100">
            <div className="text-center">
              <p className="text-gray-500">No map data available</p>
            </div>
          </div>
        )}

        {/* Route Info for Printing */}
        <div id="route-info" className="hidden">
          <h1>Disposal Route - Batch #{batchData?.batch_id}</h1>
          <p>Status: {batchData?.status}</p>
          <p>Created: {batchData?.created_date ? new Date(batchData.created_date).toLocaleString() : "N/A"}</p>
          <h3>Route Summary</h3>
          <p>Total Distance: {routeData.route.distance_km} km</p>
          <p>Total Time: {routeData.route.duration_minutes} minutes</p>
          <h3>Pickup Sequence</h3>
          <ol>
            {routeData.pharmacies.map((pharmacy, index) => (
              <li key={pharmacy.pharmacy_id || index}>
                {pharmacy.visit_order || index + 1}. {pharmacy.pharmacy_name} - {pharmacy.address}
              </li>
            ))}
          </ol>
        </div>
      </div>
    </div>
  );
};

export default OptimizedDisposalRoute;
