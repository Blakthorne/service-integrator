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
import { routes } from "@/lib/routes";
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
 * adding the song, or done. Each failure is a new object, whose
 * `formStateKey` keys its alert.
 */
type AddToPlanStep =
    | { step: "loading" }
    | { step: "load-failed"; failure: { message: string } }
    | { step: "choose"; choices: PlanChoices }
    | {
          step: "confirm";
          choices: PlanChoices;
          plan: UpcomingPlanOption;
          /** Why the last try was refused or failed, keyed per attempt; none before the first. */
          failure: { message: string } | null;
          adding: boolean;
      }
    | { step: "added"; plan: UpcomingPlanOption; added: Extract<AddSongToPlanState, { ok: true }> };

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
 * cannot be closed, so its outcome is seen.
 *
 * Focus: the close button has it while the plans are read; then the plan
 * chosen; on the confirmation, its question, so it is read out; Add to
 * plan keeps it while it runs (`aria-disabled`), and a refusal is an alert
 * keyed per attempt; once added, the message; closing hands it back to the
 * button.
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

    async function add(choices: PlanChoices, plan: UpcomingPlanOption) {
        if (state.step === "confirm" && state.adding) {
            return;
        }
        const request = ++requestRef.current;
        setState({ step: "confirm", choices, plan, failure: null, adding: true });
        let result: AddSongToPlanState;
        try {
            result = await addSongToPlanAction(plan.serviceTypeId, plan.planId, pcoSongId);
        } catch (error) {
            console.error("Adding the song to a plan failed:", error);
            result = { ok: false, message: ADD_TO_PLAN_NO_ANSWER };
        }
        if (request !== requestRef.current) {
            return;
        }
        setState(
            result.ok
                ? { step: "added", plan, added: result }
                : { step: "confirm", choices, plan, failure: { message: result.message }, adding: false }
        );
    }

    function openDialog() {
        setOpen(true);
        void loadPlans();
    }

    function close() {
        if (state.step === "confirm" && state.adding) {
            return;
        }
        requestRef.current += 1;
        setOpen(false);
    }

    const adding = state.step === "confirm" && state.adding;
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
                            setState({ step: "confirm", choices, plan, failure: null, adding: false });
                        }
                    }}
                    onBack={(choices) => setState({ step: "choose", choices })}
                    onAdd={(choices, plan) => void add(choices, plan)}
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
    onBack: (choices: PlanChoices) => void;
    onAdd: (choices: PlanChoices, plan: UpcomingPlanOption) => void;
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
                    {state.failure && (
                        // A new key per attempt: a repeated refusal is announced again.
                        <p key={formStateKey(state.failure)} role="alert" className={`mt-3 ${ALERT_CLASS}`}>
                            {state.failure.message}
                        </p>
                    )}
                    <Buttons>
                        <button
                            type="button"
                            onClick={() => {
                                if (!state.adding) {
                                    onBack(state.choices);
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
                            onClick={() => onAdd(state.choices, state.plan)}
                        >
                            {state.failure ? "Try again" : "Add to plan"}
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
