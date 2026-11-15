import { useState } from "react";
import { Link, NavLink, useNavigate } from "react-router-dom";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { BarChart3, Building2, CalendarCheck, ChevronDown, LogOut, MapPin, Menu, Plus, X } from "lucide-react";
import { useAppContext } from "../contexts/AppContext";
import { cn, initials } from "../lib/utils";
import Logo from "./Logo";

const navLinkClass = ({ isActive }: { isActive: boolean }) =>
  cn(
    "rounded-lg px-3 py-2 text-sm font-medium transition-colors",
    isActive ? "bg-primary-50 text-primary-700" : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
  );

const Header = () => {
  const { isLoggedIn, user, signOut, showToast } = useAppContext();
  const navigate = useNavigate();
  const [mobileOpen, setMobileOpen] = useState(false);

  const handleSignOut = async () => {
    await signOut();
    setMobileOpen(false);
    showToast({ title: "Signed out", description: "See you again soon!", type: "info" });
    navigate("/");
  };

  return (
    <header className="sticky top-0 z-50 border-b border-slate-200 bg-white/90 backdrop-blur">
      <div className="container-page flex h-16 items-center justify-between gap-4">
        <Logo />

        <nav className="hidden items-center gap-1 lg:flex" aria-label="Main">
          <NavLink to="/search" className={navLinkClass}>
            Hotels
          </NavLink>
          <NavLink to="/near-me" className={navLinkClass}>
            Near me
          </NavLink>
          {isLoggedIn && (
            <>
              <NavLink to="/my-bookings" className={navLinkClass}>
                My bookings
              </NavLink>
              <NavLink to="/my-hotels" className={navLinkClass}>
                My hotels
              </NavLink>
            </>
          )}
          <NavLink to="/business-insights" className={navLinkClass}>
            Insights
          </NavLink>
        </nav>

        <div className="hidden items-center gap-2 lg:flex">
          {isLoggedIn ? (
            <DropdownMenu.Root>
              <DropdownMenu.Trigger className="flex items-center gap-2 rounded-full border border-slate-200 py-1 pl-1 pr-3 hover:bg-slate-50">
                {user?.image ? (
                  <img src={user.image} alt="" className="h-8 w-8 rounded-full object-cover" referrerPolicy="no-referrer" />
                ) : (
                  <span className="flex h-8 w-8 items-center justify-center rounded-full bg-primary-600 text-xs font-bold text-white">
                    {initials(user?.firstName, user?.lastName)}
                  </span>
                )}
                <span className="max-w-[120px] truncate text-sm font-medium text-slate-700">{user?.firstName || "Account"}</span>
                <ChevronDown className="h-4 w-4 text-slate-400" />
              </DropdownMenu.Trigger>
              <DropdownMenu.Portal>
                <DropdownMenu.Content align="end" sideOffset={8} className="z-[60] w-56 rounded-xl border border-slate-200 bg-white p-1.5 shadow-large">
                  <div className="px-3 py-2">
                    <p className="truncate text-sm font-semibold text-slate-900">
                      {user?.firstName} {user?.lastName}
                    </p>
                    <p className="truncate text-xs text-slate-500">{user?.email}</p>
                  </div>
                  <DropdownMenu.Separator className="my-1 h-px bg-slate-100" />
                  {[
                    { to: "/my-bookings", label: "My bookings", icon: CalendarCheck },
                    { to: "/my-hotels", label: "My hotels", icon: Building2 },
                    { to: "/add-hotel", label: "List a property", icon: Plus },
                    { to: "/business-insights", label: "Business insights", icon: BarChart3 },
                  ].map(({ to, label, icon: Icon }) => (
                    <DropdownMenu.Item
                      key={to}
                      onSelect={() => navigate(to)}
                      className="flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-sm text-slate-700 outline-none data-[highlighted]:bg-slate-100"
                    >
                      <Icon className="h-4 w-4 text-slate-500" /> {label}
                    </DropdownMenu.Item>
                  ))}
                  <DropdownMenu.Separator className="my-1 h-px bg-slate-100" />
                  <DropdownMenu.Item
                    onSelect={handleSignOut}
                    className="flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-sm text-red-600 outline-none data-[highlighted]:bg-red-50"
                  >
                    <LogOut className="h-4 w-4" /> Sign out
                  </DropdownMenu.Item>
                </DropdownMenu.Content>
              </DropdownMenu.Portal>
            </DropdownMenu.Root>
          ) : (
            <>
              <Link to="/sign-in" className="btn-ghost">
                Sign in
              </Link>
              <Link to="/register" className="btn-primary">
                Create account
              </Link>
            </>
          )}
        </div>

        <button
          className="rounded-lg p-2 text-slate-600 hover:bg-slate-100 lg:hidden"
          onClick={() => setMobileOpen((v) => !v)}
          aria-label={mobileOpen ? "Close menu" : "Open menu"}
          aria-expanded={mobileOpen}
        >
          {mobileOpen ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
        </button>
      </div>

      {mobileOpen && (
        <div className="border-t border-slate-200 bg-white lg:hidden">
          <nav className="container-page flex flex-col gap-1 py-3" aria-label="Mobile">
            {[
              { to: "/search", label: "Hotels" },
              { to: "/near-me", label: "Hotels near me", icon: MapPin },
              ...(isLoggedIn
                ? [
                    { to: "/my-bookings", label: "My bookings" },
                    { to: "/my-hotels", label: "My hotels" },
                    { to: "/add-hotel", label: "List a property" },
                  ]
                : []),
              { to: "/business-insights", label: "Business insights" },
              { to: "/api-status", label: "API status" },
            ].map((item) => (
              <NavLink key={item.to} to={item.to} className={navLinkClass} onClick={() => setMobileOpen(false)}>
                {item.label}
              </NavLink>
            ))}
            <div className="mt-2 flex gap-2 border-t border-slate-100 pt-3">
              {isLoggedIn ? (
                <button className="btn-secondary w-full" onClick={handleSignOut}>
                  <LogOut className="h-4 w-4" /> Sign out
                </button>
              ) : (
                <>
                  <Link to="/sign-in" className="btn-secondary flex-1" onClick={() => setMobileOpen(false)}>
                    Sign in
                  </Link>
                  <Link to="/register" className="btn-primary flex-1" onClick={() => setMobileOpen(false)}>
                    Create account
                  </Link>
                </>
              )}
            </div>
          </nav>
        </div>
      )}
    </header>
  );
};

export default Header;
