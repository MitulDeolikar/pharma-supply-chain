import { useRouter } from "next/router";
import { useEffect, useState } from "react";
import { ToastContainer, toast } from "react-toastify";
import "react-toastify/dist/ReactToastify.css";

const EmergencyRequests = () => {
  const router = useRouter();
  const [requests, setRequests] = useState([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [medicines, setMedicines] = useState([]);
  const [generics, setGenerics] = useState([]);
  const [newRequest, setNewRequest] = useState({
    medicines: [{ type: 'medicine', medicine_id: "", generic_id: "", quantity_requested: "" }],
    remarks: ""
  });

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

  // Fetch emergency requests
  useEffect(() => {
    const fetchRequests = async () => {
      try {
        const { pharmacy_id } = router.query;
        if (!pharmacy_id) return;

        const response = await fetch(`/api/fetchEmergencyRequests?pharmacy_id=${pharmacy_id}`);
        const data = await response.json();

        if (data.success) {
          setRequests(data.requests);
        } else {
          toast.error("Failed to fetch emergency requests");
        }
      } catch (error) {
        console.error("Error fetching requests:", error);
        toast.error("Error fetching requests");
      }
    };

    if (router.query.pharmacy_id) {
      fetchRequests();
    }
  }, [router.query]);

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

  // Fetch generics from dedicated API
  useEffect(() => {
    const fetchGenerics = async () => {
      try {
        const resp = await fetch('/api/getAllGenerics');
        const j = await resp.json();
        if (j.success) setGenerics(j.generics || []);
      } catch (err) {
        console.error('Error fetching generics', err);
      }
    };
    fetchGenerics();
  }, []);

  const handleAddMedicine = () => {
    setNewRequest(prev => ({
      ...prev,
      medicines: [...prev.medicines, { type: 'medicine', medicine_id: "", generic_id: "", quantity_requested: "" }]
    }));
  };

  const handleRemoveMedicine = (index) => {
    setNewRequest(prev => ({
      ...prev,
      medicines: prev.medicines.filter((_, i) => i !== index)
    }));
  };

  const handleMedicineChange = (index, field, value) => {
    const updatedMedicines = [...newRequest.medicines];
    updatedMedicines[index] = {
      ...updatedMedicines[index],
      [field]: value
    };
    setNewRequest(prev => ({
      ...prev,
      medicines: updatedMedicines
    }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      const response = await fetch('/api/createEmergencyRequest', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          pharmacy_id: router.query.pharmacy_id,
          medicines: newRequest.medicines,
          remarks: newRequest.remarks
        }),
      });

      const data = await response.json();

        if (data.success) {
        toast.success("Emergency request created successfully");
        setIsModalOpen(false);
        // Reset form
        setNewRequest({
          medicines: [{ type: 'medicine', medicine_id: "", generic_id: "", quantity_requested: "" }],
          remarks: ""
        });
        // Refresh requests
        const refreshResponse = await fetch(`/api/fetchEmergencyRequests?pharmacy_id=${router.query.pharmacy_id}`);
        const refreshData = await refreshResponse.json();
        if (refreshData.success) {
          setRequests(refreshData.requests);
        }
      } else {
        // Show detailed error message for longer duration
        if (data.message && data.message.includes('already exists in your pharmacy stock')) {
          // Stock validation error - show as warning with details
          toast.warning(
            <div className="whitespace-pre-wrap">
              <strong>⚠️ Request Cannot Be Created</strong>
              <p className="mt-2">{data.message}</p>
              <p className="mt-3 text-xs italic">You already have sufficient stock. Please manage your existing inventory first.</p>
            </div>,
            { autoClose: 8000 }
          );
        } else if (data.details) {
          // Show detailed error if provided
          toast.error(
            <div className="whitespace-pre-wrap">
              <strong>❌ Error Creating Request</strong>
              <p className="mt-2">{data.message || "Failed to create request"}</p>
              {data.details && <p className="mt-2 text-xs">{data.details}</p>}
            </div>,
            { autoClose: 7000 }
          );
        } else {
          toast.error(data.message || "Failed to create request", { autoClose: 5000 });
        }
      }
    } catch (error) {
      console.error("Error creating request:", error);
      toast.error("Error creating request");
    }
  };

  const getStatusColor = (status) => {
    switch (status) {
      case 'approved':
        return 'text-green-600 bg-green-100';
      case 'rejected':
        return 'text-red-600 bg-red-100';
      default:
        return 'text-yellow-600 bg-yellow-100';
    }
  };

  const getGenericName = (genericId) => {
    if (!genericId) return null;
    const g = generics.find(x => String(x.generic_id) === String(genericId) || String(x.id) === String(genericId));
    return g ? g.generic_name || g.name : null;
  };

  return (
    <>
      <ToastContainer position="top-center" autoClose={6000} hideProgressBar theme="colored" />
      <div className="min-h-screen bg-gray-100 py-6 px-4">
        <div className="flex justify-between items-center mb-8">
          <h1 className="text-3xl font-bold text-gray-900">Emergency Requests</h1>
          <button
            onClick={() => setIsModalOpen(true)}
            className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors duration-200 flex items-center"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z" clipRule="evenodd" />
            </svg>
            New Emergency Request
          </button>
        </div>
        
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {requests.map((request) => (
            <div
              key={request.request_id}
              className="bg-white rounded-lg shadow-md p-6"
            >
              <div className="flex justify-between items-start mb-4">
                <div>
                  <span className={`px-3 py-1 rounded-full text-sm font-medium ${getStatusColor(request.status)}`}>
                    {request.status.charAt(0).toUpperCase() + request.status.slice(1)}
                  </span>
                  <p className="text-sm text-gray-600 mt-2">
                    {new Date(request.request_date).toLocaleDateString('en-US', { 
                      year: 'numeric',
                      month: 'short',
                      day: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit'
                    })}
                  </p>
                </div>
              </div>

              <div className="space-y-4">
                <div>
                  <h4 className="text-sm font-medium text-gray-700">Requested Medicines</h4>
                  <ul className="mt-2 space-y-2">
                    {request.medicines.map((medicine, index) => {
                      const genericName = medicine.generic_name || (medicine.generic_id ? getGenericName(medicine.generic_id) : null);
                      const displayName = medicine.name || genericName || 'Unknown';
                      const dosagePart = medicine.dosage ? ` (${medicine.dosage} ${medicine.unit || ''})` : '';
                      const label = medicine.generic_id && !medicine.name ? `${displayName} (Generic)` : displayName;
                      return (
                        <li key={index} className="text-sm text-gray-600">
                          {label}{dosagePart} - {medicine.quantity_requested} units
                        </li>
                      );
                    })}
                  </ul>
                </div>

                {request.remarks && (
                  <div>
                    <h4 className="text-sm font-medium text-gray-700">Remarks</h4>
                    <p className="text-sm text-gray-600">{request.remarks}</p>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>

        {/* Create Request Modal */}
        {isModalOpen && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-lg shadow-xl p-6 w-full max-w-4xl">
              <div className="flex justify-between items-center mb-4">
                <h3 className="text-xl font-semibold text-gray-900">
                  Create Emergency Request
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

              <form onSubmit={handleSubmit} className="space-y-6">
                <div>
                  <div className="flex justify-between items-center mb-3">
                    <label className="block text-sm font-medium text-gray-700">Medicines</label>
                    <button
                      type="button"
                      onClick={handleAddMedicine}
                      className="inline-flex items-center px-3 py-1.5 bg-indigo-600 text-white text-sm font-medium rounded hover:bg-indigo-700"
                    >
                      + Add Medicine
                    </button>
                  </div>

                  <div className="space-y-3">
                    {newRequest.medicines.map((medicine, index) => (
                      <div key={index} className="grid grid-cols-12 gap-3 items-center p-3 bg-white border border-gray-100 rounded-lg shadow-sm">
                        <div className="col-span-12 md:col-span-2">
                          <label className="text-xs text-gray-600">Type</label>
                          <select
                            value={medicine.type}
                            onChange={(e) => handleMedicineChange(index, 'type', e.target.value)}
                            className="mt-1 block w-full rounded-md border-gray-300 bg-gray-50 text-sm"
                          >
                            <option value="medicine">Branded</option>
                            <option value="generic">Generic</option>
                          </select>
                        </div>

                        <div className="col-span-12 md:col-span-6">
                          <label className="text-xs text-gray-600">Medicine / Generic</label>
                          {medicine.type === 'medicine' ? (
                            <select
                              value={medicine.medicine_id}
                              onChange={(e) => handleMedicineChange(index, 'medicine_id', e.target.value)}
                              className="mt-1 block w-full rounded-md border-gray-300 text-sm"
                              required
                            >
                              <option value="">Select medicine (branded)</option>
                              {medicines.map(med => (
                                <option key={med.medicine_id} value={med.medicine_id}>
                                  {med.medicine_name || med.name} {med.dosage ? `- ${med.dosage}${med.unit ? ' ' + med.unit : ''}` : ''}
                                </option>
                              ))}
                            </select>
                          ) : (
                            <select
                              value={medicine.generic_id}
                              onChange={(e) => handleMedicineChange(index, 'generic_id', e.target.value)}
                              className="mt-1 block w-full rounded-md border-gray-300 text-sm"
                              required
                            >
                              <option value="">Select generic</option>
                              {generics.map(g => (
                                <option key={g.generic_id} value={g.generic_id}>{g.generic_name}</option>
                              ))}
                            </select>
                          )}
                        </div>

                        <div className="col-span-6 md:col-span-2">
                          <label className="text-xs text-gray-600">Quantity</label>
                          <input
                            type="number"
                            value={medicine.quantity_requested}
                            onChange={(e) => handleMedicineChange(index, 'quantity_requested', e.target.value)}
                            placeholder="Qty"
                            className="mt-1 block w-full rounded-md border-gray-300 text-sm"
                            required
                            min="1"
                          />
                        </div>

                        <div className="col-span-6 md:col-span-2 flex justify-end md:justify-center">
                          {newRequest.medicines.length > 1 ? (
                            <button
                              type="button"
                              onClick={() => handleRemoveMedicine(index)}
                              aria-label={`Remove medicine ${index + 1}`}
                              className="inline-flex items-center px-3 py-2 bg-red-50 text-red-700 rounded hover:bg-red-100 text-sm"
                            >
                              Remove
                            </button>
                          ) : (
                            <div className="text-xs text-gray-400"> </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Remarks</label>
                  <textarea
                    value={newRequest.remarks}
                    onChange={(e) => setNewRequest(prev => ({ ...prev, remarks: e.target.value }))}
                    className="w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                    rows="3"
                    placeholder="Add any additional notes or urgency details..."
                  />
                </div>

                <div className="flex justify-end space-x-3">
                  <button
                    type="button"
                    onClick={() => setIsModalOpen(false)}
                    className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-md hover:bg-gray-200"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="px-4 py-2 text-sm font-medium text-white bg-red-600 rounded-md hover:bg-red-700"
                  >
                    Submit Emergency Request
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
    </>
  );
};

export default EmergencyRequests;