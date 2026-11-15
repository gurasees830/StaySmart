import { Link } from "react-router-dom";
import Logo from "./Logo";

const Footer = () => (
  <footer className="mt-16 bg-slate-900 text-slate-300">
    <div className="container-page grid gap-10 py-12 sm:grid-cols-2 lg:grid-cols-4">
      <div>
        <Logo light />
        <p className="mt-4 text-sm leading-relaxed text-slate-400">
          Find and book real hotels across every state and union territory of India.
        </p>
      </div>
      <div>
        <h3 className="text-sm font-semibold uppercase tracking-wider text-white">Explore</h3>
        <ul className="mt-4 space-y-2 text-sm">
          <li><Link to="/search" className="hover:text-white">All hotels</Link></li>
          <li><Link to="/near-me" className="hover:text-white">Hotels near me</Link></li>
          <li><Link to="/search?destination=Goa" className="hover:text-white">Goa</Link></li>
          <li><Link to="/search?destination=Jaipur" className="hover:text-white">Jaipur</Link></li>
          <li><Link to="/search?destination=Munnar" className="hover:text-white">Munnar</Link></li>
        </ul>
      </div>
      <div>
        <h3 className="text-sm font-semibold uppercase tracking-wider text-white">For hosts</h3>
        <ul className="mt-4 space-y-2 text-sm">
          <li><Link to="/add-hotel" className="hover:text-white">List your property</Link></li>
          <li><Link to="/my-hotels" className="hover:text-white">Manage hotels</Link></li>
          <li><Link to="/business-insights" className="hover:text-white">Business insights</Link></li>
          <li><Link to="/api-status" className="hover:text-white">API status</Link></li>
          <li><Link to="/api-reference" className="hover:text-white">API documentation</Link></li>
        </ul>
      </div>
      <div>
        <h3 className="text-sm font-semibold uppercase tracking-wider text-white">About the data</h3>
        <p className="mt-4 text-sm leading-relaxed text-slate-400">
          Hotel listings come from{" "}
          <a className="underline hover:text-white" href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">
            OpenStreetMap
          </a>{" "}
          contributors (ODbL). Photos are credited to their authors on each hotel page. Prices marked “est.” are estimates
          — confirm the tariff with the property.
        </p>
      </div>
    </div>
    <div className="border-t border-slate-800">
      <div className="container-page flex flex-col items-center justify-between gap-2 py-5 text-xs text-slate-500 sm:flex-row">
        <p>© {new Date().getFullYear()} StaySmart. All rights reserved.</p>
        <p>Made in India · Prices in INR</p>
      </div>
    </div>
  </footer>
);

export default Footer;
