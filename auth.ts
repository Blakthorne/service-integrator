import NextAuth from "next-auth"
import Google from "next-auth/providers/google"

// Whitelist of allowed email addresses
const ALLOWED_EMAILS = [
    // Add your whitelisted email addresses here
    process.env.ALLOWED_EMAIL_1,
    process.env.ALLOWED_EMAIL_2,
    // Add more as needed
].filter(Boolean) as string[]

export const { 
    handlers,
    auth,
    signIn,
    signOut
} = NextAuth({
    providers: [
        Google({
            clientId: process.env.GOOGLE_CLIENT_ID!,
            clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
        })
    ],
    callbacks: {
        async signIn({ user }) {
            // Check if the user's email is in the whitelist
            if (user.email && ALLOWED_EMAILS.includes(user.email)) {
                return true
            }
            // Return false to display a default error message
            return false
        },
        async session({ session, token }) {
            return session
        },
        async jwt({ token }) {
            return token
        }
    },
    pages: {
        signIn: "/auth/signin",
        error: "/auth/error"
    }
})