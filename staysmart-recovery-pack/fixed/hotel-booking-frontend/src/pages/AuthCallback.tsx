import { useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useAppContext } from "../contexts/AppContext";
import { PageSpinner } from "../components/Spinner";

/** Google OAuth lands here with the session token in the query string. */
const AuthCallback = () => {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { completeSignIn, showToast } = useAppContext();

  useEffect(() => {
    const token = params.get("token");
    const userId = params.get("userId");
    if (!token || !userId) {
      navigate("/sign-in?error=server_error", { replace: true });
      return;
    }
    completeSignIn(token, {
      _id: userId,
      email: params.get("email") || "",
      firstName: params.get("firstName") || "",
      lastName: params.get("lastName") || "",
      image: params.get("image") || undefined,
    });
    showToast({ title: `Welcome, ${params.get("firstName") || "traveller"}!` });
    // Remove the token from the address bar / history.
    navigate("/", { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <PageSpinner label="Completing sign-in..." />;
};

export default AuthCallback;
