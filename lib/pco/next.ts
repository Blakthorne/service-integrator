import "server-only";
import { notFound } from "next/navigation";
import { PcoError } from "./client";
import { InvalidPcoIdError } from "./ids";

/**
 * Await a getter's promise in a server page or layout, turning "this doesn't
 * exist" into Next's notFound(): a 404 from PCO, or an ID that failed
 * validation. Every other error is rethrown unchanged for the error boundary.
 */
export async function orNotFound<T>(promise: Promise<T>): Promise<T> {
    try {
        return await promise;
    } catch (error) {
        if (
            (error instanceof PcoError && error.status === 404) ||
            error instanceof InvalidPcoIdError
        ) {
            notFound();
        }
        throw error;
    }
}
