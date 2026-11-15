import { Link } from "react-router-dom";
import { MapPinOff } from "lucide-react";

const NotFound = () => (
  <div className="container-page flex flex-col items-center py-24 text-center animate-fade-in-up">
    <span className="rounded-full bg-primary-50 p-5 text-primary-600">
      <MapPinOff className="h-10 w-10" />
    </span>
    <h1 className="mt-6 text-4xl font-extrabold tracking-tight text-slate-900">Page not found</h1>
    <p className="mt-2 max-w-md text-slate-600">The page you're looking for doesn't exist or has moved.</p>
    <div className="mt-8 flex gap-3">
      <Link to="/" className="btn-primary">Go home</Link>
      <Link to="/search" className="btn-secondary">Browse hotels</Link>
    </div>
  </div>
);

export default NotFound;
