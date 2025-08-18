export default function CopyButton({
    text,
    showTooltip,
    setShowTooltip,
}: {
    text: string;
    showTooltip: boolean;
    setShowTooltip: (show: boolean) => void;
}) {
    // Helper function for copying text to clipboard
    const copyToClipboard = async (
        text: string,
        setShowCopyTooltip: (show: boolean) => void
    ): Promise<void> => {
        try {
            if (navigator.clipboard && window.isSecureContext) {
                // Modern API for secure contexts
                await navigator.clipboard.writeText(text);
            } else {
                // Fallback for older browsers or non-secure contexts
                const textArea = document.createElement("textarea");
                textArea.value = text;
                textArea.style.position = "fixed";
                textArea.style.opacity = "0";
                document.body.appendChild(textArea);
                textArea.focus();
                textArea.select();
                try {
                    document.execCommand("copy");
                } finally {
                    document.body.removeChild(textArea);
                }
            }
            setShowCopyTooltip(true);
            setTimeout(() => {
                setShowCopyTooltip(false);
            }, 2000);
        } catch (err) {
            console.error("Failed to copy:", err);
        }
    };

    const handleClick = async () => {
        await copyToClipboard(text, setShowTooltip);
    };

    return (
        <div className="relative">
            <button
                onClick={handleClick}
                className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-gray-600 dark:text-gray-300 hover:text-gray-800 dark:hover:text-gray-100 transition-colors bg-gray-100 dark:bg-gray-700 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600 cursor-pointer whitespace-nowrap"
            >
                <svg
                    xmlns="http://www.w3.org/2000/svg"
                    className="h-4 w-4"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                >
                    <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M8 7v8a2 2 0 002 2h6M8 7V5a2 2 0 012-2h4.586a1 1 0 01.707.293l4.414 4.414a1 1 0 01.293.707V15a2 2 0 01-2 2h-2M8 7H6a2 2 0 00-2 2v10a2 2 0 002 2h8a2 2 0 002-2v-2"
                    />
                </svg>
                Copy All
            </button>
            {showTooltip && (
                <div className="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 px-2 py-1 bg-gray-900 text-white text-xs rounded whitespace-nowrap">
                    Copied!
                </div>
            )}
        </div>
    );
}
