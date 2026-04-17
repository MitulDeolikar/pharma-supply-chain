import { useRouter } from "next/router";
import { useEffect, useState } from "react";
import { ToastContainer, toast } from "react-toastify";
import "react-toastify/dist/ReactToastify.css";

const SalesAnalytics = ({ logout }) => {
  const router = useRouter();
  const { pharmacy_id } = router.query;
  const [salesData, setSalesData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('overview');
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear());
  const [selectedMonth, setSelectedMonth] = useState(new Date().getMonth() + 1);

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
    
    if (pharmacy_id) {
      fetchSalesAnalytics();
    }
  }, [pharmacy_id]);

  const fetchSalesAnalytics = async () => {
    try {
      setLoading(true);
      const response = await fetch(`/api/fetchSalesAnalytics?pharmacy_id=${pharmacy_id}`);
      const result = await response.json();

      if (result.success) {
        setSalesData(result.data);
      } else {
        toast.error("Failed to fetch sales analytics");
      }
    } catch (error) {
      console.error("Error fetching sales analytics:", error);
      toast.error("Error fetching sales analytics");
    } finally {
      setLoading(false);
    }
  };

  if (!pharmacy_id) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-gray-800 mb-4">Loading...</h1>
          <p className="text-gray-600">Please wait while we load your pharmacy information.</p>
        </div>
      </div>
    );
  }

  const formatDate = (dateStr) => {
    return new Date(dateStr).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
  };

  const formatNumber = (num) => {
    return new Intl.NumberFormat('en-IN').format(num);
  };

  const getMonthlyData = (year, month = null) => {
    if (!salesData?.monthlySales) return [];
    
    return salesData.monthlySales.filter(item => {
      const matchesYear = item.year === year;
      const matchesMonth = month ? item.month === month : true;
      return matchesYear && matchesMonth;
    });
  };

  const getYearlyData = (year) => {
    if (!salesData?.yearlySales) return [];
    return salesData.yearlySales.filter(item => item.year === year);
  };

  const renderOverviewTab = () => (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
      {/* Sales Summary Cards */}
      <div className="bg-white p-6 rounded-lg shadow-md">
        <h3 className="text-lg font-semibold text-gray-800 mb-4">Total Sales by Type</h3>
        {salesData?.salesByType?.map((item, index) => (
          <div key={index} className="flex justify-between items-center mb-3">
            <span className={`px-3 py-1 rounded-full text-sm font-medium ${
              item.sale_type === 'customer' 
                ? 'bg-green-100 text-green-800' 
                : 'bg-blue-100 text-blue-800'
            }`}>
              {item.sale_type === 'customer' ? 'Customer Sales' : 'Emergency Orders'}
            </span>
            <div className="text-right">
              <div className="text-sm text-gray-600">{item.transaction_count} transactions</div>
              <div className="font-semibold">{formatNumber(item.total_quantity_sold)} units</div>
            </div>
          </div>
        ))}
      </div>

      {/* Top Medicines */}
      <div className="bg-white p-6 rounded-lg shadow-md">
        <h3 className="text-lg font-semibold text-gray-800 mb-4">Top Selling Medicines</h3>
        <div className="space-y-3">
          {salesData?.topMedicines?.slice(0, 5).map((medicine, index) => (
            <div key={index} className="flex justify-between items-center">
              <div>
                <div className="font-medium text-sm">{medicine.medicine_name}</div>
                <div className="text-xs text-gray-500">{medicine.dosage} {medicine.unit}</div>
              </div>
              <div className="text-right">
                <div className="font-semibold text-sm">{formatNumber(medicine.total_quantity_sold)}</div>
                <div className="text-xs text-gray-500">{medicine.total_transactions} orders</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Recent Activity */}
      <div className="bg-white p-6 rounded-lg shadow-md">
        <h3 className="text-lg font-semibold text-gray-800 mb-4">Recent Transactions</h3>
        <div className="space-y-3 max-h-80 overflow-y-auto">
          {salesData?.recentTransactions?.slice(0, 10).map((transaction, index) => (
            <div key={index} className="flex justify-between items-center py-2 border-b border-gray-100">
              <div>
                <div className="font-medium text-sm">{transaction.medicine_name}</div>
                <div className="text-xs text-gray-500">{transaction.pharmacy_name}</div>
              </div>
              <div className="text-right">
                <div className="text-sm">{transaction.quantity_sold} units</div>
                <div className={`text-xs px-2 py-1 rounded ${
                  transaction.sale_type === 'customer' 
                    ? 'bg-green-100 text-green-800' 
                    : 'bg-blue-100 text-blue-800'
                }`}>
                  {transaction.sale_type}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );

  const renderTransactionsTab = () => (
    <div className="bg-white rounded-lg shadow-md overflow-hidden">
      <div className="p-6 border-b border-gray-200">
        <h3 className="text-lg font-semibold text-gray-800">All Transactions</h3>
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-full">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Date</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Pharmacy</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Medicine</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Quantity</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Type</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {salesData?.allTransactions?.map((transaction, index) => (
              <tr key={index} className="hover:bg-gray-50">
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                  {formatDate(transaction.transaction_date)}
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <div className="text-sm font-medium text-gray-900">{transaction.pharmacy_name}</div>
                  <div className="text-sm text-gray-500">ID: {transaction.pharmacy_id}</div>
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <div className="text-sm font-medium text-gray-900">{transaction.medicine_name}</div>
                  <div className="text-sm text-gray-500">{transaction.dosage} {transaction.unit} - {transaction.manufacturer}</div>
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                  {formatNumber(transaction.quantity_sold)} {transaction.unit}
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <span className={`px-2 py-1 text-xs font-semibold rounded-full ${
                    transaction.sale_type === 'customer' 
                      ? 'bg-green-100 text-green-800' 
                      : 'bg-blue-100 text-blue-800'
                  }`}>
                    {transaction.sale_type === 'customer' ? 'Customer' : 'Emergency'}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );

  const renderAnalyticsTab = () => (
    <div className="space-y-6">
      {/* Year and Month Selectors */}
      <div className="bg-white p-6 rounded-lg shadow-md">
        <div className="flex space-x-4 mb-6">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Year</label>
            <select
              value={selectedYear}
              onChange={(e) => setSelectedYear(parseInt(e.target.value))}
              className="px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-indigo-500"
            >
              {Array.from({length: 5}, (_, i) => new Date().getFullYear() - i).map(year => (
                <option key={year} value={year}>{year}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Month</label>
            <select
              value={selectedMonth}
              onChange={(e) => setSelectedMonth(parseInt(e.target.value))}
              className="px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-indigo-500"
            >
              <option value="">All Months</option>
              {Array.from({length: 12}, (_, i) => i + 1).map(month => (
                <option key={month} value={month}>
                  {new Date(2025, month - 1).toLocaleDateString('en-US', { month: 'long' })}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Monthly Analytics */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <h4 className="text-md font-semibold text-gray-800 mb-3">Monthly Sales ({selectedYear})</h4>
            <div className="space-y-2">
              {getMonthlyData(selectedYear, selectedMonth).length > 0 ? (
                getMonthlyData(selectedYear, selectedMonth).map((item, index) => (
                  <div key={index} className="flex justify-between items-center p-3 bg-gray-50 rounded">
                    <div>
                      <span className="font-medium">{item.month_name}</span>
                      <span className={`ml-2 px-2 py-1 text-xs rounded ${
                        item.sale_type === 'customer' 
                          ? 'bg-green-100 text-green-800' 
                          : 'bg-blue-100 text-blue-800'
                      }`}>
                        {item.sale_type}
                      </span>
                    </div>
                    <div className="text-right">
                      <div className="font-semibold">{formatNumber(item.total_quantity_sold)} units</div>
                      <div className="text-sm text-gray-600">{item.transaction_count} transactions</div>
                    </div>
                  </div>
                ))
              ) : (
                <div className="text-gray-500 text-center py-4">No data available for selected period</div>
              )}
            </div>
          </div>

          <div>
            <h4 className="text-md font-semibold text-gray-800 mb-3">Yearly Summary</h4>
            <div className="space-y-2">
              {getYearlyData(selectedYear).map((item, index) => (
                <div key={index} className="flex justify-between items-center p-3 bg-gray-50 rounded">
                  <span className={`px-3 py-1 text-sm font-medium rounded-full ${
                    item.sale_type === 'customer' 
                      ? 'bg-green-100 text-green-800' 
                      : 'bg-blue-100 text-blue-800'
                  }`}>
                    {item.sale_type === 'customer' ? 'Customer Sales' : 'Emergency Orders'}
                  </span>
                  <div className="text-right">
                    <div className="font-semibold">{formatNumber(item.total_quantity_sold)} units</div>
                    <div className="text-sm text-gray-600">{item.transaction_count} transactions</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );

  const renderMedicinesTab = () => (
    <div className="bg-white rounded-lg shadow-md overflow-hidden">
      <div className="p-6 border-b border-gray-200">
        <h3 className="text-lg font-semibold text-gray-800">Medicine-wise Sales Analysis</h3>
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-full">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Medicine</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Manufacturer</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Sale Type</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Transactions</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Total Quantity</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {salesData?.medicineWiseSales?.map((medicine, index) => (
              <tr key={index} className="hover:bg-gray-50">
                <td className="px-6 py-4 whitespace-nowrap">
                  <div className="text-sm font-medium text-gray-900">{medicine.medicine_name}</div>
                  <div className="text-sm text-gray-500">{medicine.dosage} {medicine.unit}</div>
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                  {medicine.manufacturer}
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <span className={`px-2 py-1 text-xs font-semibold rounded-full ${
                    medicine.sale_type === 'customer' 
                      ? 'bg-green-100 text-green-800' 
                      : 'bg-blue-100 text-blue-800'
                  }`}>
                    {medicine.sale_type === 'customer' ? 'Customer' : 'Emergency'}
                  </span>
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                  {formatNumber(medicine.transaction_count)}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                  {formatNumber(medicine.total_quantity_sold)} {medicine.unit}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );

  if (loading) {
    return (
      <div className="flex bg-gray-50 min-h-screen">
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-indigo-600"></div>
            <p className="mt-4 text-gray-600">Loading sales analytics...</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex bg-gray-50 min-h-screen">
      <ToastContainer position="top-center" autoClose={1500} />

      {/* Sidebar */}
      <aside className="flex flex-col w-64 bg-indigo-700 text-white shadow-lg">
        <div className="px-6 py-6 border-b border-indigo-600">
          <h2 className="text-lg font-semibold">Sales Analytics</h2>
        </div>

        <nav className="flex-1 px-4 py-6 space-y-2">
          <button
            onClick={() => router.push(`/user?pharmacy_id=${pharmacy_id}`)}
            className="flex items-center gap-3 w-full px-3 py-2 text-left rounded-lg hover:bg-indigo-600 transition"
          >
            <svg className="w-5 h-5 text-indigo-200" viewBox="0 0 24 24" fill="none">
              <path d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1-1H8a1 1 0 00-1 1H3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            <span className="font-medium">Back to Dashboard</span>
          </button>
        </nav>
      </aside>

      {/* Main Content */}
      <main className="flex-1 p-8">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">
            Sales Analytics Dashboard
            {salesData?.pharmacyInfo && (
              <span className="text-xl text-blue-600 block mt-1">
                {salesData.pharmacyInfo.pharmacy_name}
              </span>
            )}
          </h1>
          <p className="text-gray-600">
            Comprehensive analysis of pharmacy sales and transactions
            {salesData?.pharmacyInfo && (
              <span className="block text-sm mt-1">
                Pharmacy ID: {salesData.pharmacyInfo.pharmacy_id}
              </span>
            )}
          </p>
        </div>

        {/* Tab Navigation */}
        <div className="mb-8">
          <div className="border-b border-gray-200">
            <nav className="-mb-px flex space-x-8">
              {[
                { id: 'overview', label: 'Overview', icon: '📊' },
                { id: 'transactions', label: 'All Transactions', icon: '📋' },
                { id: 'analytics', label: 'Time Analytics', icon: '📈' },
                { id: 'medicines', label: 'Medicine Analysis', icon: '💊' }
              ].map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`py-2 px-1 border-b-2 font-medium text-sm ${
                    activeTab === tab.id
                      ? 'border-indigo-500 text-indigo-600'
                      : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                  }`}
                >
                  <span className="mr-2">{tab.icon}</span>
                  {tab.label}
                </button>
              ))}
            </nav>
          </div>
        </div>

        {/* Tab Content */}
        <div>
          {activeTab === 'overview' && renderOverviewTab()}
          {activeTab === 'transactions' && renderTransactionsTab()}
          {activeTab === 'analytics' && renderAnalyticsTab()}
          {activeTab === 'medicines' && renderMedicinesTab()}
        </div>
      </main>
    </div>
  );
};

export default SalesAnalytics;