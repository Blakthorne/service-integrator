import Link from "next/link";
import { emptyTodosText, todoView } from "@/lib/dashboard";
import type { Dashboard } from "@/lib/queries/dashboard";
import LocalTime from "../ui/LocalTime";
import { CARD_CLASS, LINK_CLASS, SECTION_HEADING_CLASS } from "./styles";

interface TodoListProps {
    dashboard: Pick<Dashboard, "todos" | "serviceTypes" | "serviceTypesError" | "databaseError">;
}

/**
 * What needs doing, each with the link that fixes it (`todoView`): the
 * catalog's and the song sync's first, then each next plan's. An empty
 * list says so, hedged when something could not be checked.
 *
 * Its links do not prefetch (convention 13): most lead to a plan's pages,
 * which load the plan from Planning Center, and a to-do's link is followed
 * once, not browsed.
 */
export default function TodoList({ dashboard }: TodoListProps) {
    const todos = dashboard.todos.map(todoView);
    return (
        <section aria-labelledby="todos-heading">
            <h2 id="todos-heading" className={SECTION_HEADING_CLASS}>
                To do
            </h2>
            {todos.length === 0 ? (
                <p className={`${CARD_CLASS} px-4 sm:px-6 py-4 text-sm text-gray-600 dark:text-gray-300`}>
                    {emptyTodosText(dashboard)}
                </p>
            ) : (
                <ul className={`${CARD_CLASS} divide-y divide-gray-200 dark:divide-gray-700`}>
                    {todos.map((todo) => (
                        <li
                            key={todo.key}
                            className="px-4 sm:px-6 py-4 flex flex-col gap-2 sm:flex-row sm:items-baseline sm:justify-between sm:gap-6"
                        >
                            <div className="min-w-0 space-y-1">
                                {todo.context && (
                                    <p className="text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">
                                        {todo.context}
                                    </p>
                                )}
                                <p className="text-gray-900 dark:text-gray-100">{todo.text}</p>
                                {todo.time && (
                                    <p className="text-sm text-gray-500 dark:text-gray-400">
                                        {todo.time.label}: <LocalTime iso={todo.time.iso} />
                                    </p>
                                )}
                            </div>
                            <Link
                                prefetch={false}
                                href={todo.action.href}
                                className={`shrink-0 text-sm font-medium ${LINK_CLASS}`}
                            >
                                {todo.action.label}
                                <span aria-hidden="true"> →</span>
                            </Link>
                        </li>
                    ))}
                </ul>
            )}
        </section>
    );
}
