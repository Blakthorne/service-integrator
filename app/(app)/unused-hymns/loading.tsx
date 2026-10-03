import LoadingState from "@/app/components/ui/LoadingState";

/** Shown while the server loads the unused hymns from Planning Center. */
export default function Loading() {
    return <LoadingState label="Loading unused hymns…" />;
}
