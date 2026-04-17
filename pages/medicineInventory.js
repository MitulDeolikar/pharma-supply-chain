import { useRouter } from "next/router";
import { useEffect, useState } from "react";
import { ToastContainer, toast } from "react-toastify";
import "react-toastify/dist/ReactToastify.css";

const MedicineInventory = () => {
  const router = useRouter();
  const [medicineGroups, setMedicineGroups] = useState([]);
  const [loading, setLoading] = useState(true);

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

  // Fetch and group medicines by medicine_id
  useEffect(() => {
    const fetchMedicineInventory = async () => {
      try {
        const { pharmacy_id } = router.query;
        if (!pharmacy_id) return;

        setLoading(true);
        const response = await fetch(`/api/fetchPharmacyStock?pharmacyId=${pharmacy_id}`);
        const data = await response.json();

        if (data.success) {
          // Group stocks by medicine_id
          const grouped = data.stocks.reduce((acc, stock) => {
            const medicineId = stock.medicine_id;
            
            if (!acc[medicineId]) {
              acc[medicineId] = {
                medicine_id: medicineId,
                medicine_name: stock.medicine_name,
                dosage: stock.dosage,
                unit_type: stock.unit_type,
                manufacturer: stock.manufacturer,
                description: stock.description,
                stocks: [],
                total_quantity: 0,
                expired_quantity: 0,
                near_expiry_quantity: 0
              };
            }

            // Calculate quantities
            const quantity = parseFloat(stock.quantity) || 0;
            const expiryDate = new Date(stock.expiry_date);
            const currentDate = new Date();
            const oneWeekFromNow = new Date(currentDate.getTime() + 7 * 24 * 60 * 60 * 1000);

            acc[medicineId].stocks.push(stock);
            acc[medicineId].total_quantity += quantity;

            if (expiryDate <= currentDate) {
              acc[medicineId].expired_quantity += quantity;
            } else if (expiryDate <= oneWeekFromNow) {
              acc[medicineId].near_expiry_quantity += quantity;
            }

            return acc;
          }, {});

          // Convert to array and sort by medicine name
          const groupedArray = Object.values(grouped).sort((a, b) => 
            a.medicine_name.localeCompare(b.medicine_name)
          );

          setMedicineGroups(groupedArray);
        } else {
          toast.error("Failed to fetch medicine inventory");
        }
      } catch (error) {
        console.error("Error fetching medicine inventory:", error);
        toast.error("Error fetching medicine inventory");
      } finally {
        setLoading(false);
      }
    };

    if (router.query.pharmacy_id) {
      fetchMedicineInventory();
    }
  }, [router.query]);

  // Format date as DD/MM/YYYY
  const formatDate = (dateStr) => {
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

  // Get status color based on expiry
  const getExpiryStatus = (expiryDate) => {
    const expiry = new Date(expiryDate);
    const current = new Date();
    const oneWeek = new Date(current.getTime() + 7 * 24 * 60 * 60 * 1000);

    if (expiry <= current) {
      return { color: 'text-red-600 bg-red-50', label: 'Expired' };
    } else if (expiry <= oneWeek) {
      return { color: 'text-yellow-600 bg-yellow-50', label: 'Expiring Soon' };
    } else {
      return { color: 'text-green-600 bg-green-50', label: 'Good' };
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">Loading medicine inventory...</p>
        </div>
      </div>
    );
  }

  return (
    <>
      <ToastContainer position="top-center" autoClose={1500} hideProgressBar />
      <div className="min-h-screen bg-gray-100 py-6 px-4">
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold text-gray-900">Medicine Inventory</h1>
              <p className="mt-2 text-gray-600">Medicines grouped by type with stock details</p>
            </div>
            <button
              onClick={() => router.back()}
              className="px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 transition-colors duration-200 flex items-center"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
              Back to Dashboard
            </button>
          </div>
        </div>

        {/* Medicine Cards */}
        <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-6">
          {medicineGroups.map((medicine) => (
            <div key={medicine.medicine_id} className="bg-white rounded-lg shadow-lg overflow-hidden">
              {/* Medicine Header */}
              <div className="bg-indigo-600 text-white p-6">
                <h3 className="text-xl font-bold">{medicine.medicine_name}</h3>
                <p className="text-indigo-100">{medicine.dosage} • {medicine.manufacturer}</p>
                <p className="text-indigo-200 text-sm mt-1">{medicine.description}</p>
              </div>

              {/* Summary Statistics */}
              <div className="p-4 bg-gray-50 border-b">
                <div className="grid grid-cols-3 gap-4 text-center">
                  <div>
                    <p className="text-2xl font-bold text-indigo-600">{medicine.total_quantity}</p>
                    <p className="text-sm text-gray-600">Total {medicine.unit_type}s</p>
                  </div>
                  <div>
                    <p className="text-2xl font-bold text-red-600">{medicine.expired_quantity}</p>
                    <p className="text-sm text-gray-600">Expired</p>
                  </div>
                  <div>
                    <p className="text-2xl font-bold text-yellow-600">{medicine.near_expiry_quantity}</p>
                    <p className="text-sm text-gray-600">Expiring Soon</p>
                  </div>
                </div>
              </div>

              {/* Stock Details */}
              <div className="p-4">
                <h4 className="font-semibold text-gray-800 mb-3">Stock Batches ({medicine.stocks.length})</h4>
                <div className="space-y-3 max-h-64 overflow-y-auto">
                  {medicine.stocks
                    .sort((a, b) => new Date(a.expiry_date) - new Date(b.expiry_date)) // Sort by earliest expiry first
                    .map((stock) => {
                      const status = getExpiryStatus(stock.expiry_date);
                      return (
                        <div key={stock.stock_id} className={`p-3 rounded-lg border-l-4 ${
                          status.label === 'Expired' ? 'border-red-500 bg-red-50' :
                          status.label === 'Expiring Soon' ? 'border-yellow-500 bg-yellow-50' :
                          'border-green-500 bg-green-50'
                        }`}>
                          <div className="flex justify-between items-start">
                            <div className="flex-1">
                              <p className="font-medium text-gray-800">Batch: {stock.batch_number}</p>
                              <p className="text-sm text-gray-600">
                                Quantity: {stock.quantity} {medicine.unit_type}s
                              </p>
                              <p className="text-sm text-gray-600">
                                Price: ₹{stock.price_per_unit} per {medicine.unit_type}
                              </p>
                              <p className="text-sm text-gray-600">
                                Expiry: {formatDate(stock.expiry_date)}
                              </p>
                            </div>
                            <div className="ml-3">
                              <span className={`px-2 py-1 rounded-full text-xs font-medium ${status.color}`}>
                                {status.label}
                              </span>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                </div>
              </div>

              {/* Action Buttons */}
              <div className="p-4 bg-gray-50 border-t">
                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={() => router.push(`/user?pharmacy_id=${router.query.pharmacy_id}#stock-${medicine.medicine_id}`)}
                    className="px-3 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors duration-200 text-sm"
                  >
                    Manage Stock
                  </button>
                  <button
                    onClick={() => {
                      const totalValue = medicine.stocks.reduce((sum, stock) => 
                        sum + (parseFloat(stock.quantity) * parseFloat(stock.price_per_unit)), 0
                      );
                      toast.info(`Total value: ₹${totalValue.toFixed(2)}`, { autoClose: 3000 });
                    }}
                    className="px-3 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 transition-colors duration-200 text-sm"
                  >
                    View Value
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Empty State */}
        {medicineGroups.length === 0 && !loading && (
          <div className="text-center py-12">
            <svg className="mx-auto h-12 w-12 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2M4 13h2m8-8v2m-4 0V5a1 1 0 011-1h2a1 1 0 011 1v10a1 1 0 01-1 1h-2a1 1 0 01-1-1V5z" />
            </svg>
            <h3 className="mt-2 text-sm font-medium text-gray-900">No medicines in inventory</h3>
            <p className="mt-1 text-sm text-gray-500">
              Get started by adding some medicine stock to your pharmacy.
            </p>
            <div className="mt-6">
              <button
                onClick={() => router.push(`/user?pharmacy_id=${router.query.pharmacy_id}`)}
                className="inline-flex items-center px-4 py-2 border border-transparent shadow-sm text-sm font-medium rounded-md text-white bg-indigo-600 hover:bg-indigo-700"
              >
                <svg className="-ml-1 mr-2 h-5 w-5" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z" clipRule="evenodd" />
                </svg>
                Add Medicine Stock
              </button>
            </div>
          </div>
        )}
      </div>
    </>
  );
};

export default MedicineInventory;