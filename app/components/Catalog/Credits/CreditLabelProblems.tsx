import LocalTime from "@/app/components/ui/LocalTime";
import { CREDIT_LABEL_OUTCOME_WORDS } from "@/lib/creditLabels";
import type { CreditLabelProblem } from "@/lib/queries/credits";

interface CreditLabelProblemsProps {
    /** The latest labels that did not go through, newest first. */
    problems: CreditLabelProblem[];
}

/**
 * The latest labels that ended without being written, newest first: the
 * song, how it ended and why, who asked (a person, or the app for a new
 * song), and when. A song whose author changed shows again above, as it is
 * now, when the app can label it.
 */
export default function CreditLabelProblems({ problems }: CreditLabelProblemsProps) {
    if (problems.length === 0) {
        return <p className="text-sm text-gray-500 dark:text-gray-400">None.</p>;
    }
    return (
        <ul className="divide-y divide-gray-100 rounded-lg border border-gray-200 bg-white shadow-sm dark:divide-gray-700 dark:border-gray-700 dark:bg-gray-800">
            {problems.map((problem) => (
                <li key={problem.id} className="space-y-1 px-4 py-3 text-sm">
                    <p className="flex flex-wrap items-baseline gap-x-3">
                        <span className="font-medium text-gray-900 dark:text-gray-100">{problem.title}</span>
                        <span className="text-gray-500 dark:text-gray-400">
                            <LocalTime iso={problem.finishedAt} />
                            {problem.source === "auto" && " · labelled automatically"}
                        </span>
                    </p>
                    <p className="text-gray-700 dark:text-gray-300">
                        {CREDIT_LABEL_OUTCOME_WORDS[problem.outcome]}
                        {problem.message && <> {problem.message}</>}
                    </p>
                </li>
            ))}
        </ul>
    );
}
