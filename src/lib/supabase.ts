import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const supabaseConfigured = Boolean(url && anonKey);

// 프론트엔드에는 anon(public) 키만 사용합니다. service role 키는 절대 포함하지 않습니다.
export const supabase = createClient(url ?? 'http://localhost', anonKey ?? 'missing', {
    auth: { persistSession: false, autoRefreshToken: false },
});
