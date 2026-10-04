import LocalTime from "../ui/LocalTime";
import type { SyncRun } from "@/lib/db/syncRuns";
import type { DatabaseStatus } from "@/lib/queries/system";

interface DatabaseCardProps {
    status: DatabaseStatus;
}

interface FieldProps {
    label: string;
    children: React.ReactNode;
}

/** One labelled value of the card. */
function Field({ label, children }: FieldProps) {
    return (
        <div>
            <dt className="text-sm font-medium text-gray-500 dark:text-gray-400">
                {label}
            </dt>
            <dd className="mt-1 text-gray-900 dark:text-gray-100">{children}</dd>
        </div>
    );
}

/** A file or folder path, wrapped anywhere so a long one never overflows on a phone. */
function PathText({ path }: { path: string }) {
    return <code className="text-sm break-all">{path}</code>;
}

/** When the last backup ran and how it went. */
function LastBackup({ run }: { run: SyncRun | null }) {
    if (run === null) {
        return <>None yet</>;
    }
    if (run.finishedAt === null) {
        return (
            <>
                In progress, started <LocalTime iso={run.startedAt} />
            </>
        );
    }
    if (!run.ok) {
        return (
            <span className="text-red-600 dark:text-red-400">
                Failed <LocalTime iso={run.finishedAt} />
                {run.message && <>: {run.message}</>}
            </span>
        );
    }
    return (
        <>
            <LocalTime iso={run.finishedAt} />
            {run.message && (
                <span className="block text-sm text-gray-500 dark:text-gray-400 break-all">
                    {run.message}
                </span>
            )}
        </>
    );
}

/**
 * The Database card of the Settings page: whether the database opens, its
 * file, the migrations applied and the last backup, or the error.
 */
export default function DatabaseCard({ status }: DatabaseCardProps) {
    return (
        <section
            aria-labelledby="database-heading"
            className="max-w-3xl mx-auto bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-6"
        >
            <h2
                id="database-heading"
                className="text-xl font-semibold text-gray-900 dark:text-gray-100 mb-4"
            >
                Database
            </h2>
            {status.ok ? (
                <>
                    <p className="mb-4 flex items-center gap-2 font-medium text-green-700 dark:text-green-400">
                        <span
                            aria-hidden="true"
                            className="size-2.5 rounded-full bg-green-500"
                        />
                        Database: ok
                    </p>
                    <dl className="space-y-4">
                        <Field label="File">
                            <PathText path={status.path} />
                        </Field>
                        <Field label="Migrations applied">
                            {status.appliedMigrations}
                            {status.latestMigration && (
                                <span className="text-gray-500 dark:text-gray-400">
                                    {" "}
                                    (latest {status.latestMigration})
                                </span>
                            )}
                        </Field>
                        <Field label="Last backup">
                            <LastBackup run={status.lastBackup} />
                        </Field>
                        <Field label="Backup folder">
                            <PathText path={status.backupDir} />
                        </Field>
                    </dl>
                </>
            ) : (
                <div role="alert">
                    <p className="flex items-center gap-2 font-medium text-red-600 dark:text-red-400">
                        <span
                            aria-hidden="true"
                            className="size-2.5 rounded-full bg-red-500"
                        />
                        Database: unavailable
                    </p>
                    <p className="mt-2 text-sm text-gray-700 dark:text-gray-300 break-words">
                        {status.error}
                    </p>
                </div>
            )}
        </section>
    );
}
