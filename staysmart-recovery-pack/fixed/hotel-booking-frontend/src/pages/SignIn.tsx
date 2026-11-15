import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { useForm } from "react-hook-form";
import { Eye, EyeOff, Loader2, LogIn } from "lucide-react";
import { useAppContext } from "../contexts/AppContext";
import { googleSignInUrl, signIn } from "../lib/api";
import { errorMessage } from "../lib/utils";
import { LogoMark } from "../components/Logo";

type FormValues = { email: string; password: string };

const OAUTH_ERRORS: Record<string, string> = {
  oauth_config: "Google sign-in is not configured on this server.",
  oauth_state: "Google sign-in expired. Please try again.",
  token_exchange: "Google sign-in failed. Please try again.",
  server_error: "Could not complete Google sign-in.",
  access_denied: "Google sign-in was cancelled.",
};

export const GoogleButton = () => {
  const { config } = useAppContext();
  if (!config?.auth.google) return null;
  return (
    <>
      <a href={googleSignInUrl()} className="btn-secondary w-full py-3">
        <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden>
          <path fill="#EA4335" d="M12 10.2v3.9h5.5c-.2 1.3-1.6 3.8-5.5 3.8-3.3 0-6-2.7-6-6.1s2.7-6.1 6-6.1c1.9 0 3.1.8 3.8 1.5l2.6-2.5C16.7 3.1 14.6 2 12 2 6.5 2 2 6.5 2 12s4.5 10 10 10c5.8 0 9.6-4 9.6-9.8 0-.7-.1-1.2-.2-1.7H12z" />
        </svg>
        Continue with Google
      </a>
      <div className="relative my-6 text-center text-xs uppercase tracking-wider text-slate-400">
        <span className="relative z-10 bg-white px-3">or</span>
        <span className="absolute inset-x-0 top-1/2 h-px bg-slate-200" />
      </div>
    </>
  );
};

const SignIn = () => {
  const { completeSignIn, showToast, isLoggedIn } = useAppContext();
  const navigate = useNavigate();
  const location = useLocation();
  const [params] = useSearchParams();
  const [showPassword, setShowPassword] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const from = (location.state as { from?: string; reason?: string } | null)?.from || "/";
  const reason = (location.state as { reason?: string } | null)?.reason;
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>();

  useEffect(() => {
    const err = params.get("error");
    if (err) setSubmitError(OAUTH_ERRORS[err] || "Sign-in failed. Please try again.");
  }, [params]);

  useEffect(() => {
    if (isLoggedIn) navigate(from, { replace: true });
  }, [isLoggedIn, from, navigate]);

  const onSubmit = async (values: FormValues) => {
    setSubmitError("");
    try {
      const res = await signIn(values);
      completeSignIn(res.token, res.user);
      showToast({ title: `Welcome back, ${res.user.firstName}!` });
      navigate(from, { replace: true });
    } catch (error) {
      setSubmitError(errorMessage(error, "Sign-in failed"));
    }
  };

  return (
    <div className="container-page flex justify-center py-12 sm:py-16">
      <div className="w-full max-w-md animate-fade-in-up">
        <div className="mb-6 text-center">
          <LogoMark className="mx-auto h-12 w-12" />
          <h1 className="mt-4 text-3xl font-extrabold tracking-tight text-slate-900">Welcome back</h1>
          <p className="mt-2 text-slate-600">{reason === "booking" ? "Sign in to complete your booking." : "Sign in to manage your bookings and properties."}</p>
        </div>
        <div className="card p-6 sm:p-8">
          <GoogleButton />
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
            <div>
              <label htmlFor="email" className="label">
                Email
              </label>
              <input
                id="email"
                type="email"
                autoComplete="email"
                className="input"
                placeholder="you@example.com"
                {...register("email", { required: "Email is required", pattern: { value: /^\S+@\S+\.\S+$/, message: "Enter a valid email" } })}
              />
              {errors.email && <p className="field-error">{errors.email.message}</p>}
            </div>
            <div>
              <label htmlFor="password" className="label">
                Password
              </label>
              <div className="relative">
                <input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  autoComplete="current-password"
                  className="input pr-10"
                  placeholder="At least 6 characters"
                  {...register("password", { required: "Password is required", minLength: { value: 6, message: "Password must be at least 6 characters" } })}
                />
                <button type="button" onClick={() => setShowPassword((v) => !v)} className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-600" aria-label={showPassword ? "Hide password" : "Show password"}>
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              {errors.password && <p className="field-error">{errors.password.message}</p>}
            </div>
            {submitError && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm font-medium text-red-700">{submitError}</p>}
            <button type="submit" className="btn-primary w-full py-3" disabled={isSubmitting}>
              {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogIn className="h-4 w-4" />} Sign in
            </button>
          </form>
          <p className="mt-6 text-center text-sm text-slate-600">
            New to StaySmart?{" "}
            <Link to="/register" state={location.state} className="font-semibold text-primary-600 hover:text-primary-700">
              Create an account
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
};

export default SignIn;
