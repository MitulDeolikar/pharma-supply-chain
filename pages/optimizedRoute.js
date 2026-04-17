import dynamic from "next/dynamic";
import { useRouter } from "next/router";
import { useEffect, useState } from "react";

// Dynamically import Leaflet to avoid SSR issues
const MapComponent = dynamic(() => import("./components/DeliveryRouteMap"), {
  ssr: false,
  loading: () => <div className="w-full h-full flex items-center justify-center bg-gray-100">Loading map...</div>
});

const OptimizedRoute = ({ logout }) => {
  const router = useRouter();
  const [routeData, setRouteData] = useState(null);
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
    const fetchRoute = async () => {
      try {
        const { warehouse_id, pharmacy_ids } = router.query;

        if (!warehouse_id || !pharmacy_ids) {
          setError("Missing warehouse_id or pharmacy_ids");
          setLoading(false);
          return;
        }

        const response = await fetch(
          `/api/optimizeDeliveryRoute?warehouse_id=${warehouse_id}&pharmacy_ids=${pharmacy_ids}`
        );

        const data = await response.json();

        if (!data.success) {
          setError(data.message || "Failed to optimize route");
          setLoading(false);
          return;
        }

        setRouteData(data);
        setLoading(false);
      } catch (err) {
        console.error("Error fetching route:", err);
        setError("Error calculating route");
        setLoading(false);
      }
    };

    if (router.isReady) {
      fetchRoute();
    }
  }, [router.isReady, router.query]);

  const handlePrint = () => {
    window.print();
  };

  const handleDownloadPDF = () => {
    // Simple implementation - could be enhanced with html2pdf library
    const content = document.getElementById("route-info");
    if (content) {
      const printWindow = window.open("", "", "height=600,width=800");
      printWindow.document.write(content.innerHTML);
      printWindow.document.close();
      printWindow.print();
    }
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
          <h2 className="text-2xl font-bold text-gray-800 mb-2">Calculating Optimal Route...</h2>
          <p className="text-gray-600">Please wait while we optimize your delivery path</p>
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
        <div className="sticky top-0 bg-gradient-to-r from-indigo-600 to-indigo-700 text-white p-6 shadow-lg z-10">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h1 className="text-2xl font-bold">Optimized Route</h1>
              <p className="text-indigo-100 text-sm mt-1">Delivery Schedule</p>
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
        </div>

        {/* Warehouse Info */}
        <div className="p-6 border-b-2 border-gray-100">
          <div className="flex items-start space-x-3 mb-3">
            <div className="flex-shrink-0">
              <div className="w-10 h-10 bg-indigo-100 rounded-full flex items-center justify-center">
                <svg className="w-6 h-6 text-indigo-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" />
                </svg>
              </div>
            </div>
            <div className="flex-1">
              <h3 className="text-lg font-bold text-gray-900">📍 START: Warehouse</h3>
              <p className="text-sm font-semibold text-gray-700 mt-1">{routeData.warehouse.name}</p>
              <p className="text-xs text-gray-600 mt-1">{routeData.warehouse.address}</p>
              <p className="text-xs text-gray-600">{routeData.warehouse.district}</p>
            </div>
          </div>
        </div>

        {/* Route Summary */}
        <div className="px-6 py-4 bg-gradient-to-r from-green-50 to-blue-50 border-b-2 border-gray-100">
          <div className="grid grid-cols-2 gap-4">
            <div className="bg-white rounded-lg p-3 shadow-sm">
              <p className="text-xs font-medium text-gray-600 mb-1">📏 Total Distance</p>
              <p className="text-2xl font-bold text-green-600">{routeData.route.distance_km}</p>
              <p className="text-xs text-gray-500">kilometers</p>
            </div>
            <div className="bg-white rounded-lg p-3 shadow-sm">
              <p className="text-xs font-medium text-gray-600 mb-1">⏱️ Total Time</p>
              <p className="text-2xl font-bold text-blue-600">{routeData.route.duration_minutes}</p>
              <p className="text-xs text-gray-500">minutes</p>
            </div>
          </div>
        </div>

        {/* Pharmacies in Order */}
        <div className="p-6">
          <h2 className="text-lg font-bold text-gray-900 mb-4">Delivery Sequence</h2>
          <div className="space-y-3">
            {routeData.pharmacies.map((pharmacy, index) => (
              <div key={pharmacy.pharmacy_id} className="border-l-4 border-indigo-500 pl-4 py-3 bg-indigo-50 rounded-r-lg">
                <div className="flex items-start space-x-3">
                  <div className="flex-shrink-0">
                    <div className="w-8 h-8 bg-indigo-600 text-white rounded-full flex items-center justify-center font-bold text-sm">
                      {pharmacy.visit_order}
                    </div>
                  </div>
                  <div className="flex-1">
                    <h3 className="font-bold text-gray-900">{pharmacy.pharmacy_name}</h3>
                    <p className="text-xs text-gray-700 mt-1 leading-relaxed">{pharmacy.address}</p>
                    <p className="text-xs text-gray-600 mt-1">{pharmacy.district}</p>
                  </div>
                </div>
              </div>
            ))}
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
        <MapComponent routeData={routeData} />

        {/* Route Info for Printing */}
        <div id="route-info" className="hidden">
          <h1>Optimized Delivery Route</h1>
          <h2>Warehouse: {routeData.warehouse.name}</h2>
          <p>{routeData.warehouse.address}</p>
          <h3>Route Summary</h3>
          <p>Total Distance: {routeData.route.distance_km} km</p>
          <p>Total Time: {routeData.route.duration_minutes} minutes</p>
          <h3>Delivery Sequence</h3>
          <ol>
            {routeData.pharmacies.map((pharmacy) => (
              <li key={pharmacy.pharmacy_id}>
                {pharmacy.visit_order}. {pharmacy.pharmacy_name} - {pharmacy.address}
              </li>
            ))}
          </ol>
        </div>
      </div>
    </div>
  );
};

export default OptimizedRoute;
