import { buttonClasses } from "../ui/buttonClasses";

interface SaveButtonProps {
    /** True while the save is under way. */
    pending: boolean;
    /** The button's text, naming its card: "Save copyright". */
    children: React.ReactNode;
}

/**
 * The Save button of a Settings form. It is `ui/SubmitButton`'s primary
 * variant (`buttonClasses`), but takes `pending` as a prop: `SubmitButton`
 * reads `useFormStatus`, which these forms do not use (see `useSettingsForm`).
 *
 * While pending it says "Saving…" and ignores clicks. It is `aria-disabled`,
 * not `disabled`: a disabled button loses focus, which would leave a keyboard
 * user on the page's body when the save comes back with a refusal.
 */
export default function SaveButton({ pending, children }: SaveButtonProps) {
    return (
        <button
            type="submit"
            aria-disabled={pending}
            onClick={(event) => {
                // Stops the form submitting again; Enter in a field submits through this click too.
                if (pending) {
                    event.preventDefault();
                }
            }}
            className={buttonClasses("primary", pending)}
        >
            {pending ? "Saving…" : children}
        </button>
    );
}
