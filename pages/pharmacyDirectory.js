import { useRouter } from "next/router";
import { useEffect, useState } from "react";
import { ToastContainer, toast } from "react-toastify";
import "react-toastify/dist/ReactToastify.css";

const PharmacyDirectory = ({ logout }) => {
  const router = useRouter();
  const [pharmacies, setPharmacies] = useState([]);
  const [groupedPharmacies, setGroupedPharmacies] = useState({});
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [filteredPharmacies, setFilteredPharmacies] = useState({});
  const [selectedPharmacy, setSelectedPharmacy] = useState(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [expandedGroups, setExpandedGroups] = useState({});

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
    fetchPharmacies();
  }, []);

  const fetchPharmacies = async () => {
    try {
      setLoading(true);
      const response = await fetch("/api/getAllPharmacies");
      const data = await response.json();

      if (data.success && Array.isArray(data.pharmacies)) {
        setPharmacies(data.pharmacies);
        groupPharmaciesByLocation(data.pharmacies);
      } else {
        toast.error("Failed to fetch pharmacies");
      }
    } catch (error) {
      console.error("Error fetching pharmacies:", error);
      toast.error("Error fetching pharmacies");
    } finally {
      setLoading(false);
    }
  };

  const groupPharmaciesByLocation = (pharmaciesData) => {
    const grouped = {};
    
    pharmaciesData.forEach(pharmacy => {
      const key = `${pharmacy.district} - ${pharmacy.block}`;
      
      if (!grouped[key]) {
        grouped[key] = {
          district: pharmacy.district,
          block: pharmacy.block,
          pharmacies: []
        };
      }
      
      grouped[key].pharmacies.push(pharmacy);
    });

    // Sort pharmacies within each group by name
    Object.keys(grouped).forEach(key => {
      grouped[key].pharmacies.sort((a, b) => a.pharmacy_name.localeCompare(b.pharmacy_name));
    });

    setGroupedPharmacies(grouped);
    setFilteredPharmacies(grouped);
  };

  const handleSearch = (e) => {
    const query = e.target.value.toLowerCase();
    setSearchQuery(query);

    if (query === "") {
      setFilteredPharmacies(groupedPharmacies);
      return;
    }

    const filtered = {};
    
    Object.keys(groupedPharmacies).forEach(key => {
      const group = groupedPharmacies[key];
      const matchingPharmacies = group.pharmacies.filter(pharmacy => 
        pharmacy.pharmacy_name.toLowerCase().includes(query) ||
        pharmacy.district.toLowerCase().includes(query) ||
        pharmacy.block.toLowerCase().includes(query) ||
        pharmacy.address.toLowerCase().includes(query) ||
        pharmacy.contact_number.includes(query)
      );

      if (matchingPharmacies.length > 0) {
        filtered[key] = {
          ...group,
          pharmacies: matchingPharmacies
        };
      }
    });

    setFilteredPharmacies(filtered);
  };

  const toggleGroupExpansion = (groupKey) => {
    setExpandedGroups(prev => ({
      ...prev,
      [groupKey]: !prev[groupKey]
    }));
  };

  const openPharmacyModal = (pharmacy) => {
    setSelectedPharmacy(pharmacy);
    setIsModalOpen(true);
  };

  const closePharmacyModal = () => {
    setSelectedPharmacy(null);
    setIsModalOpen(false);
  };

  const formatPhoneNumber = (phoneNumber) => {
    if (!phoneNumber) return "N/A";
    
    // Format Indian phone numbers
    const cleaned = phoneNumber.replace(/\D/g, '');
    if (cleaned.length === 10) {
      return `+91 ${cleaned.slice(0, 5)} ${cleaned.slice(5)}`;
    } else if (cleaned.length === 11 && cleaned.startsWith('0')) {
      return `+91 ${cleaned.slice(1, 6)} ${cleaned.slice(6)}`;
    }
    return phoneNumber;
  };

  const getAutoOrderBadge = (autoOrderEnabled) => {
    return autoOrderEnabled ? (
      <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-green-100 text-green-800">
        <span className="w-2 h-2 bg-green-400 rounded-full mr-1"></span>
        Auto Orders
      </span>
    ) : (
      <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-gray-100 text-gray-600">
        <span className="w-2 h-2 bg-gray-400 rounded-full mr-1"></span>
        Manual Orders
      </span>
    );
  };

  const totalPharmacies = Object.values(filteredPharmacies).reduce(
    (total, group) => total + group.pharmacies.length, 0
  );

  const totalGroups = Object.keys(filteredPharmacies).length;

  return (
    <div className="flex bg-gray-100 min-h-screen">
      <ToastContainer position="top-center" autoClose={3000} hideProgressBar />

      {/* Sidebar */}
      <aside className="flex flex-col w-64 px-4 py-8 bg-white shadow-lg">
        <div className="mb-6">
          <h2 className="text-2xl font-bold text-blue-700">Pharmacy Directory</h2>
        </div>

        <nav className="space-y-3">
          <button
            onClick={() => router.push("/admin")}
            className="flex items-center w-full px-4 py-3 text-left text-white bg-gray-600 rounded-lg shadow-md hover:bg-gray-500 transition-colors duration-200"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M9.707 16.707a1 1 0 01-1.414 0l-6-6a1 1 0 010-1.414l6-6a1 1 0 011.414 1.414L5.414 9H17a1 1 0 110 2H5.414l4.293 4.293a1 1 0 010 1.414z" clipRule="evenodd" />
            </svg>
            Back to Dashboard
          </button>

          <button
            onClick={fetchPharmacies}
            disabled={loading}
            className={`flex items-center w-full px-4 py-3 text-left text-white rounded-lg shadow-md transition-colors duration-200 ${
              loading
                ? 'bg-gray-400 cursor-not-allowed' 
                : 'bg-blue-600 hover:bg-blue-500'
            }`}
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M4 2a1 1 0 011 1v2.101a7.002 7.002 0 0111.601 2.566 1 1 0 11-1.885.666A5.002 5.002 0 005.999 7H9a1 1 0 010 2H4a1 1 0 01-1-1V3a1 1 0 011-1zm.008 9.057a1 1 0 011.276.61A5.002 5.002 0 0014.001 13H11a1 1 0 110-2h5a1 1 0 011 1v5a1 1 0 11-2 0v-2.101a7.002 7.002 0 01-11.601-2.566 1 1 0 01.61-1.276z" clipRule="evenodd" />
            </svg>
            {loading ? 'Refreshing...' : 'Refresh Directory'}
          </button>

          <button
            onClick={logout}
            className="flex items-center w-full px-4 py-3 text-left text-white bg-red-600 rounded-lg shadow-md hover:bg-red-500 transition-colors duration-200"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M3 3a1 1 0 011 1v12a1 1 0 11-2 0V4a1 1 0 011-1zm7.707 3.293a1 1 0 010 1.414L9.414 9H17a1 1 0 110 2H9.414l1.293 1.293a1 1 0 01-1.414 1.414l-3-3a1 1 0 010-1.414l3-3a1 1 0 011.414 0z" clipRule="evenodd" />
            </svg>
            Logout
          </button>
        </nav>
      </aside>

      {/* Main Content */}
      <main className="flex-1 p-6 bg-gray-50">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">
            Pharmacy & Hospital Directory
          </h1>
          <p className="text-gray-600">
            Complete directory of all registered pharmacies and hospitals grouped by location
          </p>
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
          <div className="bg-white p-6 rounded-lg shadow-md border-l-4 border-blue-500">
            <h3 className="text-lg font-semibold text-blue-600 mb-2">Total Pharmacies</h3>
            <p className="text-3xl font-bold text-gray-800">{totalPharmacies}</p>
            <p className="text-sm text-gray-600">Registered facilities</p>
          </div>
          <div className="bg-white p-6 rounded-lg shadow-md border-l-4 border-green-500">
            <h3 className="text-lg font-semibold text-green-600 mb-2">Location Groups</h3>
            <p className="text-3xl font-bold text-gray-800">{totalGroups}</p>
            <p className="text-sm text-gray-600">District-Block combinations</p>
          </div>
          <div className="bg-white p-6 rounded-lg shadow-md border-l-4 border-purple-500">
            <h3 className="text-lg font-semibold text-purple-600 mb-2">Auto-Order Enabled</h3>
            <p className="text-3xl font-bold text-gray-800">
              {Object.values(filteredPharmacies).reduce(
                (count, group) => count + group.pharmacies.filter(p => p.auto_order_enabled).length, 0
              )}
            </p>
            <p className="text-sm text-gray-600">Automated facilities</p>
          </div>
        </div>

        {/* Search Bar */}
        <div className="mb-6">
          <div className="relative max-w-md">
            <input
              type="text"
              value={searchQuery}
              onChange={handleSearch}
              placeholder="Search pharmacies, districts, blocks, or addresses..."
              className="w-full px-10 py-3 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 focus:outline-none"
            />
            <svg
              className="w-5 h-5 absolute left-3 top-3.5 text-gray-400"
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth="2"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M21 21l-5.197-5.197M16 10.5A5.5 5.5 0 105.5 16 5.5 5.5 0 0016 10.5z"
              />
            </svg>
          </div>
        </div>

        {/* Loading State */}
        {loading && (
          <div className="bg-white rounded-lg shadow-md p-8 text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
            <h3 className="text-lg font-semibold text-gray-700 mb-2">Loading Pharmacy Directory</h3>
            <p className="text-gray-600">Please wait while we fetch all pharmacy data...</p>
          </div>
        )}

        {/* Pharmacy Directory */}
        {!loading && (
          <div className="space-y-6">
            {Object.keys(filteredPharmacies).length === 0 ? (
              <div className="bg-white rounded-lg shadow-md p-8 text-center">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-16 w-16 text-gray-400 mx-auto mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                </svg>
                <h3 className="text-lg font-semibold text-gray-700 mb-2">No Pharmacies Found</h3>
                <p className="text-gray-600">
                  {searchQuery ? 'No pharmacies match your search criteria.' : 'No pharmacies are registered yet.'}
                </p>
              </div>
            ) : (
              Object.entries(filteredPharmacies).map(([groupKey, group]) => (
                <div key={groupKey} className="bg-white rounded-lg shadow-md overflow-hidden">
                  {/* Group Header */}
                  <div 
                    className="bg-gradient-to-r from-blue-600 to-blue-700 p-4 cursor-pointer hover:from-blue-700 hover:to-blue-800 transition-colors duration-200"
                    onClick={() => toggleGroupExpansion(groupKey)}
                  >
                    <div className="flex justify-between items-center text-white">
                      <div>
                        <h3 className="text-xl font-bold">{group.district}</h3>
                        <p className="text-blue-100">{group.block} Block • {group.pharmacies.length} Facilities</p>
                      </div>
                      <div className="flex items-center">
                        <span className="mr-3 text-sm font-medium">
                          {expandedGroups[groupKey] ? 'Collapse' : 'Expand'}
                        </span>
                        <svg 
                          xmlns="http://www.w3.org/2000/svg" 
                          className={`h-6 w-6 transform transition-transform duration-200 ${
                            expandedGroups[groupKey] ? 'rotate-180' : ''
                          }`} 
                          fill="none" 
                          viewBox="0 0 24 24" 
                          stroke="currentColor"
                        >
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                        </svg>
                      </div>
                    </div>
                  </div>

                  {/* Pharmacies List */}
                  {expandedGroups[groupKey] && (
                    <div className="divide-y divide-gray-200">
                      {group.pharmacies.map((pharmacy) => (
                        <div key={pharmacy.pharmacy_id} className="p-6 hover:bg-gray-50 transition-colors duration-150">
                          <div className="flex justify-between items-start">
                            <div className="flex-1">
                              <div className="flex items-center mb-2">
                                <h4 className="text-lg font-semibold text-gray-900 mr-3">
                                  {pharmacy.pharmacy_name}
                                </h4>
                                {getAutoOrderBadge(pharmacy.auto_order_enabled)}
                              </div>
                              
                              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm text-gray-600">
                                <div className="flex items-center">
                                  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 mr-2 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                                  </svg>
                                  <span>{pharmacy.address}</span>
                                </div>
                                
                                <div className="flex items-center">
                                  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 mr-2 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
                                  </svg>
                                  <span>{formatPhoneNumber(pharmacy.contact_number)}</span>
                                </div>
                                
                                <div className="flex items-center">
                                  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 mr-2 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                                  </svg>
                                  <span>Username: {pharmacy.username}</span>
                                </div>
                                
                                <div className="flex items-center">
                                  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 mr-2 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3a4 4 0 118 0v4m-4 6v6m-6-6h12a2 2 0 012 2v6a2 2 0 01-2 2H6a2 2 0 01-2-2v-6a2 2 0 012-2z" />
                                  </svg>
                                  <span>ID: {pharmacy.pharmacy_id}</span>
                                </div>
                              </div>
                              
                              {pharmacy.created_at && (
                                <div className="mt-2 text-xs text-gray-500">
                                  Registered: {new Date(pharmacy.created_at).toLocaleDateString('en-IN', {
                                    year: 'numeric',
                                    month: 'long',
                                    day: 'numeric'
                                  })}
                                </div>
                              )}
                            </div>
                            
                            <div className="ml-4">
                              <button
                                onClick={() => openPharmacyModal(pharmacy)}
                                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors duration-200 text-sm font-medium"
                              >
                                View Details
                              </button>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        )}

        {/* Pharmacy Details Modal */}
        {isModalOpen && selectedPharmacy && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
            <div className="bg-white rounded-lg shadow-xl p-6 w-full max-w-2xl max-h-[80vh] overflow-y-auto">
              <div className="flex justify-between items-center mb-6">
                <h3 className="text-2xl font-semibold text-gray-800">
                  Pharmacy Details
                </h3>
                <button
                  onClick={closePharmacyModal}
                  className="text-gray-500 hover:text-gray-700 text-2xl"
                >
                  ×
                </button>
              </div>

              <div className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div>
                    <h4 className="text-sm font-medium text-gray-700 mb-1">Pharmacy Name</h4>
                    <p className="text-lg font-semibold text-gray-900">{selectedPharmacy.pharmacy_name}</p>
                  </div>
                  
                  <div>
                    <h4 className="text-sm font-medium text-gray-700 mb-1">Pharmacy ID</h4>
                    <p className="text-lg text-gray-900">{selectedPharmacy.pharmacy_id}</p>
                  </div>
                  
                  <div>
                    <h4 className="text-sm font-medium text-gray-700 mb-1">District</h4>
                    <p className="text-lg text-gray-900">{selectedPharmacy.district}</p>
                  </div>
                  
                  <div>
                    <h4 className="text-sm font-medium text-gray-700 mb-1">Block</h4>
                    <p className="text-lg text-gray-900">{selectedPharmacy.block}</p>
                  </div>
                  
                  <div className="md:col-span-2">
                    <h4 className="text-sm font-medium text-gray-700 mb-1">Full Address</h4>
                    <p className="text-lg text-gray-900">{selectedPharmacy.address}</p>
                  </div>
                  
                  <div>
                    <h4 className="text-sm font-medium text-gray-700 mb-1">Contact Number</h4>
                    <p className="text-lg text-gray-900">{formatPhoneNumber(selectedPharmacy.contact_number)}</p>
                  </div>
                  
                  <div>
                    <h4 className="text-sm font-medium text-gray-700 mb-1">Username</h4>
                    <p className="text-lg text-gray-900">{selectedPharmacy.username}</p>
                  </div>
                  
                  <div>
                    <h4 className="text-sm font-medium text-gray-700 mb-1">Auto-Order Setting</h4>
                    <div className="mt-1">
                      {getAutoOrderBadge(selectedPharmacy.auto_order_enabled)}
                    </div>
                  </div>
                  
                  <div>
                    <h4 className="text-sm font-medium text-gray-700 mb-1">Registration Date</h4>
                    <p className="text-lg text-gray-900">
                      {selectedPharmacy.created_at 
                        ? new Date(selectedPharmacy.created_at).toLocaleDateString('en-IN', {
                            year: 'numeric',
                            month: 'long',
                            day: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit'
                          })
                        : 'N/A'
                      }
                    </p>
                  </div>
                </div>
              </div>

              <div className="flex justify-end mt-6">
                <button
                  onClick={closePharmacyModal}
                  className="px-6 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-md hover:bg-gray-200 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gray-500"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
};

export default PharmacyDirectory;