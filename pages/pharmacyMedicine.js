import { useRouter } from "next/router";
import { useEffect, useState } from "react";
import { ToastContainer, toast } from "react-toastify";
import "react-toastify/dist/ReactToastify.css";
import useSSE from '../hooks/useSSE';

const pharmacyMedicine = () => {
  const router = useRouter();
  const pharmacy_id = router.query.pharmacy_id || router.query.pharmacyId;
  const [medicines, setMedicines] = useState([]);
  const [stocks, setStocks] = useState([]);
  const [generics, setGenerics] = useState([]);
  const [selectedGeneric, setSelectedGeneric] = useState('');
  const [filteredMeds, setFilteredMeds] = useState([]);
  const [selectedMedicineId, setSelectedMedicineId] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [expandedMedicineId, setExpandedMedicineId] = useState(null);
  const [loading, setLoading] = useState(false);
  const [totalStock, setTotalStock] = useState(0);
  const [totalGenerics, setTotalGenerics] = useState(0);
  const [pharmacyInfo, setPharmacyInfo] = useState(null);
  const [inventoryQuery, setInventoryQuery] = useState('');
  const [inventoryLoading, setInventoryLoading] = useState(false);
  const [inventoryResults, setInventoryResults] = useState([]);
  const [inventoryDistances, setInventoryDistances] = useState({});

  // If pharmacy_id is missing but doctor_id is present, resolve the doctor's linked pharmacy
  // and patch it into the URL so the page loads correctly.
  useEffect(() => {
    const doctor_id = router.query.doctor_id;
    if (pharmacy_id || !doctor_id) return;
    fetch(`/api/getDoctorInfo?doctorId=${encodeURIComponent(doctor_id)}`)
      .then(r => r.json())
      .then(data => {
        if (data.success && data.doctor?.pharmacy_id) {
          router.replace({
            pathname: router.pathname,
            query: { ...router.query, pharmacy_id: data.doctor.pharmacy_id },
          });
        }
      })
      .catch(() => {});
  }, [router.query.doctor_id, pharmacy_id]);

  useEffect(() => {
    if (!pharmacy_id) return;
    loadData();
  }, [pharmacy_id]);

  // Real-time updates — reload stock when this pharmacy's inventory changes.
  // Covers direct stock edits AND order fulfillments that move stock in/out.
  const handleSSEEvent = (event) => {
    const t = event.type;
    const pid = String(pharmacy_id);
    const isThisPharmacy =
      String(event.pharmacy_id) === pid ||
      String(event.accepting_pharmacy_id) === pid;
    if (
      (t.startsWith('stock:') && isThisPharmacy) ||
      (t === 'emergency:received' && isThisPharmacy) ||
      (t === 'emergency:allocated' && isThisPharmacy) ||
      (t === 'demand:received' && isThisPharmacy) ||
      (t === 'warehouse:dispatched')
    ) {
      loadData();
      toast.info('Stock updated', { autoClose: 2000 });
    }
  };
  useSSE({ role: 'pharmacy', id: pharmacy_id, onEvent: handleSSEEvent });

  const loadData = async () => {
    setLoading(true);
    try {
      const [medRes, stockRes] = await Promise.all([
        fetch('/api/fetchAllMedicines'),
        fetch(`/api/fetchPharmacyStock?pharmacyId=${encodeURIComponent(pharmacy_id)}`)
      ]);

      const medJson = await medRes.json();
      const stockJson = await stockRes.json();

      const meds = medJson?.medicines || medJson?.data || medJson || [];
      const stocksArr = stockJson?.stocks || stockJson?.data || [];

      setMedicines(meds);
      setStocks(stocksArr);
      // Build mapping of stock by medicine for quick lookups
      const stockByMed = new Map();
      stocksArr.forEach(s => stockByMed.set(String(s.medicine_id), Number(s.quantity)));

      // Build generics grouping from medicines and compute available counts (in this pharmacy)
      const map = new Map();
      meds.forEach(m => {
        const gName = m.generic_name || m.generic || 'Unknown';
        const gId = m.generic_id ?? m.genericId ?? gName;
        if (!map.has(gId)) map.set(gId, { generic_id: gId, generic_name: gName, medicines: [], availableCount: 0 });
        const entry = map.get(gId);
        const qty = stockByMed.get(String(m.medicine_id)) || 0;
        entry.medicines.push({ ...m, _availableQty: qty });
        entry.availableCount += qty;
      });

      // Sort medicines within each generic by availability desc, then name
      const genericsArr = Array.from(map.values()).map(g => ({
        ...g,
        medicines: g.medicines.sort((a, b) => (b._availableQty - a._availableQty) || (a.name || a.medicine_name || '').localeCompare(b.name || b.medicine_name || ''))
      }));

      // Sort generics by availability (descending) for better UX
      genericsArr.sort((a, b) => b.availableCount - a.availableCount || a.generic_name.localeCompare(b.generic_name));
      setGenerics(genericsArr);

      // Totals for header
      const total = stocksArr.reduce((s, it) => s + (Number(it.quantity) || 0), 0);
      setTotalStock(total);
      setTotalGenerics(genericsArr.length);

      // Fetch pharmacy info (name, contact, address)
      try {
        const infoResp = await fetch(`/api/getPharmacyInfo?pharmacyId=${encodeURIComponent(pharmacy_id)}`);
        const infoJson = await infoResp.json();
        if (infoJson.success) setPharmacyInfo(infoJson.pharmacy || null);
      } catch (infoErr) {
        console.warn('Failed to load pharmacy info', infoErr);
      }
    } catch (err) {
      console.error('Error loading data', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!selectedGeneric) {
      setFilteredMeds([]);
      return;
    }
    const grp = generics.find(g => String(g.generic_id) === String(selectedGeneric) || g.generic_name === selectedGeneric);
    if (grp) setFilteredMeds(grp.medicines);
    else setFilteredMeds([]);
    setExpandedMedicineId(null);
  }, [selectedGeneric, generics]);

  // Debounced inventory search
  useEffect(() => {
    if (!inventoryQuery || inventoryQuery.trim().length < 2) {
      setInventoryResults([]);
      return;
    }
    const t = setTimeout(() => {
      searchInventory(inventoryQuery.trim());
    }, 400);
    return () => clearTimeout(t);
  }, [inventoryQuery]);

  const searchInventory = async (q) => {
    setInventoryLoading(true);
    setInventoryResults([]);
    setInventoryDistances({});
    try {
      const resp = await fetch(`/api/searchInventory?q=${encodeURIComponent(q)}`);
      const j = await resp.json();
      if (j.success) {
        setInventoryResults(j.pharmacies || []);
        
        // Store search metadata for display
        const searchMeta = {
          type: j.searchType || 'medicine',
          query: j.query || q,
          medicines: j.medicines || []
        };
        
        // if we have an origin pharmacy, compute distances
        if (pharmacy_id && (j.pharmacies || []).length) {
          const destIds = (j.pharmacies || []).map(p => p.pharmacy_id).join(',');
          try {
            const dresp = await fetch(`/api/computeDistancesFromPharmacy?originPharmacyId=${encodeURIComponent(pharmacy_id)}&destPharmacyIds=${encodeURIComponent(destIds)}`);
            const dj = await dresp.json();
            if (dj.success && Array.isArray(dj.distances)) {
              const map = {};
              dj.distances.forEach(d => { map[d.pharmacy_id] = d; });
              setInventoryDistances(map);
            }
          } catch (e) {
            console.warn('Failed to compute distances', e);
          }
        }
      }
    } catch (err) {
      console.error('searchInventory error', err);
    } finally {
      setInventoryLoading(false);
    }
  };

  const getStockForMedicine = (medicine_id) => {
    const item = stocks.find(s => String(s.medicine_id) === String(medicine_id));
    return item ? Number(item.quantity) : 0;
  };

  const alternativesFor = (med) => {
    if (!med) return [];
    const gId = med.generic_id ?? med.genericId ?? med.generic_name;
    const sameGeneric = medicines.filter(m => (m.generic_id ?? m.genericId ?? m.generic_name) === gId && String(m.medicine_id) !== String(med.medicine_id));
    return sameGeneric.map(m => ({ ...m, qty: getStockForMedicine(m.medicine_id) })).filter(a => a.qty > 0);
  };

  const filteredBySearch = (list) => {
    if (!searchTerm) return list;
    const q = searchTerm.toLowerCase();
    return list.filter(m => (m.name || m.medicine_name || '').toLowerCase().includes(q));
  };

  // Derived selected medicine object from the selectedMedicineId state
  const selectedMedicine = selectedMedicineId ? medicines.find(m => String(m.medicine_id) === String(selectedMedicineId)) : null;

  const alternativesForSelected = () => alternativesFor(selectedMedicine);

  return (
    <div className="min-h-screen p-6 bg-gray-50">
      <ToastContainer />
      <div className="max-w-5xl mx-auto">
        <header className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold">Check Availability</h1>
            <p className="text-sm text-gray-600">{pharmacyInfo ? pharmacyInfo.pharmacy_name || pharmacyInfo.name : (pharmacy_id ? `Pharmacy ID: ${pharmacy_id}` : 'No pharmacy selected in URL')}</p>
            {pharmacyInfo && (
              <div className="mt-1 text-sm text-gray-600">
                <div>Contact: <span className="font-medium">{pharmacyInfo.contact_number || '—'}</span></div>
                <div>Address: <span className="font-medium">{pharmacyInfo.address || '—'}</span></div>
              </div>
            )}
          </div>
          <div>
            <button
              onClick={() => {
                const docId = router.query.doctor_id || router.query.doctorId;
                if (docId) router.push(`/doctor?doctor_id=${docId}`);
                else router.back();
              }}
              className="px-3 py-2 bg-gray-100 rounded hover:bg-gray-200 text-sm"
            >
              ← Back to Dashboard
            </button>
          </div>
        </header>

        {pharmacyInfo && (
          <div className="mb-6 p-5 bg-gradient-to-r from-indigo-50 to-blue-50 rounded-lg shadow-sm border border-indigo-100">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-xs uppercase tracking-wide text-indigo-600 font-semibold mb-1">Current Pharmacy</div>
                <div className="text-xl font-bold text-gray-800">{pharmacyInfo.pharmacy_name || pharmacyInfo.name}</div>
                <div className="text-sm text-gray-600 mt-1">
                  📍 {pharmacyInfo.district ? `${pharmacyInfo.district}, ` : ''}{pharmacyInfo.block || pharmacyInfo.address || '—'}
                </div>
              </div>
              <div className="text-right bg-white px-4 py-3 rounded-lg shadow-sm">
                <div className="text-xs text-gray-500 uppercase tracking-wide">Contact</div>
                <div className="font-semibold text-gray-800 mt-1">📞 {pharmacyInfo.contact_number || '—'}</div>
              </div>
            </div>
          </div>
        )}

        {/* SECTION 1: Browse Current Pharmacy Inventory */}
        {pharmacy_id && (
          <div className="mb-8">
            <div className="bg-gradient-to-br from-blue-50 via-indigo-50 to-purple-50 p-6 rounded-xl shadow-lg border-2 border-blue-200">
              <div className="flex items-center gap-3 mb-4">
                <div className="bg-blue-600 text-white p-3 rounded-lg shadow-md">
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                  </svg>
                </div>
                <div>
                  <h3 className="text-xl font-bold text-gray-800">Browse Current Pharmacy Stock</h3>
                  <p className="text-sm text-gray-600">Explore available medicines by generic categories or search by name</p>
                </div>
              </div>
              
              <div className="flex items-center gap-3">
                <input
                  autoFocus
                  value={searchTerm}
                  onChange={e => setSearchTerm(e.target.value)}
                  placeholder="🔍 Search medicines in this pharmacy (e.g., Paracetamol, Aspirin)"
                  className="flex-1 p-3 border-2 border-blue-300 rounded-lg text-sm shadow-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white"
                />
                <button 
                  onClick={() => setSearchTerm('')} 
                  className="px-6 py-3 bg-gradient-to-r from-blue-600 to-indigo-600 text-white rounded-lg font-semibold hover:from-blue-700 hover:to-indigo-700 transition-all shadow-md"
                >
                  Clear
                </button>
              </div>
              
              <div className="mt-3 flex items-center gap-4 text-sm">
                <div className="bg-white px-4 py-2 rounded-lg shadow-sm border border-blue-200">
                  <span className="text-gray-600">Total Stock:</span>{' '}
                  <span className="font-bold text-blue-700">{totalStock}</span>
                </div>
                <div className="bg-white px-4 py-2 rounded-lg shadow-sm border border-blue-200">
                  <span className="text-gray-600">Generics:</span>{' '}
                  <span className="font-bold text-blue-700">{totalGenerics}</span>
                </div>
              </div>
            </div>

            {/* Generics and Medicines Grid */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mt-6">
              <div className="md:col-span-1 p-4 bg-white rounded shadow">
                <label className="block text-sm font-medium text-gray-700">Generics</label>
                <div className="mt-3 space-y-2 max-h-[60vh] overflow-auto">
                  {generics.length === 0 && <div className="text-sm text-gray-500">No generics available</div>}
                  {generics.map(g => (
                    <button
                      key={g.generic_id}
                      onClick={() => setSelectedGeneric(g.generic_id)}
                      className={`w-full text-left flex items-center justify-between px-3 py-2 rounded ${String(selectedGeneric) === String(g.generic_id) ? 'bg-indigo-600 text-white' : 'bg-gray-50 hover:bg-gray-100'}`}
                    >
                      <div className="truncate">
                        <div className="font-medium">{g.generic_name}</div>
                        <div className="text-xs text-gray-400">{g.medicines.length} brands</div>
                      </div>
                      <div className="ml-3">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${g.availableCount>0 ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
                          {g.availableCount} available
                        </span>
                      </div>
                    </button>
                  ))}
                </div>
                <div className="mt-4 text-sm text-gray-600">Generics: <span className="font-semibold">{totalGenerics}</span> — Total stock items: <span className="font-semibold">{totalStock}</span></div>
                <div className="mt-4">
                  <p className="text-sm text-gray-600">Click a medicine to view availability in this pharmacy.</p>
                </div>
              </div>

              <div className="md:col-span-2 p-4 bg-white rounded shadow">
                <h2 className="text-lg font-medium mb-3">Medicines</h2>
                {loading && <div className="text-sm text-gray-500">Loading...</div>}

                {!loading && (
                  searchTerm ? (
                    <div>
                      {filteredBySearch(medicines).length === 0 && <div className="text-sm text-gray-500">No medicines match your search.</div>}

                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                        {filteredBySearch(medicines).map(m => {
                          const qty = getStockForMedicine(m.medicine_id);
                          const expanded = String(expandedMedicineId) === String(m.medicine_id);
                          return (
                            <div key={m.medicine_id} className="border rounded-lg overflow-hidden shadow-sm bg-white">
                              <button
                                type="button"
                                onClick={() => { setExpandedMedicineId(expanded ? null : m.medicine_id); setSelectedMedicineId(expanded ? '' : m.medicine_id); setSelectedGeneric(m.generic_id ?? m.genericId ?? m.generic_name); }}
                                className="w-full text-left p-4 flex items-start justify-between gap-4"
                              >
                                <div className="flex-1">
                                  <div className="font-medium text-sm">{m.name || m.medicine_name}</div>
                                  <div className="text-xs text-gray-500 mt-1">{m.dosage || m.unit || ''} • {m.manufacturer || ''}</div>
                                  <div className="text-xs text-gray-400 mt-1">{m.generic_name || m.generic || '—'}</div>
                                </div>
                                <div className="flex flex-col items-end">
                                  <div className={`px-3 py-1 rounded-full text-sm font-semibold ${qty>0 ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
                                    {qty>0 ? `${qty} available` : 'Out of stock'}
                                  </div>
                                  <div className="text-xs text-gray-400 mt-2">{expanded ? 'Hide' : 'Details'}</div>
                                </div>
                              </button>

                              {expanded && (
                                <div className="p-3 bg-gray-50 border-t text-sm text-gray-700">
                                  <div className="mb-2">Manufacturer: {m.manufacturer || '—'}</div>
                                  <div>Description: {m.description || '—'}</div>
                                  <div className="mt-3 text-sm font-medium">Alternatives</div>
                                  <ul className="mt-2 space-y-2">
                                    {alternativesFor(m).length === 0 && <li className="text-sm text-gray-500">No alternatives available.</li>}
                                    {alternativesFor(m).map(a => (
                                      <li key={a.medicine_id} className="flex justify-between text-sm">
                                        <div>{a.name || a.medicine_name} <span className="text-gray-400">({a.dosage || ''})</span></div>
                                        <div className="font-medium">{a.qty}</div>
                                      </li>
                                    ))}
                                  </ul>
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ) : selectedGeneric ? (
                    <div>
                      {filteredBySearch(filteredMeds).length === 0 && <div className="text-sm text-gray-500">No medicines found for selected generic.</div>}

                      <ul className="space-y-2">
                        {filteredBySearch(filteredMeds).map(m => {
                          const qty = m._availableQty ?? getStockForMedicine(m.medicine_id);
                          const expanded = String(expandedMedicineId) === String(m.medicine_id);
                          return (
                            <li key={m.medicine_id} className="border rounded overflow-hidden">
                              <button
                                type="button"
                                onClick={() => { setExpandedMedicineId(expanded ? null : m.medicine_id); setSelectedMedicineId(expanded ? '' : m.medicine_id); }}
                                className="w-full text-left p-3 flex items-center justify-between hover:shadow-sm transition"
                              >
                                <div>
                                  <div className="font-medium">{m.name || m.medicine_name}</div>
                                  <div className="text-sm text-gray-500">{m.dosage || m.unit || ''} • {m.manufacturer || ''}</div>
                                </div>
                                <div className="flex items-center gap-3">
                                  {qty > 0 ? (
                                    <div className="px-3 py-1 rounded bg-green-100 text-green-800 text-sm">{qty} available</div>
                                  ) : (
                                    <div className="px-3 py-1 rounded bg-red-100 text-red-800 text-sm">Out of stock</div>
                                  )}
                                  <div className="text-xs text-gray-400">{expanded ? 'Hide' : 'Details'}</div>
                                </div>
                              </button>

                              {expanded && (
                                <div className="p-3 bg-gray-50 border-t">
                                  <div className="text-sm text-gray-700 mb-2">Manufacturer: {m.manufacturer || '—'}</div>
                                  <div className="text-sm text-gray-700">Description: {m.description || '—'}</div>
                                  <div className="mt-3">
                                    <div className="text-sm font-medium mb-1">Alternatives in this pharmacy</div>
                                    <ul className="space-y-2">
                                      {alternativesFor(m).length === 0 && <li className="text-sm text-gray-500">No alternatives available.</li>}
                                      {alternativesFor(m).map(a => (
                                        <li key={a.medicine_id} className="flex justify-between text-sm">
                                          <div>{a.name || a.medicine_name} <span className="text-gray-400">({a.dosage || ''})</span></div>
                                          <div className="font-medium">{a.qty}</div>
                                        </li>
                                      ))}
                                    </ul>
                                  </div>
                                </div>
                              )}
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  ) : (
                    <div className="text-sm text-gray-500">Select a generic to list medicines or use search to find any medicine.</div>
                  )
                )}

                {selectedMedicine && (
                  <div className="mt-6 border-t pt-4">
                    <h3 className="text-md font-semibold">Selected: {selectedMedicine.name || selectedMedicine.medicine_name}</h3>
                    <div className="text-sm text-gray-600">Manufacturer: {selectedMedicine.manufacturer || '—'}</div>
                    <div className="mt-2">Available quantity in this pharmacy: <span className="font-medium">{getStockForMedicine(selectedMedicine.medicine_id)}</span></div>

                    {getStockForMedicine(selectedMedicine.medicine_id) === 0 && (
                      <div className="mt-4 p-3 bg-yellow-50 border border-yellow-200 rounded">
                        <div className="font-medium">Not available</div>
                        <div className="text-sm text-gray-700 mt-2">Alternative medicines with same generic available in this pharmacy:</div>
                        <ul className="mt-2 space-y-2">
                          {alternativesForSelected().length === 0 && <li className="text-sm text-gray-500">No alternatives available in this pharmacy.</li>}
                          {alternativesForSelected().map(a => (
                            <li key={a.medicine_id} className="flex items-center justify-between p-2 border rounded">
                              <div>
                                <div className="font-medium">{a.name || a.medicine_name}</div>
                                <div className="text-sm text-gray-500">{a.dosage || ''} • {a.manufacturer || ''}</div>
                              </div>
                              <div className="text-sm font-medium">{a.qty}</div>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Divider */}
        {pharmacy_id && (
          <div className="my-8 flex items-center">
            <div className="flex-1 border-t-2 border-gray-300"></div>
            <div className="px-4 text-sm font-semibold text-gray-500 uppercase tracking-wide">OR</div>
            <div className="flex-1 border-t-2 border-gray-300"></div>
          </div>
        )}

        {/* SECTION 2: Search Across All Pharmacies */}
        {pharmacy_id && (
          <div className="mb-6 p-6 bg-gradient-to-br from-purple-50 via-pink-50 to-red-50 rounded-xl shadow-lg border-2 border-purple-200">
            <div className="flex items-center gap-3 mb-4">
              <div className="bg-purple-600 text-white p-3 rounded-lg shadow-md">
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
              </div>
              <div>
                <h3 className="text-xl font-bold text-gray-800">Search Across All Pharmacies</h3>
                <p className="text-sm text-gray-600">Find medicine availability in nearby pharmacies with distance info</p>
              </div>
            </div>
            
            <div className="flex gap-3 mb-4">
              <input
                placeholder="🔍 Search medicine across all pharmacies (e.g., Aspirin, Paracetamol)"
                value={inventoryQuery}
                onChange={e => setInventoryQuery(e.target.value)}
                className="flex-1 p-3 border-2 border-purple-300 rounded-lg shadow-sm focus:ring-2 focus:ring-purple-500 focus:border-purple-500 bg-white"
              />
              <button 
                onClick={() => searchInventory(inventoryQuery)} 
                className="px-6 py-3 bg-gradient-to-r from-purple-600 to-pink-600 text-white rounded-lg font-semibold hover:from-purple-700 hover:to-pink-700 transition-all shadow-md"
              >
                Search All
              </button>
            </div>

            {inventoryLoading && (
              <div className="flex items-center gap-2 text-sm text-purple-700 bg-purple-100 p-3 rounded-lg">
                <svg className="animate-spin h-5 w-5" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                Searching across all pharmacies...
              </div>
            )}

            {!inventoryLoading && inventoryResults.length === 0 && inventoryQuery.trim().length >= 2 && (
              <div className="text-sm text-gray-600 bg-white p-4 rounded-lg border border-gray-200">
                ℹ️ No pharmacies found with matching stock for "{inventoryQuery}"
              </div>
            )}

            {!inventoryLoading && inventoryResults.length > 0 && (
              <div className="space-y-3 mt-4">
                <div className="text-sm font-semibold text-gray-700 mb-2">
                  Found in {inventoryResults.length} pharmacy{inventoryResults.length > 1 ? 'ies' : ''}:
                </div>
                {inventoryResults.map(p => {
                  const dist = inventoryDistances[p.pharmacy_id];
                  
                  // Parse medicines with quantities (format: "Medicine1:qty||Medicine2:qty")
                  const medicinesData = p.medicines_with_quantity 
                    ? p.medicines_with_quantity.split('||').map(item => {
                        const [name, qty] = item.split(':');
                        return { name, quantity: parseInt(qty) || 0 };
                      })
                    : [];
                  
                  return (
                    <div key={p.pharmacy_id} className="p-4 bg-white border-2 border-purple-200 rounded-lg shadow-sm hover:shadow-md transition-shadow">
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <div className="font-semibold text-gray-800 text-lg">{p.pharmacy_name}</div>
                          <div className="text-sm text-gray-600 mt-1">📍 {p.address}</div>
                          {(p.district || p.block) && (
                            <div className="text-xs text-gray-500 mt-1">
                              {p.district ? `${p.district}` : ''}{p.district && p.block ? ', ' : ''}{p.block || ''}
                            </div>
                          )}
                          <div className="text-sm text-gray-600">📞 {p.contact_number || '—'}</div>
                          
                          {/* Show available medicines with quantities */}
                          {medicinesData.length > 0 && (
                            <div className="mt-3 p-3 bg-purple-50 rounded-lg border border-purple-100">
                              <div className="text-xs font-semibold text-purple-700 mb-2">Available medicines:</div>
                              <div className="space-y-1">
                                {medicinesData.map((med, idx) => (
                                  <div key={idx} className="flex items-center justify-between text-xs">
                                    <span className="text-gray-700 font-medium">{med.name}</span>
                                    <span className="bg-green-100 text-green-800 px-2 py-0.5 rounded-full font-semibold">
                                      {med.quantity} units
                                    </span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                        <div className="text-right ml-4">
                          <div className="bg-green-100 text-green-800 px-4 py-2 rounded-lg font-bold text-lg">
                            {p.total_quantity} total
                          </div>
                          {dist && (
                            <div className="mt-2 text-xs text-gray-600 bg-gray-100 px-3 py-1 rounded-full inline-block">
                              🚗 {dist.distance_km} km • ⏱️ {dist.time_min} min
                            </div>
                          )}
                          {!dist && (
                            <div className="mt-2 text-xs text-gray-400">Calculating distance...</div>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {!pharmacy_id && (
          <div className="p-4 bg-yellow-50 border border-yellow-200 rounded">Provide `pharmacy_id` in the URL query to view pharmacy stocks, e.g. <span className="font-mono">?pharmacy_id=3</span></div>
        )}
      </div>
    </div>
  );
};

export default pharmacyMedicine;
