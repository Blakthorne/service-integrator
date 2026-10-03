import { auth } from "./auth"
import { NextResponse } from "next/server"
 
export default auth((req) => {
    // Logged in users can access all routes
    if (req.auth) {
        return NextResponse.next()
    }
 
    // Not logged in users are redirected to the login page, which sends them
    // back to the page they asked for once they have signed in
    const signInUrl = new URL("/auth/signin", req.url)
    signInUrl.searchParams.set(
        "callbackUrl",
        req.nextUrl.pathname + req.nextUrl.search
    )
    return NextResponse.redirect(signInUrl)
})
 
// Configure paths that require authentication
export const config = {
    matcher: [
        /*
         * Match all request paths except for the ones starting with:
         * - auth (auth pages)
         * - api/auth (auth API routes)
         * - _next/static (static files)
         * - _next/image (image optimization files)
         * - favicon.ico (favicon file)
         */
        "/((?!auth|api/auth|_next/static|_next/image|favicon.ico).*)"
    ]
}
