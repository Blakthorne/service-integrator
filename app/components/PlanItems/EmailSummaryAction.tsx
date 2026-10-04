"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import {
    previewPlanEmailAction,
    sendPlanEmailAction,
    type PreviewPlanEmailState,
    type SendPlanEmailState,
} from "@/app/(app)/plans/[serviceTypeId]/[planId]/actions";
import Dialog from "@/app/components/ui/Dialog";
import {
    EMAIL_DIALOG_DESCRIPTION,
    EMAIL_PENDING_TEXT,
    planEmailOutcomeView,
    planEmailPreviewView,
    type PlanEmailOutcomeView,
    type PlanEmailPreviewView,
} from "@/lib/planEmailText";
import type { PlanEmailPreview } from "@/lib/queries/email";
import { routes } from "@/lib/routes";
import { FormNotice } from "../Catalog/SongForm/Fields";
import EmailSetupNotice from "../Settings/EmailSetupNotice";
import {
    DialogAnswer,
    DialogButtons,
    HEADER_BUTTON_CLASS,
    LINK_CLASS,
    PRIMARY_BUTTON_CLASS,
    SECONDARY_BUTTON_CLASS,
} from "./PlanDialogParts";

/** Where the dialog is: reading the preview, showing it, sending, or showing what came of the send. */
type EmailDialogState =
    | { phase: "previewing" }
    | { phase: "preview"; result: PreviewPlanEmailState }
    | { phase: "sending"; preview: PlanEmailPreview }
    | { phase: "result"; result: SendPlanEmailState };

/** Shown when the preview's action never answered: the network failed, or the session ended. */
const PREVIEW_NO_ANSWER: PreviewPlanEmailState = {
    ok: false,
    message:
        "The server did not answer, so the email could not be prepared. Reload the page and try again.",
};

/**
 * Shown when the send's action never answered. The email may have gone, so
 * it says to look before trying again: the send is on Settings' recent writes.
 */
const SEND_NO_ANSWER: SendPlanEmailState = {
    ok: false,
    kind: "failed",
    message:
        "The server did not answer, so it is not known whether the email was sent. Look at the recent writes in Settings before sending it again.",
};

/** The colours of a send's summary, which says the same in words. */
const SUMMARY_TONES = {
    success: { alert: false, quiet: false },
    warning: { alert: true, quiet: true },
    error: { alert: true, quiet: false },
} as const;

/** A link to Settings, where the recipients are set. */
function SettingsLink() {
    return (
        // prefetch={false}: Settings reads every service type's categories from Planning Center.
        <Link href={routes.settings()} prefetch={false} className={LINK_CLASS}>
            Add recipients in Settings
        </Link>
    );
}

/** The recipients, or the addresses of a result, as a sentence's list. */
function Addresses({ addresses }: { addresses: readonly string[] }) {
    return <span className="break-words">{addresses.join(", ")}</span>;
}

/** The email as it would go: to whom, with what subject, and its text, which scrolls. */
function EmailPreviewFields({ view, textId }: { view: PlanEmailPreviewView; textId: string }) {
    return (
        <div className="mt-4 space-y-3 text-sm">
            <dl className="space-y-2">
                <div>
                    <dt className="font-medium text-gray-700 dark:text-gray-300">To</dt>
                    <dd className="text-gray-900 dark:text-gray-100">
                        {view.recipients.length > 0 ? (
                            <Addresses addresses={view.recipients} />
                        ) : (
                            <span className="text-gray-600 dark:text-gray-400">No one yet</span>
                        )}
                    </dd>
                </div>
                <div>
                    <dt className="font-medium text-gray-700 dark:text-gray-300">Subject</dt>
                    <dd className="break-words text-gray-900 dark:text-gray-100">{view.subject}</dd>
                </div>
            </dl>
            <div>
                <p id={textId} className="font-medium text-gray-700 dark:text-gray-300">
                    Message
                </p>
                {/* The text is the email as it would be sent: plain text, so line breaks count.
                    A region that scrolls takes the keyboard (tabIndex) and has a name. */}
                <pre
                    tabIndex={0}
                    aria-labelledby={textId}
                    className="mt-1 max-h-[40vh] overflow-auto whitespace-pre-wrap break-words rounded-md border border-gray-200 bg-gray-50 p-3 font-mono text-xs text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
                >
                    {view.text}
                </pre>
            </div>
        </div>
    );
}

/**
 * The preview: what the email is, and either Send (with Cancel) or, when it
 * cannot go (email not set up, no recipients), why, with Close. While it
 * sends, Send says so and Cancel waits.
 */
function EmailPreviewBody({
    preview,
    sending = false,
    answerRef,
    onClose,
    onSend,
}: {
    preview: PlanEmailPreview;
    sending?: boolean;
    answerRef: React.RefObject<HTMLParagraphElement | null>;
    onClose: () => void;
    onSend: (preview: PlanEmailPreview) => void;
}) {
    const textId = useId();
    const view = planEmailPreviewView(preview);
    return (
        <>
            <DialogAnswer answerRef={answerRef}>{view.headline}</DialogAnswer>
            {view.notices.map((notice) => (
                <div key={notice.kind} className="mt-3">
                    {notice.kind === "not-configured" ? (
                        <EmailSetupNotice setup={notice.setup} />
                    ) : (
                        <FormNotice tone="warning">
                            <p>{notice.message}</p>
                            <p>
                                <SettingsLink />
                            </p>
                        </FormNotice>
                    )}
                </div>
            ))}
            <EmailPreviewFields view={view} textId={textId} />
            <DialogButtons>
                {view.canSend ? (
                    <>
                        <button
                            type="button"
                            onClick={onClose}
                            disabled={sending}
                            className={SECONDARY_BUTTON_CLASS}
                        >
                            Cancel
                        </button>
                        <button
                            type="button"
                            onClick={() => {
                                if (!sending) {
                                    onSend(preview);
                                }
                            }}
                            // aria-disabled, not disabled, so it keeps focus while the email goes.
                            aria-disabled={sending}
                            className={`${PRIMARY_BUTTON_CLASS} ${
                                sending ? "opacity-60 cursor-not-allowed" : "hover:bg-blue-700 cursor-pointer"
                            }`}
                        >
                            {sending ? "Sending…" : view.sendLabel}
                        </button>
                    </>
                ) : (
                    <button type="button" onClick={onClose} className={SECONDARY_BUTTON_CLASS}>
                        Close
                    </button>
                )}
            </DialogButtons>
        </>
    );
}

/** A labelled list of addresses under a send's summary. */
function AddressLine({ label, addresses }: { label: string; addresses: readonly string[] }) {
    if (addresses.length === 0) {
        return null;
    }
    return (
        <p className="mt-3 text-sm text-gray-900 dark:text-gray-100">
            <span className="font-medium text-gray-700 dark:text-gray-300">{label}: </span>
            <Addresses addresses={addresses} />
        </p>
    );
}

/** What the send came to: who got the email, who did not, or why nothing was sent. */
function EmailResultBody({
    view,
    attempt,
    answerRef,
    onClose,
    onPreview,
}: {
    view: PlanEmailOutcomeView;
    attempt: number;
    answerRef: React.RefObject<HTMLParagraphElement | null>;
    onClose: () => void;
    onPreview: () => void;
}) {
    const sent = view.tone !== "error";
    const { alert, quiet } = SUMMARY_TONES[view.tone];
    return (
        <>
            <DialogAnswer answerRef={answerRef} alert={alert} quiet={quiet} attempt={attempt}>
                {view.summary}
            </DialogAnswer>
            {view.setup && (
                <div className="mt-3">
                    <EmailSetupNotice setup={view.setup} />
                </div>
            )}
            {view.settingsLink && (
                <p className="mt-3 text-sm">
                    <SettingsLink />
                </p>
            )}
            <AddressLine label="Sent to" addresses={view.delivered} />
            <AddressLine label="Refused by the mail server" addresses={view.refused} />
            {view.subject !== null && (
                <p className="mt-3 text-sm text-gray-900 dark:text-gray-100">
                    <span className="font-medium text-gray-700 dark:text-gray-300">Subject: </span>
                    <span className="break-words">{view.subject}</span>
                </p>
            )}
            <DialogButtons>
                {sent ? (
                    <button type="button" onClick={onClose} className={SECONDARY_BUTTON_CLASS}>
                        Done
                    </button>
                ) : (
                    <>
                        <button type="button" onClick={onClose} className={SECONDARY_BUTTON_CLASS}>
                            Close
                        </button>
                        <button
                            type="button"
                            onClick={onPreview}
                            className={`${PRIMARY_BUTTON_CLASS} hover:bg-blue-700 cursor-pointer`}
                        >
                            Preview again
                        </button>
                    </>
                )}
            </DialogButtons>
        </>
    );
}

/** A preview that did not come: why, with Close and Try again. */
function EmailPreviewProblemBody({
    message,
    attempt,
    answerRef,
    onClose,
    onPreview,
}: {
    message: string;
    attempt: number;
    answerRef: React.RefObject<HTMLParagraphElement | null>;
    onClose: () => void;
    onPreview: () => void;
}) {
    return (
        <>
            <DialogAnswer answerRef={answerRef} alert attempt={attempt}>
                {message}
            </DialogAnswer>
            <DialogButtons>
                <button type="button" onClick={onClose} className={SECONDARY_BUTTON_CLASS}>
                    Close
                </button>
                <button
                    type="button"
                    onClick={onPreview}
                    className={`${PRIMARY_BUTTON_CLASS} hover:bg-blue-700 cursor-pointer`}
                >
                    Try again
                </button>
            </DialogButtons>
        </>
    );
}

interface EmailDialogBodyProps {
    state: EmailDialogState;
    attempt: number;
    answerRef: React.RefObject<HTMLParagraphElement | null>;
    onClose: () => void;
    onPreview: () => void;
    onSend: (preview: PlanEmailPreview) => void;
}

/**
 * What the dialog shows below its status line, for where it is. A preview
 * and the send that follows it are the same `EmailPreviewBody` in the same
 * place, so Send stays the same button, and keeps focus, while the email
 * goes.
 */
function EmailDialogBody({
    state,
    attempt,
    answerRef,
    onClose,
    onPreview,
    onSend,
}: EmailDialogBodyProps) {
    switch (state.phase) {
        case "previewing":
            return (
                <DialogButtons>
                    <button type="button" onClick={onClose} className={SECONDARY_BUTTON_CLASS}>
                        Cancel
                    </button>
                </DialogButtons>
            );
        case "preview":
            return state.result.ok ? (
                <EmailPreviewBody
                    preview={state.result.preview}
                    answerRef={answerRef}
                    onClose={onClose}
                    onSend={onSend}
                />
            ) : (
                <EmailPreviewProblemBody
                    message={state.result.message}
                    attempt={attempt}
                    answerRef={answerRef}
                    onClose={onClose}
                    onPreview={onPreview}
                />
            );
        case "sending":
            return (
                <EmailPreviewBody
                    preview={state.preview}
                    sending
                    answerRef={answerRef}
                    onClose={onClose}
                    onSend={onSend}
                />
            );
        case "result":
            return (
                <EmailResultBody
                    view={planEmailOutcomeView(state.result)}
                    attempt={attempt}
                    answerRef={answerRef}
                    onClose={onClose}
                    onPreview={onPreview}
                />
            );
    }
}

interface EmailSummaryActionProps {
    serviceTypeId: string;
    planId: string;
}

/**
 * The plan header's "Email this plan": a button that opens a dialog
 * (`ui/Dialog`) with the email as it would be sent now (its recipients, its
 * subject and its whole plain text, read-only), sends it on Send, and then
 * says who got it, or why nobody did. Email that is not set up on the
 * server, and no recipients, are explained (with the variables to set, and
 * a link to Settings) and offer no Send.
 *
 * Both steps wait on something slow (Planning Center for the preview, the
 * SMTP server for the send), so each action is called from its click (Email
 * this plan, Send), with where the dialog is in `useState`, never in a
 * transition or a form action, which would hold every navigation until it
 * answered (convention 15). A preview whose dialog was closed, or opened
 * again, before it answered is ignored. While the email goes the dialog
 * cannot be closed, so its outcome is seen, and a second click on Send does
 * nothing: an email is not taken back.
 *
 * Focus: the dialog's close button has it while the preview is read; then
 * the headline or the message takes it, so it is read out; Send keeps it
 * while the email goes (`aria-disabled`); then the outcome's summary takes
 * it; closing hands it back to the button. A failure is an alert keyed per
 * attempt, so the same words are announced again.
 */
export default function EmailSummaryAction({ serviceTypeId, planId }: EmailSummaryActionProps) {
    const [open, setOpen] = useState(false);
    const [state, setState] = useState<EmailDialogState>({ phase: "previewing" });
    /** Counts the actions run, to key each failure's alert. */
    const [attempt, setAttempt] = useState(0);
    const buttonRef = useRef<HTMLButtonElement>(null);
    /** The message or summary that takes focus when an action answers. */
    const answerRef = useRef<HTMLParagraphElement>(null);
    /** Incremented by every action and every close, so an answer nobody waits for is dropped. */
    const requestRef = useRef(0);
    /** True from a click on Send until its answer: read by the handler, which may run again before a render. */
    const sendingRef = useRef(false);

    useEffect(() => {
        if (state.phase === "preview" || state.phase === "result") {
            answerRef.current?.focus();
        }
    }, [state]);

    async function preview() {
        const request = ++requestRef.current;
        setState({ phase: "previewing" });
        setAttempt((count) => count + 1);
        let result: PreviewPlanEmailState;
        try {
            result = await previewPlanEmailAction(serviceTypeId, planId);
        } catch (error) {
            console.error("Failed to preview the plan's email:", error);
            result = PREVIEW_NO_ANSWER;
        }
        if (request === requestRef.current) {
            setState({ phase: "preview", result });
        }
    }

    async function send(previewed: PlanEmailPreview) {
        if (sendingRef.current) {
            return;
        }
        sendingRef.current = true;
        const request = ++requestRef.current;
        setState({ phase: "sending", preview: previewed });
        setAttempt((count) => count + 1);
        let result: SendPlanEmailState;
        try {
            result = await sendPlanEmailAction(serviceTypeId, planId);
        } catch (error) {
            console.error("Failed to send the plan's email:", error);
            result = SEND_NO_ANSWER;
        } finally {
            sendingRef.current = false;
        }
        if (request === requestRef.current) {
            setState({ phase: "result", result });
        }
    }

    function openDialog() {
        setOpen(true);
        void preview();
    }

    function close() {
        if (sendingRef.current) {
            return;
        }
        requestRef.current += 1;
        setOpen(false);
    }

    const sending = state.phase === "sending";
    const pendingText =
        state.phase === "previewing"
            ? EMAIL_PENDING_TEXT.previewing
            : sending
              ? EMAIL_PENDING_TEXT.sending
              : "";

    return (
        <>
            <button
                ref={buttonRef}
                type="button"
                onClick={openDialog}
                className={HEADER_BUTTON_CLASS}
            >
                Email this plan
            </button>
            <Dialog
                open={open}
                onClose={close}
                title="Email this plan"
                description={EMAIL_DIALOG_DESCRIPTION}
                returnFocusRef={buttonRef}
                dismissible={!sending}
            >
                <p
                    role="status"
                    className={pendingText === "" ? "sr-only" : "text-sm text-gray-600 dark:text-gray-300"}
                >
                    {pendingText}
                </p>
                <EmailDialogBody
                    state={state}
                    attempt={attempt}
                    answerRef={answerRef}
                    onClose={close}
                    onPreview={() => void preview()}
                    onSend={(previewed) => void send(previewed)}
                />
            </Dialog>
        </>
    );
}
