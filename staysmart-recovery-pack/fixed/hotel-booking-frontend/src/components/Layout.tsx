import { ReactNode, useEffect, useState } from "react";
import { ArrowUp } from "lucide-react";
import Header from "./Header";
import Footer from "./Footer";

const Layout = ({ children }: { children: ReactNode }) => {
  const [showTop, setShowTop] = useState(false);
  useEffect(() => {
    const onScroll = () => setShowTop(window.scrollY > 600);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <div className="flex min-h-screen flex-col">
      <Header />
      <main className="flex-1">{children}</main>
      <Footer />
      {showTop && (
        <button
          onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
          className="fixed bottom-6 right-6 z-40 rounded-full bg-primary-600 p-3 text-white shadow-large transition hover:bg-primary-700"
          aria-label="Back to top"
        >
          <ArrowUp className="h-5 w-5" />
        </button>
      )}
    </div>
  );
};

export default Layout;
