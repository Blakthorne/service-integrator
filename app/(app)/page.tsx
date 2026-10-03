import PlansTable from "../components/PlansTable";

/**
 * The plans list. Each plan opens on its own page under /plans, so this page
 * only shows the list.
 */
export default function Home() {
    return (
        <div className="font-sans">
            <div className="flex flex-col items-center">
                <div className="text-center mb-12 w-full">
                    <h1 className="text-4xl sm:text-5xl font-bold mb-4">
                        Service Integrator
                    </h1>
                    <p className="text-lg text-gray-600 dark:text-gray-300 max-w-2xl mx-auto">
                        Integrates with Planning Center&apos;s public Services
                        API to aggregate data and generate copyright information
                        for songs
                    </p>
                </div>

                <div className="w-full max-w-4xl mx-auto">
                    <PlansTable />
                </div>
            </div>
        </div>
    );
}
