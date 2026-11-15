import { useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useForm } from "react-hook-form";
import { Loader2, UserPlus } from "lucide-react";
import { useAppContext } from "../contexts/AppContext";
import { register as registerUser } from "../lib/api";
import { errorMessage } from "../lib/utils";
import { LogoMark } from "../components/Logo";
import { GoogleButton } from "./SignIn";

type FormValues = { firstName: string; lastName: string; email: string; password: string; confirmPassword: string };

const Register = () => {
  const { completeSignIn, showToast } = useAppContext();
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from || "/";
  const [submitError, setSubmitError] = useState("");
  const {
    register,
    watch,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>();

  const onSubmit = async ({ confirmPassword, ...values }: FormValues) => {
    setSubmitError("");
    try {
      const res = await registerUser(values);
      completeSignIn(res.token, res.user);
      showToast({ title: "Account created", description: `Welcome to StaySmart, ${res.user.firstName}!` });
      navigate(from, { replace: true });
    } catch (error) {
      setSubmitError(errorMessage(error, "Registration failed"));
    }
  };

  return (
    <div className="container-page flex justify-center py-12 sm:py-16">
      <div className="w-full max-w-lg animate-fade-in-up">
        <div className="mb-6 text-center">
          <LogoMark className="mx-auto h-12 w-12" />
          <h1 className="mt-4 text-3xl font-extrabold tracking-tight text-slate-900">Create your account</h1>
          <p className="mt-2 text-slate-600">Book stays faster and keep all your trips in one place.</p>
        </div>
        <div className="card p-6 sm:p-8">
          <GoogleButton />
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="firstName" className="label">First name</label>
                <input id="firstName" autoComplete="given-name" className="input" {...register("firstName", { required: "First name is required", maxLength: 60 })} />
                {errors.firstName && <p className="field-error">{errors.firstName.message}</p>}
              </div>
              <div>
                <label htmlFor="lastName" className="label">Last name</label>
                <input id="lastName" autoComplete="family-name" className="input" {...register("lastName", { required: "Last name is required", maxLength: 60 })} />
                {errors.lastName && <p className="field-error">{errors.lastName.message}</p>}
              </div>
            </div>
            <div>
              <label htmlFor="email" className="label">Email</label>
              <input id="email" type="email" autoComplete="email" className="input" {...register("email", { required: "Email is required", pattern: { value: /^\S+@\S+\.\S+$/, message: "Enter a valid email" } })} />
              {errors.email && <p className="field-error">{errors.email.message}</p>}
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="password" className="label">Password</label>
                <input id="password" type="password" autoComplete="new-password" className="input" {...register("password", { required: "Password is required", minLength: { value: 6, message: "At least 6 characters" } })} />
                {errors.password && <p className="field-error">{errors.password.message}</p>}
              </div>
              <div>
                <label htmlFor="confirmPassword" className="label">Confirm password</label>
                <input
                  id="confirmPassword"
                  type="password"
                  autoComplete="new-password"
                  className="input"
                  {...register("confirmPassword", { required: "Please confirm your password", validate: (v) => v === watch("password") || "Passwords do not match" })}
                />
                {errors.confirmPassword && <p className="field-error">{errors.confirmPassword.message}</p>}
              </div>
            </div>
            {submitError && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm font-medium text-red-700">{submitError}</p>}
            <button type="submit" className="btn-primary w-full py-3" disabled={isSubmitting}>
              {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />} Create account
            </button>
          </form>
          <p className="mt-6 text-center text-sm text-slate-600">
            Already have an account?{" "}
            <Link to="/sign-in" state={location.state} className="font-semibold text-primary-600 hover:text-primary-700">
              Sign in
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
};

export default Register;
