import { useRouter } from "next/router";
import { useEffect, useState } from "react";
import { ToastContainer } from "react-toastify";
import "react-toastify/dist/ReactToastify.css";

const OrderConfirmation = () => {
  const router = useRouter();
  const [confirmationData, setConfirmationData] = useState(null);
  const [countdown, setCountdown] = useState(5);

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
    if (router.query.data) {
      try {
        const decodedData = JSON.parse(decodeURIComponent(router.query.data));
        setConfirmationData(decodedData);
      } catch (error) {
        console.error("Error parsing confirmation data:", error);
        router.push("/admin");
      }
    }
  }, [router.query]);

  useEffect(() => {
    if (countdown > 0) {
      const timer = setTimeout(() => setCountdown(countdown - 1), 1000);
      return () => clearTimeout(timer);
    } else {
      router.push("/admin");
    }
  }, [countdown, router]);

  if (!confirmationData) {
    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">Loading confirmation details...</p>
        </div>
      </div>
    );
  }

  return (
    <>
      <ToastContainer position="top-center" autoClose={1500} hideProgressBar />
      <div className="min-h-screen bg-gray-100 py-6 px-4">
        <div className="max-w-4xl mx-auto">
          {/* Success Header */}
          <div className="bg-white rounded-lg shadow-md p-8 mb-6">
            <div className="text-center">
              <div className="mx-auto flex items-center justify-center h-16 w-16 rounded-full bg-green-100 mb-4">
                <svg className="h-8 w-8 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <h1 className="text-3xl font-bold text-gray-900 mb-2">Order Successfully Sent!</h1>
              <p className="text-lg text-gray-600">Emergency request has been forwarded to the accepting pharmacy</p>
            </div>
          </div>

          {/* Order Details */}
          <div className="bg-white rounded-lg shadow-md p-6 mb-6">
            <h2 className="text-xl font-semibold text-gray-900 mb-6">Order Details</h2>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
              {/* Request Information */}
              <div className="bg-blue-50 p-4 rounded-lg">
                <h3 className="text-lg font-medium text-blue-900 mb-3">Request Information</h3>
                <div className="space-y-2">
                  <p className="text-sm">
                    <span className="font-medium text-blue-800">Request ID:</span>
                    <span className="ml-2 text-blue-700 font-mono">#{confirmationData.requestId}</span>
                  </p>
                  <p className="text-sm">
                    <span className="font-medium text-blue-800">Requesting Pharmacy:</span>
                    <span className="ml-2 text-blue-700">{confirmationData.requestingPharmacyName}</span>
                  </p>
                  <p className="text-sm">
                    <span className="font-medium text-blue-800">Requesting Pharmacy ID:</span>
                    <span className="ml-2 text-blue-700 font-mono">#{confirmationData.requestingPharmacyId}</span>
                  </p>
                </div>
              </div>

              {/* Accepting Pharmacy */}
              <div className="bg-green-50 p-4 rounded-lg">
                <h3 className="text-lg font-medium text-green-900 mb-3">Accepting Pharmacy</h3>
                <div className="space-y-2">
                  <p className="text-sm">
                    <span className="font-medium text-green-800">Pharmacy Name:</span>
                    <span className="ml-2 text-green-700">{confirmationData.acceptingPharmacyName}</span>
                  </p>
                  <p className="text-sm">
                    <span className="font-medium text-green-800">Pharmacy ID:</span>
                    <span className="ml-2 text-green-700 font-mono">#{confirmationData.acceptingPharmacyId}</span>
                  </p>
                  <p className="text-sm">
                    <span className="font-medium text-green-800">Status:</span>
                    <span className="ml-2 inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
                      Order Sent
                    </span>
                  </p>
                </div>
              </div>
            </div>

            {/* Medicines Requested */}
            <div className="mb-6">
              <h3 className="text-lg font-medium text-gray-900 mb-4">Medicines Requested</h3>
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Medicine ID
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Quantity Requested
                      </th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {confirmationData.medicines.map((medicine, index) => (
                      <tr key={index} className="hover:bg-gray-50">
                        <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                          Medicine #{medicine.medicine_id}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                          {medicine.quantity_requested} units
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              
              {/* Summary */}
              <div className="mt-4 bg-gray-50 p-4 rounded-lg">
                <p className="text-sm font-medium text-gray-900">
                  Total Medicines: {confirmationData.medicines.length}
                </p>
                <p className="text-sm text-gray-600">
                  Total Quantity: {confirmationData.medicines.reduce((sum, med) => sum + parseInt(med.quantity_requested || 0), 0)} units
                </p>
              </div>
            </div>
          </div>

          {/* Auto Redirect Notice */}
          <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 mb-6">
            <div className="flex items-center">
              <svg className="h-5 w-5 text-yellow-400 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <p className="text-sm text-yellow-800">
                You will be automatically redirected to the admin dashboard in <span className="font-bold">{countdown}</span> seconds.
              </p>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex justify-center space-x-4">
            <button
              onClick={() => router.push("/admin")}
              className="px-6 py-3 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors duration-200 flex items-center"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2H5a2 2 0 00-2-2z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 5a2 2 0 012-2h4a2 2 0 012 2v4H8V5z" />
              </svg>
              Go to Admin Dashboard Now
            </button>
            <button
              onClick={() => router.push("/emergencyRequests")}
              className="px-6 py-3 bg-gray-600 text-white rounded-lg hover:bg-gray-700 transition-colors duration-200 flex items-center"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v3m0 0v3m0-3h3m-3 0H9m12 0a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              View Emergency Requests
            </button>
          </div>
        </div>
      </div>
    </>
  );
};

export default OrderConfirmation;