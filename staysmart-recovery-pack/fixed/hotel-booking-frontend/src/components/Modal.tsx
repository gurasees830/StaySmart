import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { ReactNode } from "react";
import { cn } from "../lib/utils";

type ModalProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  size?: "sm" | "md" | "lg" | "xl";
};

const Modal = ({ open, onOpenChange, title, description, children, footer, size = "md" }: ModalProps) => (
  <Dialog.Root open={open} onOpenChange={onOpenChange}>
    <Dialog.Portal>
      <Dialog.Overlay className="fixed inset-0 z-[70] bg-slate-900/50 backdrop-blur-sm animate-fade-in" />
      <Dialog.Content
        className={cn(
          "fixed left-1/2 top-1/2 z-[80] flex max-h-[90vh] w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 flex-col rounded-2xl bg-white shadow-large focus:outline-none",
          size === "sm" && "max-w-md",
          size === "md" && "max-w-lg",
          size === "lg" && "max-w-3xl",
          size === "xl" && "max-w-5xl"
        )}
      >
        <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-6 py-4">
          <div>
            <Dialog.Title className="text-lg font-semibold text-slate-900">{title}</Dialog.Title>
            {description ? (
              <Dialog.Description className="mt-0.5 text-sm text-slate-600">{description}</Dialog.Description>
            ) : (
              <Dialog.Description className="sr-only">{title}</Dialog.Description>
            )}
          </div>
          <Dialog.Close className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600" aria-label="Close">
            <X className="h-5 w-5" />
          </Dialog.Close>
        </div>
        <div className="overflow-y-auto px-6 py-5">{children}</div>
        {footer && <div className="flex justify-end gap-3 border-t border-slate-200 px-6 py-4">{footer}</div>}
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>
);

export default Modal;
