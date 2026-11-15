import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "react-query";
import "react-datepicker/dist/react-datepicker.css";
import "leaflet/dist/leaflet.css";
import "./index.css";
import App from "./App";
import { AppContextProvider } from "./contexts/AppContext";
import { SearchContextProvider } from "./contexts/SearchContext";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (failureCount, error: any) => failureCount < 1 && !(error?.status >= 400 && error?.status < 500),
      refetchOnWindowFocus: false,
      staleTime: 60 * 1000,
    },
  },
});

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AppContextProvider>
          <SearchContextProvider>
            <App />
          </SearchContextProvider>
        </AppContextProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>
);
