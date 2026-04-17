import { useRouter } from "next/router";
import { useEffect, useState } from "react";
import { ToastContainer, toast } from "react-toastify";
import "react-toastify/dist/ReactToastify.css";

const SelectMedicineStocks = () => {
  const router = useRouter();
  const [stocks, setStocks] = useState([]);
  const [prescription, setPrescription] = useState(null);
  const [selectedStocks, setSelectedStocks] = useState({});
  const [allocationResult, setAllocationResult] = useState(null);
  const [processing, setProcessing] = useState(false);

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
    const fetchData = async () => {
      try {
        const { pharmacy_id, prescription: prescriptionData } = router.query;
        if (!pharmacy_id || !prescriptionData) return;

        // Parse the prescription data
        const parsedPrescription = JSON.parse(decodeURIComponent(prescriptionData));
        
        // Use prescribed quantity only (do not calculate from frequency * duration)
        const prescriptionWithCalculatedQuantities = {
          ...parsedPrescription,
          medicines: parsedPrescription.medicines.map(medicine => ({
            ...medicine,
            // Use the prescribed quantity field from the prescription
            requiredQuantity: Number(medicine.quantity) || 0,
            // ensure we have a stable id field (some payloads may use medicine_id)
            medicine_id: medicine.medicine_id || medicine.id || medicine.mId || null
          }))
        };
        
        setPrescription(prescriptionWithCalculatedQuantities);

        // Fetch all stocks for the pharmacy
        console.log("Fetching stocks for pharmacy:", pharmacy_id);
        const response = await fetch(`/api/fetchPharmacyStock?pharmacyId=${pharmacy_id}`);
        const data = await response.json();
        console.log("API Response:", data);

        if (data.success) {
          // Get the medicine IDs from the prescription
          const medicineIds = prescriptionWithCalculatedQuantities.medicines.map(m => m.medicine_id);
          console.log("Medicine IDs from prescription:", medicineIds);
          
          // Filter and group stocks by medicine_id
          const stocksByMedicine = {};
          medicineIds.forEach(id => {
            // Filter stocks for this medicine
            const filteredStocks = data.stocks.filter(stock => 
              parseInt(stock.medicine_id) === parseInt(id) && 
              parseFloat(stock.quantity) > 0 && 
              new Date(stock.expiry_date) > new Date()
            );
            // Sort by earliest expiry date first so pharmacies see soon-to-expire stocks on top
            const sortedFilteredStocks = filteredStocks.sort((a, b) => {
              try {
                return new Date(a.expiry_date) - new Date(b.expiry_date);
              } catch (e) {
                return 0;
              }
            });
            console.log(`Filtered & sorted stocks for medicine ${id}:`, sortedFilteredStocks);
            stocksByMedicine[id] = sortedFilteredStocks;
          });
          console.log("Final grouped stocks:", stocksByMedicine);
          setStocks(stocksByMedicine);
          
          // Initialize selected stocks
          const initialSelectedStocks = {};
          medicineIds.forEach(id => {
            initialSelectedStocks[id] = [];
          });
          setSelectedStocks(initialSelectedStocks);
        } else {
          toast.error("Failed to fetch stocks");
        }
      } catch (error) {
        console.error("Error fetching data:", error);
        toast.error("Error fetching data");
      }
    };

    if (router.isReady) {
      fetchData();
    }
  }, [router.isReady, router.query]);

  const handleStockSelection = (medicineId, stockId, required) => {
    setSelectedStocks(prev => ({
      ...prev,
      [medicineId]: stockId ? [stockId] : []
    }));
  };

  const handleAcceptOrder = async () => {
    try {
      if (!prescription) {
        toast.error("No prescription loaded");
        return;
      }

      // Check if all medicines have sufficient stock before processing
      const insufficientMedicines = [];
      
      prescription.medicines.forEach(medicine => {
        const medicineStocks = stocks[medicine.medicine_id] || [];
        const validStocks = medicineStocks.filter(stock => {
          try {
            return new Date(stock.expiry_date) > new Date() && parseFloat(stock.quantity) > 0;
          } catch (e) {
            return false;
          }
        });
        
        const totalAvailable = validStocks.reduce((sum, stock) => sum + parseFloat(stock.quantity || 0), 0);
        const totalRequired = Number(medicine.requiredQuantity || medicine.quantity || 0);
        
        if (totalAvailable < totalRequired) {
          insufficientMedicines.push({
            name: medicine.name,
            required: totalRequired,
            available: totalAvailable
          });
        }
      });

      if (insufficientMedicines.length > 0) {
        const errorMessage = insufficientMedicines.map(med => 
          `${med.name}: Need ${med.required}, Only ${med.available} available`
        ).join('\n');
        
        toast.error(`Insufficient stock for:\n${errorMessage}`, {
          autoClose: 5000,
          style: { whiteSpace: 'pre-line' }
        });
        return;
      }

      setProcessing(true);

      // Build request payload for allocation API
      const medicinesPayload = prescription.medicines.map(m => ({
        medicine_id: m.medicine_id,
        requiredQuantity: Number(m.requiredQuantity || m.quantity || 0),
        name: m.name
      }));

      const response = await fetch('/api/allocatePrescriptionStocks', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            pharmacy_id: router.query.pharmacy_id,
            prescription_id: prescription.prescription_id,
            medicines: medicinesPayload,
        }),
      });

      const data = await response.json();
      setProcessing(false);

      if (data.success) {
        setAllocationResult(data.allocations || {});
        toast.success('Order processed and stocks allocated');

        // After short delay, navigate back to orders (give user time to view allocation)
        setTimeout(() => {
          router.push(`/pharmacyOrders?pharmacy_id=${router.query.pharmacy_id}`);
        }, 2500);
      } else {
        toast.error(data.message || 'Failed to allocate stocks');
      }
    } catch (error) {
      console.error('Error processing allocation:', error);
      setProcessing(false); 
      toast.error('Error processing allocation');
    }
  };

  // Format date as DD/MM/YYYY to show day first (e.g. 29/10/2025)
  const formatDateDMY = (dateStr) => {
    try {
      const d = new Date(dateStr);
      if (isNaN(d)) return "";
      const day = String(d.getDate()).padStart(2, "0");
      const month = String(d.getMonth() + 1).padStart(2, "0");
      const year = d.getFullYear();
      return `${day}/${month}/${year}`;
    } catch (e) {
      return "";
    }
  };

  return (
    <>
      <ToastContainer position="top-center" autoClose={1500} hideProgressBar />
      <div className="min-h-screen bg-gray-100 py-6 px-4">
        <h1 className="text-3xl font-bold text-gray-900 mb-8">Select Medicine Stocks</h1>
        
        {prescription && (
          <div className="bg-white rounded-lg shadow p-6 mb-6">
            <h2 className="text-xl font-semibold mb-4">Prescription Details</h2>
            <p>Patient: {prescription.patient_name}</p>
            <p>Doctor: Dr. {prescription.doctor_name}</p>
            <p>OPD #: {prescription.opd_number}</p>
          </div>
        )}

        <div className="grid gap-6">
          {prescription?.medicines.map((medicine) => {
              const medicineStocks = stocks[medicine.medicine_id] || [];
              // Filter out expired stocks on the frontend only and ensure earliest expiry first
              const validStocks = (medicineStocks || []).filter(stock => {
                try {
                  return new Date(stock.expiry_date) > new Date() && parseFloat(stock.quantity) > 0;
                } catch (e) {
                  return false;
                }
              }).sort((a, b) => {
                try {
                  return new Date(a.expiry_date) - new Date(b.expiry_date);
                } catch (e) {
                  return 0;
                }
              });
              const totalRequired = Number(medicine.requiredQuantity) || 0;
              // Calculate total available quantity across all valid batches
              const totalAvailable = validStocks.reduce((sum, stock) => sum + parseFloat(stock.quantity || 0), 0);
              const hasSufficientStock = totalAvailable >= totalRequired;
            
            return (
              <div key={medicine.id} className="bg-white rounded-lg shadow p-6">
                <div className="flex justify-between items-start mb-4">
                  <div>
                    <h3 className="text-lg font-semibold">{medicine.name}</h3>
                    <div className="text-gray-600">
                      <p>Medicine: {medicineStocks[0]?.medicine_name} ({medicineStocks[0]?.dosage})</p>
                      <p>Frequency: {medicine.frequency} times per day</p>
                      <p>Duration: {medicine.duration_days} days</p>
                      <p className="font-medium">Total Required: {totalRequired} {medicineStocks[0]?.unit_type}</p>
                      <p className="text-sm text-gray-500">Manufacturer: {medicineStocks[0]?.manufacturer}</p>
                    </div>
                  </div>
                </div>

                <div className="mt-4">
                  <h4 className="text-md font-medium mb-2">Available Stocks</h4>
                  <div className="mb-3 p-3 rounded-lg bg-gray-100">
                    <p className="text-sm">
                      <span className="font-medium">Total Available:</span> {totalAvailable} {medicineStocks[0]?.unit_type}
                    </p>
                    <p className="text-sm">
                      <span className="font-medium">Required:</span> {totalRequired} {medicineStocks[0]?.unit_type}
                    </p>
                    <p className={`text-sm font-medium ${hasSufficientStock ? 'text-green-600' : 'text-red-600'}`}>
                      {hasSufficientStock ? '✓ Sufficient stock available' : '✗ Insufficient stock'}
                    </p>
                  </div>
                  <div className="space-y-2">
                    {validStocks.length > 0 ? (
                      validStocks.map((stock) => (
                          <div key={stock.stock_id} className="flex items-center space-x-3">
                            <div className="flex-1">
                              <span className="block text-sm font-medium">
                                Batch: {stock.batch_number} - Available: {stock.quantity} {medicine.unit}
                              </span>
                              <span className="block text-sm">
                                Price: ₹{stock.price_per_unit} per {medicine.unit}
                              </span>
                              <span className="block text-sm text-gray-500">
                                Expires: {formatDateDMY(stock.expiry_date)}
                              </span>
                            </div>
                          </div>
                        ))
                    ) : (
                      <p className="text-red-500">No valid stock available for this medicine</p>
                    )}
                  </div>
                </div>

                {/* Show allocation details (if any) for this medicine */}
                {allocationResult && allocationResult[medicine.medicine_id] && (
                  <div className="mt-4 bg-gray-50 p-3 rounded">
                    <h5 className="font-medium">Allocation for {medicine.name}</h5>
                    <ul className="mt-2 list-disc list-inside text-sm">
                      {allocationResult[medicine.medicine_id].allocations.map((a) => (
                        <li key={`${medicine.medicine_id}-${a.stock_id}`}>
                          Removed {a.allocated} {medicine.unit} from batch {a.batch_number} (Expiry: {formatDateDMY(a.expiry_date)}) — Remaining: {a.new_quantity}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <div className="mt-6 flex justify-end space-x-3">
          <button
            onClick={() => router.back()}
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-md hover:bg-gray-200"
          >
            Back
          </button>
          <button
            onClick={handleAcceptOrder}
            disabled={processing || prescription?.medicines.some(medicine => {
              const medicineStocks = stocks[medicine.medicine_id] || [];
              const validStocks = medicineStocks.filter(stock => {
                try {
                  return new Date(stock.expiry_date) > new Date() && parseFloat(stock.quantity) > 0;
                } catch (e) {
                  return false;
                }
              });
              const totalAvailable = validStocks.reduce((sum, stock) => sum + parseFloat(stock.quantity || 0), 0);
              const totalRequired = Number(medicine.requiredQuantity || medicine.quantity || 0);
              return totalAvailable < totalRequired;
            })}
            className={`px-4 py-2 text-sm font-medium text-white rounded-md transition-colors duration-200 ${
              processing || prescription?.medicines.some(medicine => {
                const medicineStocks = stocks[medicine.medicine_id] || [];
                const validStocks = medicineStocks.filter(stock => {
                  try {
                    return new Date(stock.expiry_date) > new Date() && parseFloat(stock.quantity) > 0;
                  } catch (e) {
                    return false;
                  }
                });
                const totalAvailable = validStocks.reduce((sum, stock) => sum + parseFloat(stock.quantity || 0), 0);
                const totalRequired = Number(medicine.requiredQuantity || medicine.quantity || 0);
                return totalAvailable < totalRequired;
              })
                ? 'bg-gray-400 cursor-not-allowed' 
                : 'bg-green-600 hover:bg-green-700'
            }`}
          >
            {processing ? 'Processing...' : 'Process Order'}
          </button>
        </div>
      </div>
    </>
  );
};

export default SelectMedicineStocks;