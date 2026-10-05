import type { Ref } from "react";
import { buttonClasses } from "@/app/components/ui/buttonClasses";

interface EditToggleProps {
    /** Whether the card shows its editor. */
    editing: boolean;
    onToggle: () => void;
    /** What it edits, for screen readers: "the hymn", "the entries". */
    what: string;
    /** The id of the card's body, which shows the editor or what it edits. */
    controls: string;
    buttonRef?: Ref<HTMLButtonElement>;
}

/**
 * The button beside a card's heading that turns the card into its editor
 * ("Edit") and back ("Done"), saying which it is with `aria-expanded`.
 * Focus stays on it either way; the editor follows it.
 */
export default function EditToggle({ editing, onToggle, what, controls, buttonRef }: EditToggleProps) {
    return (
        <button
            ref={buttonRef}
            type="button"
            aria-expanded={editing}
            aria-controls={controls}
            onClick={onToggle}
            className={buttonClasses("secondary")}
        >
            {editing ? "Done" : "Edit"}
            <span className="sr-only"> {editing ? `editing ${what}` : what}</span>
        </button>
    );
}
