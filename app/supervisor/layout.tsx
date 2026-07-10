import { redirect } from 'next/navigation'
import { auth } from '@clerk/nextjs/server'
import { createServerSupabaseClient } from '@/lib/supabase'

export default async function SupervisorLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const { userId } = await auth()

  if (!userId) {
    redirect('/')
  }

  // Verify user exists (they will be redirected at layout level if not)
  const supabase = await createServerSupabaseClient()
  const { data: caller } = await supabase
    .from('users')
    .select('id')
    .eq('clerk_id', userId)
    .single()

  if (!caller) {
    redirect('/')
  }

  return <>{children}</>
}
