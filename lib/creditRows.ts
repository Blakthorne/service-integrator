import { phraseFor } from "./credits";
import type { FormValues } from "./forms";
import { CREDIT_ROLES_MAX, type CreditPhrases } from "./settings";

/**
 * The rows of the Settings page's Credits form: one for each credit role,
 * in the order they are written and printed, each with the phrase the
 * copyright text prints before the role's names. The form's fields are a
 * flat `FormValues` like every Settings form's (`creditRole-0`,
 * `creditPhrase-0`, `creditRole-1`, ...), so it saves, shows "Saved." and
 * refuses as the others do; these functions add, remove and move rows in
 * that map, renumbering the fields so they run from 0 without a gap.
 * `lib/settingsForms.ts` reads the form back.
 *
 * Pure and safe on both sides.
 */

/** A role's field is its prefix and the row's number: `creditRole-0`. */
export const CREDIT_ROLE_FIELD_PREFIX = "creditRole-";

/** A role's phrase field is its prefix and the row's number: `creditPhrase-0`. */
export const CREDIT_PHRASE_FIELD_PREFIX = "creditPhrase-";

/** The field of the phrase for the first two roles when the same people hold both ("Words and Music by"). */
export const CREDIT_PAIR_PHRASE_FIELD = "creditPairPhrase";

/** The fewest roles: the words' and the music's. */
export const CREDIT_ROLES_MIN = 2;

/** The name of row `index`'s role field. */
export function creditRoleField(index: number): string {
    return `${CREDIT_ROLE_FIELD_PREFIX}${index}`;
}

/** The name of row `index`'s phrase field. */
export function creditPhraseField(index: number): string {
    return `${CREDIT_PHRASE_FIELD_PREFIX}${index}`;
}

/** One row of the form, as its fields hold it. */
export interface CreditRow {
    /** Its place in the list, from 0. */
    index: number;
    role: string;
    phrase: string;
}

/** The rows `values` holds, in order: those numbered from 0 with no gap. */
export function creditRowsOf(values: FormValues): CreditRow[] {
    const rows: CreditRow[] = [];
    for (let index = 0; Object.hasOwn(values, creditRoleField(index)); index += 1) {
        rows.push({
            index,
            role: values[creditRoleField(index)],
            phrase: values[creditPhraseField(index)] ?? "",
        });
    }
    return rows;
}

/**
 * What the form's fields hold for the saved roles and phrases: each role,
 * and the phrase the copyright text prints for it (the saved one, else
 * "<role> by", which is what a role with no phrase prints), and the phrase
 * for the first two roles when the same people hold both.
 */
export function creditFormValues(
    roles: readonly string[],
    phrases: CreditPhrases
): FormValues {
    const values: FormValues = {};
    roles.forEach((role, index) => {
        values[creditRoleField(index)] = role;
        values[creditPhraseField(index)] = phraseFor([role], phrases);
    });
    values[CREDIT_PAIR_PHRASE_FIELD] = phraseFor([roles[0] ?? "Words", roles[1] ?? "Music"], phrases);
    return values;
}

/** `values` with its rows replaced by `rows`, renumbered from 0; every other field as it was. */
function withRows(
    values: FormValues,
    rows: readonly Pick<CreditRow, "role" | "phrase">[]
): FormValues {
    const next: FormValues = {};
    for (const [name, value] of Object.entries(values)) {
        if (
            !name.startsWith(CREDIT_ROLE_FIELD_PREFIX) &&
            !name.startsWith(CREDIT_PHRASE_FIELD_PREFIX)
        ) {
            next[name] = value;
        }
    }
    rows.forEach((row, index) => {
        next[creditRoleField(index)] = row.role;
        next[creditPhraseField(index)] = row.phrase;
    });
    return next;
}

/** True while another role can be added: there are fewer than `CREDIT_ROLES_MAX`. */
export function canAddCreditRow(values: FormValues): boolean {
    return creditRowsOf(values).length < CREDIT_ROLES_MAX;
}

/** True while a role can be removed: there are more than `CREDIT_ROLES_MIN`. */
export function canRemoveCreditRow(values: FormValues): boolean {
    return creditRowsOf(values).length > CREDIT_ROLES_MIN;
}

/** `values` with a blank row at the end; as they are when there are already `CREDIT_ROLES_MAX`. */
export function addCreditRow(values: FormValues): FormValues {
    if (!canAddCreditRow(values)) {
        return values;
    }
    return withRows(values, [...creditRowsOf(values), { role: "", phrase: "" }]);
}

/** `values` without row `index`; as they are when no row has that number, or only `CREDIT_ROLES_MIN` rows are left. */
export function removeCreditRow(values: FormValues, index: number): FormValues {
    const rows = creditRowsOf(values);
    if (rows.length <= CREDIT_ROLES_MIN || !rows.some((row) => row.index === index)) {
        return values;
    }
    return withRows(
        values,
        rows.filter((row) => row.index !== index)
    );
}

/**
 * `values` with row `index` moved one place up (`by` -1) or down (+1),
 * swapping places with its neighbour; as they are when no row has that
 * number or there is no neighbour that way.
 */
export function moveCreditRow(values: FormValues, index: number, by: -1 | 1): FormValues {
    const rows = creditRowsOf(values);
    const target = index + by;
    if (index < 0 || index >= rows.length || target < 0 || target >= rows.length) {
        return values;
    }
    const moved = [...rows];
    [moved[index], moved[target]] = [moved[target], moved[index]];
    return withRows(values, moved);
}
