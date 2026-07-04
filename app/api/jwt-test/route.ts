import { auth } from '@clerk/nextjs/server'
import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

export async function GET() {
  const { getToken } = await auth()
  const token = await getToken()

  if (!token) {
    return NextResponse.json({ error: 'not authenticated' }, { status: 401 })
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      global: {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      },
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInContext: false,
      },
    }
  )

  const { data, error } = await supabase.rpc('get_jwt_claims')

  if (error) return NextResponse.json({ error }, { status: 500 })
  return NextResponse.json({ data })
}