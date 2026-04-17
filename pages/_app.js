import "@/styles/globals.css";
import { useRouter } from "next/router";
import { useState, useEffect } from "react";
require("dotenv").config();

// ── Global fetch interceptor: auto-attach JWT + API base URL to all /api/ calls ──
// NEXT_PUBLIC_API_URL is empty in dev (relative URLs work) and set to the
// Railway deployment URL in production mobile builds.
if (typeof window !== 'undefined') {
  const _originalFetch = window.fetch;
  const API_BASE = process.env.NEXT_PUBLIC_API_URL || '';
  window.fetch = function (url, options = {}) {
    if (typeof url === 'string' && url.startsWith('/api/')) {
      const token = localStorage.getItem('token');
      if (token) options.headers = { ...options.headers, Authorization: token };
      if (API_BASE) url = API_BASE + url;
    }
    return _originalFetch(url, options);
  };
}

export default function App({ Component, pageProps }) {
  const router = useRouter();
  const logout = () => {
    localStorage.removeItem("token");
    router.push("/");
  };

  return <Component {...pageProps} logout={logout} />;
}
