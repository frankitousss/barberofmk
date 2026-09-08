// ============================================================
// FMK BARBERSHOP — Conexión con Supabase
// ============================================================
// 1. Creá un proyecto en https://supabase.com
// 2. Andá a Project Settings > API
// 3. Copiá "Project URL" y "anon public key" acá abajo
// ============================================================

const SUPABASE_URL = "https://zfjkpsqbquhledfnfzad.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inpmamtwc3FicXVobGVkZm5memFkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg3Njg1NDQsImV4cCI6MjEwNDM0NDU0NH0.RGi8JPha7qHc39A3CFNUWA-dhVjOB4tWzWWVbzJBMQI";

// El objeto "supabase" global lo trae el script de la CDN
// que ya está cargado en el <head> de cada HTML.
const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
