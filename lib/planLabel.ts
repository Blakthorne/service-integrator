import type { Plan, ServiceType } from "./domain";

/**
 * A plan's label, "<dates> · <service type>", e.g. "October 4, 2026 · Sunday
 * Morning": the plan page's title, its breadcrumb on the item pages, and the
 * browser tab's title (through getPlanLabels). Pure and client-safe, so server
 * code and client components can share it.
 */
export function planLabel(
    plan: Pick<Plan, "dates">,
    serviceType: Pick<ServiceType, "name">
): string {
    return `${plan.dates} · ${serviceType.name}`;
}
