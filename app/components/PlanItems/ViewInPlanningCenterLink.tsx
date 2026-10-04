interface ViewInPlanningCenterLinkProps {
    /** A `pcoWebUrls` link. */
    href: string;
}

/**
 * The "View in Planning Center" button of the plan and item headers. It opens
 * Planning Center in a new tab. Full width on phones (the header stacks its
 * actions), sized to its text beside the title on wider screens.
 */
export default function ViewInPlanningCenterLink({
    href,
}: ViewInPlanningCenterLinkProps) {
    return (
        <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="px-4 py-2 bg-gray-500 text-white text-center rounded-lg hover:bg-gray-600 transition-colors whitespace-nowrap"
        >
            View in Planning Center
        </a>
    );
}
