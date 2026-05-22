"use client";

import * as React from "react";
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { cn } from "@/lib/utils";

function Drawer({ ...props }: DialogPrimitive.Root.Props) {
  return <DialogPrimitive.Root data-slot="drawer" {...props} />;
}

function DrawerTrigger({ ...props }: DialogPrimitive.Trigger.Props) {
  return <DialogPrimitive.Trigger data-slot="drawer-trigger" {...props} />;
}

function DrawerPortal({ ...props }: DialogPrimitive.Portal.Props) {
  return <DialogPrimitive.Portal data-slot="drawer-portal" {...props} />;
}

function DrawerClose({ ...props }: DialogPrimitive.Close.Props) {
  return <DialogPrimitive.Close data-slot="drawer-close" {...props} />;
}

function DrawerOverlay({
  className,
  ...props
}: DialogPrimitive.Backdrop.Props) {
  return (
    <DialogPrimitive.Backdrop
      className={cn(
        "fixed inset-0 z-50 bg-black/80",
        "data-[starting-style]:opacity-0 data-[ending-style]:opacity-0 data-[open]:opacity-100",
        "transition-opacity duration-200",
        className
      )}
      {...props}
    />
  );
}

interface DrawerContentProps extends DialogPrimitive.Popup.Props {
  side?: "left" | "right";
}

const DrawerContent = React.forwardRef<HTMLDivElement, DrawerContentProps>(
  ({ side = "right", className, children, ...props }, ref) => {
    return (
      <DrawerPortal>
        <DrawerOverlay />
        <DialogPrimitive.Popup
          ref={ref}
          className={cn(
            "fixed z-50 bg-background shadow-lg",
            "data-[starting-style]:opacity-0 data-[ending-style]:opacity-0 data-[open]:opacity-100",
            "transition-all duration-300 ease-in-out",
            side === "right" && [
              "inset-y-0 right-0 h-full w-3/4 border-l sm:max-w-xl",
              "data-[starting-style]:translate-x-full data-[ending-style]:translate-x-full data-[open]:translate-x-0",
            ],
            side === "left" && [
              "inset-y-0 left-0 h-full w-3/4 border-r sm:max-w-xl",
              "data-[starting-style]:-translate-x-full data-[ending-style]:-translate-x-full data-[open]:translate-x-0",
            ],
            "flex flex-col p-6",
            className
          )}
          {...props}
        >
          {children}
        </DialogPrimitive.Popup>
      </DrawerPortal>
    );
  }
);
DrawerContent.displayName = "DrawerContent";

const DrawerHeader = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn("flex flex-col space-y-2", className)}
    {...props}
  />
);
DrawerHeader.displayName = "DrawerHeader";

const DrawerFooter = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn("flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2 mt-auto", className)}
    {...props}
  />
);
DrawerFooter.displayName = "DrawerFooter";

const DrawerTitle = React.forwardRef<
  HTMLHeadingElement,
  React.HTMLAttributes<HTMLHeadingElement>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    className={cn("text-lg font-semibold text-foreground", className)}
    {...props}
  />
));
DrawerTitle.displayName = "DrawerTitle";

const DrawerDescription = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLParagraphElement>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description
    ref={ref}
    className={cn("text-sm text-muted-foreground", className)}
    {...props}
  />
));
DrawerDescription.displayName = "DrawerDescription";

export {
  Drawer,
  DrawerPortal,
  DrawerOverlay,
  DrawerTrigger,
  DrawerClose,
  DrawerContent,
  DrawerHeader,
  DrawerFooter,
  DrawerTitle,
  DrawerDescription,
};
