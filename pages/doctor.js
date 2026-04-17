import jsPDF from "jspdf";
import { useRouter } from "next/router";
import { useEffect, useState } from "react";
import { ToastContainer, toast } from "react-toastify";
import "react-toastify/dist/ReactToastify.css";
import useSSE from "../hooks/useSSE";

const DoctorDashboard = () => {
  const router = useRouter();
  const [prescriptions, setPrescriptions] = useState([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [patients, setPatients] = useState([]);
  const [medicines, setMedicines] = useState([]);
  const [pharmacies, setPharmacies] = useState([]);
  const [doctorInfo, setDoctorInfo] = useState(null);
  const [editingPrescription, setEditingPrescription] = useState(null);
  const [formData, setFormData] = useState({
    opd_number: "",
    diagnosis: "",
    // pharmacy_id removed: doctors should not select pharmacy when creating prescriptions
    medicines: [
      {
        medicine_id: "",
        quantity: "",
        frequency: "",
        duration_days: "",
        instructions: ""
      }
    ]
  });

  // Real-time updates via SSE — doctor sees prescription fulfillments
  // No useCallback needed — useSSE stores onEvent in a ref, so it always
  // calls the latest version without re-opening the EventSource connection.
  const handleSSEEvent = (event) => {
    if (event.type === 'prescription:served') {
      loadData();
      toast.info('A prescription was served by a pharmacy', { autoClose: 3000 });
    }
  };

  useSSE({ role: 'doctor', id: router.query.doctor_id, onEvent: handleSSEEvent });

  useEffect(() => {
    checkAuth();
    if (router.query.doctor_id) { // Only load data when doctor_id is available in URL
      loadData();
    }
  }, [router.query.doctor_id]); // Re-run when doctor_id changes

  // Handle clicks outside of dropdown
  useEffect(() => {
    function handleClick(event) {
      const dropdown = document.getElementById("patient-dropdown");
      if (dropdown && !event.target.closest(".patient-search-container")) {
        dropdown.style.display = "none";
      }
    }

    document.addEventListener("click", handleClick);
    return () => document.removeEventListener("click", handleClick);
  }, []);

  const checkAuth = async () => {
    try {
      const token = localStorage.getItem("token");
      if (!token) router.push("/");
    } catch (error) {
      router.push("/");
    }
  };

  const loadData = async () => {
    try {
      const token = localStorage.getItem("token");
      const doctor_id = router.query.doctor_id; 
      
      console.log('Fetching prescriptions for doctor:', doctor_id);
      const prescriptionsRes = await fetch(`/api/fetchPrescriptions?doctor_id=${doctor_id}`, {
        headers: { Authorization: token }
      });
      const prescriptionsData = await prescriptionsRes.json();
      
      console.log('Prescriptions data:', prescriptionsData);
      if (prescriptionsData.success) {
        setPrescriptions(prescriptionsData.prescriptions);
      } else {
        console.error('Failed to fetch prescriptions:', prescriptionsData.message);
        toast.error('Failed to fetch prescriptions');
      }
      console.log('Fetching prescription data');
      const dataRes = await fetch('/api/fetchPrescriptionData');
      const data = await dataRes.json();
      
      console.log('Prescription data:', data);
      if (data.success) {
        setPatients(data.patients);
        setMedicines(data.medicines);
        setPharmacies(data.pharmacies);
      } else {
        console.error('Failed to fetch prescription data:', data.message);
        toast.error('Failed to fetch prescription data');
      }

      // Fetch doctor info (name/address)
      try {
        const docRes = await fetch(`/api/getDoctorInfo?doctorId=${doctor_id}`);
        const docData = await docRes.json();
        if (docData.success) setDoctorInfo(docData.doctor);
      } catch (err) {
        console.error('Error fetching doctor info:', err);
      }
    } catch (error) {
      console.error('Error loading data:', error);
      toast.error('Error loading data');
    }
  };

  const handleLogout = () => {
    localStorage.removeItem("token");
    localStorage.removeItem("userType");
    localStorage.removeItem("userId");
    router.push("/");
  };

  const handleCreatePrescription = () => {
    setEditingPrescription(null);
    setFormData({
      opd_number: "",
      diagnosis: "",
      // pharmacy_id removed: doctors should not select pharmacy when creating prescriptions
      medicines: [
        {
          medicine_id: "",
          quantity: "",
          frequency: "",
          duration_days: "",
          instructions: ""
        }
      ]
    });
    setIsModalOpen(true);
  };

  const handleEditPrescription = (prescription) => {
    setEditingPrescription(prescription);
    setFormData({
      opd_number: prescription.opd_number,
      diagnosis: prescription.diagnosis || "",
      // pharmacy_id intentionally not set here
      medicines: prescription.medicines.map(med => ({
        medicine_id: med.medicine_id,
        quantity: med.quantity,
        frequency: med.frequency,
        duration_days: med.duration_days,
        instructions: med.instructions || ""
      }))
    });
    setIsModalOpen(true);
  };

  const handleAddMedicine = () => {
    setFormData({
      ...formData,
      medicines: [
        ...formData.medicines,
        {
          medicine_id: "",
          quantity: "",
          frequency: "",
          duration_days: "",
          instructions: ""
        }
      ]
    });
  };

  const handleRemoveMedicine = (index) => {
    const newMedicines = formData.medicines.filter((_, i) => i !== index);
    setFormData({ ...formData, medicines: newMedicines });
  };

  const handleMedicineChange = (index, field, value) => {
    const newMedicines = [...formData.medicines];
    newMedicines[index] = { ...newMedicines[index], [field]: value };
    setFormData({ ...formData, medicines: newMedicines });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    
    try {
      const doctor_id = router.query.doctor_id;
      const token = localStorage.getItem("token");

      // Check if doctor_id is available
      if (!doctor_id) {
        toast.error('Doctor ID not available. Please try again.');
        return;
      }
      
      console.log('Submitting form data:', {
        ...formData,
        doctor_id,
        prescription_id: editingPrescription?.prescription_id
      });
      
      const endpoint = editingPrescription
        ? '/api/updatePrescription'
        : '/api/createPrescription';
      
      const method = editingPrescription ? 'PUT' : 'POST';
      
      const response = await fetch(endpoint, {
        method,
        headers: {
          'Content-Type': 'application/json',
          Authorization: token
        },
        body: JSON.stringify({
          ...formData,
          doctor_id,
          prescription_id: editingPrescription?.prescription_id
        })
      });

      const data = await response.json();

      if (data.success) {
        toast.success(editingPrescription ? 'Prescription updated' : 'Prescription created');
        setIsModalOpen(false);
        loadData(); // Reload prescriptions
      } else {
        toast.error(data.message || 'Error saving prescription');
      }
    } catch (error) {
      console.error('Error saving prescription:', error);
      toast.error('Error saving prescription');
    }
  };

  const handleGenerateNAC = async (prescription) => {
    try {
      // First, update NAC status in database (only once)
      if (prescription.NAC === 0) {
        const response = await fetch('/api/issueNAC', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ prescription_id: prescription.prescription_id })
        });

        const data = await response.json();
        
        if (!data.success) {
          toast.error(data.message || 'Failed to issue NAC');
          return;
        }

        // Update local state
        setPrescriptions(prescriptions.map(p => 
          p.prescription_id === prescription.prescription_id 
            ? { ...p, NAC: 1 } 
            : p
        ));

        toast.success('NAC issued successfully');
      }

      // Generate PDF (can be done multiple times)
      const doc = new jsPDF();
      
      // Header
      doc.setFontSize(18);
      doc.setFont(undefined, 'bold');
      doc.text('NON-AVAILABILITY CERTIFICATE (NAC)', 105, 20, { align: 'center' });
      
      doc.setFontSize(11);
      doc.setFont(undefined, 'normal');
      doc.text('Government Medical Supply Network', 105, 28, { align: 'center' });
      
      // Horizontal line
      doc.setLineWidth(0.5);
      doc.line(20, 35, 190, 35);
      
      // Certificate details
      doc.setFontSize(12);
      let y = 50;
      
      doc.text('Certificate No:', 20, y);
      doc.setFont(undefined, 'bold');
      doc.text(`NAC-${prescription.prescription_id}-${Date.now()}`, 60, y);
      doc.setFont(undefined, 'normal');
      
      y += 10;
      doc.text('Date of Issue:', 20, y);
      doc.setFont(undefined, 'bold');
      doc.text(new Date().toLocaleDateString('en-IN'), 60, y);
      doc.setFont(undefined, 'normal');
      
      y += 15;
      doc.setFontSize(11);
      doc.text('This is to certify that:', 20, y);
      
      // Patient details
      y += 10;
      doc.setFont(undefined, 'bold');
      doc.text('Patient Name:', 25, y);
      doc.setFont(undefined, 'normal');
      doc.text(prescription.patient_name || 'N/A', 65, y);
      
      y += 8;
      doc.setFont(undefined, 'bold');
      doc.text('OPD Number:', 25, y);
      doc.setFont(undefined, 'normal');
      doc.text(prescription.opd_number || 'N/A', 65, y);
      
      y += 8;
      doc.setFont(undefined, 'bold');
      doc.text('Age/Gender:', 25, y);
      doc.setFont(undefined, 'normal');
      doc.text(`${prescription.age || 'N/A'} / ${prescription.gender || 'N/A'}`, 65, y);
      
      y += 8;
      doc.setFont(undefined, 'bold');
      doc.text('Diagnosis:', 25, y);
      doc.setFont(undefined, 'normal');
      doc.text(prescription.diagnosis || 'N/A', 65, y);
      
      // Medicine unavailability statement
      y += 15;
      doc.setFontSize(12);
      doc.setFont(undefined, 'bold');
      doc.text('PRESCRIBED MEDICINES NOT AVAILABLE:', 20, y);
      doc.setFont(undefined, 'normal');
      doc.setFontSize(11);
      
      y += 10;
      prescription.medicines.forEach((med, index) => {
        if (y > 250) {
          doc.addPage();
          y = 20;
        }
        doc.text(`${index + 1}. ${med.name} - ${med.dosage} ${med.unit}`, 25, y);
        y += 6;
        doc.setFontSize(10);
        doc.text(`   Quantity: ${med.quantity}, Frequency: ${med.frequency}`, 25, y);
        y += 8;
        doc.setFontSize(11);
      });
      
      // Authorization statement
      y += 10;
      doc.setFontSize(11);
      const statement = 'The above-mentioned medicine(s) are NOT AVAILABLE in our government medical supply network. The patient is hereby AUTHORIZED to purchase the required medicines from external sources at their own expense.';
      const lines = doc.splitTextToSize(statement, 170);
      doc.text(lines, 20, y);
      
      y += lines.length * 6 + 10;
      
      // Footer
      if (y > 240) {
        doc.addPage();
        y = 20;
      }
      
      y += 20;
      doc.setFont(undefined, 'bold');
      doc.text('Authorized By:', 20, y);
      doc.setFont(undefined, 'normal');
      doc.text(doctorInfo?.name || 'Medical Officer', 20, y + 8);
      doc.text(`Doctor ID: ${router.query.doctor_id || 'N/A'}`, 20, y + 16);
      if (doctorInfo?.address) {
        const addressLines = doc.splitTextToSize(`Location: ${doctorInfo.address}`, 80);
        doc.text(addressLines, 20, y + 24);
      }
      
      doc.text('Digital Signature', 140, y);
      doc.text(`Issued: ${new Date().toLocaleString('en-IN')}`, 140, y + 8);
      
      // Watermark
      doc.setFontSize(40);
      doc.setTextColor(220, 220, 220);
      doc.text('GOVT NAC', 105, 150, { align: 'center', angle: 45 });
      
      // Save PDF
      doc.save(`NAC-${prescription.prescription_id}-${prescription.patient_name}.pdf`);
      
    } catch (error) {
      console.error('Error generating NAC:', error);
      toast.error('Error generating NAC certificate');
    }
  };

  return (
    <>
      <ToastContainer position="top-center" autoClose={1500} hideProgressBar />

      <div className="flex min-h-screen bg-gray-100">
        <aside className="w-64 px-4 py-8 bg-white shadow-lg">
          <h2 className="text-2xl font-bold text-indigo-700 mb-4">Doctor</h2>
          <nav className="space-y-3">
            <button
              onClick={() => {
                const base = `/pharmacyMedicine?doctor_id=${router.query.doctor_id}`;
                const url = doctorInfo && doctorInfo.pharmacy_id ? `${base}&pharmacy_id=${doctorInfo.pharmacy_id}` : base;
                router.push(url);
              }}
              className="flex items-center w-full px-4 py-3 text-left text-white bg-indigo-600 rounded-lg shadow-md hover:bg-indigo-500 transition-colors duration-200"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2" viewBox="0 0 20 20" fill="currentColor">
                <path d="M3 3a1 1 0 011-1h12a1 1 0 011 1v2a1 1 0 01-1 1H4a1 1 0 01-1-1V3zM3 9a1 1 0 011-1h12a1 1 0 011 1v6a1 1 0 01-1 1H4a1 1 0 01-1-1V9z" />
              </svg>
              Check Availability of Medicines in Pharmacy
            </button>
          </nav>
        </aside>

        <div className="flex-1">
          <header className="bg-white shadow">
            <div className="max-w-7xl mx-auto py-6 px-4 sm:px-6 lg:px-8 flex justify-between items-center">
              <h1 className="text-3xl font-bold text-gray-900">Doctor Dashboard</h1>
              {doctorInfo && (
                <div className="text-sm text-gray-600">
                  <div className="font-medium">{doctorInfo.name}</div>
                  <div>{doctorInfo.address}</div>
                </div>
              )}
              <div className="flex space-x-4">
                <button
                  onClick={handleCreatePrescription}
                  className="bg-blue-500 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded flex items-center"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z" clipRule="evenodd" />
                  </svg>
                  New Prescription
                </button>
                <button
                  onClick={handleLogout}
                  className="bg-red-500 hover:bg-red-700 text-white font-bold py-2 px-4 rounded flex items-center"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M3 3a1 1 0 011 1v12a1 1 0 11-2 0V4a1 1 0 011-1zm7.707 3.293a1 1 0 010 1.414L9.414 9H17a1 1 0 110 2H9.414l1.293 1.293a1 1 0 01-1.414 1.414l-3-3a1 1 0 010-1.414l3-3a1 1 0 011.414 0z" clipRule="evenodd" />
                  </svg>
                  Logout
                </button>
              </div>
            </div>
          </header>

          <main className="max-w-7xl mx-auto py-6 sm:px-6 lg:px-8">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {prescriptions.map((prescription) => (
                <div
                  key={prescription.prescription_id}
                  className="bg-white overflow-hidden shadow-lg rounded-lg hover:shadow-xl transition-shadow duration-300"
                >
                  <div className="px-6 py-4">
                    <div className="flex justify-between items-start mb-4">
                      <div>
                        <h3 className="text-xl font-semibold text-gray-900 mb-1">
                          {prescription.patient_name}
                        </h3>
                        <p className="text-sm text-gray-600">
                          {new Date(prescription.created_at).toLocaleDateString()}
                        </p>
                      </div>
                      <span className="px-3 py-1 text-sm font-semibold text-blue-800 bg-blue-100 rounded-full">
                        OPD #{prescription.opd_number}
                      </span>
                    </div>

                    <div className="mb-2">
                      {prescription.pharmacy_id ? (
                        <p className="text-sm text-green-600 font-medium">
                          ✓ Order served by Pharmacy: {prescription.pharmacy_name}
                        </p>
                      ) : prescription.NAC === 1 ? (
                        <div className="flex items-center gap-2 p-2 bg-red-50 border border-red-200 rounded">
                          <svg className="w-5 h-5 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                          </svg>
                          <p className="text-sm text-red-700 font-semibold">NAC ISSUED - Medicine Not Available</p>
                        </div>
                      ) : (
                        <div className="flex items-center gap-2 p-2 bg-yellow-50 border border-yellow-200 rounded">
                          <svg className="w-5 h-5 text-yellow-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                          </svg>
                          <p className="text-sm text-yellow-700 font-medium">Awaiting pharmacy assignment</p>
                        </div>
                      )}
                    </div>

                    <div className="mb-4">
                      <h4 className="text-md font-medium text-gray-700 mb-2">Diagnosis</h4>
                      <p className="text-gray-600">{prescription.diagnosis || 'N/A'}</p>
                    </div>

                    <div>
                      <h4 className="text-md font-medium text-gray-700 mb-2">Medicines</h4>
                      <ul className="space-y-2">
                        {prescription.medicines.map((medicine, index) => (
                          <li key={index} className="text-sm text-gray-600">
                            <span className="font-medium">{medicine.name}</span>
                            {medicine.dosage && ` - ${medicine.dosage}`}
                            <br />
                            <span className="text-gray-500">
                              {medicine.frequency} for {medicine.duration_days} days
                              {medicine.instructions && ` - ${medicine.instructions}`}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>

                  <div className="px-6 py-3 bg-gray-50 flex justify-end space-x-3">
                    {prescription.NAC === 1 ? (
                      // NAC already issued - show locked status and regenerate button
                      <>
                        <span className="text-sm text-red-600 font-semibold flex items-center gap-1">
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                          </svg>
                          Locked (NAC Issued)
                        </span>
                        <button
                          className="px-4 py-2 text-white bg-red-600 hover:bg-red-700 rounded-lg text-sm font-medium transition-colors flex items-center gap-2"
                          onClick={() => handleGenerateNAC(prescription)}
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                          </svg>
                          Re-Download NAC
                        </button>
                      </>
                    ) : prescription.pharmacy_id ? (
                      // Served by pharmacy - locked
                      <span className="text-sm text-gray-500">Locked (served by pharmacy)</span>
                    ) : (
                      // Not served and NAC not issued - show edit and issue NAC buttons
                      <>
                        <button
                          className="text-blue-600 hover:text-blue-800 text-sm font-medium"
                          onClick={() => handleEditPrescription(prescription)}
                        >
                          Edit
                        </button>
                        <button
                          className="px-4 py-2 text-white bg-red-600 hover:bg-red-700 rounded-lg text-sm font-medium transition-colors flex items-center gap-2"
                          onClick={() => handleGenerateNAC(prescription)}
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                          </svg>
                          Issue NAC
                        </button>
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </main>
        </div>
      </div>

      {isModalOpen && (
        <div className="fixed inset-0 bg-gray-600 bg-opacity-50 overflow-y-auto h-full w-full z-50">
          <div className="relative top-20 mx-auto p-5 border w-full max-w-3xl shadow-lg rounded-md bg-white">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-semibold text-gray-900">
                {editingPrescription ? 'Edit Prescription' : 'New Prescription'}
              </h3>
              <button onClick={() => setIsModalOpen(false)} className="text-gray-400 hover:text-gray-500">
                <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <form onSubmit={handleSubmit} className="space-y-6">
              <div>
                <label className="block text-sm font-medium text-gray-700">Patient</label>
                <div className="relative">
                  <input
                    type="text"
                    value={formData.searchTerm || ""}
                    onChange={(e) => {
                      setFormData({ ...formData, searchTerm: e.target.value, opd_number: "" });
                      if (e.target.value) {
                        document.getElementById("patient-dropdown").style.display = "block";
                      } else {
                        document.getElementById("patient-dropdown").style.display = "none";
                      }
                    }}
                    placeholder="Search by name or OPD number"
                    className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                    disabled={editingPrescription}
                  />

                  <div id="patient-dropdown" className="absolute z-10 w-full mt-1 bg-white shadow-lg max-h-60 rounded-md py-1 text-base overflow-auto focus:outline-none sm:text-sm hidden">
                    {patients
                      .filter((patient) => !formData.searchTerm ||
                        patient.patient_name.toLowerCase().includes((formData.searchTerm || "").toLowerCase()) ||
                        patient.opd_number.toString().includes((formData.searchTerm || "").toLowerCase())
                      )
                      .map((patient) => (
                        <div
                          key={patient.opd_number}
                          onClick={() => {
                            setFormData({ ...formData, opd_number: patient.opd_number, searchTerm: `${patient.patient_name} - OPD #${patient.opd_number}` });
                            document.getElementById("patient-dropdown").style.display = "none";
                          }}
                          className="cursor-pointer select-none relative py-2 pl-3 pr-9 hover:bg-gray-50"
                        >
                          <div className="flex items-center">
                            <span className="ml-3 block truncate">{patient.patient_name} - OPD #{patient.opd_number}</span>
                          </div>
                        </div>
                      ))}
                  </div>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700">Diagnosis</label>
                <textarea value={formData.diagnosis} onChange={(e) => setFormData({ ...formData, diagnosis: e.target.value })} className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500" rows="2" />
              </div>

              <div>
                <div className="flex justify-between items-center mb-2">
                  <label className="block text-sm font-medium text-gray-700">Medicines</label>
                  <button type="button" onClick={handleAddMedicine} className="text-blue-600 hover:text-blue-800 text-sm font-medium">+ Add Medicine</button>
                </div>

                <div className="space-y-4">
                  {formData.medicines.map((medicine, index) => (
                    <div key={index} className="flex flex-wrap gap-4 p-4 bg-gray-50 rounded-md">
                      <div className="flex-1 min-w-[200px]">
                        <select value={medicine.medicine_id} onChange={(e) => handleMedicineChange(index, 'medicine_id', e.target.value)} className="block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500" required>
                          <option value="">Select Medicine</option>
                          {medicines.map((med) => (
                            <option key={med.medicine_id} value={med.medicine_id}>{med.name} ({med.dosage} {med.unit})</option>
                          ))}
                        </select>
                      </div>

                      <div className="w-24">
                        <input type="number" value={medicine.quantity} onChange={(e) => handleMedicineChange(index, 'quantity', e.target.value)} placeholder="Qty" className="block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500" required />
                      </div>

                      <div className="w-32">
                        <input type="text" value={medicine.frequency} onChange={(e) => handleMedicineChange(index, 'frequency', e.target.value)} placeholder="Frequency" className="block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500" required />
                      </div>

                      <div className="w-24">
                        <input type="number" value={medicine.duration_days} onChange={(e) => handleMedicineChange(index, 'duration_days', e.target.value)} placeholder="Days" className="block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500" required />
                      </div>

                      <div className="flex-1 min-w-[200px]">
                        <input type="text" value={medicine.instructions} onChange={(e) => handleMedicineChange(index, 'instructions', e.target.value)} placeholder="Instructions" className="block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500" />
                      </div>

                      {formData.medicines.length > 1 && (
                        <button type="button" onClick={() => handleRemoveMedicine(index)} className="text-red-600 hover:text-red-800">
                          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m4-7V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3H7V4a1 1 0 00-1-1H2a1 1 0 00-1 1v3h15.586l-2.293-2.293a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414-1.414L17.586 7H3" /></svg>
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              <div className="flex justify-end space-x-3">
                <button type="button" onClick={() => setIsModalOpen(false)} className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-md">Cancel</button>
                <button type="submit" className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-md">{editingPrescription ? 'Update Prescription' : 'Create Prescription'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
};

export default DoctorDashboard;