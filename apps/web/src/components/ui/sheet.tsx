"use client"

import * as React from "react"
import { cn } from "cn"
import { Dialog as SheetPrimitive } from "radix-ui"

import { Button } from "@/components/ui/button"
import { XIcon } from "lucide-react"

function Sheet({ ...props }: React.ComponentProps<typeof SheetPrimitive.Root>) {
  return <SheetPrimitive.Root data-slot="sheet" {...props} />
}

function SheetTrigger({
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Trigger>) {
  return <SheetPrimitive.Trigger data-slot="sheet-trigger" {...props} />
}

function SheetClose({
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Close>) {
  return <SheetPrimitive.Close data-slot="sheet-close" {...props} />
}

function SheetPortal({
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Portal>) {
  return <SheetPrimitive.Portal data-slot="sheet-portal" {...props} />
}

function SheetOverlay({
  className,
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Overlay>) {
  return (
    <SheetPrimitive.Overlay
      data-slot="sheet-overlay"
      className={cn(
        "fixed inset-0 z-50 bg-black/30 duration-300 supports-backdrop-filter:backdrop-blur-[3px] data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0",
        className
      )}
      {...props}
    />
  )
}

/** Larguras no desktop (no celular a gaveta lateral ocupa a tela toda) */
const SHEET_SIZES = {
  sm: "sm:w-[24rem]",
  md: "sm:w-[30rem]",
  lg: "sm:w-[36rem]",
  xl: "sm:w-[44rem]",
  "2xl": "sm:w-[56rem]",
} as const

function SheetContent({
  className,
  children,
  side = "right",
  size = "lg",
  showCloseButton = true,
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Content> & {
  side?: "top" | "right" | "bottom" | "left"
  size?: keyof typeof SHEET_SIZES
  showCloseButton?: boolean
}) {
  const lateral = side === "left" || side === "right"
  return (
    <SheetPortal>
      <SheetOverlay />
      <SheetPrimitive.Content
        data-slot="sheet-content"
        data-side={side}
        className={cn(
          "fixed z-50 flex flex-col gap-0 overflow-hidden bg-popover bg-clip-padding text-sm text-popover-foreground shadow-2xl outline-none",
          "data-open:animate-in data-closed:animate-out data-open:fade-in-0 data-closed:fade-out-0 data-open:duration-300 data-closed:duration-200 ease-[cubic-bezier(0.32,0.72,0,1)]",
          // Laterais: tela cheia no celular; no desktop flutuam com margem e cantos arredondados
          lateral && "inset-y-0 h-dvh w-full max-w-full sm:inset-y-2 sm:h-[calc(100dvh-1rem)] sm:max-w-[calc(100vw-1rem)] sm:rounded-2xl sm:border",
          lateral && SHEET_SIZES[size],
          side === "right" && "right-0 sm:right-2 data-open:slide-in-from-right-1/3 data-closed:slide-out-to-right-1/3",
          side === "left" && "left-0 sm:left-2 data-open:slide-in-from-left-1/3 data-closed:slide-out-to-left-1/3",
          side === "bottom" && "inset-x-0 bottom-0 h-auto max-h-[92dvh] rounded-t-3xl border-t pb-[env(safe-area-inset-bottom)] data-open:slide-in-from-bottom-1/4 data-closed:slide-out-to-bottom-1/4",
          side === "top" && "inset-x-0 top-0 h-auto border-b data-open:slide-in-from-top-10 data-closed:slide-out-to-top-10",
          className
        )}
        {...props}
      >
        {side === "bottom" && <div aria-hidden className="mx-auto mt-2.5 h-1.5 w-10 shrink-0 rounded-full bg-muted-foreground/25" />}
        {children}
        {showCloseButton && (
          <SheetPrimitive.Close data-slot="sheet-close" asChild>
            <Button variant="ghost" className="absolute top-3.5 right-3.5 z-20 rounded-full bg-popover/80 backdrop-blur transition hover:rotate-90" size="icon-sm">
              <XIcon />
              <span className="sr-only">Fechar</span>
            </Button>
          </SheetPrimitive.Close>
        )}
      </SheetPrimitive.Content>
    </SheetPortal>
  )
}

function SheetHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sheet-header"
      className={cn("sticky top-0 z-10 flex shrink-0 flex-col gap-1 border-b bg-popover/95 px-5 pt-5 pb-4 pr-14 backdrop-blur supports-[backdrop-filter]:bg-popover/80", className)}
      {...props}
    />
  )
}

function SheetFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sheet-footer"
      className={cn("sticky bottom-0 z-10 mt-auto flex shrink-0 flex-col gap-2 border-t bg-popover/95 px-5 py-3 backdrop-blur", className)}
      {...props}
    />
  )
}

function SheetTitle({
  className,
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Title>) {
  return (
    <SheetPrimitive.Title
      data-slot="sheet-title"
      className={cn(
        "font-heading text-base font-medium text-foreground",
        className
      )}
      {...props}
    />
  )
}

function SheetDescription({
  className,
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Description>) {
  return (
    <SheetPrimitive.Description
      data-slot="sheet-description"
      className={cn("text-sm text-muted-foreground", className)}
      {...props}
    />
  )
}

export {
  Sheet,
  SheetTrigger,
  SheetClose,
  SheetContent,
  SheetHeader,
  SheetFooter,
  SheetTitle,
  SheetDescription,
}
