import type { TuneWithAliases } from "@/lib/domain";
import CatalogCard, { CardField, NoValue } from "../CatalogCard";

interface TuneDetailsCardProps {
    tune: TuneWithAliases;
}

/** A tune's page card: its name, meter and other names. */
export default function TuneDetailsCard({ tune }: TuneDetailsCardProps) {
    return (
        <CatalogCard title="Tune" headingId="tune-heading">
            <dl className="grid gap-4 sm:grid-cols-3">
                <CardField label="Name">{tune.name}</CardField>
                <CardField label="Meter">
                    {tune.meter ?? <NoValue>Not recorded</NoValue>}
                </CardField>
                <CardField label="Other names">
                    {tune.aliases.length > 0 ? (
                        <ul className="space-y-1">
                            {tune.aliases.map((alias) => (
                                <li key={alias}>{alias}</li>
                            ))}
                        </ul>
                    ) : (
                        <NoValue>None</NoValue>
                    )}
                </CardField>
            </dl>
        </CatalogCard>
    );
}
