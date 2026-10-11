import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import { AuthProvider } from "./context/AuthContext";
import ConfigErrorPage from "./pages/ConfigErrorPage";
import { API_CONFIG_MISSING } from "./api/client";
import "./index.css";
ReactDOM.createRoot(document.getElementById("root")).render(<React.StrictMode>
    {API_CONFIG_MISSING ? (<ConfigErrorPage />) : (<BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <AuthProvider>
          <App />
        </AuthProvider>
      </BrowserRouter>)}
  </React.StrictMode>);
