import { useRouter } from "next/router";
import { useEffect, useState } from "react";
import { ToastContainer, toast } from "react-toastify";
import "react-toastify/dist/ReactToastify.css";
import useSSE from "../hooks/useSSE";

const Patient = () => {
  const router = useRouter();
  const { opd_number } = router.query;
  const [patient, setPatient] = useState(null);
  const [prescriptions, setPrescriptions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [refreshTrigger, setRefreshTrigger] = useState(0);

  // Real-time updates via SSE — patient sees prescription fulfillments
  // No useCallback needed — useSSE stores onEvent in a ref, so it always
  // calls the latest version without re-opening the EventSource connection.
  const handleSSEEvent = (event) => {
    if (event.type === 'prescription:served') {
      setRefreshTrigger(prev => prev + 1);
      toast.info('Your prescription has been served by a pharmacy', { autoClose: 3000 });
    }
  };

  useSSE({ role: 'patient', id: opd_number, onEvent: handleSSEEvent });

  useEffect(() => {
    async function loadData() {
      if (!opd_number) return;
      setLoading(true);
      setError(null);

      try {
        const res = await fetch(`/api/fetchPatientPrescriptions?opd_number=${encodeURIComponent(opd_number)}`);
        const data = await res.json();
        if (data.success) {
          setPatient(data.patient);
          setPrescriptions(data.prescriptions || []);
        } else {
          setError(data.message || 'Failed to load data');
        }
      } catch (err) {
        console.error('Error loading patient data:', err);
        setError('Error loading data');
      } finally {
        setLoading(false);
      }
    }

    loadData();
  }, [opd_number, refreshTrigger]);

  const handleLogout = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('userType');
    router.push('/');
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <ToastContainer position="top-center" autoClose={1500} hideProgressBar />
      <header className="bg-white shadow">
        <div className="max-w-4xl mx-auto py-6 px-4 sm:px-6 lg:px-8 flex justify-between items-center">
          <h1 className="text-2xl font-bold text-gray-900">Patient Dashboard</h1>
          <div className="flex items-center space-x-3">
            <button onClick={handleLogout} className="px-3 py-2 bg-red-500 text-white rounded">Logout</button>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto py-8 px-4">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {/* Patient Card */}
          <aside className="md:col-span-1">
            <div className="bg-white p-6 rounded-lg shadow">
              {loading ? (
                <div className="animate-pulse">
                  <div className="h-10 bg-gray-200 rounded w-32 mb-4" />
                  <div className="h-6 bg-gray-200 rounded w-full mb-2" />
                  <div className="h-6 bg-gray-200 rounded w-full mb-2" />
                </div>
              ) : patient ? (
                <div className="text-center">
                  <div className="w-24 h-24 mx-auto bg-indigo-100 rounded-full flex items-center justify-center mb-4">
                    <span className="text-2xl font-bold text-indigo-700">{(patient.patient_name || 'P').split(' ').map(n=>n[0]).join('').slice(0,2)}</span>
                  </div>
                  <h3 className="text-xl font-semibold">{patient.patient_name}</h3>
                  <p className="text-sm text-gray-500">{patient.opd_number}</p>

                  <div className="mt-4 text-left">
                    <p><strong>Age:</strong> {patient.age || '-'}</p>
                    <p><strong>Gender:</strong> {patient.gender || '-'}</p>
                  </div>

                  <button onClick={handleLogout} className="mt-6 w-full bg-red-500 text-white py-2 rounded">Logout</button>
                </div>
              ) : (
                <div className="text-center text-gray-500">No patient data</div>
              )}
            </div>
          </aside>

          {/* Prescriptions list */}
          <section className="md:col-span-2">
            <div className="bg-white p-6 rounded-lg shadow">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold">Recent Prescriptions</h2>
                <div className="text-sm text-gray-500">{loading ? 'Loading…' : `${prescriptions.length} records`}</div>
              </div>

              {error && <div className="mb-4 text-red-600">{error}</div>}

              {prescriptions.length === 0 && !loading ? (
                <div className="text-gray-500">No prescriptions found for this OPD.</div>
              ) : (
                <div className="space-y-4">
                  {prescriptions.map((pres) => (
                    <details key={pres.prescription_id} className="border rounded">
                      <summary className="p-4 flex items-center justify-between cursor-pointer">
                        <div>
                          <div className="font-semibold">{pres.diagnosis || 'No diagnosis'}</div>
                          <div className="text-sm text-gray-500">{new Date(pres.created_at).toLocaleString()}</div>
                        </div>
                        <div className="text-right text-sm">
                          {pres.pharmacy_id ? (
                            <div className="text-green-700">Medicines collected from: <span className="font-medium">{pres.pharmacy_name || `Pharmacy #${pres.pharmacy_id}`}</span></div>
                          ) : (
                            <div className="text-red-500">Prescription medicines not collected from any pharmacy</div>
                          )}
                        </div>
                      </summary>

                      <div className="p-4 bg-gray-50">
                        <h4 className="font-medium mb-2">Medicines</h4>
                        <div className="overflow-x-auto">
                          <table className="w-full text-sm">
                            <thead>
                              <tr className="text-left text-gray-600">
                                <th className="pb-2">Name</th>
                                <th className="pb-2">Dosage</th>
                                <th className="pb-2">Frequency</th>
                                <th className="pb-2">Duration</th>
                                <th className="pb-2">Quantity</th>
                              </tr>
                            </thead>
                            <tbody>
                              {pres.medicines.length === 0 && (
                                <tr><td colSpan={5} className="py-2 text-gray-500">No medicines listed</td></tr>
                              )}
                              {pres.medicines.map((m, idx) => (
                                <tr key={idx} className="border-t">
                                  <td className="py-2">{m.name}</td>
                                  <td className="py-2">{m.dosage || '-'}</td>
                                  <td className="py-2">{m.frequency || '-'}</td>
                                  <td className="py-2">{m.duration_days ? `${m.duration_days} days` : '-'}</td>
                                  <td className="py-2">{m.quantity ?? '-'}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    </details>
                  ))}
                </div>
              )}
            </div>
          </section>
        </div>
      </main>
    </div>
  );
};

export default Patient;
