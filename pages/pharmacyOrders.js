import { useRouter } from "next/router";
import { useEffect, useState } from "react";
import { ToastContainer, toast } from "react-toastify";
import "react-toastify/dist/ReactToastify.css";
import useSSE from '../hooks/useSSE';

const PharmacyOrders = () => {
  const router = useRouter();
  const [prescriptions, setPrescriptions] = useState([]);
  const [processedOrders, setProcessedOrders] = useState([]);
  const [selectedPrescription, setSelectedPrescription] = useState(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [activeTab, setActiveTab] = useState('available'); // 'available' or 'processed'
  const [refreshTrigger, setRefreshTrigger] = useState(0);

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
    const fetchPrescriptions = async () => {
      try {
        const { pharmacy_id } = router.query;
        if (!pharmacy_id) return;

        // Fetch available prescriptions
        const response = await fetch(`/api/pharmacyPrescriptions?pharmacy_id=${pharmacy_id}`);
        const data = await response.json();

        if (data.success) {
          setPrescriptions(data.prescriptions);
        } else {
          toast.error("Failed to fetch prescriptions");
        }

        // Fetch processed orders
        const processedResponse = await fetch(`/api/fetchProcessedOrders?pharmacy_id=${pharmacy_id}`);
        const processedData = await processedResponse.json();

        if (processedData.success) {
          setProcessedOrders(processedData.prescriptions);
        } else {
          console.error("Failed to fetch processed orders");
        }
      } catch (error) {
        console.error("Error fetching prescriptions:", error);
        toast.error("Error fetching prescriptions");
      }
    };

    if (router.query.pharmacy_id) {
      fetchPrescriptions();
    }
  }, [router.query, refreshTrigger]);

  // Real-time updates — refresh when a prescription is served at this pharmacy
  // (moves from available to processed) or a new one becomes available.
  const handleSSEEvent = (event) => {
    if (event.type === 'prescription:served') {
      setRefreshTrigger(prev => prev + 1);
      toast.info('Prescription list updated', { autoClose: 2000 });
    }
  };
  useSSE({ role: 'pharmacy', id: router.query.pharmacy_id, onEvent: handleSSEEvent });

  const handleAcceptOrder = (prescription) => {
    try {
      const encodedPrescription = encodeURIComponent(JSON.stringify(prescription));
      router.push(`/selectMedicineStocks?pharmacy_id=${router.query.pharmacy_id}&prescription=${encodedPrescription}`);
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
        <div className="flex items-center justify-between mb-8">
          <h1 className="text-3xl font-bold text-gray-900">Pharmacy Orders</h1>
          <button
            onClick={() => router.push(`/user?pharmacy_id=${router.query.pharmacy_id}`)}
            className="px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 transition-colors duration-200 flex items-center"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            Back to Dashboard
          </button>
        </div>

        {/* Tab Navigation */}
        <div className="mb-6">
          <div className="border-b border-gray-200">
            <nav className="-mb-px flex space-x-8">
              <button
                onClick={() => setActiveTab('available')}
                className={`py-2 px-1 border-b-2 font-medium text-sm ${
                  activeTab === 'available'
                    ? 'border-blue-500 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
              >
                Available Orders ({prescriptions.length})
              </button>
              <button
                onClick={() => setActiveTab('processed')}
                className={`py-2 px-1 border-b-2 font-medium text-sm ${
                  activeTab === 'processed'
                    ? 'border-blue-500 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
              >
                Processed Orders ({processedOrders.length})
              </button>
            </nav>
          </div>
        </div>
        
        {/* Available Orders */}
        {activeTab === 'available' && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {prescriptions.length > 0 ? (
              prescriptions.map((prescription) => (
                <div
                  key={prescription.prescription_id}
                  className="bg-white rounded-lg shadow-md hover:shadow-lg transition-shadow duration-200"
                >
                  <div className="p-6">
                    <div className="flex justify-between items-start mb-4">
                      <div>
                        <h3 className="text-lg font-semibold text-gray-900">
                          Patient: {prescription.patient_name}
                        </h3>
                        <p className="text-sm text-gray-600">
                          Dr. {prescription.doctor_name}
                        </p>
                      </div>
                      <span className="px-3 py-1 text-sm font-medium text-blue-800 bg-blue-100 rounded-full">
                        OPD #{prescription.opd_number}
                      </span>
                    </div>

                    <div className="mb-4">
                      <h4 className="text-md font-medium text-gray-700 mb-2">Diagnosis</h4>
                      <p className="text-gray-600">{prescription.diagnosis || 'N/A'}</p>
                    </div>

                    <div className="mb-4">
                      <h4 className="text-md font-medium text-gray-700 mb-2">Medicines</h4>
                      <ul className="space-y-2">
                        {prescription.medicines.slice(0, 2).map((medicine, index) => (
                          <li key={index} className="text-sm text-gray-600">
                            {medicine.name} - {medicine.dosage ? `${medicine.dosage} ${medicine.unit}` : `${medicine.unit}`} - {medicine.quantity}
                          </li>
                        ))}
                        {prescription.medicines.length > 2 && (
                          <li className="text-sm text-blue-600">
                            +{prescription.medicines.length - 2} more medicines
                          </li>
                        )}
                      </ul>
                    </div>

                    <div className="flex justify-end">
                      <button
                        onClick={() => openModal(prescription)}
                        className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors"
                      >
                        View Details
                      </button>
                    </div>
                  </div>
                </div>
              ))
            ) : (
              <div className="col-span-full text-center py-12">
                <svg className="mx-auto h-12 w-12 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                <h3 className="mt-2 text-sm font-medium text-gray-900">No available orders</h3>
                <p className="mt-1 text-sm text-gray-500">No new prescriptions are available for processing.</p>
              </div>
            )}
          </div>
        )}

        {/* Processed Orders */}
        {activeTab === 'processed' && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {processedOrders.length > 0 ? (
              processedOrders.map((order) => (
                <div
                  key={order.prescription_id}
                  className="bg-white rounded-lg shadow-md border-l-4 border-green-500"
                >
                  <div className="p-6">
                    <div className="flex justify-between items-start mb-4">
                      <div>
                        <h3 className="text-lg font-semibold text-gray-900">
                          Patient: {order.patient_name}
                        </h3>
                        <p className="text-sm text-gray-600">
                          Dr. {order.doctor_name}
                        </p>
                        <p className="text-sm text-green-600 font-medium">
                          ✓ Processed by {order.pharmacy_name}
                        </p>
                      </div>
                      <div className="text-right">
                        <span className="px-3 py-1 text-sm font-medium text-blue-800 bg-blue-100 rounded-full">
                          OPD #{order.opd_number}
                        </span>
                        <p className="text-xs text-gray-500 mt-1">
                          {new Date(order.created_at).toLocaleDateString('en-GB')}
                        </p>
                      </div>
                    </div>

                    <div className="mb-4">
                      <h4 className="text-md font-medium text-gray-700 mb-2">Diagnosis</h4>
                      <p className="text-gray-600">{order.diagnosis || 'N/A'}</p>
                    </div>

                    <div className="mb-4">
                      <h4 className="text-md font-medium text-gray-700 mb-2">Medicines</h4>
                      <ul className="space-y-2">
                        {order.medicines.slice(0, 2).map((medicine, index) => (
                          <li key={index} className="text-sm text-gray-600">
                            {medicine.name} - {medicine.dosage ? `${medicine.dosage} ${medicine.unit}` : `${medicine.unit}`} - {medicine.quantity}
                          </li>
                        ))}
                        {order.medicines.length > 2 && (
                          <li className="text-sm text-blue-600">
                            +{order.medicines.length - 2} more medicines
                          </li>
                        )}
                      </ul>
                    </div>

                    <div className="flex justify-end">
                      <button
                        onClick={() => openModal(order)}
                        className="px-4 py-2 bg-gray-600 text-white rounded hover:bg-gray-700 transition-colors"
                      >
                        View Details
                      </button>
                    </div>
                  </div>
                </div>
              ))
            ) : (
              <div className="col-span-full text-center py-12">
                <svg className="mx-auto h-12 w-12 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v10a2 2 0 002 2h8a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                </svg>
                <h3 className="mt-2 text-sm font-medium text-gray-900">No processed orders</h3>
                <p className="mt-1 text-sm text-gray-500">You haven't processed any orders yet.</p>
              </div>
            )}
          </div>
        )}

        {/* Detailed Modal */}
        {isModalOpen && selectedPrescription && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-lg shadow-xl p-6 w-full max-w-2xl">
              <div className="flex justify-between items-center mb-4">
                <h3 className="text-xl font-semibold text-gray-900">
                  Prescription Details
                </h3>
                <button
                  onClick={() => setIsModalOpen(false)}
                  className="text-gray-500 hover:text-gray-700"
                >
                  <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              <div className="space-y-4">
                <div>
                  <h4 className="text-sm font-medium text-gray-700">Patient Information</h4>
                  <p className="text-gray-900">{selectedPrescription.patient_name}</p>
                  <p className="text-gray-600">OPD #{selectedPrescription.opd_number}</p>
                </div>

                <div>
                  <h4 className="text-sm font-medium text-gray-700">Doctor</h4>
                  <p className="text-gray-900">Dr. {selectedPrescription.doctor_name}</p>
                </div>

                <div>
                  <h4 className="text-sm font-medium text-gray-700">Diagnosis</h4>
                  <p className="text-gray-900">{selectedPrescription.diagnosis || 'N/A'}</p>
                </div>

                <div>
                  <h4 className="text-sm font-medium text-gray-700">Medicines</h4>
                  <div className="mt-2">
                    <table className="min-w-full divide-y divide-gray-200">
                      <thead>
                        <tr>
                          <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Medicine</th>
                          <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Quantity</th>
                          <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Frequency</th>
                          <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Duration</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-200">
                        {selectedPrescription.medicines.map((medicine, index) => (
                          <tr key={index}>
                            <td className="px-3 py-2 text-sm text-gray-900">{medicine.name}{medicine.dosage ? ` (${medicine.dosage} ${medicine.unit})` : ''}</td>
                            <td className="px-3 py-2 text-sm text-gray-900">{medicine.quantity}</td>
                            <td className="px-3 py-2 text-sm text-gray-900">{medicine.frequency}</td>
                            <td className="px-3 py-2 text-sm text-gray-900">{medicine.duration_days} days</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                <div className="flex justify-end space-x-3 mt-6">
                  <button
                    onClick={() => setIsModalOpen(false)}
                    className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-md hover:bg-gray-200"
                  >
                    Close
                  </button>
                  <button
                    onClick={() => handleAcceptOrder(selectedPrescription)}
                    className="px-4 py-2 text-sm font-medium text-white bg-green-600 rounded-md hover:bg-green-700"
                  >
                    Accept Order
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  );
};

export default PharmacyOrders;