"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import {
    addSongToPlanAction,
    listUpcomingPlansAction,
    type AddSongToPlanState,
    type UpcomingPlansState,
} from "@/app/(app)/catalog/songs/[songId]/actions";
import Dialog from "@/app/components/ui/Dialog";
import {
    ADD_TO_PLAN_NO_ANSWER,
    NO_UPCOMING_PLANS,
    UPCOMING_PLANS_NO_ANSWER,
    confirmAddToPlanQuestion,
    describeAddToPlanWrite,
    describeAddedToPlan,
    describeUnreadServiceTypes,
    planOptionKey,
    type UpcomingPlanOption,
} from "@/lib/catalog/addToPlan";
import { formStateKey } from "@/lib/forms";
import { pcoWebUrls, routes } from "@/lib/routes";
import { LINK_CLASS } from "../CatalogCard";
import { HINT_CLASS } from "../SongForm/Fields";
import PendingButton from "./PendingButton";
import {
    ALERT_CLASS,
    PRIMARY_BUTTON_CLASS,
    SECONDARY_BUTTON_CLASS,
    WARNING_CLASS,
    primaryButtonState,
} from "./styles";

/** The plans the picker offers, and how many service types' plans could not be read. */
interface PlanChoices {
    plans: UpcomingPlanOption[];
    unread: number;
}

/**
 * Where the dialog is: reading the plans, choosing one, confirming it and
 * adding the song, done, or one of two outcomes that need a person: an add
 * whose outcome is not known, and a plan that holds the song already. Each
 * message is a new object, whose `formStateKey` keys its alert.
 */
type AddToPlanStep =
    | { step: "loading" }
    | { step: "load-failed"; failure: { message: string } }
    | { step: "choose"; choices: PlanChoices }
    | {
          step: "confirm";
          choices: PlanChoices;
          plan: UpcomingPlanOption;
          /** Why the last try was refused, keyed per attempt: nothing was added. None before the first. */
          refusal: { message: string } | null;
          adding: boolean;
      }
    | {
          /** The last try failed, so it is not known whether the song was added. */
          step: "unknown";
          choices: PlanChoices;
          plan: UpcomingPlanOption;
          failure: { message: string };
      }
    | {
          /** The plan holds the song already: adding another is a choice of its own. */
          step: "duplicate";
          choices: PlanChoices;
          plan: UpcomingPlanOption;
          refusal: { message: string };
          adding: boolean;
      }
    | { step: "added"; plan: UpcomingPlanOption; added: Extract<AddSongToPlanState, { ok: true }> };

/** Whether an add is under way: from the confirmation, or "Add another anyway". */
function isAdding(state: AddToPlanStep): boolean {
    return (state.step === "confirm" || state.step === "duplicate") && state.adding;
}

/** Where the dialog goes once an add has answered. */
function stepAfter(
    result: AddSongToPlanState,
    choices: PlanChoices,
    plan: UpcomingPlanOption
): AddToPlanStep {
    if (result.ok) {
        return { step: "added", plan, added: result };
    }
    switch (result.kind) {
        case "unknown":
            return { step: "unknown", choices, plan, failure: { message: result.message } };
        case "already-in-plan":
            return { step: "duplicate", choices, plan, refusal: { message: result.message }, adding: false };
        case "refused":
            return { step: "confirm", choices, plan, refusal: { message: result.message }, adding: false };
    }
}

/** A text link to a plan in the Planning Center web app, in a new tab, to see what it holds. */
function PcoPlanWebLink({ planId }: { planId: string }) {
    return (
        <a
            href={pcoWebUrls.plan(planId)}
            target="_blank"
            rel="noopener noreferrer"
            className={`underline ${LINK_CLASS}`}
        >
            Open the plan in Planning Center
            <span aria-hidden="true"> ↗</span>
            <span className="sr-only"> (opens in a new tab)</span>
        </a>
    );
}

/** Buttons along the bottom of the dialog. */
function Buttons({ children }: { children: React.ReactNode }) {
    return <div className="mt-5 flex flex-wrap justify-end gap-3">{children}</div>;
}

interface PlanPickerProps {
    choices: PlanChoices;
    /** The key (`planOptionKey`) of the plan chosen. */
    chosen: string;
    onChoose: (key: string) => void;
    pickerRef: React.RefObject<HTMLFieldSetElement | null>;
}

/** The upcoming plans as radio buttons, each with its date, service type and own title. */
function PlanPicker({ choices, chosen, onChoose, pickerRef }: PlanPickerProps) {
    const unread = describeUnreadServiceTypes(choices.unread);
    return (
        <>
            <fieldset ref={pickerRef} className="min-w-0">
                <legend className="text-sm font-medium text-gray-700 dark:text-gray-300">
                    Upcoming plans
                </legend>
                <div className="mt-2 space-y-2">
                    {choices.plans.map((plan) => {
                        const key = planOptionKey(plan);
                        return (
                            <label key={key} className="flex items-start gap-3 cursor-pointer">
                                <input
                                    type="radio"
                                    name="add-to-plan-plan"
                                    value={key}
                                    checked={chosen === key}
                                    onChange={() => onChoose(key)}
                                    className="mt-0.5 size-4 shrink-0 cursor-pointer accent-blue-600"
                                />
                                <span className="min-w-0 text-sm">
                                    <span className="block text-gray-900 dark:text-gray-100">{plan.label}</span>
                                    {plan.title && (
                                        <span className="block text-gray-600 dark:text-gray-400">{plan.title}</span>
                                    )}
                                </span>
                            </label>
                        );
                    })}
                </div>
            </fieldset>
            {unread && <p className={`mt-3 ${WARNING_CLASS}`}>{unread}</p>}
        </>
    );
}

interface AddToPlanActionProps {
    /** The linked Planning Center song's id. */
    pcoSongId: string;
    /** The catalog song's label, "Amazing Grace (NEW BRITAIN)", for the confirmation. */
    songLabel: string;
    /** The Planning Center song's title, which the new item takes. */
    pcoTitle: string;
}

/**
 * "Add to a plan" on the page of a song linked to Planning Center: a button
 * that opens a dialog (`ui/Dialog`), which reads the upcoming plans of every
 * service type, offers them to choose from, then asks to confirm, naming the
 * plan, before adding the song at the end of it (`addSongToPlanAction`). It
 * then says what was added, with a link to the plan's Schedule tab. The app
 * cannot take the item out again.
 *
 * Both actions wait on Planning Center, so each is called from a click
 * (opening the dialog reads the plans; Add to plan writes), with where the
 * dialog is in `useState`, never in a transition or a form action
 * (convention 15). An answer nobody waits for any more (the dialog closed,
 * or asked again) is dropped. While the song is being added the dialog
 * cannot be dismissed. The browser may still close it (Chromium lets a
 * third Escape through): the add then goes on, Add to a plan… opens the
 * dialog on it again rather than read the plans afresh, and its outcome
 * opens the dialog itself, so it is seen.
 *
 * An add whose outcome is not known (Planning Center failed, or the answer
 * was lost) is never offered again in one step: the app cannot take an
 * item out again. The dialog says so, links to the plan in Planning Center,
 * and goes back through the confirmation, where Add to plan asks the server
 * again, which refuses a plan that holds the song already. That refusal
 * says which item it is, and offers "Add another anyway", which adds it
 * even so. A plain refusal (nothing was added) stays on the confirmation.
 *
 * Focus: the close button has it while the plans are read; then the plan
 * chosen; on the confirmation, its question, so it is read out; Add to
 * plan keeps it while it runs (`aria-disabled`), and a refusal is an alert
 * keyed per attempt; an unknown outcome and a plan that holds the song
 * already take it on their message, never on a button that adds; once
 * added, the message; closing hands it back to the button.
 */
export default function AddToPlanAction({ pcoSongId, songLabel, pcoTitle }: AddToPlanActionProps) {
    const [open, setOpen] = useState(false);
    const [state, setState] = useState<AddToPlanStep>({ step: "loading" });
    /** The key of the plan chosen in the picker. */
    const [chosen, setChosen] = useState("");
    const buttonRef = useRef<HTMLButtonElement>(null);
    const pickerRef = useRef<HTMLFieldSetElement>(null);
    /** The question, the message or the failure that takes focus when it appears. */
    const answerRef = useRef<HTMLParagraphElement>(null);
    /** Incremented by every action and every close, so an answer nobody waits for is dropped. */
    const requestRef = useRef(0);

    // What takes focus at each step: the plan chosen, or the step's message.
    const focusTarget =
        state.step === "loading"
            ? null
            : state.step === "choose" && state.choices.plans.length > 0
              ? "picker"
              : state.step;
    useEffect(() => {
        if (focusTarget === "picker") {
            pickerRef.current?.querySelector<HTMLInputElement>("input:checked")?.focus();
        } else if (focusTarget !== null) {
            answerRef.current?.focus();
        }
    }, [focusTarget]);

    async function loadPlans() {
        const request = ++requestRef.current;
        setState({ step: "loading" });
        let result: UpcomingPlansState;
        try {
            result = await listUpcomingPlansAction();
        } catch (error) {
            console.error("Reading the upcoming plans failed:", error);
            result = { ok: false, message: UPCOMING_PLANS_NO_ANSWER };
        }
        if (request !== requestRef.current) {
            return;
        }
        if (!result.ok) {
            setState({ step: "load-failed", failure: { message: result.message } });
            return;
        }
        setChosen(result.plans[0] ? planOptionKey(result.plans[0]) : "");
        setState({ step: "choose", choices: { plans: result.plans, unread: result.unreadServiceTypes } });
    }

    /** Add the song to `plan`; with `allowDuplicate`, even though the plan holds it already. */
    async function add(choices: PlanChoices, plan: UpcomingPlanOption, allowDuplicate: boolean) {
        if (isAdding(state)) {
            return;
        }
        const request = ++requestRef.current;
        setState(
            allowDuplicate && state.step === "duplicate"
                ? { ...state, adding: true }
                : { step: "confirm", choices, plan, refusal: null, adding: true }
        );
        let result: AddSongToPlanState;
        try {
            result = await addSongToPlanAction(plan.serviceTypeId, plan.planId, pcoSongId, allowDuplicate);
        } catch (error) {
            console.error("Adding the song to a plan failed:", error);
            result = { ok: false, kind: "unknown", message: ADD_TO_PLAN_NO_ANSWER };
        }
        if (request !== requestRef.current) {
            return;
        }
        setState(stepAfter(result, choices, plan));
        // Open again if the browser closed the dialog while the song was added.
        setOpen(true);
    }

    function openDialog() {
        setOpen(true);
        // The browser closed the dialog on an add: show it again, and read
        // the plans afresh only once the add is done.
        if (!isAdding(state)) {
            void loadPlans();
        }
    }

    // The dialog has closed, however it closed (see `ui/Dialog`), so the state
    // always follows. Plans still being read are dropped; an add goes on, and
    // opens the dialog again with its outcome.
    function close() {
        if (!isAdding(state)) {
            requestRef.current += 1;
        }
        setOpen(false);
    }

    const adding = isAdding(state);
    const statusText =
        state.step === "loading"
            ? "Reading the upcoming plans from Planning Center…"
            : adding
              ? "Adding the song to the plan in Planning Center…"
              : "";

    return (
        <>
            <button
                ref={buttonRef}
                type="button"
                onClick={openDialog}
                className={`${PRIMARY_BUTTON_CLASS} ${primaryButtonState(false)}`}
            >
                Add to a plan…
            </button>
            <Dialog
                open={open}
                onClose={close}
                title="Add to a plan"
                description="Adds this song to the end of an upcoming plan in Planning Center."
                returnFocusRef={buttonRef}
                dismissible={!adding}
            >
                <p role="status" className={statusText === "" ? "sr-only" : HINT_CLASS}>
                    {statusText}
                </p>
                <AddToPlanBody
                    state={state}
                    chosen={chosen}
                    songLabel={songLabel}
                    pcoTitle={pcoTitle}
                    pickerRef={pickerRef}
                    answerRef={answerRef}
                    onChoose={setChosen}
                    onClose={close}
                    onRetry={() => void loadPlans()}
                    onContinue={(choices) => {
                        const plan = choices.plans.find((option) => planOptionKey(option) === chosen);
                        if (plan) {
                            setState({ step: "confirm", choices, plan, refusal: null, adding: false });
                        }
                    }}
                    onBack={(choices, refused) => {
                        // After a refusal the plans may have changed (one no longer upcoming): read them again.
                        if (refused) {
                            void loadPlans();
                        } else {
                            setState({ step: "choose", choices });
                        }
                    }}
                    onConfirmAgain={(choices, plan) =>
                        setState({ step: "confirm", choices, plan, refusal: null, adding: false })
                    }
                    onAdd={(choices, plan, allowDuplicate) => void add(choices, plan, allowDuplicate)}
                />
            </Dialog>
        </>
    );
}

interface AddToPlanBodyProps {
    state: AddToPlanStep;
    chosen: string;
    songLabel: string;
    pcoTitle: string;
    pickerRef: React.RefObject<HTMLFieldSetElement | null>;
    answerRef: React.RefObject<HTMLParagraphElement | null>;
    onChoose: (key: string) => void;
    onClose: () => void;
    onRetry: () => void;
    onContinue: (choices: PlanChoices) => void;
    /** From the confirmation to the plans; `refused` when the last try was refused, so they are read again. */
    onBack: (choices: PlanChoices, refused: boolean) => void;
    /** From an unknown outcome back to the confirmation, where the add can be asked for again. */
    onConfirmAgain: (choices: PlanChoices, plan: UpcomingPlanOption) => void;
    onAdd: (choices: PlanChoices, plan: UpcomingPlanOption, allowDuplicate: boolean) => void;
}

/** What the dialog shows below its status line, for where it is. */
function AddToPlanBody({
    state,
    chosen,
    songLabel,
    pcoTitle,
    pickerRef,
    answerRef,
    onChoose,
    onClose,
    onRetry,
    onContinue,
    onBack,
    onConfirmAgain,
    onAdd,
}: AddToPlanBodyProps) {
    switch (state.step) {
        case "loading":
            return (
                <Buttons>
                    <button type="button" onClick={onClose} className={SECONDARY_BUTTON_CLASS}>
                        Cancel
                    </button>
                </Buttons>
            );
        case "load-failed":
            return (
                <>
                    <p
                        key={formStateKey(state.failure)}
                        ref={answerRef}
                        tabIndex={-1}
                        role="alert"
                        className={`${ALERT_CLASS} focus:outline-none`}
                    >
                        {state.failure.message}
                    </p>
                    <Buttons>
                        <button type="button" onClick={onClose} className={SECONDARY_BUTTON_CLASS}>
                            Close
                        </button>
                        <button
                            type="button"
                            onClick={onRetry}
                            className={`${PRIMARY_BUTTON_CLASS} ${primaryButtonState(false)}`}
                        >
                            Try again
                        </button>
                    </Buttons>
                </>
            );
        case "choose":
            if (state.choices.plans.length === 0) {
                const unread = describeUnreadServiceTypes(state.choices.unread);
                return (
                    <>
                        <p
                            ref={answerRef}
                            tabIndex={-1}
                            className="text-sm text-gray-900 dark:text-gray-100 focus:outline-none"
                        >
                            {NO_UPCOMING_PLANS}
                        </p>
                        {unread && <p className={`mt-3 ${WARNING_CLASS}`}>{unread}</p>}
                        <Buttons>
                            <button type="button" onClick={onClose} className={SECONDARY_BUTTON_CLASS}>
                                Close
                            </button>
                        </Buttons>
                    </>
                );
            }
            return (
                <>
                    <PlanPicker
                        choices={state.choices}
                        chosen={chosen}
                        onChoose={onChoose}
                        pickerRef={pickerRef}
                    />
                    <Buttons>
                        <button type="button" onClick={onClose} className={SECONDARY_BUTTON_CLASS}>
                            Cancel
                        </button>
                        <button
                            type="button"
                            onClick={() => onContinue(state.choices)}
                            className={`${PRIMARY_BUTTON_CLASS} ${primaryButtonState(false)}`}
                        >
                            Continue
                        </button>
                    </Buttons>
                </>
            );
        case "confirm":
            return (
                <>
                    <p
                        ref={answerRef}
                        tabIndex={-1}
                        className="text-sm font-medium text-gray-900 dark:text-gray-100 focus:outline-none"
                    >
                        {confirmAddToPlanQuestion(songLabel, state.plan)}
                    </p>
                    <p className={`mt-2 ${HINT_CLASS}`}>{describeAddToPlanWrite(pcoTitle)}</p>
                    {state.refusal && (
                        // A new key per attempt: a repeated refusal is announced again.
                        <p key={formStateKey(state.refusal)} role="alert" className={`mt-3 ${ALERT_CLASS}`}>
                            {state.refusal.message}
                        </p>
                    )}
                    <Buttons>
                        <button
                            type="button"
                            onClick={() => {
                                if (!state.adding) {
                                    onBack(state.choices, state.refusal !== null);
                                }
                            }}
                            aria-disabled={state.adding}
                            className={SECONDARY_BUTTON_CLASS}
                        >
                            Back
                        </button>
                        <PendingButton
                            pending={state.adding}
                            pendingLabel="Adding…"
                            onClick={() => onAdd(state.choices, state.plan, false)}
                        >
                            Add to plan
                        </PendingButton>
                    </Buttons>
                </>
            );
        case "unknown":
            return (
                <>
                    <p
                        key={formStateKey(state.failure)}
                        ref={answerRef}
                        tabIndex={-1}
                        role="alert"
                        className={`${ALERT_CLASS} focus:outline-none`}
                    >
                        {state.failure.message}
                    </p>
                    <p className="mt-3 text-sm">
                        <PcoPlanWebLink planId={state.plan.planId} />
                    </p>
                    <p className={`mt-2 ${HINT_CLASS}`}>
                        Back goes to the confirmation. Adding from there again is refused if the plan
                        has the song already.
                    </p>
                    <Buttons>
                        <button type="button" onClick={onClose} className={SECONDARY_BUTTON_CLASS}>
                            Close
                        </button>
                        <button
                            type="button"
                            onClick={() => onConfirmAgain(state.choices, state.plan)}
                            className={SECONDARY_BUTTON_CLASS}
                        >
                            Back
                        </button>
                    </Buttons>
                </>
            );
        case "duplicate":
            return (
                <>
                    <p
                        key={formStateKey(state.refusal)}
                        ref={answerRef}
                        tabIndex={-1}
                        role="alert"
                        className={`${ALERT_CLASS} focus:outline-none`}
                    >
                        {state.refusal.message}
                    </p>
                    <p className="mt-3 text-sm">
                        <PcoPlanWebLink planId={state.plan.planId} />
                    </p>
                    <Buttons>
                        <button
                            type="button"
                            onClick={() => {
                                if (!state.adding) {
                                    onClose();
                                }
                            }}
                            aria-disabled={state.adding}
                            className={SECONDARY_BUTTON_CLASS}
                        >
                            Close
                        </button>
                        <PendingButton
                            pending={state.adding}
                            pendingLabel="Adding…"
                            onClick={() => onAdd(state.choices, state.plan, true)}
                        >
                            Add another anyway
                        </PendingButton>
                    </Buttons>
                </>
            );
        case "added":
            return (
                <>
                    <p
                        ref={answerRef}
                        tabIndex={-1}
                        role="status"
                        className="text-sm text-gray-900 dark:text-gray-100 focus:outline-none"
                    >
                        {describeAddedToPlan({
                            title: state.added.title,
                            plan: state.plan,
                            arrangement: state.added.arrangement,
                        })}
                    </p>
                    <p className="mt-3 text-sm">
                        {/* prefetch={false}: a plan's pages read Planning Center. */}
                        <Link
                            href={routes.planSchedule(state.plan.serviceTypeId, state.plan.planId)}
                            prefetch={false}
                            className={LINK_CLASS}
                        >
                            Open the plan&apos;s Schedule tab
                        </Link>
                    </p>
                    <Buttons>
                        <button type="button" onClick={onClose} className={SECONDARY_BUTTON_CLASS}>
                            Done
                        </button>
                    </Buttons>
                </>
            );
    }
}
