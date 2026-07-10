import { redirect } from 'next/navigation'
import { auth } from '@clerk/nextjs/server'
import { createServerSupabaseClient } from '@/lib/supabase'

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const { userId } = await auth()

  if (!userId) {
    redirect('/')
  }

  const supabase = await createServerSupabaseClient()
  const { data: caller } = await supabase
    .from('users')
    .select('role')
    .eq('clerk_id', userId)
    .single()

  if (!caller || caller.role !== 'admin') {
    redirect('/')
  }

  return <>{children}</>
}
