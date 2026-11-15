import { lazy, ReactNode, Suspense, useEffect } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import Layout from "./components/Layout";
import { PageSpinner } from "./components/Spinner";
import { useAppContext } from "./contexts/AppContext";
import Home from "./pages/Home";

const Search = lazy(() => import("./pages/Search"));
const Detail = lazy(() => import("./pages/Detail"));
const Booking = lazy(() => import("./pages/Booking"));
const SignIn = lazy(() => import("./pages/SignIn"));
const Register = lazy(() => import("./pages/Register"));
const AuthCallback = lazy(() => import("./pages/AuthCallback"));
const MyBookings = lazy(() => import("./pages/MyBookings"));
const MyHotels = lazy(() => import("./pages/MyHotels"));
const AddHotel = lazy(() => import("./pages/AddHotel"));
const EditHotel = lazy(() => import("./pages/EditHotel"));
const BusinessInsights = lazy(() => import("./pages/BusinessInsights"));
const NearMe = lazy(() => import("./pages/NearMe"));
const ApiStatus = lazy(() => import("./pages/ApiStatus"));
const ApiDocs = lazy(() => import("./pages/ApiDocs"));
const NotFound = lazy(() => import("./pages/NotFound"));

const ScrollToTopOnNavigate = () => {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "instant" as ScrollBehavior });
  }, [pathname]);
  return null;
};

const RequireAuth = ({ children }: { children: ReactNode }) => {
  const { isLoggedIn, authChecked } = useAppContext();
  const location = useLocation();
  if (!isLoggedIn && !authChecked) return <PageSpinner label="Checking your session..." />;
  if (!isLoggedIn) {
    return <Navigate to="/sign-in" replace state={{ from: `${location.pathname}${location.search}` }} />;
  }
  return <>{children}</>;
};

const App = () => (
  <>
    <ScrollToTopOnNavigate />
    <Layout>
      <Suspense fallback={<PageSpinner />}>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/search" element={<Search />} />
          <Route path="/detail/:hotelId" element={<Detail />} />
          <Route path="/near-me" element={<NearMe />} />
          <Route path="/sign-in" element={<SignIn />} />
          <Route path="/register" element={<Register />} />
          <Route path="/auth/callback" element={<AuthCallback />} />
          <Route path="/api-status" element={<ApiStatus />} />
          <Route path="/api-reference" element={<ApiDocs />} />
          <Route path="/business-insights" element={<BusinessInsights />} />
          <Route path="/hotel/:hotelId/booking" element={<RequireAuth><Booking /></RequireAuth>} />
          <Route path="/my-bookings" element={<RequireAuth><MyBookings /></RequireAuth>} />
          <Route path="/my-hotels" element={<RequireAuth><MyHotels /></RequireAuth>} />
          <Route path="/add-hotel" element={<RequireAuth><AddHotel /></RequireAuth>} />
          <Route path="/edit-hotel/:hotelId" element={<RequireAuth><EditHotel /></RequireAuth>} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </Suspense>
    </Layout>
  </>
);

export default App;
