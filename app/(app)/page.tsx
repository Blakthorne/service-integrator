import { redirect } from "next/navigation";
import { routes } from "@/lib/routes";

/**
 * "/" sends visitors to the plans list with a temporary (307) redirect, which
 * keeps it free for a future dashboard.
 */
export default function Home() {
    redirect(routes.plans());
}
