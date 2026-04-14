import { createClient } from '@supabase/supabase-js'

export const supabaseClient = async (clerkToken: string) => {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

    /**
     * WARNING: client-side Supabase usage is restricted.
     *
     * Allowed:
     * 1. Supabase Storage uploads/downloads from client components
     * 2. Server-side privileged access from server actions with service-role auth
     *
     * Not allowed:
     * - Client-side table queries or mutations via `.from(...)`
     *   All browser data access must go through FastAPI or server actions.
     */
    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
        global: {
            // Keep Clerk auth + anon key for storage requests that still go direct to Supabase.
            headers: {
                Authorization: `Bearer ${clerkToken}`,
                apikey: supabaseAnonKey,
            },
        },
    })

    return supabase
}
