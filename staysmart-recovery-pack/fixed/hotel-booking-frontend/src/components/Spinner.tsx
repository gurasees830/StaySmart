import { Loader2 } from "lucide-react";
import { cn } from "../lib/utils";

export const Spinner = ({ className }: { className?: string }) => (
  <Loader2 className={cn("h-5 w-5 animate-spin text-primary-600", className)} aria-hidden />
);

export const PageSpinner = ({ label = "Loading..." }: { label?: string }) => (
  <div className="flex min-h-[50vh] flex-col items-center justify-center gap-3 text-slate-500" role="status">
    <Spinner className="h-8 w-8" />
    <p className="text-sm">{label}</p>
  </div>
);

export const EmptyState = ({
  icon,
  title,
  description,
  action,
}: {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  action?: React.ReactNode;
}) => (
  <div className="card flex flex-col items-center px-6 py-14 text-center">
    {icon && <div className="mb-4 rounded-full bg-primary-50 p-4 text-primary-600">{icon}</div>}
    <h3 className="text-lg font-semibold text-slate-900">{title}</h3>
    {description && <p className="mt-1 max-w-md text-sm text-slate-600">{description}</p>}
    {action && <div className="mt-6">{action}</div>}
  </div>
);

export const ErrorState = ({ message, onRetry }: { message: string; onRetry?: () => void }) => (
  <div className="card border-red-200 bg-red-50 px-6 py-8 text-center">
    <p className="font-semibold text-red-700">{message}</p>
    {onRetry && (
      <button className="btn-secondary mt-4" onClick={onRetry}>
        Try again
      </button>
    )}
  </div>
);
