// Moved to @/components/dashboard/ChartCanvas so the analytics shell and the
// legacy Sales / Marketing dashboards share one chart primitive. This shim
// keeps the old import path working.
export { default, PALETTE, fillRgba, Gauge } from "@/components/dashboard/ChartCanvas";
