import { useRouter } from "next/router";
import { useState } from "react";
import { ToastContainer, toast } from "react-toastify";
import "react-toastify/dist/ReactToastify.css";
require("dotenv").config();

export default function Home() {
  const [userType, setUserType] = useState("");
  const [isSignUp, setIsSignUp] = useState(false);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState(""); // For CMO name
  const [contactNumber, setContactNumber] = useState("");
  const [district, setDistrict] = useState("");
  const [block, setBlock] = useState("");
  const [address, setAddress] = useState("");
  const [pharmacyName, setPharmacyName] = useState("");
  const [warehouseName, setWarehouseName] = useState("");
  const [patientName, setPatientName] = useState("");
  const [patientAge, setPatientAge] = useState("");
  const [patientGender, setPatientGender] = useState("");

  const router = useRouter();

  // -------------------- LOGIN --------------------
  const handleLogin = async (e) => {
    e.preventDefault();

    if (!username || !password) {
      toast.error("Please fill in all fields!", { position: "top-center", autoClose: 1500 });
      return;
    }

    try {
      let endpoint;
      let bodyPayload;
      if (userType === "pharmacy") {
        endpoint = "/api/user_login";
        bodyPayload = { username, password };
      } else if (userType === "cmo") {
        endpoint = "/api/admin_login";
        bodyPayload = { email: username, password };
      } else if (userType === "doctor") {
        endpoint = "/api/doctor_login";
        bodyPayload = { username, password };
      } else if (userType === "patient") {
        endpoint = "/api/patient_login";
        bodyPayload = { opd_number: username, password };
      } else if (userType === "warehouse") {
        endpoint = "/api/warehouse_login";
        bodyPayload = { email: username, password };
      }

      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(bodyPayload),
      });

      const response = await res.json();

      if (response.success) {
        toast.success("Login successful!", { position: "top-center", autoClose: 1500 });

        localStorage.setItem("token", response.token);
        localStorage.setItem("userType", userType);

        setTimeout(() => {
          if (userType === "pharmacy") {
            router.push({ pathname: "/user", query: { pharmacy_id: response.pharmacy.id } });
          } else if (userType === "cmo") {
            router.push({ pathname: "/admin", query: { cmo_id: response.cmo.id } });
          } else if (userType === "doctor") {
            router.push({ pathname: "/doctor", query: { doctor_id: response.doctor.doctor_id } });
          } else if (userType === "patient") {
            // pass opd_number so patient page can fetch prescriptions by OPD
            router.push({ pathname: "/patient", query: { opd_number: response.patient.opd_number } });
          } else if (userType === "warehouse") {
            router.push({ pathname: "/warehouse", query: { warehouse_id: response.warehouse.warehouse_id } });
          }
        }, 1500);
      } else {
        toast.error(response.error || "Invalid credentials!", { position: "top-center", autoClose: 1500 });
      }
    } catch (error) {
      console.error("Login error:", error);
      toast.error("Something went wrong!", { position: "top-center", autoClose: 1500 });
    }
  };

  // -------------------- SIGN UP --------------------
  const handleSignUp = async (e) => {
    e.preventDefault();

    // For patient signup we don't require a username and password is optional
    if (userType === "patient") {
      if (!patientName) {
        toast.error("Patient name is required.", { position: "top-center", autoClose: 1500 });
        return;
      }
    } else {
      if (!username || !password) {
        toast.error("Username and password are required.", { position: "top-center", autoClose: 1500 });
        return;
      }
    }

    let data = {};

    if (userType === "pharmacy") {
      if (!pharmacyName) {
        toast.error("Pharmacy name is required.", { position: "top-center", autoClose: 1500 });
        return;
      }
      data = {
        pharmacy_name: pharmacyName,
        username,
        password,
        contact_number: contactNumber,
        district,
        block,
        address,
      };
    } else if (userType === "doctor") {
      data = {
        username,
        password,
        contact_number: contactNumber,
        district,
        block,
        address,
      };
    } else if (userType === "warehouse") {
      if (!warehouseName) {
        toast.error("Warehouse name is required.", { position: "top-center", autoClose: 1500 });
        return;
      }
      data = {
        name: warehouseName,
        email: username,
        password,
        contact_number: contactNumber,
        district,
        block,
        address,
      };
    } else if (userType === "patient") {
      data = {
        patient_name: patientName,
        age: patientAge,
        gender: patientGender,
        password: password || undefined
      };
    } else if (userType === "cmo") {
      if (!name) {
        toast.error("Name is required for CMO.", { position: "top-center", autoClose: 1500 });
        return;
      }
      data = {
        name,
        email: username, // this will be email for CMO
        password,
        contact_number: contactNumber,
        district,
        block,
        address,
      };
    }

    try {
      const endpoint =
        userType === "pharmacy"
          ? "/api/user_registration"
          : userType === "cmo"
          ? "/api/admin_registration"
          : userType === "doctor"
          ? "/api/doctor_registration"
          : userType === "patient"
          ? "/api/patient_registration"
          : userType === "warehouse"
          ? "/api/warehouse_registration"
          : "/api/doctor_registration";

      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });

      const response = await res.json();

      if (response.success) {
        toast.success("Registration successful!", { position: "top-center", autoClose: 1500 });
        setTimeout(() => setIsSignUp(false), 1500);
      } else {
        toast.error(response.error || "Signup failed!", { position: "top-center", autoClose: 1500 });
      }
    } catch (error) {
      console.error("Signup error:", error);
      toast.error("Internal Server Error.", { position: "top-center", autoClose: 1500 });
    }
  };

  // -------------------- UI --------------------
  if (!userType) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center p-4">
        <div className="bg-white rounded-lg shadow-lg p-10 w-full max-w-lg">
          <div className="text-center mb-10">
            <div className="mx-auto w-20 h-20 bg-indigo-100 rounded-full flex items-center justify-center mb-6">
              <svg className="w-10 h-10 text-indigo-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-4m-5 0H3m2 0v-3.57a3 3 0 011.111-2.343zM11 19h2M7 7h.01M7 11h.01M11 7h.01M11 11h.01M15 7h.01M15 11h.01" />
              </svg>
            </div>
            <h1 className="text-3xl font-bold text-gray-800 mb-3">Medical Management System</h1>
            <p className="text-gray-600 text-lg">Please select your role to continue</p>
          </div>
          
          <div className="space-y-4">
            <button 
              className="w-full bg-blue-600 hover:bg-blue-700 text-white px-8 py-4 rounded-lg font-medium transition-colors duration-200 flex items-center justify-center text-lg"
              onClick={() => setUserType("pharmacy")}
            >
              <svg className="w-6 h-6 mr-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-4m-5 0H3m2 0v-3.57a3 3 0 011.111-2.343zM11 19h2M7 7h.01M7 11h.01M11 7h.01M11 11h.01M15 7h.01M15 11h.01" />
              </svg>
              Pharmacy Login
            </button>
            
            <button 
              className="w-full bg-green-600 hover:bg-green-700 text-white px-8 py-4 rounded-lg font-medium transition-colors duration-200 flex items-center justify-center text-lg"
              onClick={() => setUserType("cmo")}
            >
              <svg className="w-6 h-6 mr-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              CMO Login
            </button>
            
            <button 
              className="w-full bg-indigo-600 hover:bg-indigo-700 text-white px-8 py-4 rounded-lg font-medium transition-colors duration-200 flex items-center justify-center text-lg"
              onClick={() => setUserType("doctor")}
            >
              <svg className="w-6 h-6 mr-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
              </svg>
              Doctor Login
            </button>
            
            <button
              className="w-full bg-teal-600 hover:bg-teal-700 text-white px-8 py-4 rounded-lg font-medium transition-colors duration-200 flex items-center justify-center text-lg"
              onClick={() => setUserType("patient")}
            >
              <svg className="w-6 h-6 mr-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 11c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zM6 20v-1a4 4 0 014-4h4a4 4 0 014 4v1" />
              </svg>
              Patient Login
            </button>
            
            <button
              className="w-full bg-purple-600 hover:bg-purple-700 text-white px-8 py-4 rounded-lg font-medium transition-colors duration-200 flex items-center justify-center text-lg"
              onClick={() => setUserType("warehouse")}
            >
              <svg className="w-6 h-6 mr-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
              </svg>
             District Drug Warehouse Login
            </button>
          </div>
        </div>
        <ToastContainer />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center p-4">
      <div className="bg-white shadow-lg rounded-lg p-8 w-full max-w-md">
        {/* Header */}
        <div className="text-center mb-6">
          <div className="mx-auto w-12 h-12 bg-indigo-100 rounded-full flex items-center justify-center mb-3">
            {userType === "pharmacy" ? (
              <svg className="w-6 h-6 text-indigo-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-4m-5 0H3m2 0v-3.57a3 3 0 011.111-2.343zM11 19h2M7 7h.01M7 11h.01M11 7h.01M11 11h.01M15 7h.01M15 11h.01" />
              </svg>
            ) : userType === "cmo" ? (
              <svg className="w-6 h-6 text-indigo-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            ) : userType === "warehouse" ? (
              <svg className="w-6 h-6 text-indigo-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
              </svg>
            ) : (
              <svg className="w-6 h-6 text-indigo-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
              </svg>
            )}
          </div>
          <h2 className="text-xl font-semibold text-gray-800 mb-1">
            {isSignUp
              ? userType === "pharmacy"
                ? "Pharmacy Registration"
                : userType === "cmo"
                ? "CMO Registration"
                : userType === "doctor"
                ? "Doctor Registration"
                : userType === "patient"
                ? "Patient Registration"
                : userType === "warehouse"
                ? "Warehouse Registration"
                : "Registration"
              : userType === "pharmacy"
              ? "Pharmacy Login"
              : userType === "cmo"
              ? "CMO Login"
              : userType === "doctor"
              ? "Doctor Login"
              : userType === "patient"
              ? "Patient Login"
              : userType === "warehouse"
              ? "District Drug Warehouse Login"
              : "Login"}
          </h2>
          <p className="text-sm text-gray-600">
            {isSignUp ? "Create your account" : "Sign in to your account"}
          </p>
        </div>

        <form onSubmit={isSignUp ? handleSignUp : handleLogin} className="space-y-4">
          {isSignUp && userType === "pharmacy" && (
            <>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Pharmacy Name</label>
                <input 
                  type="text" 
                  placeholder="Enter pharmacy name" 
                  value={pharmacyName} 
                  onChange={(e) => setPharmacyName(e.target.value)} 
                  className="w-full border border-gray-300 px-3 py-2 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Contact Number</label>
                <input 
                  type="text" 
                  placeholder="Enter contact number" 
                  value={contactNumber} 
                  onChange={(e) => setContactNumber(e.target.value)} 
                  className="w-full border border-gray-300 px-3 py-2 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">District</label>
                  <input 
                    type="text" 
                    placeholder="District" 
                    value={district} 
                    onChange={(e) => setDistrict(e.target.value)} 
                    className="w-full border border-gray-300 px-3 py-2 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Block</label>
                  <input 
                    type="text" 
                    placeholder="Block" 
                    value={block} 
                    onChange={(e) => setBlock(e.target.value)} 
                    className="w-full border border-gray-300 px-3 py-2 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Address</label>
                <textarea 
                  placeholder="Enter full address" 
                  value={address} 
                  onChange={(e) => setAddress(e.target.value)} 
                  rows="2"
                  className="w-full border border-gray-300 px-3 py-2 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 resize-none"
                />
              </div>
            </>
          )}

          {isSignUp && userType === "patient" && (
            <>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Patient Name</label>
                <input
                  type="text"
                  placeholder="Enter patient name"
                  value={patientName}
                  onChange={(e) => setPatientName(e.target.value)}
                  className="w-full border border-gray-300 px-3 py-2 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Age</label>
                  <input
                    type="number"
                    placeholder="Age"
                    value={patientAge}
                    onChange={(e) => setPatientAge(e.target.value)}
                    className="w-full border border-gray-300 px-3 py-2 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Gender</label>
                  <select
                    value={patientGender}
                    onChange={(e) => setPatientGender(e.target.value)}
                    className="w-full border border-gray-300 px-3 py-2 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                  >
                    <option value="">Select</option>
                    <option value="Male">Male</option>
                    <option value="Female">Female</option>
                    <option value="Other">Other</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Password</label>
                <input
                  type="password"
                  placeholder="Set a password (or leave blank to use default 123)"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full border border-gray-300 px-3 py-2 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                />
              </div>
            </>
          )}

          {isSignUp && userType === "cmo" && (
            <>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Full Name</label>
                <input 
                  type="text" 
                  placeholder="Enter your name" 
                  value={name} 
                  onChange={(e) => setName(e.target.value)} 
                  className="w-full border border-gray-300 px-3 py-2 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Contact Number</label>
                <input 
                  type="text" 
                  placeholder="Enter contact number" 
                  value={contactNumber} 
                  onChange={(e) => setContactNumber(e.target.value)} 
                  className="w-full border border-gray-300 px-3 py-2 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">District</label>
                  <input 
                    type="text" 
                    placeholder="District" 
                    value={district} 
                    onChange={(e) => setDistrict(e.target.value)} 
                    className="w-full border border-gray-300 px-3 py-2 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Block</label>
                  <input 
                    type="text" 
                    placeholder="Block" 
                    value={block} 
                    onChange={(e) => setBlock(e.target.value)} 
                    className="w-full border border-gray-300 px-3 py-2 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Address</label>
                <textarea 
                  placeholder="Enter full address" 
                  value={address} 
                  onChange={(e) => setAddress(e.target.value)} 
                  rows="2"
                  className="w-full border border-gray-300 px-3 py-2 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 resize-none"
                />
              </div>
            </>
          )}

          {isSignUp && userType === "doctor" && (
            <>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Contact Number</label>
                <input 
                  type="text" 
                  placeholder="Enter contact number" 
                  value={contactNumber} 
                  onChange={(e) => setContactNumber(e.target.value)} 
                  className="w-full border border-gray-300 px-3 py-2 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                  required 
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">District</label>
                  <input 
                    type="text" 
                    placeholder="District" 
                    value={district} 
                    onChange={(e) => setDistrict(e.target.value)} 
                    className="w-full border border-gray-300 px-3 py-2 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                    required 
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Block</label>
                  <input 
                    type="text" 
                    placeholder="Block" 
                    value={block} 
                    onChange={(e) => setBlock(e.target.value)} 
                    className="w-full border border-gray-300 px-3 py-2 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                    required 
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Address</label>
                <textarea 
                  placeholder="Enter full address" 
                  value={address} 
                  onChange={(e) => setAddress(e.target.value)} 
                  rows="2"
                  className="w-full border border-gray-300 px-3 py-2 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 resize-none"
                  required 
                />
              </div>
            </>
          )}

          {isSignUp && userType === "warehouse" && (
            <>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Warehouse Name</label>
                <input 
                  type="text" 
                  placeholder="Enter warehouse name" 
                  value={warehouseName} 
                  onChange={(e) => setWarehouseName(e.target.value)} 
                  className="w-full border border-gray-300 px-3 py-2 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Contact Number</label>
                <input 
                  type="text" 
                  placeholder="Enter contact number" 
                  value={contactNumber} 
                  onChange={(e) => setContactNumber(e.target.value)} 
                  className="w-full border border-gray-300 px-3 py-2 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">District</label>
                  <input 
                    type="text" 
                    placeholder="District" 
                    value={district} 
                    onChange={(e) => setDistrict(e.target.value)} 
                    className="w-full border border-gray-300 px-3 py-2 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Block</label>
                  <input 
                    type="text" 
                    placeholder="Block" 
                    value={block} 
                    onChange={(e) => setBlock(e.target.value)} 
                    className="w-full border border-gray-300 px-3 py-2 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Address</label>
                <textarea 
                  placeholder="Enter full address" 
                  value={address} 
                  onChange={(e) => setAddress(e.target.value)} 
                  rows="2"
                  className="w-full border border-gray-300 px-3 py-2 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 resize-none"
                />
              </div>
            </>
          )}

          {!(isSignUp && userType === "patient") && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                {userType === "cmo" ? "Email Address" : userType === "warehouse" ? "Email Address" : userType === "patient" ? "OPD Number" : "Username"}
              </label>
              <input
                type="text"
                placeholder={
                  userType === "cmo"
                    ? "Enter your email"
                    : userType === "warehouse"
                    ? "Enter your email"
                    : userType === "patient"
                    ? "Enter OPD number (e.g. OPD001)"
                    : "Enter username"
                }
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="w-full border border-gray-300 px-3 py-2 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
              />
            </div>
          )}
          
          {!(isSignUp && userType === "patient") && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Password</label>
              <input
                type="password"
                placeholder="Enter your password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full border border-gray-300 px-3 py-2 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
              />
            </div>
          )}

          <button 
            type="submit" 
            className="w-full bg-indigo-600 hover:bg-indigo-700 text-white py-2.5 rounded-lg font-medium transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2"
          >
            {isSignUp ? "Create Account" : "Sign In"}
          </button>
        </form>

        {/* Footer */}
        <div className="mt-6 text-center">
          <p className="text-sm text-gray-600">
            {isSignUp ? "Already have an account?" : "Don't have an account?"}{" "}
            <button 
              className="text-indigo-600 hover:text-indigo-800 font-medium" 
              onClick={() => setIsSignUp(!isSignUp)}
            >
              {isSignUp ? "Sign In" : "Sign Up"}
            </button>
          </p>
          
          <button 
            className="mt-3 text-gray-500 hover:text-gray-700 text-sm" 
            onClick={() => setUserType("")}
          >
            ← Back to user selection
          </button>
        </div>
      </div>
      <ToastContainer />
    </div>
  );
}
