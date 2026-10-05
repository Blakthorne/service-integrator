import Link from "next/link";
import { ADD_BOOK_ID } from "@/lib/catalog/bookText";
import { routes } from "@/lib/routes";
import AddBookForm from "./AddBookForm";
import { TEXT_LINK_CLASS } from "./styles";

/**
 * The Add a book section of the books page: what a book is for and where its
 * songs come from, then the form. Its id is where `routes.catalogBookAdd()`
 * and the Import page's "Add a book first" scroll to.
 */
export default function AddBookCard() {
    return (
        <section
            id={ADD_BOOK_ID}
            aria-labelledby="add-book-heading"
            className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-4 sm:p-6"
        >
            <h2
                id="add-book-heading"
                className="text-xl font-semibold text-gray-900 dark:text-gray-100 mb-2"
            >
                Add a book
            </h2>
            <p className="mb-4 text-sm text-gray-600 dark:text-gray-300">
                A book is a hymnal or songbook the catalog places songs in. Add it here,
                then place songs in it from a song&apos;s page, or{" "}
                <Link href={routes.catalogImport()} className={TEXT_LINK_CLASS}>
                    import its entries from a CSV file
                </Link>
                .
            </p>
            <AddBookForm />
        </section>
    );
}
